"""Parser de tablas de encuestas de Wikipedia para contiendas de dos candidatos.

Lógica pura (sin E/S): recibe el HTML de una revisión y devuelve encuestas,
filas de resultado y promedios de agregadores, cada uno con la tabla y la
sección de donde salió.

Reglas deterministas:
- Se expanden ``rowspan``/``colspan`` (una encuesta con varios escenarios comparte
  encuestadora y fecha entre filas).
- Solo se usan tablas bajo una sección de segunda vuelta ("Second round",
  "Run-off", "Segundo turno").
- Una fila es un cruce A-vs-B si A y B tienen valor y ningún otro candidato de la
  tabla lo tiene (descarta escenarios con otros rivales).
- Las filas "Results"/"Resultado" se separan como resultado y nunca como encuesta.
- Filas de eventos (debates, etc.) o sin números válidos se descartan.
- Se registran advertencias en lugar de adivinar valores ilegibles.
"""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass, field
from datetime import date

from lxml import html as lxml_html

from radar.elections.contests import Contest, normalize

MONTHS = {
    "jan": 1, "january": 1, "janeiro": 1,
    "feb": 2, "february": 2, "fev": 2, "fevereiro": 2,
    "mar": 3, "march": 3, "marco": 3,
    "apr": 4, "april": 4, "abr": 4, "abril": 4,
    "may": 5, "mai": 5, "maio": 5,
    "jun": 6, "june": 6, "junho": 6,
    "jul": 7, "july": 7, "julho": 7,
    "aug": 8, "august": 8, "ago": 8, "agosto": 8,
    "sep": 9, "sept": 9, "september": 9, "set": 9, "setembro": 9,
    "oct": 10, "october": 10, "out": 10, "outubro": 10,
    "nov": 11, "november": 11, "novembro": 11,
    "dec": 12, "december": 12, "dez": 12, "dezembro": 12,
}  # fmt: skip

RUNOFF_SECTION = re.compile(r"second round|run-?off|segundo turno|2nd round")
# Filas de resultado: "Results", "Results of the second round", "2022 election",
# "Official result", "Resultado"... Ninguna encuestadora lleva "election"/"result".
EXIT_POLL = re.compile(r"exit poll|late poll|boca de urna|a pie de urna|\bexit\b")
RESULT_ROW = re.compile(
    r"\bresults?\b|\belection\b|\bresultados?\b|\beleicao\b|\beleccion\b|\belection results\b"
)


@dataclass(frozen=True)
class PollRow:
    pollster: str
    fieldwork_start: date | None
    fieldwork_end: date
    share_a: float
    share_b: float
    other: float | None
    sample_size: int | None
    margin_error: float | None
    link: str | None
    table_index: int
    section: str

    @property
    def two_party_a(self) -> float:
        return self.share_a / (self.share_a + self.share_b)

    def key(self) -> str:
        """Identidad estable de la encuesta (independiente de la revisión)."""
        blob = "|".join(
            str(x)
            for x in (
                normalize(self.pollster),
                self.fieldwork_start,
                self.fieldwork_end,
                self.share_a,
                self.share_b,
                self.sample_size,
            )
        )
        return hashlib.sha256(blob.encode()).hexdigest()[:20]


@dataclass(frozen=True)
class ResultRow:
    share_a: float
    share_b: float
    basis: str  # "valid_votes" | "unknown"
    table_index: int
    result_date: date | None = None

    @property
    def two_party_a(self) -> float:
        return self.share_a / (self.share_a + self.share_b)


@dataclass(frozen=True)
class AggregatorRow:
    aggregator: str
    last_update: date | None
    share_a: float
    share_b: float
    other: float | None
    link: str | None
    table_index: int

    @property
    def two_party_a(self) -> float:
        return self.share_a / (self.share_a + self.share_b)


@dataclass
class ParsedPage:
    polls: list[PollRow] = field(default_factory=list)
    results: list[ResultRow] = field(default_factory=list)
    aggregators: list[AggregatorRow] = field(default_factory=list)
    tables_used: list[int] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)


# ---------------------------------------------------------------- utilidades
def _joined(cell: lxml_html.HtmlElement) -> str:
    # itertext separa con espacios los elementos hijos: "<a>Lula</a><br>PT" -> "Lula PT".
    return " ".join(" ".join(cell.itertext()).split())


def _text(cell: lxml_html.HtmlElement) -> str:
    for sup in cell.xpath(".//sup"):  # notas al pie [a], [12]
        sup.drop_tree()
    return _joined(cell)


def _label(cell: lxml_html.HtmlElement) -> str:
    txt = _joined(cell)
    if txt:
        return txt
    titles = [a.get("title") for a in cell.xpath(".//a[@title]")]
    alts = [i.get("alt") for i in cell.xpath(".//img[@alt]")]
    return " ".join(t for t in [*titles, *alts] if t)


def parse_number(text: str | None) -> float | None:
    if text is None:
        return None
    t = text.strip().replace("%", "").replace("±", "").replace("pp", "").strip()
    t = re.sub(r"\[[^\]]*\]", "", t).strip()
    if not t or t.lower() in {"—", "–", "-", "n/a", "—n/a", "–n/a"} or "n/a" in t.lower():
        return None
    if re.fullmatch(r"\d{1,3}(,\d{3})+", t):  # 4,050 -> separador de miles
        t = t.replace(",", "")
    elif re.fullmatch(r"\d+,\d+", t):  # 45,1 -> coma decimal
        t = t.replace(",", ".")
    m = re.fullmatch(r"-?\d+(?:\.\d+)?", t)
    return float(m.group(0)) if m else None


def parse_int(text: str | None) -> int | None:
    if text is None:
        return None
    digits = re.sub(r"[^\d]", "", re.sub(r"\[[^\]]*\]", "", text))
    return int(digits) if digits else None


def parse_period(text: str, year: int) -> tuple[date | None, date | None]:
    """'23–24 Oct', '30 Sep–3 Oct', '3 Oct', '28 Oct 2022', '1–3 out.' → (inicio, fin)."""
    norm = normalize(text).replace(".", " ")
    tokens = re.findall(r"(\d{1,2})(?:\s*(?:de\s+)?([a-z]{3,9}))?(?:\s*(?:de\s+)?(\d{4}))?", norm)
    parsed: list[tuple[int, int | None, int | None]] = []
    for day, mon, yr in tokens:
        month = MONTHS.get(mon) if mon else None
        if mon and month is None:
            continue
        parsed.append((int(day), month, int(yr) if yr else None))
    if not parsed:
        return None, None
    end_day, end_month, end_year = parsed[-1]
    if end_month is None:
        return None, None
    end_year = end_year or year
    try:
        end = date(end_year, end_month, end_day)
    except ValueError:
        return None, None
    start = end
    if len(parsed) > 1:
        sd, sm, sy = parsed[0]
        sm = sm or end_month
        sy = sy or (end_year - 1 if sm > end_month else end_year)
        try:
            start = date(sy, sm, sd)
        except ValueError:
            start = None  # type: ignore[assignment]
    return start, end


def table_grid(table: lxml_html.HtmlElement) -> list[list[lxml_html.HtmlElement]]:
    """Matriz de celdas con rowspan/colspan expandidos (solo filas propias de la tabla)."""
    rows = table.xpath("./tr | ./thead/tr | ./tbody/tr | ./tfoot/tr")
    grid: list[list[lxml_html.HtmlElement]] = []
    pending: dict[int, tuple[int, lxml_html.HtmlElement]] = {}
    for tr in rows:
        row: list[lxml_html.HtmlElement] = []
        col = 0
        for cell in tr.xpath("./th | ./td"):
            col = _flush_pending(pending, row, col)
            try:
                cs = max(1, min(int(cell.get("colspan", 1)), 50))
                rs = max(1, min(int(cell.get("rowspan", 1)), 500))
            except ValueError:
                cs, rs = 1, 1
            for _ in range(cs):
                row.append(cell)
                if rs > 1:
                    pending[col] = (rs - 1, cell)
                col += 1
        _flush_pending(pending, row, col)
        grid.append(row)
    return grid


def _flush_pending(
    pending: dict[int, tuple[int, lxml_html.HtmlElement]],
    row: list[lxml_html.HtmlElement],
    col: int,
) -> int:
    """Inserta en ``row`` las celdas que vienen de un rowspan de filas anteriores."""
    while col in pending:
        left, cell = pending[col]
        row.append(cell)
        if left - 1 == 0:
            del pending[col]
        else:
            pending[col] = (left - 1, cell)
        col += 1
    return col


def _section_of(table: lxml_html.HtmlElement) -> str:
    """Cadena de encabezados que contiene la tabla: "h2 / h3 / h4" más cercanos."""
    parts: list[str] = []
    last_level: int | None = None
    for h in reversed(table.xpath("preceding::*[self::h2 or self::h3 or self::h4]")):
        level = int(h.tag[1])
        if last_level is not None and level >= last_level:
            continue
        parts.insert(0, " ".join(h.text_content().split()))
        last_level = level
        if level == 2:
            break
    return " / ".join(parts)


def _year_of(table: lxml_html.HtmlElement, default: int) -> int:
    """Año del encabezado más cercano dentro de la sección (p. ej. "2025")."""
    for h in reversed(table.xpath("preceding::*[self::h2 or self::h3 or self::h4]")):
        txt = " ".join(h.text_content().split())
        m = re.fullmatch(r"(19|20)\d{2}", txt)
        if m:
            return int(txt)
        if h.tag == "h2":
            break
    return default


def _subsection_of(table: lxml_html.HtmlElement) -> str:
    h = table.xpath("preceding::*[self::h3 or self::h4][1]")
    return " ".join(h[0].text_content().split()) if h else ""


@dataclass
class _Columns:
    labels: list[str]
    header_rows: int
    pollster: int | None = None
    period: int | None = None
    other: int | None = None
    sample: int | None = None
    moe: int | None = None
    link: int | None = None
    update: int | None = None
    aggregator: int | None = None
    candidates: dict[int, str] = field(default_factory=dict)  # columna -> "a"/"b"/"x"


def _columns(grid: list[list[lxml_html.HtmlElement]], contest: Contest) -> _Columns | None:
    header_rows = 0
    for row in grid:
        # Encabezado: al menos un <th> y ningún valor numérico. Una fila de resultado
        # hecha con <th> ("2017 election | 66.10% | 33.90%") no es encabezado; una fila
        # de <th> con celdas <td> de color sin texto, sí.
        if (
            row
            and any(c.tag == "th" for c in row)
            and not any(re.search(r"\d+[.,]\d+%|\d+%|^\d+([.,]\d+)?$", _joined(c)) for c in row)
        ):
            header_rows += 1
        else:
            break
    if header_rows == 0:
        return None
    width = max(len(r) for r in grid[:header_rows])
    labels = []
    for col in range(width):
        parts: list[str] = []
        for r in grid[:header_rows]:
            if col < len(r):
                lab = _label(r[col])
                if lab and lab not in parts:
                    parts.append(lab)
        labels.append(" ".join(parts))
    cols = _Columns(labels=labels, header_rows=header_rows)
    for i, lab in enumerate(labels):
        n = normalize(lab)
        if contest.candidate_a.matches(lab):
            cols.candidates[i] = "a"
        elif contest.candidate_b.matches(lab):
            cols.candidates[i] = "b"
        elif re.search(r"aggregat", n):
            cols.aggregator = i
        elif re.search(
            r"poll(ing)? ?(firm|source|company|organi[sz]ation)|pollster|instituto|"
            r"encuestadora|commissioner|\bsource\b|\bfirm\b",
            n,
        ):
            cols.pollster = cols.pollster if cols.pollster is not None else i
        elif re.search(r"last update", n):
            cols.update = i
        elif re.search(r"period|fieldwork|date|data", n):
            cols.period = cols.period if cols.period is not None else i
        elif re.search(
            r"blank|null|undec|branco|nulo|indecis|abst|\babs\b|none of|ns ?/ ?nr|nsnr|"
            r"would not vote|not vote|no votar|dk ?/ ?n[ar]|don.?t know|no answer|no sabe|"
            r"\bnone\b|\bnr\b",
            n,
        ):
            cols.other = i
        elif re.search(r"sample|amostra", n):
            cols.sample = i
        elif re.search(r"margin|margem", n):
            cols.moe = i
        elif re.search(r"\blink\b|\bref", n):
            cols.link = i
        elif re.search(r"lead|vantagem|others|outros", n):
            continue
        elif lab.strip():
            cols.candidates[i] = "x"  # otro candidato
    # Columnas de candidatos sin texto propio (solo imagen) toman la fila siguiente.
    return cols


def _cell_text(row: list[lxml_html.HtmlElement], idx: int | None) -> str | None:
    if idx is None or idx >= len(row):
        return None
    return _text(row[idx])


def _cell_link(row: list[lxml_html.HtmlElement], idx: int | None) -> str | None:
    if idx is None or idx >= len(row):
        return None
    hrefs = [a.get("href") for a in row[idx].xpath(".//a[@href]")]
    ext = [h for h in hrefs if h and h.startswith("http")]
    return ext[0] if ext else (_text(row[idx]) or None)


def parse_page(html: str, contest: Contest) -> ParsedPage:
    out = ParsedPage()
    doc = lxml_html.fromstring(html)
    tables = doc.xpath(
        '//table[contains(concat(" ", normalize-space(@class), " "), " wikitable ")]'
    )
    for idx, table in enumerate(tables):
        section = _section_of(table)
        if not RUNOFF_SECTION.search(normalize(section)):
            continue
        grid = table_grid(table)
        cols = _columns(grid, contest)
        if cols is None:
            continue
        a_cols = [c for c, v in cols.candidates.items() if v == "a"]
        b_cols = [c for c, v in cols.candidates.items() if v == "b"]
        if len(a_cols) != 1 or len(b_cols) != 1:
            continue
        a_col, b_col = a_cols[0], b_cols[0]
        others = [c for c, v in cols.candidates.items() if v == "x"]
        subsection = _subsection_of(table)
        year = _year_of(table, contest.year_for_dates)
        used = False
        for row in grid[cols.header_rows :]:
            if not row:
                continue
            first = _cell_text(
                row, cols.aggregator if cols.aggregator is not None else cols.pollster
            )
            if first is None:
                first = _cell_text(row, 0)
            va = parse_number(_cell_text(row, a_col))
            vb = parse_number(_cell_text(row, b_col))
            if va is None or vb is None or va + vb <= 0:
                continue
            if any(parse_number(_cell_text(row, c)) is not None for c in others):
                continue  # escenario con otro candidato
            name = first or ""
            if EXIT_POLL.search(normalize(name)):
                continue  # sondeos a pie de urna: no son encuestas previas
            if RESULT_ROW.search(normalize(name)):
                basis_txt = " ".join(normalize(_text(c)) for c in row)
                basis = (
                    "valid_votes" if "valid" in basis_txt or "validos" in basis_txt else "unknown"
                )
                _, rdate = parse_period(_cell_text(row, cols.period) or "", year)
                out.results.append(ResultRow(va, vb, basis, idx, rdate))
                used = True
                continue
            if cols.aggregator is not None:
                upd = _cell_text(row, cols.update)
                _, last = parse_period(upd or "", year)
                out.aggregators.append(
                    AggregatorRow(
                        aggregator=name,
                        last_update=last,
                        share_a=va,
                        share_b=vb,
                        other=parse_number(_cell_text(row, cols.other)),
                        link=_cell_link(row, cols.link),
                        table_index=idx,
                    )
                )
                used = True
                continue
            period_txt = _cell_text(row, cols.period) or ""
            start, end = parse_period(period_txt, year)
            if end is None:
                out.warnings.append(f"tabla {idx}: fecha ilegible {period_txt!r} ({name})")
                continue
            if not name or name == period_txt:
                out.warnings.append(f"tabla {idx}: encuestadora vacía ({period_txt})")
                continue
            out.polls.append(
                PollRow(
                    pollster=name,
                    fieldwork_start=start,
                    fieldwork_end=end,
                    share_a=va,
                    share_b=vb,
                    other=parse_number(_cell_text(row, cols.other)),
                    sample_size=parse_int(_cell_text(row, cols.sample)),
                    margin_error=parse_number(_cell_text(row, cols.moe)),
                    link=_cell_link(row, cols.link),
                    table_index=idx,
                    section=f"{section} / {subsection}",
                )
            )
            used = True
        if used:
            out.tables_used.append(idx)
    # Deduplicar encuestas repetidas en varias tablas.
    seen: set[str] = set()
    unique = []
    for p in out.polls:
        if p.key() not in seen:
            seen.add(p.key())
            unique.append(p)
    out.polls = unique
    return out
