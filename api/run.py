"""Dev launcher: `python run.py`.

On Windows this MUST be the entry point (not the bare `uvicorn app.main:app`
CLI): psycopg's async driver cannot use Windows' default ProactorEventLoop, and
the event-loop policy has to be selected *before* uvicorn creates its loop.
"""

import asyncio
import os
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
    # RELOAD env overrides; defaults to DEBUG. Set RELOAD=0 for a stable server.
    reload = os.getenv("RELOAD", "1" if settings.DEBUG else "0") == "1"
    host = "0.0.0.0"
    port = int(os.getenv("PORT", "8000"))

    if reload:
        # The reload worker re-imports app.main (which re-applies the selector
        # policy), so uvicorn's own loop setup is fine here.
        uvicorn.run("app.main:app", host=host, port=port, reload=True)
    else:
        # Single-process: uvicorn's Windows loop setup would install a
        # ProactorEventLoop (which psycopg can't use). Bypass it by serving
        # inside a loop we create from the selector policy set above.
        config = uvicorn.Config("app.main:app", host=host, port=port)
        server = uvicorn.Server(config)
        asyncio.run(server.serve())
