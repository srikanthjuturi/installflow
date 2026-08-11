"""Product master request/response models.

Two validators carry real weight here:

`IconKey` is checked against the closed catalogue in `app.core.icons`. An icon
the mobile app has not traced would render as a blank square on a technician's
phone, so an unknown key is a 422 rather than something the client falls back on.

`ImageUrl` accepts http(s) only and explicitly rejects `data:`. Both consoles can
already produce a base64 data URL from a crop, and letting one through would put
tens of kilobytes into every list response and turn the eventual move to blob
storage into a data migration instead of a service change.
"""

import uuid
from typing import Annotated

from pydantic import AfterValidator, BaseModel, Field

from app.core.icons import PRODUCT_ICON_KEYS
from app.core.schemas import AppModel

MAX_IMAGE_URL = 2048


def _check_icon(value: str) -> str:
    if value not in PRODUCT_ICON_KEYS:
        raise ValueError(
            f"Unknown icon. Choose one of: {', '.join(PRODUCT_ICON_KEYS)}"
        )
    return value


def _check_image_url(value: str | None) -> str | None:
    if value is None:
        return None
    url = value.strip()
    if not url:
        return None
    if len(url) > MAX_IMAGE_URL:
        raise ValueError("Image URL is too long")
    if not url.lower().startswith(("http://", "https://")):
        raise ValueError(
            "Image URL must start with http:// or https:// — "
            "inline image data is not accepted"
        )
    return url


IconKey = Annotated[str, Field(max_length=32), AfterValidator(_check_icon)]
ImageUrl = Annotated[str | None, AfterValidator(_check_image_url)]

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
    """Only the name is required.

    A model is worth recording as soon as it has one; ops fill the rest in as
    they learn it, and a half-known model still lets a ticket reference it.
    """

    name: Name120
    capacity: Capacity = None
    warrantyMonths: WarrantyMonths = None
    imageUrl: ImageUrl = None
    isActive: bool = True


class ModelUpdateRequest(BaseModel):
    name: Name120 | None = None
    capacity: Capacity = None
    warrantyMonths: WarrantyMonths = None
    imageUrl: ImageUrl = None
    isActive: bool | None = None
    sortOrder: int | None = Field(default=None, ge=0)


# ── responses ─────────────────────────────────────────────────────────────────


class ProductModelOut(AppModel):
    id: uuid.UUID
    subcategoryId: uuid.UUID
    name: str
    capacity: str | None
    warrantyMonths: int | None
    imageUrl: str | None
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
