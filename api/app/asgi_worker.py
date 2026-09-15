"""Gunicorn worker class for production — see `.claude/skills/publish-api`.

Identical to `uvicorn_worker.UvicornWorker`, except it turns off the `Server:
uvicorn` response header. That header is not configurable from the gunicorn
CLI — the startup command sets `-k` to a worker class, not to uvicorn flags —
so the only place to silence it is a subclass gunicorn can point to instead.

The Azure Portal startup command names the class by dotted path, so this file
has to ship as `app/asgi_worker.py` and the command has to read
`app.asgi_worker.NoServerHeaderWorker`. Changing that command is an ARM
operation this deploy account cannot perform — see `scripts/publish.py` —
so somebody with Portal access has to make that one edit by hand.
"""

from uvicorn_worker import UvicornWorker


class NoServerHeaderWorker(UvicornWorker):
    CONFIG_KWARGS = {"server_header": False}
