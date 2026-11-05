"""Epic 1.4 -- the extra charge on a ticket is an (amount, reason) pair."""

import uuid

import pytest
from pydantic import ValidationError

from app.features.tickets.schemas import TicketCreateRequest

BASE = dict(
    subcategoryId=str(uuid.uuid4()),
    modelId=str(uuid.uuid4()),
    serviceType="Installation + Demo",
    serialNumber="SN12345",
    customerName="Asha",
    customerPhone="+919876543210",
    address="12 MG Road",
    city="Hyderabad",
    state="Telangana",
    pincode="500001",
    expectedDate="2030-01-01",
)


def make(**extra):
    return TicketCreateRequest.model_validate({**BASE, **extra})


def test_no_extra_is_fine():
    req = make()
    assert req.extraAmountPaise is None and req.extraAmountNote is None


def test_amount_with_reason_is_fine_and_reason_is_trimmed():
    req = make(extraAmountPaise=150000, extraAmountNote="  wall bracket ")
    assert req.extraAmountPaise == 150000
    assert req.extraAmountNote == "wall bracket"


@pytest.mark.parametrize(
    "extra",
    [
        {"extraAmountPaise": 5000},
        {"extraAmountPaise": 5000, "extraAmountNote": "   "},
        {"extraAmountNote": "bracket"},
        {"extraAmountPaise": 0, "extraAmountNote": "x"},
        {"extraAmountPaise": -1, "extraAmountNote": "x"},
        {"extraAmountPaise": 10_000_001, "extraAmountNote": "x"},
    ],
)
def test_half_a_pair_or_a_silly_amount_is_refused(extra):
    with pytest.raises(ValidationError):
        make(**extra)
