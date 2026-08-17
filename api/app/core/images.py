"""What the API accepts as an image reference: a URL, never the image itself.

Every client can produce a base64 data URL from a crop, and every one of them
tried to. Storing one puts tens of kilobytes into a TEXT column that then rides
along in every list response that names the row — a user list, a technician
list, a product catalogue. The file belongs in blob storage (`POST /uploads`)
and the record keeps its URL.

A local file path (`file:///data/user/0/…`) is the other failure: the phone can
read it, the server never can. Requiring an http(s) scheme refuses both.

This lives in `core` because four slices need the same rule — users,
technicians, onboarding and the product master — and a rule enforced in three
of four places is not a rule.
"""

from typing import Annotated

from pydantic import AfterValidator

MAX_IMAGE_URL = 2048


def check_image_url(value: str) -> str:
    """Raises ValueError unless `value` is a plausible http(s) image URL."""
    url = value.strip()
    if len(url) > MAX_IMAGE_URL:
        raise ValueError("Image URL is too long")
    if not url.lower().startswith(("http://", "https://")):
        raise ValueError(
            "Image URL must start with http:// or https:// — "
            "inline image data is not accepted"
        )
    return url


def _check_optional(value: str | None) -> str | None:
    """Empty and blank both mean "no image", stored as NULL rather than ''."""
    if value is None:
        return None
    if not value.strip():
        return None
    return check_image_url(value)


#: One optional image URL. `None` and `""` both clear it.
ImageUrl = Annotated[str | None, AfterValidator(_check_optional)]
