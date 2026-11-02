"""Reading the India Post directory: cleaning an office name, one CSV row at a time.

Pure functions, unit-tested (`tests/unit/test_post_offices.py`); the importer
script (`app/scripts/import_post_offices.py`) and the lookup endpoint share them.

The directory spells the same suffix half a dozen ways -- `Kothimir B.O`,
`Takipur BO`, `Venkatraopet B  O`, `Hoti  B.O`, `Mumbai G.P.O.` -- and what a
person writes on an address is the bare place name, so the suffix is removed and
the office TYPE is kept as its own column.
"""

import re
from dataclasses import dataclass

from app.models.post_office import OFFICE_TYPES

#: A trailing office-type suffix in any of the spellings the file uses:
#: `B.O`, `B.O.`, `BO`, `B  O`, `S.O`, `H.O`, `G.P.O.`, `P.O`. Anchored at the end
#: and preceded by whitespace, so a place whose name merely ENDS in those letters
#: (`Goa`, `Bhopal`) is never touched.
_SUFFIX = re.compile(
    r"\s+(?:B\s*\.?\s*O|S\s*\.?\s*O|H\s*\.?\s*O|G\s*\.?\s*P\s*\.?\s*O|P\s*\.?\s*O)\s*\.?\s*$",
    re.IGNORECASE,
)
_ONLY_SUFFIX = re.compile(
    r"^(?:B\s*\.?\s*O|S\s*\.?\s*O|H\s*\.?\s*O|G\s*\.?\s*P\s*\.?\s*O|P\s*\.?\s*O)\s*\.?$",
    re.IGNORECASE,
)
_SPACES = re.compile(r"\s+")

MAX_NAME = 80


def clean_name(raw: str) -> str:
    """`'Kammergaon  B.O'` -> `'Kammergaon'`. Empty if nothing is left."""
    text = _SPACES.sub(" ", (raw or "").strip())
    if _ONLY_SUFFIX.match(text):
        return ""  # the "name" is nothing but the suffix
    text = _SUFFIX.sub("", text).strip(" .,-")
    return text[:MAX_NAME].strip()


@dataclass(frozen=True)
class Office:
    pincode: str
    name: str
    name_key: str
    office_type: str
    delivers: bool
    latitude: float | None
    longitude: float | None


def _coordinate(raw: str | None) -> float | None:
    try:
        value = float((raw or "").strip())
    except ValueError:
        return None  # "NA", blank
    return value


def parse_row(row: dict[str, str]) -> Office | None:
    """One directory row, or None if it cannot be an office we can offer.

    Rejected: a pincode that is not six digits, a name that is empty once cleaned,
    an office type outside BO / PO / HO. Coordinates are kept only when BOTH are
    present and inside India (the same box tickets and bases use) -- half a point,
    or a point in another country, is worse than none.
    """
    pincode = (row.get("pincode") or "").strip()
    if not re.fullmatch(r"[0-9]{6}", pincode):
        return None
    name = clean_name(row.get("officename") or "")
    if not name:
        return None
    office_type = (row.get("officetype") or "").strip().upper()
    if office_type not in OFFICE_TYPES:
        return None
    lat = _coordinate(row.get("latitude"))
    lng = _coordinate(row.get("longitude"))
    if lat is None or lng is None or not (6 <= lat <= 38 and 68 <= lng <= 98):
        lat = lng = None
    delivery = (row.get("delivery") or "").strip().lower()
    return Office(
        pincode=pincode,
        name=name,
        name_key=name.lower(),
        office_type=office_type,
        delivers=delivery != "non delivery",
        latitude=lat,
        longitude=lng,
    )


#: Sort rank for the dropdown: head offices first, then sub offices, then branch.
TYPE_RANK = {"HO": 0, "PO": 1, "BO": 2}
