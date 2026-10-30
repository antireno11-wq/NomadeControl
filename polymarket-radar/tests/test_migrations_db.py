"""La migración de Alembic y los modelos SQLAlchemy deben coincidir."""

import pytest
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext

from radar.db.models import Base

pytestmark = pytest.mark.db


def test_models_match_migrations(migrated_engine):
    with migrated_engine.connect() as conn:
        diff = compare_metadata(MigrationContext.configure(conn), Base.metadata)
    assert diff == []
