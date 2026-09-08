"""Read the customer-page tokens out of the DEVELOPMENT database.

The slot link is exposed by the API (`TicketOut.slotLink`), but the feedback
token is not — deliberately, since nothing in the console needs it. So this
reads both straight from `tickets`, prints them as JSON, and the Node capture
shells out to it.

It is READ-ONLY and it can only ever see development. `POSTGRES_DB` is forced
to the value in `api/.env` regardless of what is in the environment, because the
one thing this must never do is reach across to `RelianceProdDB` and print a
live customer's single-use token to stdout.

    api/.venv/Scripts/python.exe deck/capture/dev_tokens.py
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from urllib.parse import quote_plus

API_ROOT = Path(__file__).resolve().parents[2] / "api"


def env_from_file(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    for line in path.read_text(encoding="utf8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, raw = line.partition("=")
        values[key.strip()] = raw.strip().strip("\"'")
    return values


def main() -> int:
    env_path = API_ROOT / ".env"
    if not env_path.exists():
        print(json.dumps({"error": f"no {env_path}"}))
        return 1

    cfg = env_from_file(env_path)

    # Hard refusal rather than a warning. An environment variable outranks a
    # .env value everywhere else in this repo, which is exactly the habit that
    # would point this at production by accident.
    database = cfg.get("POSTGRES_DB", "")
    if "prod" in database.lower():
        print(json.dumps({"error": f"api/.env names {database}; refusing to read production"}))
        return 1

    url = (
        f"postgresql://{quote_plus(cfg['POSTGRES_USER'])}:"
        f"{quote_plus(cfg['POSTGRES_PASSWORD'])}@"
        f"{cfg['POSTGRES_HOST']}:{cfg.get('POSTGRES_PORT', '5432')}/{database}"
        f"?sslmode={cfg.get('POSTGRES_SSLMODE', 'require')}"
    )

    import psycopg  # noqa: PLC0415  — only needed on the happy path

    out: dict[str, object] = {"database": database}

    # `--free-technician-phones +91… +91…` soft-deletes leftover technician user
    # rows holding those numbers.
    #
    # A technician's phone is an identity: `uq_users_phone_technician` is partial
    # on `role = 'technician'`, and — like every UNIQUE on a soft-deleted table
    # here — also on `deleted_at IS NULL`. Deleting a technician removes the
    # profile but not the user, so a re-seed 409s on the first phone with nothing
    # on screen to explain it. Setting `deleted_at` is exactly what frees the
    # value, and is what the application itself does on a delete.
    #
    # Only ever called by `--reset`, only with the numbers in `fixtures.mjs`, and
    # only after this function has already refused to touch a production database.
    if "--free-technician-phones" in sys.argv:
        phones = sys.argv[sys.argv.index("--free-technician-phones") + 1:]
        if not phones:
            print(json.dumps({"error": "no phone numbers given"}))
            return 1
        with psycopg.connect(url) as conn, conn.cursor() as cur:
            cur.execute(
                """
                UPDATE users
                   SET deleted_at = NOW()
                 WHERE role = 'technician'
                   AND deleted_at IS NULL
                   AND phone = ANY(%s)
                """,
                (phones,),
            )
            freed = cur.rowcount
            conn.commit()
        print(json.dumps({"database": database, "freed": freed}))
        return 0

    # `--all` returns every live token keyed by ticket code. The seeder needs it
    # because `feedback_token` is deliberately not exposed by the API — nothing
    # in the console has any use for it — while `slotLink` is.
    if "--all" in sys.argv:
        with psycopg.connect(url) as conn, conn.cursor() as cur:
            cur.execute(
                """
                SELECT code, slot_token, feedback_token, status
                  FROM tickets
                 WHERE deleted_at IS NULL
                   AND (slot_token IS NOT NULL OR feedback_token IS NOT NULL)
                """
            )
            out["tickets"] = {
                code: {"slot": slot, "feedback": feedback, "status": status}
                for code, slot, feedback, status in cur.fetchall()
            }
        print(json.dumps(out))
        return 0

    with psycopg.connect(url) as conn, conn.cursor() as cur:
        # A slot still waiting on the customer: the page is live and unspent.
        cur.execute(
            """
            SELECT code, slot_token
              FROM tickets
             WHERE slot_token IS NOT NULL
               AND slot_confirmed_at IS NULL
               AND deleted_at IS NULL
             ORDER BY created_at DESC
             LIMIT 1
            """
        )
        row = cur.fetchone()
        out["slot"] = {"code": row[0], "token": row[1]} if row else None

        # A job the technician has finished, waiting for the customer to close it.
        cur.execute(
            """
            SELECT code, feedback_token
              FROM tickets
             WHERE feedback_token IS NOT NULL
               AND status = 'Awaiting Customer'
               AND deleted_at IS NULL
             ORDER BY created_at DESC
             LIMIT 1
            """
        )
        row = cur.fetchone()
        out["feedback"] = {"code": row[0], "token": row[1]} if row else None

    print(json.dumps(out))
    return 0


if __name__ == "__main__":
    sys.exit(main())
