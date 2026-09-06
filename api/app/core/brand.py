"""Whose name goes on this — the company's, or the platform's.

The server-side twin of the console's `hooks/useBrand.ts`, and it exists for
the same reason: the answer was being decided independently in a dozen places,
each with its own `or "Reliance GreenTech"` written inline, so no one of them
could be changed without hunting for the other eleven.

**The company wins wherever there is one.** A technician reading a WhatsApp
message, a customer picking a slot, a manager opening a password email — none
of them are our customers, they are the company's. The platform name is a
fallback for the cases where no company can honestly be named:

  * a superadmin belongs to no company (`principal.company_id` is None by
    design), so a password reset for one has no company to name;
  * the invite landing page never resolves its token, deliberately — see
    `features/onboarding/landing.py`;
  * a lookup that failed, where naming the wrong company would be worse than
    naming none.

Kept in `core/` because tickets, technicians, users, vendors and both public
pages all need it, and hard rule 4 forbids one slice importing another's.
"""

from app.core.config import settings

__all__ = ["brand_name", "brand_mark", "company_name", "company_mark"]


def brand_name() -> str:
    """The platform's own name. Prefer `company_name` wherever a company exists."""
    return settings.BRAND_NAME or "Reliance GreenTech"


def brand_mark() -> str:
    """The platform's monogram, for the tile on a server-rendered page."""
    return settings.BRAND_MARK or "RG"


def company_name(name: str | None) -> str:
    """The company's name, or the platform's when there isn't one.

    Takes the name rather than a `Company` so a caller that already has only
    the string — most of them, from a join — does not have to load the row
    back. Blank is treated as absent: a company whose name is an empty string
    would otherwise render as a gap where a name should be.
    """
    return (name or "").strip() or brand_name()


def company_mark(code: str | None) -> str:
    """The company's short code, or the platform's mark when there isn't one.

    Never derived from the name here. `companies.code` is stamped once and
    deliberately never recomputed (`core/company_code.py`), so a second
    derivation would eventually disagree with the codes already printed on that
    company's tickets.
    """
    return (code or "").strip() or brand_mark()
