"""The localities inside a pincode, for the address form's dropdown (Epic 7).

A suggestion list, never a validator: `tickets.locality` is free text, because the
directory is never complete. Open to any signed-in caller (a vendor raising a
ticket is the main one) and it answers names only - no coordinates are sent, the
form does not need them.
"""

import re

from fastapi import HTTPException, status
from sqlalchemy import case, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.post_offices import TYPE_RANK
from app.core.schemas import AppModel
from app.models.post_office import PostOffice

_PINCODE = re.compile(r"^[0-9]{6}$")


class PostOfficeOut(AppModel):
    id: str
    name: str
    #: `HO` head office, `PO` sub office, `BO` branch office.
    officeType: str
    #: False for offices the directory marks "Non Delivery" - still real places a
    #: person may live in, but the form lists them after the delivering ones.
    delivers: bool


async def for_pincode(db: AsyncSession, code: str) -> list[PostOfficeOut]:
    if not _PINCODE.match(code):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "A pincode is six digits")
    rank = case(
        *[(PostOffice.office_type == t, r) for t, r in TYPE_RANK.items()], else_=9
    )
    rows = await db.scalars(
        select(PostOffice)
        .where(PostOffice.pincode == code)
        # Delivering offices first, then head -> sub -> branch, then by name.
        .order_by(PostOffice.delivers.desc(), rank, PostOffice.name)
        .limit(200)
    )
    return [
        PostOfficeOut(
            id=str(r.id), name=r.name, officeType=r.office_type, delivers=r.delivers
        )
        for r in rows
    ]
