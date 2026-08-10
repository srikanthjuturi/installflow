"""The curated product-category icon catalogue.

Deliberately code, not data. Every icon key here has to exist three times:

    api/app/core/icons.py                        this file — validation
    adminWeb/src/components/masters/icons.ts     lucide-react components
    mobileapp/src/components/icons/Icon.tsx      hand-traced react-native-svg

The mobile app does not use an icon font ("these shapes are part of the approved
design and no icon font matches them"), so a new key is a deploy in three places,
not a row someone adds at runtime. Keeping the catalogue closed is what stops an
admin picking an icon the technician's phone cannot draw.

Keys are lucide's own kebab-case names wherever one exists, so the adminWeb map
is mechanical.
"""

from typing import Final

PRODUCT_ICON_KEYS: Final[tuple[str, ...]] = (
    # large appliances
    "tv",
    "washing-machine",
    "refrigerator",
    "air-vent",
    "microwave",
    "droplets",
    "fan",
    "wind",
    "flame",
    # electronics
    "laptop",
    "smartphone",
    "monitor",
    "printer",
    "camera",
    "headphones",
    "speaker",
    # kitchen & home
    "coffee",
    "utensils",
    "sofa",
    "lightbulb",
    # power & service
    "plug",
    "battery",
    "zap",
    "wrench",
    # fallback — also a legitimate choice for a category with no obvious glyph
    "package",
)

#: What every surface falls back to for an unknown or missing key.
DEFAULT_ICON_KEY: Final[str] = "package"


def is_valid_icon(key: str) -> bool:
    return key in PRODUCT_ICON_KEYS
