"""Moving a technician between franchisees (Task 17) — the database half.

The decisions are pure and live in `app.core.technician_transfer`; this reads
the facts, calls them, and writes the move. It sits INSIDE the technicians
slice because it needs `_load`, `set_coverage`, `set_membership_region` and
`_open_job_count` — so no slice imports another (hard rule 4).

## Authority is `franchisees.manage`, not `_load_managed`

`_load_managed` answers "may this caller manage this technician?" and for a
non-home technician the answer is the franchisee admin's alone (F7) — it would
403 every non-home technician for an Admin/NH. Moving people between
franchisees is the one deliberate exception: the route carries
`franchisees.manage` + a National-Head floor + `require_staff_principal`, and
this module loads the technician with the ordinary `_load` (staff visibility),
so another company's technician — or one outside the caller's scope — is a 404,
never a 403.

## What is written, and what deliberately is not

`technician_profiles.franchisee_id`, the coverage rows, the region when the new
coverage lies in one other region, a pending UPI change's reviewer, one audit
row and two bells — one transaction, then a push. NO `UPDATE tickets`, NO
`UPDATE ledger_entries`, NO `UPDATE redemptions`: history stays where it was
earned (§4.6), and the guards (no open job, no redeemable money) are what make
that true — with neither, nothing but a reversal can write a row against the
technician, and a reversal copies the row it reverses.

## The race this does not close, on purpose (§4.9 trap 2)

`jobs.service.accept` does not lock the profile row, so an accept landing in
the instant between the open-job count and the commit leaves the technician
holding a job whose ticket is stamped the OLD franchisee. That is exactly the
state a carve-out already leaves (F6: assigned jobs keep their franchisee); the
job completes normally and its money is stamped to the technician's franchisee
at write time. Documented, not locked.
"""

import logging
import uuid
from datetime import datetime, timezone

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import technician_transfer as tt
from app.core.coverage import upi_reviewer
from app.core.deps import Principal
from app.core.errors import AppError
from app.core.franchise import franchisees_for_pincodes, lock_routing
from app.core.franchise_logins import active_admin_count
from app.core.franchise_routing import outside_message
from app.core.ledger import (
    open_redemption_code,
    redeemable_balance,
)
from app.core.notifications import notify
from app.core.push import send_to_technician
from app.core.push_text import PushText
from app.core.realtime import publish_notification, publish_technician_changed
from app.features.technicians import service
from app.features.technicians.schemas import (
    TechnicianTransferOut,
    TechnicianTransferRequest,
    TechnicianTransferRowOut,
    TransferBlockerOut,
    TransferCoverageOut,
)
from app.models.franchisee import Franchisee
from app.models.technician import TechnicianPincode, TechnicianProfile
from app.models.technician_transfer import TechnicianTransfer
from app.models.territory import Pincode, Region, State
from app.models.upi_change import UpiChangeRequest

logger = logging.getLogger(__name__)


def _now() -> datetime:
    return datetime.now(timezone.utc)


async def _franchisee(
    session: AsyncSession, company_id: uuid.UUID, franchisee_id: uuid.UUID
) -> Franchisee:
    """A live franchisee of THIS company, else 404 — another company's franchisee
    is a 404, never a 409 naming it."""
    row = await session.scalar(
        select(Franchisee).where(
            Franchisee.company_id == company_id,
            Franchisee.id == franchisee_id,
            Franchisee.deleted_at.is_(None),
        )
    )
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Franchisee not found")
    return row


def _row_out(
    row: TechnicianTransfer, names: dict[uuid.UUID, str]
) -> TechnicianTransferRowOut:
    kept, trimmed, added = tt.coverage_diff(row.coverage_before, row.coverage_after)
    return TechnicianTransferRowOut(
        id=row.id,
        at=row.transferred_at,
        technicianId=row.technician_id,
        fromFranchiseeId=row.from_franchisee_id,
        fromFranchiseeName=names.get(row.from_franchisee_id, "—"),
        toFranchiseeId=row.to_franchisee_id,
        toFranchiseeName=names.get(row.to_franchisee_id, "—"),
        technicianType=row.technician_type,
        reason=row.reason,
        byUserId=row.transferred_by_user_id,
        byName=row.transferred_by_label,
        kept=kept,
        trimmed=trimmed,
        added=added,
    )


async def _names(
    session: AsyncSession, company_id: uuid.UUID, ids: set[uuid.UUID]
) -> dict[uuid.UUID, str]:
    if not ids:
        return {}
    rows = await session.execute(
        select(Franchisee.id, Franchisee.name).where(
            Franchisee.company_id == company_id, Franchisee.id.in_(ids)
        )
    )
    return dict(rows.all())


async def list_transfers(
    session: AsyncSession, principal: Principal, technician_id: uuid.UUID
) -> list[TechnicianTransferRowOut]:
    """The technician's moves, newest first. `_load` first: 404 when the
    technician is outside the caller's company or scope."""
    profile, _membership, _user = await service._load(session, principal, technician_id)
    rows = list(
        await session.scalars(
            select(TechnicianTransfer)
            .where(
                TechnicianTransfer.company_id == principal.company_id,
                TechnicianTransfer.technician_id == profile.id,
            )
            .order_by(TechnicianTransfer.transferred_at.desc(), TechnicianTransfer.id.desc())
        )
    )
    names = await _names(
        session,
        principal.company_id,
        {r.from_franchisee_id for r in rows} | {r.to_franchisee_id for r in rows},
    )
    return [_row_out(r, names) for r in rows]


def _error_for(blocker: tt.Blocker, *, region: tt.Blocker | None) -> HTTPException:
    """The first blocker as the error an apply raises: coded -> `AppError`,
    code-less -> a plain `HTTPException`. `PINCODE_OUTSIDE_FRANCHISEE` is 422
    (the status Tasks 04/05/09 fixed); so is the two-regions refusal."""
    if blocker is region:
        return HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, blocker.message)
    if blocker.code == tt.CODE_OUTSIDE:
        return AppError(status.HTTP_422_UNPROCESSABLE_ENTITY, blocker.code, blocker.message)
    if blocker.code is None:
        return HTTPException(status.HTTP_409_CONFLICT, blocker.message)
    return AppError(status.HTTP_409_CONFLICT, blocker.code, blocker.message)


async def transfer_technician(
    session: AsyncSession,
    principal: Principal,
    technician_id: uuid.UUID,
    body: TechnicianTransferRequest,
    *,
    dry_run: bool,
) -> TechnicianTransferOut:
    company_id = principal.company_id

    # 1. Load. 404 for another company's / out-of-scope technician and for a
    #    franchisee that is not ours.
    profile, membership, user = await service._load(session, principal, technician_id)
    to = await _franchisee(session, company_id, body.franchiseeId)
    name = user.full_name or profile.code

    if not dry_run:
        problem = tt.reason_problem(body.reason, name=name)
        if problem:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, problem)

        # 2. Apply only. Routing (shared) first - a carve-out in flight is waited
        #    for, then judged - then the profile row FOR UPDATE, the lock
        #    `redemptions.service.request` and `request_upi_change` also take, so
        #    neither can slip between our checks and our commit. A dry run takes
        #    NO lock: previews never queue behind saves (Task 03). Re-selected
        #    with populate_existing: two moves of the same person queue here, and
        #    the second must judge the franchisee the first left.
        await lock_routing(session, company_id, exclusive=False)
        locked = await session.scalar(
            select(TechnicianProfile)
            .where(
                TechnicianProfile.company_id == company_id,
                TechnicianProfile.id == profile.id,
            )
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        assert locked is not None
        profile = locked

    frm = await _franchisee(session, company_id, profile.franchisee_id)

    # 3. Facts - after the lock on apply.
    open_jobs = await service._open_job_count(session, profile)
    redeemable = await redeemable_balance(
        session, company_id=company_id, technician_id=profile.id
    )
    open_code = await open_redemption_code(
        session, company_id=company_id, technician_id=profile.id
    )
    admins = await active_admin_count(session, company_id=company_id, franchisee_id=to.id)
    current = sorted(
        await session.scalars(
            select(TechnicianPincode.pincode).where(
                TechnicianPincode.company_id == company_id,
                TechnicianPincode.technician_id == profile.id,
            )
        )
    )
    supplied = body.pincodes
    wanted = set(current) | set(supplied or ())
    if profile.base_pincode:
        wanted.add(profile.base_pincode)
    routes = await franchisees_for_pincodes(session, company_id, wanted)

    # 4. Plan.
    plan = tt.plan_coverage(current, routes, to.id, supplied)

    # 5. Region. A supplied code must be a real pincode (the master is the only
    #    thing that knows which region it is in); the region then FOLLOWS the
    #    coverage (D5) - one region, or a refusal that names both.
    region_of: dict[str, uuid.UUID] = {}
    region_names: dict[uuid.UUID, str] = {}
    if plan.final:
        rows = await session.execute(
            select(Pincode.code, State.region_id, Region.name)
            .join(State, State.id == Pincode.state_id)
            .join(Region, Region.id == State.region_id)
            .where(Pincode.code.in_(plan.final))
        )
        for code, region_id, region_name in rows.all():
            region_of[code] = region_id
            region_names[region_id] = region_name
    if supplied:
        unknown = sorted(set(supplied) - set(region_of))
        if unknown:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                f"Not a pincode we know: {', '.join(unknown[:20])}.",
            )
    own_region_name = await session.scalar(
        select(Region.name).where(Region.id == profile.region_id)
    )
    region_blocker: tt.Blocker | None = None
    new_region: uuid.UUID | None = None
    regions_after = {region_of[c] for c in plan.final if c in region_of}
    try:
        new_region = tt.single_region(regions_after)
    except ValueError:
        region_blocker = tt.Blocker(
            None, tt.multi_region_message(region_names[r] for r in regions_after)
        )
    region_changed = new_region is not None and new_region != profile.region_id
    region_after_name = (
        region_names.get(new_region, own_region_name)
        if new_region is not None
        else own_region_name
    )

    # 6. Blockers and warnings.
    outside_text: str | None = None
    if plan.outside:
        owner_ids = {routes[c] for c in plan.outside if c in routes}
        owner_names = await _names(session, company_id, owner_ids)
        outside_text = outside_message(
            to.name,
            plan.outside,
            owner_names={
                c: owner_names[routes[c]]
                for c in plan.outside
                if c in routes and routes[c] in owner_names
            },
        )
    blockers = tt.transfer_blockers(
        same_franchisee=profile.franchisee_id == to.id,
        target_name=to.name,
        target_active=to.is_active,
        target_is_home=to.is_home,
        target_active_admins=admins,
        technician_code=profile.code,
        technician_name=name,
        open_jobs=open_jobs,
        redeemable_paise=redeemable,
        open_redemption_code=open_code,
        plan=plan,
        outside_text=outside_text,
    )
    if region_blocker is not None:
        # Last in the order: it only matters once nothing more basic is in the way.
        blockers.append(region_blocker)

    pending = await session.scalar(
        select(UpiChangeRequest).where(
            UpiChangeRequest.company_id == company_id,
            UpiChangeRequest.technician_id == profile.id,
            UpiChangeRequest.status == "pending",
        )
    )
    base_outside = bool(profile.base_pincode) and routes.get(profile.base_pincode) != to.id
    warnings = tt.transfer_warnings(
        technician_name=name,
        target_name=to.name,
        redeemable_paise=redeemable,
        pending_upi_change=pending is not None,
        base_pincode_outside=base_outside,
        base_pincode=profile.base_pincode,
    )

    coverage_out = TransferCoverageOut(
        source=plan.source,
        kept=list(plan.kept),
        trimmed=list(plan.trimmed),
        added=list(plan.added),
        after=list(plan.final),
        keptCount=len(plan.kept),
        trimmedCount=len(plan.trimmed),
        addedCount=len(plan.added),
        regionBefore=own_region_name,
        regionAfter=region_after_name,
        regionChanged=region_changed,
    )

    def _out(*, dry: bool, row_out: TechnicianTransferRowOut | None) -> TechnicianTransferOut:
        return TechnicianTransferOut(
            dryRun=dry,
            technicianId=profile.id,
            technicianCode=profile.code,
            technicianName=name,
            technicianType=profile.technician_type,
            fromFranchiseeId=frm.id,
            fromFranchiseeName=frm.name,
            fromFranchiseeIsHome=frm.is_home,
            toFranchiseeId=to.id,
            toFranchiseeName=to.name,
            toFranchiseeIsHome=to.is_home,
            coverage=coverage_out,
            blockers=[
                TransferBlockerOut(
                    code=b.code,
                    message=b.message,
                    openJobs=b.open_jobs,
                    redeemablePaise=b.redeemable_paise,
                    redemptionCode=b.redemption_code,
                )
                for b in blockers
            ],
            warnings=warnings,
            canTransfer=not blockers,
            transfer=row_out,
        )

    # 7. Dry run: read, roll back, write nothing.
    if dry_run:
        result = _out(dry=True, row_out=None)
        await session.rollback()
        return result
    if blockers:
        # Nothing has been written; release the routing lock and the row lock.
        error = _error_for(blockers[0], region=region_blocker)
        await session.rollback()
        raise error

    # 8. Write - one transaction, in this order.
    actor = principal.user_id
    from_id, from_name, from_home = frm.id, frm.name, frm.is_home
    reason = (body.reason or "").strip()
    technician_type = profile.technician_type
    code = profile.code
    profile.franchisee_id = to.id
    profile.updated_by = actor
    if plan.changed:
        await service.set_coverage(
            session, profile=profile, pincodes=list(plan.final), actor_id=actor
        )
    else:
        await session.flush()
    if region_changed and new_region is not None:
        profile.region_id = new_region
        await service.set_membership_region(
            session, membership=membership, region_id=new_region, actor_id=actor
        )

    if pending is not None:
        # D6: it is the technician's request, not the old franchisee's - re-address
        # it. `upi_reviewer` reads the profile's NEW franchisee (flushed above).
        role, pincode, reviewer_franchisee = await upi_reviewer(
            session, company_id=company_id, technician_id=profile.id
        )
        pending.reviewer_role = role
        pending.updated_by = actor
        raised = await notify(
            session,
            company_id=company_id,
            kind="upi_change",
            title=f"{name} asked to change their UPI ID",
            detail=f"{code} · {pending.old_upi_id} → {pending.new_upi_id}",
            to=f"/technicians/{profile.id}",
            pincode=pincode,
            audience=role,
            franchisee_id=reviewer_franchisee,
        )
        await publish_notification(
            session,
            company_id=company_id,
            pincode=pincode,
            notification_id=raised.id,
            audience=role,
            franchisee_id=reviewer_franchisee,
        )

    by_label = (principal.user.full_name or "").strip() or "—"
    row = TechnicianTransfer(
        company_id=company_id,
        technician_id=profile.id,
        from_franchisee_id=from_id,
        to_franchisee_id=to.id,
        technician_type=technician_type,
        reason=reason,
        coverage_before=list(current),
        coverage_after=list(plan.final),
        transferred_by_user_id=actor,
        transferred_by_label=by_label[:120],
        transferred_at=_now(),
        created_by=actor,
    )
    session.add(row)
    await session.flush()  # hard rule 10

    # Two bells (§4.8), one per side, each the way that reaches it: a non-home
    # side is `franchisee_admin` + its id; the HOME side is company-wide (home's
    # admins are company staff, F8) carrying the home id, which also reaches
    # home's own franchisee admins.
    (join_title, join_detail), (leave_title, leave_detail) = tt.transfer_notices(
        technician_name=name,
        technician_code=code,
        from_name=from_name,
        to_name=to.name,
        reason=reason,
    )
    for side_id, side_home, title, detail, path in (
        (to.id, to.is_home, join_title, join_detail, f"/technicians/{profile.id}"),
        (from_id, from_home, leave_title, leave_detail, "/technicians"),
    ):
        audience = None if side_home else "franchisee_admin"
        bell = await notify(
            session,
            company_id=company_id,
            kind=tt.NOTIFICATION_KIND,
            title=title,
            detail=detail,
            to=path,
            audience=audience,
            franchisee_id=side_id,
        )
        await publish_notification(
            session,
            company_id=company_id,
            pincode=None,
            notification_id=bell.id,
            audience=audience,
            franchisee_id=side_id,
        )
    await publish_technician_changed(
        session, company_id=company_id, technician_id=profile.id
    )

    names = {from_id: from_name, to.id: to.name}
    row_out = _row_out(row, names)
    result = _out(dry=False, row_out=row_out)
    technician_id_for_push = profile.id
    to_name = to.name

    # 9. Commit; the push goes after it (a push cannot be rolled back, and a
    #    phone must never be told about a move that failed to save).
    await session.commit()
    try:
        await send_to_technician(
            session,
            company_id=company_id,
            technician_id=technician_id_for_push,
            message=PushText("technician.moved", franchisee=to_name),
            # `type: job` and NO ticket id (the `penalty.reversed` shape):
            # installed builds refresh jobs, earnings and `me` on any job push,
            # and an id would route a tap to a job screen that 404s.
            data={"type": "job"},
        )
    except Exception:  # noqa: BLE001 - a failed push never fails the move
        logger.exception("technician.moved push failed for %s", technician_id_for_push)
    return result
