# Task 08 — Console: the Franchisees screen

> Layer: **adminWeb** (staff console). Depends on **Task 03** (franchisee management API) and on the
> technician fields **Task 05** adds. Read [00-index.md](00-index.md) first — every name below is
> taken from it. Ships in the **same production web deploy as Task 09** (see §8, trap 1).

---

## 1. Goal and why

Today a company's Admin has no way to say "SkyFix Services runs pincodes 500030–500040". After this
task they do it on one screen: **Master Data → Franchisees**.

> **Worked example.** Priya is National Head at *Acme Appliances*. She opens **Franchisees** and sees
> one row: **Acme Home** — *Internal* · *Home* · 19,212 pincodes · 41 technicians · Active.
>
> She clicks **Add franchisee**, types *SkyFix Services*, picks **External**, enters the contact
> (Ravi Kumar, 98480 12345), and presses **Save and add pincodes**. The dialog moves to step 2. She
> types `500030-500040` and pauses. Under the box, without saving anything:
>
> - **11 pincodes** (the master holds all eleven)
> - **Technicians who move here** — *Ravi Teja (TCH-4021), from Acme Home, 3 pincodes* — all of his
>   coverage is inside the new range.
> - **Technicians who lose pincodes** — *Suresh (TCH-4007), from Acme Home: losing 500032, keeping 4*.
> - **Tickets re-stamped** — 2 open tickets nobody has taken yet.
>
> She presses **Review changes**, reads "1 technician moves, 1 loses pincodes and 2 tickets are
> re-stamped", and presses **Apply pincodes**. The toast repeats what actually happened.
>
> On SkyFix's page she clicks **Add admin**, enters *Anil, anil@skyfix.in*. Anil receives an email
> with a temporary password and — once Task 09 is live — signs in to the franchise portal.
>
> Later Kiran, an Area Manager, opens the same screen. He sees both rows and SkyFix's pincodes, but no
> Add, Edit, Pincodes, Deactivate or Add admin button: he holds `franchisees.view`, not
> `franchisees.manage`.

The Technicians screen also learns two facts about each technician: **which franchisee runs them**
and **whether they are an employee or a freelancer** — a column and a filter each, the Type field on
the add/edit/invite forms, and both facts on the profile.

---

## 2. Decisions implemented

| From index | What this screen does with it |
|---|---|
| F1 | Kind badge **Internal / External**, **Home** badge; the home row's Kind is locked and it has no Deactivate. |
| F2 | Pincodes are typed as **ranges and single codes**; the server expands them against the master. |
| F3 | Clashes are listed in the preview and block **Apply**; a 409 `FRANCHISEE_PINCODE_TAKEN` on commit re-runs the preview. |
| F4 | The home franchisee has **no Pincodes dialog** — it owns "every pincode nobody else owns", shown as a count. |
| F6 | The **carve-out preview** (`dryRun=true`) lists moved technicians, trimmed technicians and re-stamped tickets **before** anything is written, and a confirm step names the totals. |
| F9 | Only **`franchisees.manage`** (Admin, NH) creates, edits, deactivates and adds franchisee-admin logins; the login gets a generated, **emailed temporary password**, revealed in the dialog when the email fails (vendor-login pattern). |
| §3.4 | `franchisees.view` (Admin, NH, RH, AM) opens the list and detail **read-only**. |
| T1 | Staff set **Type** when adding or inviting a technician; `technicians.edit` holders change it for home technicians. |
| F7/F8 | A technician row carries **`canManage`** from the server; Edit / Remove / Send app link / UPI decide are hidden on rows the caller cannot manage. The console never re-derives F8. |

---

## 3. Schema

None. This task is client-only.

---

## 4. API contract assumed

Everything below is what **Task 03** (franchisees) and **Task 05** (technician fields) must serve. All
responses are the standard envelope `{ success, statusCode, message, data, errors }`; lists are the
existing paginated envelope (`pagination: { page, limit, totalRecords, totalPages, hasNextPage }`).
Paths are under `/api/v1`. The list transport (`apiGetPage`) flattens `filters` into the query string,
so `filters: { kind: "external" }` travels as `?kind=external`.

### 4.1 Franchisees (Task 03)

| Method & path | Gate | Returns |
|---|---|---|
| `GET /franchisees?page&limit&search&kind&status` | `franchisees.view` | `Page<FranchiseeOut>` — `search` matches name or code; `kind` ∈ `internal`,`external`; `status` ∈ `active`,`inactive`. Home first, then name A–Z. |
| `GET /franchisees/options` | `franchisees.view` | `FranchiseeOption[]` — unpaginated, active and inactive, for the technician filter. |
| `GET /franchisees/{id}` | `franchisees.view` | `FranchiseeOut`; another company's id → **404**. |
| `POST /franchisees` | `franchisees.manage` | `FranchiseeOut` (201). Body `FranchiseeIn`. **No pincodes** — see 4.2. Always creates a non-home franchisee. |
| `PUT /franchisees/{id}` | `franchisees.manage` | `FranchiseeOut`. Body `FranchiseeIn` (all fields optional). `kind` on the home → 409 `FRANCHISEE_HOME_IMMUTABLE`. |
| `PUT /franchisees/{id}/pincodes?dryRun=true\|false` | `franchisees.manage` | `PincodeChangeOut`. Body `{ "pincodeRanges": "500030-500040, 500120" }`. On the home → 409 `FRANCHISEE_HOME_IMMUTABLE`. Bad grammar → 422 naming the token. `dryRun=true` writes nothing and answers **200 even with clashes** (they are listed); `dryRun=false` with clashes → 409 `FRANCHISEE_PINCODE_TAKEN`, `errors[]` naming `"500032 — SkyFix Services"`. An empty string removes every pincode (handed back to home). |
| `POST /franchisees/{id}/deactivate` | `franchisees.manage` | `FranchiseeOut`. Home → 409 `FRANCHISEE_HOME_IMMUTABLE`; any technician (registered or open invite) → 409 `FRANCHISEE_HAS_TECHNICIANS` with the count in `message`. On success its `franchisee_pincodes` rows are released to home **with the F6 ticket rule** (open unassigned tickets re-stamped to home) and its franchise-role memberships are deactivated. |
| `POST /franchisees/{id}/activate` | `franchisees.manage` | `FranchiseeOut`. Comes back owning no pincodes. |
| `GET /franchisees/{id}/admins` | `franchisees.view` | `FranchiseeAdminOut[]` — `franchisee_admin` memberships of that franchisee, active first. |
| `POST /franchisees/{id}/admins` | `franchisees.manage` | `FranchiseeAdminOut & EmailOutcome` (201). Body `{ fullName, email, phone }`. Duplicate email in the company → 409. |
| `POST /franchisees/{id}/admins/{membershipId}/deactivate` | `franchisees.manage` | `FranchiseeAdminOut`; revokes their sessions. **Owner ruling 2026-10-15 (R3): the only active admin of a NON-home franchisee → 409 `FRANCHISEE_LAST_ADMIN`** (add another admin first); home is exempt. Deactivating the whole franchisee (route above) is unaffected. |
| `POST /franchisees/{id}/admins/{membershipId}/activate` | `franchisees.manage` | `FranchiseeAdminOut`. |
| `POST /franchisees/{id}/admins/{membershipId}/reissue-password` | `franchisees.manage` | `FranchiseeAdminOut & EmailOutcome`; revokes sessions. |

**Decision (writer): create and pincodes are two calls, not one.** `POST /franchisees` takes no
ranges; the dialog's step 2 is the same `PUT …/pincodes` an edit uses. One preview endpoint means
one carve-out code path to test, and a dry run needs a franchisee id to compute "added vs removed".
A franchisee whose creator abandons step 2 simply owns nothing — its row reads "0 pincodes" and it is
offered no tickets, which is true. *If Task 03 instead accepts `pincodeRanges` on `POST` with a
`dryRun`, only `services/franchisees.ts` changes.*

**Decision (writer): no preview digest.** Between the preview and the commit somebody else can move a
technician. Rather than invent a `PREVIEW_STALE` code (not in index §3.3), the commit's response is the
authoritative summary and the success toast reports *its* counts, not the preview's.

```jsonc
// FranchiseeOut
{
  "id": "6f0c…", "code": "SKY", "name": "SkyFix Services",
  "kind": "external",            // "internal" | "external"
  "isHome": false,
  "contactName": "Ravi Kumar", "contactPhone": "+919848012345", "contactEmail": "ops@skyfix.in", // email nullable
  "isActive": true,
  "pincodeRanges": "500030-500040",  // compress(codes) — "" for the home and for a franchisee with none
  "pincodeCount": 11,                // home: COUNT of active master codes no other franchisee owns
  "technicianCount": 4,              // registered technicians, live COUNT
  "openInviteCount": 1,
  "adminCount": 1,                   // active franchisee_admin memberships
  "createdAt": "2026-10-15T06:12:00Z"
}

// FranchiseeOption
{ "id": "6f0c…", "name": "SkyFix Services", "kind": "external", "isHome": false, "isActive": true }

// FranchiseeIn  (POST: name, kind, contactName, contactPhone required; contactEmail optional)
{ "name": "SkyFix Services", "kind": "external",
  "contactName": "Ravi Kumar", "contactPhone": "+919848012345", "contactEmail": null }

// PincodeChangeOut  — the same shape for dryRun=true and for the commit
{
  "dryRun": true,
  "pincodeRanges": "500030-500040",   // the server's normalised compress() of what will be stored
  "resolvedCount": 11,                // codes in the ranges that exist and are active
  "unknownCount": 0,                  // numerically inside the ranges but not in the master / inactive
  "added":   { "count": 11, "ranges": "500030-500040" },
  "removed": { "count": 0,  "ranges": "" },     // handed back to home
  "clashes": [                                   // at most 50 rows …
    { "pincode": "500032", "franchiseeId": "…", "franchiseeName": "Acme Secunderabad" }
  ],
  "clashCount": 1,                               // … and the true total
  "movedTechnicians": [
    { "id": "…", "code": "TCH-4021", "name": "Ravi Teja",
      "fromFranchiseeId": "…", "fromFranchiseeName": "Acme Home", "pincodeCount": 3 }
  ],
  "trimmedTechnicians": [
    { "id": "…", "code": "TCH-4007", "name": "Suresh",
      "fromFranchiseeId": "…", "fromFranchiseeName": "Acme Home",
      "losing": ["500032"], "keepingCount": 4 }
  ],
  "restampedTickets": {
    "count": 2,
    "sample": [ { "id": "…", "code": "SKY-INST-0001", "pincode": "500031",
                  "fromFranchiseeName": "Acme Home" } ]   // at most 20
  }
}

// FranchiseeAdminOut
{ "membershipId": "…", "userId": "…", "fullName": "Anil", "email": "anil@skyfix.in",
  "phone": "+919876543210", "isActive": true, "lastLoginAt": null, "createdAt": "…",
  "isLastActiveAdmin": false }          // owner ruling 2026-10-15 (R3): true when deactivating this admin would be refused

// EmailOutcome — the existing type in src/types/user.ts, unchanged
{ "emailStatus": "sent" | "failed" | "skipped", "emailError": null, "temporaryPassword": null }
```

**Removals carry the same lists.** When an edit shrinks a franchisee, technicians of *this*
franchisee whose coverage is entirely in the removed set appear in `movedTechnicians` (to home) and
partial ones in `trimmedTechnicians` — `fromFranchiseeName` is then this franchisee's name. The
client renders a removal and an addition with one component.

**Range grammar — must equal `app/core/pincode_ranges.parse_pincode_ranges`** (index §3.7). The console
checks the same grammar locally only to avoid sending a request that would 422:

- Entries are separated by commas, semicolons or line breaks; surrounding whitespace is ignored.
- An entry is a pincode (`[1-9][0-9]{5}`) or two pincodes joined by `-` or `–` (en dash), with optional
  spaces around the dash.
- `from ≤ to`. Overlapping or repeated entries are merged, never an error.
- At most **500** entries.

### 4.2 Technician fields (Task 05)

| Where | Added |
|---|---|
| `TechnicianRow` (registered **and** invite) in `GET /technicians`, `GET /technicians/{id}` | `franchiseeId: string`, `franchiseeName: string`, `franchiseeIsHome: boolean`, `technicianType: "employee" \| "freelancer"`, `canManage: boolean` (= `franchise_scope.can_manage_technician` for the caller) |
| `GET /technicians` filters | `franchiseeId=<uuid>`, `technicianType=employee\|freelancer` |
| `POST /technicians`, `POST /technicians/invites` | optional `technicianType` (default `freelancer`). Staff creates go to the **home** franchisee; a pincode another franchisee owns → 422 `PINCODE_OUTSIDE_FRANCHISEE` naming the codes. |
| `PUT /technicians/{id}` | optional `technicianType` |

A row the caller cannot manage still lists (staff keep seeing who covers what), but Task 05 nulls its
money fields (`upiId`, `upiName`) and refuses writes with **403** "Managed by {franchisee} — only its
franchisee admin can change this technician" (Task 05 `_load_managed`; index §6b — the caller can already
see the row, so 403 leaks nothing) (reconciled).

### 4.3 Server-side guards this screen relies on (Tasks 02/03)

- `users/service.py` already keeps `TECHNICIAN` and `VENDOR_ROLES` out of `GET /users`, out of
  `POST /users` and out of reissue (lines ~370, ~425, ~685). The same three places must exclude
  `FRANCHISE_ROLES`, or Users & Roles lists franchisee admins with an Edit button that can change
  their role to one with no `franchisee_id`.

---

## 5. Client changes

All paths are under `adminWeb/src/`. Patterns mirrored are cited per file.

### 5.1 Types — `types/franchisee.ts` (new)

`FranchiseeKind = "internal" | "external"`, `Franchisee`, `FranchiseeOption`, `FranchiseeInput`,
`PincodeChange`, `MovedTechnician`, `TrimmedTechnician`, `RestampedTicket`, `PincodeClash`,
`FranchiseeAdmin`, `CreatedFranchiseeAdmin = FranchiseeAdmin & EmailOutcome` — exactly the JSON in §4.1.
Mirror `types/vendor.ts` (`CreatedVendor = Vendor & EmailOutcome`).

`types/technician.ts` — add to **both** `Technician` and `TechnicianInvite`: `franchiseeId`,
`franchiseeName`, `franchiseeIsHome`, `technicianType: TechnicianType`, `canManage`. Export
`TechnicianType = "employee" | "freelancer"` and `TECHNICIAN_TYPES`. Add optional `technicianType` to
`CreateTechnicianInput`, `UpdateTechnicianInput`, `InviteTechnicianInput`.

`types/api.ts` — add `FRANCHISE_ROLES = ["franchisee_admin", "facility_admin", "facility_operator"] as const`
and the three names to `BackendRole` (Task 09 consumes them for routing; this task needs them for the
guard in 5.9).

### 5.2 Service — `services/franchisees.ts` (new)

Mirror `services/vendors.ts`. Plain async functions over `services/http.ts`:

```ts
listFranchisees(params: ListParams): Promise<Page<Franchisee>>          // GET /franchisees
listFranchiseeOptions(): Promise<FranchiseeOption[]>                     // GET /franchisees/options
getFranchisee(id): Promise<Franchisee>
createFranchisee(input: FranchiseeInput): Promise<Franchisee>
updateFranchisee({ id, ...body }): Promise<Franchisee>
previewPincodes({ id, pincodeRanges }): Promise<PincodeChange>           // PUT …/pincodes?dryRun=true
savePincodes({ id, pincodeRanges }): Promise<PincodeChange>              // PUT …/pincodes?dryRun=false
deactivateFranchisee(id) / activateFranchisee(id): Promise<Franchisee>
listFranchiseeAdmins(id): Promise<FranchiseeAdmin[]>
addFranchiseeAdmin({ franchiseeId, fullName, email, phone }): Promise<CreatedFranchiseeAdmin>
deactivateFranchiseeAdmin / activateFranchiseeAdmin({ franchiseeId, membershipId }): Promise<FranchiseeAdmin>
reissueFranchiseeAdminPassword({ franchiseeId, membershipId }): Promise<CreatedFranchiseeAdmin>
```

`lib/errorCodes.ts` — add `FRANCHISEE_PINCODE_TAKEN`, `FRANCHISEE_HOME_IMMUTABLE`,
`FRANCHISEE_HAS_TECHNICIANS`, `PINCODE_OUTSIDE_FRANCHISEE` (mirrors index §3.3, the way the GST codes
mirror `core/gst.py`).

### 5.3 Hooks — `hooks/useFranchisees.ts` (new)

Mirror `hooks/useVendors.ts` / `hooks/useTechnicians.ts`.

```ts
export const franchiseeKeys = {
  all: ["franchisees"] as const,
  list: (params: ListParams) => ["franchisees", "list", params] as const,
  options: () => ["franchisees", "options"] as const,
  detail: (id: string) => ["franchisees", "detail", id] as const,
  admins: (id: string) => ["franchisees", "admins", id] as const,
  preview: (id: string, ranges: string) => ["franchisees", "preview", id, ranges] as const,
};
```

| Hook | Notes |
|---|---|
| `useFranchisees(params)` | `placeholderData: keepPreviousData`, `staleTime: 30_000`. |
| `useFranchiseeOptions({ enabled })` | `staleTime: 5 min`; `enabled` = `has("franchisees.view")` so the Technicians screen never fetches a 403. |
| `useFranchisee(id)`, `useFranchiseeAdmins(id)` | |
| `usePincodePreview(id, ranges, { enabled })` | **A `useQuery`, not a mutation.** The reply is display only and the key is the debounced, locally-valid text, so TanStack's own key switching drops a stale reply for free; `placeholderData: keepPreviousData` keeps the last preview on screen while the next loads; `staleTime: 0`, `gcTime: 60_000`; `meta.errorTitle: "Couldn't check those pincodes"`. `enabled` only when `checkRangeSyntax(text).ok`. |
| `useCreateFranchisee`, `useUpdateFranchisee`, `useSavePincodes`, `useDeactivateFranchisee`, `useActivateFranchisee` | One `useFranchiseeMutation(fn, errorTitle)` helper that invalidates `franchiseeKeys.all` **and `technicianKeys.all`** — a carve-out changes technician rows. |
| `useAddFranchiseeAdmin`, `useDeactivateFranchiseeAdmin`, `useActivateFranchiseeAdmin`, `useReissueFranchiseeAdminPassword` | Invalidate `franchiseeKeys.admins(id)` and `franchiseeKeys.detail(id)` (adminCount). |

### 5.4 Pure logic — `components/franchisees/pincodeRanges.ts` (new)

Extracted so §6 can test it without a DOM.

```ts
export type RangeCheck =
  | { ok: true; entries: number; span: number }          // span = numeric codes covered, merged
  | { ok: false; reason: "bad-token" | "backwards" | "too-many" | "empty"; token?: string };
export function checkRangeSyntax(text: string): RangeCheck;
export function normaliseRangeText(text: string): string;   // trims, unifies separators to ", " and dashes to "-"
export function previewSummary(p: PincodeChange, homeName: string): string[]; // the summary lines of §5.10
export function previewImpact(p: PincodeChange): { moved: number; trimmed: number; tickets: number; any: boolean };
export function canApply(p: PincodeChange | undefined): boolean;  // false while clashCount > 0 or no preview
export function formatCount(n: number, one: string, many: string): string; // "1 pincode" / "11 pincodes" via lib/plural.ts
```

`normaliseRangeText` is what keys the preview query, so `500030 -500040` and `500030-500040` share
one request.

### 5.5 Components — `components/franchisees/` (new folder, per index §3.7)

| File | Mirrors | What it does |
|---|---|---|
| `FranchiseeTable.tsx` | `masters/VendorTable.tsx`, `technicians/TechTable.tsx` | `DataTable` in server mode. Columns *Franchisee* (name link + mono code), *Kind* (`FranchiseeBadges`), *Pincodes* (count; home adds the "All unclaimed" hint), *Technicians*, *Admins*, *Status*, row actions *Edit* / *Pincodes* when `canManage` (Pincodes hidden on the home). Filters *Kind*, *Status* (`variant: "select"`, `w-40` per the toolbar rule). Row click and name link → `/franchisees/:id` with `useNavOrigin("Back to franchisees")` (hard rule 11). |
| `FranchiseeBadges.tsx` | `shared/StatusBadge` | Kind badge (text, not tint alone) + **Home** badge. |
| `FranchiseeKindField.tsx` | `masters/LocationCheckField.tsx` | Thin `ChoiceCards` wrapper typed to `"Internal" \| "External"`; `disabled` with a reason on the home. |
| `franchiseeSchema.ts` | `masters/vendorSchema.ts` | zod: `name` 2–120, `kind`, `contactName` 2–120, `contactPhone` via `utils/phone` (10 digits → E.164 at submit), `contactEmail` optional email. `adminSchema`: `fullName` 2–120, `email`, `phone` (required — root AGENTS: a console user's phone is mandatory). |
| `FranchiseeFormDialog.tsx` | `masters/VendorFormDialog.tsx` (keyed remount, `FieldGrid`, never `<FieldGroup className="grid">`) | Details form. On **add**, success hands the created row to the parent, which opens `PincodeRangesDialog` on it (step 2). On edit, saves and closes. |
| `PincodeRangesDialog.tsx` | `masters/SerialImportDialog.tsx` (dry run then commit) | Textarea → `useDebouncedValue(text, 500)` → `checkRangeSyntax` (inline error under the field, `role="alert"`) → `usePincodePreview`. Two phases in local state: **edit** (textarea + `CarveOutPreview` + *Review changes*) and **confirm** (the totals sentence + *Back* / *Apply pincodes*). When `previewImpact(p).any` is false the confirm phase is skipped and the button reads *Save pincodes*. On a 409 `FRANCHISEE_PINCODE_TAKEN` the dialog returns to **edit** and refetches the preview (the clash list then shows who took it). |
| `CarveOutPreview.tsx` | `shared/RejectsTable.tsx` for the small tables | Renders `PincodeChange`: summary lines, clash table (blocks Apply), moved table, trimmed table, re-stamped tickets count + sample (ticket codes link to `/tickets/:id` in a new tab — the dialog must not be navigated away from). Skeleton rows while the first preview loads. |
| `FranchiseeFacts.tsx` | `technicians/TechOnboardingCard.tsx` | Detail page's Details card and the home note. |
| `FranchiseeAdminsPanel.tsx` | `pages/vendor/VendorUsersPage.tsx` (table) | Admin list with Last active (`lastLoginAt` is last activity — index §6), Status, and per-row *Email a new password* / *Deactivate* / *Activate* when `canManage`. **Owner ruling 2026-10-15 (R3): when the row's `isLastActiveAdmin` is true, *Deactivate* is shown but disabled, with the sentence *Add another admin first — {name} is the only one who can approve UPI changes and pay redemptions for {franchisee}.* beneath it (a `Tooltip` is not enough on touch; the sentence is plain text in the menu item's description). The server's 409 `FRANCHISEE_LAST_ADMIN` is still translated into a toast if a stale list lets the click through (the dialog stays open, as for `FRANCHISEE_HAS_TECHNICIANS`). Home rows are never disabled.** Loading, empty and error states (hard rule 5). |
| `AddFranchiseeAdminDialog.tsx` | `vendor/AddVendorUserDialog.tsx` + `shared/TemporaryPasswordPanel.tsx` | On `emailStatus === "failed"` the body is replaced by `TemporaryPasswordPanel` (never a toast — see that component's note). |
| `ReissueFranchiseeAdminPasswordDialog.tsx` | `masters/ReissueVendorPasswordDialog.tsx` (copy its two-phase shape exactly) | **Decision (writer): include reissue.** It is the only way back in for an admin who never got the first email; staff have no other reset for a console login they do not own. |

**Decision (writer): a detail route, not a bigger dialog.** The admins section, the pincode text and
the technician count need a page a read-only Area Manager can open; a dialog in read-only mode would
be a form with every control disabled.

### 5.6 Pages — `pages/franchisees/` (new)

Pages compose; they do not render (adminWeb "A page component composes").

- **`FranchiseesPage.tsx`** — mirror `pages/masters/VendorsPage.tsx`: `useUrlSeededListParams()`,
  one `OpenDialog` union (`add | edit | pincodes | null`), `canManage = has("franchisees.manage")`,
  toolbar *Add franchisee* only when `canManage`. `<h2 className="sr-only">Franchisees</h2>`.
- **`FranchiseePage.tsx`** — `useParams().id`; `readNavOrigin` back link with fallback
  `/franchisees` / "Back to franchisees"; `ErrorState` on a failed read (**a 404 renders "Couldn't
  load this franchisee"** — "not yours" per adminWeb hard rule 0); actions *Edit details*,
  *Edit pincodes* (not on home), *Deactivate* (not on home; `ConfirmDialog`, destructive direction
  only) / *Activate* (fires straight through, toast); a Technicians card linking to
  `/technicians?franchiseeId=<id>`; `FranchiseeAdminsPanel`; and, **on the home franchisee only, to Admin/NH** (`franchisees.manage`), Task 13's `HomeFacilityUsersCard` (owner ruling 2026-10-15, R4 — home has no parts desk until somebody adds a facility user). `useRecordRecentlySeen` is **not** called
  — the global search has no franchisee kind and adding one is out of scope.

### 5.7 Nav, routeMeta, routes

- **`components/shared/nav.ts`** — in *Master Data*, directly after *Technicians*:
  ```ts
  {
    label: "Franchisees",
    to: "/franchisees",
    icon: Building2,               // add to the lucide import
    match: ["/franchisees/"],
    // view, not manage: an Area Manager reads who runs which pincodes. The
    // writes are gated per button on `franchisees.manage` and refused by the API.
    feature: "franchisees.view",
  },
  ```
  `featureForPath` then gates both routes with no guard change — the same way `/redemptions/:id`
  rides `match`.
- **`components/shared/routeMeta.ts`** — `STATIC["/franchisees"]` and a `DYNAMIC` entry
  `/^\/franchisees\/[^/]+$/` (copy in §5.10). Comment them "Net-new — no prototype has franchisees.
  Awaiting sign-off (index §7)."
- **`routes.tsx`** — two lazy imports and, inside the staff `RequireFeature` children next to
  `vendors`:
  ```ts
  { path: "franchisees", element: <FranchiseesPage /> },
  { path: "franchisees/:id", element: <FranchiseePage /> },
  ```

### 5.8 Technicians screen changes (ops surface)

| File | Change |
|---|---|
| `components/technicians/TechTable.tsx` | Two columns after *Technician*: **Franchisee** (`t.franchiseeName`, plus a small *Home* badge when `franchiseeIsHome`) and **Type**. Two filters: **Franchisee** (`variant: "combobox"` when > 10 options else `"select"`, options from a new `franchisees` prop; rendered only when `franchisees.length > 1`, the same "one is not a choice" test the Region filter uses) and **Type** (static select — exempt from hard rule 10). Row actions: `canEditTechnician && t.canManage`, `canSendAppLink && t.canManage`; invite verbs `canManageInvites && t.canManage`. |
| `pages/technicians/TechnicianListPage.tsx` | `useFranchiseeOptions({ enabled: has("franchisees.view") })` → `franchisees` prop. Seed `franchiseeId` and `technicianType` from the URL: `useUrlSeededListParams({}, ["districtId", "franchiseeId", "technicianType"])`, so the franchisee page's "View technicians" lands filtered. |
| `components/technicians/TechnicianTypeField.tsx` (new) | `ChoiceCards` wrapper typed `"Freelancer" \| "Employee"` (mirror `LocationCheckField`). Converts to the wire value at submit, per the ChoiceCards note in adminWeb AGENTS. |
| `components/technicians/technicianSchema.ts` | `technicianType: z.enum(["Freelancer", "Employee"])`, default `"Freelancer"`. |
| `components/technicians/onboarding.ts` | `inviteSchema` gains the same field; `EMPTY_INVITE.technicianType = "Freelancer"`. |
| `components/technicians/TechnicianFormDialog.tsx` | `TechnicianTypeField` in the first section; on edit, a read-only **Franchisee** line (the franchisee is not editable here — carve-outs move technicians). Submit sends `technicianType`. |
| `components/technicians/TechnicianInviteDialog.tsx` + `TechnicianListPage` `onSubmit` | Type field; `technicianType` in the invite body. |
| `components/technicians/TechProfileHeader.tsx` | Two facts: **Franchisee**, **Type**. |
| `pages/technicians/TechnicianProfilePage.tsx` | `canEdit = has("technicians.edit") && tech?.canManage`; when `tech && !tech.canManage`, a `shared/Notice` "Run by {franchiseeName}…" above the panels; `UpiChangePanel canDecide={canEdit}` therefore follows. |
| `components/technicians/CoverageFields.tsx` | Hint suffix "Pincodes another franchisee owns are refused." when the company has more than one franchisee (prop `hasOtherFranchisees`, from the options length). The server's 422 names the codes. |
| `hooks/useCompanyUsers.ts` | `NOT_INVITABLE_HERE` gains `...FRANCHISE_ROLES` — they rank **8–10**, below every staff role, so the rank filter alone would offer them on Users & Roles exactly as it would have offered `vendor` (see the comment above `NOT_INVITABLE_HERE`). |

### 5.9 Guard while Task 09 is not merged

`types/api.ts` gains `FRANCHISE_ROLES` here (5.1). Nothing else routes on it in this task — see §8
trap 1 for why 08 and 09 ship together.

### 5.10 PROPOSED copy (needs owner sign-off — index X2, §7)

No prototype covers this screen (`adminWeb/webdesign/` has no franchisee). Every string is net-new.
`{company}` is `useBrand().name` (never a product name); `{homeName}` is the home franchisee's name.

| Where | String |
|---|---|
| Rail | Franchisees |
| Page header (routeMeta) | Franchisees · Who runs your technicians, and where |
| Detail header (routeMeta) | Franchisee · Pincodes · admins · technicians |
| PageMeta description (list / detail) | Franchisees, the pincodes each one owns, and their admins. / One franchisee's pincodes, admins and technicians. |
| Table caption (sr-only) | Franchisees with their kind, pincodes, technicians, admins and status |
| Search placeholder | Search by name or code |
| Columns | Franchisee · Kind · Pincodes · Technicians · Admins · Status |
| Kind / badges | Internal · External · Home |
| Home pincode hint | All unclaimed |
| Status | Active · Inactive |
| Filters | Kind · Status |
| Toolbar | Add franchisee |
| Row actions | Edit · Pincodes |
| Empty | No franchisees yet · Add one and give it the pincodes it will run. |
| Filtered empty | No franchisees match those filters · Try a different kind or status, or clear the search. |
| List error | Couldn't load franchisees |
| Back | Back to franchisees |
| Detail actions | Edit details · Edit pincodes · Deactivate · Activate |
| Details card | Details · Code · Kind · Contact · Phone · Email · Status · Created |
| Home note | The home franchisee owns every pincode no other franchisee owns. Give pincodes to another franchisee to take them from it. |
| Pincodes card | Pincodes · {n} pincodes · Add pincodes |
| Pincodes empty | No pincodes yet — this franchisee owns nothing and is offered no tickets. |
| Technicians card | Technicians · {n} technicians · {n} open invites · View technicians |
| Detail error | Couldn't load this franchisee |
| Add dialog | Add franchisee · Step 1 of 2 — details. You give it pincodes next. |
| Edit dialog | Edit {name} · Changes apply straight away. |
| Fields | Name · Kind · Contact name · Contact phone · Contact email |
| Kind cards | Internal — Part of {company}. · External — A separate business working under the {company} name. |
| Kind locked (home) | The home franchisee is always internal. |
| Buttons | Cancel · Save and add pincodes · Save changes |
| Validation | Enter a name of at least 2 characters · Enter the contact's name · Enter a 10-digit mobile number · Enter a valid email address |
| Toasts | {name} added · {name} saved |
| Mutation error titles | Couldn't add the franchisee · Couldn't save the franchisee · Couldn't check those pincodes · Couldn't save the pincodes · Couldn't deactivate the franchisee · Couldn't activate the franchisee |
| Pincodes dialog | Pincodes for {name} · Type ranges and single pincodes, separated by commas or new lines — for example 500001-500099, 500120. Only pincodes in the master are kept. |
| Field | Pincode ranges |
| Syntax errors | "{token}" is not a pincode or a range. Use six digits, or two joined by a dash. · "{token}" runs backwards — put the smaller pincode first. · Too many entries — at most 500. Use wider ranges. |
| Preview idle / loading | Type a pincode or a range to see what it covers. · Checking… |
| Summary | {n} pincodes · {n} in these ranges are not in the pincode master and are skipped. · {n} added · {n} handed back to {homeName} · No technicians or tickets are affected. |
| Clashes | Already owned by another franchisee · Remove these — a pincode belongs to one franchisee only. · Pincode · Owned by · +{n} more |
| Moved | Technicians who move here · All of their pincodes are inside this franchisee. · Technician · From · Pincodes |
| Moved (removal) | Technicians who move to {homeName} · All of their pincodes are being handed back. |
| Trimmed | Technicians who lose pincodes · Some of their pincodes change hands; they keep the rest. · Technician · From · Losing · Keeping |
| Tickets | Tickets re-stamped · Open tickets nobody has taken yet move with their pincode. Jobs a technician already holds keep their technician. · {n} tickets |
| Pincode buttons | Cancel · Review changes · Save pincodes · Back · Apply pincodes |
| Confirm phase | Apply these pincodes? · {moved} technicians move, {trimmed} lose pincodes and {tickets} tickets are re-stamped. The technicians' new admins are notified. |
| Success toast | Pincodes saved for {name} · {n} pincodes · {moved} moved · {trimmed} trimmed · {tickets} tickets re-stamped |
| Deactivate confirm | Deactivate {name}? · Its {n} pincodes go back to {homeName}, with any open tickets nobody has taken. Its admins can no longer sign in. This is refused while it still has technicians. · Deactivate |
| Deactivate / activate toasts | {name} deactivated · {name} activated — Give it pincodes to start sending it tickets. |
| Admins panel | Franchisee admins · They sign in to the franchise portal and run this franchisee's technicians and money. · Add admin |
| Admins panel (home) | Optional for the home franchisee — your area managers and heads already run its technicians. |
| Admins columns | Admin · Phone · Last active · Status · Never |
| Admins row actions | Email a new password · Deactivate · Activate |
| Admins empty / error | No admins yet · Add one and they get an email with a temporary password. · Couldn't load the admins |
| Add admin dialog | Add a franchisee admin · They get an email with a temporary password and sign in to the franchise portal for {name}. · Full name · Email · Mobile number · Add admin |
| Add admin toast | {email} added · A temporary password is on its way to them. |
| Temp-password panel heading (add / reissue) | Admin added, but the email didn't send · Password reset, but the email didn't send |
| Reissue dialog | Email {name} a new password? · {email} will be signed out everywhere and will need the new password to sign in again. Their current one stops working. · Email a new password · New password emailed to {email} |
| Deactivate admin confirm | Deactivate {name}? · They are signed out everywhere and cannot sign in until reactivated. · Deactivate admin |
| Last admin (owner ruling 2026-10-15, R3) | Add another admin first — {name} is {franchisee}'s only active admin, and without one nobody can approve its technicians' UPI changes or pay their redemptions. (disabled-row line and the 409's toast body) · errorTitle Couldn't deactivate the admin |
| Admin error titles | Couldn't add the admin · Couldn't deactivate the admin · Couldn't activate the admin · Couldn't reset the password |
| Technicians — columns / filters | Franchisee · Type · Employee · Freelancer |
| Type field | Type · Freelancer — Paid for each job they close. · Employee — On salary: no per-job payout and no redemptions. Allowances and penalties still apply. · A change applies to jobs accepted after it. |
| Coverage hint suffix | Pincodes another franchisee owns are refused. |
| Profile facts | Franchisee · Type |
| Not-manageable notice | Run by {franchiseeName}. Their franchisee admin manages this technician. |

---

## 6. Unit tests (vitest — Task 00 harness, `src/**/*.test.{ts,tsx}`, jsdom)

| File | Cases |
|---|---|
| `src/components/franchisees/pincodeRanges.test.ts` | `checkRangeSyntax`: `"500001-500099, 500120"` → ok, entries 2, span 100 · newline and `;` separators · en dash `500001–500010` · spaces around the dash · `"050001"` → bad-token · `"5000"` → bad-token with token `5000` · `"500099-500001"` → backwards · overlapping `500001-500010, 500005-500020` → ok, span 20 (merged) · duplicate entry counted once in span · 501 entries → too-many · `""` / whitespace → empty. `normaliseRangeText`: `" 500030 -500040 ;500120\n"` → `"500030-500040, 500120"`. `previewImpact`/`canApply`: clashCount 1 → `canApply` false; undefined → false; zero moved/trimmed/tickets → `any` false. `previewSummary`: unknownCount 0 omits the "skipped" line; removed.count > 0 names `homeName`; singular "1 pincode". |
| `src/components/shared/nav.test.ts` | `featureForPath("/franchisees")` and `("/franchisees/abc")` → `franchisees.view`; `("/franchise/technicians")` → **not** `franchisees.view` (the trailing-slash trap, §8). |
| `src/components/franchisees/FranchiseeTable.test.tsx` | Renders with `canManage=false` → no *Edit*/*Pincodes* buttons; home row has a *Home* badge and no *Pincodes* action even with `canManage=true`. |
| `src/components/technicians/TechTable.test.tsx` | A row with `canManage: false` shows no Edit / Remove / Send app link even when the `can*` props are true; the Franchisee filter is absent with one option and present with two. |
| `src/hooks/useCompanyUsers.test.ts` | The assignable-roles filter never returns `franchisee_admin`, `facility_admin`, `facility_operator` for an Admin caller (pure part extracted if needed: `assignableRoles(callerRank, roles)`). |

Only pure modules and render-only components are tested; no network (X1).

---

## 7. Acceptance criteria

Run against `RelianceDB` (dev) with the local API, in **GreenTech Demo Services** (`@seed.example.com`
logins, password from `api/app/scripts/seed_demo.py`'s `PASSWORD`). Never write to *Testing Company*.

1. **Given** an Admin, **when** they open `/franchisees`, **then** the rail shows *Franchisees* under
   Master Data, the list shows the home franchisee with *Internal* and *Home* badges, its pincode count,
   technician count and *Active*, and loading / empty / error states exist (kill the API → ErrorState
   with Retry plus one toast).
2. **Given** an Admin, **when** they add *QA Franchise A* (External) and press **Save and add
   pincodes**, **then** step 2 opens on the new franchisee; typing `500030-500040` shows a preview
   within a second of pausing, with **no** row written (refresh the list in another tab — still 0
   pincodes).
3. **Given** a range that includes a pincode another franchisee owns, **when** previewed, **then** the
   clash table names the code and owner and **Apply** is disabled; **when** a racing commit returns 409
   `FRANCHISEE_PINCODE_TAKEN`, **then** a toast shows, the dialog stays open on the edit phase and the
   preview refreshes.
4. **Given** a preview that moves or trims technicians or re-stamps tickets, **when** the Admin presses
   **Review changes** then **Apply pincodes**, **then** the toast reports the commit's counts and the
   moved technician's row on `/technicians` now shows the new franchisee.
5. **Given** a preview with no impact, **then** the button reads **Save pincodes** and saves without a
   confirm phase.
6. **Given** typing `500099-500001` or `5000`, **then** an inline error names the token and **no
   request** is sent (Network tab).
7. **Given** the home franchisee, **then** it has no *Pincodes* action, its Kind cards are disabled with
   the reason, and it has no *Deactivate*; a hand-made `PUT /franchisees/{home}/pincodes` returns 409
   `FRANCHISEE_HOME_IMMUTABLE`.
8. **Given** a franchisee with technicians, **when** Deactivate is confirmed, **then** the 409
   `FRANCHISEE_HAS_TECHNICIANS` toast shows over the still-open dialog (it does not close itself).
8a. **Last admin (owner ruling 2026-10-15, R3).** **Given** a non-home franchisee with exactly one active admin, **then** that row's *Deactivate* is disabled with the *Add another admin first…* line and a hand-made `POST …/admins/{m}/deactivate` returns 409 `FRANCHISEE_LAST_ADMIN`; after a second admin is added, the first can be deactivated and the second row's *Deactivate* is then disabled. On the home franchisee the only admin can be deactivated. The franchisee's own *Deactivate* (after clearing technicians) still works.
9. **Given** an Admin adds an admin with the allow-listed test address (`ACS_EMAIL_ALLOWLIST`), **then**
   the toast says a password is on its way; **given** the email fails, **then** the dialog body becomes
   `TemporaryPasswordPanel` with *Copy* and *Done*, and the password appears nowhere else.
10. **Role gating — read-only.** **Given** an Area Manager (`franchisees.view`, no `manage`), **when**
    they open `/franchisees` and a franchisee's page, **then** they see every fact and the admins list
    but no Add / Edit / Pincodes / Deactivate / Add admin / row admin actions; a hand-made `POST
    /franchisees` from their token returns 403.
11. **Given** a user whose company override removes `franchisees.view`, **when** they type
    `/franchisees`, **then** they are redirected to `/` and the rail has no entry.
12. **Given** a franchisee id from another company, **when** an Admin opens `/franchisees/<that id>`,
    **then** "Couldn't load this franchisee" renders (API 404), never another company's data.
13. **Technicians.** **Given** the Technicians screen, **then** it has *Franchisee* and *Type* columns
    and filters; arriving from a franchisee page's *View technicians* lands filtered to it; a technician
    of a non-home franchisee shows no Edit / Remove / Send app link for an Area Manager, and their
    profile shows the "Run by …" notice and no Edit.
14. **Given** adding or inviting a technician as an Admin, **then** Type defaults to *Freelancer*, the
    saved row shows the chosen type, and an edit to *Employee* saves.
15. **Given** Users & Roles → invite, **then** the role list offers none of the three franchise roles.
16. `npm run lint`, `npm run typecheck`, `npm test` and `npm run build` are green in `adminWeb/`.
17. **Playwright smoke** (webapp-testing skill; `python scripts/with_server.py --server "npm run dev"
    --port 5173 -- python d:/tmp/franchisees_smoke.py`, API already on :8000;
    `p.chromium.launch(channel="msedge", headless=True)` — Playwright's own browsers are not
    downloaded here; keep the script and `TEMP` on `D:\tmp\`):
    ```text
    1  login as the demo Admin → wait networkidle
    2  click rail "Franchisees" → expect a row with text "Home"
    3  click "Add franchisee"; fill Name "QA Franchise <timestamp>", pick External, contact, phone
    4  click "Save and add pincodes" → expect dialog "Pincodes for QA Franchise …"
    5  fill "Pincode ranges" with a range known to be free in demo data; wait for "pincodes" summary
    6  screenshot d:/tmp/f08-preview.png; click "Review changes" or "Save pincodes"; expect toast "Pincodes saved"
    7  open the franchisee page → expect the ranges text and "Franchisee admins"
    8  sign out; login as the demo Area Manager → /franchisees → assert no "Add franchisee" button
    9  goto /franchisees/00000000-0000-0000-0000-000000000000 → expect "Couldn't load this franchisee"
    10 cleanup: as Admin, edit pincodes to "" (handed back), Deactivate the QA franchisee
    ```

---

## 8. Out of scope and traps

1. **Ships with Task 09, not before it, to production.** Once an Admin can create a franchisee-admin
   login, that person can sign in. Without Task 09 the session has no `franchise` flag, `RequireAuth`
   lets them into the staff shell, and the ungated staff paths (`/`, `/escalations`, `/notifications`,
   `/account`) render for them — adminWeb hard rule 0a's exact failure. The server still refuses what
   their features do not hold (hard rule 8), so on **dev** this is a confusing screen, not a leak; the
   `main` deploy must contain both tasks.
2. **`/franchisees` vs `/franchise`.** The staff screen is plural, the portal (Task 09) is singular.
   `featureForPath`'s prefix test appends `/`, so `"/franchise/x".startsWith("/franchisees/")` is false
   — keep it that way; never add a `match` of `"/franchise"` without the trailing `s/`.
3. **Tailwind v4.** `adminWeb` is Tailwind **v4** with `@theme` tokens in `styles/theme.css`; no hex, no
   inline `style=`, static class strings only (adminWeb hard rules 1–6). The Kind badge tint is a
   semantic token class, and carries the word.
4. **Never write a product name.** The kind cards say `{company}` from `useBrand()`, never "Reliance
   GreenTech". The detail page title is "Franchisee", not the platform.
5. **A grid of fields is `shared/FieldGrid`**, never `<FieldGroup className="grid …">` — the
   contact row is exactly the shape that collapsed on the intake form.
6. **A boolean/enum choice is `ChoiceCards`**, not a switch — Kind and Type are two-option cards.
7. **Single-option dropdown** (hard rule 10): the Franchisee filter is hidden at one option rather than
   auto-filled — a filter, unlike a form field, picking itself would silently narrow the list.
8. **Don't recompute F8 in the browser.** `canManage` comes from the server; a client copy of "home
   technicians are the AM's, others are the franchisee admin's" is the copy that drifts.
9. **The home's pincode count is a COUNT**, not `19496 − others` computed client-side (root AGENTS: do
   not fake a number that has a real source).
10. **Out of scope:** travel/speed settings per franchisee (Task 13), base location (Task 13/14),
    facility users (Task 13), money between an external franchisee and the company (F11), moving a
    single technician between franchisees by hand (carve-outs move them), a franchisee kind in global
    search, a pincode-map view of franchisee territories.
