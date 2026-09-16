"""Synthetic data for load testing and the pre-launch demo.

Everything here exists to fill an EMPTY environment with a believable company —
50 technicians, 500 tickets spread across the lifecycle — so a load test has
something to read and a demo has something to show.

The decisions behind it, including why production is in scope at all, are in
`loadtest/DECISIONS.md` at the repo root. The one that governs this package:

    Nothing is live yet. Every rule here that permits touching production is
    void the moment a real vendor, technician or customer exists.

Two guards are structural rather than advisory, and both live in `guards.py`:

1. Every synthetic phone number must be UNREACHABLE — `+911XXXXXXXXX`. Indian
   mobile numbers start 6, 7, 8 or 9, so these are valid E.164 and can never
   belong to a subscriber. It is what stops the deployed API's sweeps from
   WhatsApping 500 invented customers, and it is checked rather than trusted
   because a typo would message a real person.
2. Production is only ever written with `--production`, typed in full.
"""
