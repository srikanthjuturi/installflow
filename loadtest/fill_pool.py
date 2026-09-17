"""Refill a seeded company's job pool through the real API, before a load run.

    .venv\\Scripts\\python fill_pool.py --host <api> [--db RelianceDB] [--tickets 300]

Why it exists: the pool drains. Every load run accepts hundreds of jobs, and the
deployed API's sweeps escalate unaccepted ones as their slots approach — the dev
pool was empty the morning after its first runs. A run against an empty pool
measures empty lists.

Tickets are raised WITHOUT a slot and with the longest service level (48 h), so
they stay offerable for two days: a slotless ticket is in the pool while its
service deadline is ahead, and no sweep escalates it before then.

It goes through `POST /tickets` as the seeded vendor, like the Locust vendor
users do, so credits are charged and every intake check runs. Mint with
`--intake-credits` first — each ticket costs credits.

Rotated refresh tokens are written back, like `race.py` and the locustfile.
"""

import argparse
import datetime
import json
import os
import random
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import requests

HERE = Path(__file__).resolve().parent
API = "/api/v1"


def _args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--host", required=True)
    parser.add_argument("--db", default=os.environ.get("LOAD_DB", "RelianceDB"))
    parser.add_argument("--tickets", type=int, default=300)
    parser.add_argument("--workers", type=int, default=5)
    return parser.parse_args()


def _body(intake: dict) -> dict:
    item = random.choice(intake["catalogue"])
    service_type = random.choice(item["serviceTypes"])
    body = {
        "subcategoryId": item["subcategoryId"],
        "modelId": item["modelId"],
        "serviceType": service_type,
        "serialNumber": f"LP{random.randrange(10**10):010d}",
        "customerName": "Load Test Customer",
        # +911… cannot reach a subscriber — see api/app/scripts/seed/guards.py.
        "customerPhone": f"+911{random.randrange(10**9):09d}",
        "address": "Flat 1, Load Test Residency",
        "city": "Hyderabad",
        "state": "Telangana",
        "pincode": random.choice(intake["pincodes"]),
        "expectedDate": (datetime.date.today() + datetime.timedelta(days=1)).isoformat(),
        "serviceLevelHours": 48,
    }
    if service_type in ("Tech Visit", "Service"):
        body["description"] = "Load test: unit needs a routine check"
    return body


def main() -> int:
    args = _args()
    host = args.host.rstrip("/")
    path = HERE / ".sessions" / f"{args.db}.json"
    bundle = json.loads(path.read_text(encoding="utf-8"))

    vendor = bundle["vendors"][0]
    response = requests.post(
        f"{host}{API}/auth/refresh",
        json={"refreshToken": vendor["refreshToken"]},
        timeout=30,
    )
    response.raise_for_status()
    data = response.json()["data"]
    vendor["accessToken"], vendor["refreshToken"] = data["accessToken"], data["refreshToken"]
    path.write_text(json.dumps(bundle, indent=2), encoding="utf-8")
    headers = {"Authorization": f"Bearer {vendor['accessToken']}"}

    def raise_one(_: int) -> int:
        try:
            r = requests.post(
                f"{host}{API}/tickets",
                json=_body(bundle["intake"]),
                headers=headers,
                timeout=60,
            )
            return r.status_code
        except requests.RequestException:
            return 0

    # A few at a time, not all at once: this is setup, not the test, and the
    # server it runs against is shared.
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        codes = list(pool.map(raise_one, range(args.tickets)))

    created = codes.count(201)
    other: dict[int, int] = {}
    for code in codes:
        if code != 201:
            other[code] = other.get(code, 0) + 1
    print(f"raised {created} of {args.tickets}" + (f"; other: {other}" if other else ""))
    # The access token lasts five minutes — long enough for a few hundred
    # tickets at this rate. A 401 in `other` means it was not.
    return 0 if created == args.tickets else 1


if __name__ == "__main__":
    sys.exit(main())
