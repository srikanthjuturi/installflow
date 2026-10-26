"""Technician request/response models.

The list is a UNION of two very different rows — a registered technician and a
phone number that has only been invited — so `TechnicianRowOut` is
discriminated on `registered`. Everything a pending invite cannot know is
nullable, and the console renders those as an em dash rather than inventing a
zero.
"""

import uuid
from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, Field, StringConstraints

from app.core.base_location import BaseLocationOut
from app.core.images import ImageUrl
from app.core.phone import Phone
from app.core.schemas import AppModel
from app.core.upi import OptionalUpiName, RequiredUpiId, UpiId, UpiName

Pincode = Annotated[str, Field(pattern=r"^[0-9]{6}$")]
#: Jobs per day. No ceiling — a technician may take as many as they will — and
#: `None` everywhere means NO LIMIT, which is a different claim from any number.
#: The floor stays: a cap of 0 means "never offer this person work", which is
#: what `status` is for.
DailyJobCap = Annotated[int, Field(ge=1)]

OnboardingMode = Literal["invite", "direct"]
RegisteredBy = Literal["self", "manager"]
TechnicianStatus = Literal["active", "inactive", "suspended"]
InviteStatus = Literal["pending", "sent", "failed", "registered", "cancelled", "expired"]
#: How this technician is paid — whose stream their money rows carry (F12).
#: Task 10 reads it at job accept and stamps the ledger from it.
TechnicianType = Literal["employee", "freelancer"]


# ── requests ──────────────────────────────────────────────────────────────────


class TechnicianCreateRequest(BaseModel):
    """Direct onboarding: the manager fills in everything."""

    fullName: str = Field(min_length=2, max_length=255)
    phone: Phone
    profileImageUrl: ImageUrl = None
    #: Optional when the caller holds exactly one region (every area manager).
    regionId: uuid.UUID | None = None
    #: Who the technician reports to. Defaults to the creator's own membership.
    managerId: uuid.UUID | None = None
    subcategoryIds: list[uuid.UUID] = Field(min_length=1)
    pincodes: list[Pincode] = Field(min_length=1, max_length=50)
    #: Optional, and normally absent: the Add screen does not ask for it. A cap
    #: invented at intake is a number nobody has a basis for yet — the
    #: technician sets their own in the app, and a manager can change it later.
    dailyJobCap: DailyJobCap | None = None
    #: Where their money goes. Optional, and normally absent for the same reason
    #: as the cap: a manager onboarding somebody usually does not have it. The
    #: technician adds it themselves on Profile → Payout account.
    upiId: UpiId = None
    #: The name on that account. Optional even with a UPI ID — a manager may
    #: not know it — and a redemption falls back to the technician's own name.
    upiName: OptionalUpiName = None
    #: How they are paid: salary ("employee") or per job ("freelancer"). Task 01
    #: defaulted every row to freelancer; the choice is now the caller's, and
    #: changing it later is refused while the technician holds an open job
    #: (`core.franchise_money.type_change_refusal`) — T1 stamps the type a job
    #: is ACCEPTED under, so a mid-job switch would restate accepted work.
    technicianType: TechnicianType = "freelancer"


class TechnicianUpdateRequest(BaseModel):
    """Omit a field to leave it alone; send a list to REPLACE it."""

    fullName: str | None = Field(default=None, min_length=2, max_length=255)
    profileImageUrl: ImageUrl = None
    regionId: uuid.UUID | None = None
    managerId: uuid.UUID | None = None
    subcategoryIds: list[uuid.UUID] | None = None
    pincodes: list[Pincode] | None = None
    dailyJobCap: DailyJobCap | None = None
    #: CLEARABLE, so the service tests presence in the payload rather than
    #: `is not None` — an explicit null means "remove the account I typed
    #: wrong", which the other test would read as "leave it alone".
    #:
    #: A manager changes it with no code: they are the check a technician's own
    #: change has to pass through (`models/upi_change.py`).
    upiId: UpiId = None
    #: Clearable the same way, and tested for presence the same way.
    upiName: OptionalUpiName = None
    status: TechnicianStatus | None = None
    #: Omitted leaves it alone; sent, it is refused with 409
    #: `TECHNICIAN_HAS_OPEN_JOBS` while the technician still holds an open job.
    #: Not editable here: re-typing the technician is Task 03's carve-out.
    technicianType: TechnicianType | None = None


class InviteCreateRequest(BaseModel):
    """Invite onboarding: a phone number and nothing else is required."""

    phone: Phone
    regionId: uuid.UUID | None = None
    managerId: uuid.UUID | None = None
    #: The coverage the manager assigns. Required: an invite without pincodes
    #: produces a technician nobody can offer a job to, and the app does not
    #: let them fix it — coverage is the manager's to decide.
    pincodes: list[Pincode] = Field(min_length=1, max_length=50)
    #: See `TechnicianCreateRequest.dailyJobCap` — normally absent.
    dailyJobCap: DailyJobCap | None = None
    #: See `TechnicianCreateRequest.technicianType` — carried so the invite row
    #: and the profile it becomes say the same thing about pay.
    technicianType: TechnicianType = "freelancer"


# ── responses ─────────────────────────────────────────────────────────────────


class SubcategoryRef(AppModel):
    id: uuid.UUID
    name: str
    categoryName: str


class OnboardingOut(AppModel):
    """The tracking half: who appointed, who registered, and when."""

    mode: OnboardingMode
    registeredBy: RegisteredBy
    appointedByName: str | None
    appointedByEmail: str | None
    #: The appointer's role AT THE TIME the console reads it. "Appointed by
    #: Priya Deshmukh" leaves out the thing that makes it meaningful — whether
    #: that was an Area Manager or a National Head.
    appointedByRole: str | None
    appointedByRoleLabel: str | None
    appointedAt: datetime
    registeredAt: datetime


class TechnicianOut(AppModel):
    registered: Literal[True] = True
    id: uuid.UUID
    membershipId: uuid.UUID
    userId: uuid.UUID
    code: str
    name: str
    phone: str
    profileImageUrl: str | None
    isActive: bool
    status: TechnicianStatus

    #: Who manages and pays this technician (F8): the franchisee their profile
    #: is stamped with. `canManage` is the caller's own answer (`franchise_scope`'s
    #: MANAGE column) — a staff member reading another franchisee's technician
    #: sees it and can change nothing, so screens can gate the buttons off it.
    franchiseeId: uuid.UUID
    franchiseeName: str
    franchiseeIsHome: bool
    technicianType: TechnicianType
    canManage: bool

    regionId: uuid.UUID
    regionName: str
    subcategories: list[SubcategoryRef]
    pincodes: list[str]

    #: Null means no limit, and both clients render it as "Unlimited".
    dailyJobCap: int | None
    #: Where their money goes. Null means they have not given one — the normal
    #: state for a new technician, rendered "—". It costs only the ability to be
    #: PAID; the ledger credits them either way.
    upiId: str | None
    #: The name on that account, when known.
    upiName: str | None = None
    #: The technician has asked for it to be changed and nobody has decided —
    #: the profile shows the request so a manager can.
    upiChangePending: bool = False
    #: Jobs held for TODAY, by slot date — the same rule the daily cap is
    #: enforced with, so the bandwidth bar and the technician's own pool can
    #: never disagree about a day.
    bwUsed: int
    #: The technician's own decision: are they taking work at all.
    acceptingWork: bool
    #: Intent AND reachability, derived at read time (`core.presence`).
    #:
    #: The console's question, not the app's. A manager assigning a job by hand
    #: needs to know whether anybody will actually see it in the next minute;
    #: the technician's own switch shows INTENT instead, because a switch that
    #: flicked to "offline" every time their socket blinked would be reporting
    #: something they did not do.
    online: bool
    rating: float | None
    #: All three NULL until the jobs slice measures them. Null means "not
    #: measured", which is why it is not 0 — see the model's note.
    jobsCompleted: int | None
    jobsCancelled: int | None
    onTimePct: int | None

    onboarding: OnboardingOut
    createdAt: datetime

    # ── Task 10 (R9): the base at a glance — the "no base" badge and the
    # source chip (*Pincode / GPS / Map / Set by admin*; `manual` reads "Set by
    # admin"). All three null together when there is no base — null ≠ ₹0.
    # COORDINATES deliberately not here: a coordinate pair is the base's whole
    # content, and lists must not hand it to every row-reader (W13).
    baseSource: str | None = None          # pincode | gps | map | manual
    baseSetAt: datetime | None = None
    baseSetBySelf: bool | None = None      # null = no base


class TechnicianInviteOut(AppModel):
    registered: Literal[False] = False
    id: uuid.UUID
    phone: str
    status: InviteStatus
    #: The franchisee the invite is joined to (F8) — the same stamp the profile
    #: will carry when this phone registers. No `franchiseeIsHome`: an invite
    #: has no money to hide, and the console does not render a field it cannot use.
    franchiseeId: uuid.UUID
    franchiseeName: str
    technicianType: TechnicianType
    regionId: uuid.UUID
    regionName: str
    #: Who sent the link — the tracking half of the invite path.
    invitedByName: str | None
    invitedByEmail: str | None
    #: The deep link. Shown so a manager can copy it when WhatsApp refuses.
    inviteLink: str
    #: Why WhatsApp refused, when it did.
    failureReason: str | None
    dailyJobCap: int | None
    #: The coverage assigned when the invite was sent.
    pincodes: list[str] = Field(default_factory=list)
    sentAt: datetime | None
    registeredAt: datetime | None
    expiresAt: datetime
    createdAt: datetime


#: One row of the Technicians screen: either half of the union.
TechnicianRowOut = TechnicianOut | TechnicianInviteOut


class TechnicianDetailOut(TechnicianOut):
    """The profile page. Same shape today; kept apart so it can grow."""

    # ── Task 10: the base, full shape — NON-NULL only for a caller who can
    # manage this technician (its franchisee admin; a home manager on a home
    # technician). A staff caller merely viewing a non-home technician gets
    # null here and the three list fields above (W13: coordinates are not
    # theirs to see). Self-set bases need no approval and no cooldown (R9);
    # the source chip and the "set by" line are the visibility.
    baseLocation: BaseLocationOut | None = None


class AppLinkOutcome(AppModel):
    """What happened to the WhatsApp that tells a technician where the app is.

    Reported, not stored. An invite keeps its delivery on its own row because
    the invite IS the record until somebody registers; a directly added
    technician's record already exists and is complete, so the message is a
    courtesy with nothing to hang a status on. A manager who wants it again
    presses "Send app link" — the same send, answered the same way.
    """

    #: `sent` means Meta ACCEPTED it, not that it arrived — there is no delivery
    #: webhook, the same caveat as an invite's `sent`.
    appLinkStatus: Literal["sent", "failed"]
    #: Meta's reason, when it refused. Null when sent.
    appLinkError: str | None = None
    #: The link itself, so a manager can hand it over another way when the
    #: send failed. The same for every technician — it names no account.
    appLink: str


class TechnicianCreatedOut(TechnicianDetailOut, AppLinkOutcome):
    """`POST /technicians`: the new profile, and whether the app link went."""


class TechnicianSessionOut(AppModel):
    """What the mobile app needs about itself right after signing in.

    Non-null on a login response is the signal that this account is a
    technician and its onboarding is complete — so the app can go straight to
    Home without a second round trip.
    """

    id: uuid.UUID
    code: str
    name: str
    phone: str
    profileImageUrl: str | None
    #: How they are paid (`models/technician.TECHNICIAN_TYPES`, Task 06 §4.6).
    #: The app branches its money screens on this — the redeem card disappears
    #: for an employee (T4), the earnings net is relabelled, and the pool offer
    #: is read with no rupee figure on the lock screen (§4.7). Sent on both
    #: sign-in and `/technicians/me` because one builder fills it; a screen
    #: that learns the type only after "me" is a screen that shows the wrong
    #: money button for one refresh.
    technicianType: Literal["employee", "freelancer"]
    regionName: str
    #: Display-only, e.g. "Priya Deshmukh · Twincore Technologies" — who
    #: onboarded them. Already carries the company, but glued to a person's
    #: name, so it cannot be used as a brand.
    onboardedBy: str
    #: Whose app this is. The company the technician works for, and its stored
    #: short code — what the app's brand tile draws instead of a fixed mark.
    #: A technician belongs to exactly one company, so unlike the console there
    #: is nothing to switch between.
    companyName: str
    companyCode: str
    subcategories: list[SubcategoryRef]
    pincodes: list[str]
    dailyJobCap: int | None
    #: What Profile → Payout account shows, and what the redeem flow will need.
    #: Null renders "—", the same dash that row has always shown; the difference
    #: is that it is now a fact about this technician rather than about the
    #: schema not having the column.
    upiId: str | None
    #: The name on that account, when known.
    upiName: str | None = None
    status: TechnicianStatus
    #: The three figures the Profile tab shows in its chrome header. Null
    #: rating means no closed jobs yet — the app renders a dash, because 0
    #: would read as the worst possible score.
    rating: float | None
    jobsCompleted: int | None
    onTimePct: int | None
    #: The technician's own availability decision — the Home screen's toggle.
    #: Sent so the app can render the switch from the SERVER's answer rather
    #: than from a local default, which is what made it reset to "online" on
    #: every restart.
    acceptingWork: bool
    #: Jobs already held for TODAY, counted by the same rule the daily cap is
    #: enforced with. Here as well as on `AvailabilityOut` so the Availability
    #: screen can say "2 of 3" on first paint rather than only after a save.
    #:
    #: NOT derivable from `/jobs/today`: that list drops closed jobs, so the
    #: screen would show a smaller number than the server refuses on.
    jobsToday: int
    # Task 14: the Home card says "set your base" until this is non-null, and
    #: Profile → Base location reads it after.
    baseLocation: BaseLocationOut | None = None


class AvailabilityRequest(AppModel):
    """The technician's own availability — the toggle and the daily cap.

    Both halves of one screen and one save. Two endpoints would mean two round
    trips and two failure modes for a single user action, and the app would have
    to reconcile a half-succeeded save.

    Both fields are OPTIONAL, and read through `model_fields_set` rather than by
    testing for None:

      * `acceptingWork` omitted must not be resent by a client that only wanted
        to change the cap — that is how a stale toggle overwrites a fresh one.
      * `dailyJobCap` **null is a real value** meaning NO LIMIT. Testing for
        None would make the cap settable and never clearable, which is the bug
        `update_technician` already carries a comment about.

    `last_seen_at` is NOT settable: reachability is observed from the live
    socket, never asserted by a client — see `app.core.presence`.
    """

    acceptingWork: bool | None = None
    #: Floor of 1, matching the DB CHECK. No ceiling — twelve was a guess, and a
    #: technician may take as many jobs a day as they are willing to.
    dailyJobCap: int | None = Field(default=None, ge=1)


class AvailabilityOut(AppModel):
    """What the screen gets back.

    `online` is returned as well as the intent because they are different
    questions and the app should never compute the AND itself — the staleness
    window lives on the server, and a second copy of it would drift.
    """

    acceptingWork: bool
    online: bool
    #: Null means no limit.
    dailyJobCap: int | None
    #: Jobs already held for TODAY, so the screen can say "3 of 5" without
    #: deriving it from `/jobs/today` — that list excludes closed jobs and would
    #: give a smaller number than the cap is actually enforced with.
    jobsToday: int


class PayoutAccountRequest(AppModel):
    """The OLD free-edit body. The route now refuses it — see
    `set_payout_account` — and survives only so an installed build that still
    sends it reads a sentence rather than a 405."""

    upiId: UpiId = None


class PayoutAccountCodeRequest(AppModel):
    """Adding a UPI ID, step one: send the code.

    The UPI ID and name ride along so a malformed one is refused BEFORE a code
    is spent on it. The code goes to the technician's own registered number,
    which is read from their account — never from this body.
    """

    upiId: RequiredUpiId
    upiName: UpiName


class PayoutAccountVerifyRequest(AppModel):
    """Adding a UPI ID, step two: the code from WhatsApp, and what to save."""

    upiId: RequiredUpiId
    upiName: UpiName
    code: str = Field(min_length=4, max_length=8)


class UpiChangeRequestIn(AppModel):
    """The technician proposing a new UPI ID. A manager decides; no code."""

    upiId: RequiredUpiId
    upiName: UpiName


class UpiRejectRequest(AppModel):
    """Refusing a change, with a reason the technician reads."""

    reason: str = Field(min_length=3, max_length=160)


class DeletionConfirmRequest(AppModel):
    """Deleting your own account, step two: the code from WhatsApp."""

    code: str = Field(min_length=4, max_length=8)


UpiChangeStatus = Literal["pending", "approved", "rejected", "cancelled"]


class UpiChangeOut(AppModel):
    """One change request — what it was, what they asked for, what became of it."""

    id: uuid.UUID
    status: UpiChangeStatus
    oldUpiId: str
    oldUpiName: str | None
    newUpiId: str
    newUpiName: str
    #: Whose bell rang: `area_manager`, `regional_head`, `national_head`, `admin`.
    reviewerRole: str
    #: "Area Manager" — for "Waiting for your Area Manager".
    reviewerLabel: str
    requestedAt: datetime
    decidedAt: datetime | None
    decidedBy: str | None
    rejectReason: str | None


class PayoutAccountOut(AppModel):
    """What Profile → Payout account renders."""

    upiId: str | None
    upiName: str | None = None
    #: The latest change request, whatever became of it. Pending shows as
    #: waiting; rejected shows its reason until the next request; approved or
    #: withdrawn shows nothing.
    change: UpiChangeOut | None = None


class UpiChangeRowOut(UpiChangeOut):
    """A change request on the franchisee's waiting/approved/rejected lists.

    The portal renders it inside a technician's name, so the row carries who it
    is about — the staff profile page reached it from the profile instead.
    """

    technicianId: uuid.UUID
    technicianName: str
    technicianCode: str


class UpiChangeCountOut(AppModel):
    """The badge on the franchisee's Payouts tab: changes waiting on them."""

    pending: int


class DistrictTechnicianCount(AppModel):
    """One district of a state, and how many technicians work in it."""

    districtId: uuid.UUID
    name: str
    technicianCount: int
    #: The district's pincodes, so a zero reads as "nobody covers these 41
    #: codes" rather than as an empty row of unknown size.
    pincodeCount: int


class DistrictBreakdownOut(AppModel):
    """Technicians per district for one state.

    Two fields exist because the geography makes the obvious arithmetic wrong,
    and a screen that presented these as a partition would be lying.

    `totalTechnicians` is NOT the sum of the districts. A pincode can sit in up
    to four districts and 1,209 real ones do, so a technician covering one is
    counted in each — correctly. The total is counted once over the state.

    `withoutDistrict` is the other direction: a pincode can have no district at
    all — `PincodeDistrict` names four the source left that way — and anybody
    whose coverage here is only such codes appears in no district column. The
    current import has filled all four, so this is 0 on today's data; it is
    reported rather than assumed away because a re-import can bring it back.
    """

    districts: list[DistrictTechnicianCount]
    totalTechnicians: int
    withoutDistrict: int


# ── moving a technician between franchisees (Task 17) ────────────────────────


class TechnicianTransferRequest(BaseModel):
    """`POST /technicians/{id}/transfer`. Deliberately has no `technicianType`
    (D3: a type change has its own guards) and no `regionId` (D5: the region
    follows the coverage)."""

    franchiseeId: uuid.UUID
    #: Required (>= 5 after stripping) unless `dryRun` — the service says which,
    #: so a preview can run before anybody has typed a word.
    reason: str | None = Field(default=None, max_length=255)
    #: None = keep what is inside the target's range. A list = EXACTLY this
    #: coverage after the move, every code of which must lie in that range.
    pincodes: (
        list[Annotated[str, StringConstraints(pattern=r"^[1-9][0-9]{5}$")]] | None
    ) = Field(default=None, max_length=500)


class TransferCoverageOut(AppModel):
    source: Literal["kept", "supplied"]
    kept: list[str]
    trimmed: list[str]
    added: list[str]
    after: list[str]
    keptCount: int
    trimmedCount: int
    addedCount: int
    regionBefore: str | None
    regionAfter: str | None
    regionChanged: bool


class TransferBlockerOut(AppModel):
    #: None for the code-less 409s ("already works for…", "inactive").
    code: str | None
    message: str
    openJobs: int | None = None
    redeemablePaise: int | None = None
    redemptionCode: str | None = None


class TechnicianTransferRowOut(AppModel):
    id: uuid.UUID
    at: datetime
    technicianId: uuid.UUID
    fromFranchiseeId: uuid.UUID
    fromFranchiseeName: str
    toFranchiseeId: uuid.UUID
    toFranchiseeName: str
    technicianType: TechnicianType
    reason: str
    byUserId: uuid.UUID
    byName: str
    #: Derived from the two stored arrays, never stored twice.
    kept: list[str]
    trimmed: list[str]
    added: list[str]


class TechnicianTransferOut(AppModel):
    dryRun: bool
    technicianId: uuid.UUID
    technicianCode: str
    technicianName: str
    technicianType: TechnicianType
    fromFranchiseeId: uuid.UUID
    fromFranchiseeName: str
    fromFranchiseeIsHome: bool
    toFranchiseeId: uuid.UUID
    toFranchiseeName: str
    toFranchiseeIsHome: bool
    coverage: TransferCoverageOut
    blockers: list[TransferBlockerOut]
    warnings: list[str]
    #: No blockers. On a dry run this is the whole answer; on an apply it is
    #: always true (a blocker is raised as an error instead).
    canTransfer: bool
    #: Null on a dry run.
    transfer: TechnicianTransferRowOut | None
