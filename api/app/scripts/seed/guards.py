"""The two refusals that make the rest of this package safe to run.

Neither is a convention. A seed that merely *intends* to use unreachable
numbers, or that merely *means* to target development, is one typo away from
messaging a stranger or filling the production database by accident.
"""

import re

from app.core.config import settings
from app.scripts.create_database import PRODUCTION_DB

#: Indian mobile numbers begin 6, 7, 8 or 9. A `+911…` number is therefore
#: valid E.164 (`core.phone.is_e164` accepts it) and can never reach a
#: subscriber, so WhatsApp fails at Meta and nobody is messaged.
SYNTHETIC_PHONE = re.compile(r"^\+911\d{9}$")

#: The one exception: real team phones, carried by a handful of seeded
#: technicians so a genuine OTP sign-in can be tested on production. Anything
#: NOT on this list must satisfy `SYNTHETIC_PHONE`.
REAL_TEAM_PHONES: tuple[str, ...] = (
    "+916301815418",
    "+919398475448",
    "+919951753840",
    "+919390643013",
)


#: The email twin of the rule above, and it exists for the same reason: creating
#: a company, a console user or a vendor login EMAILS a temporary password, and
#: production has no `ACS_EMAIL_ALLOWLIST` either.
#:
#: A subdomain of `example.com`, which RFC 2606 reserves for exactly this and
#: IANA holds, so it can never become somebody's real mailbox and has no MX to
#: deliver to. NOT `.invalid`, which reads better and is refused before it gets
#: anywhere near a mail server: `email_validator` — which every `EmailStr` on
#: every request model runs — rejects the whole special-use list
#: (`arpa`, `invalid`, `local`, `localhost`, `onion`, `test`).
SYNTHETIC_EMAIL_DOMAIN = "seed.example.com"


class SeedRefused(RuntimeError):
    """Raised instead of writing anything. Never caught inside this package."""


def assert_unreachable(phone: str, *, what: str) -> str:
    """Return `phone`, or refuse to let the caller write it anywhere.

    `what` names the row being built ("technician 12", "customer for ticket
    0042") so a refusal says which generator is wrong, not merely that one is.
    """
    if phone in REAL_TEAM_PHONES:
        return phone
    if not SYNTHETIC_PHONE.match(phone):
        raise SeedRefused(
            f"{what} would be given {phone}, which is not an unreachable "
            f"+911XXXXXXXXX number and is not one of the team's own. Seeding "
            f"stopped — see loadtest/DECISIONS.md, decision 6."
        )
    return phone


def synthetic_phone(index: int) -> str:
    """`+911000000001`, `+911000000002`, … — checked, not merely generated."""
    if not 0 < index < 1_000_000_000:
        raise SeedRefused(f"phone index {index} is out of range")
    return assert_unreachable(f"+911{index:09d}", what=f"synthetic phone #{index}")


def synthetic_email(local: str) -> str:
    """`admin@seed.invalid` — an address no mail server can ever deliver to."""
    return assert_undeliverable(
        f"{local}@{SYNTHETIC_EMAIL_DOMAIN}", what=f"synthetic address for {local!r}"
    )


def assert_undeliverable(email: str, *, what: str) -> str:
    """Return `email`, or refuse. The twin of `assert_unreachable`."""
    if not email.endswith(f"@{SYNTHETIC_EMAIL_DOMAIN}"):
        raise SeedRefused(
            f"{what} would be {email}, which is not @{SYNTHETIC_EMAIL_DOMAIN}. "
            f"Creating an account emails a temporary password to it, and "
            f"production has no allowlist. Seeding stopped."
        )
    return email


def assert_target_allowed(*, production: bool) -> str:
    """Refuse a database that does not match what the caller asked for.

    The database comes from the environment the usual way — `.env`, or
    `POSTGRES_DB` overriding it — so this compares INTENT against what is
    actually configured. Pointing at production without saying so is the
    accident worth preventing; saying so while pointed at development is
    merely confused, and is also refused.
    """
    database = settings.POSTGRES_DB
    is_production = database == PRODUCTION_DB

    if is_production and not production:
        raise SeedRefused(
            f"POSTGRES_DB is {database}, the PRODUCTION database, but "
            f"--production was not given. Nothing was written."
        )
    if production and not is_production:
        raise SeedRefused(
            f"--production was given but POSTGRES_DB is {database}. Set "
            f"$env:POSTGRES_DB='{PRODUCTION_DB}' for that run, rather than "
            f"editing a .env file."
        )
    return database
