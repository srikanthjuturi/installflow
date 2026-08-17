---
name: publish-api
description: Deploy the FastAPI backend to Azure App Service (installflowapi) by zip deploy, and diagnose it when it will not start or serves stale behaviour. Covers the publish script, the ARM permissions we do NOT have, the Oryx remote build, the ASGI startup command, reading container logs through Kudu, and the traps that have each already cost hours — POSIX zip paths, config that ships inside the package, and why /home/site/wwwroot lies about what is deployed. Trigger on "publish the api", "deploy the backend", "push to azure", "the api is down", "500 from the deployed api", "my config change did not take effect".
---

# Publishing the API to Azure

The API runs at
`https://installflowapi-bqh6d9e2hhaedye0.centralindia-01.azurewebsites.net`
on Azure App Service (Linux, Python 3.14).

## Publish

```bash
cd api
./.venv/Scripts/python.exe scripts/publish.py          # deploy + verify
./.venv/Scripts/python.exe scripts/publish.py --check  # verify only
```

That script is the whole procedure. Prefer fixing it over deploying by hand —
every guard in it exists because something went wrong once.

## The constraint that shapes everything

**We have no ARM access to the subscription that owns this app.** `az` is signed
in as `srikanth.j@deccansoft.net` and `Microsoft.Web/sites/read` returns
`AuthorizationFailed`; the app is not in any subscription that account can read.

So deployment goes through **Kudu zip deploy**, authenticated by
`api/installflowapi.PublishSettings` — a site-level credential that works
regardless of ARM. That file holds a deployment password, is gitignored, and
must stay that way.

What ARM-only means in practice:

| Needs ARM (portal only) | Our workaround |
|---|---|
| App Settings (env vars) | ship `.env` inside the zip |
| Startup command | set once by hand, see below |
| Postgres firewall, scaling, restart | portal |

To lift this, grant that account **Contributor** on the subscription. Then
`az webapp deploy` and `az webapp config` work and most of this file stops
mattering.

## The startup command — set once, never in the package

**Azure Portal → installflowapi → Configuration → General settings → Startup Command:**

```
gunicorn -k uvicorn_worker.UvicornWorker -w 2 --timeout 600 --bind=0.0.0.0:8000 application:app
```

Without it, Oryx generates a command using gunicorn's **synchronous** workers,
which call an ASGI app with the WSGI signature. Every request — including
`/health` — fails with:

```
TypeError: FastAPI.__call__() missing 1 required positional argument: 'send'
```

A `gunicorn.conf.py` in the repo does **not** fix this. Gunicorn only auto-loads
that file from the working directory, and Oryx runs the app from an extracted
`/tmp` path, so it is never read. This was tried; it does not work.

`uvicorn_worker` is the standalone **`uvicorn-worker`** package. Uvicorn removed
its bundled `uvicorn.workers` module, so that import path silently does not
exist. Pin **`uvicorn-worker>=0.4.0`**: 0.3.0 calls `setup_event_loop()`, removed
in uvicorn 0.36, and every worker dies at boot with an `AttributeError`.

`application.py` exists only to be the name Oryx imports (`application:app`).
`app` is a package here, so a bare `app:app` would import the package and find no
ASGI callable.

## Configuration

`.env.production` is the deployed configuration; `publish.py` copies it into the
package as `.env`. **`.env` is the local development file and must never ship** —
it points at localhost and has `OTP_DEV_ECHO` on.

The script refuses to deploy unless `ENVIRONMENT=production`,
`OTP_DEV_ECHO=false`, `OTP_PEPPER` is set, and `INVITE_LINK_BASE` points at this
site. The first three are also enforced by the server at boot: it will not start
with dev echo on or an empty pepper, because dev echo returns OTP codes in the
response body and an unpeppered 6-digit hash is trivially reversible from a
database dump.

Secrets in the package is a workaround, not a design. They belong in App
Settings once ARM access exists.

## Traps

**`/home/site/wwwroot` does not show what is running.** With the Oryx build on,
the build output is packaged into `output.tar.zst` and extracted to `/tmp` at
container start. The loose files in `wwwroot` are leftovers from the first deploy
and never change — reading `.env` there shows stale values, and files deleted
from the repo still appear. This cost an hour of chasing a config change that had
in fact deployed correctly. **Verify by exercising the API, never by reading
wwwroot.**

**Zip entries must use POSIX paths.** Windows' `Compress-Archive` writes
backslashes, which Linux extracts as files literally named `app\main.py`. The
deploy succeeds and the app cannot import itself. `publish.py` builds the archive
with `zipfile` and `as_posix()`.

**Zip deploy does not build by default.** Without
`SCM_DO_BUILD_DURING_DEPLOYMENT`, it only extracts — no `pip install` — and the
app dies with `No module named 'fastapi'`. That is normally an App Setting, but
**Kudu's `/api/settings` endpoint accepts it**, which is the only route without
ARM. `publish.py` sets it on every run. A build takes ~30–60s; a deploy that
returns in under 5s did not build.

## Diagnosing a broken deployment

`/health` returning 500 means the container starts but the app fails. Read the
container logs through Kudu — credentials come from the publish profile:

```bash
# list log files, newest first
curl -s -u "$USER:$PASS" "https://$KUDU/api/vfs/LogFiles/StartupLogs/"

# the worker's actual traceback
curl -s -u "$USER:$PASS" \
  "https://$KUDU/api/vfs/LogFiles/StartupLogs/<date>_<instance>_failure.log" | tail -40
```

`$KUDU` is the `publishUrl` of the ZipDeploy profile
(`installflowapi-….scm.centralindia-01.azurewebsites.net`).

Read the timestamps. Both log files persist across deployments, so an old
traceback sitting at the end of `failure.log` reads exactly like a current one —
that mistake sent a diagnosis down the wrong path here.

Useful markers in `success.log`:

- `Using worker: sync` → the startup command is missing or wrong
- `Application startup complete` (once per worker) → uvicorn ASGI is running
- `Booting worker` followed immediately by an exit → read the traceback above it

Filesystem logging stops capturing after a while, so recent requests may be
absent. Absence of a request in the log is **not** evidence the client never sent
it.

## After publishing

If `INVITE_LINK_BASE` changed, the mobile app needs a rebuild: its API URL and
its Android App Link host are compiled in. Check `mobileapp/eas.json` and
`TECHNICIAN_APP_LINK`.

**`TECHNICIAN_APP_LINK` goes stale on every mobile build.** It is the APK the
invite landing page offers under "I don't have the app yet". Left pointing at an
older build, technicians install an app aimed at a dead API and every invite
appears expired — which happened, and looked like an invite bug for hours.
Update it whenever a new APK is built, until the app is on the Play Store and it
becomes a store URL.
