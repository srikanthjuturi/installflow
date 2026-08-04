---
name: videocon-tech-app
description: >
  Screen-by-screen spec, design tokens, component patterns and domain model for the Videocon
  Technician Field App (Expo SDK 54 + Expo Router + NativeWind). Holds the approved copy,
  layout and interaction detail for all 18 screens, extracted from the client-approved
  prototype at RequirementDocs/Technician Field App.html, plus the penalty bands, proof-capture
  state machine and job status rules. Load this before building or changing any screen, adding
  a component to src/components/ui, touching src/theme, or writing mock data — it prevents
  re-deriving the spec from the prototype bundle every time. Trigger on requests like "build
  the job pool screen", "add the accept sheet", "what does screen 7 look like", "what are the
  penalty bands", "add a status badge".
---

# Videocon Technician Field App — screen & design spec

Everything here is extracted from the **client-approved prototype**,
`RequirementDocs/Technician Field App.html`. Treat its copy and layout as fixed. The business
rules behind it come from `RequirementDocs/Installation_Requirement_Document.docx` (v0.2).

Where the two disagree, **the prototype wins** — it is the later artifact and it resolves
several questions the document left open.

---

## 1. Design tokens

Colours live in `src/theme/tokens.js` (CJS, so `tailwind.config.js` and TypeScript share one
source). Screens consume **semantic roles** from `src/theme/semantic.ts`, never ramp positions.

| Role | Meaning in this app | 500 |
|---|---|---|
| `primary` | actions, links, active tab, accept | `#1f6feb` |
| `secondary` | committed slot, starting-soon, escalation, bonus | `#d18f16` |
| `success` | completed, earnings credit, online | `#15803d` |
| `danger` | penalties, cancel, AI mismatch | `#c81e1e` |
| `neutral` | text, borders, surfaces, chrome | ramp (ink at 900) |

Neutral carries two half-steps — **150** (`#eef1f3`, app surface) and **350** (`#cdd6de`, switch
track off) — because those prototype values fall between standard stops. `chrome` (`#0e1622`) is
structural, not a ramp position: it's the dark bar behind the status bar on Home, Earnings,
Profile, Offer and Detail.

**Radii:** 8 / 12 / 14 / 16 / 18 / 999. **Gutter:** 20 everywhere. **Type:** Roboto 11–25px,
weights 400/500/700/900 — headline numbers are 900.

---

## 2. Screen inventory

18 screens. The prototype's own index numbering is kept so it's easy to cross-reference.

| # | Route | Screen |
|---|---|---|
| R1 | `(auth)/invite` | Register — invite link |
| R2 | `(auth)/coverage` | Register — categories + pincodes |
| 1 | `(auth)/login` | Login / OTP |
| 2 | `(app)/(tabs)/index` | Home — today's jobs |
| 3 | `(app)/availability` | Availability & bandwidth |
| 4 | `(app)/pool/index` | Open job pool |
| 5 | `(app)/pool/[id]` | Job offer (masked) |
| — | `(app)/(modals)/accept-slot` | Accept sheet |
| 6 | `(app)/(tabs)/jobs` | My jobs |
| 7 | `(app)/job/[id]/index` | Job detail (unlocked) |
| 8 | `(app)/job/[id]/cancel` | Cancel + penalty |
| 9–12 | `(app)/job/[id]/proof/capture` | Camera — 4 modes |
| 13 | `(app)/job/[id]/proof/review` | Review & submit |
| — | `(app)/job/[id]/proof/verifying` | AI wait |
| 14 | `(app)/job/[id]/proof/result` | AI result — 3 variants |
| — | `(app)/job/[id]/proof/closure` | Feedback link sent |
| 15 | `(app)/(tabs)/earnings` | Earnings ledger |
| 16 | `(app)/(tabs)/profile` | Profile & settings |

---

## 3. Approved copy, per screen

Exact strings. Do not paraphrase.

### R1 — Invite link
Eyebrow `SECURE INVITE LINK` · Title `Welcome, {firstName} — set up your account` ·
Body `Your onboarding partner pre-filled these details in this link. Confirm they're correct.`
Locked rows: Full name · Mobile · Technician ID · Onboarded by · Region.
Footnote `Details are locked. Contact your ASM to change name or phone.` · CTA `Confirm & continue`

### R2 — Coverage
`What do you install?` / `Pick every category you're trained for. You'll only be offered jobs
that match — pick more to get more work.`
Categories: Television · Washing Machine · Refrigerator · Air Conditioner · Microwave · Water Purifier
`Which areas do you cover?` / `Add every pincode you can service — you'll be offered jobs from
any of them.` · button `Add` · hint `Add at least one pincode. Most technicians cover 2–5 nearby areas.`
CTA `Continue`, with summary `N categories · N areas`.
Disabled hints: `Select at least one category` then `Add at least one pincode`.
Pincode input is 6 digits, numeric only; Add enables only at exactly 6 and rejects duplicates.

### 1 — Login / OTP
`Technician sign-in` / `Installation & Demo field partner app.` · `Mobile number`, prefix `+91` ·
CTA `Send OTP` · `By continuing you agree to the partner terms.`
OTP step: `Enter the 6-digit code sent to +91 ….` · `Change` · `Resend code in 0:24` · `Verify & continue`

### 2 — Home
`Good morning` + name · toggle `You're online` / `Receiving job offers` — off state
`You're offline` / `Not receiving offers`.
Banner `{n} new jobs in your area` / `Confirmed slots · tap to view the pool`.
Section `Today's jobs` + `{n} job(s)`. Empty: `Nothing scheduled today` /
`Accept a job from the pool to fill your day.`

### 3 — Availability & bandwidth
`Availability & bandwidth` · `Working days` (Mon–Sun rows, hours `9–6`, Sat `10–4`, off `Off`) ·
`Daily job bandwidth` / `Maximum installs you'll take per day. New offers stop once you hit this
cap.` · stepper 1–12, unit `jobs / day` · `Mark time off` with
`Time off is on — no offers today` / `You are available today`.

### 4 — Open job pool
`Open job pool` / `Confirmed slots matching your category & pincodes. First to accept wins —
customer details stay masked until you accept.`
Card: category · `SLA {24h|48h}` · job id · model · area · pincode · distance · slot · payout.
Empty: `Pool is empty` / `You've taken every open job nearby.`

### 5 — Job offer (masked)
`Job offer` · id · category · SLA · model · `Confirmed slot` · `Payout` ·
`Details unlock after you accept` — Customer `R•••• M••••`, Phone `+91 ••••• •••••`,
Area, Distance. CTAs `Accept job` / `Pass`.

### Accept sheet
`Commit to this slot?` / `The customer already confirmed {slot}. Accepting locks you to that
time — cancelling later carries a penalty.` · rows Job / Area ·
CTAs `Accept & unlock details` / `Not now`.

### 6 — My jobs
`My jobs` · segments `Upcoming` / `In progress` / `Completed`.
Empty per segment: `No upcoming jobs` · `Nothing in progress` · `No completed jobs yet`.

### 7 — Job detail (unlocked)
`Job details` · id · `Committed` + slot · `Customer` + name + full address ·
actions `Call` / `Navigate` · `Product to install` · `Install & demo` · `SLA type` · `Payout` ·
CTA `Start job & capture proof` · destructive `Cancel this job`.

### 8 — Cancel
`Cancel job` · band label · `Penalty deducted from earnings` · `−₹{amount}`.
Under 4h adds: `Under 4 hours to the slot — this escalates straight to the Area Service Manager
for urgent reassignment.`
`Why are you cancelling?` — Customer not reachable · Wrong / incomplete address ·
Personal emergency · Vehicle breakdown · Other.
CTA `Cancel & accept −₹{amount} penalty`, disabled hint `Select a reason`.

### 9–12 — Camera
One screen, four modes. Header shows title + `Step N of 4`.

| Mode | Title | Hint |
|---|---|---|
| barcode | `Scan barcode` | `Align the product barcode within the frame` |
| serial | `Serial number` | `Fill the box with the serial-number label` |
| photos | `Product photos` | `Capture the installed unit from 2–3 angles` |
| live | `Live site photo` | `On-site live capture · gallery uploads not accepted` |

Serial overlay shows `SERIAL NO.` / `VCN-•••••-••••`. Live overlay shows
`Location locked · {pincode}`. Photos mode has a counter `{n}/4` and a `Next` button that
enables at ≥1 photo, max 4.

### 13 — Review & submit
`Review & submit` / `Check your four captures before AI verification. Tap any to retake.`
Tiles: `Barcode image` (`Barcode · decoded`) · `Serial number` (`Serial · VCN-••••-8841`) ·
`Product photos` (`{n} photos`) · `Geo-tagged live photos` (`Geo-tagged · {pincode}`), each with `Retake`.
Footer `All photos geo-tagged & matched to pincode {pincode}.` · CTA `Submit for AI verification`.

### Verifying
`Verifying with AI` / `Matching serial and product images against {model}.`

### 14 — AI result (three variants)
- **match** → `Verification passed` / `Serial and product match the order.` Rows `Model matched`,
  `Serial read`, `Confidence` `98%` `Auto-pass`. CTA `Send feedback link to customer`.
- **mismatch** → `Mismatch flagged` / `Serial doesn't match the order. Routed to the Area Service
  Manager.` `What happens now` / `The ASM reviews your captures and the mismatch. You'll be
  notified once they approve or ask you to recapture.` CTA `Back to jobs`.
- **unreadable** → `Image unreadable` / `The serial photo is blurry. Retake before you leave the
  site.` / `Steady the camera, avoid glare on the sticker, and fill the frame with the serial
  label.` CTA `Retake serial photo`.

### Closure
`Feedback link sent` / `{customer} received a WhatsApp link to confirm & rate the install.`
Steps: `Proof captured & AI-verified` · `Feedback link delivered` · `Awaiting customer confirmation`.
Note `If the customer doesn't respond in the set window, the ASM can force-close with supporting
documents. Every closure records who, when and why.` · CTA `Done — back to jobs`.

### 15 — Earnings
`Earnings` · `This week` `Mon–Sun` · net figure + `Net payout after penalties` ·
tiles `Earned` / `Bonuses` / `Penalties` · `Transactions`.
Ledger kinds: install credit (green) · `Reassignment bonus` (amber) · `Late cancellation penalty` (red).

### 16 — Profile
Avatar initials · name · `Technician` · `ID VCN-TECH-2231` · stats `Rating` / `Jobs done` /
`On-time` · `Service coverage` (Categories, Pincodes) · link `Availability & bandwidth` ·
rows `Push notifications` / `Language` / `Payout account` · `Log out`.

---

## 4. Domain model

```ts
type JobStatus = 'pool' | 'upcoming' | 'inprogress' | 'completed' | 'cancelled';
type ProofKind = 'barcode' | 'serial' | 'photos' | 'live';
type VerificationOutcome = 'match' | 'mismatch' | 'unreadable';
type SlaType = '24h' | '48h';

interface Job {
  id: string;              // 'INST-4821'
  category: string;        // 'Television'
  model: string;           // 'Videocon 43" Smart LED'
  area: string;            // 'Kandivali West'
  pincode: string;         // '400067'
  slot: string;            // 'Today · 2:00–4:00 PM'
  slotShort: string;       // '2–4 PM'
  sla: SlaType;
  distanceLabel: string;   // '3.2 km'
  payoutPaise: number;     // integer paise — never a float
  customer: string;        // full name, post-accept only
  maskedCustomer: string;  // 'R•••• M••••'
  address: string;         // post-accept only
  hoursToSlot: number;     // negative = past. Drives status + penalty band.
  status: JobStatus;
}
```

`hoursToSlot` is the pseudo-clock the prototype uses — it drives status badges, pool filtering
and penalty bands from a single number. Keep it in mock data; replace with real timestamps at
binding time.

### Status badge rules

| Condition | Label | Role |
|---|---|---|
| completed | `Completed` | `statusCompleted` |
| in progress | `In progress` | `statusInProgress` |
| `hoursToSlot <= 4` | `Starting soon` | `statusStartingSoon` |
| otherwise | `Upcoming` | `statusUpcoming` |

### Penalty bands

| Time to slot | Penalty | Escalates to ASM |
|---|---|---|
| > 8 h | ₹80 | no |
| 4–8 h | ₹150 | no |
| < 4 h | ₹250 | **yes** |

### Proof capture machine

`barcode → serial → photos (1–4) → live → review → verifying → result`

Photos is the only step that accumulates; `Next` gates on ≥1. Any tile on review can jump back
to its capture step, and re-entering `photos` resets the counter to 0.

---

## 5. Component patterns

Live in `src/components/`:

- `layout/Screen` — safe-area aware page shell; `variant="light" | "chrome" | "camera"` sets
  the status-bar treatment. Screens never touch `SafeAreaView` directly.
- `layout/Header` — back chevron + title + optional right slot.
- `ui/Button` — `variant="primary" | "secondary" | "ghost" | "destructive"`, `disabled` shows
  the hint text beneath rather than hiding the reason.
- `ui/Card` — white surface, radius 14, 1px `border` token.
- `ui/StatusBadge` — takes `JobStatus` + `hoursToSlot`, resolves the table above itself.
- `ui/Switch` — 44×26 track, knob offset 3 ↔ 20/21px.
- `feedback/EmptyState` — icon + title + body. Every list screen uses it.
- `icons/` — 22 SVGs traced from the prototype, all 24×24, `stroke="currentColor"`,
  `strokeWidth={1.8}`, round caps and joins. Icon set: home · jobs · wallet · user · barcode ·
  serial · photos · geo · bell · globe · plus · minus · gift · card · warn · tv · washer ·
  fridge · ac · micro · purifier.

## 6. Mock data

`src/mocks/db.ts` — seeded, deterministic. Aim for ~20 jobs across every category, pincode, SLA
type and distance so pagination, filters and empty states are all reachable. The prototype's
four jobs (INST-4821 / 4830 / 4847 / 4790) should be kept verbatim as the demo path.

`src/mocks/delay.ts` — 300–900ms artificial latency so skeletons are actually exercised.

Money is **integer paise** throughout. Format at the edge, never store a float.
