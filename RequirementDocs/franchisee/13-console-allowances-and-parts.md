# Task 13 — Console: allowance rules, base-location pin, parts catalogue, facility queue, ticket panels

> Layer: **adminWeb**. Depends on Tasks **10** (travel), **11** (speed), **12** (spare parts) and on the
> franchise shell and workspace adapter from Task **09**. Read [00-index.md](00-index.md) first — every
> name below comes from it. Contracts in §4 are **copied from Tasks 10/11/12 as written**; where this doc
> needs something those docs do not say, it is marked *Reconcile*.
> Copy in §5.10 is **PROPOSED** (X2) and must be signed off before this task is built.

---

## 1. Goal & why

Three backend features (travel allowance, speed allowance, spare parts) need somebody in the console to
configure them, act on them and audit them. Today nothing in `adminWeb` can — and one thing in it will
**break** the day the API writes the new ledger kinds (§5.1).

> **Worked example.** SkyFix Services' franchisee admin, Meena, signs in and lands in the franchise
> portal (`/franchise/*`, Task 09).
>
> 1. **Allowance rules → Travel.** On the *Freelancers* card she sets free distance 20 km, every 2 km,
>    ₹10 per step, road factor 130 %, most per job ₹300. The worked example under the card, fed
>    "21.6 km straight", reads: *21.6 km × 130 % = 28.1 km by road → 8.1 km beyond the free 20 km =
>    4 steps of 2 km → 4 × ₹10 = **₹40***. That is exactly the `amountPaise: 4000` Task 10 freezes into
>    `accept_snapshot.travel` (index §3.5). *Employees* keep their own card.
> 2. **Allowance rules → Speed.** She adds *Electronics › Television*, Freelancers, reward ₹200 within
>    12 h, penalty ₹150 after 24 h, picking *Television* from a category tree.
> 3. **Technicians → Ravi → Base location.** Ravi skipped the step in the app. Meena types 500049,
>    presses *Use centre*, nudges the pin onto his street on an OpenStreetMap map and saves.
> 4. Ravi accepts RGT-INST-0412, starts it, and asks in the app for *Other: HDMI cable*. The job turns
>    **Awaiting Part**.
> 5. SkyFix's facility operator, Arjun, opens **Spare parts** (default view: everything still on his desk),
>    opens RGT-SPR-0007, approves it with **"Add "HDMI cable" to Television's parts list"** ticked, later
>    presses *Mark issued*, and when Ravi brings the old cable back, *Log return* with a photo.
> 6. Acme's National Head — or an Area Manager, on this SkyFix ticket too (owner ruling 2026-10-15) — opens the
>    ticket. Beside the technician panel: **Travel allowance** (28.1 km,
>    ₹40, frozen at accept), **Speed allowance** (reward within 12 h, clock running from the slot's start, 2.1 h waiting for a
>    part excluded) and **Spare parts** (the HDMI request and its trail). The status chip reads
>    **Awaiting Part** and the board's Status filter finds it.
> 7. The customer goes silent; a manager force-closes. The form now carries **Travel allowance (₹)**
>    pre-filled with **40**, capped at ₹300. Speed pays nothing on a force-close (S5), and the form says
>    nothing about it.
> 8. The pool ledger (**Penalty & Bonus**) lists Ravi's *Speed reward* as money out of the pool rather
>    than printing `NaN`.
>
> Acme's **home** franchisee has no facility staff yet, so its technicians cannot raise a part request. The National
> Head opens **Franchisees → Acme (home) → Facility users** and adds a Facility Admin (owner ruling 2026-10-15); from
> then on home's requests reach that person's **Spare parts** queue in the portal — never the staff console.
>
> Separately, Acme's National Head opens **Categories & products → Television → Spare parts** and adds
> "Wall bracket" and "Remote"; every Television product inherits them. For **Acme Home** (the home
> franchisee, F8) she sets travel and speed under **Configuration → Allowances**.

---

## 2. Decisions implemented

| # | How this task honours it |
|---|---|
| F7 / F8 | Franchise portal edits its own rules; staff edit the **home** franchisee's (Configuration → Allowances) and read a non-home franchisee's on its Franchisees page (Admin/NH, read-only). Base pin: staff only where `tech.canManage` (Task 08/10). **R9 (owner ruling 2026-10-15):** the pin panel and the technician list show the base's **source chip** and who set it. |
| F10 / F13 | New portal routes sit inside Task 09's deny-by-default franchise shell; the franchise ticket detail stays read-only. |
| TA3 / TA4 / TA6 | Travel form edits the five numbers per type; the preview mirrors `app/core/travel.py` exactly (tenths, half-up, partial steps dropped). Force-close travel field pre-filled with `forceCloseDefaultPaise`, capped at `forceCloseMaxPaise`; 0 / empty writes no row. |
| TA5 / TA8 | Ticket **Travel** panel reads the frozen block; "no base location" and "no customer point" are said in words. |
| TA7 | Console pin (Leaflet + OSM) + "Use a pincode's centre" + typed coordinates (`manual`, Task 10 W8). **Source chip (Pincode / GPS / Map / Set by admin) and a "Set by {name}" line on the panel, and the chip on the list (owner ruling 2026-10-15, R9); no approval, no cooldown; the admin corrects any time.** |
| S1 / S2 / S6 | Speed matrix per type × node-or-model with Task 11's inheritance hints; a speed penalty shows in the ticket's Penalties list labelled as such and is reversible there. |
| S3 / S5 | Speed panel shows the clock minus part waits, **counted from the later of the accept and the slot's start (owner ruling 2026-10-15, R1)**; `force_closed` outcome says it was never paid (R7). **Staff (AM and above) see this panel and the Travel panel on every ticket in scope, non-home included (R8)**; facility staff and vendors see neither. |
| P1 / P7 | Catalogue on nodes and models (`parts.catalogue`); approving an **Other** offers "Add to <leaf>'s parts list". |
| P2 – P6 | Facility queue + request page (approve / reject / issue / return with optional photo), facility users page. **Owner ruling 2026-10-15 (R2): Reject is also offered on an *approved* row, reason required. (R4): no Admin/NH parts queue in the staff console, home included — the queue is franchise staff only; Admin/NH instead get a *Facility users* card for the HOME franchisee on its Franchisees page.** |
| X2 | Every new string is in §5.10, PROPOSED. Task 12 §4.7's five timeline titles and §4.10's three notification texts are server copy **signed off with this task** — listed in §5.10 too. |
| X4 / index §6a | The console ledger learns `speed_reward` / `speed_penalty` (labels, chip, pool sign) and **ships no later than Task 11's API** (§5.1). |
| X5 | No schema; no hex outside `theme.css`; static classes; every list has loading/empty/error. |

---

## 3. Schema

None.

---

## 4. API contract assumed

Envelope `{ success, statusCode, message, data, errors }`. **Paise on the wire** for every endpoint below
(unlike `/settings/rules`, which carries rupees) — the form shows rupees and converts at the edge.

### 4.1 Travel rules — Task 10 §4.8

| Method & path | Who | Notes |
|---|---|---|
| `GET` / `PUT /franchise/settings/travel` | franchisee admin, `franchise.settings` | franchisee = the session's |
| `GET /settings/travel` | staff, `settings.view` **or** `jobs.assign` | the company's **home** franchisee, implied |
| `PUT /settings/travel` | staff, `settings.edit` + National-Head floor | same |
| `GET /franchisees/{franchiseeId}/travel-rules` | staff, `franchisees.view`, any franchisee, read-only | Task 03's scoped loader, 404 across companies |

Body (`TravelRulesOut`, also the PUT body; both types always):

```json
{
  "freelancer": { "freeKm": 20, "stepKm": 2, "paisePerStep": 1000, "roadFactorPct": 130, "maxPaisePerJob": 30000 },
  "employee":   { "freeKm": 30, "stepKm": 1, "paisePerStep": 0,    "roadFactorPct": 130, "maxPaisePerJob": 0 }
}
```

Bounds (Task 10 `TravelRuleIO`): `freeKm` 0–500, `stepKm` 1–50, `paisePerStep` 0–1 000 000,
`roadFactorPct` 100–300, `maxPaisePerJob` 0–10 000 000; **`paisePerStep > 0` with `maxPaisePerJob = 0` →
422** "Set a maximum per job — with a ₹0 maximum the allowance is always ₹0." (W2). Off = rate 0.
PUT message "Travel settings saved". No franchisee name or timestamp in the body — the portal names the
franchisee from `me.franchisee.name` (Task 09), the staff page from Task 08's `useFranchiseeOptions`
(`isHome`).

Formula the preview mirrors (`app/core/travel.py`, Task 10 §4.1), straight distance in metres:

```
roadKm      = floor(straight_m × road_factor_pct / 10 000 + 0.5) / 10        # tenths, half-up
tenths(km)  = floor(km × 10 + 0.5)
steps       = max(0, tenths(roadKm) − free_km × 10) // (step_km × 10)
amount      = min(max_paise_per_job, steps × paise_per_step)
```

### 4.2 Speed rules — Task 11 §4.2, §4.10

| Method & path | Who |
|---|---|
| `GET /franchise/settings/speed[?technicianType=]` → `SpeedRuleOut[]` | franchisee admin, `franchise.settings` |
| `PUT /franchise/settings/speed` body `SpeedRuleIn` → `SpeedRuleOut` — **upsert on the natural key** (type + target) | same |
| `DELETE /franchise/settings/speed/{ruleId}` → `{ "deleted": true }` | same; 404 for another franchisee's id |
| `GET /franchise/settings/speed/catalogue` → price-free tree (W16) | same |
| `GET /franchisees/{franchiseeId}/speed-rules` (+ `PUT`, `DELETE …/{ruleId}`) | staff. GET: `franchisees.view` (non-home also needs rank ≥ NH, else 404). PUT/DELETE: **home only**, `settings.edit` + NH floor; non-home → 403 |

```json
// SpeedRuleIn
{ "technicianType": "freelancer", "nodeId": "…", "modelId": null,
  "rewardWithinHours": 12, "penaltyAfterHours": 24, "rewardPaise": 20000, "penaltyPaise": 15000 }

// SpeedRuleOut
{ "id": "…", "technicianType": "freelancer",
  "targetKind": "node", "targetId": "…", "targetName": "Television",
  "targetPath": ["Electronics"], "targetActive": true,
  "rewardWithinHours": 12, "penaltyAfterHours": 24, "rewardPaise": 20000, "penaltyPaise": 15000,
  "overridesRuleId": "…", "overridesName": "Electronics", "overriddenBy": 2,
  "updatedAt": "2026-10-15T05:30:00Z" }

// catalogue (franchise principals only)
{ "nodes":  [ { "id": "…", "parentId": null, "name": "Electronics", "depth": 0, "isLeaf": false, "isActive": true } ],
  "models": [ { "id": "…", "nodeId": "…", "name": "Sunview 43\"", "brandName": "Sunview" } ] }
```

Hours integers 1–720, `penaltyAfterHours ≥ rewardWithinHours`; amounts 0–1 000 000 **multiple of 100**
(whole rupees). `0 / 0` is legal and is how one product is switched **off** beneath a category with a rule
(W2). Exactly one of `nodeId` / `modelId`. Staff read the tree from the existing `GET /masters/nodes`.
The catalogue is Task 11's `SpeedCatalogueOut` — exactly the two keys `nodes` / `models` (index §6b).

### 4.3 Base location — Task 10 §4.7

| Method & path | Who | Sources accepted |
|---|---|---|
| `PUT /technicians/{id}/base-location` | staff, `technicians.edit`; home technician that `can_manage_technician` — a visible non-home one → 403 "Managed by …", outside scope → 404 (reconciled) | `pincode`, `map`, `manual` |
| `PUT /franchise/technicians/{id}/base-location` | franchisee admin, `franchise.technicians`; own franchisee — else 404 | same |

Body — `{ "pincode": "500049" }` **or** `{ "latitude": 17.44012, "longitude": 78.34890, "source": "map" | "manual" }`
(422 for both / neither). **No DELETE** — a base is moved, never removed. Returns `BaseLocationOut`:

```json
{ "latitude": 17.44, "longitude": 78.35, "pincode": "500049", "source": "pincode",
  "setAt": "2026-10-15T05:30:00Z", "setBySelf": false,
  "setByName": "Meena R", "setByRole": "Franchisee Admin" }      // R9 (owner ruling 2026-10-15) — who set it
```

Errors: 422 `PINCODE_OUTSIDE_FRANCHISEE`; 400 **`PINCODE_HAS_NO_LOCATION`**, 400 `BASE_OUTSIDE_INDIA` (lat 6–38,
lng 68–98) (index §6b). `TechnicianDetailOut` and the portal's technician detail carry `baseLocation: BaseLocationOut |
null` (non-null only for callers who can manage that technician — Task 10); list rows carry `baseSource`, `baseSetAt`, `baseSetBySelf` (no coordinates) — the chip's input (owner ruling 2026-10-15, R9). Task 08 rows carry `canManage`,
`franchiseeIsHome`, `technicianType`.

The "Use centre" preview needs the pincode's point before saving: Task 10 adds `latitude` / `longitude`
(nullable) to `GeoPincode` (`GET /geo/pincodes?search=`, open to every company principal, franchise
included) and to `GET /franchise/pincodes` rows (index §6b). A code with null coordinates still works: it
saves `{pincode}` and the pin moves to the returned point (or the server refuses with
`PINCODE_HAS_NO_LOCATION`).

### 4.4 Ticket detail — Tasks 10 §4.4, 11 §4.6/§4.11, 12 §4.7

`TicketDetail` gains (server decides visibility — a vendor gets `null` / `[]`; **facility users** get `travel: null` and `speed: null`; **company staff — Area Manager and above — get both on any ticket in their scope, non-home included** (owner ruling 2026-10-15, R8; it used to null `speed` for a non-home Area Manager)):

```json
"travel": {                      // TicketTravelOut — null if nobody holds it or accepted before Task 10
  "technicianId": "…", "acceptedAt": "…", "technicianType": "freelancer",
  "baseSource": "pincode",        // pincode | gps | map | manual | null (no base)
  "customerSource": "ticket",     // ticket | pincode | null
  "straightKm": 21.6, "roadFactorPct": 130, "km": 28.1,
  "freeKm": 20, "stepKm": 2, "paisePerStep": 1000, "maxPaisePerJob": 30000,
  "amountPaise": 4000, "reason": null,        // null | no_base_location | no_customer_point
  "creditedPaise": null,                      // the travel ledger row; never 0
  "forceCloseDefaultPaise": 4000, "forceCloseMaxPaise": 30000
},
"speed": {                       // TicketSpeedOut — null when no rule was frozen
  "matchedOn": "node", "matchedName": "Television",
  "rewardWithinHours": 12, "penaltyAfterHours": 24, "rewardPaise": 20000, "penaltyPaise": 15000,
  "clockStartedAt": "…", "acceptedAt": "…", "slotStart": "…", "completedAt": null,   // R1: clockStartedAt = max(accepted, slotStart)
  "elapsedHours": null, "partWaitHours": 2.1, "workingHours": null,
  "outcome": "pending",          // pending | reward | penalty | none | force_closed
  "ledgerEntryId": null, "paidPaise": null, "capped": false, "reversed": false
},
"partRequests": [ PartRequestOut ]           // [] for a vendor (Task 12 D16)
```

`TicketPenalty` gains `kind: "penalty" | "speed_penalty"` (Task 11 §4.6) — the existing **Reverse**
button and `POST` work unchanged for both. `TimelineEvent.kind` gains `speed_settled` (Task 11 W12) and
`part_requested | part_approved | part_rejected | part_issued | part_returned`; titles are the server's.

Force-close body gains `travelPaise?: number` (Task 10 W5): omitted or `0` = no row; capped server-side.

`TicketStatus` gains **`Awaiting Part`**. Task 12 D8: it **is** in `RESCHEDULABLE_STATUSES` (staff "Change
the time" works), **not** in `core.slots.CHOOSABLE_STATUSES` and **not** assignable.
`GET /tickets/summary`'s `active` tally includes it (Task 12 §4.6).

### 4.5 Pool ledger — Task 11 §4.7, §4.9

`LedgerEntry.kind` gains `speed_reward` and `speed_penalty` (`?kind=` accepts both). `LedgerPoolOut`
**folds** them (`penaltiesCollectedPaise` includes standing speed penalties, `bonusesPaidPaise` includes
speed rewards) and adds `speedPenaltyPaise`, `speedPenalties`, `speedRewardPaise`, `speedRewards`.
`travel` is **not** a pool kind and never reaches this screen.

### 4.6 Parts catalogue — Task 12 §4.3 (`parts.catalogue`, staff)

```
GET    /spare-parts/catalogue/nodes/{nodeId}          → CatalogueOut
GET    /spare-parts/catalogue/models/{modelId}        → CatalogueOut
POST   /spare-parts/catalogue/nodes/{nodeId}/parts    { "name" }            → 201 SparePartOut
POST   /spare-parts/catalogue/models/{modelId}/parts  { "name" }            → 201 SparePartOut
PATCH  /spare-parts/catalogue/parts/{partId}          { "name"?, "isActive"? } → SparePartOut
DELETE /spare-parts/catalogue/parts/{partId}                                 → soft delete
```

```json
// CatalogueOut
{ "owner": { "kind": "model", "id": "…", "name": "Acme FL-7 (7 kg)", "path": ["Home Appliances","Washing Machine","Front Load"] },
  "own":       [ { "id": "…", "name": "Door gasket", "isActive": false, "ownerKind": "model", "ownerId": "…", "ownerName": "Acme FL-7 (7 kg)" } ],
  "inherited": [ { "id": "…", "name": "Door gasket", "isActive": true,  "ownerKind": "node",  "ownerName": "Washing Machine" } ] }
```

Duplicate `lower(trim(name))` on the same owner → 409 (generic, no code). An **inactive own row hides
the inherited name** (Task 12 D11).

### 4.7 Part requests — Task 12 §4.5

Handler = a franchise principal with `parts.handle` (its franchisee) — **and nobody else** (owner ruling 2026-10-15,
R4: no Admin/NH fallback, home included). Every staff role gets 403 *"Spare parts are handled by the franchise's
facility staff."*; the console never draws a staff queue, so the sentence is only ever seen by a hand-typed URL.

```
GET  /spare-parts/requests?status=requested,approved,issued&search=&page=&limit=  → paged PartRequestOut
GET  /spare-parts/requests/counts      → { "requested": 3, "approved": 1, "issued": 4 }
GET  /spare-parts/requests/{id}        → PartRequestOut (returnPhotoUrl signed here)
POST /spare-parts/requests/{id}/approve { "addToCatalogue": false }
POST /spare-parts/requests/{id}/reject  { "reason": "…" }                   (1–255, required)
POST /spare-parts/requests/{id}/issue   { "note"?: "…" }                    (≤ 500)
POST /spare-parts/requests/{id}/return  { "note"?: "…", "photoBlobName"?: "attachment/<company>/<uuid>.jpg" }
```

`status` is a comma-set; default `requested,approved,issued` (D22). Order: requested, approved, issued,
returned, rejected, then oldest first.

```json
// PartRequestOut
{ "id": "…", "code": "RGT-SPR-0009", "status": "approved", "allowedActions": ["issue"],
  "ticketId": "…", "ticketCode": "RGT-INST-0412", "ticketStatus": "Awaiting Part",
  "productLabel": "Acme FL-7 (7 kg)", "city": "Hyderabad", "pincode": "500032",
  "franchiseeId": "…", "franchiseeName": "SkyFix Services",
  "technicianId": "…", "technicianName": "Ravi Kumar", "technicianPhone": "+919…",
  "sparePartId": "…", "partName": "Inlet hose clamp", "isOther": false,
  "catalogueTarget": null,                // { nodeId, nodeName } only while an Other request is 'requested'
  "note": "clamp cracked", "createdAt": "…",
  "decidedAt": "…", "decidedBy": "Meena R", "rejectReason": null,
  "rejectedAfterApproval": false,       // owner ruling 2026-10-15 (R2): rejected after it had been approved
  "issuedAt": null, "issuedBy": null, "issueNote": null,
  "returnedAt": null, "returnedBy": null, "returnNote": null, "returnPhotoUrl": null }
```

`allowedActions` for an `approved` request is `["issue", "reject"]` (owner ruling 2026-10-15, R2); `reject` always needs a reason. Wrong state / lost race → 409 `PART_REQUEST_BAD_STATE`. The return photo goes up first through
`POST /uploads?kind=attachment` (private; the response `url` holds the blob **name**). Actions are allowed
whatever the ticket's status (D6). No customer name/phone/address (D21).

*Reconcile (Task 12):* `returnPhotoUrl` on the ticket detail's `partRequests[]` — Task 12 signs it on
`GET /spare-parts/requests/{id}`; the ticket panel therefore links to the request page rather than
showing the image (a non-handler AM can read the trail, not the photo).

### 4.8 Facility users — Task 12 §4.8 (`franchise.facility_users`)

```
GET   /franchise/facility-users?page=&limit=&search=                     → paged FacilityUserOut
POST  /franchise/facility-users  { fullName, email, phone, role }        → 201 FacilityUserCreatedOut
PATCH /franchise/facility-users/{membershipId}  { "isActive": bool }     → FacilityUserOut
POST  /franchise/facility-users/{membershipId}/reissue-password          → FacilityUserCreatedOut
```

`role` ∈ `facility_admin` | `facility_operator`; a facility admin may create only operators (403 *"You can
only add roles below your own"*). Phone required, E.164. 201 even when the email fails, with
`data.emailStatus` (`sent | skipped | failed`) and `data.temporaryPassword` only when not sent — the
`vendor_users` contract. Never yourself (403). `FacilityUserOut` is Task 12's: `membershipId, userId,
fullName, email, phone, role, isActive, createdAt`; `FacilityUserCreatedOut` adds `EmailOutcome`
(`emailStatus`, `emailError`, `temporaryPassword`). Reissue follows the same rank rule (a facility admin may
reissue only an operator's password) and revokes the person's sessions (index §6b) (reconciled).

**Facility users for the HOME franchisee — company Admin / National Head (owner ruling 2026-10-15, R4; Task 12 §4.8b).**
Same four calls and the same shapes under `/spare-parts/home-facility-users` (`GET`, `POST`, `PATCH /{membershipId}`,
`POST /{membershipId}/reissue-password`), guarded by `franchisees.manage` (Admin, National Head — no new key), the
franchisee resolved server-side as the company's home (no id in the path or body). `role` ∈ `facility_admin` |
`facility_operator` — both are offered (the viewer outranks both). A facility user of any other franchisee is 404
here. This is what lets a home franchise get its first facility admin; a franchisee admin / facility admin of home
keep using the portal routes above.

### 4.9 Notifications — Task 12 §4.10

| Kind | Who sees it | `to` |
|---|---|---|
| `part_requested` | `facility` audience (franchise staff of that franchisee — never company staff, owner ruling 2026-10-15) | `/franchise/parts/requests/{id}` |
| `part_decided` (rejections only — including a rejection of an approved request, titled *approved part cancelled*) | territory staff | `/tickets/{ticketId}` |
| `part_issued` | territory staff | `/tickets/{ticketId}` |

---

## 5. Client changes

All paths under `adminWeb/src/`. One commit per screen (§8).

### 5.0 Dependencies (audit — adminWeb AGENTS.md → Performance plan)

`package.json` (React is `^19.2.6`):

| Package | Version | Why |
|---|---|---|
| `leaflet` | `1.9.4` exact | latest stable; `2.0.0-alpha` is not for production |
| `react-leaflet` | `5.0.0` exact | peer `react ^19`, `react-dom ^19`, `leaflet ^1.9.0` (verified on npm) |
| `@types/leaflet` | `^1.9.20` (dev) | types |

≈45 kB gzipped, loaded **only** in the lazy `BaseLocationMap` chunk (§5.5). Not Google Maps: that key is
per-vendor-search and billed; OSM tiles are free under the usage policy (§8).

### 5.1 Ledger kinds — ⚠ ships no later than Task 11's API (index §6a)

`POOL_SIGN[kind]` is `undefined` for a kind the console has never heard of, so the Penalty & Bonus
screen prints **`NaN`** the moment the API writes a speed row. This sub-change is independent of the rest
of the task and **may be split into its own commit and released in Task 07's window** — it must be live
on both console deploys before Task 11 is published.

| File | Change |
|---|---|
| `types/index.ts` | `LedgerEntry.kind` — Task 09 already widens it with `speed_reward`, `speed_penalty` and `(string & {})`. If Task 09 has not landed, do it here. Add the four `LedgerPool` breakdown fields as **optional** numbers. |
| `components/ledger/LedgerTable.tsx` | `KIND_LABEL`: `speed_reward: "Speed reward"`, `speed_penalty: "Speed penalty"`. `KIND_CHIP`: `speed_reward` = the bonus chip's classes, `speed_penalty` = the penalty chip's. `POOL_SIGN`: `speed_reward: -1` (out of the pool), `speed_penalty: +1` (into it). **Fallbacks for any other kind:** label = the raw kind, chip = `"bg-surface-3 text-ink-2"`, sign = `+1` with no colour — never `NaN`: `const sign = POOL_SIGN[e.kind as keyof typeof POOL_SIGN] ?? 1`. The CSV writes the same. The "(reversed)" tag applies to `speed_penalty` too (`ledgerAdapters.isReversible`, Task 09). Type filter options gain *Speed reward*, *Speed penalty*. |
| `pages/ledger/LedgerPage.tsx` | `KINDS` gains the two speed kinds. |
| `components/ledger/PoolSummary.tsx` | Under *Penalties collected* and *Bonuses paid*, a muted line when the breakdown is present and non-zero: *incl. {amount} speed penalties* / *incl. {amount} speed rewards*. The `collected − bonuses = balance` sentence is unchanged — the fold keeps it true (Task 11 W11). |
| `components/tickets/PenaltiesPanel.tsx` | The row's `reason` line is prefixed *Speed penalty ·* when `p.kind === "speed_penalty"` (absent `kind` reads as `penalty`). The Reverse button is unchanged. |
| `components/tickets/Timeline.tsx` | `speed_settled`: `Timer` icon, `bg-info-bg text-info`; the five `part_*` kinds: `Wrench` — requested `bg-info-bg text-info`, approved/issued/returned `bg-ok-bg text-ok`, rejected `bg-warn-bg text-warn`. (Unknown kinds already fall back to `created`.) |

### 5.2 Status: "Awaiting Part"

| File | Change |
|---|---|
| `types/ticket.ts` | Insert `"Awaiting Part"` after `"In Progress"` in `TICKET_STATUSES` (11 values; update the header comment). Add `isReschedulable(t) = isTimeChoosable(t) \|\| t.status === "Awaiting Part"` — **never** add it to `TIME_CHOOSABLE_STATUSES` (that mirrors `CHOOSABLE_STATUSES`, which Task 12 leaves alone; `SlotRequest` and `TechnicianPanel` would start saying the customer is picking a time). Extend `TimelineEvent.kind`; add `travel`, `speed`, `partRequests` to `TicketDetail`; `kind` to `TicketPenalty`. |
| `styles/theme.css` | `--status-awaiting-part` / `--status-awaiting-part-bg` in `:root` **and** `[data-theme="dark"]` → `var(--warn)` / `var(--warn-bg)` (a task with a fix — the `APPROVAL_CLASS` reading of warn); the two `--color-status-awaiting-part*` lines in `@theme`. |
| `components/shared/StatusBadge.tsx` | `"Awaiting Part": "bg-status-awaiting-part-bg text-status-awaiting-part"` — the `Record<TicketStatus,…>` makes a miss a compile error. |
| `components/tickets/statusFilter.ts` | `"Awaiting Part"` after `"In Progress"`. |
| `services/dashboard.ts` | The *Assigned / in progress* tile links `status: "Assigned,In Progress,Awaiting Part"` — the same set the API now counts (Task 12 §4.6), or tile and list disagree. |
| `pages/tickets/TicketDetailPage.tsx` | `canReschedule` uses `isReschedulable`. Panels in §5.8. |

### 5.3 Types, services, hooks

**New `types/allowances.ts`** — `TravelRule`, `TravelRules { freelancer; employee }`, `SpeedRule`
(= `SpeedRuleOut`), `SpeedRuleInput` (= `SpeedRuleIn`), `SpeedCatalogue`, `BaseSource`, `BaseLocation`
(= `BaseLocationOut`), `TicketTravel`, `TicketSpeed`, and:

```ts
/** Whose rules a screen is showing — decides the URL, never sent as a body field. */
export type AllowanceScope =
  | { kind: "franchise" }                               // the portal: its own franchisee
  | { kind: "home"; franchiseeId: string }              // staff, editable
  | { kind: "franchisee"; franchiseeId: string };       // staff, read-only, any franchisee
```

`TechnicianType` is Task 08's (`types/technician.ts`).

**New `types/parts.ts`** — `PartRequestStatus`, `PART_REQUEST_STATUSES` (`as const`, order requested,
approved, issued, returned, rejected), `PartAction = "approve" | "reject" | "issue" | "return"`,
`PartRequest` (= `PartRequestOut`), `SparePart`, `Catalogue`, `PartsOwner = { kind: "node"; node: ProductNode }
| { kind: "model"; node: ProductNode; model: ProductModel }`, `FacilityRole`, `FacilityUser`,
`CreatedFacilityUser`.

**Modified types:** `types/technician.ts` — `Technician.baseLocation: BaseLocation | null`,
`TechnicianRow` `baseSource`, `baseSetAt`; `types/geo.ts` — `GeoPincode.latitude/longitude?: number | null`.

**New `services/allowances.ts`**

```ts
const travelPath = (s: AllowanceScope) =>
  s.kind === "franchise" ? "/franchise/settings/travel"
  : s.kind === "home" ? "/settings/travel"
  : `/franchisees/${s.franchiseeId}/travel-rules`;
const speedPath = (s: AllowanceScope) =>
  s.kind === "franchise" ? "/franchise/settings/speed" : `/franchisees/${s.franchiseeId}/speed-rules`;

export const getTravelRules  = (s) => apiGet<TravelRules>(travelPath(s));
export const saveTravelRules = (s, body: TravelRules) => apiPut<TravelRules>(travelPath(s), body);   // never "franchisee"
export const listSpeedRules  = (s) => apiGet<SpeedRule[]>(speedPath(s));
export const saveSpeedRule   = (s, body: SpeedRuleInput) => apiPut<SpeedRule>(speedPath(s), body);  // upsert
export const deleteSpeedRule = (s, id: string) => apiDelete<{ deleted: true }>(`${speedPath(s)}/${id}`);
export const getSpeedCatalogue = () => apiGet<SpeedCatalogue>("/franchise/settings/speed/catalogue");
```

**New `services/parts.ts`** — catalogue (`getCatalogue(owner)`, `addPart(owner, name)`, `updatePart(id,
{ name?, isActive? })`, `removePart(id)`), requests (`listPartRequests(params)` via `apiGetPage` with
`status` as a comma-set, `getPartRequestCounts()`, `getPartRequest(id)`, `approvePartRequest(id,
{ addToCatalogue })`, `rejectPartRequest(id, { reason })`, `issuePartRequest(id, { note })`,
`returnPartRequest(id, { note, photoBlobName })`).

**New `services/facilityUsers.ts`** — mirrors `services/vendorUsers.ts` (`list`, `create`, `setActive`) plus
`reissuePassword(membershipId)` (the `reissueFranchiseeAdminPassword` shape from Task 08).

**`services/workspace.ts` (Task 09)** — `TechnicianSource` gains `setBaseLocation(id, body)`: ops →
`PUT /technicians/{id}/base-location`, franchise → `PUT /franchise/technicians/{id}/base-location`. This is
Task 09's adapter rule ("which endpoints" moves into the workspace), not a `portal` prop.

**`services/tickets.ts`** — `ForceCloseInput.travelPaise?: number`, documented like
`technicianPayoutPaise` (omitted = pay nothing).

**New `hooks/useAllowances.ts`**

```ts
const scopeKey = (s: AllowanceScope) => (s.kind === "franchise" ? "franchise" : s.franchiseeId);
export const allowanceKeys = {
  all: ["allowances"] as const,
  travel: (s: AllowanceScope) => ["allowances", "travel", s.kind, scopeKey(s)] as const,
  speed:  (s: AllowanceScope) => ["allowances", "speed", s.kind, scopeKey(s)] as const,
  speedCatalogue: ["allowances", "speed", "catalogue"] as const,
};
useTravelRules(scope), useSaveTravelRules(scope)                 // invalidates allowanceKeys.travel(scope)
useSpeedRules(scope), useSaveSpeedRule(scope), useDeleteSpeedRule(scope)
                                                                 // invalidate the ["allowances","speed"] prefix
useSpeedCatalogue({ enabled })                                   // staleTime 1 h, like useNodeTree
```

Every mutation has `meta: { errorTitle }` (§5.10); the global handler toasts. Lists `staleTime: 30_000`.

**New `hooks/useParts.ts`**

```ts
export const partKeys = {
  all: ["parts"] as const,
  catalogue: (o: { kind: "node" | "model"; id: string }) => ["parts", "catalogue", o.kind, o.id] as const,
  requests: (p: ListParams) => ["parts", "requests", p] as const,
  request: (id: string) => ["parts", "request", id] as const,
  counts: ["parts", "counts"] as const,
};
```

Catalogue writes invalidate the `["parts","catalogue"]` **prefix** (a node's change moves every
descendant's inherited list). Request actions invalidate `partKeys.all`, `ticketKeys.all` (status and
panel move) and the notifications prefix. `usePartRequest(id)` uses `staleTime: 0` (signed photo URL —
the `useTicketProof` rule). `usePartRequestCounts({ enabled })`: `refetchInterval: BACKSTOP_REFETCH_MS`,
`refetchOnWindowFocus`, `meta: { suppressErrorToast: true }` (a rail badge is a backstop and must never toast; only the portal rail uses it — owner ruling 2026-10-15, R4). `hooks/useTicketStream.ts` invalidates `partKeys.all` on
`notification.raised`.

**New `hooks/useFacilityUsers.ts`** — mirrors `hooks/useVendorUsers.ts`; keys `["facility-users", …]`.

**`hooks/useTechnicians.ts`** — `useSetBaseLocation()` → `ws.technicians.setBaseLocation`; invalidates
`technicianKeys.all`; `meta.errorTitle`.

### 5.4 Allowance rules — travel and speed

**Shared slice `components/allowances/`** (both surfaces; neither page imports the other):

| File | What |
|---|---|
| `travelPreview.ts` | **Pure**, a line-for-line mirror of `app/core/travel.py`: `roadKm(straightM, factorPct)`, `tenths(km)`, `travelAmountPaise(km, rule)`, `explainTravel(straightKm, rule) → { roadKm, beyondKm, steps, rawPaise, amountPaise, capped, off }` with `off = rule.paisePerStep === 0`. Header comment: "change together with `app/core/travel.py`", the `mobileapp/src/lib/coordinates.ts` precedent. |
| `travelSchema.ts` | Zod over **rupees as typed** (strings, the `ForceCloseForm` convention); bounds of §4.1; the W2 rule as a `superRefine` on the *Most per job* field with the server's sentence; `toTravelBody(values)` (rupees → paise), `toTravelValues(rules)`. |
| `TravelRulesForm.tsx` | RHF; **two cards** in `grid gap-3.5 lg:grid-cols-2` — *Freelancers* first, *Employees* second. Each: Free distance, Pay for every (km, number), Amount per step, Road factor, Most per job, the *Off* notice when `off`, and `<TravelPreview>`. One **Save** sends both (the PUT takes both). `useWatch`, never `watch()` (React Compiler). Inputs `disabled` and no Save when `readOnly`. Under the form, the TA5 line (§5.10). Fields in `shared/FieldGrid`, never `<FieldGroup className="grid…">`. |
| `TravelPreview.tsx` | A local *straight-line km* input (default `21.6`, never saved) and the worked lines from `explainTravel`, through `utils/money.moneyPaise`; recomputes from `useWatch` as the admin types. |
| `speedSchema.ts` | **Pure** `validateSpeedRow(values, existing: SpeedRule[], editingId?)` + the Zod schema calling it in `superRefine`: hours integers 1–720; penalty hours ≥ reward hours; whole rupees 0–10 000; on **add**, no other row with the same type + `targetKind` + `targetId` (the PUT would silently overwrite it — upsert). `0 / 0` passes (W2: "off for this product"). |
| `speedRows.ts` | **Pure** `speedRowView(rule)` → `{ target: "Electronics › Television", reward, penalty, hint }` where `hint` comes from `overridesName` / `overriddenBy` / `targetActive` / `0/0` (§5.10 wording keys). |
| `pickTree.ts` | **Pure** adapters to one shape, `PickNode { id; name; depth; isLeaf; isActive; children: PickNode[]; models: { id; name; brandName }[] }`: `fromProductTree(ProductNode[])` (staff) and `fromSpeedCatalogue(catalogue)` (franchise — builds the tree from `parentId`, sorts by name, attaches models to their node). |
| `SpeedTargetPicker.tsx` | Renders `PickNode[]` as nested `ul > li` with a **Choose** button per node and per model, an *Already has a rule* word in place of Choose for taken targets (per chosen type), inactive rows greyed. Loading = `masters/CategoryTreeSkeleton`; `ErrorState` + Retry; `EmptyState` when empty. **Decision (writer): not `masters/CategoryTree`.** Its rows print technician counts and both prices, and its model chips carry the vendor and spec tooltip; the franchise catalogue is price-free and count-free by design (Task 11 W16), so reusing it would mean either faking those numbers or forking its row components. The picker reuses its skeleton, its nesting pattern and its card bands, and stays ~120 lines. |
| `SpeedMatrixTable.tsx` | `shared/DataTable`. Columns *Applies to* (path + hint), *Type*, *Reward*, *Penalty*, row actions *Edit rule* / *Remove rule* (→ `ConfirmDialog` naming the row, closed in `onSuccess`). *Technician type* filter pills (All / Employees / Freelancers) in `?type=` — filtered client-side (one response). Toolbar **Add rule** (`size="toolbar"`). Read-only → no actions, no button. |
| `SpeedRuleDialog.tsx` | Add / edit. *Applies to* row → `SpeedTargetPicker` in a nested dialog (`Choose category or product` / `Change`; disabled on edit — the target is the key). *Technician type* — a `ChoiceCards` wrapper `TechnicianTypeField` (two labelled cards; disabled on edit). Four inputs. Closes on success only. |
| `AllowancesView.tsx` | A local `ViewSwitch` (*Travel* / *Speed*, `?view=travel\|speed`, the `CreditsPage` pattern), keyed children. Props `scope`, `readOnly`, `franchiseeName`. |

**Pages and wiring**

| Route / place | File | Gate |
|---|---|---|
| `/franchise/settings` | `pages/franchise/FranchiseAllowancesPage.tsx` → `<AllowancesView scope={{kind:"franchise"}} readOnly={false} franchiseeName={me.franchisee.name} />` | `franchiseNav.ts` entry `{ label: "Allowance rules", to: "/franchise/settings", icon: Route, feature: "franchise.settings" }` after *Employee statements*; `franchiseRouteMeta.ts` |
| `/settings/allowances` | `pages/settings/AllowancesPage.tsx` — finds the home franchisee with Task 08's `useFranchiseeOptions({ enabled })` (`isHome`); `readOnly = !(has("settings.edit") && role ∈ {admin, national_head})` | `nav.ts` → Configuration, after *Rules Config*: `{ label: "Allowances", to: "/settings/allowances", icon: Route, feature: "settings.view" }`; `routeMeta.ts` |
| `/franchisees/:id` (Task 08's `FranchiseePage`) | an **Allowances** card: `<AllowancesView scope={{kind:"franchisee", franchiseeId}} readOnly />` on a **non-home** franchisee, shown only when `role ∈ {admin, national_head}` (the API 404s the speed read for anyone lower, and a 404 would toast). The home franchisee's card says *Edited under Configuration → Allowances* with a link. | — |

Loading: two `Skeleton h-96` cards / `TableSkeleton`; `ErrorState` + Retry on a failed read; speed empty
state; toast on save. The staff page names the home franchisee in its subtitle.

### 5.5 Base-location pin

| File | What |
|---|---|
| `components/geo/BaseLocationMap.tsx` | **Default export, lazy-loaded** (beside `IndiaMap`, whose split-chunk reasoning applies). `import "leaflet/dist/leaflet.css"` here so the CSS rides the chunk. `MapContainer className="h-80 w-full rounded-md"` (Leaflet needs a height); `TileLayer url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"` (no `{s}` — OSM retired subdomains), `maxZoom={19}`, `attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'`. One **draggable** `Marker` with an `L.divIcon` whose class names are **static Tailwind** (`size-4 rounded-full border-2 border-white bg-brand-500 shadow`) — never `L.Icon.Default`, whose PNGs 404 after Vite hashing. `useMapEvents({ click })` and `dragend` → `onPick({ lat, lng })`. A `tileerror` counter (≥ 4) → `onTilesFailed()`. Centre: the value at zoom 15, else India (22.5, 79.0) at zoom 5; a `key` re-centres when the value is set from outside. |
| `components/technicians/baseLocation.ts` | **Pure.** `inIndia(lat, lng)` (6–38 / 68–98 — mirrors `INDIA_LAT/LON`), `roundCoord(n)` → 5 dp, `formatLatLng`, `BASE_SOURCE_LABEL: Record<BaseSource, string>`, **`BASE_SOURCE_CHIP: Record<BaseSource, { label; class }>` — `pincode` *Pincode*, `gps` *GPS*, `map` *Map*, `manual` *Set by admin* (owner ruling 2026-10-15, R9; static classes, a word never a tint alone)**, `describeBase(base)`, `toBaseBody(values)` (pincode → `{ pincode }`; else `{ latitude, longitude, source }` rounded). |
| `components/technicians/BaseLocationDialog.tsx` | RHF + Zod `{ mode: "pincode" \| "map" \| "manual", pincode, latitude, longitude }`. Top: *Pincode* `Input` (6 digits) + **Use centre** — `usePincodeLookup(code)`: `null` → *We don't service that pincode*; a row → mode `pincode`, the pin moves when the row has a point (§4.3 reconcile), else *Saved as the pincode's centre*; `isError` → *Couldn't check that pincode* and never blocks. Then the `Suspense`-wrapped lazy map (fallback `Skeleton h-80`): a click/drag sets mode `map`. Then **Latitude / Longitude, always visible** — typing sets mode `manual`; `inIndia` checked on the field. Tiles failing → `shared/Notice` *The map couldn't load…*; the two inputs remain the way in. Save sends `toBaseBody`. Server codes land as field errors: `PINCODE_OUTSIDE_FRANCHISEE` / `PINCODE_HAS_NO_LOCATION` on the pincode, `BASE_OUTSIDE_INDIA` on the coordinates (match on the code, `lib/errorCodes.ts` gains the three constants) — and the toaster still shows the server's sentence (hard rule 9). Closes on success. |
| `components/technicians/BaseLocationPanel.tsx` | Card under `TechOnboardingCard`: description; the base via `describeBase` + `formatLatLng` + the **source chip** + *Set by {setByName} ({setByRole}) · when* — *Set by the technician · when* when `setBySelf` (owner ruling 2026-10-15, R9: a self-set base is visible, never hidden; no approval step, no cooldown); or the *Not set* warning (`bg-warn-bg text-warn`, words not tint). **Set base location** / **Change** when `canEdit`. Owns the dialog. |
| `pages/technicians/TechnicianProfilePage.tsx` | Mount `<BaseLocationPanel tech={tech} canEdit={canEdit} />` — Task 09's `canEdit = has(ws.features.editTechnician) && tech.canManage` already says the right thing on both surfaces (staff: only a home technician they manage — F8; portal: their own). Skeleton `h-32` while loading. |

**The list (R9).** `TechnicianTable` (Task 08/09's, both surfaces) gains a **Base** column: the source chip from `baseSource` / `baseSetBySelf`, or *Not set* (`bg-warn-bg text-warn`) when `baseSource` is null; no coordinates (the list never carries them). The panel's `baseLocation` is null for a staff viewer of a non-home technician — the chip still shows, the coordinates do not (Task 10 W13).

Not in `TechnicianFormDialog` (670 lines): the map is lazy, its own write, and Task 10 put no base on
the create body. A panel on the profile leaves the add/edit form untouched.

### 5.6 Parts catalogue on Categories & products

`components/masters/nodeMenu.ts` — `MasterAction` gains `{ kind: "node-parts"; node }` and
`{ kind: "model-parts"; node; model }` ("one union beats eight callback props" — the file's own rule).

`components/masters/CategoryTree.tsx` — new prop `canEditParts?: boolean`:
- `nodeMenuItems` appends **Spare parts** (after *Rules for this category*) when true; the row menu
  renders when `canEdit || canEditParts` (only *Spare parts* in it when `!canEdit`).
- `ModelChip` gains **Spare parts** above the separator; when `!canEdit && canEditParts` the chip becomes
  the dropdown with that single item instead of the plain `<span>`.
- The vendor portal's `menuFor` path is untouched.

`pages/masters/CategoriesPage.tsx` — `canEditParts={has("parts.catalogue")}`; the existing single `dialog`
state mounts `<SparePartsDialog owner=…>` for the two new kinds.

`components/parts/SparePartsDialog.tsx` — **its own dialog, not a section of `NodeFormDialog` /
`ModelFormDialog`.** *Decision (writer):* `ModelFormDialog` is 1,337 lines; parts are written row by row
(like `ModelSerialsPanel`), not saved once with a form; they are a different permission
(`parts.catalogue`); and the inherited list must be shown read-only from ancestors, which neither form
knows. Content (mounted only while open):

- **From above** — `inherited[]`, grouped by `ownerName` (nearest first), names as chips. A name hidden
  here by an inactive own row of the same name reads *hidden here*.
- **Added here** — `own[]`: name, *Hidden* chip when `!isActive`, inline **Rename** (Enter saves, Escape
  cancels — both `preventDefault`, the `ModelSerialsPanel` trap), **Hide here** / **Show here** (PATCH
  `isActive`; Hide is the destructive direction only in the sense that technicians stop seeing it — no
  confirm, it is reversible in one click), **Remove** (`ConfirmDialog`).
- Inherited chips offer **Hide here**, which adds an own row of that name and PATCHes it inactive
  (two calls, sequential; the D11 "FL-7 gasket" case).
- Add row: `Input` (1–80, trimmed, case-insensitive duplicate check against `own`) + **Add part**; Enter
  submits.
- Loading: `Skeleton` rows; `ErrorState` + Retry.

### 5.7 Facility queue, request page, facility users

**`components/parts/partStatus.ts` — pure.**

```ts
export const PART_STATUS_LABEL: Record<PartRequestStatus, string>;   // §5.10
export const PART_STATUS_CLASS: Record<PartRequestStatus, string>;   // static:
//  requested "bg-info-bg text-info" · approved "bg-status-assigned-bg text-brand-400"
//  issued "bg-ok-bg text-ok" · returned "bg-surface-3 text-ink-2" · rejected "bg-warn-bg text-warn"
// Owner ruling 2026-10-15 (R2): `partStatusLabel(r)` reads *Rejected after approval* for a rejected row with
// `rejectedAfterApproval`, same warn class.
export const PART_ACTION: Record<PartAction, { label: string; danger?: boolean }>;
/** The server's allowedActions, filtered to the four this build can draw, in a fixed order. */
export function actionsFor(r: Pick<PartRequest, "allowedActions">, canHandle: boolean): PartAction[];
export function offersAddToCatalogue(r: Pick<PartRequest, "catalogueTarget">): boolean;   // catalogueTarget !== null
export function trailLines(r: PartRequest): { key: string; text: string }[];              // ordered, §5.10 wording
export const DEFAULT_QUEUE_STATUSES = ["requested", "approved", "issued"] as const;      // Task 12 D22
```

Using `allowedActions` (rather than re-deriving the P4 machine) keeps the console and the server's
`allowed_actions` from drifting; an unknown action word is dropped, never drawn.

| File | What |
|---|---|
| `components/parts/PartStatusBadge.tsx` | pill: label + class (a word, never a tint alone). |
| `components/parts/PartRequestTable.tsx` | `DataTable` server mode (`useListParams`); **status pills** in `?status=`: *On the desk* (= the three defaults, the default view), *Requested*, *Approved*, *Issued*, *Returned*, *Rejected*, *All*; search. Columns *Request* (code, mono), *Part* (+ *Other* tag), *Ticket* (code + product), *Technician*, *Place* (city · pincode), *Raised* (`relativeTime`), *Status*. Row click and the code link → the request page with `useNavOrigin("Back to spare parts")` (hard rule 11 — both). `TableSkeleton`; `EmptyState`; filtered-empty via `DataTable`'s `narrowed`. |
| `components/parts/PartRequestDetail.tsx` | Facts (product, place, technician + `tel:` phone, ticket link with origin, note), `trailLines`, the return photo when `returnPhotoUrl` (signed — `onError` says *Image unavailable*, the `ProofThumb` rule), and one button per `actionsFor(r, true)`. |
| `components/parts/ApprovePartDialog.tsx` | Names part and ticket; checkbox *Add "{name}" to {catalogueTarget.nodeName}'s parts list* when `offersAddToCatalogue` — **unticked by default** (adding to a shared catalogue is deliberate). Confirm **Approve**. |
| `components/parts/RejectPartDialog.tsx` | Required reason 3–255 (`RescheduleDialog`'s required-reason shape; the server allows 1–255), **for both a requested and an approved request** (owner ruling 2026-10-15, R2). On an `approved` request the dialog is titled *Cancel the approved {part}?* with *{technician} was told it was coming — they see your reason.* and the button **Cancel approval**; otherwise **Reject request**. Both in danger. The *Reject* button on the request page and queue row is drawn whenever the server's `allowedActions` contains `reject` — i.e. on approved rows too. |
| `components/parts/IssuePartDialog.tsx` | Optional note ≤ 500; **Mark issued**. |
| `components/parts/ReturnPartDialog.tsx` | Optional note ≤ 500 + **one optional photo**: `shared/useImagePicker` (click + drop, same validation), **no crop** — the force-close / `PaymentProofForm` evidence exception (cropping evidence removes what it proves); preview with Remove. Submit uploads **first** (`uploadImage(file, "attachment")` → blob name), then `returnPartRequest`. An upload failure toasts and keeps the dialog open with the file (the `ForceClosePage` order). |
| `pages/franchise/FacilityQueuePage.tsx` + `pages/franchise/PartRequestPage.tsx` | `/franchise/parts`, `/franchise/parts/requests/:id`. The page owns the one open dialog (the `EscalationQueuePage` rule). `franchiseNav.ts` entry **above Tickets** (Task 09 §5.5): `{ label: "Spare parts", to: "/franchise/parts", match: ["/franchise/parts/"], icon: Wrench, feature: "parts.handle" }`; `FranchiseSidebar` badge = `counts.requested` (none at 0). Facility roles then land here (Task 09's `franchiseLanding` order). |
| ~~`pages/parts/PartsQueuePage.tsx` + `pages/parts/PartRequestPage.tsx` (ops)~~ | **Removed (owner ruling 2026-10-15, R4).** There is no staff-console parts queue, no `/parts` route, no ops `nav.ts` entry and no `usePartRequestCounts` badge in the staff shell — Admin/NH do not work the home queue. Home's facility staff use the portal like everyone else. |
| `components/notifications/routeFor.ts` (Task 09) | `FRANCHISE_ROUTES` gains `/parts/` → `/franchise/parts/`. **No reverse mapping into the ops table** (owner ruling 2026-10-15, R4): Task 12 always writes `/franchise/parts/requests/{id}`, and no staff reader hears `facility` rows. |
| `services/notifications.ts`, `components/notifications/kinds.ts` | `part_requested`, `part_decided`, `part_issued` in the union, `NOTIFICATION_KINDS` (after `upi_change`) and `KIND` (`Wrench`; requested `bg-info-bg text-info`, decided `bg-warn-bg text-warn`, issued `bg-ok-bg text-ok`). `satisfies` makes a miss a compile error. |
| `components/franchise/FacilityUserTable.tsx`, `AddFacilityUserDialog.tsx` | Mirror `pages/vendor/VendorUsersPage.tsx` + `components/vendor/AddVendorUserDialog.tsx`: Full name, Email, Phone (E.164 via `utils/phone`), **Role** (`ChoiceCards`; *Facility Admin* offered only when the viewer is a `franchisee_admin` — with one option it fills itself, hard rule 10 / `useAutoSelectSingle`). Success: `TemporaryPasswordPanel` when `temporaryPassword` is present. Row menu **Email a new password** → `ReissueFacilityUserPasswordDialog` (copy `masters/ReissueVendorPasswordDialog.tsx`'s two-phase shape exactly, as Task 08's admin dialog does), **Deactivate** → `ConfirmDialog`; **Activate** fires straight through (only the destructive direction asks); no menu on your own row, and a facility admin sees the menu only on operators. |
| `components/franchise/HomeFacilityUsersCard.tsx` | **Owner ruling 2026-10-15 (R4).** A *Facility users* card on Task 08's `FranchiseePage`, shown only for the **home** franchisee to `role ∈ {admin, national_head}` (`has("franchisees.manage")`). It reuses `FacilityUserTable` / `AddFacilityUserDialog` / `ReissueFacilityUserPasswordDialog` over a `FacilityUserSource` whose calls go to `/spare-parts/home-facility-users` (`services/parts.ts` → `homeFacilityUsers`); both roles are offered in the role picker. Copy §5.10. Not shown for a non-home franchisee (its own admins manage it) and not to RH/AM. |
| `pages/franchise/FacilityUsersPage.tsx` | `/franchise/facility-users`; `franchiseNav.ts` entry **last**: `{ label: "Facility users", to: "/franchise/facility-users", icon: UserCog, feature: "franchise.facility_users" }` (Task 09 §5.5 left this to Task 13). |

All new routes go in `routes.tsx` (lazy) and in `franchiseRouteMeta.ts` / `routeMeta.ts` (§5.10).

### 5.8 Ticket detail panels and force-close travel

| File | What |
|---|---|
| `components/tickets/AllowancePanels.tsx` | `TravelPanel` — renders nothing when `ticket.travel === null`. Header note *Frozen when {technician} accepted · {time}*; rows Distance / From / To / Rule / Allowance; reason lines for `no_base_location` / `no_customer_point`; status from `creditedPaise` + ticket status (*Paid*, *Paid when the customer confirms*, *Not paid*). `SpeedPanel` — nothing when `ticket.speed === null` (the server sends it to staff on every ticket in scope, a non-home one included — owner ruling 2026-10-15, R8 — so the panel is never gated on the ticket's franchisee); Rule (*{matchedName}*, product vs category), Reward, Penalty, Time taken (`workingHours` as *9 h 24 m*, plus *excluding {w} waiting for parts* when `partWaitHours > 0`; *Clock started {time}* while pending, with *the start of the slot* or *when it was accepted* beside it — whichever `clockStartedAt` equals — R1), Outcome per `outcome` (+ *capped by the monthly limit* when `capped`, *reversed* when `reversed`). Money via `moneyPaise` / `moneyPaiseSigned` (hard rule 7). |
| `components/tickets/PartRequestsPanel.tsx` | Nothing when `partRequests` is empty. Per request: name + `PartStatusBadge`, *{code} · raised {when}*, note in quotes, `trailLines`, *Photo on record* when a return carries one. **Open request** link (to `/franchise/parts/requests/:id`) only when the viewer is a handler — `has("parts.handle")` on the portal; **never on the staff console** (owner ruling 2026-10-15, R4: staff read the trail, they do not work the queue); the request page itself handles a 403. A `part_rejected` trail line for a request rejected after approval reads *Approved by {name} … · Cancelled after approval by {name} · {when} — {reason}* (§5.10). |
| `pages/tickets/TicketDetailPage.tsx` | Right column: `CustomerVerdict`, `CustomerPanel`, `TechnicianPanel`, **`TravelPanel`, `SpeedPanel`**, `PenaltiesPanel`, **`PartRequestsPanel`**, `ProofPanel`, `ForceClosureEvidence`. **Not** gated on `isOps`: the server nulls/empties the fields per caller, so the franchise portal (mounted with `actions={null}`) shows them and the vendor portal does not — one rule, decided server-side. |
| `components/tickets/ForceCloseForm.tsx` | New prop `travel: { defaultPaise: number; maxPaise: number; km: number; technicianName: string } \| null`. New field `travelAllowance` (rupees string, `^\d{1,7}$` or empty), shown only when `travel` is non-null **and** `maxPaise > 0`. Default `String(defaultPaise / 100)`. The schema becomes a factory `forceCloseSchema(travelMaxPaise)` (move to `forceCloseSchema.ts`) whose `superRefine` caps the field. After the payout field. |
| `pages/tickets/ForceClosePage.tsx` | `travel` from `ticket.travel` (`forceCloseDefaultPaise`, `forceCloseMaxPaise`, `km`) when `ticket.technicianId` is set; send `travelPaise: Number(values.travelAllowance \|\| 0) * 100` only when the field was shown, else omit (omitted = nothing, Task 10 W5). |

### 5.9 Who sees what (presentation only — hard rule 8; the server enforces)

| Screen | Franchisee admin | Facility admin / operator | Admin / NH | RH / AM |
|---|---|---|---|---|
| Allowance rules (portal) | edit | — | — | — |
| Configuration → Allowances (home) | — | — | edit | read (`settings.view`) or hidden |
| Franchisee page → Allowances (non-home) | — | — | read | hidden |
| Base pin | own technicians | — | home technicians they manage | home technicians they manage (`technicians.edit`) |
| Spare parts queue | own franchisee | own franchisee | — (no staff queue, owner ruling 2026-10-15) | — |
| Facility users | both roles | operators only (facility admin) | **home franchisee only**, on its Franchisees page (owner ruling 2026-10-15) | — |
| Catalogue editor | — | — | yes (`parts.catalogue`) | — |
| Ticket travel / speed / parts panels | own franchisee's tickets | parts panel only, on tickets with a request | yes (all three) | travel **and speed** on every ticket in scope, non-home included (owner ruling 2026-10-15, R8); parts panel read-only |

### 5.10 PROPOSED copy (sign-off required — X2)

**Navigation & page meta**

| Where | English |
|---|---|
| portal `/franchise/settings` | **Allowance rules** · *Travel and speed allowances for your technicians* |
| ops `/settings/allowances` | **Allowances** · *Travel and speed allowances for {home franchisee}'s technicians* |
| portal `/franchise/parts` (no ops route — owner ruling 2026-10-15, R4) | **Spare parts** · *Part requests from technicians* |
| request pages | **{request code}** · *Spare part request* |
| portal `/franchise/facility-users` | **Facility users** · *Who approves and logs spare parts* |
| ViewSwitch (aria *What to show*) | *Travel* · *Speed* |

**Travel**

| Place | English |
|---|---|
| card titles / descriptions | *Freelancers* — *Paid on each job a freelancer completes, measured one way from their base to the customer.* · *Employees* — *Paid on each job an employee completes, on top of salary, through their monthly statement.* |
| fields | *Free distance (km)* — *Nothing is paid up to this distance.* · *Pay for every (km)* — *Part of a step is not paid.* · *Amount per step (₹)* · *Road factor (%)* — *Straight-line distance × this = road distance. 130 % suits most cities.* · *Most per job (₹)* |
| off notice | *Off — set an amount per step to switch it on.* |
| W2 (server sentence, client-side) | *Set a maximum per job — with a ₹0 maximum the allowance is always ₹0.* |
| preview | *Worked example* · *Straight-line distance to the customer (km)* · *{straight} km × {factor} % = {road} km by road* · *{beyond} km beyond the free {free} km = {steps} steps of {step} km* · *{steps} × {perStep} = {raw}* · *Capped at {max}* · *Pays {amount}* · *Pays nothing — within the free distance* · *Pays nothing — the allowance is off* |
| under form | *Changes apply to jobs accepted from now on. Jobs already accepted keep the allowance they were given.* |
| save | *Save travel rules* · toast *Travel rules saved* · errorTitle *Couldn't save the travel rules* · load *Couldn't load the travel rules* |
| validation | *Enter a whole number of kilometres* · *Enter a whole number of rupees* · *Between 100 % and 300 %* · *Between 1 and 50 km* |

**Speed**

| Place | English |
|---|---|
| intro | *Finish fast, earn a reward; finish late, pay a penalty. The clock runs from the start of the job's time slot (or from accepting it, if that is later) to pressing Complete, minus time waiting for a part. A product's rule beats its category's, and the deepest category wins.* |
| filter / button | *Technician type: all* · *Employees* · *Freelancers* · *Add rule* |
| columns / cells | *Applies to* · *Type* · *Reward* · *Penalty* · *Within {h} h · {amount}* · *After {h} h · −{amount}* · *—* |
| hints | *Overrides {name}* · *{n} deeper rules override this* (plural: *1 deeper rule overrides this*) · *Off for this product* (0/0) · *No longer in the catalogue* |
| empty | *No speed rules yet* / *Add a rule for a category or a product. A job no rule matches earns and pays nothing for speed.* |
| row menu / confirm | *Edit rule* · *Remove rule* · *Remove the rule for {target} ({type})?* / *Jobs accepted from now on stop earning or paying for speed here. Jobs already accepted keep their rule.* / *Remove rule* |
| dialog | *Add speed rule* · *Edit speed rule* · *Applies to* · *Choose category or product* · *Change* · *Technician type* · *Reward if finished within (hours)* · *Reward (₹)* · *Penalty if finished after (hours)* · *Penalty (₹)* · *Between the two, nothing is paid or charged. Set both amounts to 0 to switch speed off for this product.* · *Save rule* |
| validation | *The penalty can't start before the reward ends* · *Between 1 and 720 hours* · *Up to ₹10,000* · *There is already a rule for {target} for {type}. Edit that one instead.* |
| picker | *Choose what this rule applies to* / *A category covers every product beneath it.* · *Choose* · *Already has a rule* · *Couldn't load categories* · *No categories yet* |
| toasts | *Rule saved* · *Rule removed* · errorTitles *Couldn't save the rule* · *Couldn't remove the rule* · *Couldn't load the speed rules* |
| franchisee page | *Allowances* · *Edited under Configuration → Allowances* |

**Base location**

| Place | English |
|---|---|
| panel | *Base location* / *Where travel allowance is measured from.* · *Pincode {code} (area centre)* · *Pin on the map* · *Phone location* · *Typed coordinates* · *Set by the technician · {when}* · *Set by {name} ({role}) · {when}* · chips *Pincode* · *GPS* · *Map* · *Set by admin* · *Not set — jobs this technician accepts pay no travel allowance.* · *Set base location* · *Change* |
| dialog | *Base location · {name}* / *Click the map or drag the pin, start from a pincode's centre, or type the coordinates.* · *Pincode* · *Use centre* · *Latitude* · *Longitude* · *Save base location* · *Cancel* |
| notices | *We don't service that pincode.* · *Saved as the pincode's centre.* · *Couldn't check that pincode.* · *The map couldn't load. Type the coordinates instead.* · *That point is outside India.* |
| toasts | *Base location saved* / *Jobs {name} accepts from now on measure travel from here.* · errorTitle *Couldn't save the base location* |

**Parts catalogue**

| Place | English |
|---|---|
| menu item | *Spare parts* |
| dialog | *Spare parts · {name}* · node: *Every product under {name} offers these, plus anything added further down.* · model: *This product offers these on top of its categories' parts.* · *From above* · *From {owner}* · *Added here* · *No parts added here yet.* · *Hidden* · *hidden here* · *Part name, e.g. Wall bracket* · *Add part* · *Rename* · *Hide here* · *Show here* · *Remove* |
| validation / confirm | *Enter a part name* · *Up to 80 characters* · *That part is already on this list* · *Remove {name}?* / *Technicians stop seeing it. Requests that already name it keep it.* / *Remove part* |
| errorTitles | *Couldn't add the part* · *Couldn't update the part* · *Couldn't remove the part* · *Couldn't load the parts list* |

**Requests**

| Place | English |
|---|---|
| status labels | *Requested* · *Approved* · *Issued* · *Returned* · *Rejected* · *Rejected after approval* |
| pills | *On the desk* · *Requested* · *Approved* · *Issued* · *Returned* · *Rejected* · *All* |
| columns / tag | *Request* · *Part* · *Ticket* · *Technician* · *Place* · *Raised* · *Status* · *Other* |
| search | *Search by request, ticket, part or technician* |
| empty | *No part requests* / *Requests technicians raise from a job appear here.* |
| not a handler | (server sentence, hand-typed URL only) *Spare parts are handled by the franchise's facility staff.* |
| actions | *Approve* · *Reject* · *Mark issued* · *Log return* |
| approve | *Approve {part} for {ticket}?* / *{technician} is told it's approved.* · *Add "{name}" to {category}'s parts list* · *Approve* |
| reject | *Reject {part}?* / *{technician} sees your reason.* · *Reason* · *Tell the technician why* · *Reject request* · for an approved request (owner ruling 2026-10-15): *Cancel the approved {part}?* / *{technician} was told it was coming — they see your reason.* · *Cancel approval* |
| issue | *Issue {part} to {technician}?* / *Records that the new part has left the store.* · *Note (optional)* · *Mark issued* |
| return | *Log the old part back · {part}* · *Note (optional)* · *Photo (optional)* · *Add a photo* · *JPG, PNG or WEBP · up to 8 MB* · *Log return* |
| trail | *Raised by {technician} · {when}* · *Approved by {name} · {when}* · *Rejected by {name} · {when} — {reason}* · *Cancelled after approval by {name} · {when} — {reason}* · *Issued by {name} · {when}* · *Old part received by {name} · {when}* · *Image unavailable* |
| toasts | *Request approved* · *Request rejected* · *Approval cancelled* · *Part issued* · *Return logged* · errorTitles *Couldn't approve the request* · *Couldn't reject the request* · *Couldn't mark it issued* · *Couldn't log the return* · *Couldn't upload the photo* · *Couldn't load the request* |
| ticket panel | *Spare parts* · *{code} · raised {when}* · *Photo on record* · *Open request* |
| notification kinds | *Part requested* · *Part not approved* · *Part issued* |
| timeline (server, Task 12 §4.7) | *Spare part requested* · *Spare part approved* · *Spare part not approved* (or, when it had been approved, *Approved spare part cancelled*) · *New part issued to technician* · *Old part received back* |
| bell (server, Task 12 §4.10) | *{ticketCode}: spare part requested* / *{partName} · {technicianName} · {city} {pincode}* · *{ticketCode}: spare part not approved* / *{partName} · {reason}* · *{ticketCode}: spare part issued* / *{partName} to {technicianName} — book the revisit if one is needed* |

**Ticket panels, ledger, force-close**

| Place | English |
|---|---|
| travel panel | *Travel allowance* · *Frozen when {name} accepted · {time}* · *Distance* · *{km} km by road ({straight} km straight × {factor} %)* · *From* · *To* · *Base · pincode centre* · *Base · map pin* · *Base · phone location* · *Base · typed coordinates* · *Customer's address pin* · *Customer's pincode centre* · *Rule* · *{free} km free, then {perStep} per {step} km, up to {max}* · *Allowance* · *Paid {amount}* · *Paid when the customer confirms* · *Not paid* |
| travel reasons | *No base location when accepted — nothing to pay.* · *No location for the customer — measured as 0 km.* |
| speed panel | *Speed allowance* · *Rule* · *Product: {name}* · *Category: {name}* · *Reward* · *Penalty* · *Time taken* · *{h} h {m} m* · *excluding {w} waiting for parts* · *Clock started {time}* · *(start of the slot)* · *(when it was accepted)* · *Outcome* · *Rewarded {amount}* · *Penalised −{amount}* · *capped by the monthly limit* · *reversed* · *Neither — between the two* · *Settled when the customer confirms* · *Not paid — force-closed* |
| penalties panel | *Speed penalty ·* (prefix) |
| ledger | *Speed reward* · *Speed penalty* · *incl. {amount} speed penalties* · *incl. {amount} speed rewards* |
| timeline (server, Task 11) | the `speed_settled` title is the server's |
| force-close | *Travel allowance (₹)* · *Worked out as {amount} when {name} accepted ({km} km). At most {max}. Clear it to pay nothing.* · *At most {max}* |

**Facility users**

| Place | English |
|---|---|
| page | *Add facility user* · *Name* · *Email* · *Phone* · *Role* · *Status* · *Facility Admin* · *Facility Operator* · *Active* · *Deactivated* |
| empty | *No facility users yet* / *Add the people who run your parts store. They sign in here and see only spare-part requests.* |
| home card (owner ruling 2026-10-15, R4) | *Facility users* / *{home name} has no parts store yet — until it has a facility user, its technicians can't request spare parts.* (when none) · *Who runs {home name}'s parts store. They sign in to the franchise portal and see only spare-part requests.* (when some) · the dialog and menus as above |
| dialog | *Add facility user* · *Full name* · *Email* · *Phone* · *Role* · *Facility Admin — also adds and removes operators* · *Facility Operator — approves, issues and logs returns* · *Add user* |
| menu / confirm | *Email a new password* · *Deactivate* · *Activate* · *Deactivate {name}?* / *They can no longer sign in. Their past approvals stay on record. You can activate them again.* / *Deactivate* |
| reissue | *Email {name} a new password?* / *Their current password stops working and they are signed out everywhere.* · *Email new password* · panel heading *Password reset, but the email didn't send* (Task 08's) · toast *New password emailed to {name}* · errorTitle *Couldn't reset the password* |
| toasts | *{name} added* / *We emailed their temporary password.* · *{name} deactivated* · *{name} activated* · errorTitles *Couldn't add the user* · *Couldn't update the user* |

---

## 6. Unit tests (vitest — Task 00 harness, `src/**/*.test.{ts,tsx}`)

Colocated beside the module. Pure modules only.

**`components/allowances/travelPreview.test.ts`** (F = free 20, step 2, 1000 p, 130 %, max 30000):
1. `explainTravel(21.6, F)` → `roadKm 28.1`, `steps 4`, `amountPaise 4000` (index §3.5).
2. `roadKm` half-up at the tenth: a straight distance whose product is `x.x5` rounds up; `x.x4999` down.
3. Road km exactly `free` → 0. 4. `free + step − 0.1` → 0 (partial dropped). 5. `free + step` → 1 step.
6. 200 km straight → 30000, `capped: true`. 7. `paisePerStep 0` → 0, `off: true`.
8. `stepKm 1` vs `2` on the same km → steps double. 9. negative / `NaN` input → 0, never negative.
10. **Parity table** — every `(straight_m, rule, expected)` row of Task 10's `api/tests/unit/test_travel.py`
    copied verbatim (comment: both tables change together).

**`components/allowances/speedSchema.test.ts`** — valid row; penalty hours < reward hours → error on the
penalty field; equal hours pass; `0/0` passes; reward only passes; hours 0 / 721 / 1.5 → error; ₹10,001
→ error; duplicate type + target on add → error; same target, other type → passes; editing does not
duplicate itself.

**`components/allowances/pickTree.test.ts`** — `fromSpeedCatalogue` nests by `parentId` at any depth,
attaches models to their node, sorts by name, keeps inactive nodes flagged; an orphan (`parentId` missing)
becomes a root rather than vanishing; `fromProductTree` maps a two-level `ProductNode` fixture with models.

**`components/allowances/speedRows.test.ts`** — path joined with ` › `; model vs node wording;
`overridesName` → *Overrides …*; `overriddenBy` 1 / 2 plural; `0/0` → *Off for this product*;
`targetActive: false` → *No longer in the catalogue*.

**`components/parts/partStatus.test.ts`** — every status has a label and a class; `actionsFor` returns the
server's allowed actions in fixed order, drops an unknown word, and returns `[]` when `!canHandle`;
`offersAddToCatalogue` iff `catalogueTarget`; `trailLines` for a returned request: raised → approved →
issued → returned; a rejected one: raised → rejected (with reason); **a request with `rejectedAfterApproval`: raised → cancelled after approval (with reason); `partStatusLabel` reads *Rejected after approval* only for that flag; `actionsFor` with `allowedActions: ["issue","reject"]` returns both, in fixed order (owner ruling 2026-10-15, R2).**

**`components/technicians/baseLocation.test.ts`** — `inIndia` at the bounds (6/68 and 38/98 inside;
5.99, 98.01 outside); `roundCoord(17.4401234)` → `17.44012`; `describeBase` per source; `BASE_SOURCE_CHIP` — pincode/gps/map/manual give *Pincode* / *GPS* / *Map* / *Set by admin*, an unknown source falls back to a neutral chip with the raw word (R9); `toBaseBody`:
pincode mode → `{ pincode }` only; map/manual → rounded point + source.

**`components/tickets/forceCloseSchema.test.ts`** — travel at max passes; max + ₹1 → *At most {max}*;
empty passes; non-numeric fails; with `travelMaxPaise = null` the field is unconstrained-but-ignored.

**`components/ledger/ledgerKinds.test.ts`** (extract `poolSign(kind)`, `kindLabel(kind)`, `kindChip(kind)`
from `LedgerTable.tsx` into `ledgerKinds.ts`) — `speed_reward` −1, `speed_penalty` +1, `penalty` +1,
`bonus` −1, `reversal` −1; an unknown kind → +1, raw label, neutral chip; `poolSign('constructor')` is
not a function value (own-property lookup).

---

## 7. Acceptance criteria

Against RelianceDB with Tasks 10–12 on the dev API.

**Ledger (ships first)**
1. Given a pool entry of kind `speed_reward` ₹200, when an Admin opens Penalty & Bonus, then the row reads
   *Speed reward* with the bonus chip and **−₹200**, the CSV says the same, and no cell shows `NaN`.
2. Given a `speed_penalty` row, it reads *Speed penalty*, **+₹150**, and *(reversed)* once reversed; the
   summary shows *incl. ₹150 speed penalties* and `collected − bonuses = balance` still holds.
3. Given a row with a kind the console has never heard of (insert one by hand on dev), the row renders with
   the raw kind, neutral chip, unsigned amount.

**Status**
4. `/tickets?status=Awaiting%20Part` lists such a ticket; the dropdown shows it selected; the chip has the
   warn tint **and** the words. The dashboard's *Assigned / in progress* count equals the list it opens.
5. On that ticket an NH sees *Change the time*; the slot-request strip does not claim the customer is
   picking a time; *Re-assign* is still offered only where it was before.

**Travel rules**
6. A franchisee admin opens *Allowance rules*: two cards with 20/30 km free, 130 %, ₹0 ⇒ *Off* on both.
7. Setting Freelancers 20 / 2 / ₹10 / 130 / ₹300 and typing 21.6 in the worked example reads *Pays ₹40*
   before saving; *Save travel rules* toasts and a reload shows the values.
8. ₹10 per step with *Most per job* 0 shows the W2 sentence on the field and sends nothing; 99 % / 301 %
   / step 0 / step 51 are refused on the field.
9. Staff Admin → Configuration → *Allowances* names the home franchisee and saves its rules; a Regional
   Head with `settings.view` sees every input disabled and no Save; on a non-home franchisee's page an NH
   sees the read-only Allowances card and an AM does not see it at all (no toast).
10. Loading shows the card skeletons; a failed GET shows `ErrorState` + Retry; a failed PUT toasts and keeps
    what was typed.

**Speed matrix**
11. Empty matrix → empty state. Adding *Television · Freelancers · 12 h ₹200 · 24 h ₹150* lists the row; a
    product-level rule beneath it shows *Overrides Television*, and the Television row *1 deeper rule
    overrides this*.
12. In the picker, Television reads *Already has a rule* for Freelancers and is choosable for Employees.
13. Penalty hours < reward hours or ₹10,001 block Save with the field message; `0/0` saves and the row
    reads *Off for this product*.
14. *Remove rule* confirms first; the dialog closes only on success.
15. The franchise picker loads `/franchise/settings/speed/catalogue` (network tab) and never
    `/masters/nodes`; staff load `/masters/nodes`. Both show loading / empty / error states.

**Base location**
16. A home technician with no base: a staff manager who `canManage` sees *Not set — …* and *Set base
    location*; a staff user viewing a non-home technician sees the panel without the button.
17. 500049 + *Use centre* moves the pin (or says *Saved as the pincode's centre.*); Save sends
    `{ "pincode": "500049" }`; the panel then reads *Pincode 500049 (area centre)* · the *Pincode* chip · *Set by {name} (Franchisee Admin) · {when}*.
17a. **Source visibility (owner ruling 2026-10-15, R9).** A technician who set a GPS base in the app shows the *GPS* chip and *Set by the technician* on the panel and the *GPS* chip in the technician list; after the franchisee admin corrects it on the map the chip reads *Map* and the line names the admin; typed coordinates read *Set by admin*. There is no approve/reject control anywhere and nothing delays a save. An Area Manager viewing a non-home technician sees the list chip but no coordinates.
18. Map click / drag then Save sends `source: "map"`; typed coordinates send `source: "manual"`, rounded to 5 dp;
    a point outside India is refused on the field, and if forced the server's `BASE_OUTSIDE_INDIA` lands on
    the coordinates and in the toaster.
19. A pincode owned by another franchisee → `PINCODE_OUTSIDE_FRANCHISEE` under the pincode field.
20. With `tile.openstreetmap.org` blocked, the map notice appears and typed coordinates still save.
21. The OSM attribution is visible on the map at all times; `vite build` emits Leaflet only in the
    `BaseLocationMap` chunk.
22. The franchise admin sets a base on their own technician via `/franchise/technicians/{id}/base-location`
    (network tab); another franchisee's technician URL → 404 page.

**Parts catalogue**
23. Admin: Categories → *Television* ⋯ → *Spare parts* → add "Wall bracket"; a product under Television →
    *Actions* → *Spare parts* lists it under *From Television*.
24. *Hide here* on an inherited "Wall bracket" for one product adds a *Hidden* own row and the inherited chip
    reads *hidden here*; *Show here* undoes it.
25. A duplicate name (any case) is refused client-side; rename with Enter saves, Escape cancels without
    submitting the surrounding page; *Remove* confirms first. A user without `parts.catalogue` sees no
    *Spare parts* item.

**Requests**
26. A facility operator's rail shows *Spare parts* with a badge equal to `requested`; the default *On the
    desk* view lists requested, approved and issued, oldest waiting first.
27. Approving an Other request with the box ticked moves it to *Approved*, and Categories → the ticket's leaf
    → *Spare parts* now lists that name under *Added here*. Unticked → the catalogue is unchanged.
28. *Reject* needs 3–255 characters; the ticket returns to `In Progress` when nothing else is open (status
    chip on the ticket page).
28a. **Cancel an approved request (owner ruling 2026-10-15, R2).** An *Approved* row offers **Mark issued** *and*
    **Reject**; the dialog reads *Cancel the approved {part}?*, needs a reason, and on success the row reads *Rejected
    after approval*, the trail shows *Cancelled after approval by {name} · {when} — {reason}*, and the ticket returns to
    `In Progress` when nothing else is open. An *Issued* row offers only **Log return**.
29. *Mark issued*, then *Log return* with a photo: `POST /uploads?kind=attachment` precedes `/return`; the
    request page shows the photo; a failed upload toasts and logs nothing.
30. Two tabs approving the same request: the second gets the server's 409 sentence in the toaster and the
    page refetches.
31. Every list: skeleton rows, *No part requests*, `ErrorState` + Retry; a narrowed pill with nothing shows
    the narrowed empty state.
32. **No staff queue (owner ruling 2026-10-15, R4).** An Admin / National Head's rail has **no** *Spare parts* item and `/parts` is a 404 page; a hand-typed `GET /spare-parts/requests` as Admin → 403. A home **facility operator** (portal) sees home's requests. A home franchise with no facility user: its technician's job shows the *no parts store* line (Task 15), not a request.
33. A `part_requested` bell row opens the request page on the reader's own surface (`routeFor`).

**Facility users**
34. A franchisee admin adds a Facility Admin; with the email failing, the temporary password panel shows. A
    facility admin's dialog offers only *Facility Operator*, already selected. *Deactivate* confirms;
    *Activate* does not; your own row has no menu. *Email a new password* on an operator, with the email
    failing, shows the temporary password panel. Loading / empty / error states render.
35. A facility operator cannot reach `/franchise/settings` or `/franchise/facility-users` — the franchise
    guard redirects; the server 403s regardless.
35a. **Home facility users (owner ruling 2026-10-15, R4).** An Admin / NH opens Franchisees → *home* → the **Facility users** card: the empty state names the missing parts store; adding a Facility Admin (both roles offered) posts to `/spare-parts/home-facility-users`, the temporary-password panel shows when the email fails, *Email a new password* and *Deactivate* work as for the portal's table. A non-home franchisee's page has no such card; RH/AM never see it; a SkyFix facility user cannot be reached through it (404).

**Ticket panels & force-close**
36. An accepted ticket with 28.1 km / ₹40: staff and the franchise portal show the Travel panel with those
    figures and *Paid when the customer confirms*; after closure *Paid ₹40*. The vendor portal shows none of
    the three new panels.
37. `reason: "no_base_location"` shows the reason line and ₹0.
38. A completed job with a speed rule shows *Time taken* excluding part waits and the outcome the server
    sent — **as an Area Manager on SkyFix's (non-home) ticket too, alongside the Travel panel (owner ruling
    2026-10-15, R8); a facility operator and the vendor see neither**; the *Clock started* line says whether it began at the slot or the accept; a force-closed one reads *Not paid — force-closed*; a speed penalty appears in Penalties as
    *Speed penalty · …* with **Reverse**.
39. Force-close shows *Travel allowance (₹)* = 40; ₹301 against a ₹300 max blocks submit; clearing it sends
    `travelPaise: 0` and no travel row is written; a ticket with no travel block shows no field.

**Gates**
40. `npm run lint`, `npm run typecheck`, `npm run build` and the vitest suite pass; no hex outside
    `theme.css`; `grep -rn 'FieldGroup className=' src/ | grep -Ei 'grid|COLS'` finds nothing.

---

## 8. Out of scope / traps

- **Out of scope:** stock and money for parts (P5); a franchisee↔company settlement (F11); a pincode
  coordinate correction screen (G2); editing a speed rule's target or type (delete and re-add); Task 11's
  `/speed/effective` preview ("what would this product pay?") — a worthwhile follow-up on the speed view;
  the technician's own screens (Tasks 14/15). *(The "No base" / source column on the technician list is now IN scope — owner ruling 2026-10-15, R9, §5.5.)*
- **Release order:** §5.1 (ledger kinds) must be on **both** console deploys before Task 11 publishes;
  §5.2 (status) before Task 12 publishes — an unknown status renders a transparent chip with no class
  (`STATUS_CLASS[status]` undefined) and the status filter cannot find it. The rest may follow the APIs.
- **OpenStreetMap tile usage policy** (operations.osmfoundation.org/policies/tiles): visible attribution
  (never hide Leaflet's control), a browser Referer (default `strict-origin-when-cross-origin` sends the
  origin — never add `referrerpolicy="no-referrer"`), no bulk or pre-fetching, no `no-cache` overrides.
  This is a few map opens a day. If the console ever renders maps routinely, move to a keyed provider —
  one URL in `BaseLocationMap`.
- **Leaflet + Vite:** default marker PNGs 404 after hashing (use the `divIcon`); `leaflet.css` must be
  imported inside the lazy module; the container needs a height. Leaflet's stylesheet contains hex — a
  vendor file, never copy its colours. Do not invert OSM tiles for the dark theme (it inverts the
  attribution's contrast too).
- **The preview is a mirror.** If Task 10 changes rounding, `travelPreview.ts` and its parity table change in
  the same PR. The server's figure is the one paid.
- **`isTimeChoosable` ≠ reschedulable.** Use `isReschedulable`; never widen `TIME_CHOOSABLE_STATUSES`.
- **Visibility is server-side.** Never gate the new ticket panels on `isOps` (it would hide them from the
  franchise portal) or on a surface string.
- **Speed upsert overwrites.** The PUT is keyed on type + target; the client duplicate check on *add* is
  what stops an "add" silently replacing an existing row.
- **Staff speed vs travel prefixes differ** (Task 10: `/settings/travel`; Task 11: `/franchisees/{id}/speed-rules`)
  — `services/allowances.ts` hides that; do not spread it into components.
- **No staff parts queue (owner ruling 2026-10-15, R4).** Do not add one back for the home franchisee "just until it has staff": the answer is the *Facility users* card on the home franchisee's page. `routeFor` maps `/parts/` one way only.
- **Reissue for facility users** uses Task 12's `POST /franchise/facility-users/{membershipId}/reissue-password`
  (index §6b) and the two-phase dialog exception; never a toast for the temporary password.
- **Employees (Task 06)** get no per-job payout; the force-close payout field is Task 06's concern — this task
  adds only the travel field beside it.
- **Hard rule 10** applies to the facility role picker; the type filter pills and status pills are static.
  **No `Switch`** anywhere (two labelled cards). **No `max-w-*`** on page roots.
- **ViewSwitch** is now copied on five pages; promoting it to `shared/` is a follow-up that touches three
  unrelated pages — not in this task.
- **Index notes (settled):** the breakdown fields are singular everywhere (`speedRewardPaise`, `speedPenaltyPaise`; Task 11 aligned). `PINCODE_HAS_NO_LOCATION` and `speed_settled` are in index §3.3.
- **Commit rhythm:** (1) ledger kinds — may ship early; (2) status + ticket panels + force-close;
  (3) allowance rules; (4) base-location pin; (5) parts catalogue; (6) parts queue + request page;
  (7) facility users. `npm run lint && npm run typecheck` before each.
