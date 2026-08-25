"""Publish the API to Azure App Service by zip deploy.

    ./.venv/Scripts/python.exe scripts/publish.py            # deploy + verify
    ./.venv/Scripts/python.exe scripts/publish.py --check    # verify only

Deployment is zip deploy through Kudu, authenticated with the publish profile —
NOT `az`. The account available here has no ARM permission on the subscription
that owns this app (`Microsoft.Web/sites/read` returns AuthorizationFailed), so
anything ARM-only is out of reach: App Settings, the startup command, scaling.
The publish profile is a site-level credential and works regardless.

Everything below encodes a mistake that has already cost time once.
"""

from __future__ import annotations

import argparse
import os
import shutil
import sys
import tempfile
import time
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path

import httpx

API_DIR = Path(__file__).resolve().parent.parent
PROFILE = API_DIR / "installflowapi.PublishSettings"
SITE = "https://installflowapi-bqh6d9e2hhaedye0.centralindia-01.azurewebsites.net"

#: Shipped to the server. `alembic/` travels so migrations can be run there if
#: the database is ever unreachable from a laptop.
PAYLOAD_DIRS = ("app", "alembic")
PAYLOAD_FILES = ("requirements.txt", "alembic.ini", "application.py")

#: Configuration ships INSIDE the package as `.env`, because App Settings need
#: ARM. `.env.production` is the source; `.env` is the local development one and
#: must never be deployed — it points at localhost and has OTP_DEV_ECHO on.
ENV_SOURCE = ".env.production"


def fail(message: str) -> None:
    print(f"\nFAILED: {message}", file=sys.stderr)
    sys.exit(1)


def kudu_credentials() -> tuple[str, str, str]:
    if not PROFILE.exists():
        fail(f"{PROFILE.name} not found. Download it from the Azure Portal.")
    for publish in ET.parse(PROFILE).getroot():
        if publish.attrib.get("publishMethod") == "ZipDeploy":
            return (
                publish.attrib["publishUrl"],
                publish.attrib["userName"],
                publish.attrib["userPWD"],
            )
    fail("No ZipDeploy profile in the publish settings")
    raise AssertionError("unreachable")


def build_package(destination: Path) -> Path:
    """Assemble the zip. Paths are POSIX — this is not cosmetic.

    Windows' Compress-Archive writes entries with backslashes, which Linux
    extracts as files literally named `app\\main.py`: the deploy succeeds and
    the app then cannot import itself.
    """
    env_source = API_DIR / ENV_SOURCE
    if not env_source.exists():
        fail(f"{ENV_SOURCE} not found — that is the deployed configuration")

    staging = destination / "payload"
    staging.mkdir(parents=True)

    for name in PAYLOAD_DIRS:
        shutil.copytree(
            API_DIR / name,
            staging / name,
            ignore=shutil.ignore_patterns("__pycache__", "*.pyc"),
        )
    for name in PAYLOAD_FILES:
        shutil.copy2(API_DIR / name, staging / name)
    shutil.copy2(env_source, staging / ".env")

    zip_path = destination / "deploy.zip"
    count = 0
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as archive:
        for path in sorted(staging.rglob("*")):
            if path.is_file():
                archive.write(path, path.relative_to(staging).as_posix())
                count += 1
    print(f"  packaged {count} files ({zip_path.stat().st_size:,} bytes)")
    return zip_path


def guard_production_config() -> None:
    """Refuse to ship a configuration the server will reject or leak from."""
    text = (API_DIR / ENV_SOURCE).read_text(encoding="utf-8")
    values = dict(
        line.split("=", 1)
        for line in text.splitlines()
        if "=" in line and not line.lstrip().startswith("#")
    )
    problems = []
    if values.get("ENVIRONMENT", "").strip() != "production":
        problems.append("ENVIRONMENT must be production")
    if values.get("OTP_DEV_ECHO", "").strip().lower() not in ("false", "0", ""):
        problems.append("OTP_DEV_ECHO must be false — it returns codes in the response")
    if not values.get("OTP_PEPPER", "").strip():
        problems.append("OTP_PEPPER must be set — the server refuses to boot without it")
    if SITE not in values.get("INVITE_LINK_BASE", ""):
        problems.append("INVITE_LINK_BASE does not point at this site")
    # The same check, and it exists because the invite one did not cover it:
    # `SLOT_LINK_BASE` was simply absent from .env.production, so it fell back
    # to its `http://localhost:8000/slot` default and every customer got a link
    # WhatsApp would not even make tappable. An unset key has to fail here for
    # the same reason a wrong one does — the symptom is identical.
    if SITE not in values.get("SLOT_LINK_BASE", ""):
        problems.append(
            "SLOT_LINK_BASE does not point at this site — the customer's "
            "'pick a time' link must be a public https URL"
        )
    # Third of the same kind, and it very nearly shipped unset: the default is
    # `http://localhost:8000/feedback`, and that URL would have gone out over
    # WhatsApp to real customers asking them to confirm a job. Every link this
    # server MINTS and SENDS gets a guard here — the failure is silent
    # otherwise, because nothing is wrong until somebody taps it.
    if SITE not in values.get("FEEDBACK_LINK_BASE", ""):
        problems.append(
            "FEEDBACK_LINK_BASE does not point at this site — the customer's "
            "'confirm the job' link must be a public https URL"
        )
    if problems:
        fail("; ".join(problems))
    print("  config guards passed")


def ensure_remote_build(client: httpx.Client, host: str, auth: tuple[str, str]) -> None:
    """Turn on the Oryx build.

    Without it zip deploy only EXTRACTS: no pip install, and the app dies with
    `No module named 'fastapi'`. Normally an App Setting, but Kudu's own settings
    endpoint accepts it, which is the only route without ARM.
    """
    response = client.post(
        f"https://{host}/api/settings",
        auth=auth,
        json={"SCM_DO_BUILD_DURING_DEPLOYMENT": "true", "ENABLE_ORYX_BUILD": "true"},
        timeout=60,
    )
    if response.status_code not in (200, 204):
        fail(f"Could not enable the remote build (HTTP {response.status_code})")
    print("  remote build enabled")


def deploy(client: httpx.Client, host: str, auth: tuple[str, str], zip_path: Path) -> None:
    print("  uploading (the remote build takes about a minute)...")
    started = time.monotonic()
    response = client.post(
        f"https://{host}/api/zipdeploy",
        auth=auth,
        content=zip_path.read_bytes(),
        headers={"Content-Type": "application/zip"},
        timeout=1200,
    )
    if response.status_code not in (200, 202):
        fail(f"Deploy rejected (HTTP {response.status_code}): {response.text[:300]}")
    print(f"  deployed in {time.monotonic() - started:.0f}s")


def verify(client: httpx.Client) -> None:
    """Exercise the API. Do NOT inspect /home/site/wwwroot to confirm a deploy.

    With the Oryx build on, the app runs from an archive extracted to /tmp; the
    loose files in wwwroot are leftovers from the first deploy and never change.
    Reading them shows stale configuration and invites the wrong conclusion.
    """
    print("\nVerifying (the site restarts, so the first attempts may fail):")
    deadline = time.monotonic() + 300
    while True:
        try:
            health = client.get(f"{SITE}/health", timeout=90)
            if health.status_code == 200 and health.json().get("status") == "ok":
                print(f"  /health      {health.json()}")
                break
        except httpx.HTTPError:
            pass
        if time.monotonic() > deadline:
            fail("/health never returned 200 — check the container logs")
        time.sleep(10)

    # A real query. 401 proves it reached Postgres; a 500 would mean it could
    # boot but not reach the database, which /health alone cannot tell you.
    #
    # The address has to be syntactically valid or Pydantic rejects it with 422
    # before any database work happens — which looks like a failed probe when
    # the deployment is fine. `.invalid` is reserved but email-validator
    # refuses it, so use a deliverable-looking address that cannot exist.
    login = client.post(
        f"{SITE}/api/v1/auth/login",
        json={"email": "deploy-probe@example.com", "password": "not-a-real-password"},
        timeout=90,
    )
    if login.status_code != 401:
        fail(
            f"Database probe returned {login.status_code}, expected 401 — "
            "a 500 here means the app booted but cannot reach Postgres"
        )
    print("  database    reachable (login probe returned 401)")

    for path in ("/docs", "/.well-known/assetlinks.json"):
        response = client.get(f"{SITE}{path}", timeout=90)
        status = "ok" if response.status_code == 200 else f"HTTP {response.status_code}"
        print(f"  {path:<28} {status}")
        if response.status_code != 200:
            fail(f"{path} did not serve")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="verify only, do not deploy")
    args = parser.parse_args()

    with httpx.Client(follow_redirects=True) as client:
        if not args.check:
            print(f"Publishing to {SITE}")
            guard_production_config()
            host, user, password = kudu_credentials()
            auth = (user, password)
            ensure_remote_build(client, host, auth)
            with tempfile.TemporaryDirectory() as tmp:
                deploy(client, host, auth, build_package(Path(tmp)))
        verify(client)

    print("\nPublished.")


if __name__ == "__main__":
    main()
