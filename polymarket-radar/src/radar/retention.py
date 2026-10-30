"""Poda de datos voluminosos que ya no se usan, para que la base no crezca sin límite.

- Corridas en vivo (predicciones y valoraciones) de más de ``retention_live_days`` días,
  solo si la evaluación en vivo ya las capturó: ``forward_instances`` y ``paper_trades``
  guardan copia de lo que se necesita después.
- Snapshots de libros de corridas de ingesta de más de ``retention_snapshot_days`` días.
  ``market_state`` (el último análisis de cada mercado) no se toca.

Los backtests, las evaluaciones, la cartera de papel y los mercados se conservan.
"""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import delete, func, select

from radar.db.models import ForwardInstance, IngestionRun, OrderbookSnapshot, PredictionRun
from radar.timeutil import utcnow


def prune(
    engine: Any, *, live_days: int, snapshot_days: int, now: datetime | None = None
) -> dict[str, int]:
    now = now or utcnow()
    with engine.begin() as conn:
        captured = conn.execute(select(func.max(ForwardInstance.run_id))).scalar() or 0
        runs = conn.execute(
            delete(PredictionRun)
            .where(
                PredictionRun.kind == "live",
                PredictionRun.started_at < now - timedelta(days=live_days),
                PredictionRun.id < captured,
            )
            .returning(PredictionRun.id)
        ).all()
        old_ingest = select(IngestionRun.id).where(
            IngestionRun.started_at < now - timedelta(days=snapshot_days)
        )
        snaps = conn.execute(
            delete(OrderbookSnapshot).where(OrderbookSnapshot.run_id.in_(old_ingest))
        ).rowcount
    return {"corridas_en_vivo_borradas": len(runs), "snapshots_borrados": snaps}
