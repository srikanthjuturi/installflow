"""Per-category overrides of the operating rules — at most one row per node.

`company_rules` says what a company answers. This says what a *product* answers
when the company's answer is wrong for it: a cancellation penalty that suits a
32" TV is not the one that suits a rooftop solar install, and "escalate the
technicians far in advance" is a property of the job, not of the tenant.

## Every column is nullable, and null means INHERIT

That is the whole mechanism. A row here holds only what this node overrides;
everything else falls through to its ancestors, then to `company_rules`, then to
`app.core.rules.DEFAULTS`. `resolve_rules` walks that chain root-first, so the
DEEPEST setting wins, and `create_ticket` stamps the answer onto the ticket.

A node with no overrides has no row. Deleting the row restores inheritance —
which is what the console's *Reset to inherited* does.

## `cancel_penalty_cap_paise` is deliberately absent

It is the only rule here that is not a property of a job. It caps what one
TECHNICIAN can be charged across a calendar month, over every job they took —
so if their TV ticket said ₹5,000 and their AC ticket said ₹3,000 there would be
no answer to which applies. It stays company-wide, in `company_rules` alone.

## The cross-field invariants are NOT here

`company_rules` can CHECK `escalate_hours_before_slot < slot_silence_hours`
because both columns are always populated. Here either may be null, and the
violation only appears once the chain is resolved — a node overriding *silence*
alone can invert an escalation window it never mentioned. So the check moved to
`resolve_rules`' callers: every write to this table validates the RESOLVED set
for the node **and each of its descendants**, and every write to `company_rules`
validates it for every node. See `features/settings/service.py`.
"""

import uuid

from sqlalchemy import (
    CheckConstraint,
    ForeignKeyConstraint,
    ForeignKey,
    Index,
    Integer,
    UniqueConstraint,
    Uuid,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.rules import BONUS_BAND_COUNT, CANCEL_PENALTY_COUNT, LIMITS
from app.db.base_class import Base
from app.db.mixins import AuditMixin, IdMixin


def _optional_between(column: str, key: str) -> CheckConstraint:
    """Null, or within `LIMITS[key]`. Named after the column.

    The null arm is the difference from `company_rules._between` — an absent
    override is not an out-of-range one.
    """
    low, high = LIMITS[key]
    return CheckConstraint(
        f"{column} IS NULL OR ({column} >= {low} AND {column} <= {high})",
        name=column,
    )


def _optional_band_list(column: str, count: int) -> CheckConstraint:
    """Null, or a JSONB array of exactly `count` entries.

    SHAPE only, and arity only, exactly as on `company_rules`: per-element
    bounds need `jsonb_array_elements`, and Postgres refuses a set-returning
    function inside a CHECK. The request schema carries them.

    A band list is overridden WHOLE — there is no such thing as inheriting the
    first two bands and overriding the third. That is why arity can still be
    enforced here even though the column is optional: a partial list would make
    `bonus_bands_paise[1]` a null nobody expects.
    """
    return CheckConstraint(
        f"{column} IS NULL OR ("
        f"jsonb_typeof({column}) = 'array' "
        f"AND jsonb_array_length({column}) = {count})",
        name=column,
    )


class ProductNodeRules(Base, IdMixin, AuditMixin):
    """This node's overrides. Absent columns inherit; an absent row inherits all."""

    __tablename__ = "product_node_rules"

    company_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("companies.id", ondelete="CASCADE"), nullable=False
    )
    #: The FK is COMPOSITE — see __table_args__.
    node_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False)

    # ── money, in paise (hard rule 9) ────────────────────────────────────────
    #
    # ⚠ `none_as_null=True` on both, and it is load-bearing rather than tidy.
    #
    # Without it, assigning Python `None` to a JSONB column stores the JSON
    # value `null` — `'null'::jsonb` — and NOT SQL NULL. `jsonb_typeof` of that
    # is `'null'`, so the "IS NULL or an array of four" CHECK below refuses the
    # row, and a node overriding only its escalation window cannot be saved at
    # all. It reads back as Python `None` either way, which is what makes the
    # bug invisible from this side: the model looks right and the INSERT 409s.
    #
    # These are the first NULLABLE JSONB columns in the schema. Every other one
    # — `image_urls`, `service_types`, both `company_rules` lists, `parameters`
    # — is NOT NULL with a default, which is why nothing hit this before.

    #: Ordered by `core.rules.CANCEL_PENALTY_BANDS`. Overridden whole.
    cancel_penalties_paise: Mapped[list[int] | None] = mapped_column(
        JSONB(none_as_null=True), nullable=True
    )
    #: The chips a manager picks from when funding a re-notification. Read from
    #: the TICKET's snapshot on the escalation screen, not from the company row
    #: — otherwise setting them here would change nothing on the one screen that
    #: spends them.
    bonus_bands_paise: Mapped[list[int] | None] = mapped_column(
        JSONB(none_as_null=True), nullable=True
    )

    # ── thresholds, as whole percents ────────────────────────────────────────

    ai_confidence_threshold: Mapped[int | None] = mapped_column(Integer, nullable=True)
    sla_warn_at_pct: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # ── the clock ────────────────────────────────────────────────────────────

    slot_silence_hours: Mapped[int | None] = mapped_column(Integer, nullable=True)
    escalate_hours_before_slot: Mapped[int | None] = mapped_column(
        Integer, nullable=True
    )
    force_close_hours: Mapped[int | None] = mapped_column(Integer, nullable=True)
    renotify_grace_minutes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    slot_reminder_minutes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    customer_notice_minutes: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # ── where ────────────────────────────────────────────────────────────────

    #: Metres between the live proof photo and the ticket's own coordinates. One
    #: of the more obviously product-shaped rules: a rooftop install is not
    #: photographed from the same place a set-top box is.
    geo_radius_m: Mapped[int | None] = mapped_column(Integer, nullable=True)

    __table_args__ = (
        # One answer per node. TOTAL, not partial: this table has no soft
        # delete, for the reason `company_rules` has none — a configuration row
        # is not a record of something that happened, and a hidden second row
        # would be a node with two answers to one question.
        UniqueConstraint("company_id", "node_id", name="uq_product_node_rules_node"),
        _optional_band_list("cancel_penalties_paise", CANCEL_PENALTY_COUNT),
        _optional_band_list("bonus_bands_paise", BONUS_BAND_COUNT),
        _optional_between("ai_confidence_threshold", "ai_confidence_threshold"),
        _optional_between("sla_warn_at_pct", "sla_warn_at_pct"),
        _optional_between("slot_silence_hours", "slot_silence_hours"),
        _optional_between("escalate_hours_before_slot", "escalate_hours_before_slot"),
        _optional_between("force_close_hours", "force_close_hours"),
        _optional_between("renotify_grace_minutes", "renotify_grace_minutes"),
        _optional_between("slot_reminder_minutes", "slot_reminder_minutes"),
        _optional_between("customer_notice_minutes", "customer_notice_minutes"),
        _optional_between("geo_radius_m", "geo_radius_m"),
        # The unique above covers `(company_id, node_id)` as a prefix, which is
        # exactly the composite FK's column list — so no separate index (hard
        # rule 6's other half: do not add one a unique already covers).
        ForeignKeyConstraint(
            ["company_id", "node_id"],
            ["product_nodes.company_id", "product_nodes.id"],
            name="fk_product_node_rules_company_node",
            ondelete="CASCADE",
        ),
    )
