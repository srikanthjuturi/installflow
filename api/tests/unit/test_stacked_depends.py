"""Zero tolerance for the stacked-`Depends` trap (api/AGENTS.md, hard rule 2).

FastAPI reads `Annotated[Principal, Depends(a), Depends(b)]` as ONE parameter
with ONE dependency — the LAST — so `a` is never called, silently. About 75 route
registrations carried such an alias ("staff principal + feature", "franchise
principal + franchise.* key", "feature + staff + rank floor") and ran only the
last guard; they were fixed together, each alias now being a single marker over
`app.core.deps.require_all(...)` (wall, then feature, then rank floor).

This file pins that at ZERO. It reads the app's route table — no server, no
database — and walks every dependency reachable from every route (the endpoint's
own parameters AND the signature of each dependency it pulls in), so a stack
hidden inside a nested dependency is found too. Any `Annotated` carrying more
than one `Depends` / `Security` marker fails the test, naming the module and the
routes.

The cure is never to loosen this test: put every guard in one `require_all(...)`
dependency, or in the route's `dependencies=[...]`.

`test_the_detector_finds_a_synthetic_stack` keeps the zero honest: it feeds the
same detector a stacked alias and demands it be reported, so a broken detector
cannot pass the suite by finding nothing.
"""

import importlib
import pkgutil
import typing
from typing import Annotated

from fastapi import APIRouter, Depends, params
from fastapi.dependencies.models import Dependant
from fastapi.routing import APIRoute

import app as app_pkg


def _routers() -> dict[tuple[str, str], APIRouter]:
    found: dict[tuple[str, str], APIRouter] = {}
    for mod in pkgutil.walk_packages(app_pkg.__path__, "app."):
        if not (mod.name.endswith("router") or mod.name.endswith("_router")):
            continue
        module = importlib.import_module(mod.name)
        for attr, value in vars(module).items():
            if isinstance(value, APIRouter):
                found[(mod.name, attr)] = value
    return found


# Imported at module level on purpose: some routers pull in `app.core.database`,
# which builds its engine at import — fine at collection, refused by the X1 guard
# once a test is running.
ROUTERS = _routers()


def _stacked_markers(call: typing.Callable) -> list[tuple[str, ...]]:
    """Every parameter of `call` whose Annotated carries more than one Depends."""
    try:
        hints = typing.get_type_hints(call, include_extras=True)
    except Exception:  # a callable without introspectable hints has no stack to find
        return []
    stacks = []
    for hint in hints.values():
        if typing.get_origin(hint) is not Annotated:
            continue
        guards = [a for a in typing.get_args(hint)[1:] if isinstance(a, params.Depends)]
        if len(guards) > 1:
            stacks.append(tuple(getattr(g.dependency, "__qualname__", repr(g.dependency)) for g in guards))
    return stacks


def _walk(dependant: Dependant, seen: set[int]) -> typing.Iterator[typing.Callable]:
    for sub in dependant.dependencies:
        if id(sub.call) in seen:
            continue
        seen.add(id(sub.call))
        yield sub.call
        yield from _walk(sub, seen)


def find_stacks(routers: typing.Iterable[APIRouter]) -> tuple[dict[tuple[str, tuple[str, ...]], list[str]], int]:
    """({(owner, guards): [routes]}, number of route registrations inspected)."""
    used: dict[tuple[str, tuple[str, ...]], list[str]] = {}
    inspected = 0
    seen_routes: set[int] = set()
    for router in routers:
        for route in router.routes:
            if not isinstance(route, APIRoute) or id(route) in seen_routes:
                continue
            seen_routes.add(id(route))
            inspected += 1
            where = f"{sorted(route.methods)} {route.path}"
            callables = [route.endpoint, *_walk(route.dependant, set())]
            for call in callables:
                for stack in _stacked_markers(call):
                    owner = getattr(call, "__module__", "?") + "." + getattr(call, "__qualname__", "?")
                    used.setdefault((owner, stack), []).append(where)
    return used, inspected


def test_the_route_table_was_actually_read():
    # A zero over an empty table passes for ever.
    assert len(ROUTERS) > 20
    assert sum(len(r.routes) for r in ROUTERS.values()) > 250


def test_a_dependency_marker_after_the_first_is_never_registered():
    """The premise itself, on a toy endpoint: if FastAPI ever starts running every
    marker, this fails and the whole file can be deleted with joy."""
    from fastapi.dependencies.utils import get_dependant

    def first() -> int:
        return 1

    def last() -> int:
        return 2

    def endpoint(x: Annotated[int, Depends(first), Depends(last)]) -> None: ...

    dependant = get_dependant(path="/x", call=endpoint)
    assert [d.call.__name__ for d in dependant.dependencies] == ["last"]


def test_the_detector_finds_a_synthetic_stack():
    """So a zero below means 'none', not 'detector broken'."""
    def a() -> int:
        return 1

    def b() -> int:
        return 2

    router = APIRouter()

    @router.get("/stacked")
    def stacked(x: Annotated[int, Depends(a), Depends(b)]) -> None: ...

    def nested(x: Annotated[int, Depends(a), Depends(b)]) -> int:
        return x

    @router.get("/hidden")
    def hidden(y: Annotated[int, Depends(nested)]) -> None: ...

    @router.get("/fine")
    def fine(z: Annotated[int, Depends(a)]) -> None: ...

    used, inspected = find_stacks([router])
    assert inspected == 3
    assert sorted(r for routes in used.values() for r in routes) == [
        "['GET'] /hidden",
        "['GET'] /stacked",
    ]
    assert all(guards == ("test_the_detector_finds_a_synthetic_stack.<locals>.a",
                          "test_the_detector_finds_a_synthetic_stack.<locals>.b")
               for _owner, guards in used)


def test_no_stacked_guard_alias_exists():
    used, inspected = find_stacks(ROUTERS.values())
    assert inspected > 250
    offenders = [
        f"{owner} stacks {list(guards)} on {len(routes)} route(s): {routes}"
        for (owner, guards), routes in used.items()
    ]
    print(f"inspected {inspected} route registrations, {len(offenders)} stacked alias(es)")
    assert not offenders, (
        "Only the LAST Depends of an Annotated alias runs. Use one "
        "`require_all(...)` dependency or the route's `dependencies=[...]` "
        "(api/AGENTS.md, hard rule 2):\n" + "\n".join(offenders)
    )
