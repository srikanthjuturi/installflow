"""Exception handlers that render every error in the standard API envelope."""

import logging
from datetime import datetime, timezone

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from sqlalchemy.exc import IntegrityError
from starlette.exceptions import HTTPException as StarletteHTTPException

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
    """

    def __init__(
        self,
        status_code: int,
        code: str,
        detail: str,
        headers: dict[str, str] | None = None,
    ) -> None:
        super().__init__(status_code=status_code, detail=detail, headers=headers)
        self.code = code


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


def register_exception_handlers(app: FastAPI) -> None:
    @app.exception_handler(StarletteHTTPException)
    async def _http_exc(request: Request, exc: StarletteHTTPException) -> JSONResponse:
        detail = exc.detail if isinstance(exc.detail, str) else "Request failed"
        return JSONResponse(
            status_code=exc.status_code,
            content=_error_body(
                exc.status_code, detail, [detail], getattr(exc, "code", None)
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
        response body — internals a client should never see.
        """
        logger.exception("Unhandled error on %s", request.url.path)
        message = "Something went wrong"
        return JSONResponse(
            status_code=500, content=_error_body(500, message, [message])
        )
