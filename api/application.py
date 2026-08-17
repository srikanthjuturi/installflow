"""ASGI entry point for Azure App Service.

Azure's Oryx builder generates a startup command that imports `application:app`,
so this module exists to be that name — `app` is also a package here, and a bare
`app:app` would import the PACKAGE and find no ASGI callable on it.

It exports the FastAPI app unchanged. Serving it correctly is the startup
command's job:

    gunicorn -k uvicorn_worker.UvicornWorker -w 2 --timeout 600 \
        --bind=0.0.0.0:8000 application:app

That worker class is not optional. FastAPI is ASGI; Oryx's default command uses
gunicorn's SYNCHRONOUS workers, which call the app with the WSGI signature and
fail every single request with

    TypeError: FastAPI.__call__() missing 1 required positional argument: 'send'

A `gunicorn.conf.py` cannot fix it from inside the deployment either — gunicorn
only auto-loads that file from the working directory, and Oryx runs the app from
an extracted /tmp path. The startup command is the only place the worker class
can be set, and setting it is an ARM operation, not part of zip deploy.

`uvicorn_worker` comes from the standalone `uvicorn-worker` package: uvicorn
removed its bundled `uvicorn.workers` module, and that old import path silently
does not exist in 0.52.
"""

from app.main import app

__all__ = ["app"]
