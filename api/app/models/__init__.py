"""ORM models. Importing this package registers every table on Base.metadata."""

from app.models.company import Company
from app.models.company_rules import CompanyRules
from app.models.feature import CompanyRoleFeature, Feature, RoleFeatureDefault
from app.models.ledger import LedgerEntry
from app.models.membership import Membership
from app.models.otp import OtpCode
from app.models.product import ProductModel, ProductNode
from app.models.product_node_rules import ProductNodeRules
from app.models.role import Role
from app.models.sequence import CompanySequence
from app.models.technician import (
    TechnicianInvite,
    TechnicianInvitePincode,
    TechnicianNode,
    TechnicianPincode,
    TechnicianProfile,
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
from app.models.vendor_address_search import VendorAddressSearch
from app.models.web_push_subscription import WebPushSubscription

__all__ = [
    "Company",
    "CompanyRoleFeature",
    "CompanyRules",
    "CompanySequence",
    "District",
    "Feature",
    "LedgerEntry",
    "Membership",
    "MembershipRegion",
    "MembershipState",
    "OtpCode",
    "Pincode",
    "PincodeDistrict",
    "ProductModel",
    "ProductNode",
    "ProductNodeRules",
    "RefreshToken",
    "Region",
    "Role",
    "State",
    "RoleFeatureDefault",
    "TechnicianInvite",
    "TechnicianInvitePincode",
    "TechnicianNode",
    "TechnicianPincode",
    "TechnicianProfile",
    "Ticket",
    "Notification",
    "NotificationRead",
    "PushToken",
    "TicketEvent",
    "User",
    "Vendor",
    "VendorAddressSearch",
    "WebPushSubscription",
]
