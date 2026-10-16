# Task 18 — Hand an unassigned ticket to another franchisee

> Read [00-index.md](00-index.md) first. It owns every name used here. This task assumes Task 01
> (`tickets.franchisee_id`, `app/core/franchise.py`), Task 03 (the carve-out, `lock_routing`, the
> `franchisee_changed` event kind), Task 04 (the franchisee predicate in **all five** eligibility places,
> `restamp_ticket`, `core/franchise_routing.py`, `PoolChanged.franchisee_id`), Task 05 (the
> `franchisee_admin` notification audience, the `franchiseeId` filter on `GET /technicians`) and
> Task 09 (the franchise portal that reads `/tickets`) exist **exactly** as those documents name them.
>
> Layer: **api + adminWeb**. No mobile change — installed apps are untouched (§5). Depends on 04, 05
> and 09; reads Task 12's `Awaiting Part` only to refuse (§4.2). Added after the first draft of the index,
> so its names are in §9 for the index owner to merge — nothing in 00–16 is edited by this document.
>
> **Owner ruling 2026-10-16:** *"Company staff can hand the ticket to another franchisee."*

---

## 1. Goal and why

**Plain version.** A ticket belongs to the franchisee that owns its pincode (F4), and only that
franchisee's technicians are offered it (index §5.5). Usually that is exactly right. Sometimes it
strands the job: SkyFix owns `500032`, but nobody at SkyFix is certified for air conditioners, or all
three of their technicians are at the daily cap, or everybody is offline. The ticket sits in the pool
until the service level runs out. Today a manager can only wait, add a bonus (which re-offers it to the
**same** three people) or assign one of those same people by hand.

This task gives company staff — an Area Manager or above, whoever can already assign or reschedule that
ticket — one more move: **hand the ticket to a different franchisee**, with a written reason. The
other franchisee's technicians are offered it, the first to accept wins as ever, and the timeline says
who moved it, from where, to where, and why.

**The design problem, and the answer.** Eligibility is two facts that cannot both be true here:

1. `technician.franchisee_id = ticket.franchisee_id` (Task 04), **and**
2. the technician covers the ticket's pincode (`technician_pincodes`).

Task 04 makes (2) always imply the franchisee owns the pincode, because a technician's coverage must lie
inside their own franchisee's range (`PINCODE_OUTSIDE_FRANCHISEE`). So a pincode SkyFix owns can **never**
appear in another franchisee's technicians' coverage — and a plain re-stamp of the ticket to Acme
Secunderabad would satisfy (1) and fail (2) for every technician in the company. The ticket would
vanish from SkyFix's pool and appear in nobody's: **stranded**, and worse than before.

**The mechanism (H1):** one new column, **`tickets.routing_override boolean NOT NULL DEFAULT false`**.
It means *"a person chose this ticket's franchisee; the pincode did not."* When it is true:

- the franchisee test (1) is unchanged — the ticket's stamp is still the only franchisee whose
  technicians may take it;
- the **pincode-coverage** test (2) is **waived** — certification, `ACTIVE`, the daily cap and
  `accepting_work` all still apply;
- nothing that re-routes by pincode (a carve-out, the release re-stamp) is allowed to touch the stamp
  until a person hands it back or the franchisee is deactivated (§4.5).

The flag is **derived, not typed**: the server sets `routing_override = (target ≠ owner of the pincode)`.
Handing a ticket *back* to the franchisee that owns the pincode therefore clears the flag and the
ticket is an ordinary ticket again. The console never sends it.

**Worked example.** Acme Appliances: home franchisee **Acme Appliances** (code `HOME`), **Acme Secunderabad**
(internal, owns 500003–500015), **SkyFix Services** (external, owns 500030–500040). Ticket
`ACM-INST-0500`, an air conditioner at `500032`, `Slot Pending`, raised by Crestline Distributors.

| Moment | What happens |
|---|---|
| Intake | Stamped SkyFix (Task 01). SkyFix has two technicians, neither certified for *Air conditioners*. Nobody is offered it. |
| 09:10 | It escalates to Kavitha, the Area Manager for Telangana. She opens it: **Hand to another franchisee** is on the page. |
| The dialog | *SkyFix Services (current) — 0 eligible · Acme Secunderabad — 3 eligible, 2 online · Acme Appliances (home) — 1 eligible, 0 online.* She picks Acme Secunderabad and writes *"SkyFix has no AC-certified technician"*. |
| Confirm | One transaction: `franchisee_id` = Acme Secunderabad, `routing_override` = true (it does not own `500032`), status `Escalated → Slot Pending` (it was still offerable — the same exit a bonus gives it), one `franchisee_changed` event, one bell to Acme Secunderabad's admin. After the commit, the 2 online technicians are pushed. |
| SkyFix | Their pool socket rings and their app drops the card. Their admin opens `ACM-INST-0500` → **404**. |
| Acme Secunderabad | Their admin opens it → read-only ticket page with the new timeline entry. Sunil, certified for ACs and 14 km away, accepts it. **The coverage test was waived**; he covers none of `500030–500040`. |
| Sunil cancels next day | The job is released; `restamp_ticket` sees `routing_override` and **leaves the stamp alone**. Acme Secunderabad's technicians — not SkyFix's — are offered it again. |
| Money | Sunil closes it. Payout, travel and speed are written against **Acme Secunderabad** (the technician's franchisee at write time, F12). SkyFix never sees a rupee of it. |

---

## 2. Decisions implemented

| ID | Source | How |
|---|---|---|
| F4, F6 | index | Pincode ownership still stamps the ticket at intake. A hand-over is the one **human** exception, and F6's carve-out never undoes it (§4.5). |
| F7 | index | Tickets stay company work: the move is a **staff** action. A franchisee admin has no hand-over, and its ticket page stays read-only (F13). |
| F13 | index | After the move the source franchisee's admin gets 404 (their read is `tickets.franchisee_id = mine`, Task 04 §4.4); the target's admin reads it. No new read code. |
| §5.5 | index | Eligibility in five places. This task changes **the pincode half** in each (§4.3) and nothing about the franchisee half. |
| §3.3 | index | `ticket_events.kind = 'franchisee_changed'` is reused as is (CHECK already widened by Task 01). One new `notifications.kind`: `ticket_handed` (13 chars). Three new error codes (§4.6). |
| **H1** | this task | `tickets.routing_override` — the waiver flag. **Derived** `target ≠ pincode owner`, never sent by a client. |
| **H2** | this task | **Who:** `jobs.assign` + `require_min_rank(AREA_MANAGER)` — exactly the pairing `POST /tickets/{id}/assign` carries (router `CanAssign` + `AreaManagerUp`), and the same territory scoping through `service._load`/`scoped()`. *Decision (writer):* no new feature key. Handing a ticket across franchisees is "assigning, one level up"; a company that wants it narrower uses Feature Access on `jobs.assign`, which also narrows assignment — an acceptable coupling, and a new key would need a seed migration (Task 02 says keys are seeded once). Reported to the index owner as an open question (§9). |
| **H3** | this task | **Which tickets:** `status IN ('New','Slot Pending','Escalated') AND technician_id IS NULL`, exactly F6's re-stamp set. Anything with a technician, anything started, and every terminal state is refused (§4.2). |
| **H4** | this task | **What status does:** `New`/`Slot Pending` keep theirs. `Escalated` goes back to `New`/`Slot Pending` **if the pool can still offer it** (`coverage.still_offerable`) — the same exit `add_bonus_and_renotify` gives it, for the same reason: an escalated ticket is in nobody's pool. An escalated ticket whose window has closed stays `Escalated` (nobody could be offered it); the response says `backInPool: false` and the dialog says why (§5). |
| **H5** | this task | **Re-routing never undoes it:** a carve-out skips override tickets; `restamp_ticket` returns `None` for them; deactivating the target hands its **unassigned** override tickets back to their pincode owner (§4.5). |
| **H6** | this task | **Money follows the technician, not the ticket** (F12, unchanged). The ticket's prices and `rules_snapshot` were stamped at intake and do not change. Travel is base → customer and does not care who the franchisee is; the technician's own franchisee's travel/speed rules freeze at accept as ever. |
| **H7** | this task | **Counts, not guesses:** the picker shows each franchisee's *eligible* technicians for **this** ticket (active, certified, room on the slot's day) and how many of those are *online*. `GET /tickets/{id}/franchisee-options`. |
| **H8** | this task | **No cap on how often** a ticket may be handed over, and no confirmation from the target. A manager's decision, recorded in the trail — the same stance `reschedule` takes. |

---

## 3. Schema

One column, one CHECK rewrite. No new table, no new FK → **no `audit_tenancy` entry**, no `COMPANY_TABLES`
change in `cleanup_db` (§3.3).

### 3.1 `api/app/models/ticket.py` — `Ticket`

```python
#: A person, not the pincode, chose this ticket's franchisee (Task 18). While true the pool's PINCODE
#: test is waived — the technician's franchisee must still equal `franchisee_id`, and certification,
#: status, the daily cap and the online toggle all still apply. Set only by `tickets.service.
#: hand_to_franchisee`, and DERIVED there as `target != franchisee_for_pincode(pincode)`, so handing a
#: ticket back to the pincode's owner clears it. Survives acceptance and release on purpose: a released
#: handed ticket goes back to the franchisee it was handed to. Read it with every other routing fact —
#: `pool_query`, `technicians_covering`, `assign`, the pool socket, `restamp_ticket`, the carve-out.
routing_override: Mapped[bool] = mapped_column(
    Boolean, nullable=False, default=False, server_default=text("false")
)
```

(`Boolean` joins the `sqlalchemy` import list.) No index: every query that reads it is already narrowed by
`ix_tickets_company_franchisee` (`company_id, franchisee_id`) or by `technician_id IS NULL AND status IN (…)`,
and the flag is `false` on all but a handful of rows.

### 3.2 `api/app/models/notification.py`

Append `"ticket_handed"` to `NOTIFICATION_KINDS`, with a `#:` comment: *"A manager handed an unassigned
ticket to a franchisee. `audience='franchisee_admin'`, `franchisee_id` = the receiving franchisee. The
arrival event for work — like `technician_joined`, good news, not a problem."* 13 chars, fits `String(24)`
(index §3.3). The CHECK is generated from the tuple.

### 3.3 Migration `api/alembic/versions/f3b9d1a6c845_hand_ticket_to_franchisee.py`

Revision `f3b9d1a6c845`, **`down_revision = "e8a2c5b7d913"`** (Task 17's revision, the end of the chain
as of 2026-10-16). ⚠ **The head moves.** Before committing, `alembic heads` must print exactly one head;
re-point `down_revision` to it and say so in the commit — never a branch (index §3.6). If Task 17 does not
ship, point it at `d6c3a9f1e874`.

```python
"""Hand an unassigned ticket to another franchisee (Task 18).

tickets.routing_override: a person, not the pincode, chose the franchisee. notifications.kind gains
'ticket_handed'. Reversible only while nothing uses either.
"""
import sqlalchemy as sa
from alembic import op

revision = "f3b9d1a6c845"
down_revision = "e8a2c5b7d913"   # re-point to the live head if the chain moved — never branch
branch_labels = None
depends_on = None

# Spell the vocabulary out here (never import it from the model — a later edit would rewrite history).
# OLD = EXACTLY what ck_notifications_kind holds at down_revision; read it, do not recall it:
#   SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'ck_notifications_kind';
# It must already include technician_moved (Task 01), part_requested/part_decided/part_issued (Task 12)
# and whatever Task 17 added. NEW = OLD + 'ticket_handed'.
OLD_NOTIFICATION_KINDS: tuple[str, ...] = (...)
NEW_NOTIFICATION_KINDS = OLD_NOTIFICATION_KINDS + ("ticket_handed",)

def _in(column: str, values) -> str:
    return f"{column} IN (" + ", ".join(f"'{v}'" for v in values) + ")"

def upgrade() -> None:
    # NOT NULL DEFAULT false is a catalogue-only change on Postgres >= 11: no table rewrite, no long lock.
    op.add_column("tickets", sa.Column("routing_override", sa.Boolean(), nullable=False,
                                       server_default=sa.text("false")))
    op.drop_constraint("kind", "notifications", type_="check")      # bare name; convention adds ck_notifications_
    op.create_check_constraint("kind", "notifications", _in("kind", NEW_NOTIFICATION_KINDS))

def downgrade() -> None:
    bind = op.get_bind()
    handed = bind.scalar(sa.text("SELECT count(*) FROM tickets WHERE routing_override"))
    bells = bind.scalar(sa.text("SELECT count(*) FROM notifications WHERE kind = 'ticket_handed'"))
    if handed or bells:
        raise RuntimeError(
            f"Refusing to downgrade: {handed} ticket(s) are handed to a franchisee that does not own "
            f"their pincode and {bells} 'ticket_handed' notification(s) exist. Dropping the flag would "
            "strand those tickets. Hand them back (or delete the rows) first."
        )
    op.drop_constraint("kind", "notifications", type_="check")
    op.create_check_constraint("kind", "notifications", _in("kind", OLD_NOTIFICATION_KINDS))
    op.drop_column("tickets", "routing_override")
```

- **Round trip on dev** (root AGENTS.md): `upgrade head`, `downgrade e8a2c5b7d913`, `upgrade head`; compare
  `SELECT count(*), count(*) FILTER (WHERE routing_override) FROM tickets` before and after (0 flagged).
- **Production:** the owner migrates `RelianceProdDB` **before** the API is published. Safe either way
  round: the old API never reads or writes the column (the DB default fills it), and the new API needs it.
- **`audit_tenancy`:** no change — a boolean on a table already audited, no new link. Run it anyway (exit 0).
- **`cleanup_db`:** no change — `tickets` is already a classified company table; the column rides with its
  rows. `python -m app.scripts.cleanup_db --check` stays green.
- **`seed/verify.py`:** Task 01's `_open_unassigned_tickets_route_by_pincode` must exclude override tickets
  (`AND NOT routing_override`) or it reports every handed ticket as drift. Add one check,
  `_handed_tickets_point_at_active_franchisees`: no unassigned ticket with `routing_override` is stamped
  with an inactive or soft-deleted franchisee.

---

## 4. API / service changes

### 4.1 Files

| File | New / edit | What |
|---|---|---|
| `api/app/core/franchise_handover.py` | **new, pure** | The decisions: who may be handed what, the derived flag, the resulting status, the waiver, the note. stdlib + `uuid` only (Task 00 §4.1 import guard). |
| `api/app/core/franchise_routing.py` (Task 04) | edit | `needs_restamp` and `pool_frame_matches` gain the override keyword (§4.3, §4.5). |
| `api/app/core/franchise.py` (Task 01/04) | edit | `restamp_ticket` returns `None` for an override ticket, with a `release_override` keyword for deactivation (§4.5). |
| `api/app/core/coverage.py` | edit | `technicians_covering` gains **required** `routing_override`; new `technicians_by_franchisee` (§4.3, §4.4). |
| `api/app/core/push.py` | edit | `announce_pool_job` forwards `routing_override` (§4.3). |
| `api/app/core/realtime.py` | edit | `PoolChanged.routing_override`, `publish_pool_changed(..., routing_override=False)`; `TicketChanged` unchanged (§4.3). |
| `api/app/features/jobs/service.py` | edit | `pool_query` (§4.3 (1)); `cancel` passes the flag through to `announce_pool_job`. |
| `api/app/features/jobs/ws.py` | edit | `pool_frame_matches(..., event_override=…)` (§4.3 (5)). |
| `api/app/features/tickets/service.py` | edit | `hand_to_franchisee`, `franchisee_options`, `_load_assignable_technician` waiver, `_hydrate` fields, the `franchisee_changed` event title note (§4.2–4.3). |
| `api/app/features/tickets/sweeps.py` | edit | `republished`'s kind tuple gains `franchisee_changed` (§4.5). |
| `api/app/features/tickets/router.py`, `schemas.py` | edit | the two routes, four schemas (§4.2). |
| `api/app/features/franchisees/service.py` (Task 03) | edit | carve-out skips override tickets; `deactivate` hands them back (§4.5). |
| `api/app/models/ticket.py`, `notification.py` | edit | §3. |
| `api/app/scripts/seed/verify.py` | edit | §3.3. |

### 4.2 The endpoints

Both go in `features/tickets/router.py`, beside `/assign`, with the same two guards:

```python
dependencies=[AreaManagerUp]      # require_min_rank(AREA_MANAGER) — also refuses vendors and franchise ranks 8–10
principal: CanAssign              # require_feature("jobs.assign")
```

A franchise principal (ranks 8–10) cannot clear the Area-Manager floor and holds no `jobs.assign`; a
vendor ranks below every staff role. Both are 403 before any ticket is read.

#### `GET /tickets/{ticket_id}/franchisee-options`

```json
{ "success": true, "statusCode": 200, "message": "OK", "errors": null, "data": {
  "ticketId": "…", "code": "ACM-INST-0500", "pincode": "500032",
  "currentFranchiseeId": "…skyfix…", "pincodeOwnerId": "…skyfix…", "routingOverride": false,
  "canHandOver": true, "blocker": null,
  "slotOffered": true,
  "options": [
    { "id": "…acme-secunderabad…", "name": "Acme Secunderabad", "code": "SEC", "isHome": false, "kind": "internal",
      "isCurrent": false, "ownsPincode": false, "eligibleTechnicians": 3, "onlineTechnicians": 2 },
    { "id": "…home…", "name": "Acme Appliances", "code": "HOME", "isHome": true, "kind": "internal",
      "isCurrent": false, "ownsPincode": false, "eligibleTechnicians": 1, "onlineTechnicians": 0 },
    { "id": "…skyfix…", "name": "SkyFix Services", "code": "SKY", "isHome": false, "kind": "external",
      "isCurrent": true, "ownsPincode": true, "eligibleTechnicians": 0, "onlineTechnicians": 0 }
  ] } }
```

- Loads the ticket through `service._load(db, principal, ticket_id)` — territory-scoped, **404** across
  companies and outside the manager's states (hard rule 0).
- `canHandOver`/`blocker` come from `handover_blocker` (below) with the target left out: `blocker` is
  `TICKET_ASSIGNED` or `TICKET_NOT_ASSIGNABLE` or `null`. When not null `options` is `[]` — the dialog
  never offers a choice the server will refuse.
- `options` are the company's **active, non-deleted** franchisees, **current one included and flagged**
  (so the dialog can show *"SkyFix Services (current): 0 eligible"* and disable it), ordered
  `eligibleTechnicians DESC, onlineTechnicians DESC, name`. Inactive franchisees are not listed
  (`FRANCHISEE_INACTIVE` is therefore a race or a guessed id).
- Counts come from `coverage.technicians_by_franchisee` (§4.4) — one grouped query, not one per franchisee.
- `slotOffered` = `still_offerable` for this ticket now: the dialog uses it to word the warning for an
  escalated ticket whose window has closed (H4).
- **Withheld from nobody else:** only staff reach this route, so no money or vendor field rides on it.

#### `POST /tickets/{ticket_id}/franchisee`

Request (`HandToFranchiseeRequest`): `{ "franchiseeId": "<uuid>", "reason": "SkyFix has no AC-certified technician" }`.
`reason` is stripped, **3–255 characters** (the bound `RescheduleRequest.reason` already uses — *Decision
(writer)*: same record-of-the-call stance, same limit). No `routingOverride` field exists.

Response (`HandToFranchiseeOut`): `{ ticket: TicketDetailOut, notified: int, backInPool: bool }` — the same
shape idea as `RenotifyOut`. `notified` is the number of phones the push reached (after job passes are
subtracted, as the bonus path counts it); `backInPool` is whether an `Escalated` ticket left the queue.

`service.hand_to_franchisee(db, principal, ticket_id, *, franchisee_id, reason)`:

1. `row = await _load(db, principal, ticket_id)` — 404 outside scope.
2. `target = select(Franchisee).where(company_id == principal.company_id, id == franchisee_id,
   deleted_at IS NULL)`; none → `HTTPException(404, "Franchisee not found")` (another company's id reads
   the same — a 403 would confirm it exists).
3. `code = handover_blocker(status=row.status, has_technician=row.technician_id is not None,
   current=row.franchisee_id, target=target.id, target_active=target.is_active)`; non-null → `_refused(code, …)`
   with the sentences in §4.6.
4. `await lock_routing(db, principal.company_id, exclusive=False)` — a carve-out in flight is waited
   for, then judged after (Task 04 §4.1(a) rule). Lock order unchanged: routing (shared) first.
5. `owner = await franchisee_for_pincode(db, company_id, row.pincode)`;
   `override = override_for(target=target.id, owner=owner)`.
6. `now = _now()`; `back_to = status_after(row.status, offerable=still_offerable-in-python(row, now),
   has_slot=row.slot_start is not None)` — `offer_deadline(row) > now` is the Python twin the bonus path
   already uses.
7. **Guarded UPDATE** — the race settler, as everywhere in this slice:

   ```sql
   UPDATE tickets SET franchisee_id = :target, routing_override = :override, status = :back_to
    WHERE company_id = :c AND id = :id
      AND technician_id IS NULL
      AND status = :was                    -- the status we read
      AND franchisee_id = :from_franchisee -- the stamp we read
   ```

   `rowcount == 0` → `_refused("ALREADY_ASSIGNED", "This ticket has already been updated. Reload the page and
   try again.")` (the existing code and sentence). Somebody accepted it, assigned it, or moved it a second
   ago. Nothing else is written.
8. Set the same values on `row`; one event, same transaction (§5.4 of the index):

   ```python
   db.add(record_event(row, "franchisee_changed", actor_kind="staff",
                       actor_label=principal.user.full_name or "—",
                       from_status=was if back_to != was else None,
                       to_status=back_to if back_to != was else None,
                       note=handover_note(from_name, to_name, reason, back_in_pool=back_to != was),
                       by_user=principal.user_id))
   ```

   The **title** is Task 03's `_EVENT_TITLES["franchisee_changed"]` ("Moved to another franchisee") — a
   carve-out and a hand-over are the same fact to a reader; the note says which (*"…handed over: <reason>"*
   vs *"…pincode 500033 reassigned"*).
9. **Bell** to the receiving franchisee's admins (Task 05 audience; `notify` gains `franchisee_id` there):

   ```python
   raised = await notify(db, company_id=row.company_id, kind="ticket_handed",
       title=f"{row.code} handed to {to_name}",                    # PROPOSED
       detail=f"{principal.user.full_name or 'A manager'} moved it from {from_name}. {reason}",   # PROPOSED
       to=f"/tickets/{row.id}", ticket_id=row.id, pincode=None,
       audience="franchisee_admin", franchisee_id=target.id)
   await publish_notification(db, ..., audience="franchisee_admin", franchisee_id=target.id,
                              notification_id=raised.id)
   ```

   Staff are **not** belled about their own colleague's action (the "author of this event" rule that
   `product_submitted` documents). The source franchisee is not belled either — *Decision (writer)*: the
   bell would link to a ticket that 404s for them; see the open question in §9.
10. **Realtime**, inside the transaction (fires on commit): `publish_pool_changed` **twice** — for the
    **old** franchisee (`franchisee_id=from, routing_override=old_override`, so its technicians' sockets
    refetch and the card disappears) and for the **new** (`franchisee_id=target, routing_override=override`);
    `publish_ticket_changed(db, row)` (carries the new franchisee, Task 04 §4.5 — the source portal learns on
    its next refetch; REST is authoritative).
11. `commit()`.
12. **After the commit**, if `row.status in ("New", "Slot Pending")` and `still_offerable`:
    `audience = technicians_covering(db, company_id, franchisee_id=target.id, routing_override=override,
    pincode, node_path_ids, slot_start)` minus `technicians_who_passed`, then `await push_pool_job(db, row)`
    (the existing helper — it forwards `franchisee_id` and `routing_override`). `notified = len(audience)`.
    A push about a rolled-back hand-over would be worse than a late one.
13. Return `HandToFranchiseeOut(ticket=await get_ticket(...), notified=…, backInPool=…)`.

`TicketOut` / `TicketDetailOut` gain `routingOverride: bool | None = None` (the stored value for staff and
franchise callers; `None` for a vendor, with `franchiseeId`/`franchiseeName` — Task 04 §4.4). The console
uses it to show *"Handed over"* on the ticket and to drop the pincode filter from the assignment shortlist
(§5).

### 4.3 The pincode waiver in all five places (+ the lock and the shortlist)

The rule everywhere: **coverage ⇔ `covers_pincode OR ticket.routing_override`.** The franchisee test from
Task 04 is not touched, and the override is read from the *ticket* each time — never cached on the
technician, never inferred.

#### (1) `jobs/service.py :: pool_query` (~line 143)

Task 04 added `in_franchisee`. Change the existing `covers_pincode` term:

```python
covers_pincode = (
    select(TechnicianPincode.id)
    .where(TechnicianPincode.company_id == company_id,
           TechnicianPincode.technician_id == technician_id,
           TechnicianPincode.pincode == Ticket.pincode)
    .exists()
)
...
conditions = [
    ...,
    # Coverage is waived for a ticket a PERSON handed to this franchisee (Task 18) — a pincode its
    # franchisee does not own can never be in its technicians' coverage. The franchisee test below still
    # applies in full, so this widens the pool to ONE franchisee, never to the company.
    or_(Ticket.routing_override.is_(True), covers_pincode),
    certified_for, is_active, in_franchisee,
]
```

Docstring: *"What `False` drops is exactly two things … coverage **unless the ticket was handed here**,
certification, status and franchisee still apply on every flag."* `list_pool`, `get_offer`, `pass_job` and
`accept`'s eligibility read all inherit it.

#### (2) `core/coverage.py :: technicians_covering` (~line 117)

Task 04's signature gains one more **required** keyword (a caller that forgets must fail loudly):

```python
async def technicians_covering(db, *, company_id, franchisee_id, routing_override: bool,
                               pincode, node_path_ids, slot_start=None) -> list[uuid.UUID]:
    ...
    conditions = [company_id…, franchisee_id…, status == ACTIVE, accepting_work…, certified_for]
    if not routing_override:          # the waiver; nothing else relaxes
        conditions.append(covers_pincode)
```

Every caller already passes `franchisee_id=row.franchisee_id` (Task 04 §4.2 (2)); each now also passes
`routing_override=row.routing_override`: `core/push.py :: announce_pool_job` (new required kw, forwarded),
`tickets/service.py :: add_bonus_and_renotify`, and the four `announce_pool_job` call sites
(`jobs/service.py :: cancel`, `tickets/service.py :: reschedule`, `push_pool_job`, `hand_to_franchisee`).
`core/coverage.py`'s module docstring ("three facts" → four, "five places") gains one sentence naming the
waiver and this task.

#### (3) The guarded UPDATE in `jobs/service.py :: accept` (~line 856)

**No change.** That statement tests status, `technician_id IS NULL`, the cap and (Task 04) the
franchisee — it has never tested coverage; coverage is judged by the `pool_query` read above it. The
hand-over's own guarded UPDATE changes `franchisee_id`, so a technician who read the old card and taps
accept after the move fails Task 04's franchisee clause and gets Task 04's `accept_miss_reason == "moved"`
→ **404 "Job not found"**. State it in the code comment so nobody "fixes" the missing clause.

#### (4) `tickets/service.py :: _load_assignable_technician` (~line 2668)

Task 04 added the franchisee refusal. The coverage refusal becomes:

```python
if covers is None and not row.routing_override:
    raise _refused("TECHNICIAN_INELIGIBLE", f"This technician does not cover {row.pincode}. …")
```

Certification, `ACTIVE`, the cap and the franchisee refusals are untouched. `assign_technician`'s Task 04
step 1 calls `restamp_ticket`, which now returns `None` for an override ticket (§4.5) — so assigning a
handed ticket never re-routes it back. Docstring: *"Coverage is enforced **unless the ticket was handed to
this technician's franchisee**."*

**The shortlist (a sixth reader, not a sixth place).** `GET /technicians?pincode=&subcategoryId=&onDay=`
filters by pincode; for a handed ticket that returns nobody (the owner's people only). The console
(§5) therefore asks `GET /technicians?franchiseeId=<ticket.franchiseeId>&subcategoryId=…&onDay=…` and
**omits `pincode`** when `ticket.routingOverride` is true. `franchiseeId` is Task 05's existing filter —
no server change. ⚠ The list is still narrowed to technicians the **manager can see** (`_visible_technicians`:
an Area Manager sees her states). If the receiving franchisee's technicians are all elsewhere, the shortlist
is empty for her; the pool still works, and a Regional Head or National Head sees them. That is the existing
visibility rule, deliberately not widened here (§8).

#### (5) `jobs/ws.py` + `core/realtime.py`

`PoolChanged` gains `routing_override: bool = False` (payload key `"routing_override"`; absent → `False`,
exactly how Task 04 added `franchisee_id`); `publish_pool_changed(..., routing_override: bool = False)`.
`pool_frame_matches` (Task 04 §4.8) gains `event_override: bool = False`:

```python
covered = event_pincode in pincodes or event_override        # the waiver, same sentence as pool_query
return covered and bool(nodes & set(event_path)) and (event_franchisee is None
       or franchisee_id is None or event_franchisee == franchisee_id)
```

The socket stays biased toward ringing too often: an old payload without the key is `False` and keeps
today's behaviour. Every existing `publish_pool_changed` call (Task 04 §4.2 (5) table) additionally passes
`routing_override=row.routing_override`; the `accept`/`assign` ones pass the value as it was **before** the
move, because they announce a ticket leaving a pool.

#### Plus: `core.franchise.lock_routing` (Task 04 §4.1)

`hand_to_franchisee` takes `lock_routing(exclusive=False)` (step 4). It **writes** `franchisee_id`, but
the writer a carve-out would race against is the carve-out's own guarded UPDATE, which now carries
`AND routing_override IS FALSE` (§4.5) — so the shared lock is for the *owner read* in step 5 (it must see
the post-carve-out owner), not for the write. Never take it exclusively here.

### 4.4 `core/coverage.py :: technicians_by_franchisee` — the picker's numbers

```python
async def technicians_by_franchisee(db, *, company_id, pincode, pincode_owner_id, node_path_ids,
                                    slot_start=None) -> dict[uuid.UUID, tuple[int, int]]:
    """franchisee_id -> (eligible, online) for ONE ticket. Missing key = (0, 0).

    `eligible`: ACTIVE, certified anywhere on the job's path, room on the slot's day (omitted when there is
    no slot, as in `technicians_covering`) — and, for the franchisee that OWNS the pincode, covering it.
    Every other franchisee's technicians are counted with the pincode test waived, because that is
    exactly what they would be judged by after a hand-over. `online`: the subset with accepting_work.

    Must agree with `technicians_covering(..., franchisee_id=F, routing_override=(F != owner))`:
    `online[F] == len(that list)` before job passes. This docstring is where that promise lives."""
```

One statement, grouped: `count(*) FILTER (WHERE …)` twice over `technician_profiles`, `GROUP BY franchisee_id`,
the owner's coverage clause written as `or_(TechnicianProfile.franchisee_id != pincode_owner_id, covers_pincode)`.
The pure twin of that clause is `franchise_handover.coverage_required(franchisee_id, owner_id)`, tested in
§6 so the SQL and the function cannot drift silently.

### 4.5 What re-routing does to a handed ticket (H5)

| Mechanism | Before this task | With `routing_override = true` |
|---|---|---|
| **Carve-out** (Task 03 `set_pincodes`, `_plan`/`_apply`) | Re-stamps open unassigned tickets whose pincode moved. | **Skips them.** `_plan`'s ticket SQL adds `AND NOT t.routing_override`; `_apply` step 6's guarded UPDATE adds `AND routing_override IS FALSE`. A person's decision is not silently reversed by an unrelated range edit, and the preview's "re-routed" count excludes them. (If the carve-out later gives the **target** that very pincode, the flag is merely redundant — harmless.) |
| **Release** (Task 04 `restamp_ticket` from `jobs.cancel`, `record_no_show`) | Re-stamps to the pincode's current owner. | `restamp_ticket` **returns `None` at the top** for `row.routing_override`. A handed ticket released by its technician stays with the franchisee it was handed to, and the target's technicians are re-offered it. |
| **Manual re-assign** (Task 04 `assign_technician` step 1) | Re-stamps first. | Same early return; the franchisee refusal then protects the target's wall. |
| **Deactivating the target** (Task 03 `deactivate`, step 4) | Releases owned codes and re-stamps. | Also selects `franchisee_id = :this AND routing_override AND technician_id IS NULL AND status IN (New, Slot Pending, Escalated)` and calls `restamp_ticket(..., release_override=True)`: flag cleared, stamp = pincode owner, one `franchisee_changed` event (*"Acme Secunderabad was deactivated · handed ticket returned to SkyFix Services"*, actor system). **Assigned tickets keep theirs** (F6's spirit). Without this a ticket could sit at a franchisee with no way to be served. |
| **Hand-back** | n/a | A second hand-over to the pincode's owner (or anybody): `override_for` recomputes the flag — `false` for the owner. |
| **The escalation grace** (`sweeps.sweep_unaccepted`) | A bonus or a reschedule gives a re-published ticket a `renotify_grace_minutes` breather. | `republished`'s `kind.in_(("bonus_added", "rescheduled"))` gains `"franchisee_changed"`. Without it, a ticket handed at 10:00 for an 11:00 slot would re-escalate on the next five-minute tick, straight back into the queue the manager just cleared. *Side effect, accepted:* a carve-out/release `franchisee_changed` also gives its ticket the same grace — a ticket entering a new franchisee's pool deserves its own window, and `Escalated` rows are untouched by the sweep. |

`restamp_ticket` (Task 04 §4.1(c)) after the change:

```python
async def restamp_ticket(db, row, *, actor_kind, actor_label, by_user=None, release_override=False):
    if row.routing_override and not release_override:
        return None                      # a person chose this franchisee — only a person (or its deactivation) undoes it
    ...                                  # as before; when release_override: row.routing_override = False first
```

`needs_restamp(current, owner, *, routing_override=False)` returns `False` when `routing_override` (pure,
tested).

### 4.6 Errors and transactions

| Status · code | When | Message — PROPOSED |
|---|---|---|
| 409 `TICKET_ASSIGNED` | the ticket has a technician, or is in `Assigned`, `In Progress`, `Awaiting Part`, `Awaiting Customer`, `AI Review` (including `Escalated` **with** a technician — a customer's refusal) | *"{code} already has a technician, so it can't move to another franchisee. Cancel it from the technician first, or re-assign it."* |
| 409 `TICKET_NOT_ASSIGNABLE` (existing) | `Closed`, `Force-Closed`, `Cancelled` | *"This ticket is {status} and can no longer be moved."* |
| 409 `SAME_FRANCHISEE` | target = the ticket's current stamp | *"{code} already belongs to {name}. Choose a different franchisee."* |
| 409 `FRANCHISEE_INACTIVE` | target exists but `is_active = false` | *"{name} is switched off and can't be given work. Choose another franchisee."* |
| 409 `ALREADY_ASSIGNED` (existing) | guarded UPDATE matched nothing (accepted, assigned or moved a moment ago) | the existing sentence |
| 404 | unknown / other company's ticket or franchisee; a ticket outside the manager's states | existing "Ticket not found" / new "Franchisee not found" |
| 403 | franchise principal, vendor, or a role below Area Manager / without `jobs.assign` | existing guard text |
| 422 | `reason` blank, shorter than 3, longer than 255 | pydantic, existing envelope |

Order of checks matters and is pinned by tests: terminal → assigned/live → same → inactive. Transactions:
`hand_to_franchisee` is one transaction, one commit (step 11); the push is after it. No new commit points.

### 4.7 Pure helpers — `app/core/franchise_handover.py` (stdlib + `uuid` only)

```python
HANDOVER_STATUSES = ("New", "Slot Pending", "Escalated")
TERMINAL = ("Closed", "Force-Closed", "Cancelled")

def handover_blocker(*, status: str, has_technician: bool, current: uuid.UUID, target: uuid.UUID | None,
                     target_active: bool = True) -> Literal["TICKET_NOT_ASSIGNABLE", "TICKET_ASSIGNED",
                                                            "SAME_FRANCHISEE", "FRANCHISEE_INACTIVE"] | None: ...
def override_for(*, target: uuid.UUID, owner: uuid.UUID) -> bool: ...        # target != owner
def coverage_required(*, franchisee_id: uuid.UUID, owner_id: uuid.UUID) -> bool: ...   # == owner; the SQL clause's twin
def covers_ok(*, covers: bool, routing_override: bool) -> bool: ...          # covers or routing_override
def status_after(was: str, *, offerable: bool, has_slot: bool) -> str: ...   # Escalated+offerable -> New | Slot Pending
def handover_note(from_name: str, to_name: str, reason: str, *, back_in_pool: bool) -> str: ...
def option_order(options: Sequence[Mapping]) -> list[Mapping]: ...          # eligible desc, online desc, name
```

---

## 5. Client changes — `adminWeb` (staff ticket page)

No mobile change (the app receives only `{"type":"pool.changed"}`; no ticket status, ledger kind or
response field it parses changes — index X4 untouched). No portal change: Task 09's read-only ticket page
already scopes by `tickets.franchisee_id`, so the **target's** admin sees it and the **source's** gets the
normal not-found page.

### 5.1 Files

| File | What |
|---|---|
| `src/lib/handOver.ts` (new, pure) | `canHandOver(ticket, has)`, `optionWarning(option, ctx)`, `optionLabel(option)`, `reasonError(text)`, `dialogDefault(options)`, `handedByLabel` — vitest-tested. |
| `src/types/ticket.ts` | `Ticket.routingOverride?: boolean \| null`; `FranchiseeOption`, `FranchiseeOptions`, `HandToFranchiseeResult`. |
| `src/services/tickets.ts` | `getFranchiseeOptions(id)`, `handToFranchisee({id, franchiseeId, reason})` (`apiPost<HandToFranchiseeResult>(`/tickets/${id}/franchisee`, …)`). |
| `src/hooks/useTickets.ts` | `useFranchiseeOptions(id, enabled)`; `useHandToFranchisee()` — `meta.errorTitle: "Couldn't hand the ticket over"`; on success seed `ticketKeys.detail`, invalidate `ticketKeys.all`, `escalationKeys.all`, `dashboardKeys.all`, `technicianKeys.all` (the same four `useRescheduleTicket` invalidates). |
| `src/components/tickets/HandToFranchiseeDialog.tsx` (new) | The dialog. Built like `RescheduleDialog`/`NoShowDialog`: `Dialog`, `Field`, `Select` or radio list, RHF + Zod (`handOverResolver` in `ticketSchema.ts`). A radio list rather than a `Select` — the counts are the point and a closed menu hides them. |
| `src/pages/tickets/TicketDetailPage.tsx` | `const canHandOver = canAct && has("jobs.assign") && isHandable(ticket)`; a `Hand to another franchisee` outline `Button` after **Change the time** and before **Re-assign**; mounts the dialog (a dialog, not a routed page — one choice and one sentence, as the file's own comment says of Change the time). While `ticket.routingOverride`, a chip **Handed over** in the header row. |
| `src/pages/tickets/AssignTechnicianPage.tsx` | When `ticket.routingOverride`, call the shortlist with `franchiseeId` and **no** `pincode` (§4.3 (4)); a line under the title *"Handed over to {franchisee}. Pincode coverage is not required for this job."* (PROPOSED). |
| `src/components/tickets/Timeline.tsx` + `components/notifications/kinds.ts` | Task 03 already adds `franchisee_changed` (title) and `technician_moved` (bell). Add `ticket_handed` to `kinds.ts` `FALLBACK` (neutral "arrival" icon like `technician_joined`) so the bell renders before a dedicated entry. |

`isHandable(ticket)` mirrors `HANDOVER_STATUSES` and `technicianId === null`; it is presentation — the
server decides. Hidden for a franchise principal because the whole `isOps` action row is.

### 5.2 The dialog

States, in order (all four are in the mock):

1. **Loading** — three skeleton rows while `GET …/franchisee-options` is in flight.
2. **Choose** — the radio list: name, `Home`/`External`/`Current` chips, and the counts. The **current** franchisee
   is shown first-class but disabled (*"Current"*). The first option with `eligibleTechnicians > 0` is *not*
   pre-selected — a hand-over is a decision, so the button stays disabled until a franchisee **and** a reason
   are chosen.
3. **Zero eligible** — choosing a franchisee with `eligibleTechnicians = 0` shows a warning pill (still
   confirmable; an Area Manager can still assign by hand and the owner's pool is already empty). Choosing one
   with eligible > 0 but `onlineTechnicians = 0` shows a softer note.
4. **Reason validation** — empty or under 3 characters: the field's error and a disabled **Hand over**
   button; over 255: error. Validation fires on blur and on submit, never on first keystroke.
5. **Blocked** — the options call answers `canHandOver: false` (the ticket was assigned in another tab): the
   dialog opens straight to the blocker sentence with only **Close**. A 409 `TICKET_ASSIGNED` /
   `ALREADY_ASSIGNED` on submit leaves the dialog open on that sentence and refetches the ticket.
6. **Success** — dialog closes, a toast *"{code} handed to {name}. {n} technician(s) notified."* (or, when
   `backInPool` is false for a closed-window escalation, *"…It isn't back in the pool — its time has passed.
   Change the time or assign someone."*), and the timeline shows the new entry on the seeded detail.

The warning above the list, always shown (PROPOSED copy table in §5.3):
*"Handing a ticket over takes it away from {current}. The other franchisee's technicians are offered it —
and they are paid by their own franchisee's rules, including travel."*

### 5.3 PROPOSED copy (X2) — needs owner sign-off before the console part is built

| Where | English |
|---|---|
| Ticket page button | Hand to another franchisee |
| Header chip (override) | Handed over |
| Dialog title | Hand {code} to another franchisee |
| Dialog intro | Use this when {current} can't take the job — nobody certified, everyone at their daily limit, or nobody online. |
| Standing warning | Handing a ticket over takes it away from {current}. The other franchisee's technicians are offered it, and they are paid by their own franchisee's rules, including travel. |
| List caption | Franchisee |
| Option counts | `{n} eligible · {m} online` / `0 eligible` |
| Option chips | Home · External · Current |
| Zero-eligible warning | Nobody at {name} can take this job right now. You can still hand it over, and then assign someone by hand. |
| Nobody-online note | {n} eligible, but none are online. They'll see it when they go online. |
| Escalated, window closed note | This job's time has passed, so no technician can be offered it. Handing it over still moves it; change the time with the customer to put it in the pool. |
| Reason label / placeholder | Reason / Why is it moving? Shown to both franchisees' admins on the ticket. |
| Reason errors | Say why you're handing it over. · Keep it under 255 characters. |
| Confirm / Cancel | Hand over · Cancel |
| Blocked (has technician) | {code} already has a technician. Cancel it from them first, or re-assign it. |
| Success toast | {code} handed to {name}. {n} technician(s) notified. |
| Success toast, closed window | {code} handed to {name}. It isn't in the pool — its time has passed. |
| Timeline title (Task 03's) | Moved to another franchisee |
| Timeline note | {from} → {to} · handed over: {reason} · back in the pool |
| Assign page line | Handed over to {name}. Pincode coverage isn't required for this job. |
| Bell title / detail | {code} handed to {name} / {manager} moved it from {from}. {reason} |

---

## 6. Unit tests (pure — no database, X1)

### `api/tests/unit/test_franchise_handover.py`

`handover_blocker`:
1. `New`, no technician, other franchisee, active → `None`. 2. `Slot Pending` → `None`. 3. `Escalated`, no technician → `None`.
4. `Escalated` **with** a technician → `TICKET_ASSIGNED`. 5. `Assigned`, `In Progress`, `Awaiting Part`, `Awaiting Customer`, `AI Review` → `TICKET_ASSIGNED` (parametrised).
6. `Closed`, `Force-Closed`, `Cancelled` → `TICKET_NOT_ASSIGNABLE`, even with `has_technician=False`.
7. `target == current` → `SAME_FRANCHISEE`. 8. inactive target → `FRANCHISEE_INACTIVE`.
9. Precedence: terminal beats assigned beats same beats inactive (one case per adjacent pair).
10. `target=None` (the options call) → only the ticket-side blockers.

`override_for` / `coverage_required` / `covers_ok`:
11. `override_for(target=A, owner=A)` → False; `(A, B)` → True. 12. Handing back to the owner clears it.
13. `coverage_required(F, owner=F)` → True; `(G, owner=F)` → False — pinned against the SQL clause in §4.4.
14. `covers_ok(covers=False, routing_override=True)` → True; `(False, False)` → False; `(True, False)` → True.

`status_after`:
15. `Escalated`, offerable, slot → `New`. 16. `Escalated`, offerable, no slot → `Slot Pending`.
17. `Escalated`, **not** offerable → `Escalated`. 18. `New`/`Slot Pending` → unchanged for any `offerable`.

`handover_note`:
19. Contains both names, the reason and the arrow. 20. `back_in_pool=True` appends `· back in the pool`; False does not.
21. A reason with a newline is collapsed to one line; a 255-character reason is kept whole. 22. Names are not truncated.

`option_order`:
23. Eligible desc, then online desc, then name case-insensitively. 24. Stable for equal keys. 25. Empty → `[]`.

### Additions to `api/tests/unit/test_franchise_routing.py` (Task 04's file)

26. `needs_restamp(current, owner, routing_override=True)` → False **even when current ≠ owner**.
27. `needs_restamp(..., routing_override=False)` → exactly Task 04's cases 1–3 (regression).
28. `pool_frame_matches` with `event_override=True` and a pincode the viewer does not cover → True (franchisee matches, node on path).
29. Same with `event_override=True` but a **different** franchisee → False (the waiver never crosses the franchisee wall).
30. `event_override=True`, node not on the path → False (certification is not waived).
31. `event_override` omitted → Task 04's cases 15–20 unchanged.

### Additions to `api/tests/unit/test_realtime_payloads.py`

32. `PoolChanged(routing_override=True)` round-trips through `as_payload` → `from_payload`. 33. A payload with **no** `routing_override` parses with `False` (today's shape). 34. `"routing_override": "yes"` (not a bool) → `False`, not a crash.

### `adminWeb/src/lib/handOver.test.ts` (vitest, Task 00 harness)

1. `canHandOver`: status `New`/`Slot Pending`/`Escalated` + `technicianId=null` + `has("jobs.assign")` → true. 2. any technician → false. 3. `Assigned`/`In Progress`/`Awaiting Part`/`Closed` → false. 4. no `jobs.assign` → false.
5. `optionLabel({eligible:3, online:2})` → `3 eligible · 2 online`; `{0,0}` → `0 eligible`; `{1,0}` → `1 eligible · 0 online`.
6. `optionWarning`: eligible 0 → the zero-eligible sentence naming the franchisee; eligible>0, online 0 → the nobody-online note; both >0 → null; a closed-window escalation adds the time-passed note.
7. `reasonError("")` and `("  ab ")` → "Say why…"; `("abc")` → null; a 256-character string → the length message; surrounding whitespace is trimmed before counting.
8. `dialogDefault(options)` → no preselected franchisee; the current option is `disabled`.
9. `isHandable` mirrors the server's three statuses (table-driven against the same constant the test imports).

---

## 7. Acceptance criteria

RelianceDB (dev), local API, **GreenTech Demo Services** only. Staff logins `*.demo@seed.example.com`
(password: `grep -n '^PASSWORD' api/app/scripts/seed_demo.py`); demo technician `1666600000`, OTP `246810`
(`POST /auth/otp/request`, `/auth/otp/verify`). Customer phones on tickets: only `6301815418` or
`9398475448`. Set up with Task 03: franchisee **S** owning a range with a pincode **P**; **A**, a second
non-home franchisee (internal) owning pincode **Q** and holding technician **X** certified for the same
category but covering only Q; **H**, the home. Technician **R** (covers P, in S). Raise ticket **K** at P
for that category (Slot Pending, via the vendor login).

```sql
SELECT f.id, f.name, f.is_home FROM franchisees f JOIN companies c ON c.id = f.company_id
 WHERE c.name = 'GreenTech Demo Services';
```

1. **Options.** **Given** the Area Manager for P's state, **when** `GET /tickets/{K}/franchisee-options`,
   **then** 200; `currentFranchiseeId = S`, `pincodeOwnerId = S`, `canHandOver = true`; the entry for S is
   `isCurrent`/`ownsPincode`; A lists `eligibleTechnicians >= 1` (X: active, certified, no cap hit) even though
   X covers nothing near P; H lists its own count; no inactive franchisee appears. Cross-check:
   `SELECT count(*) FROM technician_profiles tp, tickets t WHERE t.id = :K AND tp.franchisee_id = :A AND tp.status = 'active' AND EXISTS (SELECT 1 FROM technician_nodes n WHERE n.technician_id = tp.id AND n.node_id = ANY(t.node_path_ids))` equals A's `eligibleTechnicians` (no cap in the demo).
2. **Hand over.** **When** the AM `POST /tickets/{K}/franchisee` `{franchiseeId: A, reason: "SkyFix has no AC-certified technician"}`,
   **then** 200 `HandToFranchiseeOut`; and
   `SELECT franchisee_id, routing_override, status, technician_id FROM tickets WHERE id = :K` is `A / true / Slot Pending / NULL`;
   `SELECT kind, actor_kind, actor_label, note FROM ticket_events WHERE ticket_id = :K ORDER BY created_at DESC LIMIT 1`
   is `franchisee_changed / staff / <the AM's name> / "SkyFix Services → Acme Secunderabad · handed over: SkyFix has no AC-certified technician"`.
3. **Pool (1) — the waiver.** As X (A's technician, covers no part of P), `GET /jobs/pool` lists K and
   `GET /jobs/pool/{K}` is 200. As R (S) K is **absent** and the offer is 404. As an H technician: absent.
   **Control:** insert nothing — `SELECT count(*) FROM technician_pincodes WHERE technician_id = :X AND pincode = :P` = 0.
4. **Accept (3).** `POST /jobs/{K}/accept` as R → 404; as X → 200, `technician_id = X`,
   `routing_override` still `true` (it survives acceptance).
5. **Push audience (2).** `python -c` with `asyncio.run`: `technicians_covering(db, company_id=…, franchisee_id=A,
   routing_override=True, pincode=P, node_path_ids=…)` contains X; with `routing_override=False` it does **not**
   (the control that proves the flag, not the franchisee, did it); with `franchisee_id=S, routing_override=True`
   it still excludes X (the franchisee wall holds under the waiver) and includes R.
6. **Socket (5).** Two websockets on `/api/v1/jobs/stream` (X and R). Hand a **fresh** ticket K2 (at P) to A:
   X receives `{"type":"pool.changed"}`; R receives one too (the **old**-franchisee frame, so the card
   disappears) — and a `GET /jobs/pool` as R no longer lists K2.
7. **Release stays put.** X cancels K from the app. **Then** `SELECT franchisee_id, routing_override FROM tickets WHERE id = :K`
   is still `A / true`; **no** `franchisee_changed` event with actor system / "Pincode routing" was written;
   A's technicians (not S's) see K in `GET /jobs/pool`. Same for `POST /tickets/{K}/no-show`.
8. **Carve-out does not undo it.** Re-run Task 03's `PUT /franchisees/{S}/pincodes` with a range that no longer
   includes P (P goes back to H). The `dryRun=true` preview's re-routed list does **not** include K2 (handed to A) —
   while an ordinary open unassigned S ticket at P **is** listed; apply: K2's stamp is still A, `routing_override`
   still true, no new event on it. Restore S's range afterwards.
9. **Assign (4).** As the AM, `POST /tickets/{K2}/assign` with an A technician who covers nothing near P → 200.
   With R (S) → 409 `TECHNICIAN_INELIGIBLE` naming A's work. With an A technician **not certified** →
   409 `TECHNICIAN_INELIGIBLE` ("not certified" — certification is never waived).
10. **Shortlist.** `GET /technicians?franchiseeId=:A&subcategoryId=:node&onDay=…` (no `pincode`) lists A's technicians
    the AM can see; with `&pincode=:P` it lists none. The console's assign page uses the first form for K2.
11. **Hand back.** `POST /tickets/{K2}/franchisee` `{franchiseeId: S, reason: "SkyFix hired an AC technician"}` →
    `routing_override = false` (S owns P) and R sees K2 again. `SAME_FRANCHISEE` on a repeat.
12. **Refusals.** (a) A ticket assigned to a technician → 409 `TICKET_ASSIGNED`. (b) `Escalated` with a
    technician (customer refusal) → 409 `TICKET_ASSIGNED`. (c) a `Closed` ticket → 409 `TICKET_NOT_ASSIGNABLE`.
    (d) target = current → 409 `SAME_FRANCHISEE`. (e) `UPDATE franchisees SET is_active = false WHERE id = :A` then hand to A →
    409 `FRANCHISEE_INACTIVE` (revert). (f) a franchisee id from **another company** → 404; a ticket id from
    another company → 404. (g) `reason: "  "` and `reason: "ab"` → 422; 256 chars → 422.
13. **Race.** Hold a transaction open on K (`SELECT … FOR UPDATE` in psql), start an accept as X and a hand-over
    to H; release. Exactly one wins; the loser gets `JOB_ALREADY_TAKEN`/404 or `ALREADY_ASSIGNED`, never a
    half-written row: the ticket is either still unassigned with its new stamp, or assigned to X with the stamp it had
    when X accepted — `SELECT franchisee_id, routing_override, technician_id FROM tickets WHERE id = :K` shows one of those two shapes.
14. **Escalated back to the pool.** Make K escalated (`sweep_unaccepted` or `UPDATE tickets SET status='Escalated'` on a
    demo ticket with a future slot), hand it over: `backInPool = true`, status `New` (or `Slot Pending` with no slot),
    the status change is in the same event row. With a **closed** window (`slot_start` in the past): `backInPool = false`,
    status stays `Escalated`, `notified = 0`, the ticket is still in the escalation queue for the AM.
15. **Grace.** A ticket handed at T whose deadline is inside `escalate_hours_before_slot` is **not** escalated by
    the next `sweep_unaccepted` tick; after `renotify_grace_minutes` it is.
16. **Franchise portals.** Sign in as S's franchisee admin: `GET /tickets/{K2 while at A}` → **404**; K2 is not in
    `GET /tickets`; `SELECT count(*) FROM tickets WHERE franchisee_id = :S AND deleted_at IS NULL` = `totalRecords`.
    As A's admin: `GET /tickets/{K2}` → 200 read-only; `routingOverride = true`; the timeline carries the
    `franchisee_changed` entry; `GET /tickets/{K2}/attachments` → 404; any write → 403.
    **Both** admins `POST /tickets/{K2}/franchisee` → 403; `GET …/franchisee-options` → 403. A vendor: 403.
17. **Bell.** A's admin's `GET /notifications` has one `ticket_handed` row (`SELECT audience, franchisee_id, ticket_id FROM notifications WHERE kind = 'ticket_handed'`
    → `franchisee_admin / :A / :K2`); S's admin has none; the AM's bell has none.
18. **Money follows the technician.** X closes K (customer confirms): `SELECT franchisee_id FROM ledger_entries WHERE ticket_id = :K`
    is **A** for every row (payout, travel when configured). `tickets.technician_payout_paise` and `vendor_price_paise` are unchanged
    from intake. S's `GET /ledger/pool` has no row for K.
19. **Deactivate.** Hand K3 to A, leave it unassigned, deactivate A (after clearing its pincodes/technicians per Task 03):
    K3 returns to its pincode owner with `routing_override = false`, one `franchisee_changed` event (actor system). An
    **assigned** handed ticket keeps A.
20. **Migration.** Round trip on dev (§3.3); `downgrade` refuses while K2/K3 are still flagged, naming the count.
    `\d tickets` shows `routing_override boolean not null default false`; `pg_get_constraintdef` of
    `ck_notifications_kind` lists `ticket_handed` **and** every earlier kind.
21. `python -m app.scripts.audit_tenancy` exits 0; `python -m app.scripts.cleanup_db --check` exits 0;
    `pytest api/tests/unit -q` green; `python -c "import app.main"` succeeds; `npm run lint && npm run typecheck && npm test` green in `adminWeb/`.
22. **Console.** On the staff ticket page the AM sees **Hand to another franchisee** only on an unassigned open
    ticket; the dialog shows the counts from the API; the confirm button is disabled until a franchisee and a
    reason are given; after success the timeline has the new entry without a reload; the Re-assign page for a
    handed ticket shows A's technicians. A National Head and a Regional Head see the same.

---

## 8. Out of scope and traps

- **Do not weaken the franchisee test to make the waiver work.** The override relaxes the *pincode* half
  only. A bug that waives the franchisee half would offer one franchisee's tickets to the whole company.
  Test 29 exists for this.
- **All five places, or none** (index §5.5) — this task touches the pincode half of each. Forgetting
  `technicians_covering` rings no phones; forgetting `jobs/ws.py` makes the app wait for the 20-second poll;
  forgetting `_load_assignable_technician` lets a manager hand a ticket and then be unable to assign it.
  `routing_override` is a **required** keyword on `technicians_covering` for the same reason `franchisee_id` is.
- **The guarded UPDATE in `accept` has no coverage clause — and must not gain one.** Coverage lives in the
  `pool_query` read. Adding a pincode clause there "for symmetry" would re-strand every handed ticket at the
  last step.
- **The flag is derived and survives acceptance.** Never let a client set it, never clear it on accept
  (the release path needs it), and never "tidy" it to false because the technician took the job.
- **Do not re-stamp a handed ticket by pincode** — not from a carve-out, not from `restamp_ticket`, not
  from a script. The two escape hatches are a second hand-over and the target's deactivation.
- **Not an assignment.** Handing over changes who may *take* the job; it assigns nobody, charges nobody and
  moves no money. The ticket's prices and `rules_snapshot` are stamped at intake and untouched (H6).
- **Visibility of the shortlist is the existing rule** (`_visible_technicians`): an Area Manager may not see
  the receiving franchisee's technicians if they work outside her states. Widening it would be a change to
  every other assignment, and Task 02 chose territory on purpose.
- **A travel allowance can be large.** A technician far from the customer earns the *receiving* franchisee's
  travel rule up to its `max_paise_per_job` — the dialog's standing warning says so; no estimate is shown
  (consistent with R10: no travel estimate before accept).
- **Slices never import each other** (hard rule 4): the pure decisions live in `core/franchise_handover.py`,
  the counts in `core/coverage.py`; `tickets` imports `core`, never `jobs`.
- **Not built:** the source franchisee is not told its ticket left (open question below); the receiving
  franchisee cannot decline; there is no bulk hand-over; no hand-over of an *assigned* ticket (cancel it from
  the technician or re-assign — existing tools); no new feature key; no change to the vendor's view, the
  customer's WhatsApp or the SLA clock (the service-level deadline is **not** re-based, like a reschedule).
- **Docs to update with the code** (Task 16 §6): root `AGENTS.md` domain facts (one paragraph: *"A ticket's
  franchisee is its pincode's owner unless a manager handed it to another — `tickets.routing_override`, derived,
  waives the pincode half of eligibility"*), `api/AGENTS.md` (the column, the five-place note, the two
  routes), `adminWeb/AGENTS.md` (the dialog), `api/app/core/coverage.py` docstring.

---

## 9. For the index owner — additions to merge (nothing in 00–16 was edited)

| Where | Add |
|---|---|
| Index §3.2 (new columns) | `tickets.routing_override` — Task 18 — boolean NOT NULL DEFAULT false; derived `target ≠ owner of pincode`; waives the pincode half of eligibility in the five places. |
| Index §3.3 (vocabularies) | `notifications.kind` += `ticket_handed` (13 chars; Task 18). Error codes += `TICKET_ASSIGNED`, `SAME_FRANCHISEE`, `FRANCHISEE_INACTIVE` (all 409; Task 18). `ticket_events.kind = 'franchisee_changed'` is also written by Task 18 (actor staff). |
| Index §3.6 (migrations) | Row 8: `f3b9d1a6c845` · `f3b9d1a6c845_hand_ticket_to_franchisee.py` · down_revision `e8a2c5b7d913` (Task 17) · Task 18. |
| Index §3.7 (helpers) | `app/core/franchise_handover.py` (pure); `coverage.technicians_by_franchisee`; `restamp_ticket(..., release_override=False)`; `technicians_covering(..., routing_override)` required; `PoolChanged.routing_override`. |
| Index §4 (task list) | `18 | 18-hand-ticket-to-franchisee.md | Hand an unassigned ticket to another franchisee | api + web | 04, 05, 09` |
| Index §5.5 (convention 5) | Append: "…and, since Task 18, each place waives the pincode half for a ticket with `routing_override`." |
| Task 03 | Carve-out `_plan`/`_apply` skip `routing_override` tickets; `deactivate` hands unassigned override tickets back (§4.5). |
| Task 04 | `needs_restamp`/`restamp_ticket`/`pool_frame_matches`/`technicians_covering`/`publish_pool_changed` gain the override (§4.3, §4.5). |
| Task 16 | A release row (below); `seed/verify.py` changes (§3.3); AGENTS.md paragraph (§8). |

**Release (for 16-rollout-and-docs.md).** **R9 — Hand a ticket to another franchisee (Task 18).** *Why not
earlier:* the migration is the last link of the linear chain (after `d6c3a9f1e874` and `e8a2c5b7d913`), and
a revision cannot run before its parent. *Gate:* R1 (Task 04's five places), R2 (Task 05's audience and
`franchiseeId` filter), R3 (Task 09 — the target admin must be able to read the ticket) and R7 (Task 12 —
`Awaiting Part` exists, so the refusal list is complete) live on prod; §5.3 copy signed off; owner migrated
`RelianceProdDB` to `f3b9d1a6c845` **before** the API publish. *API:* publish after the migration; the old
API is unaffected by the column. *adminWeb:* `web-prod-deploy.yml` — shipping the console first is harmless
(the routes would 404 → the button's own error toast); ship it after the API. *Mobile:* none.
*Rollback:* redeploy the previous API; the flag stays in the DB and is ignored. `downgrade` refuses while
any flagged ticket exists (§3.3).

**Open questions for the owner (not blocking):** (1) Should the **source** franchisee's admin get a bell when
a ticket leaves ("`ACM-INST-0500` was handed to another franchisee")? Built without — the link would 404 for
them. (2) Is `jobs.assign` the right key, or should hand-over have its own so a company can allow assigning
but not cross-franchisee moves (H2)? (3) Should handing a ticket **to an external** franchisee need National
Head rank rather than Area Manager (an external franchisee is a separate business)? Built at Area Manager,
as ruled.
