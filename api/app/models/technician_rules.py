"""Rules that belong to ONE technician, not to the company, a category or a franchisee.

Epic 3. Everything resolved elsewhere (`core.rules`, the franchisee's travel and
speed settings) answers "what is the rule for this job". These columns let a
manager say "for THIS person, differently" -- a senior freelancer on a better
payout, a trainee on gentler penalties. Every column is nullable and NULL means
INHERIT, so a row with nothing set is exactly the same as no row.

## Frozen at ACCEPT, except the redemption terms

What depends on the technician is frozen when they accept the job
(`tickets.accept_snapshot`, see `core.accept_snapshot`): the overrides below that
touch a job -- payout, penalties, bonus chips, speed, travel -- are copied into
the snapshot at that moment, so editing them restates nothing already accepted.
The two REDEMPTION terms (`min_redeemable_paise`, `holding_paise`) are the
opposite on purpose: they are about money not yet paid out, so they are read live.

## Holding is a reservation, not a ledger entry

`holding_paise` moves no money. It is subtracted from what the technician may
ASK to redeem (`core.ledger.redeemable_balance`), while the amount stays theirs
on the ledger and on their Earnings screen. Every change is an append-only row in
`technician_holding_events` (who, old, new, why), because a manager holding back
somebody's pay must be answerable for it.
"""

import datetime
import uuid

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Integer,
    SmallInteger,
    String,
    UniqueConstraint,
    Uuid,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.rules import BONUS_BAND_COUNT, CANCEL_PENALTY_COUNT
from app.db.base_class import Base
from app.db.mixins import AuditMixin, IdMixin

#: Bounds mirrored from `core.rules.LIMITS`, `core.travel.TRAVEL_LIMITS` and the
#: speed matrix so the three writers (this CHECK, the API schema, the console
#: form) cannot drift. Declared as literals because a model must not import a
#: feature.
PAYOUT_PERCENT = (1, 300)
PENALTY_PAISE = (0, 10_000_000)
BONUS_PAISE = (1, 10_000_000)
SPEED_HOURS = (1, 720)
SPEED_PAISE = (0, 1_000_000)
TRAVEL_FREE_KM = (0, 500)
TRAVEL_RATE_PAISE = (0, 1_000_000)
TRAVEL_MAX_PAISE = (0, 10_000_000)
#: A minimum / holding above a crore rupees is a typo.
REDEEM_PAISE = (0, 1_000_000_000)


def _list_check(column: str, count: int, low: int, high: int) -> str:
    """NULL, or a JSON array of exactly `count` integers in [low, high]."""
    return (
        f"{column} IS NULL OR (jsonb_typeof({column}) = 'array' "
        f"AND jsonb_array_length({column}) = {count} "
        f"AND NOT jsonb_path_exists({column}, "
        f"'$[*] ? (@.type() != \"number\" || @ < {low} || @ > {high})'))"
    )


class TechnicianRules(Base, IdMixin, AuditMixin):
    __tablename__ = "technician_rules"

    company_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("companies.id", ondelete="CASCADE"), nullable=False
    )
    #: COMPOSITE FK, one row per technician -- see __table_args__.
    technician_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False)

    # ── payout: a percentage of the job's stamped `technician_payout_paise` ──
    #: 100 pays the product's figure, 120 pays a fifth more. Applied when the
    #: customer confirms; never to an employee (they have no per-job payout).
    payout_percent: Mapped[int | None] = mapped_column(SmallInteger, nullable=True)

    # ── penalties and bonus chips: replace the ticket's whole list ───────────
    #: Ordered by `core.rules.CANCEL_PENALTY_BANDS`, overridden whole.
    cancel_penalties_paise: Mapped[list[int] | None] = mapped_column(
        JSONB(none_as_null=True), nullable=True
    )
    bonus_bands_paise: Mapped[list[int] | None] = mapped_column(
        JSONB(none_as_null=True), nullable=True
    )

    # ── speed: all four or none; replaces the franchisee's matrix match ──────
    speed_reward_within_hours: Mapped[int | None] = mapped_column(SmallInteger, nullable=True)
    speed_penalty_after_hours: Mapped[int | None] = mapped_column(SmallInteger, nullable=True)
    speed_reward_paise: Mapped[int | None] = mapped_column(Integer, nullable=True)
    speed_penalty_paise: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # ── travel: each field inherits the franchisee's rule when null ──────────
    travel_free_km: Mapped[int | None] = mapped_column(SmallInteger, nullable=True)
    travel_paise_per_step: Mapped[int | None] = mapped_column(Integer, nullable=True)
    travel_max_paise_per_job: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # ── redemption: read live, not frozen ────────────────────────────────────
    #: The least a redemption may be for. NULL / 0 = no minimum.
    min_redeemable_paise: Mapped[int | None] = mapped_column(Integer, nullable=True)
    #: Held back from what may be redeemed. 0 = nothing held.
    holding_paise: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text("0")
    )

    __table_args__ = (
        UniqueConstraint("company_id", "technician_id", name="uq_technician_rules_technician"),
        ForeignKeyConstraint(
            ["company_id", "technician_id"],
            ["technician_profiles.company_id", "technician_profiles.id"],
            name="fk_technician_rules_technician",
            ondelete="CASCADE",
        ),
        CheckConstraint(
            "payout_percent IS NULL OR payout_percent BETWEEN "
            f"{PAYOUT_PERCENT[0]} AND {PAYOUT_PERCENT[1]}",
            name="payout_percent",
        ),
        CheckConstraint(
            _list_check("cancel_penalties_paise", CANCEL_PENALTY_COUNT, *PENALTY_PAISE),
            name="cancel_penalties_paise",
        ),
        CheckConstraint(
            _list_check("bonus_bands_paise", BONUS_BAND_COUNT, *BONUS_PAISE),
            name="bonus_bands_paise",
        ),
        CheckConstraint(
            "(speed_reward_within_hours IS NULL) = (speed_penalty_after_hours IS NULL) "
            "AND (speed_reward_within_hours IS NULL) = (speed_reward_paise IS NULL) "
            "AND (speed_reward_within_hours IS NULL) = (speed_penalty_paise IS NULL)",
            name="speed_all_or_none",
        ),
        CheckConstraint(
            "speed_reward_within_hours IS NULL OR ("
            f"speed_reward_within_hours BETWEEN {SPEED_HOURS[0]} AND {SPEED_HOURS[1]} "
            f"AND speed_penalty_after_hours BETWEEN {SPEED_HOURS[0]} AND {SPEED_HOURS[1]} "
            "AND speed_penalty_after_hours >= speed_reward_within_hours "
            f"AND speed_reward_paise BETWEEN {SPEED_PAISE[0]} AND {SPEED_PAISE[1]} "
            f"AND speed_penalty_paise BETWEEN {SPEED_PAISE[0]} AND {SPEED_PAISE[1]})",
            name="speed_bounds",
        ),
        CheckConstraint(
            f"travel_free_km IS NULL OR travel_free_km BETWEEN {TRAVEL_FREE_KM[0]} AND {TRAVEL_FREE_KM[1]}",
            name="travel_free_km",
        ),
        CheckConstraint(
            "travel_paise_per_step IS NULL OR travel_paise_per_step BETWEEN "
            f"{TRAVEL_RATE_PAISE[0]} AND {TRAVEL_RATE_PAISE[1]}",
            name="travel_paise_per_step",
        ),
        CheckConstraint(
            "travel_max_paise_per_job IS NULL OR travel_max_paise_per_job BETWEEN "
            f"{TRAVEL_MAX_PAISE[0]} AND {TRAVEL_MAX_PAISE[1]}",
            name="travel_max_paise_per_job",
        ),
        CheckConstraint(
            "min_redeemable_paise IS NULL OR min_redeemable_paise BETWEEN "
            f"0 AND {REDEEM_PAISE[1]}",
            name="min_redeemable_paise",
        ),
        CheckConstraint(
            f"holding_paise BETWEEN 0 AND {REDEEM_PAISE[1]}", name="holding_paise"
        ),
        Index("ix_technician_rules_company", "company_id"),
    )


class TechnicianHoldingEvent(Base, IdMixin, AuditMixin):
    """One change to a technician's holding: who held back how much, and why.

    Append-only. `new_paise = 0` is a release.
    """

    __tablename__ = "technician_holding_events"

    company_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("companies.id", ondelete="CASCADE"), nullable=False
    )
    technician_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False)
    old_paise: Mapped[int] = mapped_column(Integer, nullable=False)
    new_paise: Mapped[int] = mapped_column(Integer, nullable=False)
    reason: Mapped[str] = mapped_column(String(240), nullable=False)
    actor_label: Mapped[str | None] = mapped_column(String(120), nullable=True)
    at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    __table_args__ = (
        ForeignKeyConstraint(
            ["company_id", "technician_id"],
            ["technician_profiles.company_id", "technician_profiles.id"],
            name="fk_technician_holding_events_technician",
            ondelete="CASCADE",
        ),
        CheckConstraint("old_paise >= 0 AND new_paise >= 0", name="non_negative"),
        CheckConstraint("old_paise <> new_paise", name="changed"),
        Index(
            "ix_technician_holding_events_technician",
            "company_id",
            "technician_id",
            "at",
        ),
    )
