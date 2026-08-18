"""ORM models. Importing this package registers every table on Base.metadata."""

from app.models.audit import AuditLog
from app.models.company import Company
from app.models.feature import CompanyRoleFeature, Feature, RoleFeatureDefault
from app.models.membership import Membership
from app.models.otp import OtpCode
from app.models.product import ProductCategory, ProductModel, ProductSubcategory
from app.models.role import Role
from app.models.technician import (
    TechnicianInvite,
    TechnicianPincode,
    TechnicianProfile,
    TechnicianSubcategory,
)
from app.models.territory import MembershipPincode, MembershipRegion, Region
from app.models.ticket import Ticket
from app.models.token import RefreshToken
from app.models.user import User
from app.models.vendor import Vendor

__all__ = [
    "AuditLog",
    "Company",
    "CompanyRoleFeature",
    "Feature",
    "Membership",
    "MembershipPincode",
    "MembershipRegion",
    "OtpCode",
    "ProductCategory",
    "ProductModel",
    "ProductSubcategory",
    "RefreshToken",
    "Region",
    "Role",
    "RoleFeatureDefault",
    "TechnicianInvite",
    "TechnicianPincode",
    "TechnicianProfile",
    "TechnicianSubcategory",
    "Ticket",
    "User",
    "Vendor",
]
