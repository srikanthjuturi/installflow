"""Spare parts: the catalogue, and the facility's request log.

Two halves, two audiences:

  * **the catalogue** — company Admin / National Head (`parts.catalogue`) keep
    the list of parts on category nodes and product models (P1);
  * **the requests** — a franchisee's own facility staff (`parts.handle`) work
    the queue (P4). Every query below filters `company_id` AND `franchisee_id`:
    another franchisee's request is **404**, the second wall inside the company.

The technician's half (raise a request, read the parts screen) is in
`features/jobs` and delegates to `core.spare_parts`; this slice never touches a
job it does not hold the lock for.

Every action is ONE transaction: the request row (a guarded UPDATE — two facility
users racing, one wins), its ticket event, the job-status recompute under the
ticket lock (D4), the bell, and `publish_job_changed`. The push to the technician
goes out AFTER the commit, the order `penalty.reversed` uses.
"""

import datetime
import logging
import uuid

from fastapi import HTTPException, status as http_status
from sqlalchemy import Select, and_, case, func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import Principal
from app.core.errors import AppError
from app.core.notifications import notify
from app.core.part_request_out import PartRequestOut, part_request_outs
from app.core.push import send_to_technicians
from app.core.push_text import PushText
from app.core.realtime import (
    publish_job_changed,
    publish_notification,
    publish_ticket_changed,
)
from app.core.schemas import ListParams
from app.core.spare_parts import (
    CatalogueRow,
    lock_ticket,
    merge_catalogue,
    next_status,
    now,
    part_name_key,
    settle_job_status,
)
from app.db.repository import paginate
from app.features.spare_parts.schemas import (
    ApproveBody,
    CatalogueOut,
    CatalogueOwnerOut,
    IssueBody,
    PartRequestCountsOut,
    RejectBody,
    ReturnBody,
    SparePartCreate,
    SparePartOut,
    SparePartUpdate,
)
from app.models.membership import Membership
from app.models.product import ProductModel, ProductNode
from app.models.spare_part import (
    PART_REQUEST_STATUSES,
    SparePart,
    SparePartRequest,
)
from app.models.technician import TechnicianProfile
from app.models.ticket import Ticket
from app.models.ticket_event import TicketEvent
from app.models.user import User

log = logging.getLogger(__name__)


# ── catalogue ─────────────────────────────────────────────────────────────────


def _not_found(what: str) -> HTTPException:
    return HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail=f"{what} not found")


def _conflict(detail: str) -> HTTPException:
    return HTTPException(status_code=http_status.HTTP_409_CONFLICT, detail=detail)


async def _load_node(db: AsyncSession, company_id: uuid.UUID, node_id: uuid.UUID) -> ProductNode:
    """Company-scoped, never trusting the client's id: another company's → 404."""
    row = await db.scalar(
        select(ProductNode).where(
            ProductNode.id == node_id,
            ProductNode.company_id == company_id,
            ProductNode.deleted_at.is_(None),
        )
    )
    if row is None:
        raise _not_found("Category")
    return row


async def _load_model(db: AsyncSession, company_id: uuid.UUID, model_id: uuid.UUID) -> ProductModel:
    """Not vendor-pinned: the caller is staff (see the router's guards)."""
    row = await db.scalar(
        select(ProductModel).where(
            ProductModel.id == model_id,
            ProductModel.company_id == company_id,
            ProductModel.deleted_at.is_(None),
        )
    )
    if row is None:
        raise _not_found("Product")
    return row


async def _load_part(db: AsyncSession, company_id: uuid.UUID, part_id: uuid.UUID) -> SparePart:
    row = await db.scalar(
        select(SparePart).where(
            SparePart.id == part_id,
            SparePart.company_id == company_id,
            SparePart.deleted_at.is_(None),
        )
    )
    if row is None:
        raise _not_found("Part")
    return row


def _part_out(p: SparePart, owner_name: str) -> SparePartOut:
    return SparePartOut(
        id=p.id,
        name=p.name,
        isActive=p.is_active,
        ownerKind="node" if p.node_id is not None else "model",
        ownerId=p.node_id if p.node_id is not None else p.model_id,  # type: ignore[arg-type]
        ownerName=owner_name,
    )


def _row_out(r: CatalogueRow) -> SparePartOut:
    return SparePartOut(
        id=r.id,
        name=r.name,
        isActive=r.is_active,
        ownerKind=r.owner_kind,  # type: ignore[arg-type]
        ownerId=r.owner_id,
        ownerName=r.owner_name,
    )


async def _node_chain(db: AsyncSession, company_id: uuid.UUID, ids: list[uuid.UUID]) -> list[ProductNode]:
    """These nodes in the order given (root first)."""
    if not ids:
        return []
    by_id = {
        n.id: n
        for n in await db.scalars(
            select(ProductNode).where(ProductNode.company_id == company_id, ProductNode.id.in_(ids))
        )
    }
    return [by_id[i] for i in ids if i in by_id]


async def _inherited(
    db: AsyncSession, company_id: uuid.UUID, chain: list[ProductNode]
) -> list[SparePartOut]:
    """The merged, active list passed down by `chain` (root-first nodes)."""
    if not chain:
        return []
    level_of = {n.id: i for i, n in enumerate(chain)}
    name_of = {n.id: n.name for n in chain}
    rows = await db.scalars(
        select(SparePart).where(
            SparePart.company_id == company_id,
            SparePart.deleted_at.is_(None),
            SparePart.node_id.in_(list(level_of)),
        )
    )
    merged = merge_catalogue(
        CatalogueRow(
            id=p.id,
            name=p.name,
            is_active=p.is_active,
            level=level_of[p.node_id],  # type: ignore[index]
            owner_kind="node",
            owner_id=p.node_id,  # type: ignore[arg-type]
            owner_name=name_of[p.node_id],  # type: ignore[index]
        )
        for p in rows
    )
    return [_row_out(r) for r in merged]


async def node_catalogue(db: AsyncSession, principal: Principal, node_id: uuid.UUID) -> CatalogueOut:
    company_id = principal.company_id
    assert company_id is not None
    node = await _load_node(db, company_id, node_id)
    ancestors = await _node_chain(db, company_id, list(node.ancestor_ids))
    own = list(
        await db.scalars(
            select(SparePart)
            .where(
                SparePart.company_id == company_id,
                SparePart.node_id == node.id,
                SparePart.deleted_at.is_(None),
            )
            .order_by(func.lower(SparePart.name))
        )
    )
    return CatalogueOut(
        owner=CatalogueOwnerOut(
            kind="node", id=node.id, name=node.name, path=[n.name for n in ancestors]
        ),
        own=[_part_out(p, node.name) for p in own],
        inherited=await _inherited(db, company_id, ancestors),
    )


async def model_catalogue(db: AsyncSession, principal: Principal, model_id: uuid.UUID) -> CatalogueOut:
    company_id = principal.company_id
    assert company_id is not None
    model = await _load_model(db, company_id, model_id)
    node = await _load_node(db, company_id, model.node_id)
    chain = await _node_chain(db, company_id, [*node.ancestor_ids, node.id])
    own = list(
        await db.scalars(
            select(SparePart)
            .where(
                SparePart.company_id == company_id,
                SparePart.model_id == model.id,
                SparePart.deleted_at.is_(None),
            )
            .order_by(func.lower(SparePart.name))
        )
    )
    return CatalogueOut(
        owner=CatalogueOwnerOut(
            kind="model", id=model.id, name=model.name, path=[n.name for n in chain]
        ),
        own=[_part_out(p, model.name) for p in own],
        inherited=await _inherited(db, company_id, chain),
    )


async def _name_taken(
    db: AsyncSession,
    company_id: uuid.UUID,
    *,
    node_id: uuid.UUID | None,
    model_id: uuid.UUID | None,
    name: str,
    except_id: uuid.UUID | None = None,
) -> bool:
    """The same `lower(btrim(name))` the partial uniques are built on."""
    stmt = select(SparePart.id).where(
        SparePart.company_id == company_id,
        SparePart.deleted_at.is_(None),
        func.lower(func.btrim(SparePart.name)) == part_name_key(name),
        SparePart.node_id == node_id if node_id is not None else SparePart.model_id == model_id,
    )
    if except_id is not None:
        stmt = stmt.where(SparePart.id != except_id)
    return (await db.scalar(stmt.limit(1))) is not None


async def add_part(
    db: AsyncSession,
    principal: Principal,
    body: SparePartCreate,
    *,
    node_id: uuid.UUID | None = None,
    model_id: uuid.UUID | None = None,
) -> SparePartOut:
    company_id = principal.company_id
    assert company_id is not None
    if node_id is not None:
        owner_name = (await _load_node(db, company_id, node_id)).name
    else:
        assert model_id is not None
        owner_name = (await _load_model(db, company_id, model_id)).name
    if await _name_taken(db, company_id, node_id=node_id, model_id=model_id, name=body.name):
        raise _conflict(f'"{body.name}" is already on this list.')
    part = SparePart(
        company_id=company_id,
        node_id=node_id,
        model_id=model_id,
        name=body.name,
        is_active=True,
        created_by=principal.user_id,
    )
    db.add(part)
    await db.commit()
    await db.refresh(part)
    return _part_out(part, owner_name)


async def _owner_name(db: AsyncSession, part: SparePart) -> str:
    if part.node_id is not None:
        name = await db.scalar(select(ProductNode.name).where(ProductNode.id == part.node_id))
    else:
        name = await db.scalar(select(ProductModel.name).where(ProductModel.id == part.model_id))
    return name or ""


async def update_part(
    db: AsyncSession, principal: Principal, part_id: uuid.UUID, body: SparePartUpdate
) -> SparePartOut:
    company_id = principal.company_id
    assert company_id is not None
    part = await _load_part(db, company_id, part_id)
    if body.name is not None and part_name_key(body.name) != part_name_key(part.name):
        if await _name_taken(
            db,
            company_id,
            node_id=part.node_id,
            model_id=part.model_id,
            name=body.name,
            except_id=part.id,
        ):
            raise _conflict(f'"{body.name}" is already on this list.')
    if body.name is not None:
        part.name = body.name
    if body.isActive is not None:
        part.is_active = body.isActive
    part.updated_by = principal.user_id
    owner = await _owner_name(db, part)
    await db.commit()
    await db.refresh(part)
    return _part_out(part, owner)


async def delete_part(db: AsyncSession, principal: Principal, part_id: uuid.UUID) -> None:
    """Soft delete. Requests keep pointing at the row (RESTRICT is not tripped by
    a soft delete) and keep their frozen `part_name`."""
    company_id = principal.company_id
    assert company_id is not None
    part = await _load_part(db, company_id, part_id)
    part.deleted_at = now()
    part.updated_by = principal.user_id
    await db.commit()


# ── requests: reads ───────────────────────────────────────────────────────────

#: The queue's order: what needs doing first, then the settled ones.
_STATUS_ORDER = ("requested", "approved", "issued", "returned", "rejected")

#: D22: everything still on the facility's desk, including an issued part whose
#: old twin has not come back.
DEFAULT_STATUSES = ("requested", "approved", "issued")


def _desk(principal: Principal) -> Select:
    """Every request this facility may touch. `company_id` AND `franchisee_id` —
    the franchise wall (index §5.1)."""
    return select(SparePartRequest).where(
        SparePartRequest.company_id == principal.company_id,
        SparePartRequest.franchisee_id == principal.franchisee_id,
    )


def parse_statuses(raw: str | None) -> tuple[str, ...] | None:
    """The comma-set filter. None = an unknown member, which EMPTIES the page
    (the `/tickets` rule: a stale bookmark must not 422 the screen)."""
    if raw is None or not raw.strip():
        return DEFAULT_STATUSES
    wanted = tuple(dict.fromkeys(t.strip() for t in raw.split(",") if t.strip()))
    if not wanted or any(t not in PART_REQUEST_STATUSES for t in wanted):
        return None
    return wanted


async def list_requests(
    db: AsyncSession, principal: Principal, params: ListParams, *, status: str | None
) -> tuple[list[PartRequestOut], int]:
    assert principal.company_id is not None
    wanted = parse_statuses(status)
    if wanted is None:
        return [], 0
    stmt = _desk(principal).where(SparePartRequest.status.in_(wanted))
    if params.search:
        term = f"%{params.search.strip().lower()}%"
        stmt = (
            stmt.join(
                Ticket,
                and_(Ticket.company_id == SparePartRequest.company_id, Ticket.id == SparePartRequest.ticket_id),
            )
            .join(
                TechnicianProfile,
                and_(
                    TechnicianProfile.company_id == SparePartRequest.company_id,
                    TechnicianProfile.id == SparePartRequest.technician_id,
                ),
            )
            .join(Membership, Membership.id == TechnicianProfile.membership_id)
            .join(User, User.id == Membership.user_id)
            .where(
                or_(
                    func.lower(SparePartRequest.code).like(term),
                    func.lower(Ticket.code).like(term),
                    func.lower(SparePartRequest.part_name).like(term),
                    func.lower(User.full_name).like(term),
                )
            )
        )
    order = case(
        *[(SparePartRequest.status == s, i) for i, s in enumerate(_STATUS_ORDER)],
        else_=len(_STATUS_ORDER),
    )
    # Oldest waiting first, `id` as the total tie-break for paging.
    stmt = stmt.order_by(order, SparePartRequest.created_at.asc(), SparePartRequest.id.asc())
    rows, total = await paginate(db, stmt, page=params.page, limit=params.limit)
    return await part_request_outs(db, principal.company_id, rows), total


async def counts(db: AsyncSession, principal: Principal) -> PartRequestCountsOut:
    rows = dict(
        (
            await db.execute(
                select(SparePartRequest.status, func.count())
                .where(
                    SparePartRequest.company_id == principal.company_id,
                    SparePartRequest.franchisee_id == principal.franchisee_id,
                    SparePartRequest.status.in_(DEFAULT_STATUSES),
                )
                .group_by(SparePartRequest.status)
            )
        ).all()
    )
    return PartRequestCountsOut(
        requested=rows.get("requested", 0),
        approved=rows.get("approved", 0),
        issued=rows.get("issued", 0),
    )


async def _load_request(
    db: AsyncSession, principal: Principal, request_id: uuid.UUID
) -> SparePartRequest:
    row = await db.scalar(_desk(principal).where(SparePartRequest.id == request_id))
    if row is None:
        raise _not_found("Request")
    return row


async def get_request(
    db: AsyncSession, principal: Principal, request_id: uuid.UUID
) -> PartRequestOut:
    assert principal.company_id is not None
    row = await _load_request(db, principal, request_id)
    return (await part_request_outs(db, principal.company_id, [row]))[0]


# ── requests: the four actions ────────────────────────────────────────────────


def _bad_state(current: str) -> AppError:
    return AppError(
        http_status.HTTP_409_CONFLICT,
        "PART_REQUEST_BAD_STATE",
        f"This request is already {current} — refresh to see where it is.",
    )


def _label(principal: Principal) -> str:
    return principal.user.full_name or principal.user.email or "—"


async def _technician_label(
    db: AsyncSession, company_id: uuid.UUID, technician_id: uuid.UUID
) -> str:
    name = await db.scalar(
        select(User.full_name)
        .join(Membership, Membership.user_id == User.id)
        .join(TechnicianProfile, TechnicianProfile.membership_id == Membership.id)
        .where(TechnicianProfile.company_id == company_id, TechnicianProfile.id == technician_id)
    )
    return name or "the technician"


async def _add_to_catalogue(
    db: AsyncSession, principal: Principal, req: SparePartRequest, ticket: Ticket
) -> tuple[SparePart, str]:
    """D13: find-or-create `spare_parts(node_id = ticket.node_id, name)`. A
    non-deleted row with that `lower(btrim(name))` already on the node is LINKED,
    not duplicated, and its `is_active` is left alone. Returns the row and the
    node's name (for the trail)."""
    company_id = principal.company_id
    assert company_id is not None and req.other_name is not None
    node_name = await db.scalar(
        select(ProductNode.name).where(
            ProductNode.company_id == company_id, ProductNode.id == ticket.node_id
        )
    )
    existing = await db.scalar(
        select(SparePart).where(
            SparePart.company_id == company_id,
            SparePart.node_id == ticket.node_id,
            SparePart.deleted_at.is_(None),
            func.lower(func.btrim(SparePart.name)) == part_name_key(req.other_name),
        )
    )
    if existing is not None:
        return existing, node_name or ""
    part = SparePart(
        company_id=company_id,
        node_id=ticket.node_id,
        name=req.other_name,
        is_active=True,
        created_by=principal.user_id,
    )
    db.add(part)
    await db.flush()
    return part, node_name or ""


async def act(
    db: AsyncSession,
    principal: Principal,
    request_id: uuid.UUID,
    action: str,
    *,
    body: ApproveBody | RejectBody | IssueBody | ReturnBody,
) -> PartRequestOut:
    """One facility action — approve, reject, issue or return — in one transaction.

    The ticket is locked (`FOR NO KEY UPDATE`, D4) before anything is decided,
    and the request is RE-READ under that lock, so two facility users racing for
    the same request are serialised and the loser sees the true state. The
    guarded UPDATE (`WHERE status = :current`) is the second belt: whatever
    slipped past, exactly one of them lands.
    """
    company_id = principal.company_id
    assert company_id is not None and principal.franchisee_id is not None

    req = await _load_request(db, principal, request_id)
    ticket = await lock_ticket(db, company_id, req.ticket_id)
    if ticket is None:  # CASCADE makes this unreachable
        raise _not_found("Request")
    await db.refresh(req)

    current = req.status
    to = next_status(current, action)
    if to is None:
        raise _bad_state(current)

    if action == "return" and isinstance(body, ReturnBody) and body.photoBlobName:
        blob_name = body.photoBlobName
        if not blob_name.startswith(f"attachment/{company_id}/") or ".." in blob_name:
            raise HTTPException(
                status_code=http_status.HTTP_400_BAD_REQUEST,
                detail="Upload the photo through this API first",
            )

    when = now()
    actor = _label(principal)
    values: dict[str, object] = {"status": to, "updated_by": principal.user_id}
    note = f"{req.code} · {req.part_name}"
    event_kind = f"part_{to}"

    if action == "approve":
        values.update(
            decided_at=when, decided_by_user_id=principal.user_id, decided_by_label=actor
        )
        assert isinstance(body, ApproveBody)
        if body.addToCatalogue and req.spare_part_id is None:
            part, node_name = await _add_to_catalogue(db, principal, req, ticket)
            # The index's CHECK is *exactly one* of the two: link the row and
            # clear the typed name. `part_name` keeps what the technician typed.
            values.update(spare_part_id=part.id, other_name=None)
            note += f" · added to {node_name}'s parts list"
    elif action == "reject":
        assert isinstance(body, RejectBody)
        # Where the rejection came from; a rejection of an APPROVED request
        # overwrites decided_* with the rejecting person (the approval stays in
        # its own `part_approved` event).
        values.update(
            decided_at=when,
            decided_by_user_id=principal.user_id,
            decided_by_label=actor,
            reject_reason=body.reason,
            rejected_from=current,
        )
        note += f" · {current} → rejected · {body.reason}"
    elif action == "issue":
        assert isinstance(body, IssueBody)
        values.update(
            issued_at=when,
            issued_by_user_id=principal.user_id,
            issued_by_label=actor,
            issue_note=body.note,
        )
        if body.note:
            note += f" · {body.note}"
    else:  # return
        assert isinstance(body, ReturnBody)
        values.update(
            returned_at=when,
            returned_by_user_id=principal.user_id,
            returned_by_label=actor,
            return_note=body.note,
            return_photo_blob_name=body.photoBlobName,
        )
        if body.note:
            note += f" · {body.note}"
        if body.photoBlobName:
            note += " · with photo"

    result = await db.execute(
        update(SparePartRequest)
        .where(
            SparePartRequest.id == req.id,
            SparePartRequest.company_id == company_id,
            SparePartRequest.franchisee_id == principal.franchisee_id,
            SparePartRequest.status == current,
        )
        .values(**values)
        .execution_options(synchronize_session=False)
    )
    if result.rowcount == 0:
        raise _bad_state(current)
    await db.refresh(req)

    db.add(
        TicketEvent(
            company_id=company_id,
            ticket_id=ticket.id,
            kind=event_kind,
            actor_kind="staff",  # D19: ACTOR_KINDS is not widened for facility staff
            actor_label=actor,
            created_by=principal.user_id,
            note=note,
        )
    )

    # `approve` and `return` cannot change the job's status (an approved request
    # is still open; a returned one was issued first). reject/issue can.
    if action in ("reject", "issue"):
        await settle_job_status(
            db, ticket, actor_kind="staff", actor_label=actor, by_user=principal.user_id
        )

    technician = await _technician_label(db, company_id, req.technician_id)
    if action == "reject":
        was_approved = current == "approved"
        row = await notify(
            db,
            company_id=company_id,
            kind="part_decided",
            title=(
                f"{ticket.code}: approved part cancelled"
                if was_approved
                else f"{ticket.code}: spare part not approved"
            ),
            detail=f"{req.part_name} · {req.reject_reason}",
            to=f"/tickets/{ticket.id}",
            ticket_id=ticket.id,
            pincode=ticket.pincode,
        )
        await publish_notification(
            db, company_id=company_id, pincode=ticket.pincode, notification_id=row.id
        )
    elif action == "issue":
        row = await notify(
            db,
            company_id=company_id,
            kind="part_issued",
            title=f"{ticket.code}: spare part issued",
            detail=f"{req.part_name} to {technician} — book the revisit if one is needed",
            to=f"/tickets/{ticket.id}",
            ticket_id=ticket.id,
            pincode=ticket.pincode,
        )
        await publish_notification(
            db, company_id=company_id, pincode=ticket.pincode, notification_id=row.id
        )

    # Every action — all four — so an open job screen refetches.
    await publish_ticket_changed(db, ticket)
    await publish_job_changed(
        db, company_id=company_id, technician_id=req.technician_id, ticket_id=ticket.id
    )

    push: PushText | None = None
    if action == "approve":
        push = PushText("part.approved", code=ticket.code, part=req.part_name)
    elif action == "reject":
        key = "part.rejected_after_approval" if current == "approved" else "part.rejected"
        push = PushText(key, code=ticket.code, part=req.part_name, reason=req.reject_reason or "")
    elif action == "issue":
        push = PushText("part.issued", code=ticket.code, part=req.part_name)
    technician_id, ticket_id, ticket_code = req.technician_id, ticket.id, ticket.code
    request_id_out = req.id

    await db.commit()

    # After commit, like `penalty.reversed`: a phone told about a change that
    # then failed to save is worse than a phone told nothing. Never fails the
    # request — it is already done.
    if push is not None:
        try:
            await send_to_technicians(
                db,
                company_id=company_id,
                technician_ids=[technician_id],
                message=push,
                data={"type": "job", "ticketId": str(ticket_id), "code": ticket_code},
            )
        except Exception:  # noqa: BLE001
            log.exception("spare parts: push for %s failed", request_id_out)

    return await get_request(db, principal, request_id_out)
