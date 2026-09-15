"""Publish the API to Azure App Service by zip deploy — dev or production.

    ./.venv/Scripts/python.exe scripts/publish.py --target dev
    ./.venv/Scripts/python.exe scripts/publish.py --target prod
    ./.venv/Scripts/python.exe scripts/publish.py --target prod --check   # verify only

Deployment is zip deploy through Kudu, authenticated with the target's publish
profile — NOT `az`. The account available here has no ARM permission on the
subscription that owns either app (`Microsoft.Web/sites/read` returns
AuthorizationFailed), so anything ARM-only is out of reach: App Settings, the
startup command, scaling. The publish profile is a site-level credential and
works regardless — for both `installflowapi` and `installflowapi-dev`.

`--target` is required, on purpose, with no default. Two Azure sites and two
Postgres databases exist for exactly the reason `--target prod` should never
be something a person or a workflow falls into by not typing an argument.

Everything below encodes a mistake that has already cost time once — some of
it prod-only, because a dev deploy is allowed to be looser than what ships to
real customers (see `Target.strict` and TESTING ONBOARDING WITHOUT META
CREDENTIALS in AGENTS.md, which documents leaving WhatsApp/email config empty
in dev on purpose).
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
from dataclasses import dataclass
from pathlib import Path

import httpx

API_DIR = Path(__file__).resolve().parent.parent

#: The CONSOLE, on Netlify — a DIFFERENT host from either API site. Every link
#: guard below compares against the target's own site because the API mints
#: and sends those links itself; this one points at the browser app instead.
#: adminWeb has no dev-hosted deployment (Netlify tracks `main` only), so the
#: CONSOLE_LINK_BASE guard only runs for the prod target.
CONSOLE_SITE = "https://reliancegreentech.netlify.app"

#: Shipped to the server. `alembic/` travels so a migration can be run there by
#: hand if the database is ever unreachable from a laptop — CI never uses this
#: copy to migrate; see `.github/workflows/*-deploy.yml`, which run
#: `alembic upgrade head` as their own step, before this script is invoked.
PAYLOAD_DIRS = ("app", "alembic")
PAYLOAD_FILES = ("requirements.txt", "alembic.ini", "application.py")

#: The development VAPID private key, from `.env`. Named here so shipping it to
#: PRODUCTION is refused rather than merely discouraged: it sits in a file
#: every developer has a copy of, and whoever holds it can push a notification
#: to every browser that ever turned desktop alerts on. It is NOT a problem for
#: the dev target — that VAPID pair being the same as the local one is exactly
#: what "dev" means here — so this only ever runs for `strict` targets.
_DEV_VAPID_PRIVATE_KEY = "lX6xivPgJRlEOrkCtIMfQj4HNwt9P8rXV5L4vWT7ygA"


@dataclass(frozen=True)
class Target:
    name: str
    site: str
    #: Downloaded from the Azure Portal by hand and gitignored (`*.PublishSettings`).
    #: CI never has this file checked in — the dev/prod workflows materialise
    #: it from a GitHub Secret before calling this script, at this same path,
    #: so this script does not need to know it is running in CI at all.
    profile_file: Path
    #: The deployed configuration for this site. `.env` (no suffix) is the
    #: LOCAL development file — points at localhost, has OTP_DEV_ECHO on — and
    #: must never be one of these. Also gitignored; CI writes it from a
    #: GitHub Secret the same way it writes the publish profile.
    env_source_file: Path
    expected_db: str
    expected_environment: str
    #: True only for prod. Applies the full guard suite below — approved
    #: WhatsApp templates, populated email config, allowlists empty, every
    #: customer-facing link pointing at a real host. Dev is allowed to ship
    #: with WhatsApp/ACS left empty and OTP_DEV_ECHO on, exactly as
    #: `AGENTS.md` → "Testing onboarding without Meta credentials" describes —
    #: that is what makes it usable for testing at all.
    strict: bool


TARGETS: dict[str, Target] = {
    "dev": Target(
        name="dev",
        site="https://installflowapi-dev-c2fqf7f4bjdbg8bz.centralindia-01.azurewebsites.net",
        profile_file=API_DIR / "installflowapi-dev.PublishSettings",
        env_source_file=API_DIR / ".env.dev-deploy",
        expected_db="RelianceDB",
        expected_environment="development",
        strict=False,
    ),
    "prod": Target(
        name="prod",
        site="https://installflowapi-bqh6d9e2hhaedye0.centralindia-01.azurewebsites.net",
        profile_file=API_DIR / "installflowapi.PublishSettings",
        env_source_file=API_DIR / ".env.production",
        expected_db="RelianceProdDB",
        expected_environment="production",
        strict=True,
    ),
}


def fail(message: str) -> None:
    print(f"\nFAILED: {message}", file=sys.stderr)
    sys.exit(1)


def kudu_credentials(target: Target) -> tuple[str, str, str]:
    if not target.profile_file.exists():
        fail(
            f"{target.profile_file.name} not found. Download the {target.name} "
            "publish profile from the Azure Portal (or, in CI, check the "
            "workflow step that writes it from a secret)."
        )
    for publish in ET.parse(target.profile_file).getroot():
        if publish.attrib.get("publishMethod") == "ZipDeploy":
            return (
                publish.attrib["publishUrl"],
                publish.attrib["userName"],
                publish.attrib["userPWD"],
            )
    fail(f"No ZipDeploy profile in {target.profile_file.name}")
    raise AssertionError("unreachable")


def build_package(destination: Path, target: Target) -> Path:
    """Assemble the zip. Paths are POSIX — this is not cosmetic.

    Windows' Compress-Archive writes entries with backslashes, which Linux
    extracts as files literally named `app\\main.py`: the deploy succeeds and
    the app then cannot import itself.
    """
    if not target.env_source_file.exists():
        fail(f"{target.env_source_file.name} not found — that is the deployed configuration")

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
    shutil.copy2(target.env_source_file, staging / ".env")

    # copytree takes .html along with the .py, but nothing else asserts that —
    # and an API shipped without its email templates 500s the first time
    # somebody adds a user, which is a long way from here.
    if not list((staging / "app" / "emails" / "templates").glob("*.html")):
        fail("no email templates in the package — app/emails/templates is empty")

    zip_path = destination / "deploy.zip"
    count = 0
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as archive:
        for path in sorted(staging.rglob("*")):
            if path.is_file():
                archive.write(path, path.relative_to(staging).as_posix())
                count += 1
    print(f"  packaged {count} files ({zip_path.stat().st_size:,} bytes)")
    return zip_path


def guard_config(target: Target) -> None:
    """Refuse to ship a configuration the server will reject or leak from.

    Two tiers: a handful of checks that matter for EVERY target — because
    dev and prod share one Postgres server and the database name is the only
    thing keeping a deploy from serving the wrong one — and the full prod
    guard suite, which only runs when `target.strict`.
    """
    text = target.env_source_file.read_text(encoding="utf-8")
    values = dict(
        line.split("=", 1)
        for line in text.splitlines()
        if "=" in line and not line.lstrip().startswith("#")
    )
    problems = []

    # ── Checks that apply to every target ───────────────────────────────
    if values.get("ENVIRONMENT", "").strip() != target.expected_environment:
        problems.append(
            f"ENVIRONMENT must be {target.expected_environment} for the "
            f"{target.name} target, got {values.get('ENVIRONMENT', '').strip() or '<unset>'}"
        )
    # The check that did not exist while it was most needed. Dev and prod are
    # two databases on ONE server, so the only thing separating them is this
    # string — and a wrong one is invisible: the app boots, every screen
    # works, and it is serving the other environment's data.
    if values.get("POSTGRES_DB", "").strip() != target.expected_db:
        problems.append(
            f"POSTGRES_DB must be {target.expected_db} for the {target.name} "
            f"target, not {values.get('POSTGRES_DB', '').strip() or '<unset>'} — "
            "this would deploy an API that serves the wrong environment's database"
        )
    # A signing key is the whole of the session's security, and the
    # placeholder shipped in `.env.example` is public in the repository. It
    # ran in production until the databases were split. Matters for dev too —
    # a technician's dev session is still a real bearer token.
    jwt_secret = values.get("JWT_SECRET_KEY", "").strip()
    if "CHANGE_ME" in jwt_secret or len(jwt_secret) < 32:
        problems.append(
            "JWT_SECRET_KEY is a placeholder or too short — generate one with "
            '`python -c "import secrets; print(secrets.token_urlsafe(64))"`'
        )

    if not target.strict:
        if problems:
            fail("; ".join(problems))
        print("  config guards passed (dev — light guard set)")
        return

    # ── Prod-only guards below ───────────────────────────────────────────
    if values.get("OTP_DEV_ECHO", "").strip().lower() not in ("false", "0", ""):
        problems.append("OTP_DEV_ECHO must be false — it returns codes in the response")
    if not values.get("OTP_PEPPER", "").strip():
        problems.append("OTP_PEPPER must be set — the server refuses to boot without it")
    if target.site not in values.get("INVITE_LINK_BASE", ""):
        problems.append("INVITE_LINK_BASE does not point at this site")
    # The same check, and it exists because the invite one did not cover it:
    # `SLOT_LINK_BASE` was simply absent from .env.production, so it fell back
    # to its `http://localhost:8000/slot` default and every customer got a link
    # WhatsApp would not even make tappable. An unset key has to fail here for
    # the same reason a wrong one does — the symptom is identical.
    if target.site not in values.get("SLOT_LINK_BASE", ""):
        problems.append(
            "SLOT_LINK_BASE does not point at this site — the customer's "
            "'pick a time' link must be a public https URL"
        )
    # Third of the same kind, and it very nearly shipped unset: the default is
    # `http://localhost:8000/feedback`, and that URL would have gone out over
    # WhatsApp to real customers asking them to confirm a job. Every link this
    # server MINTS and SENDS gets a guard here — the failure is silent
    # otherwise, because nothing is wrong until somebody taps it.
    if target.site not in values.get("FEEDBACK_LINK_BASE", ""):
        problems.append(
            "FEEDBACK_LINK_BASE does not point at this site — the customer's "
            "'confirm the job' link must be a public https URL"
        )
    # Every customer-facing message must name an APPROVED template. An empty
    # name is not "off": the sender falls back to a free-form text message,
    # Meta accepts it with a 200 and a message id, and then drops it unless the
    # recipient messaged the business in the last 24 hours. With no delivery
    # webhook the ticket records "sent" and nobody ever finds out. That is
    # precisely how the slot messages failed in production — they were set
    # locally, absent here, and worked on every machine anyone tested on.
    for key, what in (
        ("WHATSAPP_OTP_TEMPLATE_NAME", "the sign-in code"),
        ("WHATSAPP_TEMPLATE_NAME", "the technician invite"),
        ("WHATSAPP_SLOT_TEMPLATE_NAME", "the customer's 'pick a time' link"),
        ("WHATSAPP_SLOT_CONFIRMED_TEMPLATE_NAME", "the slot confirmation"),
        ("WHATSAPP_FEEDBACK_TEMPLATE_NAME", "the customer's 'confirm the job' link"),
        ("WHATSAPP_ESCALATION_TEMPLATE_NAME", "the area manager's escalation"),
    ):
        if not values.get(key, "").strip():
            problems.append(f"{key} is unset — {what} would go out as free-form text")

    # Web push fails the same silent way. With the switch on and no VAPID pair
    # the console renders a working-looking "Desktop alerts" toggle, the browser
    # grants permission, and every send is dropped server-side — so it is only
    # discovered by somebody eventually asking why they never hear about an
    # escalation. Off with no keys is a legitimate state; on without them is not.
    if values.get("WEB_PUSH_ENABLED", "").strip().lower() in ("true", "1"):
        missing = [
            key
            for key in ("VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY")
            if not values.get(key, "").strip()
        ]
        if missing:
            problems.append(
                f"WEB_PUSH_ENABLED is on but {' and '.join(missing)} "
                f"{'are' if len(missing) > 1 else 'is'} empty — the console "
                "would offer desktop alerts that silently never arrive. "
                "Generate a pair for THIS environment (vapid --gen); never "
                "reuse the development one."
            )
        elif values.get("VAPID_PRIVATE_KEY", "").strip() == _DEV_VAPID_PRIVATE_KEY:
            problems.append(
                "VAPID_PRIVATE_KEY is the development key from .env — it is in "
                "a file every developer has. Generate a separate pair for "
                "production with `vapid --gen`."
            )
        if not values.get("VAPID_SUBJECT", "").strip().startswith("mailto:"):
            problems.append(
                "VAPID_SUBJECT must be a mailto: a push service can complain "
                "to; providers may start refusing sends without a real one"
            )

    # The console link is the fourth of the same kind, and the only one that
    # points somewhere other than the API site — see CONSOLE_SITE. It ships
    # inside every emailed temporary password, and a localhost value sends
    # perfectly and arrives as a dead button.
    if CONSOLE_SITE not in values.get("CONSOLE_LINK_BASE", ""):
        problems.append(
            "CONSOLE_LINK_BASE does not point at the console — the 'Sign in' "
            "button in every emailed temporary password would be dead"
        )

    # Email. Not in the startup guard, because an unconfigured mailer is loud
    # (every creation reports emailStatus: failed) rather than silent — but it
    # still must not ship, because every account created would be one whose
    # password only ever existed in somebody's browser for a moment.
    for key, what in (
        ("ACS_CONNECTION_STRING", "no temporary password would ever be emailed"),
        ("ACS_SENDER_ADDRESS", "ACS refuses a send with no verified sender"),
    ):
        if not values.get(key, "").strip():
            problems.append(f"{key} is unset — {what}")

    # An allowlist is a DEVELOPMENT guard. Left set in production it silently
    # refuses every address not named in it, so real accounts are created and
    # never told their password, and the only trace is one warning line.
    #
    # WHATSAPP_ALLOWLIST rides along because it is the identical latent bug and
    # has never had a guard.
    for key in ("ACS_EMAIL_ALLOWLIST", "WHATSAPP_ALLOWLIST"):
        if values.get(key, "").strip():
            problems.append(
                f"{key} must be empty in production — anything else silently "
                f"drops messages to everyone not named in it"
            )

    # Google Sign-In. Deliberately not "must be set": unset is the intended
    # arrangement, because it falls through to the default in app/core/config.py
    # exactly as ANDROID_PACKAGE does. This can only guard the half it can see —
    # the console's VITE_GOOGLE_CLIENT_ID lives in the Netlify UI, so keeping the
    # two in step is a checklist step, not a guard.
    google_id = values.get("GOOGLE_CLIENT_ID", "").strip()
    if google_id and not google_id.endswith(".apps.googleusercontent.com"):
        problems.append("GOOGLE_CLIENT_ID is not a Google OAuth client id")

    if problems:
        fail("; ".join(problems))
    _guard_templates_exist(values)
    print("  config guards passed")


def _guard_templates_exist(values: dict[str, str]) -> None:
    """Every configured template name must be APPROVED on the WABA.

    Best effort on the network, strict on the answer. If Meta cannot be reached
    the deploy proceeds with a warning — a publish should not be hostage to
    Graph being up. But if Meta DOES answer, a name it does not recognise, or
    one still in review, stops the deploy: shipping either produces the same
    silent non-delivery as leaving the name blank.
    """
    token = values.get("WHATSAPP_TOKEN", "").strip()
    waba = values.get("WHATSAPP_BUSINESS_ID", "").strip()
    version = values.get("WHATSAPP_API_VERSION", "").strip() or "v21.0"
    wanted = {
        values[k].strip(): k
        for k in values
        if k.startswith("WHATSAPP_") and k.endswith("_TEMPLATE_NAME") and values[k].strip()
    }
    if not (token and waba and wanted):
        return

    try:
        response = httpx.get(
            f"https://graph.facebook.com/{version}/{waba}/message_templates",
            params={"limit": 100, "fields": "name,status"},
            headers={"Authorization": f"Bearer {token}"},
            timeout=20,
        )
        response.raise_for_status()
        registry = {t["name"]: t.get("status") for t in response.json().get("data", [])}
    except (httpx.HTTPError, ValueError, KeyError) as exc:
        print(f"  ! could not check templates against Meta ({exc}) — deploying anyway")
        return

    bad = []
    for name, key in sorted(wanted.items()):
        status = registry.get(name)
        if status is None:
            bad.append(f"{key}={name} does not exist on this WABA")
        elif status != "APPROVED":
            bad.append(f"{key}={name} is {status}, not APPROVED")
    if bad:
        fail("; ".join(bad))
    print(f"  {len(wanted)} WhatsApp template(s) approved on the WABA")


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


def verify(client: httpx.Client, target: Target) -> None:
    """Exercise the API. Do NOT inspect /home/site/wwwroot to confirm a deploy.

    With the Oryx build on, the app runs from an archive extracted to /tmp; the
    loose files in wwwroot are leftovers from the first deploy and never change.
    Reading them shows stale configuration and invites the wrong conclusion.
    """
    print(f"\nVerifying {target.name} (the site restarts, so the first attempts may fail):")
    deadline = time.monotonic() + 300
    while True:
        try:
            health = client.get(f"{target.site}/health", timeout=90)
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
        f"{target.site}/api/v1/auth/login",
        json={"email": "deploy-probe@example.com", "password": "not-a-real-password"},
        timeout=90,
    )
    if login.status_code != 401:
        fail(
            f"Database probe returned {login.status_code}, expected 401 — "
            "a 500 here means the app booted but cannot reach Postgres"
        )
    print("  database    reachable (login probe returned 401)")

    # One request distinguishes three states with no Google account needed:
    #   401 — the route is live and the client id is set (what we want)
    #   404 — the route is missing, i.e. a stale deploy
    #   503 — GOOGLE_CLIENT_ID is unset or malformed, so every real sign-in
    #         would fail with nothing on the server saying why
    #
    # Retried, and NOT because the check is flaky. /health answers from the
    # platform before uvicorn has finished importing the app, so on a cold start
    # the first requests can 404 against a container that is genuinely fine —
    # this probe cried wolf on the deploy that introduced it. The retry is what
    # makes a 404 here mean "the route is missing" rather than "you asked early".
    deadline = time.monotonic() + 120
    while True:
        google = client.post(
            f"{target.site}/api/v1/auth/google",
            json={"credential": "not-a-real-token"},
            timeout=90,
        )
        if google.status_code == 401 or time.monotonic() > deadline:
            break
        time.sleep(10)
    if google.status_code != 401:
        fail(
            f"Google sign-in probe returned {google.status_code}, expected 401 — "
            "404 means the route did not deploy, 503 means GOOGLE_CLIENT_ID is "
            "unset or malformed"
        )
    print("  google      configured (rejection probe returned 401)")

    for path in ("/docs", "/.well-known/assetlinks.json"):
        response = client.get(f"{target.site}{path}", timeout=90)
        status = "ok" if response.status_code == 200 else f"HTTP {response.status_code}"
        print(f"  {path:<28} {status}")
        if response.status_code != 200:
            fail(f"{path} did not serve")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--target",
        required=True,
        choices=sorted(TARGETS),
        help="which site to publish — no default, on purpose",
    )
    parser.add_argument("--check", action="store_true", help="verify only, do not deploy")
    parser.add_argument(
        "--validate-config-only",
        action="store_true",
        help=(
            "run only guard_config against the target's env file and exit — no "
            "network calls. Used by CI to confirm the right database name "
            "BEFORE running migrations, not just before the code deploy that "
            "happens after them."
        ),
    )
    args = parser.parse_args()
    target = TARGETS[args.target]

    if args.validate_config_only:
        guard_config(target)
        print(f"\n{target.name} config valid.")
        return

    with httpx.Client(follow_redirects=True) as client:
        if not args.check:
            print(f"Publishing {target.name} to {target.site}")
            guard_config(target)
            host, user, password = kudu_credentials(target)
            auth = (user, password)
            ensure_remote_build(client, host, auth)
            with tempfile.TemporaryDirectory() as tmp:
                deploy(client, host, auth, build_package(Path(tmp), target))
        verify(client, target)

    print(f"\nPublished {target.name}.")


if __name__ == "__main__":
    main()
