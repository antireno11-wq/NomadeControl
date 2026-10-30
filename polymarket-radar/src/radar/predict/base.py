"""Interfaz común de los modelos predictivos: ``predict(market, evidence, as_of_time)``.

Toda predicción devuelve, aunque se abstenga:

- probabilidad estimada (o ``None`` si se abstiene) para un resultado concreto,
- intervalo de incertidumbre,
- modelo y versión,
- datos utilizados (fuente, URL, hash y último timestamp observado),
- fecha de estimación (``as_of``) y de cálculo (``created_at``),
- estado de calibración, que proviene de la evaluación fuera de muestra y nunca
  lo declara el propio modelo,
- motivo de abstención cuando corresponda.

Regla central: un modelo solo puede leer datos con timestamp ``<= as_of``. Los
proveedores de evidencia reciben ``as_of`` y son responsables de cortar ahí;
``Prediction.data_used`` registra hasta dónde llegó cada fuente para auditarlo.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import asdict, dataclass, field
from datetime import datetime
from typing import Any, Protocol

from radar.timeutil import parse_iso, utcnow

CALIB_VALIDATED = "validado"
CALIB_NOT_VALIDATED = "no_validado"
CALIB_NOT_EVALUATED = "sin_evaluar"
CALIB_ABSTAINED = "abstencion"


@dataclass(frozen=True)
class MarketView:
    """Vista normalizada de un mercado binario (de la base o de una respuesta de Gamma)."""

    market_id: str
    question: str
    description: str
    outcomes: tuple[str, ...]
    token_ids: tuple[str, ...]
    category: str = "unknown"
    condition_id: str | None = None
    resolution_source: str | None = None
    event_title: str | None = None
    event_slug: str | None = None
    slug: str | None = None
    group_item_title: str | None = None
    start_date: datetime | None = None
    end_date: datetime | None = None
    closed: bool = False
    fee_rate: float | None = None
    fee_exponent: float | None = None
    fees_enabled: bool | None = None

    @property
    def rules_sha256(self) -> str:
        return hashlib.sha256(f"{self.question}\n{self.description}".encode()).hexdigest()

    @classmethod
    def from_gamma(
        cls, raw: dict[str, Any], *, category: str = "unknown", event: dict[str, Any] | None = None
    ) -> MarketView:
        def _list(v: Any) -> tuple[str, ...]:
            if isinstance(v, str):
                try:
                    v = json.loads(v)
                except ValueError:
                    return ()
            return tuple(str(x) for x in (v or []))

        fee = raw.get("feeSchedule") or {}
        return cls(
            market_id=str(raw.get("id")),
            question=raw.get("question") or "",
            description=raw.get("description") or "",
            outcomes=_list(raw.get("outcomes")),
            token_ids=_list(raw.get("clobTokenIds")),
            category=category,
            condition_id=raw.get("conditionId"),
            resolution_source=raw.get("resolutionSource"),
            event_title=(event or {}).get("title"),
            event_slug=(event or {}).get("slug"),
            slug=raw.get("slug"),
            group_item_title=raw.get("groupItemTitle"),
            start_date=parse_iso(raw.get("startDate") or raw.get("createdAt")),
            end_date=parse_iso(raw.get("endDate")),
            closed=bool(raw.get("closed")),
            fee_rate=_opt_float(fee.get("rate")),
            fee_exponent=_opt_float(fee.get("exponent")),
            fees_enabled=raw.get("feesEnabled"),
        )


def _opt_float(v: Any) -> float | None:
    try:
        return None if v is None else float(v)
    except (TypeError, ValueError):
        return None


@dataclass(frozen=True)
class DataRef:
    """Procedencia de un dato usado por un modelo."""

    source: str  # p. ej. binance_spot_klines, deribit_dvol, wikipedia
    kind: str  # serie, archivo, documento
    url: str | None = None
    sha256: str | None = None
    retrieved_at: str | None = None
    observed_from: str | None = None
    observed_until: str | None = None  # último timestamp de dato efectivamente usado
    note: str | None = None


@dataclass
class Prediction:
    market_id: str
    outcome: str  # resultado al que se refiere ``probability`` (p. ej. "Yes", "Up")
    probability: float | None
    interval: tuple[float, float] | None
    model: str
    model_version: str
    family: str
    as_of: datetime
    calibration_status: str
    data_used: list[DataRef] = field(default_factory=list)
    abstain_reason: str | None = None
    details: dict[str, Any] = field(default_factory=dict)
    created_at: datetime = field(default_factory=utcnow)

    @property
    def abstained(self) -> bool:
        return self.probability is None

    def prob_for(self, outcome: str, outcomes: tuple[str, ...]) -> float | None:
        """Probabilidad de ``outcome`` en un mercado binario."""
        if self.probability is None:
            return None
        if outcome == self.outcome:
            return self.probability
        if len(outcomes) == 2 and outcome in outcomes and self.outcome in outcomes:
            return 1.0 - self.probability
        return None

    def interval_for(self, outcome: str, outcomes: tuple[str, ...]) -> tuple[float, float] | None:
        if self.interval is None:
            return None
        if outcome == self.outcome:
            return self.interval
        if len(outcomes) == 2 and outcome in outcomes and self.outcome in outcomes:
            lo, hi = self.interval
            return (1.0 - hi, 1.0 - lo)
        return None

    def to_dict(self) -> dict[str, Any]:
        d = asdict(self)
        d["as_of"] = self.as_of.isoformat()
        d["created_at"] = self.created_at.isoformat()
        d["interval"] = list(self.interval) if self.interval else None
        return d

    def inputs_sha256(self) -> str:
        """Huella de las entradas (datos usados + parámetros), para reproducir."""
        blob = json.dumps(
            {"data": [asdict(x) for x in self.data_used], "details": self.details},
            sort_keys=True,
            default=str,
        )
        return hashlib.sha256(blob.encode()).hexdigest()


def abstain(
    market: MarketView,
    *,
    model: str,
    version: str,
    family: str,
    as_of: datetime,
    reason: str,
    outcome: str | None = None,
    details: dict[str, Any] | None = None,
    data_used: list[DataRef] | None = None,
) -> Prediction:
    return Prediction(
        market_id=market.market_id,
        outcome=outcome or (market.outcomes[0] if market.outcomes else "Yes"),
        probability=None,
        interval=None,
        model=model,
        model_version=version,
        family=family,
        as_of=as_of,
        calibration_status=CALIB_ABSTAINED,
        data_used=data_used or [],
        abstain_reason=reason,
        details=details or {},
    )


class Predictor(Protocol):
    """Contrato de todo modelo. ``applies`` devuelve None si aplica o el motivo si no."""

    name: str
    version: str
    family: str

    def applies(self, market: MarketView) -> str | None: ...

    def predict(self, market: MarketView, evidence: Any, as_of_time: datetime) -> Prediction: ...
