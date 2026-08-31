"""Wire shapes for global search.

One hit shape for every entity. The console draws a search result the same way
whatever it points at — a title, a line of context, an optional chip — so the
API answers in that shape rather than five, and the panel needs no per-type
rendering branch.

**No route or href here.** The client owns the URL map; a backend that knew
`/tickets/:id` would be a second place route paths live, and the two would
disagree the first time one moved.
"""

from enum import Enum

from pydantic import BaseModel


class SearchType(str, Enum):
    """The searchable entities, in the order the panel lists them.

    Members are the path segment of the drill-down route, so a typo is a 422
    rather than an empty result nobody can explain.
    """

    ticket = "ticket"
    technician = "technician"
    user = "user"
    vendor = "vendor"
    product = "product"


class SearchHit(BaseModel):
    """One result row.

    `id` is a string rather than a UUID because the product group carries three
    different tables' ids and a ticket's is a UUID while a pincode-like key
    would not be — the client only ever hands it back in a URL.
    """

    id: str
    type: SearchType
    title: str
    subtitle: str | None = None
    badge: str | None = None


class SearchGroup(BaseModel):
    """One entity's slice of the preview."""

    type: SearchType
    #: Matches found, counted only as far as `COUNT_CAP`. See `capped`.
    total: int
    #: True when the count stopped at the cap — the real total is "at least
    #: `total`". The console renders `99+`, which is a bounded count and not a
    #: number anybody made up.
    capped: bool
    items: list[SearchHit]


class SearchPreviewOut(BaseModel):
    """The top few of every type the caller may see.

    Groups with no hits are omitted entirely, so the panel's pills are exactly
    the types worth clicking.
    """

    groups: list[SearchGroup]
