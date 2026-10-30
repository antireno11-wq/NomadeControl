from datetime import UTC, datetime

from radar.timeutil import from_epoch_ms, parse_iso


def test_parse_iso_variants():
    assert parse_iso("2027-01-01T04:59:00Z") == datetime(2027, 1, 1, 4, 59, tzinfo=UTC)
    assert parse_iso("2023-11-02 22:05:44.425+00").tzinfo is not None
    assert parse_iso("2025-07-03T20:25:56.889606Z").microsecond == 889606
    assert parse_iso("2026-01-01").tzinfo == UTC
    assert parse_iso("") is None
    assert parse_iso(None) is None
    assert parse_iso("no es fecha") is None


def test_epoch_ms():
    assert from_epoch_ms("1792965150978") == datetime(2026, 10, 25, 21, 52, 30, 978000, tzinfo=UTC)
    assert from_epoch_ms(None) is None
    assert from_epoch_ms("abc") is None
