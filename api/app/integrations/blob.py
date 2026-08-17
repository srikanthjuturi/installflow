"""Azure Blob Storage for user-supplied images.

Product model photos and profile pictures were TEXT columns holding base64 data
URLs — a 200 KB photo became a ~270 KB string inside every row that referenced
it, travelling in full on every list query. This is the seam that replaces them
with a URL.

Uploads are named by UUID, never by the file the user sent. Their filename is
attacker-controlled and would otherwise decide a path; it also leaks whatever
the phone called the photo.
"""

from __future__ import annotations

import logging
import mimetypes
import uuid
from dataclasses import dataclass

from azure.core.exceptions import AzureError
from azure.storage.blob import ContentSettings
from azure.storage.blob.aio import BlobServiceClient

from app.core.config import settings

logger = logging.getLogger(__name__)

#: What a browser or phone camera actually produces. Anything else is refused —
#: this container is served publicly, so an .html or .svg upload would be a
#: stored-XSS vector on our own domain.
ALLOWED_CONTENT_TYPES: dict[str, str] = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/heic": ".heic",
}

MAX_UPLOAD_BYTES = 8 * 1024 * 1024


@dataclass(frozen=True)
class UploadResult:
    ok: bool
    url: str | None = None
    error: str | None = None

    @staticmethod
    def failure(message: str) -> "UploadResult":
        return UploadResult(ok=False, error=message)


def is_configured() -> bool:
    return bool(settings.AZURE_STORAGE_CONNECTION_STRING)


def _client() -> BlobServiceClient:
    return BlobServiceClient.from_connection_string(
        settings.AZURE_STORAGE_CONNECTION_STRING
    )


async def upload_image(
    data: bytes,
    content_type: str,
    *,
    prefix: str,
    company_id: str,
) -> UploadResult:
    """Store one image and return its public URL. Never raises.

    `company_id` is part of the path, not for access control — the container is
    public, so the path proves nothing — but so that a company's uploads can be
    counted, migrated or deleted as a unit when one leaves.
    """
    if not is_configured():
        return UploadResult.failure("File storage is not configured on this server")

    extension = ALLOWED_CONTENT_TYPES.get(content_type)
    if extension is None:
        allowed = ", ".join(sorted(ALLOWED_CONTENT_TYPES))
        return UploadResult.failure(f"Only images are accepted ({allowed})")

    if not data:
        return UploadResult.failure("The file is empty")
    if len(data) > MAX_UPLOAD_BYTES:
        mb = MAX_UPLOAD_BYTES // (1024 * 1024)
        return UploadResult.failure(f"Images must be under {mb} MB")

    name = f"{prefix}/{company_id}/{uuid.uuid4().hex}{extension}"

    try:
        async with _client() as service:
            container = service.get_container_client(settings.AZURE_BLOB_CONTAINER)
            blob = container.get_blob_client(name)
            await blob.upload_blob(
                data,
                overwrite=False,
                content_settings=ContentSettings(
                    content_type=content_type,
                    # Immutable by construction: the name is a fresh UUID, so a
                    # URL's content can never change. Cache it hard.
                    cache_control="public, max-age=31536000, immutable",
                ),
            )
            return UploadResult(ok=True, url=blob.url)
    except AzureError as exc:
        logger.warning("Blob upload failed: %s", exc)
        return UploadResult.failure(f"Could not store the file: {exc}")


async def ensure_container() -> str:
    """Create the container if missing, with blob-level public read.

    Public read is deliberate and worth stating: these URLs are rendered by the
    console and by phones with no session, so signed URLs would expire mid-view
    and every <img> would need refreshing. Names are UUIDs, so a URL cannot be
    guessed — but anyone holding one can read it. That is acceptable for product
    photos; if profile pictures ever need to be private, they belong in a
    separate container with SAS URLs rather than a change here.
    """
    async with _client() as service:
        container = service.get_container_client(settings.AZURE_BLOB_CONTAINER)
        try:
            await container.create_container(public_access="blob")
            return "created"
        except AzureError as exc:
            if "ContainerAlreadyExists" in str(exc):
                return "already exists"
            raise
