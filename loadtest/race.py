"""First-accept-wins, tested the only way that means anything: all at once.

    .venv\\Scripts\\python race.py --host <api base url> [--rounds 5] [--contenders 20]

For each round it finds the job the MOST technicians can see, then fires one
accept per technician at the same instant (a thread barrier, not a loop). The
result must be exactly one 200 and every other request a 409. Anything else —
two winners, a 500, a timeout — is a correctness bug, and the script exits 1.

This is not a performance test and is kept out of the Locust run on purpose:
Locust's accepts land seconds apart and almost never collide, so a passing
load test says nothing about the race.

⚠ It consumes the minted sessions' refresh tokens (they rotate on use), and
writes the rotated ones back into the same file so a Locust run afterwards
still works. Each round takes one job out of the pool for good.
"""

import argparse
import datetime
import json
import os
import sys
import threading
from collections import defaultdict
from pathlib import Path

import requests

HERE = Path(__file__).resolve().parent
API = "/api/v1"


def _args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--host", required=True)
    parser.add_argument("--db", default=os.environ.get("LOAD_DB", "RelianceDB"))
    parser.add_argument("--rounds", type=int, default=5)
    parser.add_argument("--contenders", type=int, default=20)
    return parser.parse_args()


def _refresh(host: str, session: dict) -> bool:
    response = requests.post(
        f"{host}{API}/auth/refresh",
        json={"refreshToken": session["refreshToken"]},
        timeout=30,
    )
    if response.status_code != 200:
        return False
    data = response.json()["data"]
    session["accessToken"] = data["accessToken"]
    session["refreshToken"] = data["refreshToken"]
    return True


def _headers(session: dict) -> dict:
    return {"Authorization": f"Bearer {session['accessToken']}"}


def main() -> int:
    args = _args()
    host = args.host.rstrip("/")
    path = HERE / ".sessions" / f"{args.db}.json"
    bundle = json.loads(path.read_text(encoding="utf-8"))

    # One session per technician — the first of each — so a "contender" is a
    # different PERSON, which is what the race is about.
    by_code: dict[str, dict] = {}
    for session in bundle["technicians"]:
        by_code.setdefault(session["code"], session)

    print(f"refreshing {len(by_code)} technician sessions …")
    live = {code: s for code, s in by_code.items() if _refresh(host, s)}
    # Written back straight away: the old refresh tokens are already revoked.
    path.write_text(json.dumps(bundle, indent=2), encoding="utf-8")
    print(f"  {len(live)} usable")

    report: list[str] = []
    failures = 0
    taken: set[str] = set()

    for round_no in range(1, args.rounds + 1):
        seen_by: dict[str, list[str]] = defaultdict(list)
        for code, session in live.items():
            response = requests.get(
                f"{host}{API}/jobs/pool?page=1&limit=100",
                headers=_headers(session),
                timeout=30,
            )
            if response.status_code != 200:
                continue
            for job in response.json().get("data") or []:
                if job["id"] not in taken:
                    seen_by[job["id"]].append(code)

        contested = [
            (job_id, codes) for job_id, codes in seen_by.items() if len(codes) >= 2
        ]
        if not contested:
            report.append(f"round {round_no}: no job is visible to two technicians — stopped")
            break
        job_id, codes = max(contested, key=lambda item: len(item[1]))
        codes = codes[: args.contenders]
        taken.add(job_id)

        barrier = threading.Barrier(len(codes))
        results: dict[str, object] = {}

        def fire(code: str) -> None:
            barrier.wait()
            try:
                response = requests.post(
                    f"{host}{API}/jobs/{job_id}/accept",
                    headers=_headers(live[code]),
                    timeout=60,
                )
                results[code] = response.status_code
            except requests.RequestException as exc:
                results[code] = f"error: {exc}"

        threads = [threading.Thread(target=fire, args=(c,)) for c in codes]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()

        winners = [c for c, r in results.items() if r == 200]
        losers = [c for c, r in results.items() if r == 409]
        other = {c: r for c, r in results.items() if r not in (200, 409)}
        ok = len(winners) == 1 and not other
        failures += 0 if ok else 1
        report.append(
            f"round {round_no}: job {job_id}, {len(codes)} contenders → "
            f"{len(winners)} won ({', '.join(winners) or 'nobody'}), "
            f"{len(losers)} got 409"
            + (f", UNEXPECTED {other}" if other else "")
            + ("  OK" if ok else "  FAIL")
        )
        print(report[-1])

    results_dir = HERE / "results"
    results_dir.mkdir(exist_ok=True)
    stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
    out = results_dir / f"{stamp}-race.txt"
    out.write_text(
        f"host {host}\ndatabase {args.db}\n\n" + "\n".join(report) + "\n",
        encoding="utf-8",
    )
    print(f"\n{'PASS' if failures == 0 else 'FAIL'} — written to {out}")
    return 0 if failures == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
