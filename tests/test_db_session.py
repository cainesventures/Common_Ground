"""Guards for how request-scoped DB sessions are opened and closed.

These look like style checks but they hold a fix: if get_db or an auth
dependency that queries the session becomes a plain `def` again, a burst of
concurrent requests can freeze the whole API on the connection pool (see the
get_db docstring; Sentry BACKEND-A, 2026-10-27).
"""

import inspect

from app.auth import get_current_user, get_optional_user, require_dev_tier
from app.models.database import get_db


def test_get_db_is_async_generator():
    assert inspect.isasyncgenfunction(get_db)


def test_auth_dependencies_are_async():
    for dep in (get_current_user, get_optional_user, require_dev_tier):
        assert inspect.iscoroutinefunction(dep), dep.__name__
