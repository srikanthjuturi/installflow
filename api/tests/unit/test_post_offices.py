"""`app.core.post_offices` -- cleaning the India Post directory's office names (Epic 7)."""

import pytest

from app.core.post_offices import clean_name, parse_row


@pytest.mark.parametrize(
    "raw, expected",
    [
        ("Kothimir B.O", "Kothimir"),
        ("Takipur BO", "Takipur"),
        ("Kammergaon  B.O", "Kammergaon"),
        ("Venkatraopet B  O", "Venkatraopet"),
        ("Hyderabad G.P.O.", "Hyderabad"),
        ("Banjara Hills S.O", "Banjara Hills"),
        ("Nuapada B.O.", "Nuapada"),
        ("Secunderabad H.O", "Secunderabad"),
        # a name that merely ENDS in those letters is a place, not a suffix
        ("Goa", "Goa"),
        ("Bhopal", "Bhopal"),
        ("Cuddapah Po", "Cuddapah"),  # a trailing, space-separated "Po" IS the suffix
        ("  Rampur   Khurd  ", "Rampur Khurd"),
        ("", ""),
    ],
)
def test_clean_name(raw, expected):
    assert clean_name(raw) == expected


def row(**kw):
    base = {
        "officename": "Kothimir B.O", "pincode": "504273", "officetype": "BO",
        "delivery": "Delivery", "latitude": "19.36", "longitude": "79.53",
    }
    base.update(kw)
    return base


def test_a_good_row():
    o = parse_row(row())
    assert (o.pincode, o.name, o.name_key, o.office_type, o.delivers) == (
        "504273", "Kothimir", "kothimir", "BO", True,
    )
    assert (o.latitude, o.longitude) == (19.36, 79.53)


def test_non_delivery_and_missing_coordinates():
    o = parse_row(row(delivery="Non Delivery", latitude="NA", longitude="NA"))
    assert o.delivers is False
    assert o.latitude is None and o.longitude is None


def test_half_a_point_or_a_point_abroad_is_dropped():
    assert parse_row(row(longitude="NA")).latitude is None
    assert parse_row(row(latitude="51.5", longitude="-0.1")).latitude is None


@pytest.mark.parametrize(
    "bad",
    [dict(pincode="5042"), dict(pincode="abcdef"), dict(officename=" B.O"),
     dict(officename=""), dict(officetype="XX")],
)
def test_unusable_rows_are_rejected(bad):
    assert parse_row(row(**bad)) is None
