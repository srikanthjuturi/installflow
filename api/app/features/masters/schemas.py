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

import datetime
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

#: Matches `product_model_serials.serial` and `tickets.serial_number`, which are
#: both String(64). The three have to agree: a serial too long to store on a
#: ticket is one intake could never match anyway.
MAX_SERIAL_LENGTH = 64

#: How many serials one manual POST may carry. The box accepts a pasted block,
#: so this is not "one at a time" — it is the point past which somebody should
#: be using the spreadsheet importer, which streams and reports per-row rejects
#: instead of failing the whole request on the first bad line.
MAX_SERIALS_PER_REQUEST = 500


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


class NodePortalUpdateRequest(BaseModel):
    """What a VENDOR may change on a category it created.

    `NodeUpdateRequest` less `sortOrder`: sibling order is how the whole
    company's tree reads, and where a category sits among other brands' is not
    one vendor's call. No `parentId` either, for the staff reason — a node
    cannot move. Which categories count as the vendor's own is decided by
    `service._load_own_node`, never by anything in this body.
    """

    name: Name64 | None = None
    iconKey: IconKey | None = None
    isLeaf: bool | None = None
    parameters: ParameterTemplate | None = None
    isActive: bool | None = None


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
    #: half-known model may leave out: a ticket stamps both at intake, so a
    #: model saved without them is one no ticket could ever be raised against.
    #: Better to refuse the save than to accept a row that fails on somebody
    #: else's screen a week later.
    #:
    #: Required OF A STAFF CALLER, which is the only caller this schema serves —
    #: `POST /masters/nodes/{id}/models` carries `require_staff_principal`. A
    #: vendor submits through `ProductSubmitRequest`, which has no price field
    #: at all, and their product is priced at approval instead. Keeping them
    #: required here is what stops a staff caller silently creating a pending,
    #: unpriced row by omitting two keys.
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
    #: `technicianPayoutPaise` is null for **two** reasons now, and they are
    #: indistinguishable on the wire on purpose. It is **withheld from a
    #: vendor** — `get_tree` masks it, and a vendor calls that endpoint every
    #: time they open the intake form, so this is the field that would otherwise
    #: put the technician's rate in their network tab. And it is genuinely
    #: **unset** until a National Head approves the product. Both mean "no
    #: figure for you", so nothing has to tell them apart.
    #:
    #: `vendorPricePaise` is optional for the SECOND reason only. It is never
    #: masked — it is what the vendor is charged, and hiding somebody's own
    #: price from them serves nothing — but a product waiting for approval has
    #: no price yet. It was `int` until vendors could submit products, which
    #: would have made this whole response 500 the first time a pending one
    #: existed.
    #:
    #: A client rendering either must omit the line rather than print a dash:
    #: "— to technician" reads as a figure that failed to load.
    technicianPayoutPaise: int | None
    vendorPricePaise: int | None
    #: Ordered; the first is the thumbnail. Empty when no photo was uploaded.
    imageUrls: list[str]
    isActive: bool
    #: One of `core.product_tree.APPROVAL_STATES`. The vendor's own catalogue
    #: screen badges on it, and it is the reason a product they can see may not
    #: be one they can raise a ticket against.
    approvalStatus: str
    #: Why it was refused, so the vendor reads it where the product is and not
    #: only in their bell. Null unless `approvalStatus == "rejected"`.
    rejectionReason: str | None
    sortOrder: int
    #: How many serial numbers this model covers.
    #:
    #: **Zero is a state, not an empty list.** Ticket intake checks a typed
    #: serial against this model only when at least one is loaded, so zero means
    #: "not checked" — which is exactly the thing somebody maintaining the
    #: catalogue needs to see without opening the panel. A live COUNT, never a
    #: stored counter; see `_serial_counts`.
    serialCount: int = 0


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
    #: Whether the CALLING VENDOR created this category — the ones its portal
    #: may edit. Always false for staff, who edit every category through
    #: `masters.edit` and have no use for it.
    isOwn: bool = False
    children: list["ProductNodeOut"] = []
    models: list[ProductModelOut] = []


ProductNodeOut.model_rebuild()


# ── a vendor's own submissions ────────────────────────────────────────────────


class ProductSubmitRequest(BaseModel):
    """What a VENDOR submits. No brand, no prices, no pause switch.

    All three are absent by construction rather than by validation — there is no
    field for them to arrive in, so no branch has to remember to ignore one.

      * **`vendorId`** — the caller's own vendor is the only possible answer,
        and the service reads it off the principal. An id in a body is an
        assertion, not a fact; this is the same reason `_resolve_product` will
        not take one either.
      * **both prices** — a National Head types them at approval. A vendor who
        could send a number would be quoting their own rate, and
        `technicianPayoutPaise` is withheld from them everywhere else in this
        codebase.
      * **`isActive`** — pausing a catalogue row is how ops withdraw a product.
        A second "not available" switch in the hands of the submitter is two
        answers to one question; `approval_status` is the axis that belongs to
        them, and they move it by submitting.
    """

    name: Name120
    serviceTypes: ServiceTypes = Field(
        default_factory=lambda: list(DEFAULT_SERVICE_TYPES)
    )
    capacity: Capacity = None
    warrantyMonths: WarrantyMonths = None
    notes: Notes = None
    parameters: Parameters = Field(default_factory=list)
    imageUrls: ImageUrls = Field(default_factory=list)


class ProductResubmitRequest(BaseModel):
    """The same fields, all optional. Same three absences, same reasons.

    An APPROVED product stays approved when edited, keeping both prices. A
    REJECTED one that actually changes goes back to `pending` — see
    `service.update_own_model`. Either way the prices are LEFT ALONE: a vendor
    has no field to send one in.
    """

    name: Name120 | None = None
    serviceTypes: ServiceTypes | None = None
    capacity: Capacity = None
    warrantyMonths: WarrantyMonths = None
    notes: Notes = None
    parameters: Parameters | None = None
    imageUrls: ImageUrls | None = None


# ── the approvals queue ───────────────────────────────────────────────────────


class ApprovalRequest(BaseModel):
    """Both prices, typed by the approver. The vendor submits neither.

    `PricePaise` carries the `gt=0` and the ₹10,00,000 ceiling that catch the
    mistake this pair invites — rupees typed into a paise box.
    """

    technicianPayoutPaise: PricePaise
    vendorPricePaise: PricePaise


class RejectionRequest(BaseModel):
    """Why, in words the vendor will read.

    Required. A rejection with no reason is one nobody can act on, and the
    vendor's only remaining move is to resubmit the same row and wait again.

    255 characters because this string is quoted verbatim into
    `notifications.detail`, which is `String(255)` — bound it where it is
    written, not where it is copied.
    """

    reason: Annotated[str, Field(min_length=3, max_length=255)]


class ProductApprovalOut(AppModel):
    """One row of the approvals queue.

    FLAT, not a `ProductNodeOut`: the queue is a table of products somebody has
    to decide about, not a catalogue to browse. `nodePath` carries the
    breadcrumb so a reviewer sees where the product lands without opening the
    tree.
    """

    id: uuid.UUID
    nodeId: uuid.UUID
    #: Root first, including the node's own name — "Electronics › TV › OLED".
    nodePath: list[str]
    vendorId: uuid.UUID
    vendorName: str
    name: str
    serviceTypes: list[str]
    capacity: str | None
    warrantyMonths: int | None
    notes: str | None
    parameters: list[ParameterOut]
    imageUrls: list[str]
    approvalStatus: str
    #: Both prices, and NOT masked — unlike `ProductModelOut`. The rank floor on
    #: this endpoint means the reader is a National Head or an Admin and can
    #: never be a vendor.
    #:
    #: Null on a first submission. They carry the LAST AGREED figures on a row
    #: that was once approved and is back in review — which a vendor's edit no
    #: longer causes (an approved product stays approved), so today that is
    #: only rows sent back before that changed. Kept so the reviewer confirms
    #: rather than re-prices from scratch.
    technicianPayoutPaise: int | None
    vendorPricePaise: int | None
    rejectionReason: str | None
    #: How many technicians could actually take a job on this node — certified
    #: here or on any ancestor. Shown because a vendor may file a product under
    #: a brand-new sub-category nobody is certified on, and a job raised there
    #: escalates immediately with nothing on any screen saying why. A zero here
    #: turns that silent failure into something the approver sees first.
    technicianCount: int = 0
    submittedAt: datetime.datetime | None
    decidedAt: datetime.datetime | None
    #: Null on a product that never went through approval — every product that
    #: predates this feature. Both clients render it as "—".
    decidedByName: str | None


# ── model-wise serial numbers ─────────────────────────────────────────────────
#
# The serials a model is known to cover, checked at ticket intake. An EMPTY list
# means unchecked, not "nothing matches" — see `ProductModelSerial` for why that
# is what makes this shippable against a live catalogue.


def _clean_serials(values: list[str]) -> list[str]:
    """Trim, drop blanks, and de-duplicate case-insensitively.

    Done here rather than in the service because the manual box accepts a pasted
    block, and a paste out of a spreadsheet column arrives with trailing spaces
    and usually a blank last line. Rejecting the whole request for that would be
    theatre — the user cannot see the whitespace they are being refused for.

    Case-insensitive de-duplication matches the unique index, so a paste
    containing both `AB-1` and `ab-1` is one serial rather than an insert that
    fails halfway.
    """
    cleaned: list[str] = []
    seen: set[str] = set()
    for raw in values:
        value = (raw or "").strip()
        if not value:
            continue
        if len(value) > MAX_SERIAL_LENGTH:
            raise ValueError(
                f"{value[:20]}… is longer than {MAX_SERIAL_LENGTH} characters"
            )
        key = value.lower()
        if key in seen:
            continue
        seen.add(key)
        cleaned.append(value)
    if not cleaned:
        raise ValueError("Enter at least one serial number")
    if len(cleaned) > MAX_SERIALS_PER_REQUEST:
        raise ValueError(
            f"Up to {MAX_SERIALS_PER_REQUEST} serials at a time — "
            "use the spreadsheet import for more"
        )
    return cleaned


class SerialAddRequest(BaseModel):
    """One or many serials for a model. The manual half of the requirement."""

    serials: Annotated[list[str], AfterValidator(_clean_serials)]


class ProductModelSerialOut(AppModel):
    id: uuid.UUID
    serial: str
    createdAt: datetime.datetime


class SerialAddResult(AppModel):
    """What a manual add actually did.

    `duplicates` is not an error. Re-pasting a block that overlaps what is
    already loaded is the normal way somebody tops a model up, so the added ones
    land and the rest are reported rather than refused.
    """

    added: int
    duplicates: int
    total: int


class SerialReject(AppModel):
    """One row the importer could not take, and why."""

    row: int | None = None
    serial: str | None = None
    reason: str


class SerialImportReport(AppModel):
    """The same two-pass shape as the geography importer's `ImportReport`.

    A dry run writes nothing and returns exactly what the commit would do, so
    the numbers the console shows are the server's own count rather than a guess
    made in a browser that never parsed the file.
    """

    dryRun: bool
    rowsRead: int
    added: int
    #: Present more than once in the FILE. Counted separately from
    #: `alreadyPresent` because they mean different things to whoever prepared
    #: the sheet: one is a mistake in it, the other is an overlap with what is
    #: already loaded and is expected on a top-up.
    duplicatesInFile: int
    alreadyPresent: int
    rejected: int = 0
    #: Capped; `rejected` carries the true total.
    rejects: list[SerialReject] = Field(default_factory=list)
    #: What the model holds once this import lands — the figure the console
    #: shows on the model, and on a dry run the figure it WOULD show.
    total: int


class SerialMatchOut(AppModel):
    """The product a serial number belongs to — what the intake form fills from.

    Answers the vendor's real starting point. They are standing in front of a
    unit with a number printed on it; the category chain and the model are
    things they have to work out from it, and the master already knows.

    Deliberately carries the NODE as well as the model. The intake form's
    category drill-down is a chain of node ids, so a match that named only the
    model would fill the last box and leave the four above it empty.
    """

    modelId: uuid.UUID
    modelName: str
    nodeId: uuid.UUID
    #: Root first, INCLUDING the node's own name — the breadcrumb the form shows
    #: back so the vendor can see what it filled in and disagree with it.
    nodePath: list[str]
    #: What the model supports, so the form can narrow its service-type box
    #: without waiting for a second read of the tree.
    serviceTypes: list[str]
    #: As STORED, not as typed. The form writes this back into the box, so a
    #: serial entered in the wrong case is corrected in front of the user rather
    #: than silently at the server.
    serial: str


class SerialUpdateRequest(BaseModel):
    """Correct one serial in place.

    A real update rather than remove-and-re-add, which is what "edit a serial"
    would otherwise mean: the row keeps its `created_at` and `created_by`, so a
    corrected typo still shows who loaded that unit and when. Delete-then-add
    would silently restamp both to whoever fixed the spelling.
    """

    serial: Annotated[str, Field(min_length=1, max_length=MAX_SERIAL_LENGTH)]
