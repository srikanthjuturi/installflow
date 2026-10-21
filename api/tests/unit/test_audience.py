"""Task 05 §6 cases 1–11 — `core.audience.hears`, the reference rule, pure.

One test per case in the spec's table. `Reader` is the resolved-facts shape
every real reader builds; nothing here touches a database.
"""

import uuid

import pytest

from app.core.audience import Reader, hears
from app.models.role import (
    ADMIN,
    AREA_MANAGER,
    FACILITY_OPERATOR,
    FRANCHISEE_ADMIN,
    NATIONAL_HEAD,
    REGIONAL_HEAD,
    TECHNICIAN,
    VENDOR,
)

_F = uuid.uuid4()  # a franchisee a row is about
_G = uuid.uuid4()  # another one
_V = uuid.uuid4()  # a vendor

_STAFF = frozenset({ADMIN, NATIONAL_HEAD, REGIONAL_HEAD, AREA_MANAGER})
# The AM's territory, as `core.scope.visible_pincodes` lists it — a set, so
# "all-India" staff read False here.
_AM_PINCODES = frozenset({"500032"})


def _reader(
    role: str = AREA_MANAGER,
    *,
    vendor_id: uuid.UUID | None = None,
    franchisee_id: uuid.UUID | None = None,
    is_payer: bool = False,
    all_india: bool = False,
    pincodes: frozenset[str] = _AM_PINCODES,
) -> Reader:
    return Reader(
        role=role,
        vendor_id=vendor_id,
        franchisee_id=franchisee_id,
        is_payer=is_payer,
        all_india=all_india,
        pincodes=pincodes,
    )


def _fr_reader(pid: uuid.UUID) -> Reader:
    return _reader(FRANCHISEE_ADMIN, franchisee_id=pid, pincodes=frozenset())


# 1. A staff AM hears unaddressed rows of his territory only; `pincode None`
#    is company-wide and reaches him.
def test_case_1_staff_am_territory() -> None:
    r = _reader(AREA_MANAGER)
    assert hears(r, pincode="500032", vendor_id=None, audience=None, franchisee_id=None)
    assert not hears(
        r, pincode="500099", vendor_id=None, audience=None, franchisee_id=None
    )
    assert hears(r, pincode=None, vendor_id=None, audience=None, franchisee_id=None)


# 2. An all-India staff reader hears every unaddressed row.
def test_case_2_staff_all_india() -> None:
    r = _reader(ADMIN, all_india=True)
    for pincode in ("500032", "500099", None):
        assert hears(r, pincode=pincode, vendor_id=None, audience=None, franchisee_id=None)


# 3. A `payers` row with no franchisee: the resolved payer, nobody else.
def test_case_3_payers_unaddressed_payer_only() -> None:
    assert hears(
        _reader(NATIONAL_HEAD, all_india=True, is_payer=True),
        pincode=None, vendor_id=None, audience="payers", franchisee_id=None,
    )
    assert not hears(
        _reader(ADMIN, all_india=True),
        pincode=None, vendor_id=None, audience="payers", franchisee_id=None,
    )
    assert not hears(
        _reader(AREA_MANAGER, all_india=True),
        pincode=None, vendor_id=None, audience="payers", franchisee_id=None,
    )


# 4. A `payers` row ABOUT a franchisee's money also reaches that franchisee's
#    own admin — through the franchise branch above, not the payer branch.
def test_case_4_payers_of_a_franchisee() -> None:
    row = dict(pincode=None, vendor_id=None, audience="payers", franchisee_id=_F)
    assert hears(_fr_reader(_F), **row)
    assert not hears(_fr_reader(_G), **row)
    assert not hears(
        _reader(FACILITY_OPERATOR, franchisee_id=_F, pincodes=frozenset()), **row
    )


# 5. A `franchisee_admin`-addressed row reaches exactly that franchisee's admin.
def test_case_5_franchisee_admin_row() -> None:
    row = dict(pincode=None, vendor_id=None, audience="franchisee_admin",
               franchisee_id=_F)
    assert hears(_fr_reader(_F), **row)
    assert not hears(_fr_reader(_G), **row)
    for role in (ADMIN, NATIONAL_HEAD, AREA_MANAGER):
        assert not hears(_reader(role, all_india=True), **row)


# 6. An UNADDRESSED row stamped about a franchisee is still a staff event:
#    territory decides, and a franchisee admin of THAT franchisee hears it.
def test_case_6_unaddressed_row_of_a_franchisee() -> None:
    row = dict(pincode=None, vendor_id=None, audience=None, franchisee_id=_F)
    assert hears(_fr_reader(_F), **row)
    assert not hears(_fr_reader(_G), **row)
    assert hears(
        _reader(AREA_MANAGER, pincodes=_AM_PINCODES), pincode="500032",
        vendor_id=None, audience=None, franchisee_id=_F,
    )


# 7. Task 02's closed leak, re-stated: no franchisee admin hears a row with
#    `franchisee_id=None` — company-wide stays out of every portal.
@pytest.mark.parametrize("audience", [None, "payers"])
def test_case_7_rows_without_franchisee_never_reach_franchise_admin(audience: str) -> None:
    for pincode in (None, "500032"):
        assert not hears(
            _fr_reader(_F), pincode=pincode, vendor_id=None, audience=audience,
            franchisee_id=None,
        )


# 8. `vendor` rows: the named vendor, and nobody else.
def test_case_8_vendor_rows() -> None:
    assert hears(
        _reader(VENDOR, vendor_id=_V), pincode=None, vendor_id=_V, audience="vendor",
        franchisee_id=None,
    )
    assert not hears(_fr_reader(_F), pincode=None, vendor_id=_V, audience="vendor",
                     franchisee_id=None)


# 9. An audience the rule does not know reaches nobody — including for the
#    would-be reader (a wrong `audience != role` and the dispatch ends there).
@pytest.mark.parametrize("role", [ADMIN, NATIONAL_HEAD, REGIONAL_HEAD,
                                  AREA_MANAGER, FRANCHISEE_ADMIN, TECHNICIAN])
def test_case_9_unknown_audience_reaches_nobody(role: str) -> None:
    r = _reader(role, all_india=True, is_payer=True)
    assert not hears(r, pincode=None, vendor_id=None, audience="zzz",
                     franchisee_id=None)
    # `facility` before Task 12 widens the rule — same silence.
    assert not hears(r, pincode=None, vendor_id=None, audience="facility",
                     franchisee_id=None)


# 10. A CORRUPT membership — a franchise role with no franchisee — is silent,
#     for every row. Fail-closed (§4.8 item 3).
def test_case_10_franchise_reader_without_franchisee_is_silent() -> None:
    r = _reader(FRANCHISEE_ADMIN, franchisee_id=None, pincodes=frozenset())
    for audience, fr in ((None, _F), ("franchisee_admin", _F), ("payers", _F)):
        assert not hears(r, pincode=None, vendor_id=None, audience=audience,
                         franchisee_id=fr)


# 11. `billing` rows are the recharge pair (company Admin/NH).
def test_case_11_billing_rows() -> None:
    row = dict(pincode=None, vendor_id=None, audience="billing", franchisee_id=None)
    assert hears(_reader(ADMIN, all_india=True), **row)
    assert not hears(_fr_reader(_F), **row)
    # An NH who is not a territory reader is still inside the pair.
    assert hears(_reader(NATIONAL_HEAD, pincodes=frozenset()), **row)