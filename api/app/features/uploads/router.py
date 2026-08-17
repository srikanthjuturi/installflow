"""Image uploads — the seam that replaces base64 data URLs with blob URLs.

One endpoint rather than one per feature: a model photo and a technician's
profile picture are the same operation with a different folder, and splitting
them would duplicate the size and content-type rules that actually matter.

Any signed-in principal may upload. There is deliberately no feature guard: a
technician registering from an invite has no console permissions at all and
still has to send their photo. What an upload can DO is bounded by the rules in
`integrations.blob` — images only, 8 MB, UUID names — not by who calls it.
"""

from typing import Annotated, Literal

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status

from app.core.deps import Principal, get_current_principal
from app.core.schemas import ApiEnvelope, envelope
from app.integrations import blob
from app.integrations.blob import MAX_UPLOAD_BYTES

router = APIRouter(prefix="/uploads", tags=["uploads"])

CurrentPrincipal = Annotated[Principal, Depends(get_current_principal)]

#: Folder per kind, so a company's product photos and its people's faces are
#: separable later — profile pictures are the ones that might need to move to a
#: private container with signed URLs.
Kind = Literal["product", "profile"]


class UploadOut(dict):
    pass


@router.post("", response_model=ApiEnvelope[dict])
async def upload(
    principal: CurrentPrincipal,
    file: Annotated[UploadFile, File()],
    kind: Kind = "product",
) -> ApiEnvelope[dict]:
    """Store an image and return the URL to persist on the record."""
    if not blob.is_configured():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="File storage is not configured on this server",
        )

    # Read with a ceiling rather than trusting the declared size: a client can
    # claim any content-length, and a multi-GB body would be read into memory
    # before any size check that came after it.
    data = await file.read(MAX_UPLOAD_BYTES + 1)
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"Images must be under {MAX_UPLOAD_BYTES // (1024 * 1024)} MB",
        )

    result = await blob.upload_image(
        data,
        (file.content_type or "").split(";")[0].strip().lower(),
        prefix=kind,
        company_id=str(principal.company_id or "shared"),
    )
    if not result.ok:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=result.error
        )

    return envelope({"url": result.url}, message="File uploaded")
