import json
from datetime import UTC, datetime

from radar.elections.alerts import AlertLedger, verify_chain, was_before


def test_ledger_chains_and_detects_tampering(tmp_path):
    led = AlertLedger(tmp_path / "alerts.jsonl")
    t = datetime(2026, 10, 24, 12, tzinfo=UTC)
    a = led.append(mode="live", kind="investigacion", payload={"x": 1}, created_at=t)
    b = led.append(mode="live", kind="investigacion", payload={"x": 2}, created_at=t)
    assert b.prev_sha256 == a.sha256 and a.seq == 1 and b.seq == 2
    assert verify_chain(led.records()) == []
    assert was_before(a, datetime(2026, 10, 25, 20, tzinfo=UTC))

    lines = (tmp_path / "alerts.jsonl").read_text().splitlines()
    rec = json.loads(lines[0])
    rec["payload"]["x"] = 999  # alteración posterior
    lines[0] = json.dumps(rec)
    (tmp_path / "alerts.jsonl").write_text("\n".join(lines) + "\n")
    problems = verify_chain(AlertLedger(tmp_path / "alerts.jsonl").records())
    assert any("alterado" in p for p in problems)


def test_deleting_an_alert_breaks_the_chain(tmp_path):
    led = AlertLedger(tmp_path / "a.jsonl")
    t = datetime(2026, 10, 24, tzinfo=UTC)
    for i in range(3):
        led.append(mode="live", kind="investigacion", payload={"i": i}, created_at=t)
    lines = (tmp_path / "a.jsonl").read_text().splitlines()
    (tmp_path / "a.jsonl").write_text("\n".join([lines[0], lines[2]]) + "\n")
    assert verify_chain(AlertLedger(tmp_path / "a.jsonl").records())
