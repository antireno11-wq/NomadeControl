"""Orquestación de los modelos predictivos para el CLI y la API.

- ``collect_crypto_dataset``: arma el conjunto de mercados cripto resueltos.
- ``run_crypto_backtest``: ajuste (entrenamiento), elección (validación) y medición
  (prueba); guarda parámetros, estado de calibración y reportes.
- ``predict_live``: predice mercados abiertos con datos al instante y valora contra
  libros del CLOB pedidos en el momento, por tandas (ver la función).
"""

from __future__ import annotations

import json
import math
from datetime import UTC, datetime, timedelta
from pathlib import Path
from statistics import median
from typing import Any

from radar.config import Settings
from radar.ingestion.http import ApiClient
from radar.logging_setup import get_logger
from radar.predict.crypto.backtest import run_backtest
from radar.predict.crypto.binance import Candles, make_binance
from radar.predict.crypto.dataset import (
    DatasetPlan,
    GzCache,
    build_dataset,
    dataset_sha256,
    load_dataset,
)
from radar.predict.crypto.deribit import SUPPORTED as DVOL_SUPPORTED
from radar.predict.crypto.deribit import DvolSeries, make_deribit
from radar.predict.crypto.predictor import CalibrationRegistry, CryptoEvidence, CryptoParams
from radar.timeutil import utcnow

log = get_logger(__name__)
PROJECT_ROOT = Path(__file__).resolve().parents[3]
RESEARCH_UA = (
    "PolymarketAIRadar/0.1 (https://github.com/antireno11-wq/NomadeControl; "
    "research, read-only, low volume)"
)


MARKET_MODEL = "mercado-precio-ref"


def data_dir(settings: Settings) -> Path:
    return Path(getattr(settings, "data_dir", None) or PROJECT_ROOT / "data")


def models_dir(settings: Settings) -> Path:
    return data_dir(settings) / "models"


def dataset_path(settings: Settings) -> Path:
    return data_dir(settings) / "datasets" / "crypto_resolved_v1.json.gz"


def params_path(settings: Settings) -> Path:
    return models_dir(settings) / "crypto_params.json"


def calibration_path(settings: Settings) -> Path:
    return models_dir(settings) / "crypto_calibration.json"


def load_params(settings: Settings) -> CryptoParams:
    p = params_path(settings)
    return CryptoParams.load(p) if p.exists() else CryptoParams()


def load_calibration(settings: Settings) -> CalibrationRegistry:
    return CalibrationRegistry.load(calibration_path(settings))


def collect_crypto_dataset(
    settings: Settings, start: datetime, end: datetime, *, with_prices: bool = True
) -> dict[str, Any]:
    gamma = ApiClient(settings.gamma_base_url, name="gamma", rate_per_s=4,
                      user_agent=RESEARCH_UA, max_retries=8, backoff_base_s=2,
                      backoff_max_s=60)  # fmt: skip
    clob = ApiClient(settings.clob_base_url, name="clob", rate_per_s=6,
                     user_agent=RESEARCH_UA, max_retries=8, backoff_base_s=2,
                     backoff_max_s=60)  # fmt: skip
    plan = DatasetPlan(start=start, end=end)
    cache = GzCache(data_dir(settings) / "raw" / "polymarket_crypto")
    return build_dataset(gamma, clob, cache, plan, dataset_path(settings), with_prices=with_prices)


class EvidenceLoader:
    """Velas de Binance y DVOL de Deribit (caché en ``data/raw``).

    ``load`` arma la evidencia para [start, end). En la corrida en vivo, ``refresh`` la
    pone al día antes de cada tanda: pide solo las velas cerradas desde la última carga
    y vuelve a pedir el DVOL cuando cerró una hora nueva.
    """

    def __init__(self, settings: Settings) -> None:
        self.binance = make_binance(data_dir(settings) / "raw" / "binance", user_agent=RESEARCH_UA)
        self.deribit = make_deribit(data_dir(settings) / "raw" / "deribit", user_agent=RESEARCH_UA)
        self._start: datetime | None = None
        self._dvol_hour: datetime | None = None

    def load(
        self, symbols: set[str], start: datetime, end: datetime, *, now: datetime | None = None
    ) -> CryptoEvidence:
        self.binance.now = now
        candles: dict[str, Candles] = {}
        for sym in sorted(symbols):
            candles[sym] = self.binance.load(sym, start, end)
            log.info("evidence_candles", symbol=sym, rows=len(candles[sym]),
                     gaps=candles[sym].coverage_gaps())  # fmt: skip
        self._start = start
        self._dvol_hour = _hour(min(end, now or utcnow()))
        return CryptoEvidence(candles=candles, dvol=self._load_dvol(symbols, start, end, now))

    def _load_dvol(
        self, symbols: set[str], start: datetime, end: datetime, now: datetime | None
    ) -> dict[str, DvolSeries]:
        self.deribit.now = now
        dvol: dict[str, DvolSeries] = {}
        for sym in symbols:
            asset = sym.removesuffix("USDT")
            if asset in DVOL_SUPPORTED and asset not in dvol:
                series = self.deribit.load(asset, start, end)
                if series is not None:
                    dvol[asset] = series
        return dvol

    def refresh(self, evidence: CryptoEvidence, now: datetime) -> CryptoEvidence:
        """Agrega lo publicado hasta ``now``; nunca datos posteriores a ``now``."""
        self.binance.now = now
        candles = {sym: self.binance.extend(c, now) for sym, c in evidence.candles.items()}
        dvol = evidence.dvol
        if self._start is not None and (self._dvol_hour is None or _hour(now) > self._dvol_hour):
            dvol = self._load_dvol(set(candles), self._start, now, now)
            self._dvol_hour = _hour(now)
        return CryptoEvidence(candles=candles, dvol=dvol)


def _hour(t: datetime) -> datetime:
    return t.replace(minute=0, second=0, microsecond=0)


def load_evidence(
    settings: Settings,
    symbols: set[str],
    start: datetime,
    end: datetime,
    *,
    now: datetime | None = None,
) -> CryptoEvidence:
    """Velas de Binance y DVOL de Deribit para [start, end) (caché en ``data/raw``)."""
    return EvidenceLoader(settings).load(symbols, start, end, now=now)


def run_crypto_backtest(
    settings: Settings, *, out_dir: Path | None = None, path: Path | None = None
) -> dict[str, Any]:
    ds_path = path or dataset_path(settings)
    ds = load_dataset(ds_path)
    records = ds["markets"]
    symbols = {r["terms"]["symbol"] for r in records}
    first = min(datetime.fromisoformat(a) for r in records for a in r.get("as_of") or [])
    last = max(datetime.fromisoformat(r["terms"]["window_end"] or r["end_date"])
               if r["terms"].get("window_end") else datetime.fromisoformat(r["end_date"])
               for r in records)  # fmt: skip
    evidence = load_evidence(
        settings, symbols, first - timedelta(days=31), last + timedelta(days=1)
    )
    report, params = run_backtest(records, evidence)
    prereg = PROJECT_ROOT / "docs" / "PREREGISTRO_CRIPTO.md"
    if prereg.exists():
        import hashlib

        report["preregistro"] = {
            "path": "docs/PREREGISTRO_CRIPTO.md",
            "sha256": hashlib.sha256(prereg.read_bytes()).hexdigest(),
        }
    # El SHA-256 no está dentro de ``meta`` (se calcula sobre el archivo ya armado).
    report["dataset"] = {k: v for k, v in ds["meta"].items() if k != "plan"} | {
        "plan": ds["meta"].get("plan"),
        "sha256": dataset_sha256(ds_path),
    }
    report["evidence"] = {
        sym: {"rows": len(c), "gaps": c.coverage_gaps(), "files": len(c.refs)}
        for sym, c in evidence.candles.items()
    } | {"dvol": {k: len(v.ts_ms) for k, v in evidence.dvol.items()}}
    mdir = models_dir(settings)
    mdir.mkdir(parents=True, exist_ok=True)
    params_path(settings).write_text(json.dumps(params.to_dict(), indent=1, sort_keys=True))
    calibration_path(settings).write_text(
        json.dumps(
            {
                "source": "reports/backtest_cripto.json",
                "generated_at": utcnow().isoformat(),
                "status": report["test"]["status"],
                "supera_mercado": {
                    f"cripto-{m}|{v}": res["models"][m].get("supera_mercado")
                    for v, res in report["test"]["by_variant"].items()
                    for m in res["models"]
                },
                "reference_by_variant": {
                    v: r["reference"] for v, r in report["reference_by_variant"].items()
                },
                "criteria": report["test"]["criteria"],
            },
            indent=1,
            sort_keys=True,
        )
    )
    out = out_dir or PROJECT_ROOT / "reports"
    out.mkdir(parents=True, exist_ok=True)
    (out / "backtest_cripto.json").write_text(
        json.dumps(report, indent=1, ensure_ascii=False, default=str)
    )
    from radar.predict.report import crypto_backtest_markdown

    (out / "backtest_cripto.md").write_text(crypto_backtest_markdown(report), encoding="utf-8")
    return report


def utc_date(s: str) -> datetime:
    return datetime.fromisoformat(s).replace(tzinfo=UTC)


# ----------------------------------------------------------------- persistencia


def _jsonable(x: Any) -> Any:
    """Copia apta para columnas JSON de PostgreSQL, que rechaza ``NaN`` e infinitos.

    Un tramo de calibración vacío tiene ``mean_p = NaN``; se guarda como ``null``.
    """
    return _finite(json.loads(json.dumps(x, default=str)))


def _finite(x: Any) -> Any:
    if isinstance(x, float) and not math.isfinite(x):
        return None
    if isinstance(x, dict):
        return {k: _finite(v) for k, v in x.items()}
    if isinstance(x, list):
        return [_finite(v) for v in x]
    return x


def start_run(engine: Any, kind: str, params: CryptoParams | None = None) -> int:
    from sqlalchemy import insert

    from radar.db.models import PredictionRun

    with engine.begin() as conn:
        return conn.execute(
            insert(PredictionRun)
            .values(
                kind=kind,
                started_at=utcnow(),
                status="running",
                params_version=params.version if params else None,
                params_sha256=params.sha256() if params else None,
                summary={},
            )
            .returning(PredictionRun.id)
        ).scalar_one()


def finish_run(
    engine: Any, run_id: int, status: str, summary: dict[str, Any], report_path: str | None = None
) -> None:
    from sqlalchemy import update

    from radar.db.models import PredictionRun

    with engine.begin() as conn:
        conn.execute(
            update(PredictionRun)
            .where(PredictionRun.id == run_id)
            .values(
                status=status,
                finished_at=utcnow(),
                summary=_jsonable(summary),
                report_path=report_path,
            )
        )


def persist_evaluations(engine: Any, run_id: int, report: dict[str, Any]) -> int:
    """Copia las métricas de prueba del backtest a ``model_evaluations``."""
    from sqlalchemy import insert

    from radar.db.models import ModelEvaluation

    rows = []
    refs = {v: r.get("reference") for v, r in report["reference_by_variant"].items()}
    now = utcnow()
    for variant, res in report["test"]["by_variant"].items():
        market = res.get("market") or {}
        for m, s in res["models"].items():
            vm = (s.get("vs_market") or {}).get("log_loss_diff") or {}
            rows.append(
                {
                    "run_id": run_id,
                    "created_at": now,
                    "backtest_version": report["version"],
                    "family": "cripto",
                    "model": f"cripto-{m}",
                    "variant": variant,
                    "split": "test",
                    "n": s["n"],
                    "n_clusters": s["n_clusters"],
                    "brier": s["brier"]["value"],
                    "brier_lo": s["brier"]["lo"],
                    "brier_hi": s["brier"]["hi"],
                    "log_loss": s["log_loss"]["value"],
                    "log_loss_lo": s["log_loss"]["lo"],
                    "log_loss_hi": s["log_loss"]["hi"],
                    "ece": s["ece"]["value"],
                    "calib_in_large": s["calib_in_large"]["value"],
                    "market_brier": (market.get("brier") or {}).get("value"),
                    "market_log_loss": (market.get("log_loss") or {}).get("value"),
                    "vs_market_ll_diff": vm.get("value"),
                    "vs_market_ll_lo": vm.get("lo"),
                    "vs_market_ll_hi": vm.get("hi"),
                    "supera_mercado": s.get("supera_mercado"),
                    "is_reference": refs.get(variant) == m,
                    "status": s["status"],
                    "failures": s["validation_failures"],
                    "bins": _jsonable(s["bins"]),
                }
            )
        if market.get("n"):
            rows.append(
                {
                    "run_id": run_id,
                    "created_at": now,
                    "backtest_version": report["version"],
                    "family": "mercado",
                    "model": MARKET_MODEL,
                    "variant": variant,
                    "split": "test",
                    "n": market["n"],
                    "n_clusters": market["n_clusters"],
                    "brier": market["brier"]["value"],
                    "brier_lo": market["brier"]["lo"],
                    "brier_hi": market["brier"]["hi"],
                    "log_loss": market["log_loss"]["value"],
                    "log_loss_lo": market["log_loss"]["lo"],
                    "log_loss_hi": market["log_loss"]["hi"],
                    "ece": market["ece"]["value"],
                    "calib_in_large": market["calib_in_large"]["value"],
                    "market_brier": None,
                    "market_log_loss": None,
                    "vs_market_ll_diff": None,
                    "vs_market_ll_lo": None,
                    "vs_market_ll_hi": None,
                    "supera_mercado": None,
                    "is_reference": False,
                    "status": "referencia_mercado",
                    "failures": [],
                    "bins": _jsonable(market["bins"]),
                }
            )
    if rows:
        with engine.begin() as conn:
            conn.execute(insert(ModelEvaluation), _jsonable_rows(rows))
    return len(rows)


def _jsonable_rows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out = []
    for r in rows:
        clean = {}
        for k, v in r.items():
            if isinstance(v, float) and v != v:  # NaN → NULL
                v = None
            clean[k] = v
        out.append(clean)
    return out


# ----------------------------------------------------------------- en vivo


def open_markets(engine: Any, now: datetime) -> list[tuple[Any, Any]]:
    from sqlalchemy import select
    from sqlalchemy.orm import Session

    from radar.db.models import Event, Market

    with Session(engine) as session:
        return list(
            session.execute(
                select(Market, Event.title, Event.slug, Event.category)
                .join(Event, Event.id == Market.event_id)
                .where(Market.closed.is_(False), Market.active.is_(True))
                .where((Market.end_date.is_(None)) | (Market.end_date > now))
            ).all()
        )


def view_from_row(m: Any, title: str | None, slug: str | None, category: str) -> Any:
    from radar.predict.base import MarketView

    fee = m.fee_schedule or {}
    return MarketView(
        market_id=m.id,
        question=m.question,
        description=m.description or "",
        outcomes=tuple(m.outcomes or ()),
        token_ids=tuple(m.clob_token_ids or ()),
        category=category,
        condition_id=m.condition_id,
        resolution_source=m.resolution_source,
        event_title=title,
        event_slug=slug,
        slug=m.slug,
        group_item_title=m.group_item_title,
        start_date=m.source_created_at or m.start_date,
        end_date=m.end_date,
        closed=m.closed,
        fee_rate=fee.get("rate") if fee else m.taker_base_fee,
        fee_exponent=fee.get("exponent") if fee else None,
        fees_enabled=m.fees_enabled,
    )


LIVE_BATCH_MARKETS = 50  # mercados por tanda: sus libros se piden y valoran en segundos


def predict_live(
    settings: Settings,
    engine: Any,
    *,
    max_markets: int | None = None,
    batch_markets: int = LIVE_BATCH_MARKETS,
) -> dict[str, Any]:
    """Predice los mercados abiertos y valora los cripto contra libros pedidos en el momento.

    Los cripto van por tandas, en orden de cierre. En cada tanda:

    1. se ponen al día las velas y se fija el ``as_of`` de la tanda;
    2. se descartan los mercados ya cerrados y se piden los libros del resto;
    3. se descartan los que cerraron antes de recibir el libro;
    4. se predice en ``as_of`` y se valora enseguida contra esos libros;
    5. recién después se guarda la tanda (con una base remota, es la parte lenta).
    """
    from collections import Counter

    from radar.ingestion.pipeline import build_clients
    from radar.market.orderbook import normalize_book
    from radar.predict.crypto.terms import CryptoTerms, parse_crypto_terms
    from radar.predict.registry import default_registry
    from radar.predict.valuation import BookView, value_token

    started = utcnow()
    params = load_params(settings)
    calib = load_calibration(settings)
    calib_doc = json.loads(calibration_path(settings).read_text()) if calibration_path(
        settings
    ).exists() else {}  # fmt: skip
    beats = calib_doc.get("supera_mercado") or {}
    reference = calib_doc.get("reference_by_variant") or {}
    registry = default_registry(params, calib)
    from radar.predict.forward import suspended_pairs

    suspended = suspended_pairs(engine)  # forward-v1: solo puede quitar señales
    run_id = start_run(engine, "live", params)
    summary: dict[str, Any] = {"as_of": started.isoformat(), "families": {}, "crypto": {}}
    try:
        rows = open_markets(engine, started)
        fam_count: Counter[str] = Counter()
        crypto: list[tuple[Any, CryptoTerms]] = []
        unsupported: Counter[str] = Counter()
        for m, title, slug, category in rows:
            mv = view_from_row(m, title, slug, category)
            family = registry.family_of(mv)
            fam_count[family] += 1
            if family != "cripto":
                continue
            t = parse_crypto_terms(mv)
            if isinstance(t, CryptoTerms):
                if t.resolution_time > started:
                    crypto.append((mv, t))
            else:
                unsupported[t.reason] += 1
        crypto.sort(key=lambda x: x[1].resolution_time)
        if max_markets:
            crypto = crypto[:max_markets]
        summary["families"] = {
            f: {"mercados": n, "motivo": registry.abstainers[f].reason}
            if f in registry.abstainers
            else {"mercados": n}
            for f, n in fam_count.items()
        }
        summary["crypto"]["no_interpretables"] = dict(unsupported.most_common())
        summary["crypto"]["interpretables"] = len(crypto)
        symbols = {t.symbol for _, t in crypto}
        loader = EvidenceLoader(settings)
        evidence = loader.load(symbols, started - timedelta(days=31), started, now=started)
        books_n: Counter[str] = Counter(pedidos=0, recibidos=0, faltantes=0, fallidos=0)
        closed: Counter[str] = Counter(antes_de_pedir_libro=0, antes_de_recibir_libro=0)
        recs: Counter[str] = Counter()
        abst: Counter[str] = Counter()
        as_ofs: list[datetime] = []
        ages: list[float] = []
        n_pred = 0
        _gamma, clob, close = build_clients(settings)
        try:
            for i in range(0, len(crypto), batch_markets):
                evidence = loader.refresh(evidence, utcnow())
                as_of = utcnow()
                batch = [(mv, t) for mv, t in crypto[i : i + batch_markets]
                         if t.resolution_time > as_of]  # fmt: skip
                closed["antes_de_pedir_libro"] += min(batch_markets, len(crypto) - i) - len(batch)
                if not batch:
                    continue
                tokens = sorted({tok for mv, _ in batch for tok in mv.token_ids})
                fetched = clob.fetch_books(tokens)
                received_by = utcnow()
                books: dict[str, BookView] = {}
                for tok, (book, received) in fetched.books.items():
                    bids, asks = normalize_book(book.bids, book.asks)
                    books[tok] = BookView(tok, bids, asks, received, book.source_ts)
                books_n["pedidos"] += len(tokens)
                books_n["recibidos"] += len(books)
                books_n["faltantes"] += len(fetched.missing)
                books_n["fallidos"] += sum(len(b) for b, _ in fetched.failed)
                as_ofs.append(as_of)
                done: list[tuple[Any, ...]] = []
                for mv, t in batch:
                    if t.resolution_time <= received_by:
                        # El libro ya puede reflejar el resultado: no hay nada que valorar.
                        closed["antes_de_recibir_libro"] += 1
                        continue
                    preds = {
                        p.name: p.predict_terms(mv, t, evidence, as_of) for p in registry.crypto
                    }
                    n_pred += len(preds)
                    for name, pr in preds.items():
                        if pr.probability is None:
                            abst[f"{name}: {pr.abstain_reason}"] += 1
                    ref_name = f"cripto-{reference.get(t.variant) or 'rv'}"
                    ref_pred = preds.get(ref_name) or preds["cripto-rv"]
                    vals = []
                    for idx, outcome in enumerate(mv.outcomes):
                        tok = mv.token_ids[idx] if idx < len(mv.token_ids) else None
                        val = value_token(
                            mv,
                            outcome,
                            ref_pred,
                            books.get(tok) if tok else None,
                            utcnow(),
                            supera_mercado=beats.get(f"{ref_pred.model}|{t.variant}"),
                            suspendido=f"{ref_pred.model}|{t.variant}" in suspended,
                        )
                        recs[val.recommendation] += 1
                        if val.book_age_s is not None:
                            ages.append(val.book_age_s)
                        vals.append(val)
                    done.append((mv, t, preds, ref_pred, vals))
                _persist_live_batch(engine, run_id, done)
                log.info("live_batch", run_id=run_id, as_of=as_of.isoformat(),
                         mercados=len(done), libros=len(books),
                         cerrados=dict(closed), s_desde_libros=round(
                             (utcnow() - received_by).total_seconds(), 2))  # fmt: skip
        finally:
            close()
        summary["crypto"]["libros"] = dict(books_n)
        summary["crypto"]["cerrados_antes_de_valorar"] = dict(closed)
        summary["crypto"]["tandas"] = {
            "mercados_por_tanda": batch_markets,
            "con_libros": len(as_ofs),
            "primer_as_of": as_ofs[0].isoformat() if as_ofs else None,
            "ultimo_as_of": as_ofs[-1].isoformat() if as_ofs else None,
        }
        summary["crypto"]["antiguedad_libro_s"] = (
            {"mediana": round(median(ages), 3), "maxima": round(max(ages), 3)} if ages else None
        )
        summary["crypto"]["predicciones"] = n_pred
        summary["crypto"]["abstenciones"] = dict(abst.most_common(20))
        summary["crypto"]["recomendaciones"] = dict(recs)
        summary["crypto"]["referencia_por_variante"] = reference or "rv (sin calibración)"
        summary["crypto"]["suspendidos_en_vivo"] = sorted(suspended)
        finish_run(engine, run_id, "success", summary)
    except Exception as exc:
        summary["error"] = repr(exc)
        finish_run(engine, run_id, "failed", summary)
        raise
    summary["run_id"] = run_id
    return summary


def _persist_live_batch(engine: Any, run_id: int, done: list[tuple[Any, ...]]) -> None:
    """Guarda una tanda en una transacción: una sentencia para predicciones y otra para
    valoraciones (y no varias por mercado, que con una base remota tardaban ~2 s cada uno)."""
    if not done:
        return
    from sqlalchemy import insert

    from radar.db.models import PredictionRecord, ValuationRecord

    keys: list[tuple[str, str]] = []
    pred_rows: list[dict[str, Any]] = []
    for mv, _t, preds, _ref, _vals in done:
        for pr in preds.values():
            keys.append((mv.market_id, pr.model))
            pred_rows.append(
                {
                    "run_id": run_id,
                    "market_id": mv.market_id,
                    "outcome": pr.outcome,
                    "model": pr.model,
                    "model_version": pr.model_version,
                    "family": pr.family,
                    "as_of": pr.as_of,
                    "created_at": pr.created_at,
                    "probability": pr.probability,
                    "p_low": pr.interval[0] if pr.interval else None,
                    "p_high": pr.interval[1] if pr.interval else None,
                    "calibration_status": pr.calibration_status,
                    "abstain_reason": pr.abstain_reason,
                    "data_used": _jsonable([r.__dict__ for r in pr.data_used]),
                    "details": _jsonable(pr.details),
                    "inputs_sha256": pr.inputs_sha256(),
                }
            )
    stmt = insert(PredictionRecord).returning(PredictionRecord.id, sort_by_parameter_order=True)
    with engine.begin() as conn:
        new_ids = conn.execute(stmt, pred_rows).scalars().all()
        ids = dict(zip(keys, new_ids, strict=True))
        val_rows: list[dict[str, Any]] = []
        for mv, t, _preds, ref_pred, vals in done:
            for val in vals:
                d = val.to_dict()
                d.pop("version")
                d.pop("model_version")
                val_rows.append(
                    {
                        "run_id": run_id,
                        "prediction_id": ids[(mv.market_id, ref_pred.model)],
                        "question": mv.question,
                        "category": "crypto",
                        "variant": t.variant,
                        "end_date": mv.end_date,
                        "version": val.version,
                    }
                    | d
                    | {"as_of": val.as_of, "book_received_at": val.book_received_at}
                )
        if val_rows:
            conn.execute(insert(ValuationRecord), val_rows)


def backtest_summary(report: dict[str, Any]) -> dict[str, Any]:
    st = report["test"]["status"]
    beats = sorted(
        f"cripto-{m}|{v}"
        for v, res in report["test"]["by_variant"].items()
        for m, x in res["models"].items()
        if x.get("supera_mercado")
    )
    h = report["hypothetical"]
    return {
        "instancias": report["instances"],
        "particiones": report["splits"]["counts"],
        "validados": sorted(k for k, v in st.items() if v == "validado"),
        "no_validados": len([k for k, v in st.items() if v != "validado"]),
        "superan_mercado": beats,
        "referencia_por_variante": {
            v: r["reference"] for v, r in report["reference_by_variant"].items()
        },
        "operaciones_hipoteticas": {
            "n": h["n_trades"],
            "resultado_usd": round(h["total_pnl"], 2),
            "apostado_usd": h["staked"],
            "etiqueta": h["label"],
        },
        "contraste_resolucion": report["build"]["resolution_check"],
        "abstenciones": report["abstentions"],
        "excluidas": report["build"]["skipped"],
    }
