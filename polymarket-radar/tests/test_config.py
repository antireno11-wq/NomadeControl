import pytest
from pydantic import ValidationError

from radar.config import Settings


def test_default_mode_is_paper():
    assert Settings(_env_file=None).trading_mode == "paper"


@pytest.mark.parametrize("value", ["live", "real", "LIVE", "production", "1", "true"])
def test_any_non_paper_mode_aborts_startup(monkeypatch, value):
    monkeypatch.setenv("RADAR_TRADING_MODE", value)
    with pytest.raises(ValidationError, match="solo admite 'paper'"):
        Settings(_env_file=None)


def test_paper_is_case_insensitive(monkeypatch):
    monkeypatch.setenv("RADAR_TRADING_MODE", " PAPER ")
    assert Settings(_env_file=None).trading_mode == "paper"


def test_redacted_hides_database_password():
    s = Settings(_env_file=None, database_url="postgresql+psycopg://radar:s3cret@db:5432/radar")
    red = s.redacted()
    assert "s3cret" not in str(red)
    assert red["database_url"] == "postgresql+psycopg://radar:***@db:5432/radar"


def test_no_trading_code_in_package():
    """El paquete no debe contener llamadas a endpoints de órdenes del CLOB."""
    from pathlib import Path

    import radar

    root = Path(radar.__file__).parent
    forbidden = ["/order", "post_order", "create_order", "api_key", "L2Header", "private_key"]
    for path in root.rglob("*.py"):
        text = path.read_text(encoding="utf-8")
        for word in forbidden:
            assert word not in text, f"{word!r} aparece en {path}"
