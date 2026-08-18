"""Indian statutory identifiers and postal fields, as reusable Pydantic types.

These started life inside the companies slice. Vendors need the same GSTIN and
the same address shape, and hard rule 4 forbids one slice importing another's
schemas — so they live here, where both can reach them.

Every type NORMALISES before it validates. A GSTIN pasted as " 29aaaaa0000a1z5 "
is the same GSTIN as "29AAAAA0000A1Z5", and a pattern that rejected it would be
punishing the clipboard rather than the data.
"""

from typing import Annotated

from pydantic import BeforeValidator, Field


def _upper(v: object) -> object:
    return v.strip().upper() if isinstance(v, str) else v


def _strip(v: object) -> object:
    return v.strip() if isinstance(v, str) else v


#: 15 chars: 2-digit state code, 10-char PAN, entity number, 'Z', checksum.
GstNumber = Annotated[
    str,
    BeforeValidator(_upper),
    Field(pattern=r"^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$"),
]

Pan = Annotated[str, BeforeValidator(_upper), Field(pattern=r"^[A-Z]{5}[0-9]{4}[A-Z]$")]

#: 21 chars: listed/unlisted flag, 5-digit industry code, 2-letter state,
#: 4-digit year of incorporation, 3-letter company class, 6-digit registration
#: number. e.g. U72200KA2010PTC054285.
#:
#: Only a company registered with the MCA has one — a proprietorship or a
#: partnership does not — so wherever this is used the field is optional.
Cin = Annotated[
    str,
    BeforeValidator(_upper),
    Field(pattern=r"^[LU][0-9]{5}[A-Z]{2}[0-9]{4}[A-Z]{3}[0-9]{6}$"),
]

Pincode = Annotated[str, BeforeValidator(_strip), Field(pattern=r"^[0-9]{6}$")]
GstStatus = Annotated[str, BeforeValidator(_strip), Field(min_length=1, max_length=64)]

#: A whole street address in one box. `companies` splits line 1 / line 2 because
#: its form does; the vendor form is a single textarea, so it gets one field with
#: room for the newlines that come with pasting an address off a letterhead.
Address = Annotated[str, BeforeValidator(_strip), Field(min_length=1, max_length=500)]

AddrLine = Annotated[str, BeforeValidator(_strip), Field(min_length=1, max_length=255)]
AddrLineOpt = Annotated[str, BeforeValidator(_strip), Field(max_length=255)]
CityState = Annotated[str, BeforeValidator(_strip), Field(min_length=1, max_length=120)]
