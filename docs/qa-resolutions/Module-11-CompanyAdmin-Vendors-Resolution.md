# Module 11 — Company Admin: Vendors — Resolution Sheet

Companion document to `Module-11-CompanyAdmin-Vendors.docx` (QA: Sneha). Of
63 executed tests: 48 passed, 12 passed with issues, 3 failed. Of the 6
logged defects, 4 are fixed and 1 (ADM-012) is deferred by product-owner
decision; ADM-036 is traced but not reproducible against the current source
and recommended for a live re-test. Of the 5 open questions, 2 are resolved
as part of a defect fix, 2 are confirmed intended behavior, and 1 (OQ-A18)
is a Google Cloud Console configuration matter outside the codebase.

| ID | Title | Disposition |
|---|---|---|
| ADM-013 | Credit limit field: comma and large-number wording | **Fixed** |
| ADM-016 | Vendor name and contact person have no stated length limit | **Fixed** |
| ADM-035 | The duplicate check misses brand names that look the same | **Fixed** |
| ADM-037 | A paused vendor can still send new products and brands | **Fixed** |
| ADM-012 | A blank credit limit does not apply the default | **Deferred — product-owner decision, not fixed this pass** |
| ADM-036 | Picking an address from the map does not save its coordinates | **Traced, not reproducible in current source — recommend live re-test** |
| OQ-A6 | Should ₹0 be an allowed explicit credit limit? | Answered — yes, confirmed intended |
| OQ-A8 | "Manual"/"Excel" copy still describes removed ops-side screens | Answered — fixed, see below |
| OQ-A16 | No warning when every brand box is removed | Answered — keep the behavior, added a UI hint |
| OQ-A17 | Is brand-name uniqueness per-vendor or company-wide? | Answered — confirmed per-vendor, intended |
| OQ-A18 | Google Maps API key restriction | Out of scope — Google Cloud Console configuration, not a code question |

---

## ADM-013 — Credit limit field: comma and large-number wording

**Linked test:** VN-06 · **Severity:** Low · **Disposition: Fixed**

**Root cause.** The credit-limit Zod field
(`adminWeb/src/components/masters/vendorSchema.ts:291-298`) validated with
`/^\d{1,8}$/`. The field's own placeholder renders the company default
through `.toLocaleString("en-IN")` (`VendorFormDialog.tsx:304-307`), so a
user sees and often types a comma-formatted value like `"5,000"` — which the
regex rejected outright as "must be a whole number of rupees." The same
8-digit shape check also caught an over-length *all-digit* number before the
dedicated `<= 10_000_000` ceiling check at the next line ever ran, so a
14-digit number was reported with the wrong message ("must be a whole
number" instead of "At most ₹1,00,00,000").

**What changed.** Added `.transform((v) => v.replace(/,/g, ""))` before the
shape check, so a comma-formatted value validates identically to its
unformatted equivalent, and loosened the shape regex from `/^\d{1,8}$/` to
`/^\d+$/` so an over-length all-digit value now reaches the ceiling refine
and gets the size-specific message instead. The backend's own bound
(`CreditLimitPaise`, `vendors/schemas.py:142-145`) already matched the
frontend's intended ceiling — only the client conflated the two failure
modes.

---

## ADM-016 — Vendor name and contact person have no stated length limit

**Linked test:** VN-17 · **Severity:** Low · **Disposition: Fixed**

**Root cause.** The backend already caps both fields at 255 characters
(`Name255`, `vendors/schemas.py:34`, used by `name`/`contactPerson` on both
create and edit). The frontend Zod schema (`vendorSchema.ts:197,245`) had no
`.max()` on either field — unlike every sibling field on the same form
(`address` caps at 500, `city`/`state` at 120, brand name at 120) — so a
too-long value passed client validation and only failed with a raw
server-side Pydantic message.

**What changed.** Added `.max(255, ...)` to both `name` and `contactPerson`,
matching the backend's existing ceiling exactly. No backend change needed —
the server-side limit was already correct; only the client was missing it.

---

## ADM-035 — The duplicate check misses brand names that look the same

**Linked test:** VN-32 · **Severity:** Medium · **Disposition: Fixed**

**Root cause.** Three separate duplicate-brand checks all did the same
incomplete comparison — bare `.lower()` (two in Python, one via SQL
`func.lower()`) — with no Unicode normalization and no stripping of
zero-width characters:

1. `_check_unique_names` (`vendors/schemas.py`) — the staff-form brand list,
   Python `.lower()` only.
2. `_apply_brands`'s in-memory check on edit (`vendors/service.py:905-910`)
   — same gap.
3. `_assert_own_brand_name_free` (`vendors/service.py:1101-1118`) — compared
   in SQL (`func.lower(VendorBrand.name) == name.lower()`), which has the
   identical blind spot since Postgres `lower()` doesn't normalize Unicode
   either.

Two names that render identically but differ by NFC/NFD composition, by
full-width vs. half-width characters, or by an embedded zero-width space
were treated as distinct by all three checks — confirmed exactly matching
QA's own diagnosis.

**What changed.** Added one shared helper, `brand_dedupe_key()`
(`vendors/schemas.py`), used at all three sites: `unicodedata.normalize(
"NFKC", value)`, strip zero-width characters (U+200B, U+200C, U+200D,
U+FEFF), then `.lower()` — for comparison only, never stored. The SQL-based
check (`_assert_own_brand_name_free`) was converted to load the vendor's
live brand names and compare normalized forms in Python, since this
normalization cannot be done inside a SQL `lower()` call. The DB-level
unique index (`uq_vendor_brands_vendor_name_lower`) is unchanged — it stays
as a cheap last-resort net; the real fix is catching this earlier.

---

## ADM-037 — A paused vendor can still send new products and brands

**Linked test:** VN-64 · **Severity:** Low · **Disposition: Fixed**

**Root cause.** The staff-side "pick a vendor" path already refuses a
paused vendor (`_validate_vendor`, `masters/service.py:371-396`, checking
`Vendor.is_active`). But a vendor's own `submit_model`
(`masters/service.py:1276-1341`) and `submit_own_brand`
(`vendors/service.py:1150-1190`) never checked `Vendor.is_active` for the
caller's own vendor at all. Pausing a vendor only flips `Vendor.is_active`
— it does not revoke the vendor's session — so a paused vendor's portal
login stayed fully valid and nothing in the request chain re-checked it
before either submission function ran.

**What changed.** Added an active-vendor check at the top of both
functions, querying `Vendor` directly by `principal.vendor_id` (never a
client-supplied id — the only honest source for a portal caller) scoped to
`principal.company_id`, requiring `is_active = true` and `deleted_at IS
NULL`. Refused with the same "Unknown or inactive vendor" wording the
staff-side path already uses — `_bad_request(...)` in `masters/service.py`
(it already has that helper), an inline `HTTPException(400, ...)` in
`vendors/service.py` (which has no shared `_bad_request` helper, matching
its existing inline-400 pattern). Deliberately not implemented by reusing
`_validate_vendor`, since that function takes an arbitrary vendor id from a
request body — the wrong shape for a portal caller.

---

## ADM-012 — A blank credit limit does not apply the default

**Linked test:** VN-07 · **Severity:** Medium · **Disposition: Deferred —
product-owner decision, not mandatory, no fix this pass**

**Root cause (documented, not fixed).**
`VendorUpdateRequest.creditLimitPaise` (`vendors/schemas.py:241-246`) is
commented "Omit it to leave the line alone" — the opposite of create's
documented default-on-omission behavior
(`VendorCreateRequest.creditLimitPaise:203-212`). `update_vendor`
(`vendors/service.py:830-836`) only does
`if body.creditLimitPaise is not None: row.credit_limit_paise = ...` — no
`model_fields_set` branch, unlike `cin`/`pan`/`gstCompanyStatus` on the same
function, which do use that pattern — and no call to `load_rules` anywhere
in `update_vendor`. The UI hint ("Blank uses the company default of
₹5,000," `VendorFormDialog.tsx:936-938`) is shown in both add and edit mode,
but is only true on add.

**Disposition.** Confirmed with the product owner: leave for now, not a
mandatory change. No code changed. The gap is recorded here so it is not
lost if revisited later.

---

## ADM-036 — Picking an address from the map does not save its coordinates

**Linked test:** VN-54 · **Severity:** Medium · **Disposition: Traced, not
reproducible in current source — recommend a live re-test**

**Investigation.** Traced the full chain: `AddressFields.tsx`'s `choose()`
→ `ManualEntryForm.tsx`'s `submit()` → `TicketCreateRequest.latitude` /
`longitude` → `create_ticket` → the `Ticket` row. Every handoff in the
current source correctly carries the coordinates picked from the map. Two
commits already exist in history that look like they fixed exactly this
defect, after the report's testing window
(`5a20582 feat(tickets): store the address coordinates picked from the map
at intake`, `95c926a fix(console): QA batch`).

**Disposition.** No code change made in this pass — writing a speculative
fix for a bug the current source does not reproduce would risk masking a
real, different problem if one still exists. Recommended: re-run VN-54's
exact steps by hand against the current dev build (vendor → Raise a ticket
→ Search address → pick a result → Create ticket → check the ticket's
stored latitude/longitude) before concluding this is resolved.

---

## OQ-A6 — Should ₹0 be an allowed explicit credit limit?

Answered: yes, keep allowing it. Confirmed intended by the product owner. No
code change made.

## OQ-A8 — Stale "Ops key each ticket in by hand" copy

Not a real contradiction in behavior — "Manual" intake is the vendor typing
their own ticket into their own portal; the old ops-side "Manual Entry" /
"Bulk Upload" screens were already removed. But the channel *description*
text was never updated to match. **Fixed:**

- Backend `CHANNEL_DESCRIPTION` (`core/intake.py`) and its module docstring
  — the `Excel`/`Manual` entries now describe the vendor's own portal
  ("The vendor uploads their spreadsheet in the vendor portal." / "The
  vendor keys each ticket in by hand in the vendor portal."). The `API`
  entry is unchanged.
- Frontend `CHANNEL_HINT` fallback (`vendorSchema.ts`) — same wording
  change, matching the phrasing already used by this file's own
  `CHANNEL_SCREEN` map.

## OQ-A16 — No warning when every brand box is removed

Confirmed intended: `create_vendor` deliberately names a single brand after
the vendor itself when no brands are supplied (`vendors/service.py:633-645`,
matching the historical backfill migration that gave every pre-existing
vendor this same shape). Keep the behavior; the form gave no hint about it.
**Fixed:** `BrandRowsField.tsx` now shows a `FieldDescription` ("Leave this
empty and we'll create one brand named after the vendor itself.") when the
brand list is empty — informational only, no behavior change.

## OQ-A17 — Is brand-name uniqueness per-vendor or company-wide?

Confirmed intended: per-vendor. The DB index
(`uq_vendor_brands_vendor_name_lower`) is scoped
`(company_id, vendor_id, lower(name))`, not `(company_id, lower(name))`,
with an explicit comment in `models/vendor_brand.py`: *"A brand belongs to
one vendor; two vendors that both sell 'Sunview' hold two rows."* No code
change made.

## OQ-A18 — Google Maps API key restriction

Not a codebase question. This is a Google Cloud Console configuration
matter (HTTP referrer and API restrictions on the key itself), out of scope
for a code fix. Flagged for whoever manages that Google Cloud project to
verify directly.

---

## Not executed (unchanged from the report)

- **VN-56** — the location check at photo upload; needs the technician app.
- **VN-57** — the radius rule; needs approval to change Rules.

Both remain blocked on external dependencies outside this plan's scope.

---

## Verification performed

- `api`: all touched modules import cleanly together
  (`app.core.intake`, `app.features.vendors.schemas`,
  `app.features.vendors.service`, `app.features.masters.service`); full
  `pytest` suite (unit, no database) passes with no failures (236 tests).
- `adminWeb`: `npx tsc --noEmit` (clean) and `eslint` (clean) on every
  touched file (`vendorSchema.ts`, `BrandRowsField.tsx`).
- Manual review of the riskiest diffs: the `brand_dedupe_key()` helper and
  its three call sites, the SQL-to-Python conversion in
  `_assert_own_brand_name_free`, and both paused-vendor checks
  (`submit_model`, `submit_own_brand`) for consistent wording and scoping.
- No database migration was needed for any fix in this pass; none was run.

## Not run (manual steps remaining)

- Live re-test of VN-54 (ADM-036) against the current dev build — no code
  fix was made, so this is the one item in this pass still unconfirmed by
  hand.
- Manual re-test of: a comma-formatted and an oversized credit limit
  (ADM-013); a 256-character vendor name/contact person (ADM-016); the
  look-alike brand-name pairs — NFC/NFD "Café", full-width/half-width
  "ＢＲＡＮＤ"/"BRAND", a zero-width-space name (ADM-035); pausing a vendor
  and confirming its own portal login can no longer add a product or a
  brand (ADM-037); re-reading the intake-channel descriptions on Add vendor
  (OQ-A8); removing every brand box on Add vendor and confirming the new
  hint appears (OQ-A16).
