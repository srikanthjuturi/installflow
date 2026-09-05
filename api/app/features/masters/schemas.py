"""Product master request/response models.

Three validators carry real weight here:

`IconKey` is checked against the closed catalogue in `app.core.icons`. An icon
the mobile app has not traced would render as a blank square on a technician's
phone, so an unknown key is a 422 rather than something the client falls back on.

`ImageUrls` accepts http(s) only and explicitly rejects `data:` — see
`app.core.images` for why, which is the same reason every other slice that takes
an image URL uses that module's `ImageUrl`.

`Parameters` is where the CHECK constraint stops. Postgres can say "an array of
at most twenty things"; it cannot walk the entries without a set-returning
function, which it refuses inside a constraint. So entry shape, name length and
case-insensitive uniqueness are enforced here, exactly as `MAX_IMAGES` is. Only
a PRODUCT has them — see `ProductModelOut.parameters`.

## The tree is recursive on the wire too

`ProductNodeOut.children` nests to `MAX_NODE_DEPTH`. It replaces the old
`ProductCategoryOut` / `ProductSubcategoryOut` pair, which encoded "exactly two
levels" in the response shape itself.
"""

import uuid
from typing import Annotated

from pydantic import AfterValidator, BaseModel, Field

from app.core.icons import PRODUCT_ICON_KEYS
from app.core.images import check_image_url
from app.core.product_tree import MAX_PARAMETERS
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


class ParameterIn(BaseModel):
    """One spec — `RAM` / `8 GB`. Free text on both sides, deliberately.

    Typing the value would mean a `kind` column, a units vocabulary and a
    migration every time somebody needs a new one. A catalogue spec is read by a
    person, never computed with; "8 GB" and "2 years" want the same box.
    """

    name: Annotated[str, Field(min_length=1, max_length=64)]
    value: Annotated[str, Field(default="", max_length=255)]


def _clean_parameters(
    values: list[ParameterIn], *, require_value: bool
) -> list[dict[str, str]]:
    """Trim, drop blanks, refuse duplicate names, and bound the list.

    Duplicates are refused rather than de-duplicated: two rows called `RAM` on
    one product is a typo, and silently keeping the last one hides it until
    somebody notices the value they typed is not the value on screen. Matching
    is case-insensitive, because `RAM` and `ram` read as one spec to everybody
    except a dictionary.

    `require_value` is the difference between the two surfaces. On a
    SUB-CATEGORY the list is a template — the names are the point and a value is
    an optional default. On a PRODUCT it is the answer, so a named field with no
    value is a row somebody started and abandoned, which would reach a
    technician as a blank line.
    """
    cleaned: list[dict[str, str]] = []
    seen: set[str] = set()
    for entry in values:
        name = entry.name.strip()
        if not name:
            continue
        key = name.casefold()
        if key in seen:
            raise ValueError(f"{name} is listed twice — each field needs its own name")
        seen.add(key)
        value = entry.value.strip()
        if require_value and not value:
            raise ValueError(f"Give {name} a value, or remove the field")
        cleaned.append({"name": name, "value": value})
    if len(cleaned) > MAX_PARAMETERS:
        raise ValueError(f"Up to {MAX_PARAMETERS} fields")
    return cleaned


def _check_template(values: list[ParameterIn]) -> list[dict[str, str]]:
    return _clean_parameters(values, require_value=False)


def _check_parameters(values: list[ParameterIn]) -> list[dict[str, str]]:
    return _clean_parameters(values, require_value=True)


IconKey = Annotated[str, Field(max_length=32), AfterValidator(_check_icon)]
ImageUrls = Annotated[list[str], AfterValidator(_check_image_urls)]
ServiceTypes = Annotated[list[str], AfterValidator(_check_service_types)]
#: A PRODUCT's fields. Every one needs a value.
Parameters = Annotated[list[ParameterIn], AfterValidator(_check_parameters)]
#: A LAST SUB-CATEGORY's field template. Names matter; values are defaults.
ParameterTemplate = Annotated[list[ParameterIn], AfterValidator(_check_template)]

Name64 = Annotated[str, Field(min_length=2, max_length=64)]
Name120 = Annotated[str, Field(min_length=1, max_length=120)]
#: Prose about a product — a quirk, a handling note, what to check before
#: leaving. Not a parameter: it has no name to inherit under.
Notes = Annotated[str | None, Field(default=None, max_length=2000)]


# ── requests ──────────────────────────────────────────────────────────────────


class NodeCreateRequest(BaseModel):
    """A category at any level. `parentId` decides which.

    Omit `parentId` for a root. It is accepted only here: an existing node
    cannot be re-parented, because `ancestor_ids` is derived and moving a node
    means rewriting its whole subtree — see `models/product.py`.
    """

    name: Name64
    #: None = a root category. Validated against the caller's own company in the
    #: service — an id in a body is an assertion, not a fact.
    parentId: uuid.UUID | None = None
    #: Omit to inherit the nearest ancestor's icon.
    iconKey: IconKey | None = None
    #: "This is the last sub-category" — tick it and this node takes PRODUCTS
    #: instead of more sub-categories. Refused on a root: a product always sits
    #: at least one level down.
    isLeaf: bool = False
    #: The field template every product under it starts from. Only accepted on a
    #: leaf — a node with no products has nothing to template.
    parameters: ParameterTemplate = Field(default_factory=list)
    isActive: bool = True


class NodeUpdateRequest(BaseModel):
    """Note the absence of `parentId`. A node cannot move — by design."""

    name: Name64 | None = None
    iconKey: IconKey | None = None
    #: Switchable, but not while it would strand anything: it cannot be turned
    #: OFF while the node holds products, nor ON while it holds sub-categories.
    isLeaf: bool | None = None
    #: Sent whole; an empty list clears the template. Editing it changes what the
    #: NEXT product starts from and leaves existing ones alone.
    parameters: ParameterTemplate | None = None
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
    notes: Notes = None
    #: Free-text specs — `RAM` / `8 GB`. Seeded from the last sub-category's
    #: template when the form opens, and every one needs a VALUE here: this is
    #: the answer, not the question.
    parameters: Parameters = Field(default_factory=list)
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
    notes: Notes = None
    #: Sent whole; an empty list clears every field.
    parameters: Parameters | None = None
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


class ParameterOut(AppModel):
    name: str
    value: str


class ProductModelOut(AppModel):
    id: uuid.UUID
    #: The catalogue node this product sits under.
    nodeId: uuid.UUID
    #: The brand. `vendorName` is resolved here so no client fetches the vendor
    #: list just to render a row.
    vendorId: uuid.UUID
    vendorName: str
    name: str
    #: What a technician can be sent to do with it, in catalogue order.
    serviceTypes: list[str]
    capacity: str | None
    warrantyMonths: int | None
    notes: str | None
    #: Free-text specs, in the order they were entered.
    parameters: list[ParameterOut]
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


class ProductNodeOut(AppModel):
    """One catalogue level, with everything under it."""

    id: uuid.UUID
    parentId: uuid.UUID | None
    name: str
    #: Distance from the root — 0 for a root. The console indents on it.
    depth: int
    #: The breadcrumb, root first, INCLUDING this node's own name. What every
    #: flattened list labels itself with, so *Sony › 32 inch* and *LG › 32 inch*
    #: are distinguishable in a dropdown.
    path: list[str]
    #: Always resolved — this node's own icon, or the nearest ancestor's, or the
    #: default. Clients never walk up the tree to draw a tile.
    iconKey: str
    #: What was actually stored, so the edit form can show "inherited" rather
    #: than pre-selecting an icon the user never chose.
    ownIconKey: str | None
    #: Whether products hang off THIS node. The console draws "Add product" on a
    #: leaf and "Add sub-category" on everything else, so an empty node still
    #: says which it is waiting for.
    isLeaf: bool
    #: The field template new products under this node start from. Always empty
    #: on a non-leaf.
    parameters: list[ParameterOut] = []
    isActive: bool
    sortOrder: int
    #: Technicians who could take a job here — certified on this node OR on any
    #: ancestor of it, counted once each. Not "certified exactly here": a
    #: technician certified on *TV* really can be sent an *Android TV* job, and a
    #: zero on a node somebody covers would send a manager hunting.
    technicianCount: int = 0
    #: Whether this node overrides any operating rule. Just a badge — the values
    #: themselves live on Configuration → Rules Config, scoped to the node.
    #:
    #: A node carries no `parameters` of its own: specs live on the PRODUCT, so
    #: there is nothing here to inherit from and no precedence rule to state.
    hasRuleOverrides: bool = False
    children: list["ProductNodeOut"] = []
    models: list[ProductModelOut] = []


ProductNodeOut.model_rebuild()
