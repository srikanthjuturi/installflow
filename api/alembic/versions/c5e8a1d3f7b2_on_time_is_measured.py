"""On time is measured

`technician_profiles.on_time_pct` has been in the schema since the initial
migration with nothing ever writing it, so both clients have shown `—` for every
technician. `feedback_service.refresh_technician_stats` now writes it on every
closure, and this revision fills it in for the technicians who closed jobs
before it did — otherwise they would read `—` until their next one.

No schema change. The rule, restated here rather than imported (a migration is
a snapshot and must not move when the service does) — the docstring there
argues each clause:

  * over the technician's `Closed` and `Force-Closed` tickets;
  * a ticket is MEASURED when it has a slot, its latest `assigned` event
    predates `slot_end`, and a `started` event follows the latest `assigned`,
    `slot_confirmed` or `rescheduled` one (by `seq`);
  * it is ON TIME when that start's `live` photo was captured no later than 30
    minutes after `slot_end` — `core.tickets.NO_SHOW_GRACE_MINUTES`. The capture
    time is capped at the server's `started` time, which also stands in when
    that proof set has no live row;
  * a whole percentage, half up, pinned inside 1–99 unless all or none were on
    time; NULL when nothing is measured.

Downgrade puts the column back to all-NULL, which is exactly what it held
before: nothing wrote it.

Revision ID: c5e8a1d3f7b2
Revises: b7d2c9e41f60
Create Date: 2026-09-14 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = "c5e8a1d3f7b2"
down_revision: Union[str, Sequence[str], None] = "b7d2c9e41f60"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        WITH closed AS (
            SELECT
                t.id,
                t.company_id,
                t.technician_id,
                t.slot_end,
                (
                    SELECT max(e.created_at)
                    FROM ticket_events e
                    WHERE e.company_id = t.company_id
                      AND e.ticket_id = t.id
                      AND e.kind = 'assigned'
                ) AS held_from,
                (
                    SELECT coalesce(max(e.seq), 0)
                    FROM ticket_events e
                    WHERE e.company_id = t.company_id
                      AND e.ticket_id = t.id
                      AND e.kind IN ('assigned', 'slot_confirmed', 'rescheduled')
                ) AS settled_seq
            FROM tickets t
            WHERE t.status IN ('Closed', 'Force-Closed')
              AND t.deleted_at IS NULL
              AND t.technician_id IS NOT NULL
        ),
        started AS (
            SELECT
                c.*,
                (
                    SELECT e.created_at
                    FROM ticket_events e
                    WHERE e.company_id = c.company_id
                      AND e.ticket_id = c.id
                      AND e.kind = 'started'
                      AND e.seq > c.settled_seq
                    ORDER BY e.seq
                    LIMIT 1
                ) AS started_at
            FROM closed c
        ),
        measured AS (
            SELECT
                s.company_id,
                s.technician_id,
                s.slot_end,
                least(
                    s.started_at,
                    (
                        SELECT min(p.captured_at)
                        FROM ticket_proofs p
                        WHERE p.company_id = s.company_id
                          AND p.ticket_id = s.id
                          AND p.kind = 'live'
                          AND p.created_at = s.started_at
                    )
                ) AS arrived_at
            FROM started s
            WHERE s.slot_end IS NOT NULL
              AND s.held_from < s.slot_end
              AND s.started_at IS NOT NULL
        ),
        tally AS (
            SELECT
                company_id,
                technician_id,
                count(*) AS measured,
                count(*) FILTER (
                    WHERE arrived_at <= slot_end + interval '30 minutes'
                ) AS on_time
            FROM measured
            GROUP BY company_id, technician_id
        )
        UPDATE technician_profiles tp
        SET on_time_pct = CASE
            WHEN tally.on_time = tally.measured THEN 100
            WHEN tally.on_time = 0 THEN 0
            ELSE least(
                99,
                greatest(
                    1, floor(100.0 * tally.on_time / tally.measured + 0.5)
                )
            )
        END
        FROM tally
        WHERE tp.company_id = tally.company_id
          AND tp.id = tally.technician_id
        """
    )


def downgrade() -> None:
    op.execute("UPDATE technician_profiles SET on_time_pct = NULL")
