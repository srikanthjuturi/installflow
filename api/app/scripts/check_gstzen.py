"""Check the GSTZen mapping against the recorded payloads. Spends nothing.

    python -m app.scripts.check_gstzen

Every payload below is copied from `RequirementDocs/GSTRequest.txt` — the
provider's own documented responses, which is the whole point: the mapping can
be verified, and stay verified, without a network call and without spending a
unit of a metered subscription.

Exits non-zero on any mismatch, like `app.scripts.audit_tenancy`. There is no
pytest in this project; an executable check is the house pattern.

It does NOT call GSTZen. Nothing here needs a token, a database or a server.
"""

from __future__ import annotations

import sys

from app.integrations.gstzen import map_response

GSTIN = "36AAPCR4356Q1ZF"

#: The documented success. Trimmed to the keys the mapper reads, plus a few it
#: must IGNORE (`state`, `district`, `addr`) — those are the traps.
VALID = {
    "status": 1,
    "gstin": GSTIN,
    "valid": True,
    "company_details": {
        "legal_name": "RELIANCEGREENTECH PRIVATE LIMITED",
        "trade_name": "RELIANCEGREENTECH PRIVATE LIMITED",
        "company_status": "Active",
        "pan": "AAPCR4356Q",
        "state": "36 - Telangana TS",
        "state_info": {"code": "36", "name": "Telangana", "alpha_code": "TS"},
        "registration_date": "2026-02-10",
        "cancellation_date": "",
        "gst_type": "Regular",
        "pradr": {
            "addr": (
                "SY NO 45, SAI NAGAR COLONY, BODUPPAL, Hyderabad, "
                "Medchal Malkajgiri, Telangana, 500039"
            ),
            "loc": "Hyderabad",
            "pincode": "500039",
            "street": "SAI NAGAR COLONY",
            "addr1": "SY NO 45",
            "addr2": "BODUPPAL",
            "city": "Hyderabad",
            "district": "Medchal Malkajgiri",
            "pinc": "500039",
            "building_number": "SY NO 45",
            "building_name": "",
            "floor_number": "",
            "locality": "BODUPPAL",
            "landmark": "",
            "state_in_address": "Telangana",
        },
    },
}

#: A REAL response, captured from one live call on 2026-08-31. Kept because it
#: is messier than the document's sample in four ways that each exercise a
#: decision the mapper makes, and none of which the tidy sample reaches:
#:
#:   · the legal name is a PERSON and differs from the trading name — this is a
#:     proprietorship, so "SANDEEP SONI" is who signs and "DECCANSOFT SOFTWARE
#:     SERVICES" is the brand a product model would carry
#:   · that legal name arrives with a DOUBLE SPACE
#:   · `locality` and `addr2` are both empty, so the street line has a hole in
#:     the middle of the parts it joins
#:   · `floor_number` is populated ("1"), which the tidy sample leaves blank
LIVE_GSTIN = "36AGQPS2166R1ZC"
LIVE = {
    "status": 1,
    "gstin": LIVE_GSTIN,
    "valid": True,
    "company_details": {
        "legal_name": "SANDEEP  SONI",
        "trade_name": "DECCANSOFT SOFTWARE SERVICES",
        "company_status": "Active",
        "pan": "AGQPS2166R",
        "state": "36 - Telangana TS",
        "state_info": {"code": "36", "name": "Telangana", "alpha_code": "TS"},
        "registration_date": "2017-07-01",
        "cancellation_date": "",
        "gst_type": "Regular",
        "ctb": "Proprietorship",
        "pradr": {
            "addr": (
                "No 153/A/4, 1, Sappers Lane, Balamrai, Secunderabad, "
                "Hyderabad, Telangana, 500003"
            ),
            "loc": "Secunderabad",
            "pincode": "500003",
            "street": "Sappers Lane, Balamrai",
            "addr1": "No 153/A/4, 1",
            "addr2": "",
            "city": "Secunderabad",
            "district": "Hyderabad",
            "pinc": "500003",
            "building_number": "No 153/A/4",
            "building_name": "",
            "floor_number": "1",
            "locality": "",
            "landmark": "",
            "state_in_address": "Telangana",
        },
    },
}

INVALID = {"status": 1, "gstin": "01AAFQQ9980MZQR", "valid": False}

EXHAUSTED = {
    "status": 0,
    "message": (
        "Your GSTZen GSTIN Validator Subscription has exhausted. Current usage: "
        "100000, Total Subscription Package: 10000. Please contact GSTZen support."
    ),
}

EXPIRED = {
    "status": 0,
    "message": (
        "Your GSTZen GSTIN Validator Subscription has expired. Please contact "
        "GSTZen support."
    ),
}


def main() -> int:
    failures: list[str] = []

    def check(label: str, actual: object, expected: object) -> None:
        if actual == expected:
            print(f"  ok      {label}: {actual!r}")
        else:
            failures.append(f"{label}: expected {expected!r}, got {actual!r}")
            print(f"  FAILED  {label}: expected {expected!r}, got {actual!r}")

    print("-- a registered GSTIN ----------------------------------------")
    found = map_response(GSTIN, VALID)
    check("outcome", found.outcome, "found")
    check("name", found.name, "RELIANCEGREENTECH PRIVATE LIMITED")
    # Identical to the trade name here, so it is deliberately NOT repeated.
    check("legal_name", found.legal_name, None)
    check("pan", found.pan, "AAPCR4356Q")
    check("company_status", found.company_status, "Active")
    check("cancellation_date", found.cancellation_date, None)
    # The trap: `state` is the display composite "36 - Telangana TS".
    check("state", found.state, "Telangana")
    # The other trap: `addr` also carries city, district, state and pincode.
    check("address", found.address, "SY NO 45, SAI NAGAR COLONY, BODUPPAL")
    check("city", found.city, "Hyderabad")
    check("pincode", found.pincode, "500039")
    check("subscription_issue", found.subscription_issue, False)

    print("-- a real proprietorship (captured live) ---------------------")
    live = map_response(LIVE_GSTIN, LIVE)
    check("outcome", live.outcome, "found")
    # The TRADING name is the brand a product model carries — never the
    # proprietor's own name, which is what `legal_name` holds here.
    check("name", live.name, "DECCANSOFT SOFTWARE SERVICES")
    # Sent because it differs, and with its double space collapsed.
    check("legal_name", live.legal_name, "SANDEEP SONI")
    check("pan", live.pan, "AGQPS2166R")
    # Empty `locality` leaves a hole between `street` and `landmark`; the join
    # closes it rather than emitting ", ,". The result is exactly GSTZen's own
    # `addr` minus the city, district, state and pincode we store separately.
    check("address", live.address, "No 153/A/4, 1, Sappers Lane, Balamrai")
    # `city` is Secunderabad; `district` is Hyderabad. Not the same field.
    check("city", live.city, "Secunderabad")
    check("state", live.state, "Telangana")
    check("pincode", live.pincode, "500003")

    print("-- an unregistered GSTIN -------------------------------------")
    missing = map_response("01AAFQQ9980MZQR", INVALID)
    check("outcome", missing.outcome, "not_registered")
    # A refusal about the GSTIN is never an alarm about our subscription.
    check("subscription_issue", missing.subscription_issue, False)

    print("-- our subscription is spent ---------------------------------")
    spent = map_response(GSTIN, EXHAUSTED)
    # NOT `not_registered` — the GSTIN was never judged.
    check("outcome", spent.outcome, "unavailable")
    check("subscription_issue", spent.subscription_issue, True)

    print("-- our subscription has lapsed -------------------------------")
    lapsed = map_response(GSTIN, EXPIRED)
    check("outcome", lapsed.outcome, "unavailable")
    check("subscription_issue", lapsed.subscription_issue, True)

    print("-- a malformed answer ----------------------------------------")
    # `valid: true` with nothing attached is a broken response, not evidence
    # that a real company does not exist. It must never refuse a save.
    hollow = map_response(GSTIN, {"status": 1, "valid": True, "company_details": {}})
    check("outcome", hollow.outcome, "unavailable")
    check("subscription_issue", hollow.subscription_issue, False)

    print()
    if failures:
        print(f"{len(failures)} check(s) FAILED.")
        return 1
    print("GSTZen mapping intact.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
