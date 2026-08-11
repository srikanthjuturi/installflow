"""The web page an invite link lands on.

`INVITE_LINK_BASE` has to be an https URL, because WhatsApp only turns http(s)
into something tappable — a `videocontech://` link arrives as dead text nobody
can act on. But an https link opens a browser, not the app.

This is the bridge: a page that opens the app if it is installed, and explains
what to do if it is not. It is also the exact place an Apple/Android universal
link would attach later, so the URL a technician receives never has to change.

Deliberately server-rendered with no assets. It is the first thing a new
technician sees, often on a bad connection, and a build pipeline for one page
would be its own liability.
"""

from fastapi import APIRouter
from fastapi.responses import HTMLResponse

from app.core.config import settings

router = APIRouter(tags=["onboarding"])

_PAGE = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Your Videocon technician invite</title>
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
    <div class="mark">V</div>
    <h1>Your invite is ready</h1>
    <p>Open it in the Videocon Technician app to set up your account.</p>
    <a class="cta" href="{deep_link}">Open the app</a>
    <a class="store" href="{app_link}">I don&rsquo;t have the app yet</a>
    <p class="note">
      This link is personal to you &mdash; please don&rsquo;t share it. If nothing
      happens, install the app first, then open this link again.
    </p>
  </div>
  <script>
    // Try the app immediately: most people arriving here already have it, and
    // one tap is better than two. If it is not installed nothing happens and
    // the buttons are still there.
    window.location.href = {deep_link_js};
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
    deep_link = f"videocontech://invite/{safe}"
    return HTMLResponse(
        _PAGE.format(
            deep_link=deep_link,
            deep_link_js=f'"{deep_link}"',
            app_link=settings.TECHNICIAN_APP_LINK or "https://install.videocon.app/technician",
        )
    )
