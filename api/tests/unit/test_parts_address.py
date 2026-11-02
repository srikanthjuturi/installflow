"""`app.core.parts_address` -- validation and the copy taken onto a request (Epic 6)."""

from types import SimpleNamespace

import pytest
from pydantic import ValidationError

from app.core.parts_address import PartsAddressIn, delivery_out, snapshot_for


def profile(**kw):
    base = dict(
        parts_address_line=None, parts_city=None, parts_pincode=None,
        parts_landmark=None, parts_contact_phone=None, base_pincode=None,
    )
    base.update(kw)
    return SimpleNamespace(**base)


def test_body_is_trimmed_and_validated():
    body = PartsAddressIn(line="  12   MG Road ", city="Hyderabad", pincode=" 500001 ", landmark="  ")
    assert (body.line, body.pincode, body.landmark) == ("12 MG Road", "500001", None)


@pytest.mark.parametrize(
    "bad",
    [dict(pincode="50001"), dict(pincode="abcdef"), dict(line="x"), dict(city="")],
)
def test_bad_bodies_are_refused(bad):
    good = dict(line="12 MG Road", city="Hyderabad", pincode="500001")
    with pytest.raises(ValidationError):
        PartsAddressIn(**{**good, **bad})


def test_snapshot_prefers_the_parts_address_and_defaults_the_phone():
    p = profile(parts_address_line="12 MG Road", parts_city="Hyd", parts_pincode="500001")
    snap = snapshot_for(p, technician_phone="+919000000000")
    assert snap["source"] == "parts_address"
    assert snap["contactPhone"] == "+919000000000"
    p.parts_contact_phone = "+919111111111"
    assert snapshot_for(p, technician_phone="+919000000000")["contactPhone"] == "+919111111111"


def test_snapshot_falls_back_to_the_base_pincode_only():
    snap = snapshot_for(profile(base_pincode="500002"), technician_phone=None)
    assert snap == {
        "line": None, "city": None, "pincode": "500002", "landmark": None,
        "contactPhone": None, "source": "base",
    }


def test_nothing_on_file_is_none_and_junk_reads_as_none():
    assert snapshot_for(profile()) is None
    assert delivery_out(None) is None
    assert delivery_out({"pincode": 5}) is None
    assert delivery_out({"pincode": "500001", "source": "weird"}).source == "parts_address"
