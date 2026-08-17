"""Android App Links verification.

An https invite link opens a BROWSER unless Android can prove the link belongs
to our app. It proves it by fetching this file from the exact host in the link
and checking that it names our package and our signing certificate. When it
matches, tapping the link in WhatsApp opens the app directly — no page, no
"Open the app" button, which is the behaviour anyone expects from an invite.

Normally this requires a domain you own. It works here because the dev tunnel
points at THIS server, so we control what that hostname serves. That also means
it dies with the tunnel: the host is compiled into the app's intent filter, so a
new tunnel hostname needs a new build. A real domain removes that entirely.

Verification happens at INSTALL time, so the tunnel and this endpoint have to be
up when the APK is installed — not just when the link is tapped.
"""

from fastapi import APIRouter
from fastapi.responses import JSONResponse

from app.core.config import settings

router = APIRouter(tags=["onboarding"])


@router.get("/.well-known/assetlinks.json", include_in_schema=False)
async def assetlinks() -> JSONResponse:
    """The Digital Asset Links statement Android fetches to verify the link.

    Empty fingerprints would be worse than absent: Android would fetch a valid
    file that vouches for nothing, so the link silently keeps opening a browser
    with no error anywhere. Serving an empty list makes that state visible to
    anyone who curls it.
    """
    fingerprints = [
        f.strip().upper()
        for f in settings.ANDROID_CERT_FINGERPRINTS.split(",")
        if f.strip()
    ]
    return JSONResponse(
        [
            {
                "relation": ["delegate_permission/common.handle_all_urls"],
                "target": {
                    "namespace": "android_app",
                    "package_name": settings.ANDROID_PACKAGE,
                    "sha256_cert_fingerprints": fingerprints,
                },
            }
        ],
        media_type="application/json",
    )
