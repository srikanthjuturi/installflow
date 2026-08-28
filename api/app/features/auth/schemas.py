"""Auth request/response models (camelCase on the wire, matching the frontend)."""

import uuid

from pydantic import BaseModel, EmailStr, Field

from app.core.images import ImageUrl
from app.core.phone import Phone
from app.core.schemas import AppModel, BoundedPassword
from app.features.technicians.schemas import TechnicianSessionOut


# ─── Requests ──────────────────────────────────────────────────────────────
class LoginRequest(BaseModel):
    email: EmailStr
    #: Bounded, and generously — this is a DoS guard, not a policy. An unbounded
    #: string here meant an unauthenticated caller could 500 the API with a long
    #: password; `verify_password` now returns False for one, and this stops the
    #: pathological case reaching it at all.
    password: str = Field(min_length=1, max_length=1024)


class GoogleLoginRequest(BaseModel):
    """The `credential` from Google Identity Services — an ID token, not a code.

    Both the "Continue with Google" button and One Tap produce this, which is
    why there is one endpoint rather than two.

    Bounded because an unbounded string is a cheap denial-of-service against the
    JWT parser. A real Google ID token is around a kilobyte.
    """

    credential: str = Field(min_length=1, max_length=4096)


class OtpRequestRequest(BaseModel):
    phone: Phone


class OtpVerifyRequest(BaseModel):
    phone: Phone
    code: str = Field(min_length=4, max_length=8)


class PasswordResetRequestRequest(BaseModel):
    email: EmailStr


class PasswordResetVerifyRequest(BaseModel):
    email: EmailStr
    #: The same bounds `OtpVerifyRequest` uses — it is the same six digits out of
    #: the same generator, and the two must not disagree about what is a code.
    code: str = Field(min_length=4, max_length=8)


class PasswordResetConfirmRequest(BaseModel):
    #: Bounded for the same reason `GoogleLoginRequest.credential` is: an
    #: unbounded string on an unauthenticated endpoint is a cheap denial of
    #: service against the JWT parser.
    resetToken: str = Field(min_length=1, max_length=4096)
    #: Byte-bounded and floored at 8 — the same rule as
    #: `ChangePasswordRequest.newPassword`, because it is the same act.
    newPassword: BoundedPassword = Field(min_length=8)


class SwitchCompanyRequest(BaseModel):
    companyId: uuid.UUID


class RefreshRequest(BaseModel):
    refreshToken: str


class MeUpdateRequest(BaseModel):
    """The little a signed-in user may change about themselves.

    Name, role, territory and company are somebody else's decision — a manager's
    — so they are not here. A profile photo is nobody else's, which is why this
    endpoint exists at all: both clients could crop one and neither had anywhere
    to put it. Send `null` to remove the photo.
    """

    profileImageUrl: ImageUrl = None


class LogoutRequest(BaseModel):
    refreshToken: str | None = None


# ─── Response fragments ────────────────────────────────────────────────────
class UserOut(AppModel):
    id: uuid.UUID
    #: Null for a technician — they are identified by phone and sign in with a
    #: one-time code, so most never have a work email.
    email: str | None
    fullName: str | None
    phone: str | None
    role: str
    roleLabel: str
    profileImageUrl: str | None
    isSuperadmin: bool


class MembershipOut(AppModel):
    companyId: uuid.UUID
    companyName: str
    companySlug: str
    role: str
    isActive: bool


class CompanyOut(AppModel):
    id: uuid.UUID
    name: str
    slug: str
    email: str
    phone: str | None
    isActive: bool


# ─── Response payloads ─────────────────────────────────────────────────────
class LoginResponse(AppModel):
    user: UserOut
    memberships: list[MembershipOut]
    activeCompanyId: uuid.UUID | None
    accessToken: str
    refreshToken: str
    tokenType: str = "bearer"
    #: Non-null exactly when this account is a technician with a complete
    #: profile. That is the mobile app's "go straight to Home" signal, so it
    #: does not need a second round trip to find out.
    technicianProfile: TechnicianSessionOut | None = None


class OtpRequestResponse(AppModel):
    sent: bool
    #: 'whatsapp' | 'email' | 'log'. Which channel took it.
    channel: str
    expiresInSeconds: int
    resendInSeconds: int
    #: Development only, and only when OTP_DEV_ECHO is on — startup refuses to
    #: boot with it enabled in production.
    devCode: str | None = None


class PasswordResetVerifyResponse(AppModel):
    """The ticket that stands between a right code and a new password.

    Carries no identity of its own that a client could read — the user id is
    inside a signed token, so the browser holding it learns nothing it did not
    already type.
    """

    resetToken: str
    expiresInSeconds: int


class SwitchCompanyResponse(AppModel):
    accessToken: str
    activeCompanyId: uuid.UUID


class RefreshResponse(AppModel):
    accessToken: str
    refreshToken: str
    tokenType: str = "bearer"


class RegionOut(AppModel):
    id: uuid.UUID
    code: str
    name: str


class MeStateOut(AppModel):
    """A state the caller covers. Area managers only — everyone else is empty."""

    id: uuid.UUID
    name: str
    regionId: uuid.UUID


class MeVendorOut(AppModel):
    """The vendor a portal account acts for.

    This — not `GET /vendors/options` — is where the portal's fixed brand comes
    from. That endpoint is gated on `masters.view` and, for a staff caller,
    lists every brand in the company; a vendor should not have to ask a
    company-wide question to learn its own name.
    """

    id: uuid.UUID
    name: str
    #: Which entry screens the portal offers this vendor.
    intakeChannels: list[str]


class ChangePasswordRequest(BaseModel):
    #: Not byte-bounded: whatever they type is checked against the stored hash,
    #: and `verify_password` answers False for anything bcrypt cannot hash.
    currentPassword: str = Field(min_length=1, max_length=1024)
    #: Byte-bounded, because this one gets HASHED. The old `max_length=128` was
    #: a lie: bcrypt refuses anything over 72 bytes, so a 100-character password
    #: passed validation and then 500'd inside hash_password.
    newPassword: BoundedPassword = Field(min_length=8)


class MeResponse(AppModel):
    user: UserOut
    activeCompany: CompanyOut | None
    role: str
    features: list[str]
    memberships: list[MembershipOut]
    # The caller's OWN territory — what they cover, and what they may hand out.
    #
    # An area manager's states, not his pincodes: he covers every code inside
    # them, which is thousands, and the console searches `/geo/pincodes` when it
    # needs them rather than being handed the list on every page load.
    regions: list[RegionOut]
    states: list[MeStateOut]
    scopeLabel: str
    #: Set for the two portal roles, null for everyone else.
    vendor: MeVendorOut | None = None
