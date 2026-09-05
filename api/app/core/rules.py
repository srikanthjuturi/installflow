"""Per-company operating rules — the numbers Rules configuration owns.

Every value here used to be a constant: five of them in `Settings` (read from
`.env` at process start), one in `core/tickets.py`, and the two money lists
nowhere at all — they lived in the console's mock. That made them
**deployment** config for a **multi-tenant** product: one escalation window for
every company on the server, changed by editing a file and restarting.

They are per-company rows now, and this module is the one place that says what
a rule IS, what it may be set to, and what a brand-new company starts with.

## What is here and what is deliberately not

A rule is here when a company could sensibly answer it differently. It is NOT
here when it is vocabulary the system is built from — `SERVICE_LEVEL_HOURS`,
`SLOT_WINDOWS`, `PROOF_KINDS`, `TICKET_STATUSES`. Those describe what a ticket
*is*; changing them from a web form would not configure the product, it would
redefine it. `SWEEP_INTERVAL_SECONDS` stays in `Settings` for the same kind of
reason from the other end: how often a worker wakes is infrastructure, not
policy — and it is the resolution limit every timing rule here is subject to,
since nothing can fire more precisely than one tick.

## Money is paise

Hard rule 9, and the reason the two band lists are not the rupee figures the
console shows. The console converts at its own transport boundary, exactly as
`tickets.bonus_paise` is already handled.

## A rule is per COMPANY here and per PRODUCT in `product_node_rules`

This module holds the baseline and the defaults. A catalogue node may override
any of `NODE_OVERRIDABLE_KEYS`, inheriting whatever it does not name, and
`resolve_rules` folds the chain. A ticket stamps the answer at intake, so
nothing downstream resolves anything at request time — read it back with
`snapshot_value` (Python) or `snapshot_int` (SQL).

## The two band lists are JSONB

Same reasoning as `product_models.image_urls` and `service_types`: bounded,
always read whole with their row, never queried on their own. It also survives
the open ruling on the penalty bands — the console shows four cutting at 4h/2h
and the technician app three cutting at 8h/4h, and whichever wins changes the
LENGTH of that list. Four columns would make that a migration; a JSONB array
makes it a value.
"""

from sqlalchemy import Integer, cast, func, literal, literal_column

#: What a cancellation costs, by how close to the confirmed slot it came.
#:
#: The labels are NOT configurable and do not live in the database: the
#: boundaries are domain — "less than two hours before the slot" is a fact about
#: the clock, not a preference — while the amounts are policy. Served alongside
#: the amounts so the console never has to spell them itself.
#:
#: The first three are CANCELLATIONS — the technician said in advance they were
#: not coming, and the charge scales with how little notice ops had to reassign
#: or at least telephone the customer.
#:
#: **No-show is the fourth because it is not a cancellation at all.** They
#: accepted, the slot passed, nobody was told, and the first person to discover
#: it was the customer who took the day off. A cancellation two minutes before
#: the slot still leaves somebody able to act; this leaves nobody. That is why
#: it is the most expensive band rather than simply the latest one.
#:
#: `tickets.sweeps.sweep_no_shows` detects one — a slot that closed with the job
#: still `Assigned` and no proof against it — and deliberately charges nothing.
#: A person confirms it through `tickets.service.record_no_show`, because a dead
#: phone and a deliberate no-show are indistinguishable from the data and this
#: is the most expensive band there is.
#:
#: These four were once contradicted by the technician app's three (₹80 / ₹150 /
#: ₹250, cutting at 8h and 4h, with no no-show band at all). **Ruled in favour
#: of these**, on cost of change: they were already here, already per company,
#: and the technician's cancel screen needed no redesign because it renders
#: whatever the server sends. See adminWeb/AGENTS.md §1.
CANCEL_PENALTY_BANDS = (
    "> 4h before slot",
    "2–4h before slot",
    "< 2h before slot",
    "No-show",
)

#: The hour boundaries the first three bands cut at, descending.
#:
#: In code rather than in `company_rules`, for the reason the labels are: a
#: boundary is a fact about the clock and the label states it out loud, so a
#: company that moved the cut to 3h would be showing "2–4h before slot" over an
#: amount charged at three. The AMOUNTS are policy and are configurable; where
#: one band ends and the next begins is not.
#:
#: **This is the ruling on the open decision**, and it is the console's four
#: bands rather than the technician app's three (₹80/₹150/₹250 cutting at 8h
#: and 4h). Both were client-approved and they disagreed; these are the ones
#: already in `company_rules`, already editable per company, and already
#: carrying the no-show band the other scheme has no place for. The technician's
#: cancel screen needed no redesign to adopt them because it renders whatever
#: the server sends — `mobileapp/src/features/jobs/api/cancel.ts` computed the
#: band on the DEVICE until this landed, which its own comment called the wrong
#: place: a phone with a wrong clock talked itself into a cheaper penalty.
CANCEL_PENALTY_BOUNDS_HOURS = (4, 2)

#: Index of the band a cancellation is charged at, given hours to the slot.
#:
#: Never returns the last one. **No-show is not a cancellation** — it is what
#: happens when nobody cancels at all, the slot passes and the customer is the
#: one who finds out. It is detected by `tickets.sweeps.sweep_no_shows` and
#: charged only when a manager confirms it; it is unreachable from an act of
#: cancelling, however late.
#:
#: ## Cancelling AFTER the slot has opened is still the last cancellable band
#:
#: Ruled, not inherited from the arithmetic. A technician stuck in traffic at
#: 10:40 for a 10:00 slot is charged `< 2h`, not no-show — even though the
#: customer has already been let down — because he TOLD somebody. Ops can now
#: phone the customer, and another technician might still go.
#:
#: The gap between the two prices is the whole point: it is what speaking up is
#: worth, and it has to be worth something. On the seeded defaults that is ₹800
#: against ₹1,200. If a company ever set its no-show band BELOW its late-cancel
#: band it would be paying people to say nothing, which is why they are edited
#: on one screen where both are visible at once.
#:
#: The two comparisons differ on purpose, because the approved labels do:
#: "> 4h before slot" EXCLUDES four, while "2–4h before slot" INCLUDES both of
#: its ends. So exactly four hours out is the middle band and exactly two hours
#: out is still the middle band. Either instant is vanishingly unlikely to land
#: on, and matching the label a technician is reading costs nothing.
def cancel_band_index(hours_to_slot: float) -> int:
    upper, lower = CANCEL_PENALTY_BOUNDS_HOURS
    if hours_to_slot > upper:
        return 0
    if hours_to_slot >= lower:
        return 1
    return 2

#: How many amounts each list holds. Both are four today for unrelated reasons —
#: the penalty bands by the prototype's boundaries, the bonus chips by the
#: approved picker — so they are two constants rather than one shared four.
CANCEL_PENALTY_COUNT = len(CANCEL_PENALTY_BANDS)
BONUS_BAND_COUNT = 4

#: What a company starts with, and what the migration backfilled every existing
#: company to. These are the values that were live as constants immediately
#: before this table existed, so the change moved where the numbers are kept
#: without changing a single one of them.
DEFAULTS: dict[str, object] = {
    # ₹300 · ₹500 · ₹800 · ₹1,200, in paise.
    "cancel_penalties_paise": [30000, 50000, 80000, 120000],
    # ₹5,000 per technician per month. **0 means NO CAP**, not "charge nothing"
    # — a technician who should never be charged is one whose bands are zero.
    #
    # ## "Month" is the CALENDAR month in IST
    #
    # Settled here rather than left to whoever writes the ledger, because the
    # two readings pay out differently and both look reasonable in isolation.
    #
    # The cap exists to stop a bad month turning a technician's earnings
    # negative, and "a bad month" is bounded by the period they are SETTLED
    # over. A rolling 30-day window would cap on one clock and pay on another,
    # so a single settlement could carry more than the cap — which is the one
    # thing the cap is for. It is also unanswerable from a phone: "how much
    # have I got left" changes every day as old penalties age out, so nobody
    # could plan around it.
    #
    # IST because that is how this codebase already reckons a day — the daily
    # job cap counts by SLOT date in IST — and two timezones for two caps is a
    # bug waiting for a technician near midnight.
    #
    # The boundary IS gameable in theory: cancel heavily on the 31st and again
    # on the 1st and you meet two caps back to back. Judged not worth pricing
    # for — that is ten cancellations, which is a performance problem the
    # technician's `status` answers, not a pricing one.
    "cancel_penalty_cap_paise": 500000,
    # ₹200 · ₹400 · ₹600 · ₹800, in paise. The approved picker's four chips.
    "bonus_bands_paise": [20000, 40000, 60000, 80000],
    # Percent. Below this confidence a proof set is not auto-closed; it goes to
    # an Area Service Manager. (An UNREADABLE image is a separate outcome —
    # the technician retakes it on site — and no threshold decides that one.)
    "ai_confidence_threshold": 70,
    # Percent of the SLA window that must remain before a ticket stops reading
    # "On track" and starts reading "Due soon". Was `SLA_WARN_AT = 0.25`, as a
    # float; an integer percent keeps a fraction out of the database.
    "sla_warn_at_pct": 25,
    # Hours of customer silence before somebody has to telephone them. The
    # ticket cannot enter the pool until a slot exists.
    "slot_silence_hours": 6,
    # A job still unassigned this close to its slot reaches the Area Service
    # Manager. Matches the cancellation band: under four hours is when a
    # CANCELLED job escalates, so it is when an EMPTY one should too.
    "escalate_hours_before_slot": 4,
    # A completed visit the customer never confirmed. Nothing is auto-closed —
    # a manager force-closes it with supporting documents.
    "force_close_hours": 48,
    # How long a manager's funded re-notification is protected before the sweep
    # may escalate the same job again. Without it the re-publish lands back
    # inside the escalation window it never left and the next tick takes it
    # straight out — the grace is what makes a bonus an offer, not a flicker.
    "renotify_grace_minutes": 30,
    # How long before a slot the technician is reminded. The sweep runs every
    # SWEEP_INTERVAL_SECONDS, so the reminder lands within one tick of this.
    "slot_reminder_minutes": 60,
    # How long before a slot the CUSTOMER is told who is coming and on what
    # number to reach them.
    #
    # Sixty, matching the technician's own reminder rather than deriving from
    # it. The two messages answer the same "this is about to happen" and
    # sending them the same distance out means a customer who rings the number
    # reaches somebody whose phone has just buzzed about the same job. They are
    # nonetheless two independent rules: a company that wants to warn its
    # technicians earlier than it warns its customers is expressing a real
    # policy, not a mistake, so nothing here forces one to bound the other.
    "customer_notice_minutes": 60,
    # Metres. How far the live proof photo may be from the ticket's OWN
    # coordinates.
    #
    # A kilometre, and it is deliberately loose. The point on a ticket is a
    # geocoded one — Google returns the plot or building centroid, not the door
    # — and for an apartment complex, a gated layout or a rural plot that sits
    # a hundred to three hundred metres off, systematically rather than
    # randomly. The phone's own fix adds tens of metres more. A kilometre is
    # tight enough that a photograph from the next suburb fails and loose
    # enough that a technician in the right stairwell does not.
    #
    # Consulted ONLY for a ticket that carries coordinates. One whose address
    # was typed is on the pincode rule, and this number does not apply to it.
    "geo_radius_m": 1000,
}

#: Bounds every writer checks: the API schema, the CHECK constraints on the
#: model, and the console's own form. Declared once so the three cannot drift.
#:
#: The AI threshold's 50–95 is the approved slider's range and is a real rule,
#: not a widget detail: 100% would flag every proof set for review and 0% would
#: auto-close all of them, and neither is a configuration anybody wants to be
#: one keystroke away from.
LIMITS: dict[str, tuple[int, int]] = {
    "ai_confidence_threshold": (50, 95),
    "sla_warn_at_pct": (1, 99),
    "slot_silence_hours": (1, 72),
    "escalate_hours_before_slot": (1, 48),
    "force_close_hours": (1, 240),
    "renotify_grace_minutes": (5, 720),
    "slot_reminder_minutes": (5, 1440),
    # A day's ceiling, like the reminder: past that the message stops being
    # "who is coming today" and becomes a scheduling notice the confirmation
    # already sent. The floor is five because nothing can fire more precisely
    # than one sweep tick, so a smaller number would promise what the clock
    # cannot keep.
    "customer_notice_minutes": (5, 1440),
    # Metres. The floor is fifty because below it the rule refuses honest
    # technicians more often than dishonest ones: a consumer GPS fix and a
    # geocoded plot centroid are each tens of metres wide on their own, and a
    # check nobody can pass is not a check. The ceiling catches the ten-times
    # typo on the default — past five kilometres this stops meaning "at the
    # customer's address" and starts meaning "in the city", which is what the
    # pincode rule already did, worse.
    "geo_radius_m": (50, 5000),
    # Money, in paise. The ceiling is "above any plausible figure" rather than a
    # policy: it is there so a typo cannot charge somebody ₹1,00,000.
    "cancel_penalty_paise": (0, 10000000),
    "cancel_penalty_cap_paise": (0, 100000000),
    # `> 0`, mirroring the CHECK on `tickets.bonus_paise`: ₹0 is not a smaller
    # incentive, it is the absence of one, and the absence is spelled "do not
    # fund a bonus".
    "bonus_band_paise": (1, 10000000),
}


#: Every rule, in `DEFAULTS` order. The one list `resolve_rules`, the snapshot
#: and the settings schema all iterate, so none of them can quietly miss one.
RULE_KEYS: tuple[str, ...] = tuple(DEFAULTS)

#: The rules a product node may override. Everything except the cap.
#:
#: `cancel_penalty_cap_paise` is the only rule here that is not a property of a
#: JOB. It caps what one TECHNICIAN can be charged across a calendar month, over
#: every job they took — so if their TV ticket said ₹5,000 and their AC ticket
#: said ₹3,000 there would be no answer to which applies. It stays company-wide.
NODE_OVERRIDABLE_KEYS: tuple[str, ...] = tuple(
    key for key in RULE_KEYS if key != "cancel_penalty_cap_paise"
)


def snapshot_value(snapshot: dict | None, key: str):
    """One rule out of a ticket's `rules_snapshot`, falling back to `DEFAULTS`.

    **Always read a snapshot through this, never with a bare subscript.** A
    ticket stamped before a rule existed simply has no key for it, and a
    `KeyError` on a sweep is a sweep that stops running for everybody. The
    fallback is what makes adding a rule a deploy rather than a data migration
    over every ticket ever raised.

    The SQL half of the same guarantee is `snapshot_int`.
    """
    if snapshot:
        value = snapshot.get(key)
        if value is not None:
            return value
    return DEFAULTS[key]


def snapshot_int(column, key: str):
    """`COALESCE((rules_snapshot->>'key')::int, <default>)`, for the sweeps.

    The set-based twin of `snapshot_value`. The sweeps do their arithmetic in
    SQL — they compare a slot against an interval built from a rule — so they
    need the fallback as an expression rather than as a Python value.
    """
    return func.coalesce(
        cast(column.op("->>")(literal(key)), Integer), literal(int(DEFAULTS[key]))
    )


#: A rule value as a time span, for date arithmetic in SQL.
#:
#: `interval '1 hour' * <int expression>` rather than `make_interval(hours =>
#: ...)`: multiplication by an integer is exact, reads as what it is, and does
#: not depend on SQLAlchemy rendering Postgres's named-argument notation.
#:
#: Here rather than in `tickets/sweeps.py`, where they started, because
#: `tickets/service.py` needs them too and `sweeps` already imports FROM
#: `service` — the other direction would be a cycle. They belong beside
#: `snapshot_int` anyway: all three turn a rule into an expression.
def interval_hours(expression):
    return expression * literal_column("interval '1 hour'")


def interval_minutes(expression):
    return expression * literal_column("interval '1 minute'")


def validate_resolved(resolved: dict) -> str | None:
    """The cross-field invariants, checked on a RESOLVED set. None if it holds.

    These live here rather than as CHECK constraints on `product_node_rules`
    because that table is all-nullable: a node overriding `slot_silence_hours`
    alone can invert an escalation window it never mentioned, and no constraint
    on the row it wrote can see the row it inherited from.

    So every writer resolves first and calls this — `PUT /settings/rules/nodes`
    for the node and each of its DESCENDANTS (loosening a parent can break a
    child), and `PUT /settings/rules` for every node in the company.
    """
    penalties = list(resolved["cancel_penalties_paise"])
    if any(b < a for a, b in zip(penalties, penalties[1:])):
        return (
            "Cancellation penalties must not decrease as the slot gets closer — "
            f"{CANCEL_PENALTY_BANDS[0]} cannot cost more than {CANCEL_PENALTY_BANDS[-1]}."
        )

    bonuses = list(resolved["bonus_bands_paise"])
    if any(b <= a for a, b in zip(bonuses, bonuses[1:])):
        return "Each bonus band must be larger than the one before it."

    cap = int(resolved["cancel_penalty_cap_paise"])
    if cap and cap < max(penalties):
        return (
            "The monthly cap is below the largest cancellation penalty, so that "
            "penalty could never be charged in full."
        )

    if resolved["escalate_hours_before_slot"] >= resolved["slot_silence_hours"]:
        return (
            "Escalation must trigger closer to the slot than the confirmation "
            "timeout — a job cannot go unassigned before a slot exists."
        )
    return None


async def resolve_rules_with_sources(
    db, company_id, node_id
) -> tuple[dict, dict[str, str | None]]:
    """The rules in force for a job on `node_id`, and where each one came from.

    Four layers, each overriding the last, so the DEEPEST setting wins:

        DEFAULTS  ->  company_rules  ->  ancestors, root first  ->  the node

    The second return value maps a rule key to the NAME of the node that
    supplied it, or `None` when nothing below the company did. That is what lets
    the console print "300, from TV" beside an empty box instead of leaving
    somebody to guess which ancestor they are looking at.

    Two round trips beyond `load_rules`, because `ancestor_ids` means the whole
    chain is fetched by `IN (...)` rather than walked. `create_ticket` calls
    this once and stamps the result on the ticket; nothing reads it per request
    afterwards.

    An unknown or foreign `node_id` yields the company's rules rather than
    raising — the caller has already resolved the node through a scoped loader,
    and a missing one here means the catalogue changed under a read, which is
    not worth failing a ticket over.

    Imported lazily for the reason `load_rules` is: `models.product_node_rules`
    imports `LIMITS` from this module, and at module level the two would cycle.
    """
    from sqlalchemy import select

    from app.models.product import ProductNode
    from app.models.product_node_rules import ProductNodeRules

    resolved: dict = dict(DEFAULTS)
    sources: dict[str, str | None] = {key: None for key in RULE_KEYS}

    company = await load_rules(db, company_id)
    for key in RULE_KEYS:
        value = getattr(company, key, None)
        if value is not None:
            resolved[key] = value

    node = await db.scalar(
        select(ProductNode).where(
            ProductNode.id == node_id,
            ProductNode.company_id == company_id,
        )
    )
    if node is None:
        return resolved, sources

    rows = (
        await db.execute(
            select(ProductNodeRules, ProductNode.name)
            .join(ProductNode, ProductNode.id == ProductNodeRules.node_id)
            .where(
                ProductNodeRules.company_id == company_id,
                ProductNodeRules.node_id.in_([*node.ancestor_ids, node.id]),
            )
            # Root first, so a child's override lands on top of its parent's.
            .order_by(ProductNode.depth)
        )
    ).all()

    for override, name in rows:
        for key in NODE_OVERRIDABLE_KEYS:
            value = getattr(override, key)
            if value is not None:
                resolved[key] = value
                sources[key] = name
    return resolved, sources


async def resolve_rules(db, company_id, node_id) -> dict:
    """`resolve_rules_with_sources` without the provenance. See there."""
    resolved, _ = await resolve_rules_with_sources(db, company_id, node_id)
    return resolved


async def load_rules(db, company_id):
    """This company's rules row, creating it from `DEFAULTS` if it is missing.

    Three things guarantee the row exists — the migration backfilled every
    company, `companies.service.create_company` writes one, and this. The third
    is not redundancy for its own sake: the sweeps INNER JOIN this table, so a
    company without a row would silently stop being swept, and a missing
    escalation is invisible in exactly the way a missing row is. Repairing it on
    the next read is cheaper than a notification nobody gets.

    It flushes but deliberately does NOT commit. `create_company` calls this in
    the middle of building a tenant — after the company row, before the admin
    user — and a commit here would persist a half-made company that a later
    failure could no longer roll back. The caller owns the transaction; on a
    plain read that means the repair is redone next time, which is harmless and
    much cheaper than the alternative.

    The model is imported inside the function because `models.company_rules`
    imports `LIMITS` from this module to build its CHECK constraints; at module
    level the two would be a cycle. Same shape as the documented lazy import in
    `auth/otp_service.py`, and for the same kind of reason.
    """
    from sqlalchemy import select

    from app.models.company_rules import CompanyRules

    rules = await db.scalar(
        select(CompanyRules).where(CompanyRules.company_id == company_id)
    )
    if rules is None:
        rules = CompanyRules(company_id=company_id, **DEFAULTS)
        db.add(rules)
        # Sessions run with autoflush=False (hard rule 10), and callers read
        # these values back in the same request.
        await db.flush()
    return rules
