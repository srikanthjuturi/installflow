"""Sample the shared Postgres server's connections during a load run.

    cd api
    .venv\\Scripts\\python ..\\loadtest\\db_sampler.py --run <run-id> --minutes 16

Runs with the API's virtualenv (it uses the API's own engine and settings) and
writes `loadtest/results/<run>-db.csv`: every 15 s, how many connections each
database holds, and the server's total against its limit.

It exists because the dev rehearsal's first real finding (DECISIONS.md, F1) was
the server running out of connection slots — which the load generator can only
see indirectly, as 500s. This watches the cause instead of the symptom.

It holds ONE connection for the whole run, opened before the load starts, so it
cannot itself be the connection that is refused when the server fills up.
"""

import argparse
import asyncio
import csv
import datetime
import sys
from pathlib import Path

if sys.platform == "win32":  # noqa: E402
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

import sqlalchemy as sa  # noqa: E402

from app.core.database import engine  # noqa: E402

RESULTS = Path(__file__).resolve().parent / "results"

SAMPLE = """
select
  count(*) as total,
  count(*) filter (where datname = 'RelianceDB') as dev,
  count(*) filter (where datname = 'RelianceDB' and state = 'active') as dev_active,
  count(*) filter (where datname = 'RelianceProdDB') as prod,
  count(*) filter (where datname not in ('RelianceDB', 'RelianceProdDB')
                     and usename = 'appuser') as other_teams,
  current_setting('max_connections')::int as max_connections,
  current_setting('superuser_reserved_connections')::int as reserved
from pg_stat_activity
"""


async def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--run", required=True)
    parser.add_argument("--minutes", type=float, default=16)
    parser.add_argument("--every", type=float, default=15)
    parser.add_argument(
        "--stop-below",
        type=int,
        default=0,
        help="Ask the Locust run to stop once usable slots stay below this for "
        "two samples — the server is shared with other teams' apps.",
    )
    args = parser.parse_args()
    low_samples = 0

    RESULTS.mkdir(exist_ok=True)
    out = RESULTS / f"{args.run}-db.csv"
    ends = datetime.datetime.now() + datetime.timedelta(minutes=args.minutes)
    with out.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.writer(handle)
        writer.writerow(
            ["utc", "total", "dev", "dev_active", "prod", "other_teams",
             "usable_left", "note"]
        )
        conn = None
        while datetime.datetime.now() < ends:
            now = datetime.datetime.now(datetime.timezone.utc).strftime("%H:%M:%S")
            try:
                if conn is None:
                    conn = await engine.connect()
                row = (await conn.execute(sa.text(SAMPLE))).one()
                await conn.rollback()  # never sit idle-in-transaction
                usable_left = row.max_connections - row.reserved - (
                    row.dev + row.prod + row.other_teams
                )
                writer.writerow(
                    [now, row.total, row.dev, row.dev_active, row.prod,
                     row.other_teams, usable_left, ""]
                )
                low_samples = low_samples + 1 if usable_left < args.stop_below else 0
                if low_samples >= 2:
                    # The locustfile's guard polls for this file.
                    (RESULTS / f"{args.run}-dbstop.txt").write_text(
                        f"{now} UTC: {usable_left} usable connection slots left "
                        f"(floor {args.stop_below}) for two samples\n",
                        encoding="utf-8",
                    )
            except sa.exc.DBAPIError as exc:
                # Rehearsal 4 lost this connection in the same second the load
                # generator lost the API — the laptop's link, not the server.
                # A gap in the samples is a finding; dying would hide the rest.
                writer.writerow([now, "", "", "", "", "", "", f"lost: {exc.orig}"[:120]])
                if conn is not None:
                    try:
                        await conn.close()
                    except Exception:
                        pass
                conn = None
            handle.flush()
            await asyncio.sleep(args.every)
        if conn is not None:
            await conn.close()
    print(f"written {out}")


if __name__ == "__main__":
    asyncio.run(main())
