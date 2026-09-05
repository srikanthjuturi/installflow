"""One GSTIN, one role: a company's own GST number can never also be a vendor's.

A GSTIN identifies exactly one legal entity. Inside a company the tenant and the
outside parties it buys from are different entities by definition, so a vendor
carrying its own customer's GST number is a data-entry mistake and not a
business case anybody has.

Both halves live here rather than in either slice because they are two edges of
ONE rule and hard rule 4 forbids the slices importing each other. Models are
shared, so both queries sit here cleanly.

**This module owns the QUERIES as well as the rule.** It used to declare the
four codes while each slice ran its own `SELECT`, and that was fine while the
only caller was a save. It stopped being fine when `gst_lookup` started asking
the same question BEFORE spending a metered registry call: two copies of
"already registered under GSTIN X" drift, and the form would then say one thing
while the save that follows it says another. Every caller now builds its answer
from `company_with_gstin` / `vendor_with_gstin` and the four `GstinHolder`
sentences below, so the pre-check and the 409 are word for word the same.

Scope is deliberately the caller's OWN company on the vendor side. A vendor is
not checked against other tenants' GSTINs: that would tell a company admin which
other companies exist on the platform, which is a tenancy leak dressed up as a
validation. `company_with_gstin` takes `only=` for exactly that reason — the
platform-wide form of it (`exclude=`) is for the superadmin surface alone.

Neither cross-table check can be a database constraint — a unique index cannot
span two tables — so unlike vendor-vs-vendor there is no backstop and a
simultaneous write could in principle slip past. Company GSTIN edits are rare
superadmin actions; a trigger is not worth what it costs to maintain.
"""

import uuid
from typing import NamedTuple

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
# They are also what `GstinLookupOut.code` carries, so a form that refuses a
# GSTIN before the save reports the same clash under the same name.

#: The GSTIN belongs to the company itself, so no vendor of it may carry it.
GST_BELONGS_TO_COMPANY = "GST_BELONGS_TO_COMPANY"
#: The GSTIN is already one of the company's vendors', so the company may not take it.
GST_BELONGS_TO_VENDOR = "GST_BELONGS_TO_VENDOR"
#: Another vendor in the same company already has it.
GST_DUPLICATE_VENDOR = "GST_DUPLICATE_VENDOR"
#: Another company already has it — platform-wide, unlike the vendor rule.
GST_DUPLICATE_COMPANY = "GST_DUPLICATE_COMPANY"


class GstinHolder(NamedTuple):
    """Who already holds a GSTIN, under which code, in the words to show.

    Returned rather than raised, because the same finding is a 409 on a save and
    an ordinary 200 result on a lookup — see `app.core.gst_lookup`. The two
    `assert_*` helpers below turn it into the refusal.
    """

    code: str
    message: str


# ── the two queries ───────────────────────────────────────────────────────────


async def company_with_gstin(
    db: AsyncSession,
    gst_number: str,
    *,
    only: uuid.UUID | None = None,
    exclude: uuid.UUID | None = None,
) -> str | None:
    """The name of the LIVE company using this GSTIN, or None.

    `only` restricts the search to one company — the vendor surface's form of
    the question, which is "is this the caller's OWN number?" and must never
    become "does any tenant on the platform hold it?". `exclude` skips one, for
    the superadmin editing a company against its own saved value.

    `deleted_at IS NULL` matches `uq_companies_gst_lower`, which `4c8f1b7d2e93`
    made partial for the reason every unique on a soft-deleted table is: removing
    a company frees its GSTIN rather than poisoning it forever. This check used to
    count deleted rows too, so retiring a company and registering it again refused
    with a 409 raised by a row invisible on every screen — nothing in the console
    could explain it, because `list_companies` and `_load_company` both hide it.

    Selects the NAME rather than counting, so the refusal can say whose number it
    is; "already registered" on its own leaves the operator with nowhere to go.
    """
    stmt = select(Company.name).where(
        Company.deleted_at.is_(None),
        func.lower(Company.gst_number) == gst_number.lower(),
    )
    if only is not None:
        stmt = stmt.where(Company.id == only)
    if exclude is not None:
        stmt = stmt.where(Company.id != exclude)
    return await db.scalar(stmt)


async def vendor_with_gstin(
    db: AsyncSession,
    company_id: uuid.UUID,
    gst_number: str,
    *,
    exclude: uuid.UUID | None = None,
) -> str | None:
    """The name of the live vendor of THIS company using this GSTIN, or None.

    Always company-scoped: a vendor of one tenant is invisible to another, and
    naming one across the boundary would be the leak the module docstring
    describes.

    `deleted_at IS NULL` matches `uq_vendors_company_gst_lower`, which is
    partial for the same reason as its company twin: removing a vendor frees its
    GSTIN rather than poisoning it forever.
    """
    stmt = select(Vendor.name).where(
        Vendor.company_id == company_id,
        Vendor.deleted_at.is_(None),
        func.lower(Vendor.gst_number) == gst_number.lower(),
    )
    if exclude is not None:
        stmt = stmt.where(Vendor.id != exclude)
    return await db.scalar(stmt)


# ── the four sentences ────────────────────────────────────────────────────────
#
# One definition each, so the lookup's refusal and the save's 409 cannot drift.


def _company_owns_it(gst_number: str, name: str) -> GstinHolder:
    return GstinHolder(
        GST_BELONGS_TO_COMPANY,
        f"{gst_number} is {name}'s own GST number. A vendor is an outside "
        "party, so it cannot be registered under it.",
    )


def _a_vendor_owns_it(gst_number: str, name: str) -> GstinHolder:
    return GstinHolder(
        GST_BELONGS_TO_VENDOR,
        f"{gst_number} is already registered to the vendor {name}. "
        "A company and its vendor cannot share a GST number.",
    )


def _another_vendor_has_it(gst_number: str, name: str) -> GstinHolder:
    return GstinHolder(
        GST_DUPLICATE_VENDOR, f"{name} is already registered under GSTIN {gst_number}"
    )


def _another_company_has_it(gst_number: str, name: str) -> GstinHolder:
    return GstinHolder(
        GST_DUPLICATE_COMPANY, f"{name} is already registered under GSTIN {gst_number}"
    )


# ── who holds it, per surface ─────────────────────────────────────────────────


async def gstin_holder_for_vendor(
    db: AsyncSession,
    company_id: uuid.UUID,
    gst_number: str,
    *,
    exclude_id: uuid.UUID | None = None,
) -> GstinHolder | None:
    """Who already holds this GSTIN, asked from the VENDOR form.

    Two questions in the order a person should be told them: another vendor of
    this company first, because a duplicate of an existing vendor is the likelier
    mistake of the two, then the company's own number.

    `exclude_id` is the vendor being edited. Without it, opening any saved
    vendor would refuse its own GSTIN and name the row you are looking at.
    """
    name = await vendor_with_gstin(db, company_id, gst_number, exclude=exclude_id)
    if name is not None:
        return _another_vendor_has_it(gst_number, name)

    # `only=` and never a bare platform-wide search — see the module docstring.
    name = await company_with_gstin(db, gst_number, only=company_id)
    if name is not None:
        return _company_owns_it(gst_number, name)

    return None


async def gstin_holder_for_company(
    db: AsyncSession,
    gst_number: str,
    *,
    exclude_id: uuid.UUID | None = None,
) -> GstinHolder | None:
    """Who already holds this GSTIN, asked from the superadmin's COMPANY form.

    Platform-wide for the company half, and naming the holder leaks nothing:
    every caller here is a superadmin, who can already list every company. The
    vendor twin withholds other tenants' names because ITS caller is a company
    admin, which is a different question.

    `exclude_id` is the company being edited, and doubles as the answer to
    "whose vendors?" — the other edge of the same rule. A company being CREATED
    has no vendors yet, so with no `exclude_id` that query could not return a row
    and is not run.
    """
    name = await company_with_gstin(db, gst_number, exclude=exclude_id)
    if name is not None:
        return _another_company_has_it(gst_number, name)

    if exclude_id is not None:
        name = await vendor_with_gstin(db, exclude_id, gst_number)
        if name is not None:
            return _a_vendor_owns_it(gst_number, name)

    return None


# ── the refusals ──────────────────────────────────────────────────────────────


def _refuse(holder: GstinHolder) -> None:
    raise AppError(status.HTTP_409_CONFLICT, holder.code, holder.message)


async def assert_gstin_free_for_vendor(
    db: AsyncSession,
    company_id: uuid.UUID,
    gst_number: str,
    *,
    exclude_id: uuid.UUID | None = None,
) -> None:
    """409 if anything in this company already holds this GSTIN."""
    holder = await gstin_holder_for_vendor(
        db, company_id, gst_number, exclude_id=exclude_id
    )
    if holder is not None:
        _refuse(holder)


async def assert_gstin_free_for_company(
    db: AsyncSession,
    gst_number: str,
    *,
    exclude_id: uuid.UUID | None = None,
) -> None:
    """409 if another company — or, on an edit, one of its own vendors — holds it."""
    holder = await gstin_holder_for_company(db, gst_number, exclude_id=exclude_id)
    if holder is not None:
        _refuse(holder)
