"""ORM models. Importing this package registers every table on Base.metadata."""

from app.models.company import Company
from app.models.feature import CompanyRoleFeature, Feature, RoleFeatureDefault
from app.models.membership import Membership
from app.models.otp import OtpCode
from app.models.product import ProductCategory, ProductModel, ProductSubcategory
from app.models.role import Role
from app.models.sequence import CompanySequence
from app.models.technician import (
    TechnicianInvite,
    TechnicianInvitePincode,
    TechnicianPincode,
    TechnicianProfile,
    TechnicianSubcategory,
)
from app.models.territory import (
    District,
    MembershipRegion,
    MembershipState,
    Pincode,
    PincodeDistrict,
    Region,
    State,
)
from app.models.ticket import Ticket
from app.models.notification import Notification, NotificationRead
from app.models.push_token import PushToken
from app.models.ticket_event import TicketEvent
from app.models.token import RefreshToken
from app.models.user import User
from app.models.vendor import Vendor
from app.models.web_push_subscription import WebPushSubscription

__all__ = [
    "Company",
    "CompanyRoleFeature",
    "CompanySequence",
    "District",
    "Feature",
    "Membership",
    "MembershipRegion",
    "MembershipState",
    "OtpCode",
    "Pincode",
    "PincodeDistrict",
    "ProductCategory",
    "ProductModel",
    "ProductSubcategory",
    "RefreshToken",
    "Region",
    "Role",
    "State",
    "RoleFeatureDefault",
    "TechnicianInvite",
    "TechnicianInvitePincode",
    "TechnicianPincode",
    "TechnicianProfile",
    "TechnicianSubcategory",
    "Ticket",
    "Notification",
    "NotificationRead",
    "PushToken",
    "TicketEvent",
    "User",
    "Vendor",
    "WebPushSubscription",
]
