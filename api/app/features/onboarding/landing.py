"""The web page an invite link lands on.

`INVITE_LINK_BASE` has to be an https URL, because WhatsApp only turns http(s)
into something tappable — a `reliancegreentech://` link arrives as dead text
nobody can act on. But an https link opens a browser, not the app.

This is the bridge: a page that opens the app if it is installed, and explains
what to do if it is not. It is also the exact place an Apple/Android universal
link would attach later, so the URL a technician receives never has to change.

Deliberately server-rendered with no assets. It is the first thing a new
technician sees, often on a bad connection, and a build pipeline for one page
would be its own liability.
"""

from urllib.parse import quote

from fastapi import APIRouter
from fastapi.responses import HTMLResponse

from app.core.config import settings

router = APIRouter(tags=["onboarding"])

#: The app's custom URL scheme — deliberately NOT read from `INVITE_LINK_BASE`.
#:
#: In production that setting is the https URL of THIS page, so deriving the
#: deep link from it would point the button back here in a loop. The two are
#: different facts: one is where WhatsApp sends the technician, the other is how
#: this page hands them to the app.
#:
#: It is a SETTING because it has to name the scheme of the build people are
#: actually carrying, which lags a rename — see APP_SCHEME in app/core/config.py.
#: Nothing verifies it against `scheme` in mobileapp/app.config.ts at runtime,
#: so a wrong value fails the only way deep links ever fail: the button does
#: nothing at all.


def _android_intent(path: str) -> str:
    """The same deep link as an Android `intent://` URI.

    Chrome on Android does NOT follow a bare `customscheme://` href. It blocks
    the navigation and reports nothing, so "Open the app" appears to be a dead
    button even with the app installed and the scheme registered correctly —
    which is exactly how this failed in the field.

    `intent://` is the supported route: Chrome resolves it against an installed
    package, and `S.browser_fallback_url` gives it somewhere to go when the app
    is absent, so the button stops silently doing nothing in BOTH cases.

    The package is the first of `ANDROID_PACKAGE`. That setting is
    comma-separated to survive a rename, and the first entry is the current
    name — an old build carrying the old package still opens through its App
    Link, which is verified against both.
    """
    package = next(
        (p.strip() for p in settings.ANDROID_PACKAGE.split(",") if p.strip()),
        "",
    )
    fallback = settings.TECHNICIAN_APP_LINK or _DEFAULT_APP_LINK
    parts = [
        f"intent://{path}#Intent",
        f"scheme={settings.APP_SCHEME}",
    ]
    if package:
        parts.append(f"package={package}")
    parts.append(f"S.browser_fallback_url={quote(fallback, safe='')}")
    return ";".join(parts) + ";end"


#: Where to send someone who does not have the app. Overridden by
#: TECHNICIAN_APP_LINK, which currently names a build artifact directly.
_DEFAULT_APP_LINK = "https://install.reliancegreentech.in/technician"

_PAGE = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Your Reliance GreenTech technician invite</title>
<style>
  :root {{ color-scheme: light; }}
  * {{ box-sizing: border-box; }}
  body {{
    margin: 0; min-height: 100vh; display: flex; align-items: center;
    justify-content: center; padding: 26px;
    font-family: Roboto, -apple-system, "Segoe UI", sans-serif;
    background: #eef1f3; color: #141b22;
  }}
  .card {{ width: 100%; max-width: 380px; }}
  .mark {{
    width: 58px; height: 58px; border-radius: 17px; background: #0e1622;
    color: #fff; display: grid; place-items: center;
    font-size: 22px; font-weight: 900;
  }}
  h1 {{ font-size: 25px; line-height: 1.16; letter-spacing: -.5px; margin: 18px 0 8px; }}
  p {{ font-size: 13.5px; line-height: 1.5; color: #5a6772; margin: 0 0 8px; }}
  .cta {{
    display: block; margin-top: 22px; padding: 16px; border-radius: 14px;
    background: #1f6feb; color: #fff; text-align: center;
    font-size: 16px; font-weight: 700; text-decoration: none;
  }}
  .store {{
    display: block; margin-top: 10px; padding: 15px; border-radius: 14px;
    border: 1.5px solid #d5dde4; background: #fff; color: #141b22;
    text-align: center; font-size: 14px; font-weight: 700; text-decoration: none;
  }}
  .note {{ margin-top: 16px; font-size: 12px; color: #8894a0; }}
</style>
</head>
<body>
  <div class="card">
    <div class="mark">RG</div>
    <h1>Your invite is ready</h1>
    <p>Open it in the Reliance GreenTech Technician app to set up your account.</p>
    <a class="cta" id="open" href="{deep_link}">Open the app</a>
    <a class="store" href="{app_link}">I don&rsquo;t have the app yet</a>
    <p class="note">
      This link is personal to you &mdash; please don&rsquo;t share it. If nothing
      happens, install the app first, then open this link again.
    </p>
  </div>
  <script>
    // Android needs an intent:// URI — Chrome refuses a bare custom scheme and
    // says nothing, which makes the button look broken. Everything else (iOS,
    // Firefox, a desktop browser) follows the plain scheme in the href, so it
    // stays as the no-JavaScript default and only Android is rewritten.
    var ANDROID = {android_intent_js};
    var onAndroid = /android/i.test(navigator.userAgent);
    var target = onAndroid ? ANDROID : {deep_link_js};
    if (onAndroid) document.getElementById("open").href = ANDROID;

    // Try the app immediately: most people arriving here already have it, and
    // one tap is better than two. A browser that requires a real tap first will
    // ignore this and the button is still there.
    window.location.href = target;
  </script>
</body>
</html>
"""


@router.get("/invite/{token}", response_class=HTMLResponse, include_in_schema=False)
async def invite_landing(token: str) -> HTMLResponse:
    """Deliberately says nothing about whether the token is valid.

    The app resolves it and shows the real state — expired, cancelled, already
    used. Answering that here would let anyone probe tokens by loading a URL.
    """
    safe = "".join(c for c in token if c.isalnum() or c in "-_")
    deep_link = f"{settings.APP_SCHEME}://invite/{safe}"
    android_intent = _android_intent(f"invite/{safe}")
    return HTMLResponse(
        _PAGE.format(
            deep_link=deep_link,
            deep_link_js=f'"{deep_link}"',
            android_intent_js=f'"{android_intent}"',
            app_link=settings.TECHNICIAN_APP_LINK or _DEFAULT_APP_LINK,
        )
    )
