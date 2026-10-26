"""Registro de modelos y enrutamiento por tipo de mercado.

Cada mercado recibe la lista de modelos de su familia. Las familias sin dataset
adecuado tienen un modelo que **siempre se abstiene** con el motivo concreto: es
preferible una interfaz que se abstiene a un modelo aparentemente sofisticado pero
inválido.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from radar.elections.contests import CONTESTS
from radar.elections.discovery import classify
from radar.elections.engine import build_estimates, consensus
from radar.elections.models import MODEL_VERSION as ELECTION_MODEL_VERSION
from radar.predict.base import (
    CALIB_NOT_VALIDATED,
    DataRef,
    MarketView,
    Prediction,
    Predictor,
    abstain,
)
from radar.predict.crypto.predictor import (
    METHODS,
    CalibrationRegistry,
    CryptoParams,
    CryptoPredictor,
)

ABSTAIN_VERSION = "abstencion-v1"

FAMILY_BY_CATEGORY = {
    "crypto": "cripto",
    "elections": "elecciones",
    "economy": "macro",
    "tech": "corporativo",
    "politics": "otros",
    "culture": "otros",
    "sports": "deportes",
    "weather": "clima",
    "unknown": "otros",
    "other": "otros",
}

ABSTAIN_REASONS = {
    "macro": (
        "modelo macroeconómico no implementado: falta una serie histórica verificable de la "
        "fuente de resolución (p. ej. rendimientos del Tesoro) y un conjunto de calibración"
    ),
    "corporativo": "eventos corporativos: sin conjunto de datos verificable para estimar",
    "deportes": "deportes: sin fuente de datos deportivos verificable ni modelo validado",
    "clima": (
        "clima: requiere pronósticos por conjuntos con historial y la estación de resolución; "
        "no implementado"
    ),
    "otros": "sin modelo ni conjunto de datos adecuado para este tipo de evento",
}


class AbstainingPredictor:
    """Modelo de una familia sin datos adecuados: aplica y siempre se abstiene."""

    def __init__(self, family: str, reason: str) -> None:
        self.family = family
        self.name = f"{family}-sin-modelo"
        self.version = ABSTAIN_VERSION
        self.reason = reason

    def applies(self, market: MarketView) -> str | None:
        return None

    def predict(self, market: MarketView, evidence: Any, as_of_time: datetime) -> Prediction:
        return abstain(
            market,
            model=self.name,
            version=self.version,
            family=self.family,
            as_of=as_of_time,
            reason=self.reason,
        )


@dataclass
class ElectoralEvidence:
    """Encuestas y agregadores de una revisión fechada, más la calibración."""

    polls: list[Any]
    aggregators: list[Any]
    error_models: dict[str, Any]
    validation_status: str = CALIB_NOT_VALIDATED
    source: DataRef | None = None
    extra: dict[str, Any] = field(default_factory=dict)


class ElectoralPredictor:
    """Adaptador del motor electoral (``electoral-2t-v1``) a la interfaz común."""

    family = "elecciones"
    name = "elecciones-2t"
    version = ELECTION_MODEL_VERSION

    def _classify(self, market: MarketView) -> Any:
        return classify(
            market.question,
            market.event_title,
            market.group_item_title,
            market.event_slug,
            market.category,
        )

    def applies(self, market: MarketView) -> str | None:
        c = self._classify(market)
        if not c.electoral:
            return "no es electoral"
        if c.coverage != "modelado":
            return c.abstain_reason or "contienda no modelada"
        return None

    def predict(
        self, market: MarketView, evidence: ElectoralEvidence | None, as_of_time: datetime
    ) -> Prediction:
        reason = self.applies(market)
        if reason:
            return self._abstain(market, as_of_time, reason)
        c = self._classify(market)
        contest = CONTESTS.get(c.contest_key or "")
        if contest is None:
            return self._abstain(market, as_of_time, "contienda no registrada")
        if evidence is None:
            return self._abstain(market, as_of_time, "sin encuestas cargadas para as_of")
        estimates = build_estimates(
            contest, evidence.polls, evidence.aggregators, as_of_time, evidence.error_models
        )
        cons = consensus(estimates)
        if cons.reference_prob_a is None:
            why = next(
                (e.abstain_reason for e in estimates if e.abstain_reason),
                "sin estimaciones válidas",
            )
            return self._abstain(market, as_of_time, why)
        text = f"{market.group_item_title or ''} {market.question}"
        if contest.candidate_a.matches(text):
            p, lo, hi = cons.reference_prob_a, cons.min_prob_a, cons.max_prob_a
        elif contest.candidate_b.matches(text):
            p = 1 - cons.reference_prob_a
            lo, hi = 1 - (cons.max_prob_a or 0), 1 - (cons.min_prob_a or 0)
        else:
            return self._abstain(market, as_of_time, "candidato del mercado no identificado")
        yes = "Yes" if "Yes" in market.outcomes else market.outcomes[0]
        return Prediction(
            market_id=market.market_id,
            outcome=yes,
            probability=float(p),
            interval=(float(lo or p), float(hi or p)),
            model=self.name,
            model_version=self.version,
            family=self.family,
            as_of=as_of_time,
            calibration_status=evidence.validation_status,
            data_used=[evidence.source] if evidence.source else [],
            details={
                "contienda": contest.key,
                "regla": cons.rule,
                "n_estimaciones": cons.n_estimates,
                "estimaciones": [e.__dict__ for e in estimates],
            },
        )

    def _abstain(self, market: MarketView, as_of: datetime, reason: str) -> Prediction:
        return abstain(
            market,
            model=self.name,
            version=self.version,
            family=self.family,
            as_of=as_of,
            reason=reason,
        )


@dataclass
class Registry:
    crypto: list[CryptoPredictor]
    electoral: ElectoralPredictor
    abstainers: dict[str, AbstainingPredictor]

    def family_of(self, market: MarketView) -> str:
        family = FAMILY_BY_CATEGORY.get(market.category, "otros")
        if family != "elecciones" and self.electoral.applies(market) is None:
            return "elecciones"
        return family

    def route(self, market: MarketView) -> list[Predictor]:
        family = self.family_of(market)
        if family == "cripto":
            return list(self.crypto)
        if family == "elecciones":
            return [self.electoral]
        return [self.abstainers.get(family) or self.abstainers["otros"]]

    def predict_market(
        self, market: MarketView, evidence: dict[str, Any], as_of_time: datetime
    ) -> list[Prediction]:
        family = self.family_of(market)
        return [p.predict(market, evidence.get(family), as_of_time) for p in self.route(market)]


def default_registry(
    params: CryptoParams | None = None, calibration: CalibrationRegistry | None = None
) -> Registry:
    return Registry(
        crypto=[CryptoPredictor(m, params, calibration) for m in METHODS],
        electoral=ElectoralPredictor(),
        abstainers={f: AbstainingPredictor(f, r) for f, r in ABSTAIN_REASONS.items()},
    )
