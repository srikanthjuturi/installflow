# Task 04 — Ticket routing and eligibility

> Read [00-index.md](00-index.md) first. Assumes Task 01 (`tickets.franchisee_id`, `technician_profiles.franchisee_id`,
> `technician_invites.franchisee_id`, `app/core/franchise.py` with `home_franchisee_id`, `franchisee_for_pincode`,
> `franchisees_for_pincodes`, `route_pincodes`, `franchisee_pincodes_subquery`), Task 02 (`Principal.franchisee_id`,
> `is_franchise`, `FRANCHISE_ROLES`, `FACILITY_ROLES`, the `franchise.tickets` key, the fail-closed placeholders
> listed in Task 02 §4.3) and Task 03 (`core.franchise.lock_routing`, the carve-out) exist exactly as named.
>
> Layer: **api only**. Depends on 03. The console contract it serves is Task 09 §4.5; Task 05 calls its
> range check; Task 12 widens its facility branch.

---

## 1. Goal and why

**Plain version.** A ticket already knows which franchisee it belongs to — Task 01 stamps it from the
pincode the moment it is raised. Nothing yet *uses* that: any technician covering the pincode can still be
offered, pushed, or assigned the job, and nothing stops a manager typing a pincode owned by SkyFix into an
Acme Home technician. This task makes the stamp mean something:

1. **Only the ticket's franchisee's technicians can take it** — in all five places that decide who may
   (index §5.5).
2. **A technician's pincodes must lie inside their franchisee** — refused on add, edit, invite and
   self-registration with `PINCODE_OUTSIDE_FRANCHISEE`.
3. **The stamp follows the pincode whenever the job is re-routed** — released by a cancellation or a
   no-show, or handed over by a manager — so a job never waits for technicians who no longer cover it.
4. **A franchisee admin reads its own tickets** (F13) through the existing `/tickets` endpoints, and the
   console's ticket socket admits them, scoped the same way.

**Worked example.** SkyFix owns `500030-500040`; Acme Home owns the rest.

| Moment | What happens |
|---|---|
| Vendor raises `ACM-INST-0500` for `500032` | Task 01 stamps SkyFix. This task makes intake wait for any carve-out in flight before reading the owner. |
| Pool | Ravi (SkyFix, covers `500032`) sees it. Sita (Acme Home) covered `500032` before the carve-out and was trimmed — even if a stale row survived, `pool_query` now also demands `franchisee_id` = SkyFix, so she never sees it, is never pushed about it, and her socket does not ring. |
| Ravi accepts | The guarded UPDATE additionally matches his **current** franchisee against the ticket's. |
| Ravi cancels (2 days before) | The job goes back to `New`, its stamp is re-checked against `500032`'s owner (still SkyFix → no change), and SkyFix's technicians are pushed. |
| `ACM-INST-0398` | Assigned to Ravi **before** the carve-out, so stamped Acme Home while Ravi moved to SkyFix (F6 keeps both). The Area Manager reassigns it: the stamp is first re-routed to `500034`'s owner (SkyFix) — event `franchisee_changed` — and then only SkyFix technicians are eligible. |
| A manager adds `500032` to Sita | 422 `PINCODE_OUTSIDE_FRANCHISEE`: `500032 belongs to SkyFix Services`. |
| SkyFix's admin opens `/tickets` | Sees exactly the tickets stamped SkyFix — including none of Acme Home's, even in the same street. `GET /tickets/<an Acme Home ticket>` → **404**. |

---

## 2. Decisions implemented

| Index ID | How |
|---|---|
| F4 | Intake, re-routing and the range check all resolve a pincode through Task 01's `route_pincodes` ("owner row, else home"). |
| F6 | Assigned tickets keep their stamp on carve-out; this task re-stamps them when they are **released** or **reassigned** (§4.2). |
| F7 | Tickets stay company work: the escalation queue, notifications by pincode, reschedule, force-close and the dashboard are unchanged (§4.7). |
| F13 | `franchisee_admin` reads its franchisee's tickets read-only; facility roles fail closed until Task 12 (§4.5). |
| §3.3 | `PINCODE_OUTSIDE_FRANCHISEE`; `ticket_events.kind = 'franchisee_changed'` (CHECK widened by Task 01's migration `3b7e1f0a9c41`, 01 §3.3a). |
| §3.4 | `franchise.tickets` (franchisee_admin, facility_admin, facility_operator). |
| §5.1 | Another franchisee's ticket → 404 for a franchise principal; another company's → 404 for anyone. |
| §5.5 | All five eligibility places gain one predicate, `technician.franchisee_id = ticket.franchisee_id`. |

---

## 3. Schema

**None.** Every column is Task 01's. The `franchisee_changed` CHECK value is placed by Task 03 §3. Two
**realtime payloads** gain an optional key (§4.3, §4.6); they are JSON over `pg_notify`, not schema, and
an old payload without the key still parses.

---

## 4. API / service changes

### 4.1 Intake — verify Task 01, close the race, and the paths that do not exist

**Task 01 already stamps both writers** (Task 01 §4.5): `tickets/service.create_ticket` calls
`franchisee_for_pincode` after `_assert_pincode_known`; `tickets/import_service._commit` calls
`franchisees_for_pincodes` once before its loop. This task does **not** restate that. It adds three things.

**(a) The read waits for a carve-out.** In both places, immediately **before** the ownership read, add

```python
# A carve-out (Task 03) holds this exclusively while it moves pincodes and re-stamps open tickets; a
# ticket raised in that instant must see the NEW owner, or it lands with a franchisee whose technicians
# no longer cover it. Shared, so intakes never wait for each other.
await lock_routing(db, principal.company_id, exclusive=False)
```

Lock order is fixed and must stay so: routing (shared) → `core.credits.lock` → vendor credit. The
carve-out takes only the routing lock, so no cycle is possible.

**(b) Every other ticket writer — verified, none exists.**

| Channel / path | Finding (grep) | Action |
|---|---|---|
| Manual (`POST /tickets`) | `create_ticket` — `Ticket(` at `tickets/service.py` ~2010 | Task 01 stamps; (a) above |
| Excel (`POST /tickets/import`, `/import/on-behalf`) | `import_service._commit` — `Ticket(` at ~1708 | Task 01 stamps; (a) above |
| **API** | Does not exist: `core/intake.py` `AVAILABLE_INTAKE_CHANNELS = ("Excel", "Manual")`, `UNAVAILABLE_REASON["API"]` "Coming soon" | None now. Add to the `INTAKE_CHANNELS` comment: *"The API channel, when built, must create tickets through `create_ticket` (or stamp with `franchisee_for_pincode` under `lock_routing(shared)`) — Task 04."* |
| Seeds | `scripts/seed/lifecycle.py`, `seed_play_review.py` call `tickets_service.create_ticket` | Covered by `create_ticket` |
| **Pincode edits** | None. `grep -rn "\.pincode = \|values(pincode" api/app/features api/app/core` finds only `companies` and `vendors` addresses; `PATCH /tickets/{id}/serial` and `/observed-serial` are the only ticket edits | None now. Add to the `Ticket.franchisee_id` column comment (`models/ticket.py`): *"Re-stamp through `core.franchise.restamp_ticket` whenever `pincode` changes. Today nothing changes a ticket's pincode."* |
| Superadmin moves a pincode to another state (`PUT /geo/pincodes/{code}`) | Changes geography, not the code | None — franchisee ownership is by code, not by state. |

Command for the implementer to re-run (results must match the table, or the new path is covered the same
way): `grep -rn "Ticket(\|insert(Ticket)\|update(Ticket)" api/app --include=*.py | grep -v __pycache__`.

**(c) Re-routing a ticket that leaves a technician** — new helper in `app/core/franchise.py`:

```python
async def restamp_ticket(db: AsyncSession, row: Ticket, *, actor_kind: str, actor_label: str | None,
                         by_user: uuid.UUID | None = None) -> tuple[uuid.UUID, uuid.UUID] | None:
    """Point `row.franchisee_id` at the CURRENT owner of `row.pincode`. Returns (old, new), or None
    when it already does.

    For a ticket being RE-ROUTED: released by its technician (cancel, confirmed no-show) or handed to a
    new one by a manager. A carve-out (Task 03) deliberately leaves assigned tickets where they were
    (F6); this is where they catch up, at the one moment the old stamp would otherwise strand them —
    offered to a franchisee whose technicians no longer cover the pincode.

    Takes lock_routing(shared). Writes in the caller's transaction:
      UPDATE tickets SET franchisee_id = :new WHERE company_id = :c AND id = :id AND franchisee_id = :old
    plus one TicketEvent(kind='franchisee_changed', from_status=None, to_status=None,
      note=f"{old_name} → {new_name} · pincode {pincode} belongs to {new_name}")   # PROPOSED copy
    and sets row.franchisee_id. Never commits."""
```

Pure core: `needs_restamp(current, owner) -> bool` in `app/core/franchise_routing.py` (§4.8). The owner
comes from `franchisee_for_pincode`.

Callers (each **after** its guarded UPDATE succeeded, **before** its `publish_pool_changed`, in the same
transaction):

| Caller | Where | `actor_kind` / label |
|---|---|---|
| `features/jobs/service.py :: cancel` | right after `row.technician_id = None` (~line 2048) | `"system"` / `"Pincode routing"` |
| `features/tickets/service.py :: record_no_show` | right after `row.technician_id = None` (~line 3211) | `"system"` / `"Pincode routing"` |
| `features/tickets/service.py :: assign_technician` | right after `row = await _load(...)` and the status check, **before** `_load_assignable_technician` | `"staff"` / `principal.user.full_name or "—"`, `by_user=principal.user_id` |

On a refusal later in `assign_technician` the request raises before `commit`, so the re-stamp is rolled
back with it — no orphan event.

`jobs/service.py` builds no `TicketEvent` from the tickets slice (hard rule 4) — `restamp_ticket` lives in
core precisely so both slices can call it.

### 4.2 The five eligibility places (index §5.5)

Each gets the same fact: **the technician's franchisee is the ticket's franchisee.** Read the technician's
franchisee **live** (a subquery or a fresh read), never from a profile loaded earlier in the request — a
carve-out may have moved them since.

#### (1) `features/jobs/service.py :: pool_query` (~line 143)

**Before** — `conditions` holds `still_offerable(now), covers_pincode, certified_for, is_active` (+ open /
eligible / passed terms).

**After** — define next to `is_active`:

```python
# The ticket's franchisee runs this job (F7): only its technicians are offered it. Correlated on the
# outer Ticket and read live, so a technician moved by a carve-out a second ago is judged by where
# they are now. Always applied — no flag relaxes it, for `status`'s reason: it is somebody else's
# decision about this technician, not their own toggle.
in_franchisee = (
    select(TechnicianProfile.id)
    .where(
        TechnicianProfile.company_id == company_id,
        TechnicianProfile.id == technician_id,
        TechnicianProfile.franchisee_id == Ticket.franchisee_id,
    )
    .exists()
)
```

and append `in_franchisee` to the always-on list:
`conditions = [Ticket.company_id == company_id, Ticket.deleted_at.is_(None), still_offerable(now), covers_pincode, certified_for, is_active, in_franchisee]`.
Update the docstring's "What `False` drops is exactly two things" paragraph: coverage, certification,
status **and franchisee** still apply on every flag. `list_pool`, `get_offer`, `pass_job` and `accept` all
inherit it.

#### (2) `core/coverage.py :: technicians_covering` (~line 117)

**Before** — `async def technicians_covering(db, *, company_id, pincode, node_path_ids, slot_start=None)`;
conditions `company_id, status == ACTIVE, accepting_work, covers_pincode, certified_for` (+ cap).

**After** — a new **required** keyword, so every caller is found by the type checker / a TypeError:

```python
async def technicians_covering(db, *, company_id: uuid.UUID, franchisee_id: uuid.UUID, pincode: str,
                               node_path_ids, slot_start=None) -> list[uuid.UUID]:
    ...
    conditions = [
        TechnicianProfile.company_id == company_id,
        TechnicianProfile.franchisee_id == franchisee_id,   # the ticket's franchisee (§5.5)
        TechnicianProfile.status == ACTIVE,
        TechnicianProfile.accepting_work.is_(True),
        covers_pincode,
        certified_for,
    ]
```

Docstring: "the ticket's `franchisee_id`, as stamped". Module docstring: "three facts" → four, "four
copies of that test" → "five places … plus the franchisee".

Callers to update (both pass the **ticket's** `franchisee_id`):

| Caller | Change |
|---|---|
| `core/push.py :: announce_pool_job` (~line 274) | new required kw `franchisee_id: uuid.UUID`, forwarded to `technicians_covering` |
| `features/tickets/service.py :: add_bonus_and_renotify` (~line 3056) | `franchisee_id=row.franchisee_id` |

and every `announce_pool_job` call: `jobs/service.py :: cancel` (~2114), `tickets/service.py :: reschedule`
(~3574), `tickets/service.py :: push_pool_job` (~3896) — each `franchisee_id=row.franchisee_id`, read after
§4.1(c)'s re-stamp in `cancel`.

#### (3) The guarded UPDATE in `features/jobs/service.py :: accept` (~line 856)

**Before**

```python
update(Ticket).where(
    Ticket.id == ticket_id, Ticket.company_id == company_id,
    Ticket.status.in_(("New", "Slot Pending")), Ticket.technician_id.is_(None),
    has_cap_room(company_id=company_id, technician_id=profile.id),
).values(technician_id=profile.id, status="Assigned")
```

**After** — one more clause, read inside the statement:

```python
    # Re-tested here, not only in the pool read above, for the cap's reason: a carve-out can re-stamp
    # this ticket (or move this technician) between that read and this write. Read inside the
    # statement, so Postgres judges both sides as they are when the row is locked.
    Ticket.franchisee_id == select(TechnicianProfile.franchisee_id).where(
        TechnicianProfile.company_id == company_id, TechnicianProfile.id == profile.id,
    ).scalar_subquery(),
```

**rowcount == 0** — today two outcomes (cap vs taken). Now three; extend `still_open` to also select
`Ticket.franchisee_id`, read the technician's current franchisee, and branch through the pure
`accept_miss_reason(still_open=…, same_franchisee=…)` (§4.8):

| `accept_miss_reason` | Response |
|---|---|
| `"cap"` (open, same franchisee) | unchanged `DAILY_CAP_REACHED` |
| `"moved"` (open, different franchisee) | **404 `Job not found`** — it left this technician's pool, exactly what `pool_query` would now say; **Decision (writer):** no new error code (none in §3.3) for a race this rare |
| `"taken"` (not open) | unchanged `JOB_ALREADY_TAKEN` |

#### (4) `features/tickets/service.py :: assign_technician` / `_load_assignable_technician` (~2668, ~2743)

1. §4.1(c): `await restamp_ticket(...)` before step 2, so a held ticket stamped with a franchisee that no
   longer owns its pincode is re-routed first (otherwise nobody would be eligible — the covering technicians
   are all in the new owner).
2. `_load_assignable_technician`: after the `status != ACTIVE` refusal, before coverage:

```python
    if profile.franchisee_id != row.franchisee_id:
        raise _refused(
            "TECHNICIAN_INELIGIBLE",
            f"{profile.code} works for another franchisee. This job belongs to "
            f"{await _franchisee_name(db, row.franchisee_id)} — choose one of its technicians.",
        )   # PROPOSED copy
```

   Same code as the coverage/certification refusals (the console already renders it); the message names
   which master to fix. `_franchisee_name` is a one-line `select(Franchisee.name)` local helper.
3. The guarded UPDATE gains the same scalar-subquery clause as (3), keyed on `profile.id` and
   `principal.company_id`.
4. The `unchanged` re-read on rowcount 0 also requires `Ticket.franchisee_id == row.franchisee_id`, so a
   re-stamp racing the assignment reads as `ALREADY_ASSIGNED` ("Reload the page and try again"), never as a
   false `DAILY_CAP_REACHED`.
5. Class docstring: "Coverage and certification are enforced" → "Franchisee, coverage and certification".

The assignment **shortlist** (`GET /technicians?pincode=&subcategoryId=&onDay=`) needs no filter of its own:
after §4.4 every technician covering a pincode belongs to that pincode's owner, and step 1 has just made the
ticket's stamp that owner. **Decision (writer):** no `franchiseeId` filter is added for it here (Task 05
adds one for the Technicians screen).

#### (5) `features/jobs/ws.py` — the pool socket

`PoolChanged` (in `core/realtime.py`) and `publish_pool_changed` gain an **optional** franchisee:

```python
@dataclass(frozen=True)
class PoolChanged:
    company_id: uuid.UUID
    pincode: str
    node_path_ids: tuple[uuid.UUID, ...]
    #: The ticket's franchisee. None from a publisher that predates it, or a frame for "anyone" —
    #: matched by everyone, because this socket rings too often rather than too rarely.
    franchisee_id: uuid.UUID | None = None
```

`as_payload` adds `"franchisee_id": str(...) or None`; `from_payload` reads `raw.get("franchisee_id")`
(absent → None). `publish_pool_changed(db, *, company_id, pincode, node_path_ids, franchisee_id: uuid.UUID | None = None)`.

`jobs/ws.py`:
- `_Coverage` gains slot `franchisee_id: uuid.UUID | None`; `load` reads it with one more scalar
  (`select(TechnicianProfile.franchisee_id).where(company_id, id)`), refreshed on the same 60 s TTL.
- `matches(event)` becomes `pool_frame_matches(pincodes=self.pincodes, nodes=self.nodes,
  franchisee_id=self.franchisee_id, event_pincode=event.pincode, event_path=event.node_path_ids,
  event_franchisee=event.franchisee_id)` (pure, §4.8): today's test **and**
  `event_franchisee is None or franchisee_id is None or event_franchisee == franchisee_id`.

Every `publish_pool_changed` call passes the ticket's franchisee (`franchisee_id=row.franchisee_id`; for a
ticket that **leaves** the pool — accept, assign, escalate — that is the franchisee whose technicians were
being shown it):

| File · function (line ≈) | Pass |
|---|---|
| `core/escalation.py :: escalate` (186) | `row.franchisee_id` |
| `core/reschedule.py :: move_slot` (270) | `row.franchisee_id` |
| `features/jobs/service.py :: accept` (936) | `offered.franchisee_id` |
| `features/jobs/service.py :: cancel` (2099) | `row.franchisee_id` (after the re-stamp) |
| `features/tickets/import_service.py :: _commit` (1808) | bucket key gains the franchisee: `(t.pincode, tuple(t.node_path_ids), t.franchisee_id)` |
| `features/tickets/service.py :: create_ticket` (2156) | `row.franchisee_id` |
| `features/tickets/service.py :: assign_technician` (2888) | `row.franchisee_id` (after the re-stamp) |
| `features/tickets/service.py :: add_bonus_and_renotify` (3042) | `row.franchisee_id` |

And in Task 03's carve-out: one frame for the old **and** one for the new franchisee of each re-stamped
ticket; `restamp_ticket` callers likewise publish for the old franchisee too when the stamp changed
(cancel and no-show release a job that was not in either pool, so only the new one matters there; assign
removes it from no pool — no extra frame).

### 4.3 Coverage-in-range — `PINCODE_OUTSIDE_FRANCHISEE`

New helper in `app/core/franchise.py` (name fixed by Task 05, which calls it from the franchise portal):

```python
async def assert_pincodes_in_franchisee(db: AsyncSession, company_id: uuid.UUID,
                                        franchisee_id: uuid.UUID, pincodes: Iterable[str], *,
                                        name_owners: bool) -> None:
    """Refuse coverage outside this franchisee (F4: the home owns every code no other franchisee owns).

    Takes lock_routing(shared) — a carve-out in flight is waited for, then judged after.
    routes = franchisees_for_pincodes(db, company_id, pincodes)          # Task 01, owner else home
    outside = codes_outside(pincodes, routes, franchisee_id)            # pure, §4.8
    if outside: raise AppError(422, "PINCODE_OUTSIDE_FRANCHISEE", outside_message(...))

    name_owners=True (staff): "Outside Acme Home: 500032, 500033 (SkyFix Services). Pick pincodes
      Acme Home owns."
    name_owners=False (a franchise principal, or the technician themselves at registration): "Outside
      your franchisee: 500032, 500033. Pick pincodes it owns." — one franchisee's admin is not told who
      owns another's codes.                                                  # PROPOSED copy
    At most 20 codes then "and N more"."""
```

**Status 422** — Task 08 §4.2 and Task 09 §4.2 both expect 422 for this code. It deliberately does **not**
filter `is_active`: api/AGENTS.md "Exactly one read filters `is_active`" — editing a technician whose coverage
predates a switch-off must still work. A switched-off code nobody owns routes to home, as it always did.

Call sites — **after** the existing `check_pincodes_exist` and `check_pincodes_in_own_area`, so a manager
outside their area still gets that (403) message first:

| Function (file) | Franchisee checked | `name_owners` |
|---|---|---|
| `create_technician` (`features/technicians/service.py` ~1682) | the franchisee Task 01 stamps on the new profile (`home_franchisee_id` today; Task 05 replaces it with `principal.franchisee_id` for a franchise caller) — compute it **once** into a local and use it for both | `not principal.is_franchise` |
| `update_technician` (~1798), inside `if body.pincodes is not None:` | `profile.franchisee_id` | `not principal.is_franchise` |
| `create_invite` (~2086) | the invite's franchisee, as for `create_technician` | `not principal.is_franchise` |
| `onboarding/service.py :: register` (~304, before any write) | `invite.franchisee_id`, against `assigned` | `False` |

At **registration**, coverage came from the invite and Task 03 moves or trims live invites in a carve-out, so
a refusal here means data drifted; the 422 carries the code and the technician is told to ask the person
who invited them. **Decision (writer):** refuse rather than silently drop the codes — a technician who
registers covering fewer pincodes than they were promised, with nothing on screen, is the worse failure.
Mobile: an unknown code falls back to the server's English (`mobileapp/src/i18n/errorText.ts` step 4); a
translated `errors.code.PINCODE_OUTSIDE_FRANCHISEE` key is Task 07's to add.

Task 05's franchise-portal twins (`/franchise/technicians…`) call this same helper — never a copy.

### 4.4 Franchise read access to tickets (F13, Task 09 §4.5)

**Routes** (`features/tickets/router.py`): add

```python
#: Read-only ticket access for the franchise portal (F13) beside staff and vendors' `jobs.view`.
#: Who sees WHICH tickets is `service.scoped()`'s, not this key's.
CanReadTickets = Annotated[Principal, Depends(require_any_feature("jobs.view", "franchise.tickets"))]
```

and use it on exactly four routes; everything else keeps its guard:

| Route | Guard after | Franchise behaviour |
|---|---|---|
| `GET /tickets` | `CanReadTickets` | scoped (below); filters, `technicianId=` included, work unchanged |
| `GET /tickets/{ticket_id}` | `CanReadTickets` | scoped; outside → 404 |
| `GET /tickets/{ticket_id}/proof` | `CanReadTickets` | scoped; outside → 404 |
| `GET /tickets/{ticket_id}/attachments` | `CanReadTickets` | **404 always** — `list_attachments` gains `or principal.is_franchise` beside its vendor refusal (staff-only, as for vendors) |
| `GET /tickets/summary`, `/escalations`, `/intake-status`, imports | unchanged (`jobs.view` / floors / `IsVendor`) | 403 — they hold neither key |
| every write | unchanged | Already refused: each carries `require_min_rank(AREA_MANAGER)` (franchise ranks 8–10), `IsVendor`, or `NationalHeadUp` — **except** `PATCH /{id}/serial` and `GET /{id}/serial-check` (`jobs.view` only). Defence in depth for a Feature Access override: `correct_serial` and `check_serial` raise `HTTPException(403, "Tickets are read-only on this account")` when `principal.is_franchise` |

**`service.scoped()`** — replace Task 02's placeholder (`if principal.is_franchise: return stmt.where(sql_false())`)
with ownership, placed after the vendor branch and before the staff branch:

```python
    if principal.is_franchise:
        # By OWNERSHIP, like a vendor — never through `visible_pincodes` (Task 02 §4.3): after a
        # carve-out an assigned ticket keeps its franchisee while its pincode moved, and the ledger
        # follows the stamp, so the stamp is what a franchisee "has".
        if principal.franchisee_id is None:
            return stmt.where(sql_false())           # corrupt membership: nothing, never everything
        stmt = stmt.where(Ticket.franchisee_id == principal.franchisee_id)
        if principal.role in FACILITY_ROLES:
            # F13: facility staff see only tickets with a part request. `spare_part_requests` arrives
            # in Task 12, which replaces this line with an EXISTS on its own franchisee's requests.
            return stmt.where(sql_false())
        return stmt
```

Docstring table gains two rows (`franchisee_admin` → `franchisee_id = mine`; facility → that AND a part
request, Task 12). Because `_load` goes through `scoped`, fetch-by-id, `list_proof`, `get_ticket`,
`check_serial` and every staff write's loader inherit it.

**Money on the read.** `_hydrate` nulls `technicianPayoutPaise` for `principal.is_vendor`; extend to
`principal.is_vendor or principal.role in FACILITY_ROLES`. `get_ticket`'s `if not principal.is_vendor:`
block (payout credited, penalties, reviewer) becomes `if not principal.is_vendor and principal.role not in FACILITY_ROLES:`.
A franchisee admin sees them — technicians' money is theirs (F7); facility staff handle parts, not pay.
**`vendorPricePaise` is withheld from every franchise caller** (index §6 — **SETTLED by the owner 2026-10-15, R6**:
hidden/null from every franchise principal). Change `TicketOut.vendorPricePaise` to `int | None = None` and null it in `_hydrate` when
`principal.is_franchise`, beside the vendor rule for `technicianPayoutPaise`. An external franchisee is a
separate business; this extends the existing "neither party sees the other's figure" rule. The type change
also touches adminWeb (`types/ticket.ts`, which renders `—` for null; Task 09 consumes it) and mobileapp,
whose job shapes carry no vendor price at all, so nothing changes there. Acceptance: a franchisee admin's
`GET /tickets/{id}` returns `"vendorPricePaise": null`, and a National Head's still returns the number.

**`TicketOut` gains** `franchiseeId: uuid.UUID` and `franchiseeName: str` (one batched
`select(Franchisee.id, Franchisee.name).where(id IN …)` in `_hydrate`). Shown to staff and franchise
callers; **withheld from vendors** (`None` — declare both `| None = None`): who runs the company's
technicians is not the vendor's business. The console's ticket page renders it (Task 08/09).

### 4.5 The console ticket socket admits franchise users (`features/tickets/ws.py`)

Task 02 made `_authenticate` carry `franchisee_id` and `_Visibility` fail closed with a `franchise` slot.
This task widens `may_hear` only (bells are Task 05's: `hears_notification` stays `return False` for a
franchise viewer until Task 05 adds the audiences).

- `TicketChanged` (`core/realtime.py`) gains optional `franchisee_id: uuid.UUID | None = None`, in the payload
  as `"franchisee_id"`; `from_payload` reads it with `.get`. `publish_ticket_changed` passes
  `franchisee_id=getattr(row, "franchisee_id", None)`.
- `_Visibility` gains slots `franchisee_id` and `facility`; `load` for a franchise principal sets
  `franchise = True`, `franchisee_id = principal.franchisee_id`, `facility = principal.role in FACILITY_ROLES`.
- `may_hear` first branch:

```python
        if self.franchise:
            return franchise_hears_ticket(viewer_franchisee=self.franchisee_id, facility=self.facility,
                                          event_franchisee=event.franchisee_id)   # pure, §4.8
```

  `franchise_hears_ticket`: `False` when either id is None, when they differ, or when `facility` is True
  (Task 12 widens, as in `scoped`); else `True`. **Exact, not biased** — this socket's module docstring
  explains why a console socket may not over-ring the way the pool socket does.

A carve-out re-stamp publishes the ticket with its **new** franchisee; the old franchisee's portal learns on
its next refetch. **Decision (writer):** acceptable — it is a refresh delay, not an access gap (the REST read is
authoritative).

### 4.6 Existing helpers reused

| Need | Reuse |
|---|---|
| Pincode → franchisee | `core.franchise.franchisee_for_pincode`, `franchisees_for_pincodes`, `route_pincodes` (Task 01) |
| Serialise against carve-outs | `core.franchise.lock_routing` (Task 03) |
| A coded 409/422 | `core.errors.AppError`; tickets' `_refused`; jobs' `JobRefused` |
| Read-only key admission | `core.deps.require_any_feature` |
| Role sets | `app.models.role.FRANCHISE_ROLES`, `FACILITY_ROLES` (Task 02) |

### 4.7 Unchanged, deliberately (F7 — tickets stay company work)

- **Escalation queue** (`GET /tickets/escalations`, `core/escalation.escalate`, `sweeps.sweep_unaccepted`):
  still staff, still by territory. An escalated SkyFix ticket reaches Acme's Area Manager for that state,
  who can assign a SkyFix technician (and only one — §4.2 (4)).
- **Notifications by pincode** (`notify(..., pincode=…)`, `notifications/service._visible`,
  `coverage.users_notified_by`, the ws `hears_notification`): unchanged — company staff by territory.
  Franchise audiences are Task 05.
- **Reschedule, force-close, penalty reversal, no-show confirmation, the dashboard, global search**: staff,
  unchanged; each loads the ticket through `scoped`, whose staff branch is untouched.
- **`mine_query` / the technician's own jobs**: by `technician_id`; a moved technician keeps their held jobs (F6).
- **The daily cap**, `has_cap_room`, `still_offerable`: unchanged.

### 4.8 Pure helpers — `app/core/franchise_routing.py` (new; stdlib + `uuid` only)

```python
def needs_restamp(current: uuid.UUID | None, owner: uuid.UUID) -> bool: ...
def codes_outside(wanted: Iterable[str], routes: Mapping[str, uuid.UUID],
                  target: uuid.UUID) -> list[str]: ...            # sorted, de-duplicated
def outside_message(franchisee_name: str, outside: Sequence[str], *,
                    owner_names: Mapping[str, str] | None, limit: int = 20) -> str: ...
def accept_miss_reason(*, still_open: bool, same_franchisee: bool) -> Literal["cap", "moved", "taken"]: ...
def pool_frame_matches(*, pincodes: AbstractSet[str], nodes: AbstractSet[uuid.UUID],
                       franchisee_id: uuid.UUID | None, event_pincode: str,
                       event_path: Sequence[uuid.UUID], event_franchisee: uuid.UUID | None) -> bool: ...
def franchise_hears_ticket(*, viewer_franchisee: uuid.UUID | None, facility: bool,
                           event_franchisee: uuid.UUID | None) -> bool: ...
```

### 4.9 Errors and transactions

| Status · code | Where |
|---|---|
| 422 `PINCODE_OUTSIDE_FRANCHISEE` | technician add/edit, invite, self-registration |
| 409 `TECHNICIAN_INELIGIBLE` (existing) | manual assignment across franchisees |
| 404 `Job not found` (existing) | accept lost to a carve-out |
| 404 (existing) | a franchise principal reading another franchisee's ticket, any attachment |
| 403 | franchise principal on serial correction (override only), summary, escalations |

Transactions: every change sits inside the caller's existing transaction; `restamp_ticket` writes its event
with the change it describes (§5.4). No new commit points.

---

## 5. Client changes

**None — Tasks 08/09.** Task 09 §4.5 is the console contract this serves. Task 07 adds the mobile
translation key for `PINCODE_OUTSIDE_FRANCHISEE`. Installed apps are unaffected: `PoolChanged` frames are
server-internal (the app receives only `{"type":"pool.changed"}`), and no ticket status, ledger kind or
response field the app parses changes (index X4 untouched).

**PROPOSED copy (X2):** the `franchisee_changed` note in §4.1(c), the assignment refusal in §4.2 (4), both
`PINCODE_OUTSIDE_FRANCHISEE` sentences in §4.3, the serial read-only refusal in §4.4.

---

## 6. Unit tests (pure — no database, X1)

### `api/tests/unit/test_franchise_routing.py`

`needs_restamp`: 1. same → False; 2. different → True; 3. current None → True.

`codes_outside` (with Task 01's `route_pincodes` building `routes`):
4. All codes routed to target → `[]`.
5. Target is the home; one code owned by SkyFix → `["…"]`.
6. Target is SkyFix; a code not owned by anybody (routes to home) → outside.
7. Duplicates and unsorted input → sorted, de-duplicated.
8. Empty input → `[]`.

`outside_message`:
9. With `owner_names` → names each owner after its codes, grouped.
10. Without → "Outside your franchisee: …", no other franchisee's name appears.
11. 25 codes → 20 shown and "and 5 more".

`accept_miss_reason`: 12. `(True, True)` → `"cap"`; 13. `(True, False)` → `"moved"`; 14. `(False, *)` → `"taken"`.

`pool_frame_matches`:
15. Pincode, path and franchisee match → True.
16. Franchisee differs → False.
17. Event franchisee None (old publisher) → decided by pincode + path alone.
18. Viewer franchisee None (cache not loaded) → decided by pincode + path alone.
19. Pincode not covered → False even with same franchisee.
20. Certified on an ancestor in `event_path` → True (descendant-aware, unchanged behaviour).

`franchise_hears_ticket`:
21. Same franchisee, admin → True. 22. Different → False. 23. Event None → False.
24. Facility viewer, same franchisee → False (until Task 12). 25. Viewer None → False.

### `api/tests/unit/test_realtime_payloads.py`

26. `PoolChanged` with a franchisee → `as_payload` → `json.loads` → `from_payload` round trip equal.
27. A payload **without** `"franchisee_id"` (exactly today's shape) → parses, `franchisee_id is None`.
28. `TicketChanged` same two cases.
29. `"franchisee_id": "not-a-uuid"` → `from_payload` returns None (its existing malformed-frame branch).

`app/core/realtime.py` imports `psycopg` and `app.core.config` but not `app.core.database`, so it is importable
under Task 00's guard; if that ever changes, move the dataclasses to a module of their own.

---

## 7. Acceptance criteria

RelianceDB (dev), local API, **GreenTech Demo Services** only. Staff logins `*.demo@seed.example.com`
(password: `grep -n '^PASSWORD' api/app/scripts/seed_demo.py`); demo technician `1666600000`, OTP `246810`
(`POST /auth/otp/request`, `/auth/otp/verify`). Customer phones on tickets: only `6301815418` or
`9398475448`. Set up with Task 03: franchisee **S** owning a range that covers one demo technician **R**
wholly (R moves to S); the home is **H**; a pincode **P** inside S's range; a pincode **Q** in H.

```sql
-- ids for the checks below
SELECT f.id, f.name, f.is_home FROM franchisees f JOIN companies c ON c.id = f.company_id
 WHERE c.name = 'GreenTech Demo Services';
```

1. **Intake.** **Given** the vendor raises a ticket for P and one for Q (`POST /tickets`), **then**
   `SELECT code, pincode, franchisee_id FROM tickets ORDER BY created_at DESC LIMIT 2` shows S and H.
   **And** an Excel import of two rows (P, Q) stamps the same.
2. **Pool (1).** **Given** R signed in, **when** `GET /jobs/pool`, **then** the P ticket is listed and the Q
   ticket is not. **Given** a stale coverage row inserted by hand for an H technician T —
   `INSERT INTO technician_pincodes (id, company_id, technician_id, pincode, created_at, updated_at) VALUES (gen_random_uuid(), :c, :t, 'P', now(), now())` —
   **then** T's `GET /jobs/pool` still does not list the P ticket, and `GET /jobs/pool/{P ticket id}` (offer) is 404.
   Delete the row afterwards.
3. **Accept (3).** With T's stale row in place, `POST /jobs/{P ticket}/accept` as T → **404**; the ticket is
   still unassigned. As R → 200, `technician_id = R`.
4. **Accept race.** **Given** an open ticket at P, **when** S's range is cleared (`PUT /franchisees/{S}/pincodes`
   with `""` — the ticket is re-stamped to H, R moves to H) **and** R's app (still showing the old card) accepts,
   **then** R is now H and the ticket is H → 200 (they match again). Repeat with a technician who stayed in S
   (create one for the test, covering only P, before clearing): accept → **404**, never `DAILY_CAP_REACHED`.
5. **Push audience (2).** **Given** `PUSH_ENABLED` off, call `technicians_covering(db, company_id=…,
   franchisee_id=S, pincode=P, node_path_ids=…)` in a Python shell (`python -c` with `asyncio.run`) →
   contains R and not T (even with T's stale row); with `franchisee_id=H` → T and not R.
6. **Bonus count.** `POST /tickets/{escalated P ticket}/bonus` (AM) → `data.notified` counts only S technicians.
7. **Assign (4).** As the AM, `POST /tickets/{P ticket}/assign` with T (H) → 409 `TECHNICIAN_INELIGIBLE`
   naming S; with R → 200.
8. **Re-route on assign.** **Given** ticket K assigned to R **before** R was moved by a carve-out (K stamped H,
   pincode now S's), **when** the AM reassigns K to another S technician, **then** 200, `SELECT franchisee_id FROM tickets WHERE id = K`
   is S, and K's timeline has `franchisee_changed` (actor staff) **before** `assigned`.
9. **Re-route on release.** **Given** K as in 8 but left with R, **when** R cancels it from the app, **then** K
   is `New`/`Escalated` with `franchisee_id = S`, a `franchisee_changed` event (actor system, "Pincode routing")
   sits between `released` and any `escalated`, and S's technicians — not H's — see it in `GET /jobs/pool`.
   Same for `POST /tickets/{K}/no-show` (confirmed no-show).
10. **Pool socket (5).** Connect two websockets to `/api/v1/jobs/stream` (auth frame with R's and T's
    tokens, T with the stale row). Raise a ticket at P: R receives `{"type":"pool.changed"}`, T does not.
    Raise one at Q: neither (neither covers Q) — or T only if T covers Q.
11. **Range check.** As the NH, `PUT /technicians/{T}` with `pincodes` including P → **422**
    `"code":"PINCODE_OUTSIDE_FRANCHISEE"`, message names P and S; `POST /technicians` (new H technician) with
    P → 422; `POST /technicians/invites` with P → 422. As the AM, a pincode outside their states still gets the
    existing 403 first.
12. **Registration.** Create an invite for H with Q, then by SQL move Q to S without the carve-out
    (`INSERT INTO franchisee_pincodes … ('Q')`), and register from the invite link → 422
    `PINCODE_OUTSIDE_FRANCHISEE`, nothing written (`SELECT count(*) FROM technician_profiles WHERE invite_id = :i` = 0).
    Remove the row afterwards.
13. **Franchise reads.** Signed in as S's franchisee admin: `GET /tickets` lists only `franchisee_id = S`
    tickets (`SELECT count(*) FROM tickets WHERE franchisee_id = S AND deleted_at IS NULL` = `pagination.totalRecords`);
    `GET /tickets/{an H ticket}` → **404**; `GET /tickets/{an S ticket}` and `/proof` → 200;
    `GET /tickets/{an S ticket}/attachments` → **404**; `GET /tickets/summary` → 403;
    `POST /tickets/{S ticket}/assign` → 403; `GET /tickets/{id of another company's ticket}` → **404**.
14. **Facility (fail closed).** A facility operator of S (created via Task 12 when available, or by SQL for the
    test): `GET /tickets` → empty page; any ticket id → 404.
15. **Money on the read.** As S's admin, `GET /tickets/{S ticket}` carries `technicianPayoutPaise` and
    `penalties`; as the facility operator (once they can see one, Task 12) both are null/empty; as the vendor,
    `franchiseeId` and `franchiseeName` are null.
16. **Ticket socket.** S's admin connects to the console ticket stream: a move of an S ticket rings
    (`ticket.changed`), a move of an H ticket does not; the AM's socket behaves as before.
17. **Unchanged staff paths.** The AM's `GET /tickets/escalations`, notifications bell and dashboard return
    exactly what they did before this task for the same data (compare counts before/after deploying).
18. `python -m app.scripts.audit_tenancy` exits 0; `pytest api/tests/unit -q` green; `python -c "import app.main"` succeeds.
19. Task 01's `verify.py` check `_open_unassigned_tickets_route_by_pincode` passes after 2–12 (run
    `python -m app.scripts.seed.verify` the way the seed runs it for the demo company).

---

## 8. Out of scope and traps

- **Do not specify intake stamping a second time** — Task 01 owns it; this task adds only the routing lock
  and the re-route helper.
- **All five places, or none** (index §5.5; `core/coverage.py`'s docstring says the same). A predicate added
  to the pool but not to push rings phones that open onto "Job not found"; added to push but not the socket,
  apps miss jobs until the 20-second poll.
- **Read the technician's franchisee inside the statement**, never from `profile` loaded at the top of the
  request (§4.2 (3)).
- **Never route by `visible_pincodes` for a franchise principal** (Task 02 §4.3) — ownership is the stamp.
- **`technicians_covering`'s new keyword is required on purpose**: a caller that forgets it must fail loudly,
  not silently offer jobs company-wide.
- **No `is_active` filter** in the range check (api/AGENTS.md "Exactly one read filters `is_active`").
- **Slices never import each other** (hard rule 4): `restamp_ticket` and `assert_pincodes_in_franchisee` live
  in `core/franchise.py` so `jobs`, `tickets`, `technicians`, `onboarding` and Task 05's portal share them.
- **Lock order** routing → credits → vendor credit; never take the routing lock exclusively outside Task 03.
- **Escalated with a technician** (a customer's refusal) is not re-routed here — it is not released, and
  `assign_technician` re-stamps it only if a manager hands it on.
- **Out of scope:** franchise notifications and audiences (Task 05), part-request visibility for facility staff
  (Task 12 replaces the `sql_false()` lines in `scoped` and `franchise_hears_ticket`), the console ticket page's
  franchisee label (Tasks 08/09), hiding `vendorPricePaise` from franchise users (owner decision, settled 2026-10-15, §4.4).

### Cross-task note — `routing_override` (Task 18, added 2026-10-16)

A ticket carrying `routing_override = true` waives **only the pincode-coverage half** of eligibility. The
franchisee match, certification, active status, daily cap and online toggle still apply. The five eligibility
places stay in step: `jobs/service.pool_query`, `core/coverage.technicians_covering` (new required keyword
`routing_override`), `_load_assignable_technician` (the assign guard), the pool socket frame
(`PoolChanged.routing_override`, `pool_frame_matches`) and the `accept` guarded UPDATE, which has no coverage clause
today and must not gain one. `restamp_ticket` returns `None` for an override ticket, so a released handed-over ticket
stays with the franchisee it was handed to. Task 18 owns the column, the endpoint and the tests.
