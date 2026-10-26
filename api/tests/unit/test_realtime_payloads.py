"""Task 04 §6, cases 26–29 — the pool and ticket frames still travel whole.

The channel is `pg_notify` with a JSON text payload, so every new field has two
rules to obey: it must ride through `as_payload`/`from_payload` intact, and a
payload written by a publisher that predates it — deployed workers overlap for
the length of a rollout — must still parse. A payload that does not parse at all
is discarded with a warning, never raised into the reader's socket loop.
"""

import json
import uuid

from app.core.realtime import PoolChanged, TicketChanged

_COMPANY = uuid.uuid4()
_TICKET = uuid.uuid4()
_FRANCHISEE = uuid.uuid4()
_TW = uuid.uuid4()
_VENDOR = uuid.uuid4()
_RAISED_BY = uuid.uuid4()


def test_pool_changed_round_trips_with_the_franchisee() -> None:
    frame = PoolChanged(
        company_id=_COMPANY,
        pincode="500032",
        node_path_ids=(_TW,),
        franchisee_id=_FRANCHISEE,
    )
    parsed = PoolChanged.from_payload(json.loads(frame.as_payload()))
    assert parsed == frame


def test_pool_changed_without_a_franchisee_still_parses() -> None:
    # A frame published by an older worker mid-deploy: no "franchisee_id" key
    # at all, not a null one.
    raw = {
        "kind": "pool.changed",
        "company_id": str(_COMPANY),
        "pincode": "500032",
        "node_path_ids": [str(_TW)],
    }
    parsed = PoolChanged.from_payload(raw)
    assert parsed is not None
    assert parsed.franchisee_id is None
    assert parsed.pincode == "500032"


def test_ticket_changed_round_trips_both_ways() -> None:
    stamped = TicketChanged(
        company_id=_COMPANY,
        ticket_id=_TICKET,
        pincode="500032",
        vendor_id=_VENDOR,
        created_by=_RAISED_BY,
        franchisee_id=_FRANCHISEE,
    )
    assert TicketChanged.from_payload(json.loads(stamped.as_payload())) == stamped

    bare = TicketChanged(
        company_id=_COMPANY,
        ticket_id=_TICKET,
        pincode="500032",
        vendor_id=_VENDOR,
        created_by=None,
        franchisee_id=None,
    )
    parsed = TicketChanged.from_payload(json.loads(bare.as_payload()))
    assert parsed == bare
    assert parsed is not None and parsed.franchisee_id is None


def test_a_corrupt_franchisee_id_discards_the_whole_frame() -> None:
    raw = {
        "kind": "ticket.changed",
        "company_id": str(_COMPANY),
        "ticket_id": str(_TICKET),
        "pincode": "500032",
        "vendor_id": str(_VENDOR),
        "created_by": str(_RAISED_BY),
        "franchisee_id": "not-a-uuid",
    }
    assert TicketChanged.from_payload(raw) is None

# ── Task 18: the routing override on a pool frame (cases 32–34) ──────────────


def test_pool_changed_routing_override_round_trips() -> None:
    frame = PoolChanged(
        company_id=_COMPANY,
        pincode="500032",
        node_path_ids=(_TW,),
        franchisee_id=_FRANCHISEE,
        routing_override=True,
    )
    parsed = PoolChanged.from_payload(json.loads(frame.as_payload()))
    assert parsed == frame
    assert parsed is not None and parsed.routing_override is True


def test_pool_changed_without_the_key_parses_as_false() -> None:
    # Today's shape (a worker that predates Task 18): no "routing_override" key at all.
    raw = {
        "kind": "pool.changed",
        "company_id": str(_COMPANY),
        "pincode": "500032",
        "node_path_ids": [str(_TW)],
        "franchisee_id": str(_FRANCHISEE),
    }
    parsed = PoolChanged.from_payload(raw)
    assert parsed is not None
    assert parsed.routing_override is False


def test_a_non_bool_routing_override_is_false_not_a_crash() -> None:
    raw = {
        "kind": "pool.changed",
        "company_id": str(_COMPANY),
        "pincode": "500032",
        "node_path_ids": [str(_TW)],
        "franchisee_id": str(_FRANCHISEE),
        "routing_override": "yes",
    }
    parsed = PoolChanged.from_payload(raw)
    assert parsed is not None
    assert parsed.routing_override is False
