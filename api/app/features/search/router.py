"""Global search — the console's topbar box.

Two routes rather than one, because the two answers are different shapes and a
union response model would make both of them vague:

    GET /search           the preview: the top few of every type
    GET /search/{type}    one type, paginated — the panel's infinite scroll

Three guards on both, and none of them is redundant:

  * `require_feature("dashboard.view")` — hard rule 2. Every ops role holds it,
    which is the point: search is not its own privilege, it is a faster way to
    reach screens the caller can already open. The real authorization is the
    per-entity feature check inside `service._may_see`, which drops a group the
    caller could not have listed anyway.
  * `require_staff_principal` — a vendor holds `jobs.view` and `masters.view`,
    so without this one could type a competitor's brand and get product hits.
    See the guard's own docstring; refusing the role is why this slice does not
    have to re-derive five different ownership rules.
  * `CompanyPrincipal`, underneath both — a superadmin has no active company and
    so has nothing to search.

`/{type}` is an enum path param, so an unknown segment is a 422 at the edge
rather than an empty page nobody can explain. That differs from the list
screens' filter values on purpose: those ride in a shareable query string where
an old bookmark must not be able to break a page, while this segment is only
ever produced by the panel's own pills.
"""

from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import Principal, require_feature, require_staff_principal
from app.core.schemas import (
    ApiEnvelope,
    ListParams,
    PaginatedEnvelope,
    envelope,
    list_params,
    paginated,
)
from app.features.search import service
from app.features.search.schemas import SearchHit, SearchPreviewOut, SearchType

router = APIRouter(prefix="/search", tags=["search"])

Db = Annotated[AsyncSession, Depends(get_db)]
CanSearch = Annotated[Principal, Depends(require_feature("dashboard.view"))]
StaffOnly = Depends(require_staff_principal)


@router.get("", response_model=ApiEnvelope[SearchPreviewOut], dependencies=[StaffOnly])
async def search_preview(
    db: Db,
    principal: CanSearch,
    params: Annotated[ListParams, Depends(list_params)],
) -> ApiEnvelope[SearchPreviewOut]:
    """The top few matches of every type this caller may see.

    `limit` is ignored here — the preview's job is to show that a type HAS
    matches, and the count that matters rides on each group. Paging is what
    `/search/{type}` is for.
    """
    return envelope(
        await service.preview(db, principal, params.search),
        message="Search results",
    )


@router.get(
    "/{kind}",
    response_model=PaginatedEnvelope[SearchHit],
    dependencies=[StaffOnly],
)
async def search_one_type(
    db: Db,
    principal: CanSearch,
    kind: SearchType,
    params: Annotated[ListParams, Depends(list_params)],
) -> PaginatedEnvelope[SearchHit]:
    """One type, paginated.

    A type the caller may not see answers with an empty page rather than a 403 —
    the same silence the preview gives by omitting the group.
    """
    rows, total = await service.search_one(db, principal, kind, params)
    return paginated(
        rows,
        page=params.page,
        limit=params.limit,
        total=total,
        message="Search results",
    )
