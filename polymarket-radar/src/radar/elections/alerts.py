"""Snapshots verificables de alertas: JSON canónico + SHA-256 encadenado.

Cada alerta se congela con todos sus insumos (estimaciones, encuestas con su
revisión de origen, cotización usada, umbrales, motivos de bloqueo) y se
encadena con el hash de la alerta anterior. Alterar o borrar una alerta rompe
la cadena (``verify_chain``).

El ledger es un archivo JSONL de solo anexado. Para que el "antes del
resultado" sea verificable por terceros, el archivo (o el último hash) debe
publicarse fuera del sistema antes del cierre, p. ej. con un commit firmado o
un sello de tiempo externo; el reloj local por sí solo no lo prueba.

``mode`` distingue alertas en vivo de las del backtest: estas últimas se crean
después del resultado y nunca cuentan como evidencia previa.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any

GENESIS = "0" * 64


def canonical_json(obj: Any) -> str:
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False, default=str)


def snapshot_hash(payload: dict[str, Any], prev_sha256: str) -> str:
    return hashlib.sha256(
        canonical_json({"payload": payload, "prev_sha256": prev_sha256}).encode()
    ).hexdigest()


@dataclass(frozen=True)
class AlertRecord:
    seq: int
    created_at: str
    mode: str  # live | backtest_retrospectivo
    kind: str  # investigacion | senal_operable
    payload: dict[str, Any]
    prev_sha256: str
    sha256: str

    def to_json(self) -> str:
        return canonical_json(self.__dict__)


class AlertLedger:
    def __init__(self, path: Path) -> None:
        self.path = path

    def records(self) -> list[AlertRecord]:
        if not self.path.exists():
            return []
        out = []
        for line in self.path.read_text(encoding="utf-8").splitlines():
            if line.strip():
                out.append(AlertRecord(**json.loads(line)))
        return out

    def append(
        self, *, mode: str, kind: str, payload: dict[str, Any], created_at: datetime
    ) -> AlertRecord:
        recs = self.records()
        prev = recs[-1].sha256 if recs else GENESIS
        body = {
            **payload,
            "_meta": {"mode": mode, "kind": kind, "created_at": created_at.isoformat()},
        }
        rec = AlertRecord(
            seq=len(recs) + 1,
            created_at=created_at.isoformat(),
            mode=mode,
            kind=kind,
            payload=body,
            prev_sha256=prev,
            sha256=snapshot_hash(body, prev),
        )
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.path.open("a", encoding="utf-8") as fh:
            fh.write(rec.to_json() + "\n")
        return rec


def verify_chain(records: list[AlertRecord]) -> list[str]:
    """Lista de problemas; vacía si la cadena está íntegra."""
    problems: list[str] = []
    prev = GENESIS
    for i, r in enumerate(records, start=1):
        if r.seq != i:
            problems.append(f"secuencia {r.seq} en la posición {i}")
        if r.prev_sha256 != prev:
            problems.append(f"alerta {r.seq}: prev_sha256 no coincide")
        if snapshot_hash(r.payload, r.prev_sha256) != r.sha256:
            problems.append(f"alerta {r.seq}: contenido alterado (hash no coincide)")
        prev = r.sha256
    return problems


def was_before(record: AlertRecord, moment: datetime) -> bool:
    """Si el registro dice haberse creado antes de ``moment`` (reloj local)."""
    return datetime.fromisoformat(record.created_at) < moment
