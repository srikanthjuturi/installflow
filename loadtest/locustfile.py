"""Load test for the technician app, the vendor portal and the console.

    cd loadtest
    .venv\\Scripts\\locust -f locustfile.py --host <api base url> --headless ...

See README.md for the exact commands, and DECISIONS.md for why the test is
shaped the way it is. The short version:

* Users are REAL sessions minted for a seeded company
  (`api/app/scripts/mint_load_sessions.py`), one per simulated user, because
  refresh tokens rotate and two users sharing one would sign each other out.
* The mix follows the seeded company: 50 technicians : 20 vendor staff : 5
  console users, so weights 10 : 4 : 1.
* A 409 on accept is SUCCESS here. First-accept-wins means losing the race is a
  normal outcome with its own screen in the app, and counting it as a failure
  would make the test report the product working as a product failing.
* Two things stop a run early, both configurable, both recorded in
  `results/<run>-stop.txt`: p95 over a ceiling, or failures over a ratio.
* Laptop CPU is sampled alongside, because a 2-core load generator can saturate
  before the API does — and then the numbers describe the laptop.
"""

import csv
import datetime
import json
import os
import random
import threading
import time
from collections import deque
from pathlib import Path

import gevent
import psutil
from locust import HttpUser, LoadTestShape, between, events, tag, task
from locust.exception import StopUser

HERE = Path(__file__).resolve().parent
API = "/api/v1"

#: Which minted file to read — named after the database it was minted against,
#: so a production run cannot quietly use dev sessions or the other way round.
SESSIONS_FILE = HERE / ".sessions" / f"{os.environ.get('LOAD_DB', 'RelianceDB')}.json"

#: Access tokens live five minutes (`ACCESS_TOKEN_EXPIRE_MINUTES`). Refreshing a
#: little early keeps a user from spending its first request of every window on
#: a 401 that the test would then count.
REFRESH_EVERY_S = 4 * 60

#: Early-stop thresholds. The dev rehearsal uses the defaults; the production
#: ramp raises them so the run keeps climbing until something genuinely breaks.
STOP_P95_MS = float(os.environ.get("LOAD_STOP_P95_MS", "2000"))
STOP_FAIL_RATIO = float(os.environ.get("LOAD_STOP_FAIL_RATIO", "0.01"))
#: Ignore the first stretch: a cold App Service answers its first requests
#: slowly, and stopping on that would measure a warm-up, not a limit.
GUARD_WARMUP_S = float(os.environ.get("LOAD_GUARD_WARMUP_S", "60"))
#: How many consecutive 10 s checks must breach before the run stops. One was
#: not enough: the first dev rehearsal stopped at 50 users on a single window —
#: p95 2.4 s in the very second 25 new users arrived, with ZERO failures and a
#: p95 of 100–140 ms either side. A limit worth reporting is one that persists.
GUARD_SUSTAIN = int(os.environ.get("LOAD_GUARD_SUSTAIN", "3"))

RESULTS = HERE / "results"
RUN_ID = os.environ.get("LOAD_RUN_ID") or datetime.datetime.now().strftime("%Y%m%d-%H%M%S")


# ── sessions ──────────────────────────────────────────────────────────────────


def _load_sessions() -> dict:
    if not SESSIONS_FILE.exists():
        raise SystemExit(
            f"No sessions at {SESSIONS_FILE}. Mint them first — see README.md."
        )
    return json.loads(SESSIONS_FILE.read_text(encoding="utf-8"))


SESSIONS = _load_sessions()
_pools = {
    role: deque(SESSIONS[role])
    for role in ("technicians", "vendors", "console")
}
_pool_lock = threading.Lock()


def _take(role: str) -> dict:
    """Hand one minted session to exactly one simulated user."""
    with _pool_lock:
        if not _pools[role]:
            return {}
        return _pools[role].popleft()


class Authed(HttpUser):
    """A signed-in user who refreshes its own token and retries once on 401."""

    abstract = True
    role = ""

    def on_start(self) -> None:
        session = _take(self.role)
        if not session:
            # More users requested than sessions minted. Stopping this one is
            # honest; sharing a session would corrupt the ones already running.
            raise StopUser()
        # The SAME dict that sits in `SESSIONS`, so a rotated token written
        # here is what `_save_sessions` writes back when the run ends.
        self.session = session
        self.label = session.get("code", self.role)
        self.refreshed_at = time.monotonic()

    @property
    def access(self) -> str:
        return self.session["accessToken"]

    def _refresh(self) -> bool:
        with self.client.post(
            f"{API}/auth/refresh",
            json={"refreshToken": self.session["refreshToken"]},
            name="POST /auth/refresh",
            catch_response=True,
        ) as response:
            if response.status_code != 200:
                response.failure(f"refresh failed: {response.status_code}")
                return False
            data = response.json()["data"]
            self.session["accessToken"] = data["accessToken"]
            self.session["refreshToken"] = data["refreshToken"]
            self.refreshed_at = time.monotonic()
            return True

    def call(self, method: str, path: str, *, name: str, ok=(200,), **kwargs):
        """One request, with the bearer header, a proactive refresh and one retry.

        `ok` lists the statuses that count as success — 409 on accept, for one.
        """
        if time.monotonic() - self.refreshed_at > REFRESH_EVERY_S:
            self._refresh()
        for attempt in (1, 2):
            with self.client.request(
                method,
                f"{API}{path}",
                headers={"Authorization": f"Bearer {self.access}"},
                name=name,
                catch_response=True,
                **kwargs,
            ) as response:
                if response.status_code == 401 and attempt == 1:
                    # Not a failure of the thing being measured — the token
                    # aged out. Refresh, and let the retry be the sample.
                    response.success()
                    if not self._refresh():
                        return None
                    continue
                if response.status_code in ok:
                    response.success()
                else:
                    response.failure(
                        f"{response.status_code}: {response.text[:160]}"
                    )
                return response
        return None


# ── the technician app ────────────────────────────────────────────────────────


class Technician(Authed):
    """What a technician's phone does all day: look at the pool, take a job."""

    role = "technicians"
    weight = 10
    #: Pull-to-refresh cadence, not a machine loop. A person glances at the
    #: pool, puts the phone down, glances again.
    wait_time = between(3, 8)

    def on_start(self) -> None:
        super().on_start()
        self.seen: list[str] = []

    @task(5)
    def pool(self) -> None:
        response = self.call("GET", "/jobs/pool?page=1&limit=20", name="GET /jobs/pool")
        if response is not None and response.status_code == 200:
            self.seen = [job["id"] for job in response.json().get("data") or []]

    @task(3)
    def upcoming(self) -> None:
        self.call("GET", "/jobs/mine?status=upcoming&page=1&limit=20", name="GET /jobs/mine")

    @task(2)
    def today(self) -> None:
        self.call("GET", "/jobs/today", name="GET /jobs/today")

    @task(1)
    def earnings(self) -> None:
        self.call("GET", "/earnings/summary?period=week", name="GET /earnings/summary")

    @tag("writes")
    @task(1)
    def accept(self) -> None:
        """Take a job this technician was actually shown.

        409 is the product saying "somebody else got there first", or "that is
        your daily limit" — both are correct answers, not failures.
        """
        if not self.seen:
            return
        job_id = self.seen.pop(random.randrange(len(self.seen)))
        self.call(
            "POST",
            f"/jobs/{job_id}/accept",
            name="POST /jobs/:id/accept",
            ok=(200, 409),
        )


# ── the vendor portal ─────────────────────────────────────────────────────────


class Vendor(Authed):
    """Vendor staff raising tickets and watching their own list."""

    role = "vendors"
    weight = 4
    wait_time = between(10, 30)

    @task(3)
    def tickets(self) -> None:
        self.call("GET", "/tickets?page=1&limit=20", name="GET /tickets (vendor)")

    @task(1)
    def intake_status(self) -> None:
        self.call("GET", "/tickets/intake-status", name="GET /tickets/intake-status")

    @tag("writes")
    @task(1)
    def raise_ticket(self) -> None:
        """A ticket with no slot, the way most arrive: the customer picks later.

        Each costs credits; `mint_load_sessions --intake-credits` pays for a
        run's worth. A 409 OUT_OF_CREDITS here means that top-up was too small,
        and it is reported as the failure it is.
        """
        intake = SESSIONS["intake"]
        item = random.choice(intake["catalogue"])
        service_type = random.choice(item["serviceTypes"])
        body = {
            "subcategoryId": item["subcategoryId"],
            "modelId": item["modelId"],
            "serviceType": service_type,
            "serialNumber": f"LT{random.randrange(10**10):010d}",
            "customerName": "Load Test Customer",
            # +911… cannot reach a subscriber — see seed/guards.py.
            "customerPhone": f"+911{random.randrange(10**9):09d}",
            "address": "Flat 1, Load Test Residency",
            "city": "Hyderabad",
            "state": "Telangana",
            "pincode": random.choice(intake["pincodes"]),
            "expectedDate": (datetime.date.today() + datetime.timedelta(days=1)).isoformat(),
            "serviceLevelHours": 48,
        }
        if service_type in ("Tech Visit", "Service"):
            body["description"] = "Load test: unit needs a routine check"
        self.call("POST", "/tickets", name="POST /tickets", ok=(201,), json=body)


# ── the console ───────────────────────────────────────────────────────────────


class Console(Authed):
    """A manager with the dashboard open and the escalation queue beside it."""

    role = "console"
    weight = 1
    wait_time = between(5, 15)

    @task(3)
    def dashboard(self) -> None:
        self.call("GET", "/tickets/summary", name="GET /tickets/summary")

    @task(2)
    def escalations(self) -> None:
        self.call("GET", "/tickets/escalations?page=1&limit=20", name="GET /tickets/escalations")

    @task(2)
    def ticket_list(self) -> None:
        self.call("GET", "/tickets?page=1&limit=20", name="GET /tickets (console)")


# ── ramp shape ────────────────────────────────────────────────────────────────


class StepRamp(LoadTestShape):
    """Add users in steps and hold each step, so every level gets measured.

    A smooth ramp blurs which level broke things. Steps of LOAD_STEP users held
    for LOAD_STEP_SECONDS each, up to LOAD_MAX_USERS, and the top level held for
    one further interval — the dev rehearsal caps at 150, the production run sets
    a ceiling it does not expect to reach and relies on the guard to stop it.
    """

    step = int(os.environ.get("LOAD_STEP", "25"))
    step_seconds = int(os.environ.get("LOAD_STEP_SECONDS", "120"))
    max_users = int(os.environ.get("LOAD_MAX_USERS", "150"))

    def tick(self):
        levels = -(-self.max_users // self.step)  # ceil
        # Every level gets a full interval, and the top one gets two.
        duration = (levels + 1) * self.step_seconds
        elapsed = self.get_run_time()
        if elapsed >= duration:
            return None
        level = min(int(elapsed // self.step_seconds) + 1, levels)
        return min(level * self.step, self.max_users), max(1, self.step // 5)


@events.test_stop.add_listener
def _save_sessions(**_kwargs) -> None:
    """Write rotated refresh tokens back, or the next run starts signed out.

    Every refresh during the run revoked the token it presented. Without this,
    the file keeps the revoked ones and the next run's first users fail on
    their first refresh — which would read as the API failing.
    """
    SESSIONS_FILE.write_text(json.dumps(SESSIONS, indent=2), encoding="utf-8")


# ── laptop CPU, and the early-stop guard ──────────────────────────────────────


#: Locust's own state names (`locust.runners.STATE_*`) for a run that is over.
_DONE = ("cleanup", "stopping", "stopped")


def _running(environment) -> bool:
    return environment.runner is not None and environment.runner.state not in _DONE


@events.test_start.add_listener
def _start_watchers(environment, **_kwargs) -> None:
    RESULTS.mkdir(exist_ok=True)
    gevent.spawn(_sample_cpu, environment)
    gevent.spawn(_guard, environment)


def _sample_cpu(environment) -> None:
    """Laptop CPU every 5 s, beside the user count at that moment."""
    path = RESULTS / f"{RUN_ID}-cpu.csv"
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.writer(handle)
        writer.writerow(["elapsed_s", "users", "cpu_percent", "rps", "p95_ms"])
        started = time.monotonic()
        psutil.cpu_percent(interval=None)
        while _running(environment):
            gevent.sleep(5)
            total = environment.stats.total
            writer.writerow(
                [
                    round(time.monotonic() - started),
                    environment.runner.user_count,
                    psutil.cpu_percent(interval=None),
                    round(total.current_rps, 1),
                    total.get_current_response_time_percentile(0.95) or 0,
                ]
            )
            handle.flush()


def _guard(environment) -> None:
    """Stop the run when p95 or the failure ratio crosses its line.

    Reads the CURRENT window rather than the cumulative total, so a slow
    warm-up does not hide a later collapse — and writes down why it stopped,
    because "the test ended" is not a result.
    """
    started = time.monotonic()
    breaches: list[str] = []
    while _running(environment):
        gevent.sleep(10)
        if time.monotonic() - started < GUARD_WARMUP_S:
            continue
        total = environment.stats.total
        p95 = total.get_current_response_time_percentile(0.95) or 0
        ratio = total.fail_ratio
        reason = None
        if p95 > STOP_P95_MS:
            reason = f"p95 {p95:.0f} ms > {STOP_P95_MS:.0f} ms"
        elif total.num_requests > 200 and ratio > STOP_FAIL_RATIO:
            reason = f"failure ratio {ratio:.2%} > {STOP_FAIL_RATIO:.2%}"

        users = environment.runner.user_count
        if reason is None:
            breaches.clear()
            continue
        breaches.append(f"{users} users: {reason}")
        # Every breach is written down, sustained or not — a transient spike at
        # a step change is itself a finding, just not a reason to stop.
        with (RESULTS / f"{RUN_ID}-breaches.txt").open("a", encoding="utf-8") as log:
            log.write(f"{time.monotonic() - started:6.0f} s  {breaches[-1]}\n")
        if len(breaches) < GUARD_SUSTAIN:
            continue
        (RESULTS / f"{RUN_ID}-stop.txt").write_text(
            f"stopped at {users} users after {time.monotonic() - started:.0f} s, "
            f"{GUARD_SUSTAIN} consecutive breaches:\n  " + "\n  ".join(breaches) + "\n",
            encoding="utf-8",
        )
        environment.runner.quit()
        return
