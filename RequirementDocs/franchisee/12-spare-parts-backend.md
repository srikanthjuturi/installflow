# Task 12 — Spare parts: catalogue, requests, `Awaiting Part` (API)

> Layer: **api** · Depends on: **07** (the mobile forward-compat build must be LIVE on Play before
> this is published — X4) · Migration: **`d6c3a9f1e874_spare_parts.py`** (down_revision
> `b4a8e2f6c903`) · Slice: **`app/features/spare_parts/`** (prefix `/spare-parts`) plus shared
> logic in **`app/core/spare_parts.py`** · Clients: none here (console = Task 13, app = Task 15).
>
> Read `00-index.md` first. Every table, column, status, event kind, notification kind, audience,
> error code and feature key below is spelled exactly as §3 of the index spells it. Where this
> document had to choose something the index does not settle, it says **Decision (writer):**.

---

## 1. Goal & why

A technician who opens a machine and finds a broken part today has two options, both bad: finish
the job anyway (and the customer says it is not done), or cancel it (and pay the band for a fault
that is nobody's). This task gives them a third: **ask the franchisee's facility for the part**,
and park the job in a new status, **`Awaiting Part`**, until the facility has dealt with it.

The facility logs every physical step — approve or reject, *"new part issued to technician"*,
*"old part received back"* — so a job's paper trail finally covers the hour it spent waiting on a
part, and a part that left the store has a record of whether its broken twin came back. There is
no money and no stock count here (P5); only the log.

> **Worked example — a washing machine drain pump.**
>
> *Acme Appliances'* catalogue: **Home Appliances → Washing Machine → Front Load**, and under
> Front Load the model **Acme FL-7 (7 kg)**. An Admin has listed parts at three levels:
>
> | Where | Parts |
> |---|---|
> | Home Appliances (root) | Power cord |
> | Washing Machine | Drain pump, Inlet hose, Door gasket |
> | Front Load | Door lock, Drum bearing |
> | Acme FL-7 (model) | Control board FL-7, **Door gasket** *(switched off — the FL-7 gasket is not a field part)* |
>
> Ticket `RGT-INST-0412` is a *Service* call for an FL-7 in **500032**, which belongs to
> **SkyFix Services**. SkyFix's freelancer **Ravi** accepts it, captures proof, and the job is
> `In Progress`. The drum will not drain: the pump is dead.
>
> 1. Ravi opens **Parts** on the job. The app (`GET /jobs/{id}/parts`) offers *Control board FL-7,
>    Door lock, Drain pump, Drum bearing, Inlet hose, Power cord* — inherited root-first, the
>    model's own added, and **Door gasket gone** because the model's switched-off row hides the
>    one inherited from Washing Machine.
> 2. He picks **Drain pump**, notes *"pump motor seized, impeller fine"* and sends
>    (`POST /jobs/{id}/part-requests`). The request is `RGT-SPR-0007`, status `requested`; the job
>    moves **`In Progress → Awaiting Part`** with a `status_changed` and a `part_requested` event in
>    the same transaction; SkyFix's facility bell rings (`part_requested`, audience `facility`).
> 3. The customer agrees Ravi comes back Thursday 10–12. He reschedules from the app with the
>    customer's code — allowed in `Awaiting Part`, and the job **stays** `Awaiting Part`.
> 4. **Meena**, SkyFix's facility operator, approves it (push to Ravi: *"RGT-INST-0412: part
>    approved"*), and on Wednesday logs **issued** with *"FL-7 pump, box 3"*. That was the only open
>    request, so the job returns to **`In Progress`** (`status_changed`, actor Meena) and Ravi is
>    pushed *"part issued"*.
> 5. Thursday, Ravi fits the pump and presses **Complete** — accepted now; it would have been 409
>    `PARTS_PENDING` on Tuesday.
> 6. Friday, Ravi hands the dead pump in. Meena logs **returned** with a photo. The job is already
>    `Awaiting Customer` by then — returning is a log entry, never a gate.
>
> Task 11's speed clock subtracts Tuesday→Wednesday (the `Awaiting Part` interval read off the two
> `status_changed` events), so Ravi is not penalised for the facility's lead time.

---

## 2. Decisions

The owner-approved rules are P1–P7, F7/F8/F13 and X4 in the index. What follows is how this task
applies them, and every choice the index left open.

| # | Decision |
|---|---|
| D1 | **Decision (writer):** a request may be raised while the job is `In Progress` **or** `Awaiting Part`. P2 says "only while `In Progress`" and also "several requests per job allowed"; read literally, a technician waiting for a pump who then finds the hose split could not ask for the hose until the pump arrived. Anything else → 409 `PART_REQUEST_NOT_IN_PROGRESS`. **Flagged as an index inconsistency** — if the owner wants the literal P2, delete `"Awaiting Part"` from `REQUESTABLE_STATUSES` and nothing else changes. |
| D2 | **Decision (writer):** `spare_part_requests.franchisee_id` = **the ticket's** `franchisee_id` at raise time, not the technician's. The facility that serves a job is the one that owns the job's pincode. They are the same franchisee in every normal case (Task 04's eligibility predicate); they differ only for a technician carved out to another franchisee while holding an assigned job (F6 keeps the job's franchisee), and then the job's owner is the right desk. Ledger rows follow the technician (index §3.2) because money follows the payer; parts follow the job. |
| D3 | **Decision (writer):** a repeat request for the **same part name** on the same ticket while one is still open (`requested`/`approved`) is **idempotent** — it returns the existing request (200) instead of creating a second. A double tap on a phone with a bad signal is the normal case. Enforced by the partial unique `uq_spare_part_requests_open_name`, checked first in words. |
| D4 | **Decision (writer):** every writer that reads "which requests are open" and then sets the ticket's status serialises on **`SELECT … FROM tickets … FOR NO KEY UPDATE`** of that one ticket (`with_for_update(key_share=True)` in SQLAlchemy). The derived status depends on a SET of rows (like the cancel cap), so a single guarded UPDATE cannot settle it: a technician raising a request while Meena issues the last open one would otherwise leave the job `In Progress` with an open request. `NO KEY UPDATE`, not `UPDATE`, because the latter conflicts with the `KEY SHARE` lock every FK insert (`ticket_events`, `notifications`) takes on the ticket — the trap `core/credits.py` documents for `companies`. |
| D5 | The job's status after any change is a **pure function** of its current status and its requests' statuses (`job_status_after`, §4.1): only `In Progress ↔ Awaiting Part` ever move, open = `requested`/`approved`. Every move writes a `status_changed` event with exact `from_status`/`to_status` — Task 11's speed clock reads those two words (S3). |
| D6 | **Decision (writer):** the four facility actions are allowed **whatever the ticket's status** — including after `Awaiting Customer`, `Closed` and `Force-Closed`. They record physical facts (an old pump comes back on Friday; a part handed over the counter before a force-closure still left the store), and refusing to log a fact is how a log goes wrong. Only the status recompute is conditional: it runs only while the ticket is `Awaiting Part`. |
| D7 | **The technician cannot cancel in `Awaiting Part`** — `jobs.service.cancel` is already `Assigned`-only ("walking away from a started job is a different event"), and this task does not change that. Exits from a stuck `Awaiting Part`: the facility rejects (→ `In Progress`), or a manager **force-closes** (any non-terminal ticket — `tickets.service` already allows it). |
| D8 | **Reschedule IS allowed in `Awaiting Part`** — P3: "a revisit time uses the existing reschedule". Today both doors refuse it (`jobs.service._load_reschedulable` is `Assigned`-only; `tickets.service.RESCHEDULABLE_STATUSES` = `ASSIGNABLE_STATUSES`). Both gain `Awaiting Part`, and `core.reschedule.move_slot` keeps the status (`to = was`) instead of writing `Assigned` over it. Reassign does **not** gain it: `ASSIGNABLE_STATUSES` stays four — a started job with proof against one technician is not handed to another. |
| D9 | **Decision (writer):** the sweeps are **not** taught about revisits. `sweep_slot_reminders`, `sweep_customer_notice` and `sweep_no_shows` stay `status = 'Assigned'`. A revisit booked in `Awaiting Part` is announced by the reschedule's own WhatsApp (both windows) and the technician's own job screen; a reminder/no-show for revisits is a later change (§8). |
| D10 | **Owner ruling 2026-10-15 — home-franchisee parts have NO Admin/NH fallback (R4).** The company's Admin and National Head do **not** work the parts queue, for the home franchisee or any other; there is no `home_parts_handled_by_staff`, no `parts.catalogue` + role-check route into the queue and no `handles_home_parts` on `core.audience.Reader`. A franchisee's parts desk is its own **facility staff** — **an active `facility_admin` or `facility_operator`**. A franchisee with **none** (a franchisee admin alone does not count) cannot have a part raised against it: `POST /jobs/{id}/part-requests` answers **409 `NO_FACILITY`**, and the technician API exposes `partsEnabled` (§4.4) so the app hides the entry point before the technician finds out the hard way. The home franchisee is **not special**: it needs a facility user like any other, and because it has no franchisee admin by default, company **Admin / National Head may create facility users for the HOME franchisee** (§4.8b, feature `franchisees.manage` — no new key) — a home franchise needs someone to add its first facility admin. Facility admins and operators of the home franchisee are ordinary franchise principals in the `/franchise/*` portal. *(owner ruling 2026-10-15)* |
| D11 | **Decision (writer) — inheritance.** The list for a ticket is every non-deleted `spare_parts` row on a node in `tickets.node_path_ids` (root-first; equals `product_nodes.ancestor_ids ‖ node_id`, stamped at intake, and the tree is never re-parented) plus the rows on `tickets.model_id`. De-duplicated on `lower(trim(name))`; **the deepest row wins** (model > leaf > … > root); then **inactive rows are dropped** — so an inactive row at a deeper level *hides* the name inherited from above (the FL-7 gasket). Sorted by name. One pure function, `merge_catalogue`. |
| D12 | A part may sit on **any node** (root included — P1 says "category nodes", and a root-level *Power cord* is the point of inheritance) and on **any non-deleted model**, approved or not. |
| D13 | **Add to catalogue (P7).** Approving an **Other** request with `addToCatalogue: true` creates a `spare_parts` row on the ticket's **`node_id`** (the leaf the product hangs off) named `other_name`. If a non-deleted row with that `lower(name)` already exists on that node it is **linked, not duplicated**, and its `is_active` is left alone. The request then gets `spare_part_id` and **`other_name` is set to NULL** — the index's CHECK is *exactly one* of the two — while `part_name` keeps exactly what the technician typed. The `part_approved` note says "added to *Front Load*'s parts list". This is the one catalogue write a facility user can make, and it is P7's by design. |
| D14 | **Notifications.** `part_requested` → audience **`facility`**, `franchisee_id` = the request's. `part_decided` → written **only for a rejection** — including a rejection of an **approved** request (R2: a part that was promised and now will not come is exactly what territory staff must hear about) — (an approval is nobody's work item but the facility's, which made it), audience NULL, the ticket's pincode: territory staff own the ticket (F7) and a job that cannot get its part may need a force-close or a different plan. The title differs when the request was approved first (§4.10). `part_issued` → audience NULL, ticket pincode: a revisit may need booking. No bell on return. |
| D15 | **Pushes to the technician:** `part.approved`, `part.rejected`, **`part.rejected_after_approval`** (owner ruling 2026-10-15, R2 — the technician was told the part was coming, so the second message must say it is not), `part.issued` — all five languages in `app/core/push_text.py`. None on return (they handed it in). `publish_job_changed` on every action so an open job screen refetches. |
| D16 | **Decision (writer) — who sees requests on the ticket page.** `TicketDetailOut.partRequests` is filled for **staff** (whoever can load the ticket — territory unchanged) and **franchise principals** (Task 04's franchise scope, widened below for facility users). A **vendor gets `[]`**, the way `penalties` is withheld — the vendor is not a party to how the franchise stocks parts. The vendor still sees the status word `Awaiting Part` and the timeline (whose rules this task does not change), which is what explains the delay. |
| D17 | **F13 for facility users:** `tickets.service.scoped()`'s franchise branch (Task 04) gains, for `FACILITY_ROLES`, "tickets that have a `spare_part_requests` row of my franchisee". Assumption: Task 04 left facility roles failing closed (`sql_false()`) because this table did not exist yet; this task replaces that branch. A franchisee admin keeps Task 04's "all my franchisee's tickets". |
| D18 | **Decision (writer):** facility-user management (`franchise.facility_users`) lives in the **portal slice** `app/features/franchise_portal/` at `/franchise/facility-users` — it is a portal-only screen, and that slice's prefix is `/franchise` (index §3.7). The account creation reuses **Task 03's `app/core/franchise_logins.py`** (`create_login`, `reissue_password`, `set_active`, `mail_password`, `login_base`) — in core already, so no slice imports another (hard rule 4). |
| D19 | **Decision (writer):** facility staff write events with `actor_kind = 'staff'` and `actor_label` = their full name. `ACTOR_KINDS` is not widened: they are company-side people acting on a job, and a sixth kind would fork every reader for one label. |
| D20 | **Decision (writer):** the request code is a new `company_sequences` series **`spare_part_request` → `SPR`** (`RGT-SPR-0007`), allocated with `core.sequences.next_code` inside the request's transaction — a rolled-back request gives its number back, exactly as a ticket does. `company_sequences.name` has no CHECK, so this is one line in `KINDS`. |
| D21 | **Decision (writer):** `PartRequestOut` carries **no customer name, phone or address**. A facility needs the job code, the product, the place (city + pincode) and the technician; data minimisation costs nothing here. |
| D22 | **Decision (writer):** the facility queue's default filter is `requested,approved,issued` — everything still on the facility's desk, including an issued part whose old twin has not come back. |
| D23 | **Owner ruling 2026-10-15 — a facility may CANCEL AN APPROVED request (R2).** The state machine is P4 as amended: `requested → approved | rejected`, **`approved → issued | rejected`**, `issued → returned`. `reject` is the one action for both source states and always needs a **reason** (1–255) — the same endpoint, `POST /spare-parts/requests/{id}/reject`, the same body, so *"cancel an approved request"* is **a rejection of an approved one**, never a fifth status. `issued` is final-ish: a part already handed over is returned, not rejected. A request rejected from `approved` stores `rejected_from = 'approved'` (§3.1) so every reader can say *"approved, then cancelled"*; the `part_rejected` event's note carries the source status (`approved → rejected`). Once **no** request is `requested`/`approved` the job returns to `In Progress` (`job_status_after` is unchanged — open means requested or approved, and a rejected row is not open). An approved part that can never be supplied therefore no longer needs a force-close. *(owner ruling 2026-10-15)* |
| D24 | **X4.** Nothing is published until Task 07's build is on Play's production track. The migration itself may run on `RelianceProdDB` earlier: widening a CHECK writes nothing, and no code that writes `Awaiting Part` exists until the API is published. |

---

## 3. Schema — migration `d6c3a9f1e874_spare_parts.py`

`down_revision = "b4a8e2f6c903"` (Task 11). If Task 12 lands before 10/11, re-point it to the
current head and say so in the commit (index §3.6) — and then the "before" lists below lose the
values those tasks add; the guard in §3.4 is what catches that.

### 3.1 Models — `app/models/spare_part.py` (new, imported from `app/models/__init__.py`)

```python
"""Spare parts: what a technician may ask for, and every request's log.

`spare_parts` is a catalogue keyed on the PRODUCT MASTER — a category node or
one product model — and inherited down the tree (P1). `spare_part_requests` is
the facility's log of one request: who asked, who decided, who handed the new
part over, who took the old one back (P4, P5). No money and no stock counts.
"""

PART_REQUEST_STATUSES = ("requested", "approved", "rejected", "issued", "returned")
#: The two statuses that keep a job in `Awaiting Part` and refuse Complete.
OPEN_PART_REQUEST_STATUSES = ("requested", "approved")


class SparePart(Base, IdMixin, AuditMixin, SoftDeleteMixin):
    __tablename__ = "spare_parts"

    company_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("companies.id", ondelete="CASCADE"), nullable=False
    )
    #: Exactly one of these two (CHECK `one_owner`). A node's parts are inherited
    #: by every node and product beneath it; a model's are its own.
    node_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True)
    model_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    #: Off = not offered. Deeper and off HIDES the same name inherited from above.
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("true")
    )

    __table_args__ = (
        CheckConstraint("(node_id IS NULL) <> (model_id IS NULL)", name="one_owner"),
        CheckConstraint("length(btrim(name)) BETWEEN 1 AND 120", name="name"),
        # FK target for spare_part_requests. TOTAL — a partial index cannot be one.
        UniqueConstraint("company_id", "id", name="uq_spare_parts_company_id_id"),
        ForeignKeyConstraint(
            ["company_id", "node_id"],
            ["product_nodes.company_id", "product_nodes.id"],
            name="fk_spare_parts_company_node", ondelete="RESTRICT",
        ),
        ForeignKeyConstraint(
            ["company_id", "model_id"],
            ["product_models.company_id", "product_models.id"],
            name="fk_spare_parts_company_model", ondelete="RESTRICT",
        ),
        # Covering indexes for the two FKs. NOT the partial uniques below: a
        # RESTRICT check must also see soft-deleted rows, which a partial index
        # on `deleted_at IS NULL` cannot serve.
        Index("ix_spare_parts_company_node", "company_id", "node_id"),
        Index("ix_spare_parts_company_model", "company_id", "model_id"),
        # uq_spare_parts_node_name / uq_spare_parts_model_name are hand-written
        # lower(name) partial indexes in the migration — autogenerate will offer
        # to drop them on every future revision (hard rule 8): delete that drop.
    )


class SparePartRequest(Base, IdMixin, AuditMixin):
    """One technician's request for one part on one job. Never deleted — a log.

    No SoftDeleteMixin: this is the evidence that a part left the store and
    whether its broken twin came back. `*_by_user_id` carry no FK (users are
    global and may be removed; the ActorMixin reason) and `*_by_label` freeze
    the name as it was, like `ticket_events.actor_label`.
    """

    __tablename__ = "spare_part_requests"

    company_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("companies.id", ondelete="CASCADE"), nullable=False
    )
    #: `RGT-SPR-0007` — core.sequences series "spare_part_request".
    code: Mapped[str] = mapped_column(String(24), nullable=False)
    #: The TICKET's franchisee at raise time (D2). The facility wall.
    franchisee_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False)
    ticket_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False)
    technician_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False)
    #: Exactly one of these two (CHECK `one_part`). An Other request linked to
    #: the catalogue on approval (P7) swaps other_name for spare_part_id.
    spare_part_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True)
    other_name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    #: What was asked for, frozen: renaming the catalogue row never rewrites it.
    part_name: Mapped[str] = mapped_column(String(120), nullable=False)
    note: Mapped[str | None] = mapped_column(String(500), nullable=True)
    status: Mapped[str] = mapped_column(
        String(16), nullable=False, server_default=text("'requested'")
    )

    decided_at: Mapped[datetime.datetime | None] = mapped_column(DateTime(timezone=True))
    decided_by_user_id: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    decided_by_label: Mapped[str | None] = mapped_column(String(120))
    #: 255 because it is quoted into notifications.detail (255) and a push.
    reject_reason: Mapped[str | None] = mapped_column(String(255))
    #: Owner ruling 2026-10-15 (R2): which status a rejection came from —
    #: 'requested' (declined) or 'approved' (cancelled after approval). NULL
    #: unless status = 'rejected'. When rejected from 'approved', decided_* are
    #: OVERWRITTEN with the rejecting person and time (the approval stays in the
    #: part_approved event).
    rejected_from: Mapped[str | None] = mapped_column(String(16), nullable=True)
    issued_at: Mapped[datetime.datetime | None] = mapped_column(DateTime(timezone=True))
    issued_by_user_id: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    issued_by_label: Mapped[str | None] = mapped_column(String(120))
    issue_note: Mapped[str | None] = mapped_column(String(500))
    returned_at: Mapped[datetime.datetime | None] = mapped_column(DateTime(timezone=True))
    returned_by_user_id: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    returned_by_label: Mapped[str | None] = mapped_column(String(120))
    return_note: Mapped[str | None] = mapped_column(String(500))
    #: `attachment/<company_id>/<uuid>.jpg` in the PRIVATE container — a blob
    #: NAME, never a URL; signed per read (`integrations/blob.signed_url`).
    return_photo_blob_name: Mapped[str | None] = mapped_column(String(255))

    __table_args__ = (
        CheckConstraint(
            "status IN ('requested', 'approved', 'rejected', 'issued', 'returned')",
            name="status",
        ),
        CheckConstraint(
            "(spare_part_id IS NULL) <> (other_name IS NULL)", name="one_part"
        ),
        # The state machine, made structural: a row cannot claim a step it has
        # no record of. Each reads "this status ⇔ that column is set".
        CheckConstraint("(status = 'requested') = (decided_at IS NULL)",
                        name="decided_matches_status"),
        CheckConstraint("(decided_at IS NULL) = (decided_by_label IS NULL)",
                        name="decided_by_both"),
        CheckConstraint("(status = 'rejected') = (reject_reason IS NOT NULL)",
                        name="rejected_has_reason"),
        # owner ruling 2026-10-15 (R2): a rejection says where it came from.
        CheckConstraint("(status = 'rejected') = (rejected_from IS NOT NULL) "
                        "AND (rejected_from IS NULL OR rejected_from IN ('requested', 'approved'))",
                        name="rejected_from_matches_status"),
        CheckConstraint("(status IN ('issued', 'returned')) = (issued_at IS NOT NULL)",
                        name="issued_matches_status"),
        CheckConstraint("(status = 'returned') = (returned_at IS NOT NULL)",
                        name="returned_matches_status"),
        CheckConstraint("return_photo_blob_name IS NULL OR status = 'returned'",
                        name="photo_only_when_returned"),
        # TOTAL, like uq_tickets_company_code: a code read out on the phone is
        # never reused.
        UniqueConstraint("company_id", "code", name="uq_spare_part_requests_company_code"),
        ForeignKeyConstraint(
            ["company_id", "franchisee_id"],
            ["franchisees.company_id", "franchisees.id"],
            name="fk_spare_part_requests_company_franchisee", ondelete="RESTRICT",
        ),
        # CASCADE like ticket_events: the history of a deleted ticket has
        # nothing left to describe.
        ForeignKeyConstraint(
            ["company_id", "ticket_id"],
            ["tickets.company_id", "tickets.id"],
            name="fk_spare_part_requests_company_ticket", ondelete="CASCADE",
        ),
        ForeignKeyConstraint(
            ["company_id", "technician_id"],
            ["technician_profiles.company_id", "technician_profiles.id"],
            name="fk_spare_part_requests_company_technician", ondelete="RESTRICT",
        ),
        ForeignKeyConstraint(
            ["company_id", "spare_part_id"],
            ["spare_parts.company_id", "spare_parts.id"],
            name="fk_spare_part_requests_company_part", ondelete="RESTRICT",
        ),
        # The facility queue (franchisee + status, oldest first) AND the FK cover.
        Index("ix_spare_part_requests_queue",
              "company_id", "franchisee_id", "status", "created_at"),
        # One ticket's requests — the job screen, the ticket page, the recompute.
        Index("ix_spare_part_requests_company_ticket",
              "company_id", "ticket_id", "created_at"),
        Index("ix_spare_part_requests_company_technician", "company_id", "technician_id"),
        Index("ix_spare_part_requests_company_part", "company_id", "spare_part_id"),
        # uq_spare_part_requests_open_name — hand-written partial lower() index (D3).
    )
```

### 3.2 Vocabulary edits in models and core (same commit)

| File | Change |
|---|---|
| `app/models/ticket.py` | `ck_tickets_status` gains `'Awaiting Part'` (after `'In Progress'`). |
| `app/core/tickets.py` | `TICKET_STATUSES` gains `"Awaiting Part"` after `"In Progress"`, with a comment block like `Awaiting Customer`'s: *the technician started, found a part missing, and asked the facility; non-terminal; only `core.spare_parts` moves a job in or out of it.* `TERMINAL_STATUSES` unchanged. |
| `app/models/ticket_event.py` | `EVENT_KINDS` and the `kind` CHECK gain `part_requested`, `part_approved`, `part_rejected`, `part_issued`, `part_returned`, each with a `#:` comment. |
| `app/models/notification.py` | `NOTIFICATION_KINDS` gains `part_requested`, `part_decided`, `part_issued` (comments per D14); `AUDIENCES` gains `facility`: *"the franchise staff of `franchisee_id` — facility admins, facility operators and franchisee admins. Never company staff, the home franchisee included (owner ruling 2026-10-15, R4). No territory staff."* Both CHECKs are built from the tuples, so the model needs no other edit. |
| `app/core/sequences.py` | `KINDS["spare_part_request"] = "SPR"` with a `#:` line. |
| `app/scripts/audit_tenancy.py` | `TENANT_LINKS` += `("spare_parts","node_id","product_nodes")`, `("spare_parts","model_id","product_models")`, `("spare_part_requests","franchisee_id","franchisees")`, `("spare_part_requests","ticket_id","tickets")`, `("spare_part_requests","technician_id","technician_profiles")`, `("spare_part_requests","spare_part_id","spare_parts")`, each with a one-line reason. |
| `app/scripts/cleanup_db.py` | `COMPANY_TABLES` += `"spare_parts"`, `"spare_part_requests"` — step 1 refuses an unclassified table, so this cannot wait for Task 16. |

### 3.3 Migration body (near-code)

```python
"""Spare parts: a catalogue on the product tree, and a facility's request log

Adds what P1–P7 describe: `spare_parts` (on a category node or a product model,
inherited down the tree) and `spare_part_requests` (one technician's request and
every step a facility logs against it). A ticket gains the status
`Awaiting Part`; the trail gains five event kinds; the bell gains three kinds and
the `facility` audience.

Three things autogenerate cannot do: the three CHECK replacements (drop and
recreate, bare names — the convention adds `ck_<table>_`), and the three
hand-written lower() partial indexes, which it will offer to drop on every
future revision. Delete those drops.

## The downgrade refuses while any request exists or any ticket waits

A request is the only record that a part left a store; deleting one is the
`e8b2f47c19d3` mistake in a different currency. And a ticket in `Awaiting Part`
has no honest older status — `In Progress` would let Complete through with a
part outstanding. So it stops and says how many, the `f4b28d1a67c3` shape. The
catalogue is configuration and is dropped with its table (the count is printed).

Revision ID: d6c3a9f1e874
Revises: b4a8e2f6c903
"""

revision = "d6c3a9f1e874"
down_revision = "b4a8e2f6c903"

# ── the vocabularies as they stand BEFORE this revision ───────────────────────
# Spelled out, never imported from the models (a migration describes the
# database it was written against). Today's lists plus what Tasks 01/05/11 added —
# copy from `pg_get_constraintdef` at b4a8e2f6c903 before committing.
_STATUS_BEFORE = (
    "'New', 'Slot Pending', 'Assigned', 'In Progress', 'Awaiting Customer', "
    "'AI Review', 'Escalated', 'Closed', 'Force-Closed', 'Cancelled'"
)
_EVENTS_BEFORE = (
    "'created', 'slot_requested', 'slot_confirmed', 'confirmation_sent', "
    "'status_changed', 'assigned', 'started', 'feedback_requested', 'completed', "
    "'feedback_received', 'reopened', 'serial_mismatch', 'serial_corrected', "
    "'reminded', 'customer_notified', 'escalated', 'bonus_added', 'released', "
    "'no_show', 'force_closed', 'rescheduled', 'penalty_reversed', "
    "'franchisee_changed', "                                # Task 01 (3b7e1f0a9c41)
    "'speed_settled'"                                       # Task 11 (b4a8e2f6c903) (reconciled)
)
_NOTIFICATIONS_BEFORE = (
    "'escalation', 'ai', 'serial_mismatch', 'force_close', 'slot', "
    "'technician_joined', 'job_started', 'invite_expired', 'assigned', 'no_show', "
    "'product_submitted', 'product_approved', 'product_rejected', 'rescheduled', "
    "'redemption', 'brand_submitted', 'brand_approved', 'brand_rejected', "
    "'upi_change', 'credits', 'recharge', 'vendor_credit', 'vendor_payment', "
    "'vendor_credit_request', "
    "'technician_moved'"                         # Task 01 (3b7e1f0a9c41)
)
_AUDIENCES_BEFORE = (
    "'payers', 'area_manager', 'regional_head', 'national_head', 'admin', "
    "'billing', 'vendor', "
    "'franchisee_admin'"                                    # Task 05 (7c4f2e9a1d58)
)
_NEW_EVENTS = ("'part_requested', 'part_approved', 'part_rejected', "
               "'part_issued', 'part_returned'")
_NEW_NOTIFICATIONS = "'part_requested', 'part_decided', 'part_issued'"


def _assert_check_is(table: str, name: str, must_contain: str) -> None:
    """Refuse to replace a CHECK that is not the one this file was written against.

    Tasks 01–12 are parallel; if a sibling added a value this file's BEFORE list
    lacks, a blind drop-and-recreate would silently remove it. Compare the live
    definition to the spelled-out list and stop with both printed.
    """
    ...  # SELECT pg_get_constraintdef(oid) FROM pg_constraint
         #  WHERE conrelid = :table::regclass AND conname = 'ck_<table>_<name>'
         # raise RuntimeError unless every quoted value in the live def is in
         # `must_contain` and vice versa.


def upgrade() -> None:
    _assert_check_is("tickets", "status", _STATUS_BEFORE)
    _assert_check_is("ticket_events", "kind", _EVENTS_BEFORE)
    _assert_check_is("notifications", "kind", _NOTIFICATIONS_BEFORE)
    _assert_check_is("notifications", "audience", _AUDIENCES_BEFORE)

    op.create_table("spare_parts", ...)            # exactly §3.1, audit columns LAST
    op.execute("""
        CREATE UNIQUE INDEX uq_spare_parts_node_name
            ON spare_parts (company_id, node_id, lower(btrim(name)))
         WHERE node_id IS NOT NULL AND deleted_at IS NULL""")
    op.execute("""
        CREATE UNIQUE INDEX uq_spare_parts_model_name
            ON spare_parts (company_id, model_id, lower(btrim(name)))
         WHERE model_id IS NOT NULL AND deleted_at IS NULL""")

    op.create_table("spare_part_requests", ...)    # exactly §3.1, audit columns LAST
    op.execute("""
        CREATE UNIQUE INDEX uq_spare_part_requests_open_name
            ON spare_part_requests (company_id, ticket_id, lower(btrim(part_name)))
         WHERE status IN ('requested', 'approved')""")

    op.drop_constraint("status", "tickets", type_="check")
    op.create_check_constraint(
        "status", "tickets", f"status IN ({_STATUS_BEFORE}, 'Awaiting Part')")
    op.drop_constraint("kind", "ticket_events", type_="check")
    op.create_check_constraint(
        "kind", "ticket_events", f"kind IN ({_EVENTS_BEFORE}, {_NEW_EVENTS})")
    op.drop_constraint("kind", "notifications", type_="check")
    op.create_check_constraint(
        "kind", "notifications", f"kind IN ({_NOTIFICATIONS_BEFORE}, {_NEW_NOTIFICATIONS})")
    op.drop_constraint("audience", "notifications", type_="check")
    op.create_check_constraint(
        "audience", "notifications",
        f"audience IS NULL OR audience IN ({_AUDIENCES_BEFORE}, 'facility')")

    # Feature keys (parts.handle, parts.catalogue, franchise.facility_users) are
    # Task 02's (5d2a8c6e0b13), which every chain order puts before this file.
    # Not re-seeded here — one owner per row (index §6b).


def downgrade() -> None:
    bind = op.get_bind()
    waiting = bind.execute(sa.text(
        "SELECT count(*) FROM tickets WHERE status = 'Awaiting Part'")).scalar()
    requests = bind.execute(sa.text(
        "SELECT count(*) FROM spare_part_requests")).scalar()
    if waiting or requests:
        raise RuntimeError(
            f"{requests} spare part request(s) exist and {waiting} ticket(s) are "
            "Awaiting Part. Downgrading would delete the only record of parts "
            "that left a store, and put waiting jobs where Complete is allowed. "
            "Decide what happens to them first.")

    # Nothing can carry these if no request ever existed, but a half-failed
    # run must still be able to come back down.
    bind.execute(sa.text(f"DELETE FROM ticket_events WHERE kind IN ({_NEW_EVENTS})"))
    bind.execute(sa.text(f"DELETE FROM notifications WHERE kind IN ({_NEW_NOTIFICATIONS})"))
    bind.execute(sa.text("DELETE FROM company_sequences WHERE name = 'spare_part_request'"))

    op.drop_constraint("audience", "notifications", type_="check")
    op.create_check_constraint("audience", "notifications",
        f"audience IS NULL OR audience IN ({_AUDIENCES_BEFORE})")
    op.drop_constraint("kind", "notifications", type_="check")
    op.create_check_constraint("kind", "notifications", f"kind IN ({_NOTIFICATIONS_BEFORE})")
    op.drop_constraint("kind", "ticket_events", type_="check")
    op.create_check_constraint("kind", "ticket_events", f"kind IN ({_EVENTS_BEFORE})")
    op.drop_constraint("status", "tickets", type_="check")
    op.create_check_constraint("status", "tickets", f"status IN ({_STATUS_BEFORE})")

    op.drop_table("spare_part_requests")       # its indexes go with it
    parts = bind.execute(sa.text("SELECT count(*) FROM spare_parts")).scalar()
    print(f"d6c3a9f1e874 downgrade: dropping {parts} catalogue row(s)")
    op.drop_table("spare_parts")
    # Feature rows are Task 02's; NOT deleted here.
```

### 3.4 Notes on the schema

- **Every FK has a covering index** (hard rule 6): the four `ix_spare_part_requests_*`, the two
  `ix_spare_parts_company_*`. `uq_spare_part_requests_company_code` covers nothing but itself.
  `spare_parts` gets `uq_spare_parts_company_id_id` because it is a parent; `spare_part_requests`
  is nobody's parent and gets none.
- **Status is also in a partial index?** No. `grep` finds no SQL/partial index enumerating ticket
  statuses (`ix_tickets_pool` is keyed on `status = 'New'` only). The only enumerations are the
  CHECK, `TICKET_STATUSES`, and the code sets listed in §4.6.
- `ticket_events.kind` is `String(32)`, `notifications.kind` `String(24)`, `notifications.audience`
  `String(16)` — every new value fits (`part_requested` is 14; the index's `technician_moved`,
  widened by Task 01, is 16).

---

## 4. API and service

### 4.1 `app/core/spare_parts.py` — the shared half

In `core/` because three slices need it (jobs, spare_parts, tickets) and slices never import each
other (hard rule 4). The pure functions at the top are what §6 tests.

```python
#: Where a technician may raise a request (D1).
REQUESTABLE_STATUSES = ("In Progress", "Awaiting Part")

#: (current status, action) → next status. P4 as amended by owner ruling
#: 2026-10-15 (R2: an approved request may be rejected, with a reason), D23.
TRANSITIONS: dict[tuple[str, str], str] = {
    ("requested", "approve"): "approved",
    ("requested", "reject"): "rejected",
    ("approved", "issue"): "issued",
    ("approved", "reject"): "rejected",      # owner ruling 2026-10-15 (R2)
    ("issued", "return"): "returned",
}
ACTIONS = ("approve", "reject", "issue", "return")


def next_status(current: str, action: str) -> str | None:
    """The status `action` moves a request to, or None when it may not."""


def allowed_actions(current: str) -> list[str]:
    """For the console's buttons — `[a for a in ACTIONS if next_status(current, a)]`."""


def job_status_after(current: str, request_statuses: Iterable[str]) -> str:
    """The ticket status once its requests are as given (D5).

    Only `In Progress` and `Awaiting Part` move; every other status is returned
    unchanged (a request settled after Complete or a force-closure moves nothing).
    Any open request → `Awaiting Part`; none → `In Progress`. A request rejected
    after approval (owner ruling 2026-10-15, R2) is `rejected` here like any other:
    no longer open, so the last one leaving returns the job to `In Progress`.
    """


def normalize_part_name(value: str) -> str:
    """Trim and collapse inner whitespace; the stored display form."""


def part_name_key(value: str) -> str:
    """`normalize_part_name(value).lower()` — mirrors SQL `lower(btrim(name))`."""


@dataclass(frozen=True)
class CatalogueRow:
    id: uuid.UUID
    name: str
    is_active: bool
    #: 0 = root … len(path)-1 = the ticket's node; len(path) = the model.
    level: int
    owner_kind: str          # 'node' | 'model'
    owner_id: uuid.UUID
    owner_name: str


def merge_catalogue(rows: Iterable[CatalogueRow]) -> list[CatalogueRow]:
    """D11: deepest row per `part_name_key` wins; then drop inactive; sort by
    (name key, level). An inactive deeper row therefore hides an inherited name."""


# No interval extractor here: the `Awaiting Part` spans are read by Task 11's
# `core.speed.clock_from_events` off `from_status` / `to_status` (its W6). This
# module's contract with it is only that every move in or out of `Awaiting Part`
# is a `status_changed` event with both columns exact (D5, `settle_job_status`).


def can_create_facility_role(actor_role: str, target_role: str) -> bool:
    """Franchisee admin → facility_admin | facility_operator; facility admin →
    facility_operator; **company admin / national head → facility_admin |
    facility_operator (for the HOME franchisee only — the route enforces the
    franchisee, this function the roles; owner ruling 2026-10-15, R4)**; nobody
    else. `ROLE_RANKS[target] > ROLE_RANKS[actor]` and target in FACILITY_ROLES."""
```

DB helpers in the same module (none commits — the caller owns the transaction):

| Function | What |
|---|---|
| `lock_ticket(db, company_id, ticket_id) -> Ticket \| None` | `select(Ticket).where(id, company_id, deleted_at IS NULL).with_for_update(key_share=True)` — renders `FOR NO KEY UPDATE` (D4). Every writer below calls it first. |
| `catalogue_for(db, *, company_id, node_path_ids, model_id) -> list[CatalogueRow]` | One query: `spare_parts` where `company_id` and `deleted_at IS NULL` and (`node_id = ANY(:path)` OR `model_id = :model`), joined to `product_nodes.name` / `product_models.name` for `owner_name`; `level` from the path index (model = `len(path)`); then `merge_catalogue`. `node_path_ids` is an array PARAMETER here, so `= ANY(:path)` is right (the `IN (SELECT unnest(...))` trap in api/AGENTS.md applies only when the path is a subquery). |
| `requests_for_ticket(db, *, company_id, ticket_id) -> list[SparePartRequest]` | Oldest first. Used by the ticket page, the job screen and the recompute. |
| `has_open_requests(db, *, company_id, ticket_id) -> bool` | `EXISTS … status IN OPEN_PART_REQUEST_STATUSES`. |
| `settle_job_status(db, ticket, *, actor_kind, actor_label, by_user) -> str \| None` | Reads the ticket's request statuses, computes `job_status_after`; when it differs, a **guarded UPDATE** `WHERE id, company_id, technician_id = :held, status = :was` (belt and braces under the lock) and a `status_changed` `TicketEvent` with exact `from_status`/`to_status`, note `"Waiting for a spare part"` or `"Spare parts settled"`. Calls `publish_ticket_changed` and `publish_job_changed`. Returns the new status, or None when nothing moved. |
| `franchisee_has_facility(db, company_id, franchisee_id) -> bool` | **Owner ruling 2026-10-15 (R4).** True when the franchisee has at least one **active, non-deleted** membership (active user too) whose role is `facility_admin` or `facility_operator`. A franchisee admin does **not** count. Used by `POST /jobs/{id}/part-requests` (409 `NO_FACILITY`) and by `GET /jobs/{id}/parts` (`partsEnabled`). The franchisee asked about is **the ticket's** (D2). Replaces the deleted `home_parts_handled_by_staff` / `parts_franchisee_for`. |
| `notify_facility(db, req, ticket, *, technician_name)` | `notify(kind="part_requested", audience="facility", franchisee_id=req.franchisee_id, ticket_id=ticket.id, pincode=ticket.pincode, title=…, detail=…, to=…)` then `publish_notification(..., audience="facility", franchisee_id=…, notification_id=row.id)` (Task 05 added `franchisee_id` to both). `to` = `/franchise/parts/requests/{id}` always (owner ruling 2026-10-15, R4: nobody in the staff shell handles parts any more). |

### 4.2 Readers that must learn the `facility` audience

The four readers named in `models/notification.py` and `api/AGENTS.md` — each one, or a push
reaches somebody whose feed is empty:

| Reader | Rule for `audience = 'facility'` |
|---|---|
| `notifications.service._visible` | A franchise principal (any of `FRANCHISE_ROLES`) sees it when `Notification.franchisee_id == principal.franchisee_id`. **Nobody else** — no Admin/NH clause for the home franchisee (owner ruling 2026-10-15, R4); like `'vendor'`, no staff role is spelled `facility`, so it falls out of every territory branch. |
| `core.coverage.users_notified_by` | The one clause, read backwards (memberships with `franchisee_id` and a franchise role). Update its "If a sixth audience rule is ever added" note. |
| `core.audience.hears` (Task 05's pure rule; `tickets.ws._Visibility.hears_notification` delegates to it) | Same. **`Reader` gains no new field** (owner ruling 2026-10-15, R4 removed `handles_home_parts`): `facility` → a franchise reader whose `franchisee_id` equals the row's, nobody else. Tested before the guard that refuses addressed rows to non-staff (the `'vendor'` precedent); Task 05's test 9 flips for `facility`. |
| `realtime.publish_notification` | Passes `audience` and `franchisee_id` through (Task 05's signature). |

### 4.3 Catalogue API — `app/features/spare_parts/` (staff, `parts.catalogue`)

Every route: `require_feature("parts.catalogue")` + `require_staff_principal` (a vendor holds
`masters.view`; a franchise role must not reach the catalogue editor). Node and model are resolved
through a company-scoped loader → **404** for another company's id. A model is not vendor-pinned
here: the caller is staff.

| Method & path | Body | Answer |
|---|---|---|
| `GET /spare-parts/catalogue/nodes/{nodeId}` | — | `CatalogueOut` for a node: its **own** rows (active and inactive) and the **inherited** list it passes on (its ancestors via `product_nodes.ancestor_ids`, merged, active only). |
| `GET /spare-parts/catalogue/models/{modelId}` | — | `CatalogueOut` for a model: its own rows, and `inherited` = the model's node path (`node.ancestor_ids ‖ node.id`) merged — i.e. exactly what a technician would see minus the model's own. |
| `POST /spare-parts/catalogue/nodes/{nodeId}/parts` | `{ "name": "Drain pump" }` | 201 `SparePartOut`. 409 (no code — the generic conflict) when a non-deleted row with that `lower(btrim(name))` exists on the node. |
| `POST /spare-parts/catalogue/models/{modelId}/parts` | `{ "name": "Control board FL-7" }` | Same, on the model. |
| `PATCH /spare-parts/catalogue/parts/{partId}` | `{ "name"?: str, "isActive"?: bool }` | 200 `SparePartOut`. A rename is checked against the same uniqueness. |
| `DELETE /spare-parts/catalogue/parts/{partId}` | — | Soft delete (`deleted_at`). Requests keep pointing at it (RESTRICT is not tripped by a soft delete) and keep their frozen `part_name`. |

```jsonc
// GET /spare-parts/catalogue/models/{id}  → 200
{ "success": true, "statusCode": 200, "message": "Request processed successfully",
  "timestamp": "2026-10-20T06:10:00Z", "errors": [],
  "data": {
    "owner": { "kind": "model", "id": "…", "name": "Acme FL-7 (7 kg)",
               "path": ["Home Appliances", "Washing Machine", "Front Load"] },
    "own": [
      { "id": "…", "name": "Control board FL-7", "isActive": true,
        "ownerKind": "model", "ownerId": "…", "ownerName": "Acme FL-7 (7 kg)" },
      { "id": "…", "name": "Door gasket", "isActive": false, "ownerKind": "model", … }
    ],
    "inherited": [
      { "id": "…", "name": "Door gasket", "isActive": true, "ownerKind": "node",
        "ownerName": "Washing Machine" },          // shown so the console can say "hidden here"
      { "id": "…", "name": "Door lock", "ownerName": "Front Load", … },
      { "id": "…", "name": "Drain pump", "ownerName": "Washing Machine", … }
    ] } }
```

### 4.4 Technician API — `app/features/jobs/` (mobile Task 15)

Both routes carry the jobs slice's two guards: `require_feature("pool.view")` +
`TechnicianPrincipal`. The ticket is loaded through `mine_query` (`technician_id = me`), so a
guessed id is **404** — a 403 would confirm it exists. Thin service functions in
`jobs/service.py` delegate to `core.spare_parts`.

**`GET /jobs/{id}/parts`** — any status (the history stays readable after closure).

```jsonc
{ "success": true, "statusCode": 200, "message": "Request processed successfully", …,
  "data": {
    "ticketId": "…", "code": "RGT-INST-0412", "status": "Awaiting Part",
    "partsEnabled": true,                     // owner ruling 2026-10-15 (R4): the ticket's franchisee has an active
                                              // facility_admin or facility_operator. false → the app hides/disables
                                              // "Need a spare part" and says why. Independent of status.
    "canRequest": true,                       // partsEnabled AND status in REQUESTABLE_STATUSES
    "catalogue": [ { "id": "…", "name": "Control board FL-7" },
                   { "id": "…", "name": "Door lock" },
                   { "id": "…", "name": "Drain pump" }, … ],   // [] when canRequest is false
    "requests": [ {
      "id": "…", "code": "RGT-SPR-0007", "partName": "Drain pump", "isOther": false,
      "note": "pump motor seized, impeller fine", "status": "approved",
      "createdAt": "…", "decidedAt": "…", "rejectReason": null,
      "rejectedAfterApproval": false,         // owner ruling 2026-10-15 (R2): status 'rejected' and rejected_from = 'approved'
      "issuedAt": null, "issueNote": null, "returnedAt": null } ] } }
```

`partsEnabled` is computed by `franchisee_has_facility` for the **ticket's** franchisee (D2) — one cheap
EXISTS. It is `false` for **every** job of such a franchisee, history included (the app still lists the
past requests). `GET /jobs/{id}` (`JobOut`) carries the same `partsEnabled` so the job screen can decide
on first paint without a second call (Task 15). It is the technician's own franchisee's fact — no
other franchisee's data leaks — and it names no person. *(owner ruling 2026-10-15)*

No staff names and no vendor price on this shape (index: the technician's shapes never carry one).

**`POST /jobs/{id}/part-requests`** — body `PartRequestCreate`:

```jsonc
{ "sparePartId": "…" | null, "otherName": "Inlet hose clamp" | null, "note": "…" | null }
```

Pydantic: exactly one of `sparePartId` / `otherName` (422 otherwise); `otherName` 1–120 after
`normalize_part_name`; `note` ≤ 500. Service, in order, one transaction:

1. `row = mine_query(...).where(id)` → 404. `lock_ticket(...)` (re-read under the lock).
2. `row.status not in REQUESTABLE_STATUSES` → **409 `PART_REQUEST_NOT_IN_PROGRESS`**:
   *"You can ask for a spare part only while the job is in progress."*
   **2b (owner ruling 2026-10-15, R4).** `not franchisee_has_facility(row.franchisee_id)` → **409
   `NO_FACILITY`**: *"This franchise has no spare-parts desk yet, so a part can't be requested from
   here. Ask your franchise to set one up."* **PROPOSED**. Checked **after** the status guard and
   **before** the idempotent-repeat lookup, so nothing is ever written for a franchisee nobody can
   answer. There is no Admin/NH fallback.
3. `sparePartId` → must be in `catalogue_for(row.node_path_ids, row.model_id)` (active, merged);
   otherwise **404** *"Part not found"* — a part from another category or company reads exactly
   like an invented one. `part_name` = the catalogue row's name.
   `otherName` → `part_name` = `other_name` = the normalised text.
4. Open request with the same `part_name_key` on this ticket → return it, **200**, message
   `"Already requested"` (D3). An `IntegrityError` on `uq_spare_part_requests_open_name` (a race
   the lock did not cover — e.g. two app instances) is caught, rolled back and answered the same way.
5. Insert `SparePartRequest(code=next_code(db, company_id, "spare_part_request"),
   franchisee_id=row.franchisee_id, technician_id=profile.id, status="requested", …)`, flush.
6. `TicketEvent(kind="part_requested", actor_kind="technician", actor_label=<name>,
   note="RGT-SPR-0007 · Drain pump · pump motor seized, impeller fine")` — *"Other: …"* prefix
   for an Other request.
7. `settle_job_status(...)` → on the first request writes `status_changed`
   `In Progress → Awaiting Part`; on a later one writes nothing.
8. `notify_facility(...)`; commit. **201**, message `"Part requested"`, data = the same
   `JobPartsOut` as the GET.

**`jobs.service.complete`** gains, before its guarded UPDATE: `lock_ticket`, then
`has_open_requests` → **409 `PARTS_PENDING`**: *"This job is waiting for a spare part. You can
complete it once the part has been issued or the request is closed."* And when the guarded UPDATE
finds 0 rows with `row.status == "Awaiting Part"`, the same 409 rather than "already awaiting
part" — the invariant (open request ⇔ `Awaiting Part`) makes the two checks agree.

**Cancel** is unchanged (`Assigned` only → `JOB_NOT_CANCELLABLE` in `Awaiting Part`, D7).

**Reschedule** (D8):
- `jobs.service._load_reschedulable`: `row.status not in ("Assigned", "Awaiting Part")` →
  `JOB_NOT_RESCHEDULABLE`. Update its docstring: a waiting job is the one started job whose visit
  must move, because the technician has to come back.
- `tickets.service.RESCHEDULABLE_STATUSES = ASSIGNABLE_STATUSES + ("Awaiting Part",)` — and
  rewrite the comment above it: "can be sent" and "can be given a time" were the same question
  until a started job needed a second visit; reassign stays four.
- `core.reschedule.move_slot`: `to = was if was == "Awaiting Part" else ("Assigned" if held else "New")`;
  the event's `to_status` is then NULL (nothing moved), as the existing comment already handles.
  Docstring "The status it lands in" gains that line.
- `core.slots.CHOOSABLE_STATUSES` is **not** changed: the customer's link never reopens a started job.

### 4.5 Facility API — `app/features/spare_parts/` (requests)

**Guard** `require_parts_handler` (in the slice's router) — **owner ruling 2026-10-15 (R4): franchise staff only.**
`CompanyPrincipal`, then a franchise principal (`principal.is_franchise`, `franchisee_id` set — i.e.
`require_facility_principal`) holding **`parts.handle`** → handles **its own** franchisee. **Anything
else — every staff role, Admin and National Head included — is 403** (*"Spare parts are handled by the
franchise's facility staff."*). There is no home-franchisee exception and no `parts.catalogue` route in.

It yields `(principal, franchisee_id)`. **Every query below filters
`company_id = principal.company_id AND franchisee_id = principal.franchisee_id`** — another franchisee's
(or company's) request is **404**, the second wall of index §5.1. The guard is therefore just
`require_facility_principal` + `require_feature("parts.handle")` (P6: the franchisee admin may do
everything a facility admin can); it stays a named dependency so the 403 sentence is one place.

| Method & path | Body | Answer |
|---|---|---|
| `GET /spare-parts/requests` | query `status` (comma-set, default `requested,approved,issued`; an unknown member empties the page, the `/tickets` rule), `search` (request code, ticket code, part name, technician name; ILIKE), `page`, `limit` | `PaginatedEnvelope[PartRequestOut]`, ordered `requested, approved, issued, returned, rejected`, then `created_at` ASC (oldest waiting first). |
| `GET /spare-parts/requests/counts` | — | `{ "requested": 3, "approved": 1, "issued": 4 }` for the rail badge (Task 13). |
| `GET /spare-parts/requests/{id}` | — | `PartRequestOut`, `returnPhotoUrl` signed. |
| `POST /spare-parts/requests/{id}/approve` | `{ "addToCatalogue": false }` | 200 `PartRequestOut`. |
| `POST /spare-parts/requests/{id}/reject` | `{ "reason": "No FL-7 pumps until 28 Oct" }` (1–255, required) | 200. **Valid from `requested` AND from `approved`** (owner ruling 2026-10-15, R2) — one endpoint, the reason is required both times. Answers `rejectedAfterApproval` on the out shape. |
| `POST /spare-parts/requests/{id}/issue` | `{ "note": "FL-7 pump, box 3" }` (optional, ≤500) | 200. |
| `POST /spare-parts/requests/{id}/return` | `{ "note": "seized, as reported", "photoBlobName": "attachment/<company>/<uuid>.jpg" }` (both optional) | 200. |

Each action, one transaction:

1. Load the request by `(id, company_id, franchisee_id)` → 404. `lock_ticket(request.ticket_id)`.
2. `to = next_status(request.status, action)`; None → **409 `PART_REQUEST_BAD_STATE`**:
   *"This request is already {status} — refresh to see where it is."*
3. **Guarded UPDATE** `spare_part_requests SET status=:to, <step columns> WHERE id, company_id,
   franchisee_id, status = :current` — `rowcount == 0` → the same 409 (two facility users raced;
   one wins). Step columns: `decided_at/decided_by_user_id/decided_by_label` (+ `reject_reason` and
   **`rejected_from = <the status it was>`** — owner ruling 2026-10-15; a rejection of an `approved` request
   overwrites `decided_*` with the rejecting person); 
   `issued_*` + `issue_note`; `returned_*` + `return_note` + `return_photo_blob_name`.
4. `return`: `photoBlobName` must start with `attachment/{company_id}/` and contain no `..` (the
   `redemptions`/`credits` check) → 400 *"Upload the photo through this API first"*. The client
   uploads with `POST /uploads?kind=attachment` (private container; the response's `url` field
   holds the blob NAME for private kinds).
5. `approve` with `addToCatalogue: true` on an Other request (D13): find-or-create
   `spare_parts(node_id = ticket.node_id, name = other_name)`, then in the same UPDATE set
   `spare_part_id`, `other_name = NULL`. On a catalogue request the flag is ignored.
6. `TicketEvent(kind="part_<approved|rejected|issued|returned>", actor_kind="staff",
   actor_label=<full name>, by_user=<user id>, note="RGT-SPR-0007 · Drain pump · …")`. A
   **`part_rejected`** event **carries where the rejection came from** (owner ruling 2026-10-15, R2):
   the note reads `RGT-SPR-0007 · Drain pump · requested → rejected · <reason>` or
   `… · approved → rejected · <reason>`. (The event's `from_status`/`to_status` columns stay NULL —
   they are the *ticket's* statuses, and only `status_changed` events carry them; Task 11's clock
   reads those alone.)
7. `reject` / `issue` only: `settle_job_status(...)` (actor = the same person). `approve` and
   `return` cannot change it (approved is still open; returned is after issued). A `reject` of the
   **last open** request — approved or not — moves the job `Awaiting Part → In Progress`, the same
   `status_changed` event as any other settle.
8. Bell (D14) and push (D15). **Every** action (all four, `return` included) calls
   `publish_job_changed` before commit, so an open job screen refetches. `approve`, `reject` and
   `issue` then push, after commit (the `penalty.reversed` order; a rejection of an **approved** request
   pushes `part.rejected_after_approval`, a rejection of a requested one `part.rejected`):
   `send_to_technicians(db, company_id=…, technician_ids=[req.technician_id],
   message=PushText("part.<approved|rejected|rejected_after_approval|issued>", code=ticket.code, part=req.part_name[, reason=…]),
   data={"type": "job", "ticketId": str(ticket.id), "code": ticket.code})` — `type: 'job'` with
   `ticketId` is what installed apps open (Task 07 §4.3.6, Task 15 §4.4). No push on `return`.
   The technician's own `POST /jobs/{id}/part-requests` also calls `publish_job_changed` (whether or not
   the status moved), so a second device refreshes.

```jsonc
// POST /spare-parts/requests/{id}/approve  {"addToCatalogue": true}  → 200
{ "success": true, "statusCode": 200, "message": "Part approved", "timestamp": "…", "errors": [],
  "data": {
    "id": "…", "code": "RGT-SPR-0009", "status": "approved",
    "allowedActions": ["issue"],
    "ticketId": "…", "ticketCode": "RGT-INST-0412", "ticketStatus": "Awaiting Part",
    "productLabel": "Acme FL-7 (7 kg)", "city": "Hyderabad", "pincode": "500032",
    "franchiseeId": "…", "franchiseeName": "SkyFix Services",
    "technicianId": "…", "technicianName": "Ravi Kumar", "technicianPhone": "+919…",
    "sparePartId": "…", "partName": "Inlet hose clamp", "isOther": false,
    "catalogueTarget": null,      // {nodeId, nodeName} only while an Other request is 'requested'
    "note": "clamp cracked", "createdAt": "…",
    "decidedAt": "…", "decidedBy": "Meena R", "rejectReason": null,
    "rejectedAfterApproval": false,   // owner ruling 2026-10-15 (R2)
    "issuedAt": null, "issuedBy": null, "issueNote": null,
    "returnedAt": null, "returnedBy": null, "returnNote": null, "returnPhotoUrl": null } }

// a second approve on the same request → 409
{ "success": false, "statusCode": 409, "code": "PART_REQUEST_BAD_STATE",
  "message": "This request is already approved — refresh to see where it is.",
  "data": null, "errors": ["This request is already approved — refresh to see where it is."], … }
```

### 4.6 Every place a status set must learn `Awaiting Part`

Found by grepping every `'In Progress'` / `"Assigned"` literal and every status tuple in `app/`:

| Place | Change |
|---|---|
| `models/ticket.py` CHECK, `core/tickets.py` `TICKET_STATUSES` | Add (§3.2). `tickets.service._canonical_set` reads the tuple, so `GET /tickets?status=Awaiting Part` works with no other edit. |
| `tickets/service.dashboard_summary` — `tally(Ticket.status.in_(("Assigned", "In Progress"))).label("active")` | Add `"Awaiting Part"`: a waiting job is held by somebody. Update `FunnelOut.active`'s comment and the `tickets/router.py` docstring that names `Assigned,In Progress`. ⚠ The console's tile link must send the same set (Task 13), or the tile and its list disagree. |
| `jobs/router.py` `SEGMENTS["inprogress"]` | Add `"Awaiting Part"` — the technician's My-jobs "In progress" tab. |
| `jobs/service._load_reschedulable`, `tickets/service.RESCHEDULABLE_STATUSES`, `core/reschedule.move_slot` | §4.4 / D8. |
| `jobs/service.complete` | `PARTS_PENDING` (§4.4). |
| `scripts/seed_play_review.py` lines ~487 and ~620 (`("Assigned", "In Progress")`) | Add `"Awaiting Part"` (stale-job force-close, held count). |
| `TERMINAL_STATUSES` users — `open_tickets()`, `core/vendor_credits` reserved sum, `technicians` "has open jobs", `list_today`, `seed/verify` | **No change**: `Awaiting Part` is non-terminal, and each of them already reads `not_in(TERMINAL_STATUSES)`. A waiting job stays reserved against the vendor's line, blocks deleting its technician, and shows on Home on its slot day. |
| Daily cap (`core/coverage.has_cap_room` and friends) | **No change**: counts by slot date, only `Cancelled` frees a slot. A revisit moved to Thursday counts on Thursday. |
| `ASSIGNABLE_STATUSES`, `CHOOSABLE_STATUSES`, `sweep_*` (`Assigned`, `New`/`Slot Pending`, `Awaiting Customer`) | **No change** (D8, D9). |
| `tickets/service.force_close_ticket` | **No change**: any non-terminal ticket — the exit from a stuck wait (D7). |
| `feedback_service.refresh_technician_stats` (`on_time_pct`) | **No change**: measured off `started`, which precedes any wait. |

### 4.7 Ticket page and franchise visibility (tickets slice)

- `TicketDetailOut.partRequests: list[PartRequestOut] = []` — filled from
  `core.spare_parts.requests_for_ticket` for staff and franchise principals; `[]` for a vendor
  (D16), mirroring `penalties`.
- `tickets.service._EVENT_TITLES` gains (**PROPOSED** console copy, signed off with Task 13):
  `part_requested` *"Spare part requested"*, `part_approved` *"Spare part approved"*,
  `part_rejected` *"Spare part not approved"* (when the note says `approved → rejected`, the console renders *"Approved spare part cancelled"* — owner ruling 2026-10-15), `part_issued` *"New part issued to technician"*,
  `part_returned` *"Old part received back"*. Without them the timeline renders the raw key — the
  fault that file's comment already describes once.
- `tickets.service.scoped()` franchise branch (Task 04): for `principal.role in FACILITY_ROLES`,
  `EXISTS (SELECT 1 FROM spare_part_requests r WHERE r.company_id = tickets.company_id AND
  r.ticket_id = tickets.id AND r.franchisee_id = :principal_franchisee)` (D17). Read-only (F13):
  every write route already refuses franchise roles on its feature key or rank floor.

### 4.8 Facility users — `app/features/franchise_portal/` (`franchise.facility_users`)

Guards: `require_feature("franchise.facility_users")` + **`require_facility_principal`** (any franchise
role — a facility admin manages operators, so the franchisee-admin-only `require_franchise_principal` would
lock them out; the feature key keeps operators out) (reconciled). Scoped
`Membership.company_id = principal.company_id AND Membership.franchisee_id = principal.franchisee_id
AND User.role IN FACILITY_ROLES` → anything else is **404**. Path parameter is a **membership** id,
as `/users` and `/vendor/users` do.

| Method & path | Body | Rule |
|---|---|---|
| `GET /franchise/facility-users` | `page`, `limit`, `search` | Facility admins and operators of my franchisee. |
| `POST /franchise/facility-users` | `{ "fullName", "email", "phone", "role": "facility_admin" \| "facility_operator" }` | `can_create_facility_role(principal.role, role)` else **403** *"You can only add roles below your own"* (`ensure_below_rank`'s sentence). Phone required, E.164 (console-user rule). Created through the Task 03 helper (D18): generated temporary password, emailed; **201 even when the email fails**, `data.emailStatus` = `sent` \| `skipped` \| `failed`, `data.temporaryPassword` only when not sent — the `vendor_users` contract. A person already a member of this company → 409. |
| `PATCH /franchise/facility-users/{membershipId}` | `{ "isActive": false }` | Same rank rule on the TARGET's role; never yourself (403). Deactivating revokes their refresh tokens (`core.sessions.revoke_refresh_tokens`). Reactivating is the same call with `true`. |
| `POST /franchise/facility-users/{membershipId}/reissue-password` | — | Same rank rule on the TARGET's role; never yourself (403). `franchise_logins.reissue_password` (revokes their sessions), commit, then `mail_password` — 200 `FacilityUserCreatedOut`, message by `emailStatus` like Task 03's route 13; `temporaryPassword` only when the email did not go. The only way back in for a facility user who never got the first email (reconciled — Task 13 offers it). |

Shapes (in `franchise_portal/schemas.py`; the `VendorUserOut` pattern, `EmailOutcome` from `core.schemas`):

```python
class FacilityUserOut(AppModel):
    membershipId: uuid.UUID          # what the routes take
    userId: uuid.UUID
    fullName: str | None
    email: str | None
    phone: str | None
    role: Literal["facility_admin", "facility_operator"]
    isActive: bool                   # membership.is_active AND user.is_active
    createdAt: datetime

class FacilityUserCreatedOut(FacilityUserOut, EmailOutcome): ...   # POST and reissue-password
```

The franchisee admin's own login is Task 03's (company Admin/NH create franchisee admins); this task
never creates a `franchisee_admin`.

### 4.8b Facility users for the HOME franchisee — created by company Admin / National Head (owner ruling 2026-10-15, R4)

With no Admin/NH fallback (D10), a home franchise has no parts desk until somebody gives it one, and it
has no franchisee admin by default to do so. So the **company's Admin and National Head** can create,
deactivate and re-issue facility users for the **home franchisee — and only the home franchisee**. A
franchisee admin keeps creating them for his own (non-home or home) franchisee through §4.8; a facility
admin creates operators there.

Slice `app/features/spare_parts/` (a second router, prefix `/spare-parts/home-facility-users`; the logic
is this task's, so the twin lives beside it — index §3.7). Guards: `require_feature("franchisees.manage")`
(Admin, National Head by default — **no new feature key**, so Task 02's seeding is unchanged) +
`require_staff_principal`. **There is no franchisee id in the path or body:** the franchisee is resolved
server-side as `franchise.home_franchisee_id(db, principal.company_id)`; `membershipId`s are scoped to it,
so a facility user of a non-home franchisee is **404** here (they are managed by their own franchisee's
admins, F7). Same four routes and the **same shapes** as §4.8 (`FacilityUserOut`,
`FacilityUserCreatedOut`), same Task 03 helper (D18), same rules (phone required, E.164; 201 even if the
email fails; reactivate with `isActive: true`; deactivating revokes refresh tokens; never yourself).
`can_create_facility_role("admin" | "national_head", "facility_admin" | "facility_operator")` is true;
a `franchisee_admin` target is not a facility role and is refused (422 on the schema's `Literal`).

| Method & path | Body | Rule |
|---|---|---|
| `GET /spare-parts/home-facility-users` | `page`, `limit`, `search` | Facility admins and operators of the home franchisee. |
| `POST /spare-parts/home-facility-users` | as §4.8 | Creates in the home franchisee. |
| `PATCH /spare-parts/home-facility-users/{membershipId}` | `{ "isActive": bool }` | |
| `POST /spare-parts/home-facility-users/{membershipId}/reissue-password` | — | |

Deactivating the home franchisee's **last** facility user is allowed (it is not R3's rule, which is about
franchisee admins): the home franchisee then has no parts desk, `partsEnabled` turns false for its
technicians, and new requests answer `NO_FACILITY`. Requests already open stay with whoever reactivates a
facility user (§8).

### 4.9 Push text — `app/core/push_text.py`

Four keys (owner ruling 2026-10-15 adds `part.rejected_after_approval`), all five languages, following the app glossary (*Job* = काम/పని/ಕೆಲಸ/வேலை). Part
names and the reason are shown as given. **PROPOSED**, queued for native review with Task 15;
Task 15 adds *Spare part* to `mobileapp/src/i18n/README.md`'s glossary as
स्पेयर पार्ट / స్పేర్ పార్ట్ / ಸ್ಪೇರ್ ಪಾರ್ಟ್ / ஸ்பேர் பார்ட், and these must match it.

```python
"part.approved": {
    "en": ("{code}: part approved", "{part} is approved. You'll be told when it's ready to collect."),
    "hi": ("{code}: पार्ट मंज़ूर", "{part} मंज़ूर हो गया है। पार्ट तैयार होने पर आपको बताया जाएगा।"),
    "te": ("{code}: పార్ట్ ఆమోదించారు", "{part} ఆమోదించారు. పార్ట్ సిద్ధమైనప్పుడు మీకు తెలియజేస్తారు."),
    "kn": ("{code}: ಪಾರ್ಟ್ ಅನುಮೋದನೆ", "{part} ಅನುಮೋದಿಸಲಾಗಿದೆ. ಪಾರ್ಟ್ ಸಿದ್ಧವಾದಾಗ ನಿಮಗೆ ತಿಳಿಸಲಾಗುತ್ತದೆ."),
    "ta": ("{code}: பார்ட் அனுமதிக்கப்பட்டது", "{part} அனுமதிக்கப்பட்டது. பார்ட் தயாரானதும் உங்களுக்குத் தெரிவிக்கப்படும்."),
},
# The facility's own words, shown as typed.
"part.rejected": {
    "en": ("{code}: part not approved", "{part}: {reason}"),
    "hi": ("{code}: पार्ट मंज़ूर नहीं", "{part}: {reason}"),
    "te": ("{code}: పార్ట్ ఆమోదం పొందలేదు", "{part}: {reason}"),
    "kn": ("{code}: ಪಾರ್ಟ್‌ಗೆ ಒಪ್ಪಿಗೆ ಸಿಕ್ಕಿಲ್ಲ", "{part}: {reason}"),
    "ta": ("{code}: பார்ட்டுக்கு ஒப்புதல் இல்லை", "{part}: {reason}"),
},
# owner ruling 2026-10-15 (R2): the part was approved, and now will not come.
"part.rejected_after_approval": {
    "en": ("{code}: part approval cancelled", "{part} was approved earlier but can no longer be supplied: {reason}"),
    "hi": ("{code}: पार्ट की मंज़ूरी रद्द", "{part} पहले मंज़ूर हुआ था, पर अब नहीं दिया जा सकता: {reason}"),
    "te": ("{code}: పార్ట్ ఆమోదం రద్దు", "{part} ముందు ఆమోదించారు, కానీ ఇప్పుడు ఇవ్వలేము: {reason}"),
    "kn": ("{code}: ಪಾರ್ಟ್ ಅನುಮೋದನೆ ರದ್ದು", "{part} ಮೊದಲು ಅನುಮೋದಿಸಲಾಗಿತ್ತು, ಆದರೆ ಈಗ ನೀಡಲಾಗುವುದಿಲ್ಲ: {reason}"),
    "ta": ("{code}: பார்ட் அனுமதி ரத்து", "{part} முன்பு அனுமதிக்கப்பட்டது, ஆனால் இப்போது வழங்க இயலாது: {reason}"),
},
"part.issued": {
    "en": ("{code}: part issued", "{part} has been issued to you. You can continue the job."),
    "hi": ("{code}: पार्ट दिया गया", "{part} आपको दे दिया गया है। अब आप काम आगे बढ़ा सकते हैं।"),
    "te": ("{code}: పార్ట్ ఇచ్చారు", "{part} మీకు ఇచ్చారు. ఇప్పుడు మీరు పని కొనసాగించవచ్చు."),
    "kn": ("{code}: ಪಾರ್ಟ್ ನೀಡಲಾಗಿದೆ", "{part} ನಿಮಗೆ ನೀಡಲಾಗಿದೆ. ಈಗ ನೀವು ಕೆಲಸ ಮುಂದುವರಿಸಬಹುದು."),
    "ta": ("{code}: பார்ட் வழங்கப்பட்டது", "{part} உங்களுக்கு வழங்கப்பட்டது. இப்போது வேலையைத் தொடரலாம்."),
},
```

`_check()` runs at import, so a missing language or placeholder fails CI's `import app.main`.

### 4.10 Notification copy (**PROPOSED**, server English, signed off with Task 13)

| Kind | Audience / scope | Title | Detail | `to` |
|---|---|---|---|---|
| `part_requested` | `facility`, `franchisee_id` | `{ticketCode}: spare part requested` | `{partName} · {technicianName} · {city} {pincode}` | `/franchise/parts/requests/{id}` |
| `part_decided` (reject only) | NULL, ticket pincode | `{ticketCode}: spare part not approved` — or, when it had been approved first (owner ruling 2026-10-15, R2), `{ticketCode}: approved part cancelled` | `{partName} · {reason}` | `/tickets/{ticketId}` |
| `part_issued` | NULL, ticket pincode | `{ticketCode}: spare part issued` | `{partName} to {technicianName} — book the revisit if one is needed` | `/tickets/{ticketId}` |

`notifications/schemas.py` asserts its own copy of the kinds against the model (the "third copy"
named in `models/notification.py`) — update it in the same commit. The console's icon per kind is
Task 13.

### 4.11 `app/scripts/seed/verify.py` — new check `_parts_agree_with_status`

Computed two ways, must agree (X1):
- every ticket in `Awaiting Part` has ≥ 1 request in `requested`/`approved`;
- every ticket with such a request is `Awaiting Part` **or** terminal (a force-closure may leave
  one open — D6/D7);
- every request's `franchisee_id` equals its ticket's `franchisee_id`;
- every request's `technician_id` equals the ticket's `technician_id`, or the ticket is past
  `Awaiting Customer` (a customer refusal can re-assign after completion).

---

## 5. Client

**None in this task.** The console (catalogue editor, facility queue, facility users, ticket
panel, `Awaiting Part` label/filter chip, the dashboard tile link, the two `to` paths) is
**Task 13** (including the staff-console *Facility users* entry for the HOME franchisee, §4.8b — and **no** staff parts queue). The app (Parts on the job, the request sheet, `Awaiting Part`, error texts for
`PART_REQUEST_NOT_IN_PROGRESS` / `PARTS_PENDING` / `NO_FACILITY` in `i18n/errorText.ts`, the glossary entry) is
**Task 15**. Task 07 has already taught installed builds the status word (X4).

---

## 6. Unit tests — `api/tests/unit/` (pytest, PURE, no database — X1)

`api/tests/unit/test_spare_parts.py`:

| Test | Asserts |
|---|---|
| `test_transition_table_is_exactly_p4` | Parametrised over every `(status, action)` in `PART_REQUEST_STATUSES × ACTIONS`: the **five** pairs in `TRANSITIONS` (incl. `(approved, reject) → rejected`, owner ruling 2026-10-15) give their target, the other fifteen give `None`. `rejected` and `returned` allow nothing; `issued` cannot be rejected. |
| `test_allowed_actions` | `requested → [approve, reject]`, **`approved → [issue, reject]`** (owner ruling 2026-10-15), `issued → [return]`, `rejected/returned → []`. |
| `test_job_status_after` | `In Progress, [] → In Progress`; `In Progress, [requested] → Awaiting Part`; `Awaiting Part, [approved, rejected] → Awaiting Part`; `Awaiting Part, [issued, rejected, returned] → In Progress`; `Awaiting Part, [] → In Progress`; `Awaiting Part, [rejected]` (the last open one rejected after approval, R2) `→ In Progress`; `Awaiting Part, [rejected, approved] → Awaiting Part`; `Awaiting Customer / Closed / Force-Closed / Assigned` with any list → unchanged. |
| `test_merge_inherits_root_first_plus_model` | The §1 example: 9 rows across 4 levels → `[Control board FL-7, Door lock, Drain pump, Drum bearing, Inlet hose, Power cord]`. |
| `test_merge_deepest_wins_and_inactive_hides` | `Door gasket` active at level 1, inactive at the model → absent. Active at the model, inactive at level 1 → present, and the returned row is the model's id. |
| `test_merge_case_and_space_insensitive` | `"Drain Pump"` at root and `" drain  pump"` at leaf → one row, the leaf's. |
| `test_merge_sorted_by_name` | Output ordered by `part_name_key`. |
| `test_normalize_part_name` | Trims, collapses inner runs of spaces, keeps case. |
| `test_can_create_facility_role` | franchisee_admin → facility_admin ✓, facility_operator ✓, franchisee_admin ✗; facility_admin → facility_operator ✓, facility_admin ✗; facility_operator → anything ✗; **`admin` and `national_head` → facility_admin ✓, facility_operator ✓, franchisee_admin ✗ (owner ruling 2026-10-15, R4)**; `regional_head` / `area_manager` → facility_operator ✗ (not a franchise role, not Admin/NH). |
| `test_part_request_create_exactly_one` | `PartRequestCreate` schema: both null → `ValidationError`; both set → `ValidationError`; one set → ok; `otherName` of 121 chars → error. |
| `test_push_text_part_keys` | Import `app.core.push_text`; `PushText("part.issued", code="RGT-INST-0412", part="Drain pump").render(lang)` returns a non-empty title containing `RGT-INST-0412` for each of the five languages; the same for `part.rejected_after_approval` with `reason="Supplier failed"` (the title contains the code, the body the reason). |

Run: `cd api && ./.venv/Scripts/python.exe -m pytest tests/unit -q` — green before the commit
(index §5.9).

---

## 7. Acceptance criteria

Run against **RelianceDB** (dev). Set-up: the §1 catalogue in a test company, three franchisees
(Acme Home = home, Acme Secunderabad, SkyFix), a SkyFix facility operator *Meena*, a Secunderabad
facility operator *Arun*, and an `In Progress` ticket `T` for an FL-7 in 500032 held by Ravi
(SkyFix). `:c` = company id, `:t` = `T.id`.

**Migration and schema**

1. **Given** dev at `b4a8e2f6c903`, **when** `alembic upgrade head`, **then**
   `SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'ck_tickets_status'`
   contains `'Awaiting Part'`; `ck_ticket_events_kind` contains the five `part_*`;
   `ck_notifications_kind` contains `part_requested`, `part_decided`, `part_issued`;
   `ck_notifications_audience` contains `facility` **and still contains `franchisee_admin`**.
2. **Given** a sibling task's value missing from a BEFORE list, **when** upgrading, **then** it
   stops with `RuntimeError` naming the constraint — it never drops the value silently.
3. **Round trip.** Record `SELECT array_agg(id ORDER BY id) FROM tickets WHERE company_id = :c`
   and the same for `ticket_events`. `upgrade head` → `downgrade b4a8e2f6c903` → `upgrade head`
   all exit 0 and both arrays are identical afterwards.
4. **Given** one row in `spare_part_requests` (or one ticket `Awaiting Part`), **when**
   `alembic downgrade b4a8e2f6c903`, **then** it raises the refusal naming both counts and the
   schema is unchanged (`\d spare_part_requests` still exists).
5. `python -m app.scripts.audit_tenancy` exits 0 with the six new links listed; the FK-coverage
   query in `api/AGENTS.md` hard rule 6 returns **no** row for `spare_parts` or
   `spare_part_requests`.
6. `INSERT INTO spare_parts (company_id, node_id, model_id, name) VALUES (:c, :node, :model, 'x')`
   fails `ck_spare_parts_one_owner`; an UPDATE setting `status='issued'` with `issued_at` NULL
   fails `ck_spare_part_requests_issued_matches_status`.
7. `python -m app.scripts.cleanup_db --dry-run` (or its planning step) classifies both tables and
   does not refuse.

**Catalogue**

8. **Given** the §1 catalogue, **when** an Admin calls `GET /spare-parts/catalogue/models/{FL-7}`,
   **then** `own` lists *Control board FL-7* (active) and *Door gasket* (inactive), and
   `inherited` lists *Door gasket, Door lock, Drain pump, Drum bearing, Inlet hose, Power cord*.
9. **When** an Admin POSTs `{"name":" drain  PUMP "}` to Washing Machine, **then** 409; to Front
   Load, **then** 201 (another node).
10. **When** an Area Manager, a facility operator, or a vendor calls any `/spare-parts/catalogue`
    route, **then** 403; **when** an Admin names another company's node id, **then** 404.

**Technician**

11. **Given** `T` `In Progress`, **when** Ravi `GET /jobs/:t/parts`, **then** `partsEnabled` and `canRequest` are
    true and `catalogue` names are exactly
    `[Control board FL-7, Door lock, Drain pump, Drum bearing, Inlet hose, Power cord]`.
12. **When** Ravi POSTs `{"sparePartId": <Drain pump>, "note": "pump motor seized"}`, **then**
    201, and:
    ```sql
    SELECT status FROM tickets WHERE id = :t;                                   -- Awaiting Part
    SELECT code, status, franchisee_id = (SELECT franchisee_id FROM tickets WHERE id = :t)
      FROM spare_part_requests WHERE ticket_id = :t;                 -- RGT-SPR-xxxx | requested | t
    SELECT kind, from_status, to_status FROM ticket_events
     WHERE ticket_id = :t ORDER BY seq DESC LIMIT 2;
      -- status_changed | In Progress | Awaiting Part ;  part_requested | NULL | NULL
    SELECT kind, audience, franchisee_id FROM notifications WHERE ticket_id = :t
     ORDER BY created_at DESC LIMIT 1;                     -- part_requested | facility | SkyFix
    ```
13. **When** Ravi posts the same part again, **then** 200 `"Already requested"` and
    `SELECT count(*) FROM spare_part_requests WHERE ticket_id = :t` is still 1.
14. **When** Ravi posts `{"otherName": "Inlet hose clamp"}` while `Awaiting Part`, **then** 201,
    a `part_requested` event, and **no** new `status_changed` event.
15. **When** Ravi posts a `sparePartId` belonging to a television node, or another company's part,
    **then** 404.
16. **Given** a ticket `Assigned` (or `Awaiting Customer`), **when** Ravi posts a request, **then**
    409 `PART_REQUEST_NOT_IN_PROGRESS`.
17. **When** Ravi calls `POST /jobs/:t/complete` with any request `requested`/`approved`, **then**
    409 `PARTS_PENDING` and `tickets.status` is unchanged.
18. **When** Ravi calls `POST /jobs/:t/cancel` while `Awaiting Part`, **then** 409
    `JOB_NOT_CANCELLABLE`.
19. **When** another technician calls `GET /jobs/:t/parts`, **then** 404.

**Facility**

20. **When** Meena lists `GET /spare-parts/requests`, **then** she sees `T`'s two requests and no
    Secunderabad or home request. **When** Arun (Secunderabad) calls `GET`, `approve` or
    `GET /tickets/:t` on them, **then** **404** each time (the franchise wall). A guessed id from
    another company → 404.
21. **When** Meena approves the pump twice concurrently (two terminals), **then** exactly one
    200 and one 409 `PART_REQUEST_BAD_STATE`; one `part_approved` event; Ravi gets one
    `part.approved` push in his phone's language.
22. **When** Meena calls `issue` on the still-`requested` clamp, **then** 409
    `PART_REQUEST_BAD_STATE`.
23. **When** Meena approves the clamp with `{"addToCatalogue": true}`, **then**
    ```sql
    SELECT spare_part_id IS NOT NULL, other_name, part_name FROM spare_part_requests
     WHERE ticket_id = :t AND part_name = 'Inlet hose clamp';      -- t | NULL | Inlet hose clamp
    SELECT node_id = (SELECT node_id FROM tickets WHERE id = :t) FROM spare_parts
     WHERE lower(name) = 'inlet hose clamp';                                           -- t
    ```
    and a later `GET /jobs/{another FL-7 job}/parts` offers *Inlet hose clamp*.
24. **When** Meena issues the pump and rejects the clamp (`{"reason":"Not stocked"}`), **then**
    after the second call `tickets.status = 'In Progress'` with a
    `status_changed Awaiting Part → In Progress` event whose `actor_label` is Meena's name; a
    `part_decided` notification (audience NULL, `pincode = '500032'`) and a `part_issued` one
    exist; Ravi got `part.issued` and `part.rejected` pushes.
25. **Then** Ravi's `POST /jobs/:t/complete` succeeds (→ `Awaiting Customer`).
26. **When** Meena logs `return` on the pump after that, with a `photoBlobName` from
    `POST /uploads?kind=attachment`, **then** 200, `returned_at` set, ticket status unchanged
    (`Awaiting Customer`), and `GET /spare-parts/requests/{id}` returns a signed `returnPhotoUrl`.
    With `photoBlobName = "attachment/<other company>/x.jpg"` → 400.
27. **No Admin/NH fallback (owner ruling 2026-10-15, R4).** **Given** the home franchisee has no
    facility user, **when** the company's National Head, Admin or an Area Manager calls
    `GET /spare-parts/requests` (or `approve` on any request), **then** **403** every time — and a
    `part_requested` bell is never written for the home franchisee's missing desk (see 37). **When** a home
    **facility operator** exists and calls the same route, **then** 200 with home's requests only.

**Elsewhere**

28. **Given** `T` `Awaiting Part`, **when** a manager `POST /tickets/:t/reschedule` (and,
    separately, Ravi reschedules with the customer's code), **then** 200, the slot moves,
    `status` stays `Awaiting Part`, and the `rescheduled` event has `to_status IS NULL`.
29. **Given** `T` `Awaiting Part`, **when** a manager force-closes it, **then** `Force-Closed`;
    the open request is untouched and Meena can still log `issue`/`return` on it (D6).
30. `GET /tickets/summary` counts `T` in `funnel.active` while `Awaiting Part`;
    `GET /jobs/mine?status=inprogress` includes it; `GET /tickets?status=Awaiting Part` lists it.
31. **When** the vendor who raised `T` opens `GET /tickets/:t`, **then** `partRequests == []`;
    staff and SkyFix's franchisee admin see both requests.
32. **Facility users.** SkyFix's franchisee admin creates a facility admin (201, email sent);
    that facility admin creating another `facility_admin` → 403, a `facility_operator` → 201;
    a facility operator calling `/franchise/facility-users` → 403; deactivating Meena revokes her
    refresh tokens (her next refresh is 401); Arun's membership id from SkyFix's admin → 404.
    `POST /franchise/facility-users/{Meena}/reissue-password` from SkyFix's admin → 200 with `emailStatus`,
    her old password stops working; the same from a facility admin on another facility admin → 403.
33. **Speed contract (Task 11).** `SELECT created_at, from_status, to_status FROM ticket_events
    WHERE ticket_id = :t AND kind = 'status_changed' ORDER BY seq` yields exactly the pair that
    Task 11's `clock_from_events` turns into the Tuesday→Wednesday span.
34. `python -m app.scripts.seed.verify` (or the seed's verify step) reports no
    `_parts_agree_with_status` problem on the seeded company; `pytest tests/unit` green.
35. **X4 gate.** **Given** the Play Console production track, **when** checking its live version
    code, **then** it is ≥ Task 07's build; only then is this API published (migration may run on
    `RelianceProdDB` before, by the owner — it writes no `Awaiting Part`). Record the version code
    in the publish commit.

**Owner rulings 2026-10-15**

36. **Cancel an approved request (R2).** **Given** the pump `approved` (the only open request, job
    `Awaiting Part`), **when** Meena `POST /spare-parts/requests/:r/reject {"reason":"Supplier failed"}`,
    **then** 200 with `status = 'rejected'`, `rejectedAfterApproval = true`, `allowedActions = []`; the
    row has `rejected_from = 'approved'`, `reject_reason` set, `decided_by_label` = Meena; `tickets.status`
    is `In Progress` with a `status_changed Awaiting Part → In Progress` event; a `part_rejected` event
    whose note contains `approved → rejected`; a `part_decided` notification titled *"…: approved part
    cancelled"*; Ravi gets one `part.rejected_after_approval` push. With **no reason** → 422; with the
    request already `issued` → 409 `PART_REQUEST_BAD_STATE`; a **second** reject → 409. With another
    request still open, the job stays `Awaiting Part`.
37. **`NO_FACILITY` and `partsEnabled` (R4).** **Given** a franchisee whose only members are a franchisee
    admin (no facility admin or operator), **when** its technician `GET /jobs/:t/parts`, **then**
    `partsEnabled = false`, `canRequest = false`, `catalogue = []` (history still listed); **when** he
    `POST /jobs/:t/part-requests`, **then** 409 `NO_FACILITY` and `SELECT count(*) FROM spare_part_requests`
    is unchanged. Deactivating that franchisee's only facility user flips an enabled franchisee the same way
    (and reactivating flips it back). The same holds for the **home** franchisee.
38. **Home facility users (R4).** **When** the company's Admin (and, separately, its National Head)
    `POST /spare-parts/home-facility-users` a `facility_admin`, **then** 201 and the user is a member of the
    **home** franchisee; the same call for a `franchisee_admin` role → 422; an Area Manager → 403; a facility
    user of SkyFix addressed by that membership id on `PATCH …/home-facility-users/{id}` → **404**.
    SkyFix's franchisee admin still creates SkyFix's facility users through `/franchise/facility-users`.
    Once a home facility user exists, home technicians' `partsEnabled` is true.

---

## 8. Out of scope, and traps

**Out of scope**
- Stock levels, costs, part prices, who pays for a part (P5). External-franchisee settlements (F11).
- Revisit reminders and no-show detection for a job rescheduled while `Awaiting Part` (D9).
- Re-assigning a waiting job to another technician — `ASSIGNABLE_STATUSES` is unchanged; force-close
  is the exit.
- Customer messaging about parts (WhatsApp templates need Meta approval per wording).
- Console and app screens (Tasks 13, 15); AGENTS.md prose (Task 16, from the docstrings here).

**Open questions for the owner (not invented here)**
- P2 vs D1: may a technician ask for a second part while the job already waits? Written: yes.
- *(Settled 2026-10-15, no longer open: P4/D23 — a facility may reject an approved request, R2; D10 —
  home-franchisee parts have no Admin/NH fallback, a franchise without facility staff gets `NO_FACILITY`,
  R4.)*
- New, minor (written default, not asked of the owner): deactivating the **last facility user** while
  requests are `requested`/`approved` is **not refused** — the open requests wait for a reactivation, or the
  job is force-closed. R3's last-admin refusal covers franchisee admins only.

**Traps**
- **Index inconsistency:** P2 ("only while `In Progress`") vs "several requests per job" — D1.
- **Settled:** Task 05 adds only the `franchisee_admin` audience; `facility` is this migration's
  (index §3.3).
- **`FOR UPDATE` on the ticket would stall every event and bell insert for it** (FK `KEY SHARE`
  conflict). Use `with_for_update(key_share=True)` (`FOR NO KEY UPDATE`).
- **Read the old values before an ORM UPDATE.** `settle_job_status` and `move_slot` must capture
  `was` before the UPDATE — an ORM-enabled UPDATE synchronises the session, and the event would
  record the ticket moving from the state it moved into (the trap `move_slot` documents).
- **`autoflush=False`** (hard rule 10): flush the new request before `settle_job_status` reads
  the ticket's request statuses, or the first request is invisible and the job stays
  `In Progress`.
- **The `facility` audience has four readers** (§4.2). Missing one means a web push to somebody
  whose feed is empty, or a bell nobody can hear.
- **Hand-written indexes:** `uq_spare_parts_node_name`, `uq_spare_parts_model_name`,
  `uq_spare_part_requests_open_name`. Autogenerate will offer to drop them on every later
  revision — delete those drops (hard rule 8).
- **CHECK names are bare** in `drop_constraint`/`create_check_constraint`; UNIQUE names are full
  (`uq_spare_part_requests_company_code`) — hard rule 6, both directions.
- **`return_photo_blob_name` is a NAME, not a URL**, in the private container; never store the
  signed link, and always check the `attachment/{company_id}/` prefix (cross-tenant read otherwise).
- **APKs crash on an unknown status (X4).** `Awaiting Part` reaches phones through
  `/jobs/mine`, `/jobs/today` and push data — publishing before Task 07 is on Play crashes every
  older install the moment one job waits.
- **Task 11 ordering.** Task 11 ships first, so its speed clock has no `Awaiting Part` intervals
  to subtract until this lands — correct, not a bug. The `status_changed` shape (D5) is the
  contract with `clock_from_events`; change neither side alone.
- **Prod migration first, by the owner** (index X5, memory: "Prod migrations: the user runs
  them"), then publish. The dev round trip must seed a part and a request before walking it.
