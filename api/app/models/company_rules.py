"""One row per company: the operating rules Rules configuration edits.

See `app.core.rules` for what belongs here, what deliberately does not, and the
values a new company starts with.

## Exactly one row per company

`uq_company_rules_company` is TOTAL, not partial on `deleted_at IS NULL` — this
table has no soft delete. A configuration row is not a record of something that
happened; there is nothing to preserve a tombstone of, and a hidden second row
would be a company with two answers to the same question. It goes away with its
company, hence `ON DELETE CASCADE`.

That unique also covers `company_id` as an index prefix, so this table
deliberately carries no separate `ix_company_rules_company_id` — hard rule 6's
other half: do not add an index a unique constraint already covers.

## The CHECKs are the last line, not the only one

Every bound is stated three times on purpose — here, in the request schema, and
in the console's form — because each catches a different writer. The schema
gives a per-field 422 a human can act on; these catch a migration, a script, or
a `psql` session, none of which go through pydantic. `app.core.rules.LIMITS` is
the single declaration all three read, so they cannot drift apart.
"""

import uuid

from sqlalchemy import (
    CheckConstraint,
    ForeignKey,
    Integer,
    UniqueConstraint,
    Uuid,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.rules import BONUS_BAND_COUNT, CANCEL_PENALTY_COUNT, LIMITS
from app.db.base_class import Base
from app.db.mixins import AuditMixin, IdMixin


def _between(column: str, key: str) -> CheckConstraint:
    """`column` within `LIMITS[key]`, named after the column."""
    low, high = LIMITS[key]
    return CheckConstraint(f"{column} >= {low} AND {column} <= {high}", name=column)


def _band_list(column: str, count: int) -> CheckConstraint:
    """A JSONB array of exactly `count` entries.

    SHAPE only. The per-element bounds live in the request schema, which is the
    same split `product_models.image_urls` already makes — and here it is forced
    rather than chosen: bounding each element means walking the array with
    `jsonb_array_elements`, a set-returning function, and Postgres refuses a
    subquery inside a CHECK.

    Arity is the half worth having in SQL anyway, because it is what every
    reader assumes: `bonus_bands_paise[1]` is the chip the console opens on, and
    a list of three would make that a null nobody expects.
    """
    return CheckConstraint(
        f"jsonb_typeof({column}) = 'array' "
        f"AND jsonb_array_length({column}) = {count}",
        name=column,
    )


class CompanyRules(Base, IdMixin, AuditMixin):
    __tablename__ = "company_rules"

    company_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("companies.id", ondelete="CASCADE"), nullable=False
    )

    # ── money, in paise (hard rule 9) ────────────────────────────────────────

    #: What a cancellation costs, ordered by `core.rules.CANCEL_PENALTY_BANDS`
    #: — increasing lateness, so increasing cost. Assign a NEW list to change
    #: it; SQLAlchemy does not track JSONB mutation in place.
    cancel_penalties_paise: Mapped[list[int]] = mapped_column(
        JSONB, nullable=False, server_default=text("'[30000, 50000, 80000, 120000]'::jsonb")
    )
    #: Per technician, per CALENDAR month in IST — see `core.rules.DEFAULTS`
    #: for why that reading rather than a rolling 30 days. Zero means NO cap,
    #: which is why the "cap below the largest band" check exempts it.
    cancel_penalty_cap_paise: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text("500000")
    )
    #: The chips a manager picks from when funding a re-notification, ascending.
    #: Spent out of the pool the penalties above collect into.
    bonus_bands_paise: Mapped[list[int]] = mapped_column(
        JSONB, nullable=False, server_default=text("'[20000, 40000, 60000, 80000]'::jsonb")
    )

    # ── thresholds, as whole percents ────────────────────────────────────────

    ai_confidence_threshold: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text("70")
    )
    #: How much of the SLA window must remain before a ticket reads "Due soon".
    sla_warn_at_pct: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text("25")
    )

    # ── the clock ────────────────────────────────────────────────────────────

    slot_silence_hours: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text("6")
    )
    escalate_hours_before_slot: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text("4")
    )
    force_close_hours: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text("48")
    )
    renotify_grace_minutes: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text("30")
    )
    slot_reminder_minutes: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text("60")
    )
    #: How long before a slot the CUSTOMER is sent the technician's name and
    #: number. Independent of the reminder above — see `core.rules.DEFAULTS`.
    customer_notice_minutes: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text("60")
    )

    # ── where ────────────────────────────────────────────────────────────────

    #: Metres between the live proof photo and the ticket's own coordinates.
    #: Consulted only for a ticket that HAS coordinates — a ticket whose
    #: address was typed is verified by pincode and this number never applies
    #: to it. See `core.rules.DEFAULTS` for why a kilometre.
    geo_radius_m: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text("1000")
    )

    __table_args__ = (
        UniqueConstraint("company_id", name="uq_company_rules_company"),
        _band_list("cancel_penalties_paise", CANCEL_PENALTY_COUNT),
        _band_list("bonus_bands_paise", BONUS_BAND_COUNT),
        _between("cancel_penalty_cap_paise", "cancel_penalty_cap_paise"),
        _between("ai_confidence_threshold", "ai_confidence_threshold"),
        _between("sla_warn_at_pct", "sla_warn_at_pct"),
        _between("slot_silence_hours", "slot_silence_hours"),
        _between("escalate_hours_before_slot", "escalate_hours_before_slot"),
        _between("force_close_hours", "force_close_hours"),
        _between("renotify_grace_minutes", "renotify_grace_minutes"),
        _between("slot_reminder_minutes", "slot_reminder_minutes"),
        _between("customer_notice_minutes", "customer_notice_minutes"),
        _between("geo_radius_m", "geo_radius_m"),
        # Escalating before the customer can even be asked to confirm is a
        # contradiction: the slot has to exist before it can go unassigned.
        CheckConstraint(
            "escalate_hours_before_slot < slot_silence_hours",
            name="escalate_before_silence",
        ),
    )
