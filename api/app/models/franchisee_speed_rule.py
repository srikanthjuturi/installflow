"""A franchisee's speed matrix — reward fast work, charge slow work (Task 11, S1).

One row per (franchisee, technician type, node) or (franchisee, technician type, model).
No soft delete: a configuration row is not a record of something that happened
(`product_node_rules`' reasoning); deleting a row restores inheritance. What a job
was actually promised lives on `tickets.accept_snapshot.speed`, never here.

The CHECK bounds copy the literals below (`SPEED_HOURS` / `SPEED_PAISE`) —
`models/company_rules.py` ↔ `core.rules.LIMITS`'s shape, so the CHECKs, the
pydantic bounds in `core.speed_rules` and the unit tests read one table. A
franchisee with no rows has speed switched OFF (W1) — there is no honest
default reward to stamp, and nothing is seeded.
"""

import uuid

from sqlalchemy import (
    CheckConstraint,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Integer,
    SmallInteger,
    String,
    Uuid,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base_class import Base
from app.db.mixins import AuditMixin, IdMixin

#: Whole hours, 1–720 (30 days) — W3.
SPEED_HOURS = (1, 720)
#: Whole rupees, ₹0–₹10,000, in paise and always a multiple of 100 — W3.
SPEED_PAISE = (0, 1_000_000)


class FranchiseeSpeedRule(Base, IdMixin, AuditMixin):
    """One cell of the speed matrix (S1)."""

    __tablename__ = "franchisee_speed_rules"

    company_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("companies.id", ondelete="CASCADE"), nullable=False
    )
    franchisee_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False)  # COMPOSITE FK below
    technician_type: Mapped[str] = mapped_column(String(16), nullable=False)
    #: Exactly one of the two targets carries the row (`one_target`).
    node_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True)
    model_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True)
    reward_within_hours: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    penalty_after_hours: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    #: PAISE, unsigned — `kind`-less here too: a reward and a penalty are two
    #: columns on one row, each a magnitude (models/ledger.py's rule).
    reward_paise: Mapped[int] = mapped_column(Integer, nullable=False)
    penalty_paise: Mapped[int] = mapped_column(Integer, nullable=False)

    __table_args__ = (
        ForeignKeyConstraint(
            ["company_id", "franchisee_id"],
            ["franchisees.company_id", "franchisees.id"],
            name="fk_franchisee_speed_rules_company_franchisee",
            ondelete="CASCADE",
        ),
        ForeignKeyConstraint(
            ["company_id", "node_id"],
            ["product_nodes.company_id", "product_nodes.id"],
            name="fk_franchisee_speed_rules_company_node",
            ondelete="CASCADE",
        ),
        ForeignKeyConstraint(
            ["company_id", "model_id"],
            ["product_models.company_id", "product_models.id"],
            name="fk_franchisee_speed_rules_company_model",
            ondelete="CASCADE",
        ),
        # Covering index for the franchisee FK AND the resolution query (§4.2).
        Index("ix_franchisee_speed_rules_company_franchisee", "company_id", "franchisee_id", "technician_type"),
        # Covering indexes for the node and model FKs — the partial uniques below
        # start with franchisee_id, so they do not cover (company_id, node_id).
        Index("ix_franchisee_speed_rules_company_node", "company_id", "node_id"),
        Index("ix_franchisee_speed_rules_company_model", "company_id", "model_id"),
        # One row per (franchisee, type, node) and per (franchisee, type, model).
        # Declared on the MODEL with its `postgresql_where` so autogenerate sees
        # it rather than proposing to drop it.
        Index(
            "uq_franchisee_speed_rules_node", "company_id", "franchisee_id", "technician_type", "node_id",
            unique=True, postgresql_where=text("node_id IS NOT NULL"),
        ),
        Index(
            "uq_franchisee_speed_rules_model", "company_id", "franchisee_id", "technician_type", "model_id",
            unique=True, postgresql_where=text("model_id IS NOT NULL"),
        ),
        # Bare names — the convention prefixes `ck_franchisee_speed_rules_`.
        CheckConstraint("technician_type IN ('employee', 'freelancer')", name="technician_type"),
        CheckConstraint("(node_id IS NULL) <> (model_id IS NULL)", name="one_target"),
        CheckConstraint("reward_within_hours BETWEEN 1 AND 720", name="reward_within_hours"),
        CheckConstraint("penalty_after_hours BETWEEN 1 AND 720", name="penalty_after_hours"),
        CheckConstraint("penalty_after_hours >= reward_within_hours", name="penalty_not_before_reward"),
        CheckConstraint("reward_paise BETWEEN 0 AND 1000000 AND reward_paise % 100 = 0", name="reward_paise"),
        CheckConstraint("penalty_paise BETWEEN 0 AND 1000000 AND penalty_paise % 100 = 0", name="penalty_paise"),
    )