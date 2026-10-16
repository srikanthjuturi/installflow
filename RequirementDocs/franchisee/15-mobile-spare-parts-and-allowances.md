# Task 15 — Mobile: spare-part requests, Awaiting Part, travel & speed on the job and in Earnings

> Layer: **mobileapp**. Depends on Tasks **12** (parts API, `Awaiting Part`), **10/11** (`JobOut.travel`,
> `JobOut.speed`, earnings breakdown), **14** (the base-location screen this links to) and builds **on Task
> 07's helpers** — `features/jobs/stage.ts` (`jobActions`), `components/ui/jobBadge.ts`,
> `features/earnings/ledger.ts`, `features/earnings/kindStyle.ts`, `features/profile/technicianType.ts`,
> `features/redeem/refusals.ts`, the *Awaiting part* badge and banner. Nothing here duplicates them.
> Read [00-index.md](00-index.md) (incl. §6a) first. Copy in §5.8 is **PROPOSED** (X2).

---

## 1. Goal & why

Task 07 taught the installed app to *survive* the new world — it knows `Awaiting Part`, the three new ledger
kinds and their titles. This task lets the technician *act* in it:

> **Worked example.** Ravi starts RGT-INST-0412 (a Front Load washer). The drain pump has seized.
>
> 1. On **Job details** (`In Progress`) he taps **Need a spare part**. The picker lists the parts this product
>    inherits (*Control board FL-7, Door lock, Drain pump…*), searchable. He picks **Drain pump**, adds the note
>    *motor seized, impeller fine*, taps **Request part**.
> 2. The job turns **Awaiting part** (Task 07's badge and banner). Below the banner: **Complete the job** is
>    shown **disabled** with *Waiting for parts*, and a **Spare parts** card lists *Drain pump · Requested ·
>    Waiting for the parts store to approve it.* He also finds the inlet hose split and requests **Other: inlet
>    hose clamp** — allowed while waiting (Task 12 D1).
> 3. A push arrives — *RGT-INST-0412: part approved*. Tapping it opens this job; the card now reads *Approved*.
>    Next day: *part issued*. When every request is issued or turned down, the server returns the job to
>    `In Progress` and **Complete** is live again.
> 4. Above the actions, a new **Allowances** card (frozen when he accepted): **27 km · ₹70 travel** and
>    **Finish within 12 h for ₹200 · after 24 h: −₹150** — *counted from your slot's start (or from when you
>    accepted, if that is later); time waiting for a part doesn't count* (owner ruling 2026-10-15).
> 5. On **Earnings**, the *Earned* tile now says *incl. ₹70 travel* and *Bonuses* *incl. ₹200 speed*; the rows
>    read *Travel allowance* and *Speed reward* (titles from Task 07).
>
> Had the facility **cancelled the approved pump** instead (the part can't be supplied), the card row would read
> *Approval cancelled · Approved earlier, then cancelled …: supplier failed*, a push *part approval cancelled* would
> arrive, and — with nothing else open — the job would return to `In Progress` (owner ruling 2026-10-15).
>
> Had Ravi's franchise **no parts store set up** (no facility admin or operator), **Need a spare part** would not be
> offered: a muted line says why instead (owner ruling 2026-10-15).
>
> Had Ravi accepted before setting a base, the travel line would read *No travel allowance — your base location
> wasn't set when you accepted* with **Set base location** (Task 14) for the next job.

---

## 2. Decisions implemented

| # | How |
|---|---|
| P2 / Task 12 D1 | *Need a spare part* while `In Progress` **or** `Awaiting Part` (Task 12's `REQUESTABLE_STATUSES`; the server's `canRequest` is what the picker obeys). |
| P3 | Raising a request moves the job to `Awaiting Part` (server); Complete shown disabled while any request is open; the server's `PARTS_PENDING` is translated (Task 07 key). Reschedule offered in `Awaiting Part` (Task 12 D8). |
| P4 / P5 | The technician only raises; the card shows each request's status and trail (no staff names — Task 12's technician shape carries none). No money. **A facility may reject an APPROVED request (owner ruling 2026-10-15, R2):** the card shows it as *Approval cancelled* with the reason; the technician still cannot cancel anything. |
| P8 (R4) | **Owner ruling 2026-10-15:** `partsEnabled === false` (the job's franchisee has no facility admin/operator) → **Need a spare part** is not offered; a muted line says why. The picker likewise. `NO_FACILITY` (409) has its own translated sentence. There is no staff fallback to point the technician at. |
| P7 | An *Other* request is typed; whether it joins the catalogue is the facility's choice, invisible here. |
| TA5 / TA8 / S3 / S5 | Travel and speed shown from the `JobOut` blocks after accept; reasons for ₹0 said in words; "time waiting for a part doesn't count"; **the speed note says the clock runs from the slot's start when that is later than the accept (owner ruling 2026-10-15, R1)**. No travel estimate before accept (R10). |
| Index §6a / Task 07 §4.3.2 | Earnings tiles stay as they are (folded figures); the breakdown is an *"incl."* line, **never added**. |
| Task 07 §4.3.6 / Task 12 D15 | Part pushes arrive as `type: 'job'` with `ticketId` — the existing tap handler already opens the job; this task only proves it with a test. |
| X2 | All new strings PROPOSED in five locale files. |

---

## 3. Schema

None.

---

## 4. API contract assumed (as written in Tasks 10, 11, 12)

### 4.1 Parts on a job — Task 12 §4.4 (`pool.view` + technician principal; a job not yours → 404)

```
GET  /jobs/{id}/parts            → JobPartsOut        (any status — history stays readable)
POST /jobs/{id}/part-requests    → JobPartsOut        201 "Part requested" · 200 "Already requested" (D3)
```

```jsonc
// JobPartsOut
{ "ticketId": "…", "code": "RGT-INST-0412", "status": "Awaiting Part",
  "partsEnabled": true,                                 // owner ruling 2026-10-15 (R4): false = the franchise has no facility admin/operator
  "canRequest": true,                                   // partsEnabled AND status ∈ REQUESTABLE_STATUSES
  "catalogue": [ { "id": "…", "name": "Control board FL-7" }, { "id": "…", "name": "Drain pump" } ],  // merged, sorted; [] when !canRequest
  "requests": [ { "id": "…", "code": "RGT-SPR-0007", "partName": "Drain pump", "isOther": false,
                  "note": "motor seized, impeller fine", "status": "approved",      // requested|approved|rejected|issued|returned
                  "createdAt": "…", "decidedAt": "…", "rejectReason": null,
                  "rejectedAfterApproval": false,      // owner ruling 2026-10-15 (R2): rejected after it had been approved
                  "issuedAt": null, "issueNote": null, "returnedAt": null } ] }

// POST body — exactly one of sparePartId / otherName (422 otherwise)
{ "sparePartId": "…" | null, "otherName": "Inlet hose clamp" | null, "note": "…" | null }
```

Limits: `otherName` 1–120 after normalising; `note` ≤ 500. Errors: 409 `PART_REQUEST_NOT_IN_PROGRESS`; **409 `NO_FACILITY`** (owner ruling 2026-10-15, R4 — the franchise has no facility staff; `GET /jobs/{id}` carries the same `partsEnabled` so the screen knows before it asks);
404 for a `sparePartId` not in this job's list. A repeat of an open request's name is **idempotent** (200, the
existing request). The catalogue is **flat and de-duplicated** (deepest owner wins, D11) — it carries no
"inherited from" grouping, so the picker does not invent one.

`POST /jobs/{id}/complete` → 409 **`PARTS_PENDING`** while any request is `requested`/`approved`.
Reschedule (`/jobs/{id}/reschedule…`) accepts `Awaiting Part` and keeps that status (D8). Cancel stays
`Assigned`-only (D7). The `job.changed` socket frame fires on every part action, and the job's `status` flips
`In Progress ↔ Awaiting Part` server-side (D5).

### 4.2 Allowances on the job — Task 10 §4.5, Task 11 §4.12 (`JobOut` only, never the pool offer)

```jsonc
"travel": { "km": 27.0, "amountPaise": 7000, "reason": null } | null,   // reason: null | no_base_location | no_customer_point
"speed":  { "rewardWithinHours": 12, "penaltyAfterHours": 24, "rewardPaise": 20000, "penaltyPaise": 15000,
            "clockStartedAt": "2026-10-15T05:30:00Z",                   // R1: max(accepted, the slot's start) — display only
            "clockFromSlot": true } | null                              // true = the slot start is the later half (usual); null = no rule (S2) or pre-Task-11
```

Both `null` for a job accepted before Tasks 10/11. `JobOut` (not the pool offer) also carries `partsEnabled: bool` (Task 12 §4.4). There is **no** travel estimate on the pool offer (owner ruling 2026-10-15, R10) — the Allowances card exists only after accept.

### 4.3 Earnings — Tasks 10 §4.6, 11 §4.8, index §6a

`GET /earnings/summary` keeps `netPaise = earnedPaise + bonusesPaise − penaltiesPaise` with travel **folded into**
`earnedPaise`, `speed_reward` into `bonusesPaise`, `speed_penalty` into `penaltiesPaise`, and adds **breakdown**
fields (subsets, never extra terms). Names per **index §6a**: `travelPaise`, `speedRewardPaise`,
`speedPenaltyPaise`. Task 11 uses the same singular names (settled). The mapper still treats a missing field as "no
breakdown line", never as a wrong number. Transactions: kinds `travel`, `speed_reward`, `speed_penalty` with
titles exactly *Travel allowance*, *Speed reward*, *Speed penalty* (Task 07 renders them).

### 4.4 Pushes — Task 12 D15 / §4.9

`part.approved`, `part.rejected`, **`part.rejected_after_approval`** (owner ruling 2026-10-15, R2), `part.issued` (all five languages, server-written), sent with
`data = { type: 'job', ticketId, code }`. Nothing on return. Every facility action (return included) and the technician's own
request also fire `job.changed` on the socket (Task 12 §4.5 step 8).

---

## 5. Client changes

All paths under `mobileapp/`. Hard rules: `app/` routes ~15 lines; screens in `src/features/*/screens`; server
state in TanStack Query; no hex outside `src/theme`; semantic roles; static classes; loading / empty / error.

### 5.1 `jobActions` learns parts (extends Task 07's `src/features/jobs/stage.ts`)

```ts
export interface JobActions {
  stage: JobStage;
  canCancel: boolean;
  canReschedule: boolean;
  /** NEW — Task 12 D1. The server's `canRequest` is the final word; this decides whether to SHOW the button. */
  canRequestPart: boolean;
}

case 'In Progress':   return { stage: 'complete',     canCancel: false, canReschedule: false, canRequestPart: true };
case 'Awaiting Part': return { stage: 'awaitingPart', canCancel: false,
                               canReschedule: job.hoursToSlot !== null,   // D8: the revisit uses reschedule
                               canRequestPart: true };
// every other branch: canRequestPart: false
```

Update Task 07's `src/features/jobs/__tests__/stage.test.ts` case for `Awaiting Part` (it asserted
`canReschedule: false`; now `true` with a slot, `false` without) and add `canRequestPart` to every case.

### 5.2 Types, API, hooks — new slice `src/features/parts/` (index §3.7)

| File | What |
|---|---|
| `src/features/parts/types.ts` | `PartRequestStatus = 'requested' \| 'approved' \| 'rejected' \| 'issued' \| 'returned'`; `PartRequest { id; code; partName; isOther; note: string \| null; status: string; createdAt; decidedAt: string \| null; rejectReason: string \| null; rejectedAfterApproval: boolean; issuedAt: string \| null; issueNote: string \| null; returnedAt: string \| null }` (`status` a **string**: a newer word must not break the card; `rejectedAfterApproval` `?? false`); `CataloguePart { id; name }`; `JobParts { partsEnabled: boolean \| null; canRequest: boolean; catalogue: CataloguePart[]; requests: PartRequest[] }` (`partsEnabled` **null = the server did not say**, treated as enabled). |
| `src/features/parts/api/parts.ts` | `getJobParts(jobId) → authedRequest<JobPartsDto>(\`/jobs/${jobId}/parts\`)` mapped to `JobParts` (`?? []` / `?? false` on every field — an older server sends nothing); `requestPart(jobId, body: PartRequestBody)` → `POST /jobs/{id}/part-requests`. |
| `src/lib/queryKeys.ts` | `jobParts: (id: string) => ['jobs', id, 'parts'] as const` — under `['jobs', id]` on purpose, like `rescheduleSlots`: the socket's `job.changed` and every `job` push already invalidate that prefix, so a facility decision refreshes the card with no new wiring. |
| `src/features/parts/hooks/useJobParts.ts` | `useQuery({ queryKey: qk.jobParts(id), queryFn, enabled: !!id && enabled, refetchOnWindowFocus: true })`. `enabled` = the job has been started (`serverStatus` not `Assigned`/`New`/`Slot Pending`) — before that there is nothing to show and nothing to ask. |
| `src/features/parts/hooks/useRequestPart.ts` | `useMutation({ mutationFn, onSuccess(data) })`: `setQueryData(qk.jobParts(id), data)`; invalidate `qk.job(id)` (status moved), `['jobs','mine']`, `[...qk.myJobs('all'), 'today']` — the `useCompleteJob` set; `trackPartRequested(jobId)` in `lib/analytics/events.ts` (optional, production-only like the rest). |
| `src/features/jobs/api/jobs.ts` | `JobDto` gains `travel?: { km: number; amountPaise: number; reason: string \| null } \| null` and `speed?: { rewardWithinHours: number; penaltyAfterHours: number; rewardPaise: number; penaltyPaise: number; clockStartedAt: string; clockFromSlot?: boolean } \| null` and `partsEnabled?: boolean`; `toAcceptedJob` maps `travel: dto.travel ?? null`, `speed: dto.speed ?? null`, `partsEnabled: dto.partsEnabled ?? null`. |
| `src/types/domain.ts` | `Job.travel?: JobTravel \| null`, `Job.speed?: JobSpeed \| null`, `Job.partsEnabled?: boolean \| null` (optional + nullable: a pool offer never has them; an old API sends nothing). Interfaces `JobTravel`, `JobSpeed` as above. `EarningsSummary` gains `travelPaise: number \| null`, `speedRewardPaise: number \| null`, `speedPenaltyPaise: number \| null` — **null = the server did not say**, never 0. |
| `src/features/earnings/api/earnings.ts` | `SummaryDto` gains the three optional fields; the mapper writes `?? null`. |

### 5.3 Pure helpers (tested in §6)

**`src/features/parts/partStatus.ts`** — the `features/redeem/format.ts` `STATE_PILL` pattern:

```ts
// Owner ruling 2026-10-15 (R2): a request rejected AFTER approval reads 'Approval cancelled' (parts.state.cancelled), tone danger.
export const PART_PILL = {
  requested: { label: 'parts.state.requested', tone: 'secondary' },
  approved:  { label: 'parts.state.approved',  tone: 'primary' },
  issued:    { label: 'parts.state.issued',    tone: 'success' },
  returned:  { label: 'parts.state.returned',  tone: 'neutral' },
  rejected:  { label: 'parts.state.rejected',  tone: 'danger' },
} as const satisfies Record<PartRequestStatus, { label: ParseKeys; tone: PillTone }>;

export const UNKNOWN_PILL = { label: 'parts.state.unknown', tone: 'neutral' } as const;
export function partPill(status: unknown, rejectedAfterApproval?: boolean): { label: ParseKeys; tone: PillTone };   // own-property lookup, unknown → UNKNOWN_PILL; ('rejected', true) → parts.state.cancelled
export function isOpen(status: unknown): boolean;                                    // requested | approved
export function blocksCompletion(requests: Pick<PartRequest, 'status'>[]): boolean;  // any open (a request rejected after approval is NOT open)
/** R4 (owner ruling 2026-10-15). 'button' | 'unavailable' (partsEnabled === false) | 'none' (the stage cannot request). null/undefined partsEnabled → as enabled. */
export function needPartMode(canRequestPart: boolean, partsEnabled: boolean | null | undefined): 'button' | 'unavailable' | 'none';
/** Ordered lines for the card, as keys + params; dates stay ISO and are worded at render. */
export function partTrail(r: PartRequest): { key: ParseKeys; params: Record<string, string> }[];
//   requested → [hint.requested] · approved → [approved{when}, hint.approved]
//   issued → [approved, issued{when}(+ issueNote), hint.issued] · returned → [approved, issued, returned{when}]
//   rejected → [rejected{when, reason}]   · rejected with rejectedAfterApproval → [rejectedAfterApproval{when, reason}]   · unknown → []
```

**`src/features/parts/picker.ts`**

```ts
export function filterParts(parts: CataloguePart[], query: string): CataloguePart[];  // trim, case-insensitive, substring; '' → all
export const OTHER = '__other__';
export const MAX_OTHER = 120; export const MAX_NOTE = 500;
export type PartRequestBody = { sparePartId: string; otherName: null; note: string | null }
                            | { sparePartId: null; otherName: string; note: string | null };
/** null when the selection is not sendable yet — the button's disabled state reads this. */
export function buildPartRequest(selected: string | null, otherName: string, note: string): PartRequestBody | null;
export function wasAlreadyRequested(before: PartRequest[], after: PartRequest[]): boolean; // same ids → the 200 "Already requested"
```

**`src/features/jobs/allowances.ts`**

```ts
type Line = { key: ParseKeys; params?: Record<string, string> ; action?: 'setBase' };
export function travelLine(t: JobTravel | null | undefined, fmt: (p: number) => string): Line | null;
//   null/undefined → null (no line)
//   reason no_base_location   → jobs.allowances.travelNoBase, action 'setBase'
//   reason no_customer_point  → jobs.allowances.travelNoCustomer
//   amountPaise > 0           → jobs.allowances.travel { km: '27', amount: '₹70' }   (km: 1 dp, trailing .0 dropped)
//   else                      → jobs.allowances.travelNone { km }
export function speedLines(s: JobSpeed | null | undefined, fmt): Line[];
//   null → []; reward > 0 → speedReward{hours, amount}; penalty > 0 → speedPenalty{hours, amount};
//   both 0 → [] (W2: speed is switched off for this product); any line → also ONE note (owner ruling 2026-10-15, R1):
//   speedNoteSlot when s.clockFromSlot === true, else speedNoteAccept (an older server omits the flag → the accept note)
```

**`src/features/earnings/breakdown.ts`**

```ts
/** "incl." lines under the three tiles. Null/0 → no line. Never added to anything. */
export function breakdown(s: EarningsSummary): { earned?: number; bonuses?: number; penalties?: number };
//   earned ← travelPaise, bonuses ← speedRewardPaise, penalties ← speedPenaltyPaise
```

**`src/features/notifications/pushRoute.ts`** — extract the pure half of `usePushRegistration`'s `open()`:
`pushRoute(data: unknown): string | null` (`redemption` → `/redeem/{id}`, `upi_change` → `/payout-account`,
`pool` → `/pool/{id}`, `job` → `/job/{id}`, else `null`). The hook calls it; behaviour is unchanged. This is
what proves a part push opens the job.

### 5.4 Job detail — `src/features/jobs/screens/JobDetailScreen.tsx` (Task 07's `stage` chain)

| `stage` | After this task |
|---|---|
| `complete` (`In Progress`) | **Complete the job** (unchanged) — but **disabled** with `disabledHint` `jobs.detail.completeWaitingParts` when `blocksCompletion(parts.requests)` (a request raised from another device before the status refetched; the server's `PARTS_PENDING` still guards). Then, by `needPartMode(actions.canRequestPart, job.partsEnabled)`: `'button'` → **Need a spare part** (`variant="outline"`, `leadingIcon="wrench"`) → `/job/{id}/parts`; **`'unavailable'` → no button, a muted line `jobs.detail.partsUnavailable` (owner ruling 2026-10-15, R4)** in `color.textMuted` 12.5 beneath the actions; `'none'` → nothing. |
| `awaitingPart` | Task 07's banner (unchanged), then **Complete the job** shown **disabled** with `disabledHint` `jobs.detail.completeWaitingParts` (Button already renders the hint beneath — the prototype's "always say why"), then **Need a spare part** (or the muted `partsUnavailable` line, same rule) , then **Reschedule with the customer** when `actions.canReschedule` (the existing button and route; the revisit). No cancel (D7). |
| all others | unchanged |

New cards, in this order, **above** `CustomerVerdict` and the actions:

1. **`AllowancesCard`** (`src/features/jobs/components/AllowancesCard.tsx`) — renders nothing when
   `travelLine` is null **and** `speedLines` is empty. Eyebrow `jobs.allowances.title` in the existing
   `CardLabel` style; one row per line (icon `navigation` for travel, `clock` for speed; `Roboto_500Medium`
   13.5); the `setBase` action renders a text link `jobs.allowances.setBase` → `router.push('/base-location')`.
   The speed note in `color.textMuted` 12. Amounts through `utils/money.formatPaise`; never computed here.
   Employees see it too (T3).
2. **`PartRequestsCard`** (`src/features/parts/components/PartRequestsCard.tsx`) — shown when the parts query is
   enabled. States (mobile rule 5): pending → two `Skeleton` rows; error → a compact `ErrorState` with retry
   (inside the card, so the rest of the screen stays usable); empty → **nothing** (the *Need a spare part*
   button is the empty state's action; an empty card saying "no parts" on every started job is noise). Each
   request: part name (`Roboto_700Bold`), *Other* `Pill` when `isOther`, the status `Pill` from `partPill(status, rejectedAfterApproval)`, the
   code in `RobotoMono` 11, the note in quotes, then `partTrail` lines (dates via `utils/date.momentLabel` at
   render). Rows are not pressable (nothing to open).

`useJobParts(jobId, { enabled: started })` is called at the top of the screen with the other hooks — never
conditionally.

### 5.5 The picker — `/job/[id]/parts`

```tsx
// app/(app)/job/[id]/parts.tsx
import { useLocalSearchParams } from 'expo-router';
import { PartRequestScreen } from '@/features/parts/screens/PartRequestScreen';

/** Ask the parts store for a spare part on this job. */
export default function PartRequestRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <PartRequestScreen jobId={id} />;
}
```

**`src/features/parts/screens/PartRequestScreen.tsx`** — mirrors `CancelJobScreen` (the reason list):
`ScreenStatusBar` + `TitleBar` (`parts.request.title`), a `ScrollView` body and a fixed footer above a hairline
with one `Button` whose label **is** the requirement while blocked (`parts.request.selectPart` →
`parts.request.typeName` → `parts.request.submit`), exactly as the cancel screen's *Select a reason*.

1. Intro `parts.request.intro`.
2. States from `useJobParts(jobId)`: pending → `Skeleton` rows; error → `ErrorState` (retry); `partsEnabled === false` →
   a notice `parts.request.noFacility` and no footer button (owner ruling 2026-10-15, R4); otherwise `!canRequest` →
   a notice `parts.request.notNow` and no footer button (the status moved while the screen was open).
3. Search `Input` (`parts.request.search`), shown when the catalogue has **more than 8** parts;
   `filterParts`. No match → `parts.request.noMatch` with the query.
4. The list: one radio row per part (the `CancelJobScreen` row markup — 22 px ring, `borderFocus` when selected,
   `accessibilityRole="radio"`, `accessibilityState={{ selected }}`). Part names are catalogue data — shown as
   sent, never translated (README "Server text").
5. Empty catalogue → the line `parts.request.noParts` above the *Other* row (it is the only option then).
6. Last row, always: **Other — not on the list**; selecting it reveals an `Input` (`parts.request.otherLabel`,
   `maxLength={MAX_OTHER}`, autofocus).
7. `Input` for the note (`parts.request.noteLabel`, multiline, `maxLength={MAX_NOTE}`), optional.
8. Submit → `useRequestPart(jobId).mutate(buildPartRequest(...))`. Success: `toast(t(wasAlreadyRequested(before,
   after) ? 'parts.request.already' : 'parts.request.sent'))`, `router.back()` — Job detail shows the new card
   row and, on the first request, the *Awaiting part* banner (seeded status refetch). Error: the server's
   sentence through `errorText(error, t('parts.request.failed'))` above the button (`accessibilityRole="alert"`),
   the `CancelJobScreen` pattern; `PART_REQUEST_NOT_IN_PROGRESS` and `NO_FACILITY` have their own keys.

Keyboard: the body and footer sit in `components/layout/KeyboardFlow` (the coverage screen's pattern) so the
button rides above the keyboard while typing *Other* or the note.

### 5.6 Earnings — `src/features/earnings/screens/EarningsScreen.tsx`

The three `ChromeTile`s keep their server figures (Task 07: unchanged). `ChromeTile` gains an optional `sub`
string drawn under the value in `color.textOnChrome`, 11 px: Earned `earnings.inclTravel`, Bonuses
`earnings.inclSpeed`, Penalties `earnings.inclSpeedPenalty`, from `breakdown(summary)` and `formatPaise`. A
missing or zero breakdown → no `sub`. Nothing is summed in the app.

Rows: nothing new — Task 07's `toTransaction`, `kindStyle` (travel = navigation/credit, speed_reward =
zap/credit, speed_penalty = clock/debit) and `ledgerTitle` already render them. A `travel` row's `ticketId` opens
the job (the server decides, as for payouts).

### 5.7 Pushes — no behavioural change

`usePushRegistration` already: (received) invalidates `['jobs']`, `qk.earnings()`, `qk.me()` on `type === 'job'`
— which covers `qk.jobParts(id)`; (tapped) opens `/job/{ticketId}`. This task only moves the route decision into
`pushRoute.ts` and tests it (§6). The push **words** are Task 12's (`app/core/push_text.py`, five languages); this
task adds *Spare part* to the README glossary they must match (§5.8).

### 5.8 PROPOSED copy — `src/i18n/locales/en.json` (+ hi, te, kn, ta)

All five files, translated per `src/i18n/README.md`, queued for native review. Task 07 already owns
`jobs.status.awaitingPart`, `jobs.detail.awaitingPart`, `errors.code.PARTS_PENDING` and the three
`server.ledgerTitle.*` keys — **not repeated here**.

| Key | English (PROPOSED) |
|---|---|
| `jobs.detail.needPart` | Need a spare part |
| `jobs.detail.completeWaitingParts` | Waiting for parts |
| `jobs.allowances.title` | Allowances |
| `jobs.allowances.travel` | {{km}} km · {{amount}} travel |
| `jobs.allowances.travelNone` | {{km}} km · no travel allowance |
| `jobs.allowances.travelNoBase` | No travel allowance — your base location wasn't set when you accepted. |
| `jobs.allowances.setBase` | Set base location |
| `jobs.allowances.travelNoCustomer` | No travel allowance — the customer's location isn't known. |
| `jobs.allowances.speedReward` | Finish within {{hours}} h for {{amount}} |
| `jobs.allowances.speedPenalty` | After {{hours}} h: −{{amount}} |
| `jobs.allowances.speedNoteSlot` | Counted from your slot's start. Time waiting for a part doesn't count. |
| `jobs.allowances.speedNoteAccept` | Counted from when you accepted. Time waiting for a part doesn't count. |
| `jobs.detail.partsUnavailable` | Spare parts can't be requested for this job — your franchise has no parts store set up yet. Ask your franchise admin. |
| `parts.request.noFacility` | Your franchise has no parts store set up yet, so a part can't be requested here. Ask your franchise admin. |
| `parts.request.title` | Request a spare part |
| `parts.request.intro` | Pick the part you need. The parts store approves it and hands it to you. |
| `parts.request.search` | Search parts |
| `parts.request.noMatch` | No part matches "{{query}}". Choose Other and type it. |
| `parts.request.noParts` | No parts are listed for this product yet. Choose Other and type the part. |
| `parts.request.other` | Other — not on the list |
| `parts.request.otherLabel` | Part name |
| `parts.request.otherPlaceholder` | What part do you need? |
| `parts.request.noteLabel` | Note for the store (optional) |
| `parts.request.notePlaceholder` | Size, model, what broke… |
| `parts.request.selectPart` | Select a part |
| `parts.request.typeName` | Type the part's name |
| `parts.request.submit` | Request part |
| `parts.request.sent` | Part requested |
| `parts.request.already` | Already requested — it's on the list. |
| `parts.request.failed` | Couldn't send your request. Try again. |
| `parts.request.notNow` | You can ask for a part only while the job is in progress. |
| `parts.card.title` | Spare parts |
| `parts.card.other` | Other |
| `parts.state.requested` | Requested |
| `parts.state.approved` | Approved |
| `parts.state.issued` | Issued |
| `parts.state.returned` | Returned |
| `parts.state.rejected` | Not approved |
| `parts.state.cancelled` | Approval cancelled |
| `parts.state.unknown` | Updated |
| `parts.trail.approved` | Approved {{when}} |
| `parts.trail.rejected` | Not approved {{when}}: {{reason}} |
| `parts.trail.rejectedAfterApproval` | Approved earlier, then cancelled {{when}}: {{reason}} |
| `parts.trail.issued` | Issued to you {{when}} |
| `parts.trail.issuedNote` | Store's note: {{note}} |
| `parts.trail.returned` | Old part handed back {{when}} |
| `parts.hint.requested` | Waiting for the parts store to approve it. |
| `parts.hint.approved` | You'll be told when it's ready to collect. |
| `parts.hint.issued` | Hand the old part back to the store. |
| `parts.loadFailed` | Couldn't load your part requests. |
| `earnings.inclTravel` | incl. {{amount}} travel |
| `earnings.inclSpeed` | incl. {{amount}} speed |
| `earnings.inclSpeedPenalty` | incl. {{amount}} speed |
| `errors.code.PART_REQUEST_NOT_IN_PROGRESS` | You can ask for a spare part only while the job is in progress. |
| `errors.code.NO_FACILITY` | Your franchise has no parts store set up yet, so a part can't be requested here. Ask your franchise admin. |

**Glossary addition** (`src/i18n/README.md`; Task 12's push text uses the same words):

| English | हिन्दी | తెలుగు | ಕನ್ನಡ | தமிழ் |
|---|---|---|---|---|
| Spare part | स्पेयर पार्ट | స్పేర్ పార్ట్ | ಸ್ಪೇರ್ ಪಾರ್ಟ್ | ஸ்பேர் பார்ட் |
| Parts store | पार्ट्स स्टोर | పార్ట్స్ స్టోర్ | ಪಾರ್ಟ್ಸ್ ಸ್ಟೋರ್ | பார்ட்ஸ் ஸ்டோர் |
| Allowance | भत्ता | భత్యం | ಭತ್ಯೆ | படி |

(*Travel allowance* is Task 14's glossary row.)

### 5.9 Skill update

`.claude/skills/reliance-greentech-tech-app/SKILL.md` §2: add `(app)/job/[id]/parts` — **NEW**, not in the
prototype, copy approved separately; §3 "7 — Job detail": the Allowances and Spare parts cards and the two new
actions, with the same "not from the prototype" warning the Reschedule entry carries.

---

## 6. Unit tests (jest-expo — Task 00 harness, `**/__tests__/**/*.test.ts?(x)`)

| File | Cases |
|---|---|
| `src/features/parts/__tests__/partStatus.test.ts` | `partPill` for all five statuses (label key + tone); `partPill('rejected', true)` → `parts.state.cancelled` (danger), `partPill('issued', true)` ignores the flag; `'cancelled'`, `''`, `'constructor'`, `'__proto__'`, `undefined`, `42` → `UNKNOWN_PILL`. `isOpen`: requested/approved true; others false. `blocksCompletion`: `[]` false; `[issued, rejected, returned]` false; any requested/approved → true; an unknown status alone → false. `partTrail`: requested → `[hint.requested]`; approved → `[approved, hint.approved]`; issued with `issueNote` → `[approved, issued, issuedNote, hint.issued]`; returned → three lines ending `returned`; rejected → one line carrying `reason`; rejected with `rejectedAfterApproval` → one `rejectedAfterApproval` line carrying `reason`; unknown → `[]`. `needPartMode`: `(true, true)`/`(true, null)`/`(true, undefined)` → `'button'`; `(true, false)` → `'unavailable'`; `(false, false)`/`(false, true)` → `'none'`. Every key exists in `en.json` (iterate). |
| `src/features/parts/__tests__/picker.test.ts` | `filterParts`: `''` and `'  '` → all; `'pump'` matches `Drain pump` case-insensitively; no match → `[]`; order preserved. `buildPartRequest`: nothing selected → null; a part id → `{sparePartId, otherName: null, note: null}`; note `'  x  '` → `'x'`, `'   '` → `null`; `OTHER` + `''`/`'   '` → null; `OTHER` + `' clamp '` → `{sparePartId: null, otherName: 'clamp'}`; `OTHER` + 121 chars → null; note of 501 chars → null. `wasAlreadyRequested`: same id set → true; one more → false. |
| `src/features/jobs/__tests__/allowances.test.ts` | `travelLine`: undefined/null → null; `no_base_location` → `travelNoBase` with `action: 'setBase'`; `no_customer_point` → `travelNoCustomer`; `{km: 27, amountPaise: 7000}` → `travel` `{km: '27', amount: '₹70'}`; `km 28.1` → `'28.1'`; amount 0 with km 12 → `travelNone`. `speedLines`: null → `[]`; reward only with `clockFromSlot: true` → `[speedReward, speedNoteSlot]`; the same with the flag false or absent → `[speedReward, speedNoteAccept]`; both amounts → three lines; `0/0` → `[]`. |
| `src/features/earnings/__tests__/breakdown.test.ts` | all null → `{}`; travel 7000 → `{earned: 7000}`; zeros → `{}`; all three set → all three; the function never returns a sum. |
| `src/features/jobs/__tests__/stage.test.ts` (Task 07's — updated) | `Awaiting Part` with a slot → `canReschedule: true, canRequestPart: true, canCancel: false`; with `hoursToSlot: null` → `canReschedule: false`; `In Progress` → `canRequestPart: true`; every other status `canRequestPart: false`. |
| `src/features/notifications/__tests__/pushRoute.test.ts` | `{type:'job', ticketId:'t1', code:'RGT-INST-0412'}` → `/job/t1` (a part push); `pool` → `/pool/t1`; `redemption` with id → `/redeem/r1`; `upi_change` → `/payout-account`; `job` without `ticketId`, `{type:'part'}`, `null`, `'x'` → `null`. |

---

## 7. Acceptance criteria

Dev-client build against the dev API with Tasks 10, 11, 12 deployed (Task 07 already in the build).

1. **Given** an `In Progress` job, **when** the technician opens Job details, **then** *Complete the job* and
   *Need a spare part* are shown, and no Spare parts card appears while there are no requests.
2. **When** they open the picker, **then** a skeleton shows, then the catalogue as radio rows with *Other — not on
   the list* last; with more than 8 parts a search box filters them; a search with no match shows the no-match line.
3. **Given** a product with no parts, only *Other* is offered, under *No parts are listed…*.
4. **When** they pick *Drain pump*, add a note and tap *Request part*, **then** `POST /jobs/{id}/part-requests`
   carries `{sparePartId, otherName: null, note}`, the toast *Part requested* shows, Job details shows the
   *Awaiting part* badge + banner, a disabled *Complete the job* with *Waiting for parts* beneath, and the card row
   *Drain pump · Requested · Waiting for the parts store to approve it.*
5. **Given** *Other* selected with an empty name, the button reads *Type the part's name* and is disabled;
   121 characters cannot be typed.
6. **Given** the same part requested twice (double tap / second device), the second answer shows *Already
   requested — it's on the list.* and the card still has one row.
7. **Given** `Awaiting Part`, a second request (*Other: inlet hose clamp*) can be raised; *Reschedule with the
   customer* is offered when the job has a slot and opens the existing reschedule flow; there is no *Cancel*.
8. **Given** the facility approves, **then** a push *RGT-INST-0412: part approved* arrives (in the phone's
   language); with the app open the card updates to *Approved* without a pull; tapping the push opens this job.
   **When** the facility then rejects the approved request (owner ruling 2026-10-15, R2), **then** a *part approval
    cancelled* push arrives, the card row reads *Approval cancelled · Approved earlier, then cancelled …: {reason}*, and with
    nothing else open the job returns to *In progress* with *Complete the job* enabled.
9. **Given** every request issued or rejected, **then** the job returns to `In Progress` (badge *In progress*),
   *Complete the job* is enabled, and completing works; a rejected row shows *Not approved {when}: {reason}*.
10. **Given** a stale screen showing *Complete* while a request is open (raised from elsewhere), tapping it shows
    Task 07's translated `PARTS_PENDING` sentence; nothing crashes.
11. **Given** the picker open while the job moved out of a requestable status, it shows *You can ask for a part only
    while the job is in progress.* and no submit button; forcing a POST shows the translated
    `PART_REQUEST_NOT_IN_PROGRESS`.
12. **Given** a job accepted after Tasks 10/11 with a base and a rule, the Allowances card shows *27 km · ₹70
    travel*, *Finish within 12 h for ₹200*, *After 24 h: −₹150* and the note — *Counted from your slot's start…* when
    the slot starts after the accept (`clockFromSlot`), *Counted from when you accepted…* otherwise; with no base at accept it shows
    the no-base line and *Set base location* opens Task 14's screen; with no rule only the travel line shows; a job
    accepted before the deploy shows no card.
13. **Given** a week with travel ₹70 and a speed reward ₹200, Earnings shows *incl. ₹70 travel* under *Earned* and
    *incl. ₹200 speed* under *Bonuses*, and **net still equals earned + bonuses − penalties as the server sent
    them**; rows read *Travel allowance* and *Speed reward*. Against a server without the breakdown fields, no
    *incl.* lines appear.
14. **Lists and states:** the parts card and picker show skeleton, error-with-retry and (picker) the empty-catalogue
    state; the card shows nothing on a started job with no requests.
15. **Languages:** with हिन्दी selected every new string is Hindi; part names, codes and the facility's reason are
    shown as sent.
16a. **No parts store (owner ruling 2026-10-15, R4).** **Given** the job's franchise has no facility admin/operator
    (`partsEnabled: false`), then *Need a spare part* is not shown on an `In Progress` job and the muted *Spare parts can't
    be requested for this job…* line is; opening `/job/{id}/parts` directly shows *Your franchise has no parts store…* and
    no submit button; a forced POST shows the translated `NO_FACILITY` sentence. **Given** a server that omits
    `partsEnabled`, the button behaves as before.
16. **Gates:** `npm run lint` (incl. `i18n:check`), `npm run typecheck`, `npm test` pass; no hex outside
    `src/theme`; `app/(app)/job/[id]/parts.tsx` is a ~10-line route.

---

## 8. Out of scope / traps

- **Out of scope:** the facility side (Task 13); photos from the technician (the store photographs the returned
  part, P4); the technician cancelling a request (only the facility rejects one, including after approval — R2); travel estimates on the pool offer (Task 10 W4, **ruled out 2026-10-15, R10**); speed on
  force-close (S5, **settled R7**); a countdown to the speed deadline — the clock pauses in `Awaiting Part` and its true end is the
  server's, so a phone-side countdown would be a guess (a follow-up could send the deadline from the server).
- **X4 / release order.** Unlike Task 07, this build gates no API release — it only *adds* UI. But its `jobActions`
  change offers *Reschedule* and *Need a spare part* in `Awaiting Part`, which **requires Task 12's server**
  (D1, D8). Ship this build after Task 12 is published, or an older server answers those buttons with
  `JOB_NOT_RESCHEDULABLE` / 404.
- **The breakdown is never a fourth term.** `earned` already includes travel (index §6a). Adding `travelPaise` to
  anything double-counts it. A server that does not send a breakdown field degrades to "no line", by design.
- **`canRequest` beats `canRequestPart`.** The stage helper decides whether to show the button; the server's
  `canRequest` decides whether the picker submits. Do not hard-code `REQUESTABLE_STATUSES` anywhere else.
- **Part names are data, not copy** — never through `t()`; *Other*'s typed name likewise.
- **Disabled Complete in `Awaiting Part`** changes Task 07's "no buttons" banner. It is a deliberate addition: a
  technician should see where Complete will be, and why it is not available yet (the Button's `disabledHint`).
- **Do not poll** the parts query. The socket's `job.changed` and the `job` push already invalidate
  `['jobs', id]`; `refetchOnWindowFocus` covers a dead socket on return to the app.
- **Translations are first drafts** (README review table); the glossary rows must match Task 12's push text.
- **Commit rhythm:** one per screen — (1) helpers + `jobActions` + tests, (2) picker screen, (3) Job detail cards
  and actions, (4) Earnings breakdown, (5) `pushRoute` extraction. `npm run lint && npm run typecheck` first.
