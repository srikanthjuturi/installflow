"""The Rules configuration contract.

## Rupees on the wire, paise in the database

The one place in this slice worth stating twice. Hard rule 9 keeps money as
integer paise in storage; this API speaks RUPEES, because every figure on the
screen the contract exists for is a rupee figure, and a console that had to
divide by a hundred in six places would eventually forget one.

The conversion happens in `service.py`, at the single boundary, and both
directions are whole-rupee: `PUT` takes integers, so nothing can arrive with a
fraction of a paisa to round.

`tickets.bonusPaise` stays paise and is deliberately NOT changed to match. That
field is an amount already spent on a specific job — a fact — and it is read
straight off the ticket by two clients. These are configuration.
"""

import uuid
from typing import Annotated

from pydantic import Field, model_validator

from app.core.rules import (
    BONUS_BAND_COUNT,
    CANCEL_PENALTY_BANDS,
    CANCEL_PENALTY_COUNT,
    LIMITS,
)
from app.core.schemas import AppModel


def _rupee_bounds(key: str) -> tuple[int, int]:
    """`LIMITS[key]`, which is paise, expressed in whole rupees."""
    low, high = LIMITS[key]
    return low // 100, high // 100


_PENALTY_MIN, _PENALTY_MAX = _rupee_bounds("cancel_penalty_paise")
_CAP_MIN, _CAP_MAX = _rupee_bounds("cancel_penalty_cap_paise")
_BONUS_MIN, _BONUS_MAX = _rupee_bounds("bonus_band_paise")

#: A whole-rupee penalty. `ge=0` because a company may genuinely decide a band
#: costs nothing; the bonus below cannot, for the reason its own comment gives.
PenaltyRupees = Annotated[int, Field(ge=_PENALTY_MIN, le=_PENALTY_MAX)]
BonusRupees = Annotated[int, Field(ge=max(1, _BONUS_MIN), le=_BONUS_MAX)]
CapRupees = Annotated[int, Field(ge=_CAP_MIN, le=_CAP_MAX)]


def _bounded(key: str):
    """An `int` constrained to `LIMITS[key]`, for use as an annotation.

    Called at class-body time, so pydantic sees a real `Annotated` rather than a
    string. Seven fields read their bounds this way instead of spelling them,
    which is what keeps the request schema, the CHECK constraints and the
    console's form quoting one set of numbers.
    """
    low, high = LIMITS[key]
    return Annotated[int, Field(ge=low, le=high)]


class PenaltyBandOut(AppModel):
    """One cancellation band: what it is called, and what it costs.

    The label is served rather than stored — the boundaries are domain, so
    `core.rules.CANCEL_PENALTY_BANDS` owns them and no company can rename "less
    than two hours before the slot" into something it is not.
    """

    band: str
    amount: int


class RulesOut(AppModel):
    penalty: list[PenaltyBandOut]
    penaltyCap: int
    bonusAmounts: list[int]
    aiThreshold: int
    #: The slider's own range. Served rather than hardcoded in the console so
    #: the bound is stated once, here, where the CHECK constraint also reads it.
    aiThresholdMin: int
    aiThresholdMax: int
    slaWarnAtPct: int
    slotConfirmTimeoutHours: int
    escalationTriggerHours: int
    customerWaitHours: int
    renotifyGraceMinutes: int
    slotReminderMinutes: int
    customerNoticeMinutes: int
    #: Metres. How far from the ticket's own coordinates the live proof photo
    #: may be taken — for a ticket that HAS coordinates. One whose address was
    #: typed is verified by pincode and this number never applies to it.
    geoRadiusM: int


class RulesUpdateRequest(AppModel):
    """A whole replacement, not a patch.

    Every field is required on purpose. The screen submits the complete form and
    two of these rules constrain each other, so a partial body would mean
    validating a new escalation window against a slot timeout that might itself
    be changing in the same request — and answering "which one wins" for every
    pair. One shape in, one shape out.
    """

    penalty: Annotated[
        list[PenaltyRupees],
        Field(min_length=CANCEL_PENALTY_COUNT, max_length=CANCEL_PENALTY_COUNT),
    ]
    penaltyCap: CapRupees
    bonusAmounts: Annotated[
        list[BonusRupees],
        Field(min_length=BONUS_BAND_COUNT, max_length=BONUS_BAND_COUNT),
    ]
    aiThreshold: _bounded("ai_confidence_threshold")
    slaWarnAtPct: _bounded("sla_warn_at_pct")
    slotConfirmTimeoutHours: _bounded("slot_silence_hours")
    escalationTriggerHours: _bounded("escalate_hours_before_slot")
    customerWaitHours: _bounded("force_close_hours")
    renotifyGraceMinutes: _bounded("renotify_grace_minutes")
    slotReminderMinutes: _bounded("slot_reminder_minutes")
    customerNoticeMinutes: _bounded("customer_notice_minutes")
    geoRadiusM: _bounded("geo_radius_m")

    @model_validator(mode="after")
    def _check(self) -> "RulesUpdateRequest":
        # A band that charges less the later somebody cancels inverts the whole
        # incentive: the penalty exists because a late cancellation costs more.
        # `<` rather than `<=` — two bands charging the same is unusual, not
        # broken, and a company may deliberately flatten two of them.
        for i in range(1, len(self.penalty)):
            if self.penalty[i] < self.penalty[i - 1]:
                raise ValueError(
                    f"{CANCEL_PENALTY_BANDS[i]} cannot cost less than "
                    f"{CANCEL_PENALTY_BANDS[i - 1]} — a later cancellation is "
                    "the more expensive one."
                )

        # A cap below the largest single penalty can never bind, so it is not a
        # cap; it is a number that looks like one. Zero is exempt: it is how
        # "no cap" is spelled.
        worst = max(self.penalty)
        if 0 < self.penaltyCap < worst:
            raise ValueError(
                f"A cap of ₹{self.penaltyCap:,} is below the largest single "
                f"penalty (₹{worst:,}), so it could never apply. Use 0 for no cap."
            )

        # The chips are a row of increasing offers. Equal or falling neighbours
        # would draw two identical buttons, or one that reads as a downgrade —
        # stricter than the penalty rule above, because this one IS broken.
        for i in range(1, len(self.bonusAmounts)):
            if self.bonusAmounts[i] <= self.bonusAmounts[i - 1]:
                raise ValueError(
                    "Each bonus band must be more than the one before it."
                )

        # Escalating before the customer can even be asked to confirm is a
        # contradiction — the slot has to exist before it can go unassigned.
        # Also a CHECK on the table, which catches every writer that is not
        # this schema.
        if self.escalationTriggerHours >= self.slotConfirmTimeoutHours:
            raise ValueError(
                "The escalation trigger must be shorter than the slot-confirm "
                "timeout, or a ticket would escalate before anybody could have "
                "chosen a time."
            )
        return self


# ── per-category overrides ────────────────────────────────────────────────────
#
# Everything below scopes the same rules to one catalogue node. Two differences
# from the company shape above, and both follow from "null means inherit":
#
#   * every field is optional, and
#   * NONE of the cross-field checks live here.
#
# The second is the important one. A node overriding `slotConfirmTimeoutHours`
# alone can invert an escalation window it never mentioned, so the invariants
# have to be tested against the RESOLVED set — which this schema cannot see. The
# service does it, for the node and for every other node carrying an override,
# through `core.rules.validate_resolved`.
#
# `penaltyCap` is absent on purpose: a monthly cap bounds a technician across
# every job they took, so it cannot be a property of one product. See
# `core.rules.NODE_OVERRIDABLE_KEYS`.


def _optional(key: str):
    """`_bounded`, but nullable — an omitted override is not an invalid one."""
    low, high = LIMITS[key]
    return Annotated[int | None, Field(default=None, ge=low, le=high)]


class NodeRuleValues(AppModel):
    """One node's own overrides, in rupees. Null anywhere means "inherit"."""

    #: All four bands or none — a list is overridden whole, because inheriting
    #: the first two and overriding the third would make
    #: `cancel_penalties_paise[2]` mean different things at different depths.
    penalty: Annotated[
        list[PenaltyRupees] | None,
        Field(
            default=None,
            min_length=CANCEL_PENALTY_COUNT,
            max_length=CANCEL_PENALTY_COUNT,
        ),
    ] = None
    bonusAmounts: Annotated[
        list[BonusRupees] | None,
        Field(default=None, min_length=BONUS_BAND_COUNT, max_length=BONUS_BAND_COUNT),
    ] = None
    aiThreshold: _optional("ai_confidence_threshold")
    slaWarnAtPct: _optional("sla_warn_at_pct")
    slotConfirmTimeoutHours: _optional("slot_silence_hours")
    escalationTriggerHours: _optional("escalate_hours_before_slot")
    customerWaitHours: _optional("force_close_hours")
    renotifyGraceMinutes: _optional("renotify_grace_minutes")
    slotReminderMinutes: _optional("slot_reminder_minutes")
    customerNoticeMinutes: _optional("customer_notice_minutes")
    geoRadiusM: _optional("geo_radius_m")


class NodeRulesUpdateRequest(NodeRuleValues):
    """A whole replacement of this node's overrides, not a patch.

    Same reasoning as the company shape: the screen submits the complete form,
    so an absent field means "this node does not override it" rather than
    "leave whatever was there". Clearing every field is how the console's
    *Reset to inherited* is spelled, and it deletes the row.
    """


class NodeRulesOut(AppModel):
    nodeId: uuid.UUID
    #: Root first, including the node itself — what the scope selector prints.
    path: list[str]
    #: What this node itself sets. Every null is a field it inherits.
    own: NodeRuleValues
    #: What a ticket raised on this node would actually be stamped with.
    effective: RulesOut
    #: Per field, the node that supplied the effective value — absent when it
    #: came from the company baseline. Keyed by the wire names above, so the
    #: console can print "from TV" beside the box without matching anything up.
    inheritedFrom: dict[str, str] = {}
