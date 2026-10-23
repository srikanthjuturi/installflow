Task 00 — Test harness setup

- Added the ability to run automated tests: pytest for the API, vitest for the admin web console, jest for the mobile app.
- Pulled in a separate branch that added GPS coordinates (latitude/longitude) to pincodes — needed later for distance-based travel allowance.
- No visible feature change — just plumbing so future tasks can ship with tests.
-----------------------------------------------------------------
Task 01 — Franchisee database setup & migration

- Every company now automatically gets a "home franchisee" (itself) — the default owner of all technicians/tickets/money until real franchisees are added.
- Added two new tables (franchisees, franchisee_pincodes) and tagged existing tables (technicians, tickets, ledger entries, redemptions) with which franchisee owns them.
- A one-time backfill makes every existing technician a "freelancer" and stamps all old data to the home franchisee — nothing changes visibly for existing users.
------------------------------------------------------------------
Task 02 — New roles & permissions

- Introduced 3 new login roles: Franchisee Admin (manages a franchisee's technicians/money), Facility Admin, and Facility Operator (handle spare parts).
- Taught the system who is allowed to see/manage what — a franchisee admin only sees their own franchisee's people and money, never another's.
- Added franchisee info to the "who am I" login response so the app knows which franchisee a user belongs to.
-------------------------------------------------------------------
Task 03 — Franchisee management API (CRUD)

- Built the actual API to create, edit, and list franchisees — e.g., "SkyFix Services owns pincodes 500030–500040."
- Handles pincode assignment carefully: if pincodes move from one franchisee to another, technicians/tickets in those pincodes automatically move too (with a "preview" option before saving for real).
  Prevents two franchisees from claiming the same pincode, and creates login accounts for franchisee admins (with emailed temporary passwords).
- These four build on each other in order: 00 sets up testing → 01 lays the database groundwork → 02 adds the roles/security model → 03 exposes the API to actually manage franchisees.
-------------------------------------------------------------------
(Task 04 — making a ticket's franchisee "own" its work

- Every ticket is stamped with its franchisee, and that stamp now actually decides who can touch the job. Only the owning franchisee's technicians see it in
  their pool, get push notifications, can accept it, can be assigned it, and get the socket ring — in all five places that decide eligibility. 
  So a SkyFix job can never land with an Acme Home technician, even if stale data says otherwise.
- Coverage and re-routing follow the owner. Adding/editing/inviting a technician with a pincode outside their franchisee is refused with a clear error 
  (422 PINCODE_OUTSIDE_FRANCHISEE), and when a job is released (cancel / no-show) or re-assigned, its stamp is re-checked against the pincode's current 
  owner so the job goes back to a pool of technicians who actually cover it.
- A franchisee admin can finally read their own tickets. They see only tickets stamped to them (another franchisee's ticket reads as 404), read-only with
  attachments blocked, and their money fields visible but the vendor's price hidden. Staff dashboards, notifications, and escalation flows are 
  untouched — everything works exactly as before for employees.
-------------------------------------------------------------------
Task 05 summary:

- Moved ticket routing, rescheduling, roster, and penalty money so franchisees (like SkyFix) manage their own technicians — while Home keeps the company employees and pool money.
- Built and seeded the full test cast (Ravi, Hema, Kiran, Priya, etc.) and ran the 19-test acceptance suite against the real dev database.
- Found and fixed 7 real product bugs along the way (reversal authorization wall, reversal SQL crash, ticket page crash, slot blocking by closed jobs, etc.).
- Result: all 19 tests green — Task 05 is complete (publishing happens with) 
--------------------------------------------------------------------
Task 06 summery:

- What changed: Technicians can now be hired as employees (salary) instead of only freelancers. Employees get no per-job payout and no UPI redemption — the
  system shows ₹0 to redeem and refuses redemption attempts with a clear error.
- What still works: Their penalties (late cancels, no-shows), bonuses and penalty reversals still flow into the ledger exactly as before — only the per-job
   payment stopped.
- The monthly statement: A franchisee admin (and head office) can now download one CSV per employee per month listing every credit/debit with a net total 
  (e.g. bonus ₹400 − penalty ₹500 + reversal ₹500 = +₹400.00) — for payroll, and each month once downloaded never changes.
- Guardrails: A freelancer with unredeemed money can't become an employee until they withdraw it, no one gets paid twice (per job + salary), and every 
  payout row carries the payment type it was made under.
---------------------------------------------------------------------
Task07 summmery:
- App won't crash on new data — if the server sends a new earning type or job status the app doesn't know, it now shows it safely in neutral grey with no 
  sign, instead of crashing or guessing.
- Employee technicians — salaried staff now see "In salary" instead of payout amounts and get no Redeem card, since their pay isn't per-job.
- "Awaiting Part" status — jobs waiting for a spare part now show their own amber badge and a clear message, not a misleading "Start job" button.
- Every request sends X-App-Compat: 1 — a version tag so the server (Task 16) can later count how many old phones are still out there.
---------------------------------------------------------------------
Task 08 summery: 
- a new Master Data → Franchisees screen in the admin console — a list (with Home/Internal/External badges), a detail page 
  (facts, pincodes, technicians, franchisee admins), and an Add franchisee flow that creates the record first, then asks for its pincode ranges in a second 
  dialog that previews exactly who moves/loses pincodes before saving.
- Technicians screen changes: every technician now shows a Type (Freelancer/Employee) on their list and profile, plus their franchisee with a "Home" pill 
  and a technician run by a franchisee shows "Run by …" with no Edit button, so only the right person manages them.
--------------------------------------------------------------------
Task 09 Summery:
- A third portal shell for franchisee admins — they now sign in to their own /franchise/* console (Technicians, UPI changes, Redemptions, Penalty pool, 
  Employee statements, Tickets) showing their company's brand and their franchisee's name, while the staff console is untouched.
- Reuse, not copies — the same money/technician screens the staff console already had are remounted through a "workspace adapter" so the portal points at 
  /franchise/* doors with the right rules per screen: read-only tickets, franchisee-hidden columns, statements for salaried employees, and each row of 
  another franchisee refused.
- Staff console learned one new thing — National Head+ can download a home-employee's monthly statement CSV from their profile.
- Proven — 91 unit tests green, clean build, and a full Playwright smoke (9 screens, 26 checks, all pass) against a freshly seeded QA cast.
--------------------------------------------------------------------