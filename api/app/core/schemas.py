"""Shared API contract: response envelope, pagination, and list query params.

Mirrors the shape the adminWeb frontend already speaks:
    { success, statusCode, message, timestamp, data, errors[] }
with a sibling `pagination` block on list responses.
"""

from datetime import datetime, timezone
from typing import Annotated, Generic, Literal, TypeVar

from fastapi import Query
from pydantic import AfterValidator, BaseModel, ConfigDict

T = TypeVar("T")


class AppModel(BaseModel):
    """Base for response models — reads from ORM objects, camelCase on the wire."""

    model_config = ConfigDict(from_attributes=True)


def _within_bcrypt_limit(value: str) -> str:
    """Reject a password bcrypt cannot hash, in BYTES rather than characters.

    `max_length` alone is not enough: pydantic counts characters, and 72 emoji
    are 288 bytes. Without this the request passes validation and then explodes
    inside `hash_password` as a 500.

    The message names bytes because that is the real rule, and says why the two
    numbers can differ — "72 characters" would be a lie to anyone typing an
    accented or Indic script.
    """
    from app.core.security import BCRYPT_MAX_BYTES, too_long_for_bcrypt

    if too_long_for_bcrypt(value):
        raise ValueError(
            f"Password is too long — at most {BCRYPT_MAX_BYTES} bytes. "
            "Accented and non-Latin characters count as more than one each."
        )
    return value


#: A password somebody TYPES. Bounded so an over-long one is a 422 naming the
#: field, never a 500 from inside bcrypt.
BoundedPassword = Annotated[str, AfterValidator(_within_bcrypt_limit)]


#: What happened to an account's temporary-password email.
#:
#: `sent` means Azure accepted it (202) — NOT that it arrived; there is no
#: delivery webhook, so an asynchronous bounce is invisible to us.
#: `failed` means it was refused, timed out, unconfigured, or allowlist-blocked.
#: `skipped` means no password was issued at all, because the email already
#: belonged to an identity that keeps its own. That is a success, not a failure,
#: which is why it is a third value rather than `failed` with a special message.
EmailStatus = Literal["sent", "failed", "skipped"]


class EmailOutcome(AppModel):
    """Mixed into every response that creates or reissues a password.

    Six endpoints report one of these — four creates and two reissues — across
    four slices that may not import each other, so the shape lives here.
    """

    emailStatus: EmailStatus
    emailError: str | None = None
    #: Returned ONLY when `emailStatus == "failed"`, so the manager can still
    #: hand the password over.
    #:
    #: Always returning it would put the credential in devtools and any HTTP log
    #: for every creation, defeating the point of emailing it. Never returning
    #: it would strand the account: staff have no password reset, and
    #: /auth/change-password needs the current password. Exactly-on-failure is
    #: the same trade as an undelivered WhatsApp invite still leaving a copyable
    #: link on the row.
    temporaryPassword: str | None = None


def _now() -> datetime:
    return datetime.now(timezone.utc)


class ApiEnvelope(BaseModel, Generic[T]):
    success: bool = True
    statusCode: int = 200
    message: str = "Request processed successfully"
    timestamp: datetime
    data: T | None = None
    errors: list[str] = []


class PaginationMeta(BaseModel):
    page: int
    limit: int
    totalRecords: int
    totalPages: int
    hasNextPage: bool
    hasPreviousPage: bool


class PaginatedEnvelope(ApiEnvelope[list[T]], Generic[T]):
    pagination: PaginationMeta


def envelope(
    data: T,
    *,
    message: str = "Request processed successfully",
    status_code: int = 200,
) -> ApiEnvelope[T]:
    return ApiEnvelope[T](
        success=True,
        statusCode=status_code,
        message=message,
        timestamp=_now(),
        data=data,
        errors=[],
    )


def paginated(
    rows: list[T],
    *,
    page: int,
    limit: int,
    total: int,
    message: str = "Request processed successfully",
) -> PaginatedEnvelope[T]:
    total_pages = (total + limit - 1) // limit if limit else 0
    return PaginatedEnvelope[T](
        success=True,
        statusCode=200,
        message=message,
        timestamp=_now(),
        data=rows,
        errors=[],
        pagination=PaginationMeta(
            page=page,
            limit=limit,
            totalRecords=total,
            totalPages=total_pages,
            hasNextPage=page < total_pages,
            hasPreviousPage=page > 1,
        ),
    )


class ListParams(BaseModel):
    """Common list query params: ?page=&limit=&search=&sortBy=&sortDir="""

    page: int = 1
    limit: int = 20
    search: str | None = None
    sortBy: str | None = None
    sortDir: str = "asc"

    @property
    def offset(self) -> int:
        return (self.page - 1) * self.limit


def list_params(
    page: Annotated[int, Query(ge=1)] = 1,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    search: Annotated[str | None, Query()] = None,
    sortBy: Annotated[str | None, Query()] = None,
    sortDir: Annotated[str, Query(pattern="^(asc|desc)$")] = "asc",
) -> ListParams:
    return ListParams(
        page=page, limit=limit, search=search, sortBy=sortBy, sortDir=sortDir
    )
