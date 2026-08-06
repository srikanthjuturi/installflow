"""Shared API contract: response envelope, pagination, and list query params.

Mirrors the shape the adminWeb frontend already speaks:
    { success, statusCode, message, timestamp, data, errors[] }
with a sibling `pagination` block on list responses.
"""

from datetime import datetime, timezone
from typing import Annotated, Generic, TypeVar

from fastapi import Query
from pydantic import BaseModel, ConfigDict

T = TypeVar("T")


class AppModel(BaseModel):
    """Base for response models — reads from ORM objects, camelCase on the wire."""

    model_config = ConfigDict(from_attributes=True)


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
