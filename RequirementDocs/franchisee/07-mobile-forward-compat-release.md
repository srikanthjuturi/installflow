# Task 07 — Mobile forward-compatibility release

> Layer: **mobile** (`mobileapp/`) · Depends on: **06** (API exposes `technicianType`) and **00** (jest-expo)
> · Gate for: **10, 11, 12** (index X4 and release gate (a)) · Copy sign-off: index §7 "07".
>
> Read `00-index.md` first. Every name used here (ledger kinds, status, error codes, `technicianType`)
> is the index's. Where this doc had to pick something the index does not name, it says
> **Decision (writer):**, and the owner can overrule it.

---

## 1. Goal and why

### In plain words

The technician app installed on people's phones today knows exactly three kinds of money row —
`payout`, `bonus`, `penalty` — and ten ticket statuses. Tasks 10, 11 and 12 add three new kinds of
money row (`travel`, `speed_reward`, `speed_penalty`) and one new status (`Awaiting Part`). An app
that meets a word it has never heard of has to do something sensible with it. Today's build does
not, and for the money rows it **crashes**.

So before the API learns those words, a new build must be on Google Play that:

1. **survives any word it does not know** — draws a plain, neutral row or a "please update the app"
   note instead of falling over, now and for every word added after this one;
2. **already knows the four new words** — the right icon, colour, sign, label and buttons;
3. **knows whether the technician is an employee** (Task 06) — employees are paid through salary
   (T2, T4), so the app stops offering them Redeem and stops showing them a per-job payout figure.

### Worked example — what happens today

Ravi is on build 1.0.0 (versionCode N, whatever is live today). Task 10 ships. Ravi closes a job
27 km from home; the API writes two ledger rows in one transaction: `payout ₹450` and
`travel ₹40`. Ravi opens **Earnings**:

```
EarningsScreen.tsx  LedgerRow:  const style = KIND_STYLE[txn.kind];   // KIND_STYLE['travel'] → undefined
                                backgroundColor: style.bg             // TypeError: Cannot read property 'bg' of undefined
```

There is no React error boundary anywhere in the app (`grep -r ErrorBoundary app src` → nothing),
so the TypeError during render is a fatal JS exception: the app closes. It closes again every time
he opens Earnings while that row is in the window he is looking at. He cannot see his money.

Now `Awaiting Part` (Task 12). Today's build maps an unknown status to `upcoming`
(`features/jobs/api/jobs.ts` `toJobStatus`), so it does **not** crash — it **misbehaves**:
the badge reads *Upcoming* / *Starting soon* / *Slot closed*, and Job detail falls through to the
`!done` branch and offers **"Start job & capture proof"**, which leads to four photos and then a
server refusal.

### Worked example — after this release

Same row, new build: `travel` is known → navigation icon, green, `+₹40`, title *Travel allowance*
(translated). A row of kind `something_new` that a 2027 task invents → grey info icon, `₹40` with
no sign (the app does not know which way it points), title exactly as the server sent it. Nothing
crashes. A job in `Awaiting Part` sits under **In progress** with an amber **Awaiting part** badge,
and Job detail shows a banner and no buttons.

### What the index gets slightly wrong (stated so nobody over- or under-builds)

- X4 says installed apps crash "on an unknown ledger kind **or ticket status**". Verified in code:
  the ledger kind **crashes**; the status **misbehaves** (wrong badge, a Start button that leads to a
  refusal). Both are fixed here; only the first is a crash.
- `Awaiting Part` can only be entered by a technician raising a part request (P2, P4), which only
  Task 15's build can do. So an un-updated phone realistically meets it only via a second device, a
  console/QA write or seed data. The ledger kinds are the real, unavoidable risk: Task 10 writes
  `travel` on closure for every job once a franchisee configures a rate.
- There is **no Zod** in the app. `zod` is in `package.json` but nothing imports it
  (`grep -rn "zod" src app` → nothing), and every DTO is a TypeScript cast over `envelope.data`. So
  there is no parse that could reject an unknown enum. The rule this task adds for the future: **any
  enum read off the wire is normalised by a total function with a fallback, never by an index into a
  `Record` and never by `z.enum` without `.catch()`.**

---

## 2. Decisions implemented

| Index ref | What this task does with it |
|---|---|
| **X4** | The whole task: unknown ledger kinds and ticket statuses render safely, the four new values are known, and the build is live on Play before Tasks 10–12 are published. |
| **X2** | Every new word is a key in all five `src/i18n/locales/*.json`, English PROPOSED in §5.12, signed off before building. |
| **X1** | jest-expo unit tests for every extracted pure function (§6). No database. |
| **T2** | Employees get no per-job payout, so the app shows **"In salary"** instead of a ₹ figure on the pool card, offer and job detail. *(Decision (writer) — the index does not say which layer hides it; see §5.9.)* |
| **T3** | Employees still see bonuses, penalties, travel and speed rows on Earnings — nothing is filtered. |
| **T4** | Employees cannot redeem: the Redeem button and "Available to redeem" figure are replaced by an employee note; `EMPLOYEE_CANNOT_REDEEM` is a known final refusal. |
| **TA6** | `travel` is a **credit** to the technician (not a pool kind, but on the technician's own screen it is money in). |
| **S6** | `speed_reward` is a credit (bonus-like, amber); `speed_penalty` is a **debit** (penalty-like, red, shown negative). |
| **P3** | `Awaiting Part` is a non-terminal "still being worked" status: My jobs **In progress** tab, amber badge, Job detail banner with **no Complete, no Cancel, no Reschedule**. `PARTS_PENDING` gets a translated sentence. The parts UI itself is Task 15. |
| **3.3 / Task 05** | `franchisee_admin` can be a redemption payer and a UPI reviewer, so its role label is added to `serverLabels.ts` (it would otherwise show untranslated English — safe, but avoidable). |

---

## 3. Schema

None.

---

## 4. API — what the app reads

Nothing in the API changes in this task. This section is the **contract the app now relies on**, so
Tasks 06, 10, 11, 12 and 05 can check themselves against it.

### 4.1 Read here for the first time

| Endpoint | Field | Values | If absent |
|---|---|---|---|
| `GET /technicians/me` (`TechnicianSessionOut`, `api/app/features/technicians/router.py:65`) | `technicianType` | `'employee'` \| `'freelancer'` | treated as **freelancer** (today's behaviour) |
| `POST /auth/otp/verify` → `data.technicianProfile` (same `TechnicianSessionOut`, `api/app/features/auth/schemas.py:139`) | `technicianType` | same | same |

The app reads "me" through `fetchMyProfile()` → `GET /technicians/me`
(`src/features/auth/api/session.ts:52`), cached under `qk.me()` by `useMe()`
(`src/features/profile/hooks/useMe.ts`), seeded from the persisted session. **Task 06 must put
`technicianType` on `TechnicianSessionOut`** so both paths carry it.

### 4.2 Values the app now knows (sent by later tasks)

| Where | New value | Sent by | App behaviour |
|---|---|---|---|
| `GET /earnings/transactions` → `kind` | `travel` | Task 10 | credit, green, navigation icon |
| same | `speed_reward` | Task 11 | credit, amber, zap icon |
| same | `speed_penalty` | Task 11 | **debit** (negated), red, clock icon |
| same | anything else | — | neutral grey info icon, **unsigned** amount, server's title as sent |
| `GET /jobs/mine`, `/jobs/today`, `/jobs/{id}` → `status` | `Awaiting Part` | Task 12 | app status `inprogress`; badge *Awaiting part*; detail banner, no actions |
| same | anything else | — | app status `inprogress`; badge *In progress*; detail "update the app" note, no actions |
| error `code` | `EMPLOYEE_CANNOT_REDEEM` | Task 06 | final refusal on the redeem sheet, translated |
| error `code` | `PARTS_PENDING` | Task 12 | translated sentence under Complete |
| error `code` | `PINCODE_OUTSIDE_FRANCHISEE` | Task 04 (422 at self-registration, when coverage drifted from the invite) | translated generic sentence on the verify step (the base-location screen's own wording is Task 14's screen key, index §6b) (reconciled) |
| `payerLabel` / `reviewerLabel` | `Franchisee Admin` (and code `franchisee_admin`) | Task 05 | translated role name |

### 4.3 Requirements this task places on the API tasks (cross-task — please check)

These are not built here, but the app is designed against them. Each is a one-line check for the
named task.

1. **Ledger row titles (Tasks 10, 11).** `api/app/features/earnings/service.py` `_title(kind, reason)`
   today returns `"Late cancellation penalty"` for **any** kind it does not recognise (its last line).
   Without new branches a `travel` row would be titled a penalty. The app translates these exact
   strings, so the API must title them **exactly**:
   - `travel` → `"Travel allowance"`
   - `speed_reward` → `"Speed reward"`
   - `speed_penalty` → `"Speed penalty"`
   *(Decision (writer): the index names the kinds but not the titles; these are proposed here and
   signed off with this task's copy.)* Detail such as km or hours belongs on Task 15's job-detail
   display, not in the title — a title with a number in it cannot be looked up in `serverLabels.ts`.
2. **Summary arithmetic (Tasks 10, 11).** `GET /earnings/summary` returns four fixed figures
   (`netPaise`, `earnedPaise`, `bonusesPaise`, `penaltiesPaise`) and every installed build — old and
   new — draws them as *net* above three tiles. So that the tiles still add up to the net on **every**
   build: `earnedPaise = payout + travel`, `bonusesPaise = bonus + speed_reward`,
   `penaltiesPaise = penalty + speed_penalty`, `netPaise = earned + bonuses − penalties`.
   *(Decision (writer) — the index does not define it.)* Task 15 may add optional breakdown fields;
   this build ignores unknown fields.
3. **Redeemable balance (Tasks 10, 11).** `api/app/core/ledger.py` `credited()` reads kinds by name
   ("a kind added later moves nothing here until somebody decides"). It must add `travel` and
   `speed_reward` and subtract `speed_penalty`, or the Redeem card disagrees with Earnings.
4. **My jobs tab (Task 12).** The **In progress** tab is filtered on the server:
   `api/app/features/jobs/router.py` `SEGMENTS["inprogress"]` = `("In Progress", "Awaiting Customer",
   "AI Review", "Escalated")`. Task 12 must add `"Awaiting Part"` there, or the job appears in **no**
   tab (Home's `/jobs/today` already includes it — it excludes only `TERMINAL_STATUSES`).
5. **Employees still read redemptions (Task 06).** Only `POST /redemptions/me` refuses with
   `EMPLOYEE_CANNOT_REDEEM`. `GET /redemptions/me`, `/history`, `/{id}` and `POST /{id}/confirm`
   must keep answering for an employee: a freelancer switched to employee may have an **open**
   redemption that only they can confirm (root AGENTS.md: "only the technician confirms").
6. **Pushes to technicians (Task 12/15).** The app routes only `type` ∈ `pool`, `job`, `redemption`,
   `upi_change` and silently ignores any other (`usePushRegistration.ts`, verified safe). A part push
   meant to open the job must therefore be sent as `type: 'job'` with `ticketId`, or it opens nothing.

---

## 5. Client changes

All paths are under `mobileapp/`. One commit for the whole task is acceptable (it is a release, not a
screen): `feat(mobile): forward-compatible ledger kinds, Awaiting Part and employees`.
`npm run lint && npm run typecheck && npm test` green first.

Hard rules that bite here: **no hex outside `src/theme/`** (new colours go in `semantic.ts`);
**screens use semantic roles** (the current `palette.secondary[600]` in `EarningsScreen`'s
`KIND_STYLE` is moved to a role as part of this); **no English in components** (lint);
**rule 8, static Tailwind classes** — none of the touched files use `className` for these
colours; they use `style` objects with `color.*` roles, and nothing new may interpolate a class name
(`bg-${kind}` would render transparent).

**One rule for every lookup added here:** never index a plain object with a wire string. `obj[s]`
with `s = 'constructor'` or `'__proto__'` returns an inherited property, not `undefined`, so `?? x`
does not fire. Use `Object.prototype.hasOwnProperty.call(obj, s)` (Hermes-safe) or an array
`includes`. The tests in §6 include those two strings.

### 5.1 `src/types/domain.ts` — kinds, direction, technician type

Before:

```ts
export type TransactionKind = 'payout' | 'bonus' | 'penalty';

export interface Transaction {
  id: string;
  kind: TransactionKind;
  title: string;
  at: string;
  ticketCode: string;
  /** Signed integer paise: credits positive, penalties negative. */
  amountPaise: number;
  ticketId: string | null;
}
```

After:

```ts
/** Every ledger kind THIS build knows how to draw. Mirrors the API's `LEDGER_KINDS` minus
 *  `reversal`, which a technician is never sent (`core/ledger.shown_to_technician`). */
export type LedgerKind =
  | 'payout' | 'bonus' | 'penalty' | 'travel' | 'speed_reward' | 'speed_penalty';

/** `other` is the app's own word for a kind a newer API sent and this build has never heard of.
 *  The server never sends it. */
export type TransactionKind = LedgerKind | 'other';

/** Which way the money moved FOR THE TECHNICIAN. `unknown` for `other`: the server sends a
 *  magnitude and the kind carries the direction, so an unknown kind has no knowable sign. */
export type LedgerDirection = 'credit' | 'debit' | 'unknown';

export interface Transaction {
  id: string;
  kind: TransactionKind;
  direction: LedgerDirection;
  title: string;
  at: string;
  ticketCode: string;
  /** Signed paise: credit positive, debit negative. `unknown` → the positive magnitude, drawn
   *  WITHOUT a sign (`formatLedgerAmount`). */
  amountPaise: number;
  ticketId: string | null;
}
```

On `TechnicianSession`, add (keep the existing field comments' style):

```ts
  /**
   * `employee` | `freelancer` — Task 06. Employees are paid by salary: no per-job payout and no
   * Redeem. A string, not the union, because a newer API may send a third word; read it only
   * through `isEmployee()`. Optional: a session persisted before the API sent it has no key, and
   * absent means freelancer — today's behaviour.
   */
  technicianType?: string;
```

`JobStatus` is **unchanged** (`'pool' | 'upcoming' | 'inprogress' | 'completed' | 'cancelled'`).
Update the `serverStatus` comment to list `Awaiting Part` beside `Awaiting Customer`.

### 5.2 New `src/features/earnings/ledger.ts` — pure kind logic and the row mapper

Extracted so it is testable without importing `lib/api.ts` (which pulls `expo-constants` and the
session store). No React, no `t()`.

```ts
import type { LedgerDirection, Transaction, TransactionKind } from '@/types/domain';
import { formatPaise, formatSignedPaise } from '@/utils/money';

export const KNOWN_LEDGER_KINDS = [
  'payout', 'bonus', 'penalty', 'travel', 'speed_reward', 'speed_penalty',
] as const satisfies readonly TransactionKind[];

/** Total: any input → a kind this build can draw. Never throws. */
export function toTransactionKind(raw: unknown): TransactionKind {
  return typeof raw === 'string' && (KNOWN_LEDGER_KINDS as readonly string[]).includes(raw)
    ? (raw as TransactionKind)
    : 'other';
}

const DIRECTION = {
  payout: 'credit', bonus: 'credit', travel: 'credit', speed_reward: 'credit',
  penalty: 'debit', speed_penalty: 'debit',
  other: 'unknown',
} as const satisfies Record<TransactionKind, LedgerDirection>;

export function kindDirection(kind: TransactionKind): LedgerDirection {
  return DIRECTION[kind];
}

/** The server sends a magnitude; the sign is applied here, once. Defensive `abs`. */
export function signedPaise(direction: LedgerDirection, magnitude: number): number {
  const abs = Math.abs(magnitude);
  return direction === 'debit' ? -abs : abs;
}

/** "+₹40" · "−₹300" · and "₹40" with no sign for a kind whose direction is unknown. */
export function formatLedgerAmount(t: Pick<Transaction, 'direction' | 'amountPaise'>): string {
  return t.direction === 'unknown'
    ? formatPaise(Math.abs(t.amountPaise))
    : formatSignedPaise(t.amountPaise);
}

/** What `GET /earnings/transactions` returns per row. `kind` is a STRING: the server's
 *  vocabulary grows without asking this build. */
export interface TransactionDto {
  id: string;
  at: string;
  kind: string;
  amountPaise: number;
  title: string;
  subtitle: string;
  ticketCode: string;
  ticketId?: string | null;
}

export function toTransaction(dto: TransactionDto): Transaction {
  const kind = toTransactionKind(dto.kind);
  const direction = kindDirection(kind);
  return {
    id: dto.id,
    kind,
    direction,
    title: dto.title,
    at: dto.at,
    ticketCode: dto.ticketCode,
    amountPaise: signedPaise(direction, dto.amountPaise),
    ticketId: dto.ticketId ?? null,
  };
}
```

### 5.3 New `src/features/earnings/kindStyle.ts` — icon and tint per kind, with a fallback

```ts
import type { IconName } from '@/components/icons/Icon';
import { color } from '@/theme/semantic';
import type { TransactionKind } from '@/types/domain';

export interface KindStyle { icon: IconName; fg: string; bg: string }

/** A debit must never skim as a credit: debit kinds share `ledgerDebit`, and no credit kind does. */
export const KIND_STYLE = {
  payout:        { icon: 'card',       ...color.ledgerCredit },
  travel:        { icon: 'navigation', ...color.ledgerCredit },
  bonus:         { icon: 'gift',       ...color.ledgerBonus },
  speed_reward:  { icon: 'zap',        ...color.ledgerBonus },
  penalty:       { icon: 'warn',       ...color.ledgerDebit },
  speed_penalty: { icon: 'clock',      ...color.ledgerDebit },
  other:         { icon: 'info',       ...color.ledgerOther },
} as const satisfies Record<TransactionKind, KindStyle>;

/** Any string → a style. Own-property test, so `'constructor'` falls back too. */
export function kindStyle(kind: string): KindStyle {
  return Object.prototype.hasOwnProperty.call(KIND_STYLE, kind)
    ? KIND_STYLE[kind as TransactionKind]
    : KIND_STYLE.other;
}
```

All icon names exist in `src/components/icons/Icon.tsx` (`card`, `navigation`, `gift`, `zap`, `warn`,
`clock`, `info`). *Decision (writer):* travel is green like a payout (it is pay for the job, written
with it); speed reward is amber like a bonus (both come out of the franchisee's pool, S6).

### 5.4 `src/theme/semantic.ts` — new roles (the only place colours are added)

In the `// ── money` block, add:

```ts
  /** Ledger row tints — icon tile background + icon/amount colour. Earnings is the only reader. */
  ledgerCredit: { fg: palette.success[500], bg: palette.success[100] },
  ledgerBonus: { fg: palette.secondary[600], bg: palette.secondary[100] },
  ledgerDebit: { fg: palette.danger[500], bg: palette.danger[100] },
  /** A kind this build does not know. Neutral on purpose: it claims neither direction. */
  ledgerOther: { fg: palette.neutral[600], bg: palette.neutral[100] },
```

In the `// ── job status` block, add:

```ts
  /** Waiting on a spare part (Task 12). Amber: waiting on somebody else, not on the technician. */
  statusAwaitingPart: { fg: palette.secondary[600], bg: palette.secondary[100] },
```

`ledgerCredit` / `ledgerDebit` equal today's `statusCompleted` / `statusCancelled` values, so the
payout and penalty rows look exactly as they do now.

### 5.5 `src/features/earnings/api/earnings.ts`

- Delete the local `TransactionDto` interface; `import { toTransaction, type TransactionDto } from
  '@/features/earnings/ledger'`.
- Drop `TransactionKind` from the `@/types/domain` import.
- `listTransactions`: before

  ```ts
  return rows.map((t) => ({ id: t.id, kind: t.kind, …,
    amountPaise: t.kind === 'penalty' ? -t.amountPaise : t.amountPaise,
    ticketId: t.ticketId ?? null }));
  ```

  after

  ```ts
  return rows.map(toTransaction);
  ```

  Move the existing comment about why the sign is applied here into `signedPaise`.
- Update the file header's arithmetic note: `net = earned + bonuses − penalties`, where (per §4.3.2)
  the server folds travel/speed into those three.

### 5.6 `src/features/earnings/components/LedgerRow.tsx` (new) and `EarningsScreen.tsx`

Move `LedgerRow` out of `EarningsScreen.tsx` into its own file, exported, so §6.7 can render it.
Inside it import `Text` from `@/components/ui/Text` and `Icon` from `@/components/icons/Icon`
directly (not the `@/components/ui` barrel, which drags in `Sheet`/Reanimated under jest).

In `LedgerRow`, before:

```ts
const style = KIND_STYLE[txn.kind];
…{formatSignedPaise(txn.amountPaise)}
accessibilityLabel={`${title}. ${subtitle}. ${formatSignedPaise(txn.amountPaise)}`}
```

after:

```ts
const style = kindStyle(txn.kind);
const amount = formatLedgerAmount(txn);
…{amount}
accessibilityLabel={`${title}. ${subtitle}. ${amount}`}
```

`ledgerTitle(txn.title)` stays — an `other` row's title is shown exactly as the server sent it.

In `EarningsScreen.tsx`: delete `KIND_STYLE`, and the `TransactionKind`, `Transaction`, `IconName`,
`formatSignedPaise`, `relativeDayLabel`, `ledgerTitle` and `palette` imports — every `palette` use in
the file today (lines 115, 431, 432, 477) is in `KIND_STYLE` or `LedgerRow`, and `noUnusedLocals`
fails the typecheck on a leftover — then import `LedgerRow`. Then the employee changes:

```tsx
const employee = useIsEmployee();
…
{t(employee ? 'earnings.netCaptionEmployee' : 'earnings.netCaption')}
```

**The Earned tile for employees — Decision (writer): unchanged.** Same label, same server figure.
Reasons: (a) for a technician switched to employee mid-period it still holds real payouts from before
the switch, which a relabel ("Allowances") would misname; (b) under §4.3.2 it becomes payout + travel,
so for an employee it reads ₹0 until travel exists — and ₹0 is a true figure, not a faked one;
(c) the employee note (§5.7) explains why job pay is not there. Task 15 may split the tile once the
API sends a breakdown.

### 5.7 `src/features/redeem/components/RedeemCard.tsx` — employees

`RedeemCard` reads `const employee = useIsEmployee();` and passes it to `Body`.

- Header label: `employee && !redeemable.data?.open ? t('earnings.employee.title') :
  t('redeem.card.available')`.
- The **Redemptions** history link stays for everybody. *Decision (writer):* a technician switched
  to employee keeps their past redemptions as records; for one who never redeemed, the list's
  existing empty state ("No redemptions yet") is accurate.
- In `Body`, the `if (open) { … }` branch runs **first and unchanged** — an employee with an open
  redemption must still be able to **View** / **Confirm** it (§4.3.5).
- Then, new, before the amount/UPI branches:

  ```tsx
  if (employee) {
    return <Text style={{ fontFamily: 'Roboto_400Regular', fontSize: 13, lineHeight: 19,
      color: color.textSecondary, marginTop: 2 }}>{t('earnings.employee.body')}</Text>;
  }
  ```

  No amount, no **Redeem** button, no **Add UPI ID** button (the payout account stays reachable from
  Profile → Payout account; *Decision (writer):* not hidden — a type can change back, and UPI-change
  approval is Task 05's flow, unaffected).

These are the **only** Redeem entry points in the app — verified by grep: `RedeemCard` pushes
`/redeem`, `/redeem/:id` and `/redeem-confirm`; `RedeemConfirmSheet` replaces to `/redeem/:id`;
`usePushRegistration` opens `/redeem/:id` for a `redemption` push. Profile and Home have none.

### 5.8 Redeem refusals — `src/features/redeem/refusals.ts` (new) and `api/redeem.ts`

Move `RedeemRefusal` and `REFUSALS` out of `api/redeem.ts` into a pure file (testable without
`lib/api`), adding the employee code:

```ts
export type RedeemRefusal =
  | 'BALANCE_CHANGED' | 'NO_UPI_ID' | 'NOTHING_TO_REDEEM' | 'REDEMPTION_OPEN'
  | 'EMPLOYEE_CANNOT_REDEEM';

const REFUSALS: readonly RedeemRefusal[] = [
  'BALANCE_CHANGED', 'NO_UPI_ID', 'NOTHING_TO_REDEEM', 'REDEMPTION_OPEN', 'EMPLOYEE_CANNOT_REDEEM',
];

export function asRedeemRefusal(code: unknown): RedeemRefusal | null {
  return REFUSALS.find((c) => c === code) ?? null;
}
```

`api/redeem.ts` re-exports the type and uses `asRedeemRefusal(error.code)` in `requestRedemption`.
`RedeemConfirmSheet` needs no change: any refusal other than `BALANCE_CHANGED` is already `final`
(shows the sentence and a **Close** button), which is right for an employee who reached the sheet
through a stale screen.

### 5.9 Employee payout figure — **Decision (writer)**

T2 says employees get no per-job payout, but the API still sends `payoutPaise` (it is the ticket's
stamped price, T2). Showing "₹450" on an offer an employee will never be paid is a promise the
product breaks. So for `isEmployee(me)`:

| File | Before | After (employee) |
|---|---|---|
| `src/features/jobs/components/PoolJobCard.tsx` (~line 156) | `{formatPaise(job.payoutPaise)}` | `{payoutHidden ? t('jobs.payoutInSalary') : formatPaise(job.payoutPaise)}` — `payoutHidden` is a **new prop**, computed once in `PoolScreen` from `useIsEmployee()` (not a hook per row). |
| `src/features/jobs/screens/PoolScreen.tsx` (~line 160) | `<PoolJobCard … />` | pass `payoutHidden={employee}` |
| `src/features/jobs/screens/OfferScreen.tsx` (~line 213) | `{formatPaise(job.payoutPaise)}` | same ternary, `useIsEmployee()` in the screen |
| `src/features/jobs/screens/JobDetailScreen.tsx` (~line 356) | `value={formatPaise(job.payoutPaise)}` | `value={employee ? t('jobs.payoutInSalary') : formatPaise(job.payoutPaise)}` |

The bonus line (`jobs.bonus`) stays for employees (T3). `JobCard.tsx` also formats `payoutPaise`
but is rendered nowhere (`grep "<JobCard"` → only `JobCardSkeleton`), so it is left alone.
Known edge: an accepted job uses the technician's **current** type, while the API freezes the type
at accept (T1). A freelancer-accepted job then switched to employee shows "In salary" although
it will pay. Rare; Task 15 can read the frozen type if Task 10 puts it on `JobOut`.

### 5.10 Ticket status — `src/features/jobs/stage.ts` (new), `api/jobs.ts`, `JobDetailScreen.tsx`

**New `src/features/jobs/stage.ts`** (pure; `STATUS_MAP` and `toJobStatus` move here from
`api/jobs.ts`):

```ts
import type { Job, JobStatus } from '@/types/domain';

const STATUS_MAP: Readonly<Record<string, JobStatus>> = {
  New: 'pool',
  'Slot Pending': 'pool',
  Assigned: 'upcoming',
  'In Progress': 'inprogress',
  'Awaiting Customer': 'inprogress',
  'Awaiting Part': 'inprogress',
  'AI Review': 'inprogress',
  Escalated: 'inprogress',
  Closed: 'completed',
  'Force-Closed': 'completed',
  Cancelled: 'cancelled',
};

/** Total. Unknown → `inprogress`: still being worked, and no screen offers an action on it. */
export function toJobStatus(status: unknown): JobStatus {
  return typeof status === 'string' && Object.prototype.hasOwnProperty.call(STATUS_MAP, status)
    ? (STATUS_MAP[status] as JobStatus)
    : 'inprogress';
}

export type JobStage =
  | 'start' | 'awaitingTime' | 'complete' | 'awaitingCustomer' | 'awaitingPart'
  | 'escalated' | 'done' | 'none' | 'unknown';

export interface JobActions { stage: JobStage; canCancel: boolean; canReschedule: boolean }

/** What Job detail offers, from the server's own word. The one place that decides it. */
export function jobActions(job: Pick<Job, 'serverStatus' | 'hoursToSlot'>): JobActions {
  const nothing = { canCancel: false, canReschedule: false };
  switch (job.serverStatus) {
    case 'Assigned':
      return job.hoursToSlot === null
        ? { stage: 'awaitingTime', canCancel: true, canReschedule: false }
        : { stage: 'start', canCancel: true, canReschedule: true };
    case 'In Progress':       return { stage: 'complete', ...nothing };
    case 'Awaiting Customer': return { stage: 'awaitingCustomer', ...nothing };
    case 'Awaiting Part':     return { stage: 'awaitingPart', ...nothing };
    case 'Escalated':
    case 'AI Review':         return { stage: 'escalated', ...nothing };
    case 'Closed':
    case 'Force-Closed':
    case 'Cancelled':         return { stage: 'done', ...nothing };
    case 'New':
    case 'Slot Pending':
    case undefined:           return { stage: 'none', ...nothing };
    default:                  return { stage: 'unknown', ...nothing };
  }
}
```

**Decision (writer): unknown → `inprogress`, not today's `upcoming`.** `upcoming` is what put a
Start button on an unknown status; `inprogress` is non-terminal (the job stays on Home and in a
tab) and, with `jobActions` returning `unknown`, offers nothing. Which **tab** a job is in is
decided by the server's `SEGMENTS`, not by this mapping. `New`/`Slot Pending` on Job detail cannot
happen (a released job 404s for the technician); they get `none` rather than today's Start button.

**`src/features/jobs/api/jobs.ts`:** delete `STATUS_MAP` and `toJobStatus`, `import { toJobStatus }
from '@/features/jobs/stage'`, and replace the comment "Anything unrecognised falls to `upcoming`"
with a pointer to `stage.ts`.

**`src/features/jobs/screens/JobDetailScreen.tsx`.** Before (lines 52–59):

```ts
const stage = job?.serverStatus;
const waiting = stage === 'Awaiting Customer';
const working = stage === 'In Progress';
const escalated = stage === 'Escalated' || stage === 'AI Review';
const done = job?.status === 'completed' || job?.status === 'cancelled';
```

After:

```ts
const actions = job ? jobActions(job) : null;
const stage = actions?.stage;
const employee = useIsEmployee();
```

and the CTA block becomes a chain on `stage`, preserving every existing branch's markup:

| `stage` | Renders (existing markup unless marked NEW) |
|---|---|
| `escalated` | the red `jobs.detail.escalated` banner |
| `awaitingCustomer` | the green/red link-sent / link-failed banner |
| `complete` | **Complete the job** + `completeFailed` error line |
| `awaitingTime` | the `waiting` / `waitingNamed` banner, then the cancel block |
| `start` | **Start job & capture proof**, then the reschedule + cancel block |
| `awaitingPart` | **NEW** banner: `statusAwaitingPart` bg/fg, icon `wrench`, text `jobs.detail.awaitingPart`. No buttons. |
| `unknown` | **NEW** banner: `color.surfaceSunken` bg, `color.textLabel` text, icon `info`, text `jobs.detail.unknownStage`. No buttons. |
| `done`, `none` | nothing |

The reschedule and cancel buttons render from `actions.canReschedule` / `actions.canCancel` instead
of `stage === 'Assigned'` / `job.hoursToSlot !== null`. Both new banners copy the existing
slotless-`waiting` banner's layout (row, gap 10, radius 14, padding 14/15, `Roboto_500Medium` 13/19).

**Awaiting Part — why no buttons (P3):** Complete is refused while any part request is open
(`PARTS_PENDING`); Cancel and Reschedule are `Assigned`-only on the server today
(`JOB_NOT_CANCELLABLE`, `JOB_NOT_RESCHEDULABLE` in `api/app/features/jobs/service.py`). P3's
"a revisit time uses the existing reschedule" is therefore a **Task 12 server change plus a Task 15
button**, not this release. Call / Navigate in the customer card stay available.

`src/features/proof/hooks/useProof.ts` (`useCompleteJob`) needs no change: a `PARTS_PENDING` 409
(a part raised from another device while this screen showed Complete) already renders through
`errorText(complete.error, …)`; §5.12 adds its translation.

### 5.11 Status badge — `src/components/ui/jobBadge.ts` (new) and `StatusBadge.tsx`

Move `jobBadge` and `STARTING_SOON_MS` out of `StatusBadge.tsx` into a pure `jobBadge.ts` (imports
only `color` and the `Job` type), so the test does not render anything. `StatusBadge.tsx` imports it
and `src/components/ui/index.ts` keeps exporting `jobBadge` from the same barrel (no caller changes:
`MyJobCard.tsx`, `TodayJobCard.tsx`, `JobCard.tsx`).

```ts
type BadgeJob = Pick<Job, 'status' | 'slotStart' | 'slotEnd'> & Partial<Pick<Job, 'serverStatus'>>;

export function jobBadge(job: BadgeJob, now: number = Date.now()) {
  if (job.status === 'completed') return { label: 'completed', ...color.statusCompleted } as const;
  if (job.status === 'cancelled') return { label: 'cancelled', ...color.statusCancelled } as const;
  // NEW — before the generic in-progress line, which would otherwise win.
  if (job.serverStatus === 'Awaiting Part')
    return { label: 'awaitingPart', ...color.statusAwaitingPart } as const;
  if (job.status === 'inprogress') return { label: 'inProgress', ...color.statusInProgress } as const;
  … unchanged …
}
```

`MyJobCard` / `TodayJobCard` already pass the whole `Job`, which carries `serverStatus`. The
`t(\`jobs.status.${label}\`)` call stays type-checked once `jobs.status.awaitingPart` exists in
`en.json`. Update the skill's badge table (`mobileapp/.claude/skills/reliance-greentech-tech-app/
SKILL.md` §4 "Status badge rules") with the new first-after-cancelled row.

**My jobs / Home:** no code change. `MyJobsScreen` asks the server per tab (§4.3.4 puts
`Awaiting Part` under **In progress**); Home's `/jobs/today` already returns it.

### 5.12 i18n — PROPOSED copy (all five locale files)

Add each key to `src/i18n/locales/en.json` **and** `hi.json`, `te.json`, `kn.json`, `ta.json`.
Translate per `src/i18n/README.md` (polite "you", glossary terms — *Penalty* जुर्माना / జరిమానా /
ದಂಡ / அபராதம், *Bonus*, *Redeem*, *Job*; keep **₹**, **UPI**, **Play Store** in Latin letters;
buttons and badges no more than ~⅓ longer than English) and queue each language for native review.
`npm run i18n:check -- --verbose` lists any still identical to English. **PROPOSED — needs owner
sign-off (index §7, "07") before building.**

| Key | English (PROPOSED) |
|---|---|
| `jobs.status.awaitingPart` | Awaiting part |
| `jobs.detail.awaitingPart` | Waiting for a spare part. Once it has been issued to you, you can finish the job and complete it here. |
| `jobs.detail.unknownStage` | This job is at a stage this version of the app doesn't know. Update the app from the Play Store to see what to do next. |
| `jobs.payoutInSalary` | In salary |
| `earnings.netCaptionEmployee` | Net for your monthly statement, after penalties |
| `earnings.employee.title` | You're an employee |
| `earnings.employee.body` | Your job pay comes with your salary, so there is nothing to redeem here. Allowances, bonuses and penalties below go on your monthly statement. |
| `server.ledgerTitle.travelAllowance` | Travel allowance |
| `server.ledgerTitle.speedReward` | Speed reward |
| `server.ledgerTitle.speedPenalty` | Speed penalty |
| `server.role.franchiseeAdmin` | Franchisee Admin |
| `errors.code.EMPLOYEE_CANNOT_REDEEM` | Employees are paid through salary, so there is nothing to redeem. |
| `errors.code.PARTS_PENDING` | A spare part is still pending on this job. You can complete it once the part has been issued. |
| `errors.code.PINCODE_OUTSIDE_FRANCHISEE` | Some of these pincodes are outside the area you were invited for. Ask the person who invited you to check them. |

### 5.13 `src/i18n/serverLabels.ts`

```ts
const ROLES: Table = {
  …existing…,
  'Franchisee Admin': 'server.role.franchiseeAdmin',
  franchisee_admin: 'server.role.franchiseeAdmin',
};

const LEDGER_TITLES: Table = {
  …existing…,
  'Travel allowance': 'server.ledgerTitle.travelAllowance',
  'Speed reward': 'server.ledgerTitle.speedReward',
  'Speed penalty': 'server.ledgerTitle.speedPenalty',
};
```

Update the file header: the ledger titles' source is `features/earnings/service.py` `_title`, whose
strings Tasks 10/11 must match (§4.3.1). A title not in the table is still shown as sent.

### 5.14 Technician type — `src/features/profile/technicianType.ts` and hook

```ts
// src/features/profile/technicianType.ts — pure
import type { TechnicianSession } from '@/types/domain';
export const TECHNICIAN_TYPE_EMPLOYEE = 'employee';
/** Absent, null, `freelancer` or any word this build does not know → false (today's behaviour).
 *  Safe in that direction: the server refuses an employee's redemption anyway (409). */
export function isEmployee(me: Pick<TechnicianSession, 'technicianType'> | null | undefined): boolean {
  return me?.technicianType === TECHNICIAN_TYPE_EMPLOYEE;
}
```

```ts
// src/features/profile/hooks/useIsEmployee.ts
export function useIsEmployee(): boolean {
  return isEmployee(useMe().data);
}
```

`useMe` is seeded from the persisted session and refetches (`initialDataUpdatedAt: 0`), so a session
saved before Task 06 briefly reads freelancer and corrects itself within one request. A manager
changing the type is picked up on the next `qk.me()` refetch (30 s stale, on focus, and on every
`job` push — `usePushRegistration` already invalidates `qk.me()`).

### 5.15 `src/lib/api.ts` — a compatibility header (Decision (writer), owner may drop)

Add to `apiRequest`'s headers: `'X-App-Compat': String(APP_COMPAT_LEVEL)` with
`export const APP_COMPAT_LEVEL = 1;` and a comment: *"1 = renders unknown ledger kinds and
statuses safely and knows travel / speed_reward / speed_penalty / Awaiting Part. Bump when a later
build adds a vocabulary the API must not send to older ones."* The API ignores unknown headers
(CORS is `allow_headers=["*"]`, `api/app/main.py:158`, so `npm run web` is unaffected). It costs one
line and gives Task 16 a way to **count requests still coming from builds without it** — the
direct measure of whether the gate below is really met (§8).

---

## 6. Unit tests (jest-expo)

Harness from Task 00 (`npm test`, `testMatch: **/__tests__/**/*.test.ts?(x)`, i18n initialised in
`jest.setup.ts`, `@testing-library/react-native` installed). **Gap to check:** Task 00 does not list
a `moduleNameMapper` for the `@/` alias (tsconfig `paths`; Metro resolves it, Jest does not). If
`"moduleNameMapper": { "^@/(.*)$": "<rootDir>/src/$1" }` is not in `package.json`'s `jest` block,
add it in this task.

| # | File | Cases |
|---|---|---|
| 6.1 | `src/features/earnings/__tests__/ledger.test.ts` | `toTransactionKind`: each of the six known kinds → itself; `'reversal'`, `'something_new'`, `''`, `'constructor'`, `'__proto__'`, `null`, `undefined`, `42` → `'other'`. `kindDirection`: payout/bonus/travel/speed_reward → credit; penalty/speed_penalty → debit; other → unknown. `toTransaction`: `penalty 30000` → `-30000`; `speed_penalty 15000` → `-15000`; `travel 4000` → `4000`; `something_new 5000` → `{ kind: 'other', direction: 'unknown', amountPaise: 5000 }`; a negative magnitude from the server (`penalty -500`) → `-500` (abs then sign); `ticketId` absent → `null`. `formatLedgerAmount`: credit 4000 → `+₹40`; debit -30000 → `−₹300`; unknown 5000 → `₹50` (no sign). |
| 6.2 | `src/features/earnings/__tests__/kindStyle.test.ts` | Every `KNOWN_LEDGER_KINDS` entry and `other` has `icon`, `fg`, `bg` strings. `kindStyle('something_new')`, `kindStyle('constructor')`, `kindStyle('__proto__')`, `kindStyle('')` all `=== KIND_STYLE.other`. No credit kind's `fg` equals any debit kind's `fg` ("a penalty must never skim as a payout"). |
| 6.3 | `src/features/jobs/__tests__/stage.test.ts` | `toJobStatus` over all eleven server statuses (incl. `Awaiting Part` → `inprogress`); `'Something New'`, `'constructor'`, `undefined`, `null` → `inprogress`. `jobActions`: `Assigned`+slot → start, cancel+reschedule; `Assigned`+`hoursToSlot: null` → awaitingTime, cancel only; `In Progress` → complete; `Awaiting Customer`; `Awaiting Part` → awaitingPart with **canCancel false, canReschedule false**; `Escalated` and `AI Review` → escalated; three terminal → done; `New`, `Slot Pending`, `undefined` → none; `'Something New'` → unknown with no actions. |
| 6.4 | `src/components/ui/__tests__/jobBadge.test.ts` | Fixed `now`. `Awaiting Part` (status `inprogress`) → `awaitingPart` even when the slot has closed; plain `inprogress` → `inProgress`; existing rules unchanged: completed, cancelled, no slot → `awaitingTime`, ended slot → `slotClosed`, ≤4h → `startingSoon`, else `upcoming`. |
| 6.5 | `src/features/profile/__tests__/technicianType.test.ts` | `isEmployee`: `'employee'` → true; `'freelancer'`, `undefined` field, `null`/`undefined` session, `'EMPLOYEE'`, `'contractor'` → false. |
| 6.6 | `src/features/redeem/__tests__/refusals.test.ts` | `asRedeemRefusal` returns each of the five codes, including `EMPLOYEE_CANNOT_REDEEM`; `'PARTS_PENDING'`, `undefined`, `'constructor'` → `null`. |
| 6.7 | `src/features/earnings/__tests__/LedgerRow.test.tsx` | Render with `@testing-library/react-native`, `jest.mock('@/components/icons/Icon', () => ({ Icon: () => null }))`. A `Transaction` built by `toTransaction({ kind: 'something_new', amountPaise: 5000, title: 'Something new', … })` renders without throwing and shows `Something new` and `₹50`. A `speed_penalty` row shows `−₹150`. If `ui/Text`'s `language.store` import needs AsyncStorage under jest, add `jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'))` to `jest.setup.ts`. |
| 6.8 | `src/i18n/__tests__/serverLabels.test.ts` | `await i18next.changeLanguage('hi')` (resources from `jest.setup.ts`, or add `hi` there): `ledgerTitle('Travel allowance')`, `'Speed reward'`, `'Speed penalty'` equal `hi.json`'s three new values; `roleLabel('franchisee_admin')` and `roleLabel('Franchisee Admin')` equal `hi.server.role.franchiseeAdmin`; `ledgerTitle('Something new')` → `'Something new'`. Back in `en`: every input returned unchanged. |

---

## 7. Acceptance criteria

Numbered Given / When / Then. "Dev" = the app against the local API on `RelianceDB`.

1. **Given** `mobileapp/`, **when** `npm run lint` (includes `i18n:check`), `npm run typecheck` and
   `npm test`, **then** all three pass, and `i18n:check` reports the 13 new keys present in all five
   files with matching placeholders.
2. **Given** the §6.7 test with a transaction of kind `something_new`, **when** it renders, **then**
   nothing throws and the row shows the server's title and an unsigned `₹50` with the neutral style.
3. **Given** a technician on the new build whose Earnings window holds payout, bonus and penalty rows
   (today's data), **when** they open Earnings, **then** every row looks exactly as before (same
   icon, tint, sign) — a side-by-side screenshot against the live build shows no difference.
4. **Given** the new build against today's dev API (no `technicianType`), **when** a technician opens
   Earnings, Pool, an offer and Job detail, **then** they see the Redeem card and ₹ payout figures
   exactly as today (absent type = freelancer).
5. **Given** a technician whose `technicianType` is `employee` (Task 06 deployed on dev), **when** they
   open Earnings, **then** the card reads *You're an employee* with the body text, there is no amount
   and no **Redeem** / **Add UPI ID** button, the **Redemptions** link works, and the net caption is
   the employee one.
6. **Given** that employee also has an open redemption (made while a freelancer), **when** they open
   Earnings, **then** the card shows the open redemption with **View** / **Confirm**, and confirming
   it succeeds.
7. **Given** an employee, **when** they open the pool, an offer and an accepted job, **then** the
   payout figure reads *In salary* and any bonus is still shown.
8. **Given** an employee who reaches `/redeem-confirm` (e.g. a screen opened before the type changed),
   **when** they tap **Send request**, **then** the API's 409 `EMPLOYEE_CANNOT_REDEEM` shows its
   sentence (translated in hi/te/kn/ta) and the sheet offers only **Close**.
9. **Given** a ticket assigned to the technician, **when** its `status` is set to `Awaiting Part`
   on dev by hand (`UPDATE tickets SET status='Awaiting Part' …` — refused by the `status IN (…)`
   CHECK in `api/app/models/ticket.py:347` until Task 12's migration widens it; before that this
   criterion is proved by §6.3/§6.4 and re-run on dev after Task 12), **then** on Home and in
   My jobs it shows an amber *Awaiting part* badge, and Job detail shows the part banner with no
   Complete, Cancel or Reschedule button, while Call and Navigate still work.
10. **Given** any status the build does not know, **when** Job detail opens, **then** it shows the
    "update the app" note and no buttons (proved by §6.3; no DB write needed).
11. **Given** the language set to Hindi, **when** the screens in 5–9 are viewed, **then** no new text
    is English except where `i18n:check --verbose` lists it as deliberately identical.
12. **Version-skew matrix.** Each cell is checked (new build on dev; old build = the version live on
    Play today, installed from Play):

    | Build ↓ / API → | Today | + Task 05/06 (franchisee payer, employees) | + Tasks 10–12 (new kinds, Awaiting Part) |
    |---|---|---|---|
    | **Old (live today)** | as today | works; employee sees Redeem and gets the server's English 409 sentence; payout ₹ shown to employees; `Franchisee Admin` untranslated | **Earnings crashes** on a travel/speed row; Awaiting Part shows a Start button that ends in a refusal — **this is why the gate exists** |
    | **New (this task)** | identical to old (criteria 3, 4) | criteria 5–8 | new rows styled and signed; Awaiting Part per criterion 9; any later unknown kind/status per criteria 2, 10 |

13. **Release (owner's step — the gate for Tasks 10, 11, 12).** **Given** the merged commit, **when**
    the owner runs `eas build -p android --profile production` and `eas submit -p android --profile
    production`, **then** the build lands on Play's **internal** track as a **draft** (`eas.json`
    `submit.production.android`: `track: internal`, `releaseStatus: draft`); the owner promotes it to
    **Production**, it passes review, and Play Console shows it **Available on Google Play** at 100 %
    rollout. Record the versionCode and the date in this file and tick index §7. Only then may Tasks
    10–12 be published (index release gate (a)). See §8 for why "live" alone is not "safe".

---

## 8. Out of scope and traps

**Out of scope.** The spare-part request UI, part-status display and the revisit/reschedule from
Awaiting Part (Task 15); travel/speed breakdown on Job detail and on Earnings tiles (Task 15); base
location (Task 14); the API changes listed in §4.3 (Tasks 05, 06, 10, 11, 12); an employee label on
Profile; hardening `features/redeem/format.ts` `STATE_PILL[state]` and `RedemptionScreen`'s
`eventLabel` against unknown redemption states — they would crash the same way (`pill.label` of
`undefined`), but this project adds no redemption state, so they are noted here for whoever adds one.

**Traps.**

- **"Live on Play" is not "on the phones".** The Play update sheet (`modules/play-update`,
  `src/hooks/useStoreUpdate.ts`) is FLEXIBLE and **never forced** (root AGENTS.md), and it appears only
  in a build that was installed from Play **and already carries the module** — the release that first
  shipped it (commit `c7d5052`) prompted nobody. Technicians who decline or never reopen the app stay
  on the old build and **will crash on Earnings** once Task 10 writes `travel`. *Decision (writer),
  owner to confirm:* before publishing Tasks 10–12, also wait until Play Console's release dashboard
  shows ≥ 90 % of active devices on this versionCode (or the `X-App-Compat` count in §5.15 says the
  same), and message the stragglers to update. The index's gate (a) says only "on Play"; this is a
  stricter recommendation, not a change to it.
- **No OTA.** `expo-updates` is not installed (no dependency, no `updates` / `runtimeVersion` in
  `app.json` or `app.config.ts`). Every fix to this release — and every later kind/status — is a full
  store build and review. Do not plan on patching JS after the fact.
- **Preview APKs are not the gate.** The `preview` profile is an internal APK pointed at the dev API;
  the in-app update sheet never appears for it, and analytics are off outside `production`. Test the
  update path through Play's internal testing track or internal app sharing (root AGENTS.md).
- **No native module is added.** Only JS and JSON change, plus Task 00's dev dependencies. `react-native-webview`
  (X3) belongs to Task 14, which needs its own Play build anyway.
- **`noUncheckedIndexedAccess` does not protect a `Record<Union, …>` index.** `KIND_STYLE[txn.kind]`
  type-checked because `txn.kind` was typed as the union while the wire sent any string. That lie is
  the root cause: wire enums are typed `string` in DTOs (`TransactionDto.kind`, `JobDto.status`) and
  narrowed only by the total functions in §5.2 / §5.10.
- **Prototype-key lookups.** `STATUS_MAP['constructor']` returns `Object`, not `undefined`, so a `??`
  fallback never fires. Use the own-property checks shown; §6 tests them.
- **Server title fallthrough.** Until Tasks 10/11 add branches to `_title`, a `travel` row would be
  titled *Late cancellation penalty* on every build — the app cannot fix that; §4.3.1 is the fix.
- **Tabs come from the server.** If Task 12 forgets `SEGMENTS["inprogress"]`, an Awaiting Part job
  disappears from My jobs on every build, old and new — no client change can bring it back.
- **Employees and the frozen type.** The app uses the technician's current type; the API freezes it
  at accept (T1). See §5.9's edge case.
- **Translations are first drafts.** Per `src/i18n/README.md` they ship before native review; review
  never blocks this build, but the PROPOSED English must be signed off first (index §7).
