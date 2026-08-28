"""One GSTIN, one role: a company's own GST number can never also be a vendor's.

A GSTIN identifies exactly one legal entity. Inside a company the tenant and the
outside parties it buys from are different entities by definition, so a vendor
carrying its own customer's GST number is a data-entry mistake and not a
business case anybody has.

The two slices already check GSTIN uniqueness, but each only looks at its own
table — companies against companies, vendors against that company's vendors.
Neither asks the cross-table question, which is the one this module answers.

Both halves live here rather than in either slice because they are two edges of
ONE rule and hard rule 4 forbids the slices importing each other. Models are
shared, so both queries sit here cleanly.

Scope is deliberately the caller's OWN company. A vendor is not checked against
other tenants' GSTINs: that would tell a company admin which other companies
exist on the platform, which is a tenancy leak dressed up as a validation.

Neither check can be a database constraint — a unique index cannot span two
tables — so unlike vendor-vs-vendor there is no backstop and a simultaneous
write could in principle slip past. Company GSTIN edits are rare superadmin
actions; a trigger is not worth what it costs to maintain.
"""

import uuid

from fastapi import status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AppError
from app.models.company import Company
from app.models.vendor import Vendor

# Every 409 a GSTIN can cause, named in one place. The console maps all four
# onto its GSTIN field, and it can only do that if it can tell them apart — the
# endpoints that raise them also raise 409 for a duplicate name and a taken
# login email. Codes are an API surface: SCREAMING_SNAKE and stable.
#
# The two DUPLICATE_* codes belong to checks that live in their own slice (a
# within-table uniqueness rule is nobody else's business); they are declared
# here so the set is readable as a set.

#: The GSTIN belongs to the company itself, so no vendor of it may carry it.
GST_BELONGS_TO_COMPANY = "GST_BELONGS_TO_COMPANY"
#: The GSTIN is already one of the company's vendors', so the company may not take it.
GST_BELONGS_TO_VENDOR = "GST_BELONGS_TO_VENDOR"
#: Another vendor in the same company already has it.
GST_DUPLICATE_VENDOR = "GST_DUPLICATE_VENDOR"
#: Another company already has it — platform-wide, unlike the vendor rule.
GST_DUPLICATE_COMPANY = "GST_DUPLICATE_COMPANY"


async def assert_gst_not_the_company(
    db: AsyncSession, company_id: uuid.UUID, gst_number: str
) -> None:
    """409 if this GSTIN is the company's own — a vendor is an outside party.

    Selects the NAME rather than the id so the refusal can say whose number it
    is; "already registered" on its own leaves the operator with nowhere to go.
    """
    name = await db.scalar(
        select(Company.name).where(
            Company.id == company_id,
            Company.deleted_at.is_(None),
            func.lower(Company.gst_number) == gst_number.lower(),
        )
    )
    if name is not None:
        raise AppError(
            status.HTTP_409_CONFLICT,
            GST_BELONGS_TO_COMPANY,
            f"{gst_number} is {name}'s own GST number. A vendor is an outside "
            "party, so it cannot be registered under it.",
        )


async def assert_gst_not_a_vendor(
    db: AsyncSession, company_id: uuid.UUID, gst_number: str
) -> None:
    """409 if one of this company's vendors already holds this GSTIN.

    `deleted_at IS NULL` matches `uq_vendors_company_gst_lower`, which is
    partial for the same reason: removing a vendor frees its GSTIN rather than
    poisoning it forever.
    """
    name = await db.scalar(
        select(Vendor.name).where(
            Vendor.company_id == company_id,
            Vendor.deleted_at.is_(None),
            func.lower(Vendor.gst_number) == gst_number.lower(),
        )
    )
    if name is not None:
        raise AppError(
            status.HTTP_409_CONFLICT,
            GST_BELONGS_TO_VENDOR,
            f"{gst_number} is already registered to the vendor {name}. "
            "A company and its vendor cannot share a GST number.",
        )
