"""Sending a push notification to a technician's phone.

In `core` for the same reason `notifications` and `realtime` are: several slices
need to reach a phone, and slices never import each other (hard rule 4).

## This server holds no Firebase secret

Sends go to Expo's push service, which owns the FCM credential — that lives with
EAS, uploaded once, and never reaches `.env.production`. What we store is an
`ExponentPushToken[...]`, which is useless to anyone who is not Expo. Given how
easily a secret goes missing from a gitignored file, keeping one out of this
deployment is worth more than the small indirection costs.

## A push is a nudge, never the payload

The same rule the websockets follow. A notification carries a title, a line of
detail and an id — enough to decide whether to open the app, and nothing a
lock screen should not show to whoever picks the phone up. The app re-reads
through the authenticated API when it opens.

## Failure is never the caller's problem

A job is assigned whether or not the phone was told. Every function here
swallows its errors and reports them to the log, exactly like `whatsapp._send`:
a technician who misses a notification finds the job in their list; a
transaction rolled back because Expo was slow loses the job entirely.
"""

import datetime
import logging
import uuid

import httpx
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.coverage import technicians_covering
from app.models.product import ProductNode
from app.models.push_token import PushToken

log = logging.getLogger(__name__)

EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send"

#: Expo accepts up to 100 messages per request and recommends batching.
_BATCH = 100

#: The one receipt that means "stop sending here". An uninstalled app or a
#: rotated token reports this, and it is the ONLY signal we ever get that a
#: device is gone — so it is acted on rather than logged.
_DEAD = "DeviceNotRegistered"


def _now() -> datetime.datetime:
    return datetime.datetime.now(datetime.timezone.utc)


async def register_device(
    db: AsyncSession,
    *,
    company_id: uuid.UUID,
    technician_id: uuid.UUID,
    token: str,
    platform: str,
    device_name: str | None,
) -> None:
    """Remember where to reach this technician. Adds to the caller's transaction.

    Upserts on the TOKEN, not on the technician: a token is one installation on
    one device, and if a different technician signs in on that handset the row
    must move to them rather than exist twice. Otherwise the previous user's
    push keeps arriving on a phone somebody else is now holding — which across
    two companies is a tenant leak onto a lock screen.
    """
    row = await db.scalar(select(PushToken).where(PushToken.token == token))
    if row is None:
        db.add(
            PushToken(
                company_id=company_id,
                technician_id=technician_id,
                token=token,
                platform=platform,
                device_name=device_name,
                last_seen_at=_now(),
            )
        )
        return

    row.company_id = company_id
    row.technician_id = technician_id
    row.platform = platform
    row.device_name = device_name
    row.last_seen_at = _now()


async def forget_device(
    db: AsyncSession,
    *,
    company_id: uuid.UUID,
    technician_id: uuid.UUID,
    token: str,
) -> bool:
    """Stop pushing to this device. Adds to the caller's transaction.

    Deleting the row rather than flagging it: "do not send here" and "we have
    nowhere to send" are the same state, and a second way to express it is a
    second thing to get wrong. Turning the setting back on re-registers, which
    is a fresh token anyway.

    Scoped to the caller's own company AND technician id, so a token belonging
    to somebody else cannot be removed by naming it — the one thing an
    unscoped delete here would allow is silently switching another
    technician's notifications off.
    """
    result = await db.execute(
        delete(PushToken).where(
            PushToken.company_id == company_id,
            PushToken.technician_id == technician_id,
            PushToken.token == token,
        )
    )
    return bool(result.rowcount)


async def send_to_technician(
    db: AsyncSession,
    *,
    company_id: uuid.UUID,
    technician_id: uuid.UUID,
    title: str,
    body: str,
    data: dict | None = None,
) -> int:
    """Push to every device one technician has registered. Returns how many."""
    return await send_to_technicians(
        db,
        company_id=company_id,
        technician_ids=[technician_id],
        title=title,
        body=body,
        data=data,
    )


async def send_to_technicians(
    db: AsyncSession,
    *,
    company_id: uuid.UUID,
    technician_ids: list[uuid.UUID],
    title: str,
    body: str,
    data: dict | None = None,
) -> int:
    """Push to every device these technicians have registered. Returns how many.

    Call it AFTER the transaction it describes has committed — a phone told
    about a job that then failed to save is worse than a phone told nothing.

    Plural is the primary form because the primary case is plural: a job
    entering the pool concerns everyone who covers that pincode, and asking for
    their tokens one technician at a time would be a query per person and a
    round trip to Expo per person, on the one path that runs while somebody is
    waiting for a ticket to save.

    Both tenant keys are in the WHERE clause. A technician id is a UUID and
    guessing one is not realistic, but this is the query that decides whose
    lock screen a customer's address appears on, and it costs nothing to make
    it impossible rather than unlikely.
    """
    if not settings.PUSH_ENABLED or not technician_ids:
        return 0

    tokens = list(
        await db.scalars(
            select(PushToken.token).where(
                PushToken.company_id == company_id,
                PushToken.technician_id.in_(technician_ids),
            )
        )
    )
    if not tokens:
        return 0

    messages = [
        {
            "to": token,
            "title": title,
            "body": body,
            "data": data or {},
            # Android needs a channel or the notification is silent on 8+.
            "channelId": "default",
            "sound": "default",
            "priority": "high",
        }
        for token in tokens
    ]

    dead: list[str] = []
    sent = 0
    for start in range(0, len(messages), _BATCH):
        batch = messages[start : start + _BATCH]
        tickets = await _post(batch)
        if tickets is None:
            continue
        for message, ticket in zip(batch, tickets):
            if ticket.get("status") == "ok":
                sent += 1
                continue
            detail = (ticket.get("details") or {}).get("error")
            if detail == _DEAD:
                dead.append(str(message["to"]))
            else:
                log.warning("push refused for %s: %s", message["to"][:24], ticket)

    if dead:
        # The app is gone from these devices. Left in place they would be
        # retried on every notification forever, and the table would only grow.
        await db.execute(delete(PushToken).where(PushToken.token.in_(dead)))
        await db.commit()
        log.info("push: removed %d dead token(s)", len(dead))

    return sent


async def _post(messages: list[dict]) -> list[dict] | None:
    """One batch to Expo. None when the call itself failed."""
    headers = {"accept": "application/json", "content-type": "application/json"}
    if settings.EXPO_ACCESS_TOKEN:
        # Optional, and worth setting: with it, Expo refuses sends that do not
        # carry it, so a token scraped from a device cannot be used to push
        # arbitrary notifications to this app's users.
        headers["Authorization"] = f"Bearer {settings.EXPO_ACCESS_TOKEN}"

    verify = settings.HTTP_CA_BUNDLE or True
    try:
        async with httpx.AsyncClient(timeout=20, verify=verify) as client:
            response = await client.post(EXPO_PUSH_URL, json=messages, headers=headers)
    except httpx.HTTPError as exc:
        log.warning("push: could not reach Expo: %s", exc)
        return None

    try:
        body = response.json()
    except ValueError:
        log.warning("push: Expo returned %s with no JSON", response.status_code)
        return None

    if response.status_code >= 400 or "errors" in body:
        log.warning("push: Expo rejected the batch: %s", str(body)[:300])
        return None

    data = body.get("data")
    return data if isinstance(data, list) else None


async def announce_pool_job(
    db: AsyncSession,
    *,
    company_id: uuid.UUID,
    ticket_id: uuid.UUID,
    code: str,
    pincode: str,
    city: str,
    node_path_ids: list[uuid.UUID],
    payout_paise: int | None = None,
    slot_start: datetime.datetime | None = None,
) -> int:
    """A job entered the pool — tell the phones that could take it.

    This is the reason push exists in this app. Assignment is first-accept-wins,
    so a technician who only learns about a job when they next open the app has
    already lost it to somebody whose app was open. The websocket covers the
    open app; this covers the other twenty-three hours.

    Call it AFTER the commit. Not from the accept path either — that removes a
    job from the pool, and announcing one somebody has just taken is the exact
    notification that teaches people to ignore notifications.

    Audience is `technicians_covering`, which is `pool_query` read backwards: it
    excludes anyone offline, suspended, or already full for that day.
    """
    if not settings.PUSH_ENABLED:
        return 0

    # `slot_start` carries the DAILY CAP into the audience. Without it a
    # technician whose day is already full would be pushed about a job the pool
    # will not show them and `accept` will refuse — the exact notification that
    # teaches people to stop reading notifications.
    #
    # NULL is not "any day" and must not be read as one: a job with no agreed
    # time spends no day, so there is no day to be full of. `technicians_covering`
    # skips the cap term entirely for it, which matches `has_cap_room` — and
    # what stops a technician hoarding such jobs is the free-window guard in
    # `jobs.accept`, not this.
    technician_ids = await technicians_covering(
        db,
        company_id=company_id,
        pincode=pincode,
        node_path_ids=node_path_ids,
        slot_start=slot_start,
    )
    if not technician_ids:
        return 0

    # One indexed lookup for the name. A notification saying only "a job" is one
    # a technician has to open the app to evaluate, which is most of what the
    # notification was for.
    # The LEAF of the path — the most specific thing this job is about, which
    # is what a technician reading a lock screen wants. `node_path_ids` is
    # root-first, so the last entry is the node the ticket actually names.
    what = await db.scalar(
        select(ProductNode.name).where(ProductNode.id == node_path_ids[-1])
    ) if node_path_ids else None

    # The money leads. A lock screen is where the decision gets made — first
    # accept wins, so whoever has to open the app to find out what a job pays
    # has usually already lost it — and rupees are the one fact that decides
    # whether opening it is worth doing.
    #
    # Whole rupees, no paise: this is a glance, not an invoice.
    parts = [p for p in (
        f"₹{payout_paise // 100:,}" if payout_paise else None,
        what,
        f"{city} {pincode}",
    ) if p]

    return await send_to_technicians(
        db,
        company_id=company_id,
        technician_ids=technician_ids,
        # Singular of the prototype's Home banner, "{n} new jobs in your area".
        title="New job in your area",
        body=" · ".join(parts),
        # Routing only. The app re-reads the offer through the authenticated
        # API — a lock screen is not the place for a customer's details, and
        # until the technician accepts they are not entitled to them anyway.
        data={"type": "pool", "ticketId": str(ticket_id), "code": code},
    )
