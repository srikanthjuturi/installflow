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


IconKey = Annotated[str, Field(max_length=32), AfterValidator(_check_icon)]
ImageUrls = Annotated[list[str], AfterValidator(_check_image_urls)]

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
    capacity: Capacity = None
    warrantyMonths: WarrantyMonths = None
    imageUrls: ImageUrls = Field(default_factory=list)
    isActive: bool = True


class ModelUpdateRequest(BaseModel):
    name: Name120 | None = None
    #: Re-branding is allowed; clearing the brand is not, so this is optional
    #: rather than clearable.
    vendorId: uuid.UUID | None = None
    capacity: Capacity = None
    warrantyMonths: WarrantyMonths = None
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
    capacity: str | None
    warrantyMonths: int | None
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
