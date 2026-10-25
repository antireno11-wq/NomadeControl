"""Motor y sesiones de SQLAlchemy."""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from functools import lru_cache

from sqlalchemy import Engine, create_engine, text
from sqlalchemy.orm import Session, sessionmaker

from radar.config import get_settings


def make_engine(url: str) -> Engine:
    return create_engine(url, pool_pre_ping=True, future=True)


@lru_cache(maxsize=4)
def _engine_for(url: str) -> Engine:
    return make_engine(url)


def get_engine(url: str | None = None) -> Engine:
    return _engine_for(url or get_settings().database_url)


def session_factory(engine: Engine) -> sessionmaker[Session]:
    return sessionmaker(bind=engine, expire_on_commit=False, future=True)


@contextmanager
def session_scope(factory: sessionmaker[Session]) -> Iterator[Session]:
    session = factory()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def check_db(engine: Engine) -> str | None:
    """None si la base responde; mensaje de error en caso contrario."""
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        return None
    except Exception as exc:
        return f"{type(exc).__name__}: {exc}"[:300]
