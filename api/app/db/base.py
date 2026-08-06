"""Model registry for Alembic autogenerate.

Import every ORM model here so that `Base.metadata` is fully populated when
Alembic inspects it. As features add models, import them below, e.g.:

    from app.features.jobs.models import Job  # noqa: F401
"""

from app.db.base_class import Base  # noqa: F401

# Feature models are imported here as they are created.
