/**
 * The floor under the live socket.
 *
 * `useTicketStream` is what makes the console feel instant: a ticket moves and
 * the row changes without anybody asking. This file is what makes it *correct*,
 * and the two are not the same guarantee.
 *
 * A websocket that has silently died looks exactly like a quiet afternoon. A
 * proxy can drop an idle connection, a laptop can sleep through a reconnect, a
 * worker's `LISTEN` can fall over and come back empty — and in every one of
 * those the console believes it is live and sits on a stale board. The socket
 * cannot detect its own silence; only asking can.
 *
 * The mobile app already reasoned this out for the pool (see
 * `POOL_BACKSTOP_POLL_MS` in `mobileapp/src/features/jobs/hooks/useJobs.ts`).
 * The console had no equivalent and trusted its socket completely.
 *
 * ## Why two minutes
 *
 * It is the answer to "how long may a manager be wrong if the stream lies to
 * us", not a tuning parameter. Fast enough that nobody works from a stale board
 * for long; slow enough that a dozen open consoles cost a dozen indexed queries
 * a minute, which is nothing against the queries the same screens make when
 * somebody simply clicks around.
 *
 * Deliberately NOT the mechanism. If this number starts mattering — if the
 * board feels slow when it is lowered — that is the socket failing, and the
 * socket is what to fix.
 */
export const BACKSTOP_REFETCH_MS = 120_000;

/**
 * Presence needs this more than anything else on the console.
 *
 * `TechnicianChanged` (`api/app/core/realtime.py`) publishes a technician's own
 * DECISION — the accepting-work toggle, the daily cap — and deliberately not
 * their reachability: `last_seen_at` is stamped on every socket ping, so
 * publishing it would be one frame per technician per thirty seconds to say
 * nothing anybody asked about. Its docstring settles the trade by saying
 * reachability "decays on a TTL and the console picks it up on its normal
 * refetch".
 *
 * There was no normal refetch. The availability pill went stale the moment the
 * page loaded and stayed that way, which is the exact failure the realtime work
 * was done to prevent — a manager handing a job to somebody whose phone went
 * quiet ten minutes ago.
 */
export const PRESENCE_REFETCH_MS = 60_000;

/**
 * The escalation queue, which is the one screen that has to keep moving on its
 * own.
 *
 * Every row prints how long is left before a slot the customer was promised,
 * and that number is now computed in the browser from the ticket's `slotStart`
 * — the mock sent a pre-formatted `"2h 40m"`, which was a server's opinion
 * about the reader's clock and already wrong by the time it arrived.
 *
 * A value derived at paint time only changes when something repaints, so
 * without this the countdowns freeze at whatever they said when the tab was
 * opened. Refetching is the repaint: one cheap query a minute also brings any
 * newly escalated row and drops any a colleague has just dealt with, so the
 * clock and the contents stay honest through the same mechanism rather than
 * two that could disagree.
 *
 * A minute, not a second. Nothing here is precise to the second, and a ticking
 * clock on a queue of overdue promises is agitation rather than information.
 */
export const ESCALATION_REFETCH_MS = 60_000;
