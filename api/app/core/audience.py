"""Who hears a bell — the pure spec, in one place.

A `notifications` row names its audience with up to four facts: a `pincode`
(territory), a `vendor_id` (named portal), an `audience` (a role or a special
one) and a `franchisee_id` (Task 05, whose franchisee the row is ABOUT). The
rule that turns those four facts and one READER into "this reader hears it" is
needed in three shapes:

  * `features/notifications/service._visible` — the feed and the badge, in SQL;
  * `core.coverage.users_notified_by` — web push, a list of user ids;
  * `features/tickets/ws.py::_Visibility.hears_notification` — the live bell,
    in memory.

Three readers of one rule have historically meant three copies, and an
audience one of them does not know reaches nobody — which is silent only until
a bell that should have rung does not. `core.audience.hears` is the memory
shape of that rule and the reference copy; `_visible` keeps its own SQL but
mirrors these branches clause for clause, and the socket delegates here
outright. The coverage function mirrors it too, clause for clause, in users.
Any fourth shape must read this module first (models/notification.py marks the
same warning on `audience` itself).

`hears` is PURE: no database, no session, no slice import — unit testable
(Task 05 §6), the way `core.scope` was. The one impure fact a reader carries in
— whether it is the company payer — is resolved before this is called
(`core.coverage.payer_role`), because "who pays" is data nobody can derive from
a role alone.
"""

import uuid
from dataclasses import dataclass

from app.models.role import ADMIN, FRANCHISEE_ADMIN, FRANCHISE_ROLES, NATIONAL_HEAD


@dataclass(frozen=True)
class Reader:
    """One reader's relevant facts, already resolved.

    `role` is the membership role; `vendor_id` — a VENDOR principal's own id, so
    a vendor is matched only by being NAMED; `franchisee_id` — a franchise
    principal's OWN franchisee, so a company-wide row can never match; `is_payer`
    — the `core.coverage.payer_role` answer ("am I the role people pay
    through"); `all_india`/`pincodes` — the territory half, as
    `core.scope.visible_pincodes` returns it (None → all-India, list → the set).
    """

    role: str
    vendor_id: uuid.UUID | None
    franchisee_id: uuid.UUID | None
    is_payer: bool
    all_india: bool
    pincodes: frozenset[str]


def hears(
    reader: Reader,
    *,
    pincode: str | None,
    vendor_id: uuid.UUID | None,
    audience: str | None,
    franchisee_id: uuid.UUID | None,
) -> bool:
    """Whether one reader hears one row.

    The audiences, in the order the branches test them: `vendor` is the named
    vendor and NO staff member; a franchise principal hears only rows stamped
    with THEIR franchisee and addressed to nobody, to them, or to the payer
    (their money, and `payers` rows of home — F8); `payers` is the resolved
    payer; `billing` is the recharge pair; a role key is that role, still
    inside its territory; an unaddressed row is territory as usual. Anything
    unknown — including `facility' until Task 12 widens the rule — reaches
    nobody rather than everybody.
    """
    # The franchise branch first, and COMPLETE — it must answer addressed AND
    # unaddressed rows, so it cannot sit inside the `audience is not None`
    # dispatch below (an unaddressed row that fell through there would reach
    # the staff territory branch, where `pincode is None` means "company-wide",
    # and company-wide is exactly what a franchisee is never handed — Task 02's
    # test 13). `franchisee_id` must be SET on the reader and on the row: NULL
    # on the row means a staff event, NULL on the reader is a corrupt
    # membership, and both mean silence.
    if reader.role in FRANCHISE_ROLES:
        return (
            reader.role == FRANCHISEE_ADMIN
            # Facility roles hear nothing in this task — Task 12 adds `facility`
            # here, for THIS franchisee's facility staff only (owner ruling R4).
            and reader.franchisee_id is not None
            and franchisee_id is not None
            and franchisee_id == reader.franchisee_id
            and audience in (None, "franchisee_admin", "payers")
        )
    if audience is not None:
        if audience == "vendor":
            # The one audience that points AWAY from staff. Tested before the
            # guard below, which would otherwise refuse the very reader it is
            # addressed to.
            return reader.vendor_id is not None and vendor_id == reader.vendor_id
        if reader.vendor_id is not None:
            return False
        if audience == "payers":
            # The payer hears it whoever it is about — a redemption bell is
            # not tied to a place, and the row's `franchisee_id` (when set)
            # additionally brings in that franchisee's own admins, which is
            # the franchise branch above, not this one.
            return reader.is_payer
        if audience == "billing":
            return reader.role in (ADMIN, NATIONAL_HEAD)
        if audience != reader.role:
            return False
        return (
            reader.all_india
            or pincode is None
            or pincode in reader.pincodes
        )
    if reader.vendor_id is not None:
        return vendor_id is not None and vendor_id == reader.vendor_id
    if reader.all_india or pincode is None:
        return True
    return pincode in reader.pincodes