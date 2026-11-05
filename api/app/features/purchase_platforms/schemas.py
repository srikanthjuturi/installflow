"""Purchase platform master — request/response models.

A short list, so the shapes are short too: a name and a flag, in and out. See
`models/purchase_platform.py` for why the table exists and `router.py` for who
may read and write it.
"""

import uuid
from typing import Annotated

from pydantic import StringConstraints

from app.core.schemas import AppModel
from app.models.purchase_platform import MAX_PLATFORM_NAME

#: Trimmed before the length check, so a name of pure spaces is refused rather
#: than stored as an empty one nobody can find on a list.
PlatformName = Annotated[
    str,
    StringConstraints(
        strip_whitespace=True, min_length=1, max_length=MAX_PLATFORM_NAME
    ),
]


class PurchasePlatformOut(AppModel):
    id: uuid.UUID
    name: str
    isActive: bool


class PurchasePlatformCreateRequest(AppModel):
    name: PlatformName


class PurchasePlatformUpdateRequest(AppModel):
    """Rename, or flip `isActive` — both optional, and independent.

    Omitting a field means "leave it alone"; `PATCH`-shaped rather than a full
    replace, the same doctrine `VendorUpdateRequest`'s clearable fields use.
    """

    name: PlatformName | None = None
    isActive: bool | None = None
