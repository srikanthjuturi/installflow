"""Sending a notification to a console user's browser.

The browser half of `core.push`, and it follows every rule that module states —
read its header first, all four sections apply here. In `core` for the same
reason: several things need to reach a browser, and slices never import each
other (hard rule 4).

## This server DOES hold the signing key

The one place the two differ. Expo owns the FCM credential, so `push.py` holds
nothing worth stealing. Web push has no such intermediary: the VAPID private key
in `.env` is what proves a notification came from this server, and anyone
holding it can push to every subscription we have. It never leaves the server —
only the public half is handed to browsers.

## A push is a nudge, never the payload

Same rule as everywhere else here. A title, a line of detail and a route, which
is enough to decide whether to open the console and nothing a passer-by should
not see over somebody's shoulder. The console re-reads through the authenticated
API when it opens.

The body IS encrypted end to end — the push service routes ciphertext it cannot
read — so this does not weaken the doorbell rule the broker frames follow. What
it does mean is that a notification's text lands on a machine outside the
session, which is why signing out and switching company delete the subscription
rather than leave it. See `models/web_push_subscription.py`.

## Failure is never the caller's problem

A ticket escalates whether or not a browser was told. Every function here
swallows its errors into the log, exactly like `push._post` and `whatsapp._send`.
"""

import datetime
import json
import logging
import uuid

import anyio
from pywebpush import WebPushException, webpush
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.web_push_subscription import WebPushSubscription

log = logging.getLogger(__name__)

#: How long a push service should hold the message for a browser that is
#: offline. Four hours: these are operational events measured against a slot,
#: and one delivered the next morning is noise rather than news.
_TTL_SECONDS = 4 * 60 * 60

#: The two answers that mean "stop sending here" — permission revoked, site data
#: cleared, the browser profile gone. The web's `DeviceNotRegistered`, and the
#: only signal we ever get that a subscription died, so it is acted on rather
#: than logged.
_DEAD_STATUSES = (404, 410)


def _now() -> datetime.datetime:
    return datetime.datetime.now(datetime.timezone.utc)


def is_configured() -> bool:
    """Both halves of the VAPID pair present, and the switch on."""
    return bool(
        settings.WEB_PUSH_ENABLED
        and settings.VAPID_PRIVATE_KEY
        and settings.VAPID_PUBLIC_KEY
    )


async def register_subscription(
    db: AsyncSession,
    *,
    company_id: uuid.UUID,
    user_id: uuid.UUID,
    endpoint: str,
    p256dh: str,
    auth: str,
    user_agent: str | None,
) -> None:
    """Remember where to reach this user. Adds to the caller's transaction.

    Upserts on the ENDPOINT, not on the user: an endpoint is one browser profile
    on one machine, and if a different person signs in there the row must move
    to them rather than exist twice. Otherwise the previous user's escalations
    keep arriving on a screen somebody else is now looking at — which across two
    companies is a tenant leak.
    """
    row = await db.scalar(
        select(WebPushSubscription).where(WebPushSubscription.endpoint == endpoint)
    )
    if row is None:
        db.add(
            WebPushSubscription(
                company_id=company_id,
                user_id=user_id,
                endpoint=endpoint,
                p256dh=p256dh,
                auth=auth,
                user_agent=user_agent,
                last_seen_at=_now(),
            )
        )
        return

    row.company_id = company_id
    row.user_id = user_id
    row.p256dh = p256dh
    row.auth = auth
    row.user_agent = user_agent
    row.last_seen_at = _now()


async def forget_subscription(
    db: AsyncSession,
    *,
    company_id: uuid.UUID,
    user_id: uuid.UUID,
    endpoint: str,
) -> bool:
    """Stop pushing here — the toggle turned off, or a sign-out.

    Deleting rather than flagging, for `push.forget_device`'s reason: "do not
    send here" and "we have nowhere to send" are the same state, and a second
    way to express it is a second thing to get wrong.

    Scoped to the caller's own company AND user id, so naming somebody else's
    endpoint cannot silently switch their notifications off.
    """
    result = await db.execute(
        delete(WebPushSubscription).where(
            WebPushSubscription.company_id == company_id,
            WebPushSubscription.user_id == user_id,
            WebPushSubscription.endpoint == endpoint,
        )
    )
    return bool(result.rowcount)


async def forget_all_for_user(
    db: AsyncSession, *, company_id: uuid.UUID, user_id: uuid.UUID
) -> int:
    """Drop every subscription this user holds in this company.

    For signing out and for switching company, where the client may not be able
    to name its endpoint — a browser can lose the subscription object while
    keeping the permission. Leaving rows behind is what puts one company's text
    on the screen of somebody now working in another.
    """
    result = await db.execute(
        delete(WebPushSubscription).where(
            WebPushSubscription.company_id == company_id,
            WebPushSubscription.user_id == user_id,
        )
    )
    return int(result.rowcount or 0)


def _send_one(subscription: dict, payload: str) -> None:
    """One blocking send. Raises `WebPushException`; runs off the event loop.

    `vapid_claims` is built fresh per call and that is not tidiness: pywebpush
    MUTATES the dict it is handed, writing `aud` and `exp` into it. A shared
    dict would carry the first endpoint's audience and the first call's
    expiry to every subsequent send, and the second push service to see it
    would reject the token.
    """
    webpush(
        subscription_info=subscription,
        data=payload,
        vapid_private_key=settings.VAPID_PRIVATE_KEY,
        vapid_claims={"sub": settings.VAPID_SUBJECT},
        ttl=_TTL_SECONDS,
    )


async def send_to_users(
    db: AsyncSession,
    *,
    company_id: uuid.UUID,
    user_ids: list[uuid.UUID],
    title: str,
    body: str,
    data: dict | None = None,
) -> int:
    """Push to every browser these users have registered. Returns how many.

    Call it AFTER the transaction it describes has committed — a manager told
    about an escalation that then failed to save is worse than one told nothing.

    Both tenant keys are in the WHERE clause. A user id is a UUID and guessing
    one is not realistic, but this is the query that decides whose screen a
    customer's name appears on, and it costs nothing to make it impossible
    rather than unlikely.
    """
    if not is_configured() or not user_ids:
        return 0

    rows = list(
        await db.scalars(
            select(WebPushSubscription).where(
                WebPushSubscription.company_id == company_id,
                WebPushSubscription.user_id.in_(user_ids),
            )
        )
    )
    if not rows:
        return 0

    payload = json.dumps(
        {"title": title, "body": body, "data": data or {}},
        separators=(",", ":"),
    )

    dead: list[str] = []
    sent = 0
    for row in rows:
        subscription = {
            "endpoint": row.endpoint,
            "keys": {"p256dh": row.p256dh, "auth": row.auth},
        }
        try:
            # pywebpush is synchronous — it builds the encrypted body with
            # `cryptography` and posts it with `requests`. On the event loop
            # that would stall every other request this worker is serving,
            # and this runs while somebody is waiting for a ticket to save.
            await anyio.to_thread.run_sync(_send_one, subscription, payload)
        except WebPushException as exc:
            status = getattr(exc.response, "status_code", None)
            if status in _DEAD_STATUSES:
                dead.append(row.endpoint)
            else:
                log.warning(
                    "web push refused for %s: %s", row.endpoint[:48], status or exc
                )
        except Exception:
            # Never the caller's problem. A DNS failure or a push service
            # having a bad afternoon must not cost anybody their notification
            # row, which is already committed.
            log.exception("web push failed for %s", row.endpoint[:48])
        else:
            sent += 1

    if dead:
        # These browsers are gone. Left in place they would be retried on every
        # notification forever, and the table would only grow.
        await db.execute(
            delete(WebPushSubscription).where(
                WebPushSubscription.endpoint.in_(dead)
            )
        )
        await db.commit()
        log.info("web push: removed %d dead subscription(s)", len(dead))

    return sent
