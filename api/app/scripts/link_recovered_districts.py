"""Apply the researched pincode corrections to an already-loaded master.

    ./.venv/Scripts/python.exe -m app.scripts.link_recovered_districts [--apply]

Two maps, both from `pincode_overrides`:

  * `MISSING_PINCODES`  — codes India Post has and the vendor sheet omits
                          entirely. Creates the pincode, then links its
                          districts.
  * `DISTRICT_RECOVERED` — codes already in the master whose district column
                          was NA on every row. Links only.

Idempotent, and a no-op once everything exists. The importer applies the same
maps on every upload, so this exists only to fix a loaded master without
re-importing 165,627 rows against it.

Prints what it would do and changes nothing unless `--apply` is passed.
"""

import asyncio
import sys

from sqlalchemy import select

from app.core.database import AsyncSessionLocal
from app.features.geo.pincode_overrides import (
    DISTRICT_OVERRIDES,
    DISTRICT_RECOVERED,
    MISSING_PINCODES,
)
from app.models.territory import District, Pincode, PincodeDistrict, State


async def _add_missing(session, apply: bool) -> tuple[int, int, int]:
    """Create pincodes the sheet never mentioned. Returns (added, present, unresolved)."""
    added = present = unresolved = 0
    for code, (state_name, _districts, reason) in sorted(MISSING_PINCODES.items()):
        if await session.get(Pincode, code) is not None:
            print(f"  {code}  already in the master")
            present += 1
            continue
        state = (
            await session.execute(select(State).where(State.name.ilike(state_name)))
        ).scalar_one_or_none()
        if state is None:
            print(f"  {code}  UNRESOLVED - no state {state_name!r} in the master")
            unresolved += 1
            continue
        print(
            f"  {code}  {'ADD' if apply else 'would add'} -> {state.name}"
            f"   ({reason[:60]}...)"
        )
        added += 1
        if apply:
            session.add(Pincode(code=code, state_id=state.id, is_active=True))
    if apply and added:
        # Flush before the link pass below, which needs these rows to exist.
        await session.flush()
    return added, present, unresolved


async def run(apply: bool) -> int:
    created = skipped = missing = removed = 0
    async with AsyncSessionLocal() as session:
        print("-- pincodes missing from the sheet " + "-" * 32)
        added, present, unresolved = await _add_missing(session, apply)
        missing += unresolved

        print("\n-- wrong districts, replaced " + "-" * 38)
        for code, (districts, reason) in sorted(DISTRICT_OVERRIDES.items()):
            row = (
                await session.execute(
                    select(Pincode, State)
                    .join(State, State.id == Pincode.state_id)
                    .where(Pincode.code == code)
                )
            ).first()
            if row is None:
                print(f"  {code}  MISSING - not in the master")
                missing += 1
                continue
            _pin, state = row
            keep = {d.lower() for d in districts}
            current = (
                await session.execute(
                    select(PincodeDistrict, District)
                    .join(District, District.id == PincodeDistrict.district_id)
                    .where(PincodeDistrict.pincode_code == code)
                )
            ).all()
            for link, district in current:
                if district.name.lower() in keep:
                    continue
                print(
                    f"  {code}  {'UNLINK' if apply else 'would unlink'} "
                    f"{district.name}   ({reason[:52]}...)"
                )
                removed += 1
                if apply:
                    await session.delete(link)

        print("\n-- district links " + "-" * 49)
        links = (
            [
                (code, district, reason)
                for code, (district, reason) in DISTRICT_RECOVERED.items()
            ]
            + [
                (code, district, "added with the pincode")
                for code, (_s, districts, _w) in MISSING_PINCODES.items()
                for district in districts
            ]
            + [
                (code, district, "corrected district")
                for code, (districts, _r) in DISTRICT_OVERRIDES.items()
                for district in districts
            ]
        )
        for code, district_name, reason in sorted(links):
            row = (
                await session.execute(
                    select(Pincode, State)
                    .join(State, State.id == Pincode.state_id)
                    .where(Pincode.code == code)
                )
            ).first()
            if row is None:
                print(f"  {code}  MISSING - not in the master at all")
                missing += 1
                continue
            pincode, state = row

            district = (
                await session.execute(
                    select(District).where(
                        District.state_id == state.id,
                        District.name.ilike(district_name),
                    )
                )
            ).scalar_one_or_none()
            if district is None:
                # Never invent the district row here. The importer creates
                # districts from the sheet; conjuring one from a script would
                # put a place in the master that no upload can account for.
                print(
                    f"  {code}  MISSING - {state.name} has no district "
                    f"{district_name!r}; import it first"
                )
                missing += 1
                continue

            exists = await session.get(PincodeDistrict, (code, district.id))
            if exists is not None:
                print(f"  {code}  already linked to {district.name}")
                skipped += 1
                continue

            print(
                f"  {code}  {'LINK' if apply else 'would link'} -> "
                f"{district.name}, {state.name}   ({reason})"
            )
            created += 1
            if apply:
                session.add(
                    PincodeDistrict(pincode_code=code, district_id=district.id)
                )

        if apply and (created or added or removed):
            await session.commit()

    print(
        f"\npincodes {'added' if apply else 'to add'}: {added}   "
        f"already present: {present}"
    )
    print(
        f"links {'created' if apply else 'to create'}: {created}   "
        f"removed: {removed}   already correct: {skipped}   unresolved: {missing}"
    )
    if not apply and (created or added or removed):
        print("Nothing was written. Re-run with --apply.")
    return 1 if missing else 0


if __name__ == "__main__":
    if sys.platform == "win32":
        # psycopg's async mode cannot run on the Proactor loop Windows defaults
        # to; the server sets this up itself, a bare script has to.
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    raise SystemExit(asyncio.run(run("--apply" in sys.argv)))
