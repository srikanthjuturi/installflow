"""Product master request/response models.

Two validators carry real weight here:

`IconKey` is checked against the closed catalogue in `app.core.icons`. An icon
the mobile app has not traced would render as a blank square on a technician's
phone, so an unknown key is a 422 rather than something the client falls back on.

`ImageUrls` accepts http(s) only and explicitly rejects `data:` — see
`app.core.images` for why, which is the same reason every other slice that takes
an image URL uses that module's `ImageUrl`.
"""

import uuid
from typing import Annotated

from pydantic import AfterValidator, BaseModel, Field

from app.core.icons import PRODUCT_ICON_KEYS
from app.core.images import check_image_url
from app.core.schemas import AppModel
from app.core.service_types import DEFAULT_SERVICE_TYPES, SERVICE_TYPES

#: Photos per model. Enough for the front, the label and the box; low enough
#: that the gallery still fits a phone screen and a list response stays small.
MAX_IMAGES = 5


def _check_icon(value: str) -> str:
    if value not in PRODUCT_ICON_KEYS:
        raise ValueError(
            f"Unknown icon. Choose one of: {', '.join(PRODUCT_ICON_KEYS)}"
        )
    return value


def _check_image_urls(values: list[str]) -> list[str]:
    """Clean and bound the gallery. Order is the client's and is preserved —
    the first photo is the thumbnail, so reordering is a real edit."""
    urls = [v.strip() for v in values]
    urls = [u for u in urls if u]
    if len(urls) > MAX_IMAGES:
        raise ValueError(f"Up to {MAX_IMAGES} photos per model")
    return [check_image_url(url) for url in urls]


def _check_service_types(values: list[str]) -> list[str]:
    """Clean and bound what a technician can be sent to do with this model.

    Rebuilt in catalogue order rather than the order they arrived, so two models
    with the same three types read identically everywhere they are listed.
    """
    picked = {v.strip() for v in values if v and v.strip()}
    if not picked:
        raise ValueError("Pick at least one service type")

    unknown = sorted(picked - set(SERVICE_TYPES))
    if unknown:
        raise ValueError(
            f"Unknown service type: {', '.join(unknown)}. "
            f"Choose from {', '.join(SERVICE_TYPES)}."
        )
    return [s for s in SERVICE_TYPES if s in picked]


IconKey = Annotated[str, Field(max_length=32), AfterValidator(_check_icon)]
ImageUrls = Annotated[list[str], AfterValidator(_check_image_urls)]
ServiceTypes = Annotated[list[str], AfterValidator(_check_service_types)]

Name64 = Annotated[str, Field(min_length=2, max_length=64)]
Name120 = Annotated[str, Field(min_length=1, max_length=120)]


# ── requests ──────────────────────────────────────────────────────────────────


class CategoryCreateRequest(BaseModel):
    name: Name64
    iconKey: IconKey
    isActive: bool = True


class CategoryUpdateRequest(BaseModel):
    name: Name64 | None = None
    iconKey: IconKey | None = None
    isActive: bool | None = None
    sortOrder: int | None = Field(default=None, ge=0)


class SubcategoryCreateRequest(BaseModel):
    name: Name64
    #: Omit to inherit the parent category's icon.
    iconKey: IconKey | None = None
    isActive: bool = True


class SubcategoryUpdateRequest(BaseModel):
    name: Name64 | None = None
    iconKey: IconKey | None = None
    isActive: bool | None = None
    sortOrder: int | None = Field(default=None, ge=0)


#: Size or rating — "43 inch", "7 kg", "340 L".
Capacity = Annotated[str | None, Field(default=None, max_length=64)]
#: 0–240 months. The ceiling catches a year count typed into a months field.
WarrantyMonths = Annotated[int | None, Field(default=None, ge=0, le=240)]
#: An amount of money, in PAISE — hard rule 9, never a float.
#:
#: `gt=0` because a free job is not a cheap job, it is a missing price; the same
#: CHECK sits on both tables. The ceiling is ₹10,00,000, which no install is,
#: and it is here to catch the mistake this field invites: rupees typed into a
#: paise box. Both clients send paise and convert at the form edge.
PricePaise = Annotated[int, Field(gt=0, le=100_000_000)]


class ModelCreateRequest(BaseModel):
    """The name and the brand are required; the rest ops fill in as they learn it.

    A half-known model still lets a ticket reference it — but not a brandless
    one. "43-inch LED" without a maker names nothing a technician can be sent to
    install, and a brand backfilled later is a brand nobody remembers.
    """

    name: Name120
    #: The vendor whose brand this model carries. Validated against the caller's
    #: own company in the service — an id in a body is an assertion, not a fact.
    vendorId: uuid.UUID
    #: What a technician can be sent to do with it. Defaults to installation and
    #: demo, which is the work this product was built around.
    serviceTypes: ServiceTypes = Field(
        default_factory=lambda: list(DEFAULT_SERVICE_TYPES)
    )
    capacity: Capacity = None
    warrantyMonths: WarrantyMonths = None
    #: What the job is worth to each side. REQUIRED, unlike everything else a
    #: half-known model may leave out: a ticket stamps both at intake and the
    #: columns are NOT NULL, so a model saved without them is one no ticket
    #: could ever be raised against. Better to refuse the save than to accept a
    #: row that fails on somebody else's screen a week later.
    technicianPayoutPaise: PricePaise
    vendorPricePaise: PricePaise
    imageUrls: ImageUrls = Field(default_factory=list)
    isActive: bool = True


class ModelUpdateRequest(BaseModel):
    name: Name120 | None = None
    #: Re-branding is allowed; clearing the brand is not, so this is optional
    #: rather than clearable.
    vendorId: uuid.UUID | None = None
    #: Sent whole — omitting it leaves the list alone, and an empty list is
    #: refused rather than clearing it. A model does nothing is not a model.
    serviceTypes: ServiceTypes | None = None
    capacity: Capacity = None
    warrantyMonths: WarrantyMonths = None
    #: Repricing is allowed; UNpricing is not, so these are optional rather than
    #: clearable — the same shape `vendorId` takes and for the same reason.
    technicianPayoutPaise: PricePaise | None = None
    vendorPricePaise: PricePaise | None = None
    #: Sent whole, never patched entry by entry — an empty list clears the
    #: gallery, and omitting the key leaves it alone.
    imageUrls: ImageUrls | None = None
    isActive: bool | None = None
    sortOrder: int | None = Field(default=None, ge=0)


# ── responses ─────────────────────────────────────────────────────────────────


class ProductModelOut(AppModel):
    id: uuid.UUID
    subcategoryId: uuid.UUID
    #: The brand. `vendorName` is resolved here so no client fetches the vendor
    #: list just to render a row.
    vendorId: uuid.UUID
    vendorName: str
    name: str
    #: What a technician can be sent to do with it, in catalogue order. This is
    #: what ticket intake will offer once the jobs slice reads it.
    serviceTypes: list[str]
    capacity: str | None
    warrantyMonths: int | None
    #: What this job is worth to each side, in paise.
    #:
    #: `technicianPayoutPaise` is `int | None` only because it is **withheld
    #: from a vendor** — the column itself is NOT NULL. `get_tree` sends null
    #: for a vendor principal, and a vendor calls that endpoint every time they
    #: open the intake form, so this is the field that would otherwise put the
    #: technician's rate in their network tab.
    #:
    #: `vendorPricePaise` goes to everyone: it is what the vendor is being
    #: charged, and hiding somebody's own price from them serves nothing.
    technicianPayoutPaise: int | None
    vendorPricePaise: int
    #: Ordered; the first is the thumbnail. Empty when no photo was uploaded.
    imageUrls: list[str]
    isActive: bool
    sortOrder: int


class ProductSubcategoryOut(AppModel):
    id: uuid.UUID
    categoryId: uuid.UUID
    name: str
    #: Always resolved — the subcategory's own icon, or the parent's when unset.
    #: Clients never have to walk up the tree to draw a tile.
    iconKey: str
    #: What was actually stored, so the edit form can show "inherited" rather
    #: than pre-selecting an icon the user never chose.
    ownIconKey: str | None
    isActive: bool
    sortOrder: int
    #: How many technicians are certified for this subcategory. 0 until the
    #: technicians slice lands.
    technicianCount: int = 0
    models: list[ProductModelOut] = []


class ProductCategoryOut(AppModel):
    id: uuid.UUID
    name: str
    iconKey: str
    isActive: bool
    sortOrder: int
    subcategories: list[ProductSubcategoryOut] = []
