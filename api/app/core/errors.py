"""Exception handlers that render every error in the standard API envelope."""

import logging
from datetime import datetime, timezone

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from sqlalchemy.exc import IntegrityError
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.types import ASGIApp, Message, Receive, Scope, Send

_HTTP_422 = 422

logger = logging.getLogger(__name__)


class AppError(HTTPException):
    """An `HTTPException` that also names WHY, for the client rather than the user.

    Raise this instead of a bare `HTTPException` wherever one status code
    carries more than one meaning and a client has to tell them apart. The
    handler above copies `code` into the envelope; everything else about the
    response is unchanged.

    Keep codes SCREAMING_SNAKE and stable — they are an API surface, and
    renaming one breaks a client the way renaming a field would.

    `errors` is an optional list of extra lines (which pincode is taken, owned
    by whom) that the envelope's `errors` array echoes. Leave it off and the
    handler falls back to `[detail]` exactly as it always has.
    """

    def __init__(
        self,
        status_code: int,
        code: str,
        detail: str,
        headers: dict[str, str] | None = None,
        errors: list[str] | None = None,
    ) -> None:
        super().__init__(status_code=status_code, detail=detail, headers=headers)
        self.code = code
        self.errors = errors


def _error_body(
    status_code: int, message: str, errors: list[str], code: str | None = None
) -> dict:
    """The standard envelope, plus an optional machine-readable `code`.

    Prose is for the person; `code` is for the client. They are different
    audiences and conflating them has already cost us once: `accept` returns
    409 for two unrelated reasons — the job was taken, or you are at your daily
    cap — and the app matched on the STATUS alone, so a technician who had
    filled their day was told somebody else had been faster. Wrong, and it hid
    the only action that fixes it.
    """
    body = {
        "success": False,
        "statusCode": status_code,
        "message": message,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "data": None,
        "errors": errors,
    }
    # Omitted rather than null when absent, so every existing error is byte-for
    # byte what it was and no client has to learn a new key it will not read.
    if code:
        body["code"] = code
    return body


def _unhandled_response() -> JSONResponse:
    message = "Something went wrong"
    return JSONResponse(status_code=500, content=_error_body(500, message, [message]))


class UnhandledErrorMiddleware:
    """Turn an unhandled error into the 500 envelope INSIDE the CORS layer.

    `main.py` must add this BEFORE `CORSMiddleware`, so that CORS wraps it.

    The `Exception` handler below is not enough on its own. Starlette mounts a
    handler for `Exception` on `ServerErrorMiddleware`, the outermost layer,
    which sits OUTSIDE every `add_middleware` — CORS included. So its 500 left
    with no `Access-Control-Allow-Origin`, the browser refused to hand the
    response to the console, and the console reported "Cannot reach the server"
    for what was really a bug in one endpoint. That is how the per-category
    Rules Config failure presented.

    Pure ASGI rather than `BaseHTTPMiddleware`, which buffers the response and
    has a history of breaking streaming and background tasks. If the response
    has already started there is nothing to replace, so the error propagates to
    the handler below exactly as before.
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        started = False

        async def _send(message: Message) -> None:
            nonlocal started
            if message["type"] == "http.response.start":
                started = True
            await send(message)

        try:
            await self.app(scope, receive, _send)
        except Exception:
            if started:
                raise
            logger.exception("Unhandled error on %s", scope.get("path"))
            await _unhandled_response()(scope, receive, send)


def register_exception_handlers(app: FastAPI) -> None:
    @app.exception_handler(StarletteHTTPException)
    async def _http_exc(request: Request, exc: StarletteHTTPException) -> JSONResponse:
        detail = exc.detail if isinstance(exc.detail, str) else "Request failed"
        return JSONResponse(
            status_code=exc.status_code,
            content=_error_body(
                exc.status_code,
                detail,
                getattr(exc, "errors", None) or [detail],
                getattr(exc, "code", None),
            ),
            headers=getattr(exc, "headers", None),
        )

    @app.exception_handler(RequestValidationError)
    async def _validation_exc(
        request: Request, exc: RequestValidationError
    ) -> JSONResponse:
        errors = [
            f"{'.'.join(str(p) for p in e['loc'][1:])}: {e['msg']}".lstrip(": ")
            for e in exc.errors()
        ]
        return JSONResponse(
            status_code=_HTTP_422,
            content=_error_body(_HTTP_422, "Validation failed", errors),
        )

    @app.exception_handler(IntegrityError)
    async def _integrity_exc(request: Request, exc: IntegrityError) -> JSONResponse:
        """A constraint the service layer meant to pre-check, hit anyway.

        Usually a race: two writers pass the same "is this free?" check and the
        database settles it. The caller gets the same 409 the pre-check would
        have given, not a 500 — and never the SQL.
        """
        logger.warning("Integrity error on %s: %s", request.url.path, exc.orig)
        message = "That value is already taken"
        return JSONResponse(
            status_code=409, content=_error_body(409, message, [message])
        )

    @app.exception_handler(Exception)
    async def _unhandled_exc(request: Request, exc: Exception) -> JSONResponse:
        """Last resort: log the detail, return the envelope.

        Without this, an unhandled error renders a raw traceback into the
        response body — internals a client should never see. Errors from a
        route normally stop at `UnhandledErrorMiddleware` first; this catches
        what is raised outside it.
        """
        logger.exception("Unhandled error on %s", request.url.path)
        return _unhandled_response()
