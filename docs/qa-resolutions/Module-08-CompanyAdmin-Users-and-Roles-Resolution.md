# Module 08 — Company Admin: Users and Roles / Sign-in — Resolution Sheet

Companion document to `Module-08-CompanyAdmin-Users-and-Roles.docx`
(QA: Sneha, execution 21–23 Oct 2026). Of the 10 logged defects, 9 are fixed
and 1 (ADM-034) was found already resolved in the current codebase — no
change needed. Of the 5 open questions, 4 are answered with a code change
and 1 is deferred. This module is materially more security-sensitive than
Module 10: 6 of the 10 defects are Medium severity.

| ID | Title | Disposition |
|---|---|---|
| ADM-001 | Suspended user can still sign in, misleading error | **Fixed** |
| ADM-029 | Password reset doesn't sign out an open session | **Fixed** |
| ADM-030 | Weak passwords (spaces, "password") accepted | **Fixed** |
| ADM-031 | Password change doesn't sign out other sessions | **Fixed** |
| ADM-032 | Forgot password reveals which emails have an account | **Fixed** |
| ADM-033 | No lock-out after repeated wrong passwords | **Fixed** |
| ADM-006 | Re-inviting a removed user ignores the typed name | **Fixed** |
| ADM-007 | Gendered wording on the invite form | **Fixed** |
| ADM-028 | Search treats `%`/`_` as wildcards, doesn't collapse spaces | **Fixed** |
| ADM-034 | Wrong file type for profile photo silently ignored | **Already correct — no change** |
| OQ-A1 | Can an area manager span two regions? | Answered — no, disallowed |
| OQ-A3 | Is the region↔state mapping correct? | Confirmed correct, not a bug |
| OQ-A5 | Should Remove be reversible? | Deferred — no action |
| OQ-A14 | Force a password choice after an admin-issued password? | Answered — yes, implemented |
| OQ-A15 | What does "Trust this device" do? | Deferred — no action |

---

## How the fixes were built

This module's defects were almost entirely auth/session architecture, not
isolated UI bugs — so the process differed from Module 10's: the actual
`login()`, `issue_session()`, `get_current_principal()`, token, and
password-validation code was read directly first, a design was drafted
against what the code actually does, and that design was then adversarially
reviewed by a second pass before any code was written. The review caught a
real correctness bug (see ADM-029/031 below) that would have shipped broken,
and found several call sites the first pass missed (7 places mint an
admin-issued password, not the 2–3 first assumed; Forgot Password leaks
existence on 3 response branches, not 1).

---

## ADM-001 — A suspended user can still sign in

**Linked tests:** US-13, US-24, US-25 · **Severity:** Medium

**Root cause.** "Suspend a user" toggles `Membership.is_active = False`
(`api/app/features/users/service.py` — `update_user`'s `isActive` field),
never the global `User.is_active`. `login()` only ever checked the global
flag, so a membership-suspended user's password still verified and a
session was issued — `issue_session()` then found zero active memberships
and returned a technically-valid session with no company, which is why
every screen afterward said "Select a company to access this resource"
instead of a clear refusal. An already-open session was, and still is,
correctly cut off on its very next request (`get_current_principal()`
already re-checks membership freshness per request) — the gap was sign-in
time only.

**What changed.** `issue_session()` — the shared tail for password login,
Google login, forgot-password confirm, and technician OTP sign-in — now
refuses outright (403, "You can't sign in — contact your administrator")
whenever a non-superadmin resolves to zero active memberships. One change
closes the gap on every door that ends there.

---

## ADM-029 + ADM-031 — Password reset/change doesn't end an open session

**Linked tests:** US-29, US-37 · **Severity:** Medium

**Root cause.** Both already called `revoke_refresh_tokens()` on the
backend — the 7-day refresh-token session was already fully closed. The gap
was the short-lived access token: a stateless JWT that this codebase's own
design treats as unrevocable, living for `ACCESS_TOKEN_EXPIRE_MINUTES = 5`
regardless of what happens to the password. QA's "still works after reset"
was this already-small, already-documented residual window, not a total
absence of invalidation — confirmed by reading the actual code rather than
assuming the worst.

**What changed.** A new `users.password_changed_at` column is stamped on
every password replacement (self-service change, forgot-password reset,
and every admin-driven reissue — users, vendor, and franchise). Every
authenticated request now compares the access token's issue time against
that stamp and refuses (401) if the token predates it, closing the window
to the next request instead of up to 5 minutes.

**Bug caught before it shipped:** the first draft of this check compared
the token's `iat` (whole seconds) directly against the stamp (microsecond
precision). Because the stamp is written microseconds before the replacement
token is minted, a naive comparison would have judged the user's own
brand-new token as stale and logged them out immediately on *every* password
change — the exact failure this fix exists to prevent. Caught by an
adversarial review pass before implementation; the shipped comparison
truncates to whole-second granularity.

---

## ADM-030 — Weak passwords accepted

**Linked test:** US-35 · **Severity:** Medium

**Root cause.** Password validation enforced only length (8–128 characters)
— nothing rejected pure whitespace or a common word like "password".

**What changed.** A new password rule, applied to both self-service change
and forgot-password reset: rejects a password that's blank/pure whitespace,
rejects a curated common-password denylist, and requires all 4 character
classes (uppercase, lowercase, digit, symbol) — on top of the existing
length bound.

**Noted, not changed:** the system's own auto-generated temporary passwords
(letters + digits only, no symbol) would not pass this new rule — but they
never run through it; they're hashed server-side directly. Flagged so the
two don't quietly drift apart later.

---

## ADM-032 — Forgot password reveals which emails have an account

**Linked test:** US-39 · **Severity:** Medium

**Root cause.** The internal helper that answers "may a password reset act
on this address" leaked account existence on **three** separate outcomes,
not the one QA happened to catch: a 404 for an unknown email, a 403 for a
technician/passwordless account, and a 403 for a disabled account. All
three were reachable from both the "request a code" step and the "verify
the code" step.

**What changed.** Both steps now catch all three outcomes and return the
exact same generic response a real send would produce — including the same
field shape and a forced-null dev-echo code, so no side channel survives.

---

## ADM-033 — No lock-out after repeated wrong passwords

**Linked test:** US-42 · **Severity:** Medium

**Root cause.** Sign-in had no rate-limiting or lockout logic of any kind —
confirmed by reading `login()` directly.

**What changed, per the confirmed policy:** 3 consecutive wrong attempts for
one email lock sign-in for 2 minutes ("Too many attempts, please try again
later"). If, after that cooldown, a second full cycle of 3 more wrong
attempts occurs, the account is flagged for a forced password change on its
next successful sign-in ("Please change your password kindly"). The
attempt counter resets to zero on a successful login.

**Two mechanism details the review required, both implemented:** the
counter mutation commits to the database *before* the refusal is raised
(the request's own exception would otherwise roll back the increment and
the lockout would never actually take effect), and the increment is done as
a single atomic database update rather than a read-then-write, so two
concurrent wrong attempts can't both read the same count and under-count.

**A design flaw caught before it shipped:** the first draft planned to reuse
the *same* flag this triggers as the one OQ-A14 uses for "you were issued a
temp password, choose your own." Reusing it would have let anyone who knows
a victim's email fail that email's login 6 times — with no credential of
their own — and force the real account owner into an unwanted
password-change flow the next time they successfully signed in, since
nothing would ever clear a flag set by someone else's failed attempts. The
two are now **separate columns** — `requires_security_password_change`
(this bug) and `must_change_password` (OQ-A14) — so one can never be
triggered by the other's cause.

---

## ADM-006 — Re-inviting a removed user ignores the typed name

**Linked test:** US-12 · **Severity:** Low

**Root cause.** Removing then re-inviting the same email reactivates the
existing `User` row rather than creating a new one — correct, since it's
the same person's identity — but the reactivation path never wrote the
newly typed name (or phone) onto that row, silently keeping whatever was
there before.

**What changed.** The reactivation path now writes the newly typed name and
phone onto the reused row, matching what a brand-new invite already does.

---

## ADM-007 — Gendered wording on the invite form

**Linked test:** US-17 · **Severity:** Low

**What changed.** "He covers every pincode in the states you pick." → "They
cover every pincode in the states you pick."

---

## ADM-028 — Search treats `%`/`_` as wildcards, doesn't collapse spaces

**Linked test:** US-21 · **Severity:** Low

**Root cause.** The user search built its `ILIKE` pattern directly from the
raw typed text with no escaping, so a literal `%` or `_` acted as a SQL
wildcard instead of a character to search for; and only leading/trailing
whitespace was trimmed, so "qa  national" (two spaces) never matched "qa
national".

**What changed.** The search term now collapses internal whitespace to a
single space and escapes literal `\`, `%`, and `_` (in that order) before
being used as an `ILIKE` pattern, so all three now search as plain text.

---

## ADM-034 — Wrong file type for profile photo silently ignored

**Linked test:** US-45 · **Severity:** Low · **Disposition: already correct**

Traced the exact component chain QA tested (Account page → the shared
profile-photo picker → the shared file-validation hook). The current code
already validates file type identically whether the file is chosen via the
file browser or dragged onto the picture, already rejects anything that
isn't an image, and already shows "Choose an image file — PNG, JPG or
WebP." No defect found in the current codebase on this path — most likely
resolved by unrelated work between the bug report's testing date and now
(the same validation hook, with the same message, was independently
confirmed working for product photos in Module 10's report, from the same
testing week). No code change made; recommend a quick live re-check rather
than writing a fix for something already working.

---

## OQ-A1 — Can one area manager hold states across two regions?

**Answered: no.** An area manager's assigned states must now all belong to
one region — enforced wherever states are assigned (both inviting a new
area manager and editing an existing one's territory). Previously allowed;
this changes existing behavior going forward (does not retroactively
correct any area manager already spanning two regions).

## OQ-A3 — Is the North/East region↔state mapping correct?

**Confirmed correct as-is.** Not a bug, no change.

## OQ-A5 — Should Remove be reversible?

**Deferred.** No action taken; remains irreversible via the UI (the
underlying row is soft-deleted, so the data itself survives, but there is
no restore screen).

## OQ-A14 — Force a password choice after an admin-issued password?

**Answered: yes.** Every place a system-generated temporary password is
minted — a new user invite, an admin reissuing a password, a new company's
first Admin, a vendor login (create or reset), a vendor sub-user, and a
franchise admin/facility login (create or reissue) — now flags the account
to be routed to the password-change screen on next sign-in, and every
surface's app shell (ops, vendor portal, franchise portal, superadmin) now
enforces that routing. The flag clears the moment the user actually chooses
their own password, either through self-service change or a forgot-password
reset. This is a frontend UX gate, deliberately not a server-side security
boundary — the temporary credential is already valid and already the
user's own; the gate is a nudge, not a lock.

## OQ-A15 — What should "Trust this device" do?

**Deferred.** No action taken; the checkbox remains present but has no
effect, as found.

---

## Verification performed

- `api`: every touched/new module imports cleanly (`app.models.user`,
  `app.features.auth.service`, `app.features.auth.schemas`,
  `app.features.auth.otp_service`, `app.core.deps`, `app.core.schemas`,
  `app.features.users.service`, `app.features.vendors.service`,
  `app.features.vendor_users.service`, `app.features.companies.service`,
  `app.core.franchise_logins`); full `pytest` suite (unit, no database)
  passes with no failures.
- `adminWeb`: `npx tsc --noEmit` and `eslint` clean across every touched
  file; the existing session test suite (`session.test.ts`, 10 tests)
  passes with the new `mustChangePassword` field added to its fixtures.
- The new migration's structure matches the model exactly, and
  `alembic heads` confirms it chains correctly as the sole head.
- Manually reviewed the two highest-risk diffs line by line (the `login()`
  lockout logic — commit-before-raise and atomic increment both present and
  correctly ordered — and the frontend route-guard wiring — all four app
  shells wrap their routes in the new guard, and each surface's own
  password-change route stays reachable while gated).

## Not run (manual steps remaining)

- The migration was **not executed** against any database (dev or prod) in
  this pass. Apply to the dev database first, test the upgrade → downgrade
  → upgrade round trip, then production only after review, migrated to an
  explicit revision — never "head."
- Manual re-run of the originally-affected QA steps (US-13/24/25,
  US-29/37, US-35, US-39, US-42, US-12, US-17, US-21, US-45) against a live
  environment, to close the loop with the original bug report. US-40 (the
  emailed forgot-password code flow) was never executed by QA in the
  original report either, for an unrelated reason (no readable mailbox) —
  still outstanding.
