"""Exception handlers that render every error in the standard API envelope."""

from datetime import datetime, timezone

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

_HTTP_422 = 422


def _error_body(status_code: int, message: str, errors: list[str]) -> dict:
    return {
        "success": False,
        "statusCode": status_code,
        "message": message,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "data": None,
        "errors": errors,
    }


def register_exception_handlers(app: FastAPI) -> None:
    @app.exception_handler(StarletteHTTPException)
    async def _http_exc(request: Request, exc: StarletteHTTPException) -> JSONResponse:
        detail = exc.detail if isinstance(exc.detail, str) else "Request failed"
        return JSONResponse(
            status_code=exc.status_code,
            content=_error_body(exc.status_code, detail, [detail]),
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
