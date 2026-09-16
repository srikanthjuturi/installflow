# Load testing

Why it is shaped this way — which environments, which limits, what is safe to
seed and why — is in [DECISIONS.md](DECISIONS.md). Read that first. This file
is only how to run it.

Commands are PowerShell, run from the repo root unless a step says otherwise.

## 0. One-time setup

```powershell
py -3.12 -m venv loadtest/.venv
loadtest/.venv/Scripts/python -m pip install -r loadtest/requirements.txt
```

Locust lives in its own virtualenv on purpose: `api/requirements.txt` is what
`publish.py` ships to Azure.

## 1. Seed a synthetic company (~20 minutes for 500 tickets)

```powershell
cd api
.venv/Scripts/python -m app.scripts.seed_synthetic --tag LOADTEST            # dev
.venv/Scripts/python -m app.scripts.seed_synthetic --plan                    # dry run

$env:POSTGRES_DB='RelianceProdDB'
.venv/Scripts/python -m app.scripts.seed_synthetic --production --tag LOADTEST
Remove-Item Env:POSTGRES_DB
```

Note the **company id** it prints. `--tag` must be new for each run.

⚠ **Seed shortly before testing.** The deployed API's sweeps escalate unaccepted
jobs as their slots approach, so a pool seeded the day before is mostly gone.

## 2. Mint sessions (before EVERY run)

```powershell
cd api
.venv/Scripts/python -m app.scripts.mint_load_sessions --company <id> --intake-credits 3000
```

Writes `loadtest/.sessions/<database>.json` — live refresh tokens, git-ignored.
Locust and `race.py` write rotated tokens back, but a run that crashes cannot,
so re-minting is the safe habit. `--intake-credits` pays for tickets raised
under load; skip it on a re-mint.

## 3. The race test (correctness, ~1 minute)

```powershell
cd loadtest
.venv/Scripts/python race.py --host <api> --db RelianceDB
```

PASS means every round had exactly one winner and every other accept got 409.

## 4. The load run

| | Dev rehearsal | Production ramp |
|---|---|---|
| `--host` | `https://installflowapi-dev-c2fqf7f4bjdbg8bz.centralindia-01.azurewebsites.net` | `https://installflowapi-bqh6d9e2hhaedye0.centralindia-01.azurewebsites.net` |
| `LOAD_DB` | `RelianceDB` | `RelianceProdDB` |
| `LOAD_MAX_USERS` | `150` | `600` (a ceiling it should not reach) |
| `LOAD_STOP_P95_MS` | `2000` | `10000` |
| `LOAD_STOP_FAIL_RATIO` | `0.01` | `0.05` |

```powershell
cd loadtest
$env:LOAD_DB='RelianceDB'; $env:LOAD_RUN_ID='dev-rehearsal'
$env:LOAD_STEP='25'; $env:LOAD_STEP_SECONDS='120'; $env:LOAD_MAX_USERS='150'
$env:LOAD_STOP_P95_MS='2000'; $env:LOAD_STOP_FAIL_RATIO='0.01'
.venv/Scripts/locust -f locustfile.py --host <api> --headless `
  --csv results/$env:LOAD_RUN_ID --csv-full-history `
  --html results/$env:LOAD_RUN_ID.html --only-summary
```

⚠ **Sessions cap concurrency.** Minting gives 150 technician, 20 vendor and 5
console sessions; a user beyond that stops itself rather than share one. For a
ramp past 175 users, mint with `--per-technician 10 --vendor-sessions 60
--console-sessions 20`.

## 5. What comes out, in `loadtest/results/`

| File | What it is |
|---|---|
| `<run>.html` | Locust's report — charts and the percentile table |
| `<run>_stats.csv`, `<run>_stats_history.csv` | the same numbers, per endpoint and over time |
| `<run>-cpu.csv` | **laptop** CPU every 5 s beside users, rps and p95 |
| `<run>-stop.txt` | present only if the guard stopped the run, and why |
| `*-race.txt` | the race test's rounds |

**Read `-cpu.csv` before believing a breaking point.** If laptop CPU sits near
100% before p95 climbs, the load generator was the limit, not the API, and the
report must say so.

## 6. Afterwards

Production: the synthetic company must be deleted before any real user exists —
the go-live checklist in [DECISIONS.md](DECISIONS.md).
