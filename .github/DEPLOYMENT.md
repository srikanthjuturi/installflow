# CI/CD — dev and production deploy pipelines

What runs, why, and the one-time manual setup this repo can't do for itself.
Revised 2026-09-15 to drop GitHub Environments and a self-hosted runner in
favour of a simpler pattern — migrations run from the App Service's own
startup command instead of from CI, which is what makes a plain GitHub-hosted
runner enough. (An earlier version of this doc used a self-hosted runner on
the Postgres-allow-listed machine; that's no longer needed. If you registered
one, see "Cleanup" at the bottom.)

## What exists

| Workflow | Trigger | Does |
|---|---|---|
| `.github/workflows/pr-check.yml` | any PR into `main` or `dev` | lint+typecheck adminWeb and mobileapp; import/syntax-check api. No deploy. |
| `.github/workflows/dev-deploy.yml` | push to `dev` (path-filtered to `api/**`), or manual | zip-deploys api to `installflowapi-dev`. Migrations happen on the app's own restart, not here. |
| `.github/workflows/prod-deploy.yml` | **manual only** (`workflow_dispatch`) | zip-deploys api to `installflowapi` — requires typing `deploy` into a confirmation box, and refuses to run off anything but `main` unless you explicitly tick an override |

Both run on ordinary `ubuntu-latest` GitHub-hosted runners. Neither needs
network access to Postgres, because neither runs a migration — see below.

**adminWeb is not deployed by any of these** — it already auto-deploys via
Netlify's own git integration (`main` only). **mobileapp is not built or
published by any of these** — no dev API URL is wired into `eas.json` yet.

## The key design change: migrations run at App Service startup, not in CI

**Old approach (dropped):** a CI step ran `alembic upgrade head` directly
against Postgres. Doing that from a GitHub-hosted runner doesn't work — this
repo's Postgres firewall allow-lists one specific IP, and GitHub-hosted
runners have no fixed IP. The only fix would have been a self-hosted runner
sitting on that allow-listed machine, kept running as a service — real
ongoing operational weight for what should be routine.

**New approach:** the App Service's own **startup command** runs
`python -m alembic upgrade head` before starting gunicorn, every time the
container restarts (which a deploy always triggers). That traffic originates
*inside Azure*, so the Postgres firewall never has to admit anything from
outside. CI's job shrinks to: build the zip, upload it, done.

Trade-off, stated plainly (same one the reference project you shared already
documents): **a failing migration takes the whole backend down.** The startup
command is `alembic upgrade head && gunicorn ...` — if alembic exits non-zero,
gunicorn never starts, and every request 503s until someone fixes the
migration and the app restarts again. This is more exposure than a dedicated
CI step with its own pass/fail signal, but it's what you asked to match, and
it removes an entire class of infrastructure (the runner) in exchange.

### Set this once, by hand, in the Azure Portal, for BOTH App Services

**installflowapi-dev** (new, needs this before its first real use) and
**installflowapi** (already live — this CHANGES its current behaviour: today
it does not auto-migrate on restart, so this is a real, deliberate change to
production, not just new setup):

**App Service → Configuration → General settings → Startup Command:**

```
python -m alembic upgrade head && gunicorn -k uvicorn_worker.UvicornWorker -w 2 --timeout 600 --bind=0.0.0.0:8000 application:app
```

(Only the `python -m alembic upgrade head &&` prefix is new — the gunicorn
part is unchanged from what `api/.claude/skills/publish-api/` already
documents.)

## Manual setup required

### 1. Add four repository secrets (not environment-scoped)

**Settings → Secrets and variables → Actions → New repository secret:**

| Secret | Content |
|---|---|
| `AZURE_PUBLISH_PROFILE_DEV` | The **Zip Deploy** publish profile XML for `installflowapi-dev` |
| `ENV_FILE_DEV` | Full content of `api/.env.dev-deploy` (already generated — see below) |
| `AZURE_PUBLISH_PROFILE_PROD` | The **Zip Deploy** publish profile XML for `installflowapi` |
| `ENV_FILE_PROD` | Full content of your local `api/.env.production` |

Plain repository secrets, visible to every workflow in the repo — there is no
GitHub Environment gating which job can read which. The separation between
dev and prod is entirely in the **secret names** (`_DEV` vs `_PROD`) and in
each workflow hard-coding which one it reads. Nobody needs a reviewer
approval to trigger `prod-deploy.yml` — the `confirm` input and the branch
check are the only gate.

*(If you already created the `dev`/`production` GitHub Environments and added
secrets to them from the earlier setup attempt, those are now orphaned —
either delete the Environments, or just leave them; the workflows no longer
reference `environment:` at all, so environment-scoped secrets won't be
read.)*

### 2. `api/.env.dev-deploy` already exists and is ready to paste

Built in this session from your real `.env`/`.env.production`, gitignored,
never committed. Open it and copy the whole file as the `ENV_FILE_DEV` secret
value.

### 3. Set the startup command on both App Services (see above)

Portal-only, ARM-gated — cannot be done from a workflow or from this session.

### 4. Confirm the Postgres firewall admits both App Services' outbound traffic

Migrations now run from inside `installflowapi` / `installflowapi-dev`
themselves, not from a runner — so it's each **App Service's own outbound
identity** that needs to reach Postgres, not any particular external IP. If
the firewall is currently locked to one external IP only (as it was when this
doc last described a self-hosted-runner approach), check whether Postgres
already allows Azure-internal traffic from these two App Services specifically,
or add their outbound addresses (App Service → Networking → Outbound
addresses) to the Postgres firewall rules.

## Cleanup — if you registered the self-hosted runner from the earlier attempt

Not required for anything above to work, but tidy:

1. GitHub repo → **Settings → Actions → Runners** → find
   `installflow-db-access-runner` → remove it
2. On the machine where it was set up (`C:\actions-runner-installflow`), if a
   Windows service was installed: open an elevated PowerShell and run
   `.\svc.sh uninstall` (or check `Get-Service actions.runner.*` — if nothing
   is listed, the service was never actually installed, only the runner
   registration itself happened)
3. Delete the `C:\actions-runner-installflow` folder

## Locked decisions carried over from the original design session

- **Exposed publish profiles kept as-is, not rotated** — explicit, on the
  record from that session.
- **adminWeb / mobileapp out of scope** for this pipeline — unchanged.
- **Deploy logic goes through `api/scripts/publish.py --target {dev,prod}`**
  — unchanged; CI and a human run the identical guarded path (right DB name,
  right `ENVIRONMENT`, strong JWT secret, and — prod only — approved WhatsApp
  templates, populated email config, allowlists empty, every customer-facing
  link pointing at the right host).
- **Local `alembic upgrade head` refuses `RelianceProdDB`** unless
  `CONFIRM_PROD=yes-i-mean-it` is also set — enforced in `api/alembic/env.py`,
  unrelated to and unaffected by the CI changes above.
- **The api PR check is a syntax/import smoke test**, not real testing — no
  ruff/mypy/pytest configured yet.

## What this deliberately does not cover

- Rolling back a bad production deploy — no automated rollback; re-running
  the workflow against a reverted `main` is the current answer.
- Rotating the credentials kept exposed by an earlier decision in this
  session.
- Any CI signal for `api` beyond an import/syntax check.
