"""Task 17 §6 — moving a technician between franchisees, the pure parts.

`app.core.technician_transfer` is stdlib + `uuid` + `core.money`: no database,
no session. `H`, `S`, `T` are three franchisee ids. The route wiring tests at
the bottom read the app's route table (no server, no database): the stacked-
`Annotated` pitfall means a guard that is not in `dependencies=[...]` silently
never runs, so the two new routes are pinned to carry all of theirs.
"""

import importlib.util
import uuid
from pathlib import Path

import pytest
from pydantic import ValidationError

from app.core import technician_transfer as tt
# Imported at module level on purpose: `app.core.database` builds its engine at
# import, which the X1 guard refuses once a test is running (collection is fine).
from app.features.technicians.router import router as technicians_router
from app.scripts import audit_tenancy, cleanup_db
from app.core.technician_transfer import (
    CODE_BALANCE,
    CODE_NO_ADMIN,
    CODE_OPEN_JOBS,
    CODE_OUTSIDE,
    NOTIFICATION_KIND,
    CoveragePlan,
    coverage_diff,
    plan_coverage,
    reason_problem,
    single_region,
    transfer_blockers,
    transfer_notices,
    transfer_warnings,
)

H, S, T = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()


def _plan(**over) -> CoveragePlan:
    base = dict(
        source="kept", kept=("500031",), trimmed=(), added=(), final=("500031",),
        outside=(), nothing_left=False,
    )
    base.update(over)
    return CoveragePlan(**base)


def _blockers(**over):
    base = dict(
        same_franchisee=False, target_name="SkyFix Services", target_active=True,
        target_is_home=False, target_active_admins=1, technician_code="TCH-4021",
        open_jobs=0, redeemable_paise=0, open_redemption_code=None, plan=_plan(),
        technician_name="Ravi Kumar",
    )
    base.update(over)
    return transfer_blockers(**base)


# ── plan_coverage ───────────────────────────────────────────────────────────


def test_01_everything_inside_keeps_everything():
    plan = plan_coverage({"500031", "500032"}, {"500031": S, "500032": S}, S, None)
    assert plan.kept == ("500031", "500032")
    assert plan.trimmed == ()
    assert plan.changed is False
    assert plan.source == "kept"


def test_02_a_code_owned_by_someone_else_is_trimmed():
    plan = plan_coverage({"500031", "500045"}, {"500031": S, "500045": H}, S, None)
    assert plan.kept == ("500031",)
    assert plan.trimmed == ("500045",)
    assert plan.final == ("500031",)
    assert plan.source == "kept"
    assert plan.changed is True


def test_03_nothing_inside_is_nothing_left():
    plan = plan_coverage({"500031", "500032"}, {"500031": H, "500032": H}, S, None)
    assert plan.nothing_left is True
    assert plan.final == ()
    assert plan.trimmed == ("500031", "500032")


def test_04_supplied_coverage_replaces_and_sorts():
    routes = {"500031": S, "500033": S}
    plan = plan_coverage({"500031"}, routes, S, ["500033", "500031"])
    assert plan.final == ("500031", "500033")
    assert plan.added == ("500033",)
    assert plan.kept == ("500031",)
    assert plan.source == "supplied"


def test_05_supplied_code_the_target_does_not_own_is_outside():
    routes = {"500031": S, "500045": H}
    plan = plan_coverage({"500031"}, routes, S, ["500031", "500045"])
    assert plan.outside == ("500045",)
    assert plan.nothing_left is False


def test_06_supplied_empty_is_nothing_left():
    plan = plan_coverage({"500031"}, {"500031": S}, S, [])
    assert plan.nothing_left is True
    assert plan.trimmed == ("500031",)


def test_07_supplied_duplicates_and_order_are_normalised():
    routes = {"500031": S, "500032": S}
    plan = plan_coverage(set(), routes, S, ["500032", "500031", "500032", "500031"])
    assert plan.final == ("500031", "500032")


def test_08_a_supplied_code_absent_from_routes_fails_closed():
    plan = plan_coverage({"500031"}, {"500031": S}, S, ["500031", "500099"])
    assert plan.outside == ("500099",)


def test_09_supplied_equal_to_current_is_not_a_change():
    routes = {"500031": S, "500032": S}
    plan = plan_coverage({"500031", "500032"}, routes, S, ["500032", "500031"])
    assert plan.changed is False
    assert plan.added == () and plan.trimmed == ()


def test_10_home_is_no_special_case():
    # Unowned codes route to H (F4); the same function answers for the home.
    routes = {"500060": H, "500031": S}
    plan = plan_coverage({"500031", "500032", "500060"}, {**routes, "500032": S}, H, None)
    assert plan.final == ("500060",)
    assert plan.trimmed == ("500031", "500032")


def test_coverage_diff_derives_the_three_lists():
    assert coverage_diff(["500031", "500045"], ["500031", "500033"]) == (
        ["500031"], ["500045"], ["500033"],
    )


# ── single_region ───────────────────────────────────────────────────────────


def test_11_single_region():
    r1, r2 = uuid.uuid4(), uuid.uuid4()
    assert single_region({r1}) == r1
    assert single_region(set()) is None
    with pytest.raises(ValueError):
        single_region({r1, r2})


def test_multi_region_message_names_both_sorted():
    msg = tt.multi_region_message(["West", "South"])
    assert "(South, West)" in msg
    assert "more than one region" in msg


# ── transfer_blockers ───────────────────────────────────────────────────────


def test_12_all_clear_is_empty():
    assert _blockers() == []


def test_13_same_franchisee_is_one_codeless_blocker():
    got = _blockers(same_franchisee=True, open_jobs=3)
    assert len(got) == 1
    assert got[0].code is None
    assert "already works for SkyFix Services" in got[0].message


def test_14_inactive_target_is_codeless_and_names_it():
    got = _blockers(target_active=False)
    assert len(got) == 1 and got[0].code is None
    assert got[0].message == "Activate SkyFix Services before moving technicians to it."


def test_15_non_home_without_an_admin_is_refused_but_home_is_not():
    got = _blockers(target_active_admins=0)
    assert [b.code for b in got] == [CODE_NO_ADMIN]
    assert _blockers(target_active_admins=0, target_is_home=True) == []


def test_16_open_jobs_singular_and_plural():
    one = _blockers(open_jobs=1)[0]
    assert one.code == CODE_OPEN_JOBS and one.open_jobs == 1
    assert one.message == "TCH-4021 still has 1 open job. Finish or reassign it first."
    many = _blockers(open_jobs=3)[0]
    assert many.open_jobs == 3
    assert many.message == "TCH-4021 still has 3 open jobs. Finish or reassign them first."


def test_17_a_redeemable_balance_blocks_and_shows_rupees():
    b = _blockers(redeemable_paise=124000)[0]
    assert b.code == CODE_BALANCE
    assert b.redeemable_paise == 124000
    assert "₹1,240" in b.message
    assert "Ravi Kumar" in b.message


def test_18_an_open_redemption_blocks_and_names_its_code():
    b = _blockers(redeemable_paise=0, open_redemption_code="RGT-RDM-0007")[0]
    assert b.code == CODE_BALANCE
    assert b.redemption_code == "RGT-RDM-0007"
    assert "RGT-RDM-0007" in b.message


def test_19_a_negative_balance_does_not_block():
    assert _blockers(redeemable_paise=-50000) == []


def test_20_jobs_come_before_balance():
    got = _blockers(open_jobs=1, redeemable_paise=124000)
    assert [b.code for b in got] == [CODE_OPEN_JOBS, CODE_BALANCE]


def test_21_coverage_blockers_come_last():
    outside = _blockers(
        open_jobs=1, plan=_plan(outside=("500045",), final=("500031", "500045")),
        outside_text="Outside SkyFix Services: 500045 (Acme). Pick pincodes SkyFix Services owns.",
    )
    assert [b.code for b in outside] == [CODE_OPEN_JOBS, CODE_OUTSIDE]
    assert outside[-1].message.startswith("Outside SkyFix Services")

    nothing = _blockers(plan=_plan(final=(), kept=(), trimmed=("500031",), nothing_left=True))
    assert [b.code for b in nothing] == [CODE_OUTSIDE]
    assert nothing[0].message == (
        "None of TCH-4021's pincodes is inside SkyFix Services's area. "
        "Choose the pincodes SkyFix Services should serve."
    )


def test_outside_without_service_text_still_names_the_codes():
    got = _blockers(plan=_plan(outside=("500045", "500046"), final=("500045", "500046")))
    assert got[0].code == CODE_OUTSIDE
    assert "500045, 500046" in got[0].message


def test_technician_name_defaults_to_the_code():
    got = transfer_blockers(
        same_franchisee=True, target_name="S", target_active=True, target_is_home=False,
        target_active_admins=1, technician_code="TCH-1", open_jobs=0, redeemable_paise=0,
        open_redemption_code=None, plan=_plan(),
    )
    assert got[0].message.startswith("TCH-1 already works for")


# ── transfer_warnings ───────────────────────────────────────────────────────


def _warn(**over):
    base = dict(
        technician_name="Ravi Kumar", target_name="SkyFix Services", redeemable_paise=0,
        pending_upi_change=False, base_pincode_outside=False, base_pincode=None,
    )
    base.update(over)
    return transfer_warnings(**base)


def test_22_owing_money_warns_with_the_amount():
    got = _warn(redeemable_paise=-50000)
    assert len(got) == 1 and "₹500" in got[0]
    assert _warn(redeemable_paise=0) == []
    assert _warn(redeemable_paise=1000) == []


def test_23_pending_upi_and_outside_base_warn():
    assert len(_warn(pending_upi_change=True)) == 1
    got = _warn(base_pincode_outside=True, base_pincode="500045")
    assert len(got) == 1 and "500045" in got[0]
    # an outside base with no pincode to name is not a sentence we can write
    assert _warn(base_pincode_outside=True, base_pincode=None) == []


# ── reason_problem ──────────────────────────────────────────────────────────


def test_24_reason_rules():
    for bad in (None, "", "abcd", "  abcd  ", "   "):
        assert reason_problem(bad)
    assert reason_problem("abcde") is None
    assert reason_problem("  abcde ") is None
    too_long = reason_problem("x" * 256)
    assert too_long and "255" in too_long
    assert reason_problem("x" * 255) is None
    assert "Ravi Kumar" in reason_problem("", name="Ravi Kumar")


# ── transfer_notices ────────────────────────────────────────────────────────


def test_25_notices_fit_the_bell_and_name_no_product():
    (jt, jd), (lt, ld) = transfer_notices(
        technician_name="Ravi Kumar", technician_code="TCH-4021",
        from_name="Acme Appliances", to_name="SkyFix Services",
        reason="y" * 255,
    )
    assert len(jt) <= 160 and len(lt) <= 160
    assert len(jd) <= 255 and len(ld) <= 255
    assert jd.endswith("…")
    assert jt == "Ravi Kumar joined SkyFix Services"
    assert lt == "Ravi Kumar moved to SkyFix Services"
    assert jd.startswith("TCH-4021 · from Acme Appliances · ")
    for text in (jt, jd, lt, ld):
        assert "Reliance" not in text


def test_notices_keep_a_short_reason_whole():
    (_, jd), _ = transfer_notices(
        technician_name="R", technician_code="TCH-1", from_name="A", to_name="B",
        reason="  Ravi moved east  ",
    )
    assert jd == "TCH-1 · from A · Ravi moved east"


def test_26_the_bell_kind_fits_its_column():
    assert NOTIFICATION_KIND == "technician_moved"
    assert len(NOTIFICATION_KIND) <= 24
    from app.models.notification import NOTIFICATION_KINDS

    assert NOTIFICATION_KIND in NOTIFICATION_KINDS


# ── the push (D9) ───────────────────────────────────────────────────────────


def test_push_technician_moved_renders_in_all_five_languages():
    from app.core.push_text import LANGUAGES, PushText

    for lang in LANGUAGES:
        title, body = PushText("technician.moved", franchisee="SkyFix Services").render(lang)
        assert "SkyFix Services" in title + body
        assert "{" not in title + body
    en_title, en_body = PushText("technician.moved", franchisee="SkyFix").render("en")
    assert en_title == "You now work with SkyFix"
    assert en_body == "Your jobs, pay and pincodes now come from SkyFix. Open the app to refresh."


# ── the request body ────────────────────────────────────────────────────────


def test_request_schema_validates_the_shape():
    from app.features.technicians.schemas import TechnicianTransferRequest

    ok = TechnicianTransferRequest(franchiseeId=S)
    assert ok.reason is None and ok.pincodes is None
    with pytest.raises(ValidationError):
        TechnicianTransferRequest(franchiseeId=S, pincodes=["012345"])  # leading zero
    with pytest.raises(ValidationError):
        TechnicianTransferRequest(franchiseeId=S, pincodes=["5000"])
    with pytest.raises(ValidationError):
        TechnicianTransferRequest(franchiseeId=S, reason="x" * 256)
    with pytest.raises(ValidationError):
        TechnicianTransferRequest(franchiseeId=S, pincodes=[f"{500000 + i}" for i in range(501)])


# ── the model, the registries and the migration ─────────────────────────────


def test_model_carries_the_four_checks_three_fks_and_three_indexes():
    from app.models.technician_transfer import TechnicianTransfer

    table = TechnicianTransfer.__table__
    checks = {c.name for c in table.constraints if c.__class__.__name__ == "CheckConstraint"}
    # Names are the BARE ones; the naming convention adds `ck_<table>_`.
    assert checks == {
        "ck_technician_transfers_different_franchisees",
        "ck_technician_transfers_reason_length",
        "ck_technician_transfers_technician_type",
        "ck_technician_transfers_coverage_shape",
    }
    fks = {fk.name for fk in table.foreign_key_constraints if len(fk.columns) == 2}
    assert fks == {
        "fk_technician_transfers_company_technician",
        "fk_technician_transfers_company_from",
        "fk_technician_transfers_company_to",
    }
    assert {i.name for i in table.indexes} == {
        "ix_technician_transfers_company_technician",
        "ix_technician_transfers_company_from",
        "ix_technician_transfers_company_to",
    }
    assert "deleted_at" not in table.c  # append-only: no SoftDeleteMixin


def test_the_three_links_are_audited_and_the_table_is_classified():
    present = set(audit_tenancy.TENANT_LINKS)
    assert {
        ("technician_transfers", "technician_id", "technician_profiles"),
        ("technician_transfers", "from_franchisee_id", "franchisees"),
        ("technician_transfers", "to_franchisee_id", "franchisees"),
    } <= present
    assert "technician_transfers" in cleanup_db.COMPANY_TABLES
    assert "technician_transfers" not in audit_tenancy.GLOBAL_TABLES


_PATH = (
    Path(__file__).resolve().parents[2]
    / "alembic" / "versions" / "e8a2c5b7d913_technician_transfers.py"
)
_spec = importlib.util.spec_from_file_location("migration_e8a2c5b7d913", _PATH)
assert _spec is not None and _spec.loader is not None
migration = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(migration)


def test_migration_identity():
    assert migration.revision == "e8a2c5b7d913"
    assert migration.down_revision == "d6c3a9f1e874"


def test_migration_is_the_single_head_after_spare_parts():
    versions = _PATH.parent
    revs: dict[str, str | None] = {}
    for f in versions.glob("*.py"):
        text = f.read_text(encoding="utf-8")
        rev = down = None
        for line in text.splitlines():
            if line.startswith("revision") and "=" in line and rev is None:
                rev = line.split("=", 1)[1].split("#")[0].strip().strip("\"'")
            if line.startswith("down_revision") and "=" in line and down is None:
                down = line.split("=", 1)[1].split("#")[0].strip().strip("\"'")
        if rev:
            revs[rev] = down
    assert "e8a2c5b7d913" in revs
    # a chain with no branch: nobody else revises d6c3a9f1e874
    children = [r for r, d in revs.items() if d and "d6c3a9f1e874" in d]
    assert children == ["e8a2c5b7d913"]


def test_check_constraint_names_are_bare_in_create():
    source = _PATH.read_text(encoding="utf-8")
    # CHECK names are bare in the create (the convention prefixes them)
    assert 'name="ck_' not in source


# `downgrade()` opens with `n = op.get_bind().scalar(sa.text(...))` and raises
# BEFORE any `op.drop_*` while `n` is truthy. A fake bind whose `.scalar()`
# answers that one SELECT is enough to drive it — no database, no alembic
# migration context.


class _FakeBind:
    def __init__(self, count: int) -> None:
        self._count = count

    def scalar(self, clause, *args, **kwargs):  # noqa: ANN001 - test double
        text = str(clause)
        assert "technician_transfers" in text, f"unexpected query in downgrade(): {text}"
        return self._count


@pytest.mark.parametrize("count", [1, 7])
def test_migration_downgrade_refuses_while_rows_exist(
    monkeypatch: pytest.MonkeyPatch, count: int
) -> None:
    fake_bind = _FakeBind(count)
    monkeypatch.setattr(migration.op, "get_bind", lambda: fake_bind)
    with pytest.raises(RuntimeError) as exc_info:
        migration.downgrade()
    message = str(exc_info.value)
    assert "technician transfer(s) are recorded" in message
    assert f"{count} technician transfer(s) are recorded" in message


# ── the route wiring: every guard is in dependencies=[...] ──────────────────


def _route(path: str, method: str):
    for r in technicians_router.routes:
        if getattr(r, "path", None) == path and method in getattr(r, "methods", set()):
            return r
    raise AssertionError(f"no {method} {path}")


def _guard_names(route) -> list[str]:
    return [d.dependency.__qualname__ for d in route.dependencies]


def test_transfer_route_carries_all_three_guards():
    route = _route("/technicians/{technician_id}/transfer", "POST")
    names = _guard_names(route)
    assert names == [
        "require_feature.<locals>._guard",
        "require_min_rank.<locals>._guard",
        "require_staff_principal",
    ]


def test_history_route_carries_both_guards():
    route = _route("/technicians/{technician_id}/transfers", "GET")
    assert _guard_names(route) == [
        "require_feature.<locals>._guard",
        "require_staff_principal",
    ]


def test_transfer_routes_are_declared_before_the_bare_id_route():
    paths = [
        (r.path, tuple(sorted(r.methods)))
        for r in technicians_router.routes
        if hasattr(r, "methods")
    ]
    i = paths.index(("/technicians/{technician_id}/transfer", ("POST",)))
    j = paths.index(("/technicians/{technician_id}", ("GET",)))
    assert i < j
