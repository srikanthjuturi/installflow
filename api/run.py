"""Dev launcher: `python run.py`.

On Windows this MUST be the entry point (not the bare `uvicorn app.main:app`
CLI): psycopg's async driver cannot use Windows' default ProactorEventLoop, and
the event-loop policy has to be selected *before* uvicorn creates its loop.
"""

import asyncio
import sys
import warnings

if sys.platform == "win32":
    # The policy API is deprecated in 3.14+ but is still how uvicorn selects its
    # loop; this is the documented psycopg-on-Windows fix. Silence just that noise.
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", DeprecationWarning)
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

import uvicorn  # noqa: E402

from app.core.config import settings  # noqa: E402

if __name__ == "__main__":
    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=8000,
        reload=settings.DEBUG,
    )
