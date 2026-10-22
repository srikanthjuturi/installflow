# Task 06 — Employees: no per-job payout, no redeem, a monthly statement

> Layer: **api** · Depends on: **05** · Migration: **none** (uses `ledger_entries.technician_type`, added by
> Task 05's `7c4f2e9a1d58`).
>
> Read `00-index.md` first, then Task 05. Names are the index's; anything the index does not name is marked
> **Decision (writer)** and listed in §8. The statement endpoint matches **Task 09 §4.4 exactly**; the
> `technicianType` field and the redeem refusal match **Task 07 §4.1–4.3**.
>
> **Publish together with Task 05** (Task 05 §8 trap 1).

---

## 1. Goal and why

### In plain words

A franchisee can now employ technicians on a salary (T1). An employee is paid by the franchisee's payroll, not
per job, so this API must stop doing three things for them and start doing one:

* **stop** writing a `payout` ledger row when an employee's job closes — on customer confirmation **or**
  force-closure (T2). The ticket still carries its stamped price; that is the product's price, not a promise.
* **stop** an employee asking to be paid by UPI (T4): `POST /redemptions/me` → 409 `EMPLOYEE_CANNOT_REDEEM`.
* **keep** everything else an employee earns or owes — escalation bonuses, cancellation and no-show penalties,
  and later travel and speed money (T3) — in the ledger exactly as for a freelancer.
* **start** producing a **monthly statement** per employee: a CSV for one IST calendar month listing every
  ledger row that should be added to or taken from their salary (T4). Salary itself is not recorded.

### Worked example

Meena is a SkyFix **employee** (`technician_type = 'employee'`); Priya is SkyFix's franchisee admin.

| When (IST) | What happens | Ledger row written |
|---|---|---|
| 3 Oct | Meena closes an install worth ₹450 to a freelancer; the customer confirms | **none** (T2) |
| 9 Oct | Meena cancels a job 3 h before the slot | `penalty` ₹500, `employee` stream |
| 12 Oct | Meena completes an escalated job with a ₹400 bonus | `bonus` ₹400 |
| 20 Oct | A manager force-closes a job of hers, leaving the prefilled ₹450 in the payout box | **none** — ignored for an employee; the trail says why |
| 28 Oct | Priya reverses the 9 Oct penalty | `reversal` ₹500 |
| 2 Nov | Meena opens Earnings → Redeem | the app hides it (Task 07); a stale screen that still sends `POST /redemptions/me` gets 409 `EMPLOYEE_CANNOT_REDEEM` |
| 2 Nov | Priya downloads `GET /franchise/statements/{meena}?month=2026-10` | `statement-SKY-TCH-4033-2026-10.csv`: bonus +400, penalty −500, penalty reversed +500 → **net +₹400.00** |

Had the penalty been reversed on 5 November instead, October's file would still read −500 (and net −100), and
November's would carry the +500. **A downloaded month never changes** — that is what lets payroll trust it.

---

## 2. Decisions implemented

| ID | How |
|---|---|
| **T2** | `feedback_service.record_feedback` and `tickets.service.force_close_ticket` write no `payout` for an employee. |
| **T3** | Bonus, penalty, no-show, reversal writers unchanged; Tasks 10/11's kinds flow through the statement generically. |
| **T4** | `POST /redemptions/me` refuses employees; `GET /franchise/statements/{technicianId}?month=` (and the home twin under staff). |
| **T1** | The type that decides "paid per job" is the technician's **current** type (index §6 "T1 vs ordering"); Task 10 switches the one helper to the type frozen in `accept_snapshot`. Task 05 already refuses a type change while the technician holds an open job, so the two agree until then. |
| §6a | Earnings arithmetic unchanged here (Tasks 10/11 fold their kinds); the statement reads kinds **generically**. |

---

## 3. Schema

**None.** This task reads `ledger_entries.technician_type` (Task 05 §3.3): every row says whether it is
freelancer money (redeemable by UPI) or employee money (salary statement), stamped at write time.

---

## 4. API / service changes

### 4.1 New pure module `app/core/employment.py`

```python
from app.models.technician import TYPE_EMPLOYEE, TYPE_FREELANCER   # Task 01

def pays_per_job(technician_type: str | None) -> bool:
    """T2. False for 'employee'; True for 'freelancer' AND for None/unknown — an unreadable type must
    not silently stop paying somebody, and None is what a pre-Task-01 row would read as."""

def may_redeem(technician_type: str | None) -> bool:
    """T4. False for 'employee' only."""

def redeem_refusal(technician_type: str | None) -> tuple[str, str] | None:
    """('EMPLOYEE_CANNOT_REDEEM', 'Employees are paid through salary, so there is nothing to redeem.')
    or None. The sentence is Task 07's PROPOSED copy for the same code."""

async def job_technician_type(db, *, company_id, technician_id) -> str | None:
    """The type that governs per-job pay for a job this technician holds. TODAY: their current
    TechnicianProfile.technician_type (None when technician_id is None). Task 10 adds a keyword
    `snapshot: dict | None = None` and makes THIS body prefer accept_snapshot.technicianType via
    core.accept_snapshot.technician_type_of; the callers' only change is passing
    `snapshot=row.accept_snapshot` (this function has no ticket of its own to read it from)."""
```

### 4.2 No payout for an employee on customer closure — `features/tickets/feedback_service.record_feedback`

Before (line ~157): `if confirmed and row.technician_id is not None:` → payout row for
`row.technician_payout_paise`.

After:

```python
if confirmed and row.technician_id is not None:
    kind_of = await job_technician_type(db, company_id=row.company_id, technician_id=row.technician_id)
    if pays_per_job(kind_of):
        <today's payout block, unchanged>
```

Nothing else moves: the vendor is still billed in full (`charge_vendor_closure`), `refresh_technician_stats`
still counts the job, the `feedback_received` event is unchanged. No new event — the ledger's silence is the
fact, and the ticket page's `technicianCreditedPaise` is null (no row), which the console already renders.

### 4.3 Force-close — the payout field is **ignored**, not refused, for an employee

`features/tickets/service.force_close_ticket`, before the `credited = min(...)` line:

```python
kind_of = await job_technician_type(db, company_id=principal.company_id, technician_id=technician_id)
employee_job = technician_id is not None and not pays_per_job(kind_of)
credited = 0 if employee_job else min(body.technicianPayoutPaise or 0, row.technician_payout_paise)
```

and the `force_closed` event note gains a suffix when `employee_job` and the body asked for money:
`f"{reason} · {notes} · no per-job payout: employee"` (truncated to the column as today).

**Decision (writer) — ignore, don't refuse.** The console prefills `technicianPayoutPaise` with the full payout
(`ForceCloseRequest` docstring), so every **already-deployed** console would send a non-zero amount on an
employee's job. A 422 would block every force-closure of an employee's job until the console is redeployed — and
a force-closure is the manager settling a case, which this codebase never refuses over a money field (vendor
credit: "closure never refuses"; the payout itself is already clamped "rather than refusing"). Ignoring is the
same shape as the existing clamp, and the trail records it so nobody wonders where the ₹450 went.

**What the console sees.** `TicketOut` gains `technicianType: Literal["employee","freelancer"] | None` — the
assigned technician's `job_technician_type`, filled in `tickets.service._hydrate` with one `IN` query over the
page's `technician_id`s; **null** for a vendor principal (not a party to how a technician is paid) and when no
technician is assigned. The force-close form hides the payout field when it is `"employee"` (staff-console delta,
§5). The response is today's `TicketDetailOut` with `technicianCreditedPaise: null`.

### 4.4 Redemptions — employees cannot ask; everything else still works

**`core/ledger.py`** — the redeemable balance is the **freelancer stream** only:

* `credited(db, *, company_id, technician_id)` adds `LedgerEntry.technician_type == TYPE_FREELANCER` to its
  WHERE. Docstring: "salary money (employee stream) is paid by payroll through the statement and is never
  redeemable — Task 06". Its kind arithmetic is Tasks 10/11's (§6a fold).
* **Move** `reserved()` and `balance()` from `features/redemptions/service.py` into `core/ledger.py` as
  `reserved(...)` and `redeemable_balance(...)` (unchanged bodies) — Task 05's type-change guard in the
  technicians slice needs the same figure (rule 4). `redemptions.service` imports them; `redeemable()` stays.

**`features/redemptions/service.request`** — first statement after the profile lock:

```python
refusal = redeem_refusal(locked.technician_type)
if refusal:
    raise _refused(*refusal)            # 409 EMPLOYEE_CANNOT_REDEEM
```

Before `REDEMPTION_OPEN`, so an employee is told the true reason.

```json
POST /redemptions/me  { "amountPaise": 320000 }
409 { "success": false, "statusCode": 409, "code": "EMPLOYEE_CANNOT_REDEEM",
      "message": "Employees are paid through salary, so there is nothing to redeem.",
      "timestamp": "…", "data": null,
      "errors": ["Employees are paid through salary, so there is nothing to redeem."] }
```

**Unchanged for employees (Task 07 §4.3.5):** `GET /redemptions/me`, `GET /redemptions/me/history`,
`GET /redemptions/me/{id}`, `POST /redemptions/me/{id}/confirm`. An open redemption asked for while they were a
freelancer stays payable by the payer and confirmable by them — "only the technician confirms".

**`summary` (`GET /redemptions/me`)** — `RedeemableOut` gains `technicianType: Literal["employee","freelancer"]`
and `canRedeem: bool` (`may_redeem(...)`). For an employee: `redeemablePaise = 0` (so every installed build
disables Redeem — `RedeemCard` already does at ≤ 0), `availablePaise` = the true freelancer-stream balance
(usually 0; never a faked figure), `open` as today. For a freelancer: unchanged.

### 4.5 Type change and an outstanding balance — **SETTLED as built (owner ruling 2026-10-15, R5)**

The question: Ravi was a freelancer with ₹3,200 not yet redeemed, and Priya makes him an employee. Employees
cannot redeem, so that money would be stuck; paying it through salary would need the statement to reach back
before the change, which no month boundary can express.

**Decision:** extend Task 05's `type_change_refusal` with the balance:

```python
def type_change_refusal(*, old, new, open_jobs, freelancer_balance_paise) -> tuple[str, str] | None:
    # Task 05's open-jobs clause first, then:
    if old == TYPE_FREELANCER and new == TYPE_EMPLOYEE and freelancer_balance_paise > 0:
        return ("TECHNICIAN_HAS_BALANCE",
                f"{rupees} is still waiting to be redeemed. Ask them to redeem it (or pay it), "
                "then change the type.")
```

`technicians.service.update_technician` passes `freelancer_balance_paise=await
core.ledger.redeemable_balance(...)` (credited freelancer stream − every redemption not declined). Consequences:

* **Positive balance** → 409 `TECHNICIAN_HAS_BALANCE` (new code, §8). The technician redeems, the franchisee
  admin pays, then the change goes through. An **open** redemption does not block: it is already reserved, so
  the balance is ≤ 0, and it stays payable/confirmable after the switch (Task 07 relies on this).
* **Negative balance** (penalties exceeded payouts) → allowed. The debt stays in the freelancer stream — it is
  **not** deducted from salary — and offsets their next payouts if they ever become a freelancer again.
* **Employee → freelancer** → allowed (open-jobs guard only). The redeemable balance resumes from the
  freelancer stream as it was; employee-era rows are never redeemable, so nothing is paid twice.

*Owner ruling 2026-10-15 (R5):* kept as built — the change is refused while redeemable money remains
(`TECHNICIAN_HAS_BALANCE`) and, by Task 05, while open jobs exist (`TECHNICIAN_HAS_OPEN_JOBS`). The two alternatives
(let an employee redeem the freelancer stream; put the freelancer balance on the first statement) are **dropped**.

### 4.6 The app learns the type — `TechnicianSessionOut.technicianType`

`features/technicians/schemas.TechnicianSessionOut` gains `technicianType: Literal["employee", "freelancer"]`;
`technicians.service.technician_session` sets `technicianType=profile.technician_type`. That one builder serves
**both** `GET /technicians/me` and the sign-in response (`POST /auth/otp/verify` → `data.technicianProfile`,
built in `auth/otp_service.py` through the documented lazy import), which is exactly where Task 07 reads it.

### 4.7 Pool push — no rupee figure on an employee's lock screen

`core/push.announce_pool_job` leads the push with `₹{payout}`. For an employee that is a promise the product
will not keep (Task 07 §5.9 hides it in the app for the same reason). After `technicians_covering(...)`:

```python
employees = set(await db.scalars(select(TechnicianProfile.id).where(
    TechnicianProfile.company_id == company_id, TechnicianProfile.id.in_(technician_ids),
    TechnicianProfile.technician_type == TYPE_EMPLOYEE)))
```

Send twice: freelancers with today's `parts`, employees with `parts` minus the rupee element (same
`PushText("pool.new", summary=…)`, same `data`). Return the sum. No new push key.

`JobOfferOut.payoutPaise` / `JobOut.payoutPaise` stay as they are — a non-null number on the wire is the
installed app's contract (`jobs/schemas.py`); the app decides what to show from `technicianType`.

### 4.8 Earnings for an employee — unchanged endpoints

`GET /earnings/summary` and `/earnings/transactions` are not changed. For an employee they are already right:
`earnedPaise` holds no per-job payouts written after the switch (Tasks 10/11 fold `travel` into it and the speed
kinds into bonuses/penalties, §6a), `netPaise` = what their statement adds to salary over the same window, and
the list shows every row. A window spanning a type change honestly shows both kinds of money — it is still the
person's own history. Task 07 relabels the net for employees from `technicianType` on `/technicians/me`.

### 4.9 The monthly statement

#### Endpoints

| Method & path | Guards | Scope |
|---|---|---|
| `GET /franchise/statements/{technicianId}?month=YYYY-MM` (in `features/franchise_portal/router.py`) | `FranchisePrincipal` + `require_feature("franchise.statements")` | `franchisee_id = principal.franchisee_id` |
| `GET /ledger/statements/{technicianId}?month=YYYY-MM` (staff, in `features/ledger/router.py`) | `require_feature("earnings.view")` + `require_min_rank(NATIONAL_HEAD)` + `require_staff_principal` | the **home** franchisee only (F8: home money stays on the existing keys) |

No summary endpoint (Task 09 lists employees through `GET /franchise/technicians?view=registered&
technicianType=employee`). Both routes call the same core function; neither slice imports the other.

**Who is found (else 404 `"Statement not found"`):** the technician is loaded by `(company_id, id)`; then it must
be **an employee of franchisee F in that month**: `(profile.franchisee_id == F and profile.technician_type ==
'employee')` **or** at least one `ledger_entries` row with `franchisee_id = F`, `technician_type = 'employee'`,
`technician_id = id` in the month. (The second clause keeps last month's statement downloadable after a type
change or a carve-out.) Another franchisee's or another company's technician → **404** (both walls).

**`month`:** `^\d{4}-(0[1-9]|1[0-2])$`, else 422 `"Month must look like 2026-10"`; a month that begins after the
current IST month → 422 `"Pick a month that has started"`. The current month is allowed (it is "to date").

#### Core — new `app/core/statements.py` (pure parts unit-tested)

```python
def parse_month(text: str) -> tuple[int, int]                       # ValueError on bad shape
def month_bounds(year: int, month: int) -> tuple[datetime, datetime]  # half-open UTC range of the IST month
def month_has_started(year: int, month: int, now: datetime) -> bool

#: Direction and label per kind. +1 adds to salary, -1 deducts. 'payout' is deliberately ABSENT — an
#: employee is never paid per job, and the query excludes it anyway.
KIND_LINES: dict[str, tuple[int, str]] = {
    "bonus":         (+1, "Reassignment bonus"),
    "travel":        (+1, "Travel allowance"),      # Task 10 writes it; listed now
    "speed_reward":  (+1, "Speed reward"),          # Task 11
    "reversal":      (+1, "Penalty reversed"),
    "penalty":       (-1, "Penalty"),
    "speed_penalty": (-1, "Speed penalty"),         # Task 11
}
TOTAL_ORDER = ("bonus", "travel", "speed_reward", "reversal", "penalty", "speed_penalty")

def rupees_plain(paise: int) -> str          # 40000 → "400.00"; -10000 → "-100.00"; no ₹, no grouping
def csv_safe(cell: str) -> str               # prefix "'" when it starts with = + - @ TAB CR (formula injection)
def build_statement_csv(*, franchisee_name, franchisee_code, month_label, employee_name, employee_code,
                        employee_phone, rows: list[StatementRow]) -> str
def statement_filename(*, franchisee_code, technician_code, year, month) -> str

async def statement_rows(db, *, company_id, franchisee_id, technician_id, start, end) -> list[StatementRow]
```

`statement_rows` — **kind-generic**: no `kind IN (…)` list, only `kind <> 'payout'`:

```sql
SELECT le.created_at, t.code AS ticket_code, le.kind, le.reason, le.amount_paise,
       rt.code AS reverses_ticket, r.created_at AS reverses_at
FROM ledger_entries le
JOIN tickets t ON t.company_id = le.company_id AND t.id = le.ticket_id
LEFT JOIN ledger_entries r  ON r.company_id = le.company_id AND r.id = le.reverses_id
LEFT JOIN tickets rt ON rt.company_id = r.company_id AND rt.id = r.ticket_id
WHERE le.company_id = :company AND le.franchisee_id = :franchisee AND le.technician_id = :tech
  AND le.technician_type = 'employee' AND le.kind <> 'payout'
  AND le.created_at >= :start AND le.created_at < :end
ORDER BY le.created_at, le.id
```

(Served by Task 01's `ix_ledger_entries_company_franchisee (company_id, franchisee_id, created_at)`.)

**Reversals — Decision (writer):** every row lands in the month it was **written**. A penalty and its reversal
are two lines, each in its own month; a reversed penalty is **not** hidden (unlike the Earnings screen, which
treats it as never charged). A statement is an accounting record that payroll has already acted on; hiding a
September charge because it was reversed in October would make September's file change after it was paid.

#### CSV layout (PROPOSED copy — owner sign-off, X2)

UTF-8 **with BOM** (`﻿`, so Excel shows `₹` and non-Latin names), `csv` module with `\r\n` line endings,
every text cell through `csv_safe`. Amounts are plain rupees with two decimals; credits and debits are
positive in their own columns; only `Net` carries a sign.

```
Monthly statement,SkyFix Services,October 2026
Employee,Meena R,TCH-4033,+919800000002

Date (IST),Ticket,Item,Details,Credit (₹),Debit (₹),Reverses
09 Oct 2026 14:05,SKY-INST-0412,Penalty,Cancel 2–4h before slot,,500.00,
12 Oct 2026 18:40,SKY-INST-0419,Reassignment bonus,Escalation pickup,400.00,,
28 Oct 2026 11:02,SKY-INST-0412,Penalty reversed,Customer moved the visit,500.00,,SKY-INST-0412 penalty of 09 Oct 2026

Totals,,,,Credit (₹),Debit (₹)
Reassignment bonus,,,,400.00,0.00
Travel allowance,,,,0.00,0.00
Speed reward,,,,0.00,0.00
Penalty reversed,,,,500.00,0.00
Penalty,,,,0.00,500.00
Speed penalty,,,,0.00,0.00
Net for the month,,,,400.00,
```

* Every kind in `TOTAL_ORDER` has a totals line even when zero (the clerk's template does not change shape when
  Tasks 10/11 ship). A kind **not** in `KIND_LINES` (a future kind added without updating this table) is listed
  with its raw kind as the Item, its amount under Credit, Details `"unrecognised item — not in the net"`, its own
  totals line, and is **excluded** from `Net`; a warning is logged. The unit test in §6 makes that state
  unreachable for every kind in `LEDGER_KINDS`.
* A month with no rows still returns the header, an empty body and all-zero totals (an employee who did only
  salaried work is a real, common answer — "do not fake", but do not 404 either).
* Item for a `penalty` row: `"No-show penalty"` when `reason == CANCEL_PENALTY_BANDS[-1]` (the
  `earnings._title` coupling, named there), else `"Penalty"`.

#### Response

```python
return Response(content=("﻿" + body).encode("utf-8"), media_type="text/csv; charset=utf-8",
                headers={"Content-Disposition": f'attachment; filename="{filename}"'})
```

`filename = statement-{franchiseeCode}-{technicianCode}-{YYYY-MM}.csv`, e.g.
`statement-SKY-TCH-4033-2026-10.csv` (home's code for the staff route).

**Envelope exception** — the same one the three `.xlsx` template endpoints make (`tickets/router.py`
`ticket_template`, `masters/router.py` `serial_template`, `geo/router.py` `import_template`): a **successful**
response is the file; every failure (401/403/404/422) is the standard envelope, because guards and checks run
before any byte is produced. The console fetches it with `apiGetBlob` (`adminWeb/src/services/http.ts`), which
already reads the envelope's message on failure. CORS does not expose `Content-Disposition`
(`main.py` sets no `expose_headers`), so the console names the download itself with the same pattern — **do not
add `expose_headers`** for this.

### 4.10 `app/scripts/seed/verify.py`

* `_closed_tickets_were_paid`: skip tickets whose technician's `job_technician_type` is `employee` (join
  `technician_profiles` on `(company_id, technician_id)`, `technician_type = 'freelancer'`). Docstring: an
  employee's closed job has no payout by design (T2).
* New `_employees_were_not_paid`: `SELECT id FROM ledger_entries WHERE company_id = :c AND kind = 'payout' AND
  technician_type = 'employee'` must be empty. Added to `run()`'s tuple.

### 4.11 Feature keys, error codes, events, notifications

* Keys: `franchise.statements` (Task 02 seeds it to `franchisee_admin`); staff route `earnings.view` + NH floor.
* Error codes: `EMPLOYEE_CANNOT_REDEEM` (index); **`TECHNICIAN_HAS_BALANCE`** (new, §8).
* Events / notifications: none new. The force-close note suffix (§4.3) is the only trail change.
* Docs in the same commit: `api/AGENTS.md` — "Job payouts are live" (employees: none, and why the force-close
  field is ignored), the redemption section (employees refused, freelancer-stream balance), a short
  "Employee statements" section (month written, reversals as lines, kind-generic, the envelope exception); root
  `AGENTS.md`'s "A job is priced" paragraph gains one sentence on employees.

---

## 5. Client changes

None in this task. Consumers: **Task 07** (mobile) — `technicianType` on `TechnicianSessionOut`,
`EMPLOYEE_CANNOT_REDEEM`, `redeemablePaise: 0`; **Task 09** (portal) — the statement CSV and the employee list
via `technicianType=employee`. **Staff-console deltas** (built in Task 09 §5.10): the
force-close form hides the payout box when `ticket.technicianType === "employee"` and says *"Employees are
paid through salary — no per-job payout."* (PROPOSED copy); a home-franchisee *Download statement* action on an
employee's profile calling `GET /ledger/statements/{id}?month=`.

---

## 6. Unit tests (pytest, pure — X1)

**`api/tests/unit/test_employment.py`**
1. `pays_per_job`: `"employee"` → False; `"freelancer"`, `None`, `"contractor"` → True.
2. `may_redeem`: `"employee"` → False; `"freelancer"`, `None` → True.
3. `redeem_refusal("employee")` → (`"EMPLOYEE_CANNOT_REDEEM"`, the exact sentence); freelancer → None.
4. `type_change_refusal` (Task 05's, extended): freelancer→employee with balance 1 paisa → `TECHNICIAN_HAS_BALANCE`;
   balance 0 or −5000 → None; employee→freelancer with balance 9999 → None; open jobs 1 wins over balance
   (`TECHNICIAN_HAS_OPEN_JOBS`); same type → None.

**`api/tests/unit/test_statements.py`**
5. `parse_month`: `"2026-10"` → (2026, 10); `"2026-13"`, `"2026-1"`, `"26-10"`, `""`, `"2026-10-01"` → ValueError.
6. `month_bounds(2026, 10)` → (`2026-09-30T18:30Z`, `2026-10-31T18:30Z`); December rolls to next January;
   `(2028, 2)` ends `2028-02-29T18:30Z` (leap); both bounds tz-aware UTC.
7. An entry at 31 Oct 23:59 IST is `< end`; at 1 Nov 00:00 IST is not (half-open).
8. `month_has_started`: current IST month True; next month False; at 31 Oct 20:00 UTC (= 1 Nov IST) November True.
9. `rupees_plain`: 0 → `"0.00"`; 40050 → `"400.50"`; −10000 → `"-100.00"`; 1 → `"0.01"`.
10. `csv_safe`: `"=SUM(A1)"` → `"'=SUM(A1)"`; `"+91…"` → `"'+91…"`; `"-x"`, `"@x"` prefixed; `"Meena"` unchanged.
11. **Coverage gate:** `set(LEDGER_KINDS) - {"payout"} <= set(KIND_LINES)` — fails the build when Task 10/11 add a
    kind to `LEDGER_KINDS` without a statement line. And `set(TOTAL_ORDER) == set(KIND_LINES)`.
12. `build_statement_csv` with the §1 example rows: starts with the preamble lines; the column header line is
    exactly `Date (IST),Ticket,Item,Details,Credit (₹),Debit (₹),Reverses`; the reversal row's Reverses cell names
    the penalty's ticket and date; totals include zero lines for travel/speed; `Net for the month` = `400.00`.
13. Empty rows → header + six zero totals + net `0.00`.
14. A row of kind `"mystery"` → listed with Details `"unrecognised item — not in the net"`, own totals line, net
    unchanged.
15. A `penalty` whose reason is `CANCEL_PENALTY_BANDS[-1]` → Item `"No-show penalty"`.
16. Dates render in IST (`2026-10-09T08:35Z` → `09 Oct 2026 14:05`).
17. `statement_filename(franchisee_code="SKY", technician_code="TCH-4033", year=2026, month=10)` →
    `"statement-SKY-TCH-4033-2026-10.csv"`.

---

## 7. Acceptance criteria

On **RelianceDB** (dev), after Task 05. Setup: company A, home H, external S, S's admin Priya, H's NH Nisha;
Meena = S employee; Ravi = S freelancer; Hema = H employee; company B with franchisee admin Bala.

1. **Closure, no payout.** Given Meena's job is `Awaiting Customer`, when the customer confirms, then
   `SELECT count(*) FROM ledger_entries WHERE ticket_id = :t AND kind = 'payout'` = 0, the ticket is `Closed`, and
   the vendor bill row exists (`vendor_credit` ledger per api/AGENTS.md). Same for Ravi → 1 payout row,
   `technician_type = 'freelancer'`.
2. **Force-close ignored.** Given an employee job, when a manager force-closes with `technicianPayoutPaise:
   45000`, then 200, no payout row, `GET /tickets/{t}` → `technicianType: "employee"`,
   `technicianCreditedPaise: null`, and the `force_closed` event note ends with `no per-job payout: employee`.
3. **Other money still flows (T3).** Meena's cancellation penalty, a confirmed no-show and an escalation bonus
   each write a row with `technician_type = 'employee'`, `franchisee_id = S`.
4. **Redeem refused.** Meena `POST /redemptions/me` → 409 `EMPLOYEE_CANNOT_REDEEM`; `GET /redemptions/me` → 200
   with `redeemablePaise: 0`, `canRedeem: false`, `technicianType: "employee"`; `SELECT count(*) FROM redemptions
   WHERE technician_id = :meena` unchanged.
5. **Open redemption survives a switch.** Given Ravi has an open (unclaimed) redemption and no open jobs, when
   Priya makes him an employee, then 200; Priya claims it; Ravi `POST /redemptions/me/{id}/confirm
   {received: true}` → settled (`confirmed_at IS NOT NULL`).
6. **Balance blocks the switch.** Given Ravi has ₹3,200 redeemable and no open redemption, when Priya sets
   `technicianType: "employee"`, then 409 `TECHNICIAN_HAS_BALANCE` naming ₹3,200; after he redeems → 200.
   A technician with a negative balance switches → 200.
7. **No double pay on switching back.** Given Meena (employee) earned a ₹400 bonus, when she becomes a freelancer,
   then `GET /redemptions/me` → `availablePaise` excludes it:
   `SELECT sum(amount_paise) FROM ledger_entries WHERE technician_id = :meena AND technician_type = 'freelancer'
   AND kind IN ('payout','bonus')` matches the credited side.
8. **Session field.** Meena `GET /technicians/me` and `POST /auth/otp/verify` → `technicianType: "employee"`.
9. **Pool push.** With Meena and Ravi both covering a new job, Meena's push body has no `₹`, Ravi's starts with it
   (check the server log / a dev device).
10. **Statement.** Priya `GET /franchise/statements/{meena}?month=2026-10` → 200, `Content-Type: text/csv;
    charset=utf-8`, `Content-Disposition` filename `statement-SKY-<code>-2026-10.csv`, body starts with the BOM;
    its credit and debit totals equal
    `SELECT kind, sum(amount_paise) FROM ledger_entries WHERE company_id=:A AND franchisee_id=:S AND
    technician_id=:meena AND technician_type='employee' AND kind <> 'payout' AND created_at >= '2026-09-30
    18:30+00' AND created_at < '2026-10-31 18:30+00' GROUP BY kind`.
11. **Reversal month.** A September penalty reversed in October: September's file still shows the debit; October's
    shows a `Penalty reversed` credit; re-downloading September returns a byte-identical body.
12. **Walls.** Priya with Ravi (freelancer, never employee) → 404; with Hema (H) → 404; Bala with Meena → 404;
    `month=2026-13` → 422; next month → 422; a facility operator → 403; Nisha → 403 on the `/franchise` route.
13. **Home staff twin.** Nisha `GET /ledger/statements/{hema}?month=2026-10` → CSV; an AM → 403; Nisha with Meena
    (S) → 404.
14. **Verify.** `app/scripts/seed/verify.py` passes on a seeded company with one employee; `pytest api/tests/unit`
    green.

---

## 8. Out of scope, traps and index notes

**Traps**

1. **Publish with Task 05** (its §8 trap 1).
2. **Task 10 changes `job_technician_type`'s body** to prefer `accept_snapshot.technicianType`, adding a
   `snapshot=` keyword that the three callers (`record_feedback`, `force_close_ticket`, `_hydrate`) pass —
   the gate itself stays in this one function (index §6 "T1 vs ordering").
3. `credited()` now filters the stream; Tasks 10/11 extend its **kinds**, never remove the stream filter.
4. The statement must stay kind-generic (`kind <> 'payout'`, no IN list) — Task 11 §4.13 checks this.
5. Don't hide reversed penalties in the statement (§4.9) — the Earnings rule (`shown_to_technician`) is the
   wrong rule for an accounting record.
6. `TicketOut.technicianType` must be null for vendors (like `technicianPayoutPaise`).
7. The CSV is not the envelope; don't wrap it, and don't let an exception escape after streaming starts — build
   the whole body first (it is one person's month: small), then return a plain `Response`.

**Out of scope:** recording salary; a per-franchisee summary CSV (Task 09 needs none — owner may ask later);
travel/speed rows themselves (Tasks 10/11); the mobile and console screens (Tasks 07/09/13).

**Index additions / inconsistencies for the owner**

* New error code **`TECHNICIAN_HAS_BALANCE`** (§4.5) — now in index §3.3, together with `TECHNICIAN_HAS_OPEN_JOBS` (owner ruling 2026-10-15).
* New modules `app/core/employment.py`, `app/core/statements.py`; `reserved` / `redeemable_balance` moved into
  `core/ledger.py`.
* New fields: `TicketOut.technicianType`, `RedeemableOut.technicianType` / `canRedeem`,
  `TechnicianSessionOut.technicianType` (Task 07 expects the last).
* Staff route `GET /ledger/statements/{technicianId}` for the home franchisee (index T4 names only the
  franchisee admin's download).
* Relies on `ledger_entries.technician_type` (Task 05 §3.3, itself an index addition).
* **Settled 2026-10-15 (R5):** the freelancer→employee balance rule (§4.5). **Still on written defaults (minor, listed
  in Task 16):** force-close ignores (not refuses) the payout for employees (§4.3); reversals appear in the month
  written (§4.9).
