# Reliance GreenTech Technician Field Platform — The Complete Beginner's Guide

> Goal of this document: after reading it you can explain the whole project to anyone — what it is, who uses it, what every person can do, how a job travels from "customer bought a TV" to "money in the technician's bank", and what happens when things go wrong.
>
> Every section uses ONE running story so you can follow along. All names and amounts are made-up examples; the rules (₹300/₹500/₹800/₹1,200 penalties, credits, etc.) are the real **defaults** from the code and can be changed per company.

---

## Table of contents

1. [The 60-second summary](#1-the-60-second-summary)
2. [The cast of characters (the 11 roles)](#2-the-cast-of-characters-the-11-roles)
3. [The four screens/apps](#3-the-four-screensapps)
4. [Key words (mini glossary)](#4-key-words-mini-glossary)
5. [Foundations: multi-tenant and white-label](#5-foundations-multi-tenant-and-white-label)
6. [Setting the stage: territory and the product catalogue](#6-setting-the-stage-territory-and-the-product-catalogue)
7. [Onboarding a technician](#7-onboarding-a-technician)
8. [Franchisees: who runs the technicians](#8-franchisees-who-runs-the-technicians)
9. [The main flow, step by step (the happy path)](#9-the-main-flow-step-by-step-the-happy-path)
10. [Edge cases of the job flow](#10-edge-cases-of-the-job-flow)
11. [Money, part 1: price, payout, penalties, bonuses](#11-money-part-1-price-payout-penalties-bonuses)
12. [Money, part 2: redeeming (cashing out) by UPI](#12-money-part-2-redeeming-cashing-out-by-upi)
13. [Money, part 3: company credits and vendor credit line](#13-money-part-3-company-credits-and-the-vendor-credit-line)
14. [Franchise extras: employees, travel, speed, spare parts, transfers](#14-franchise-extras-employees-travel-speed-spare-parts-transfers)
15. [Role-by-role action list](#15-role-by-role-action-list)
16. [Notifications: who is told what, and how](#16-notifications-who-is-told-what-and-how)
17. [Security and safety rules](#17-security-and-safety-rules)
18. [Tech stack and code map](#18-tech-stack-and-code-map)
19. [What is hidden or not built yet](#19-what-is-hidden-or-not-built-yet)
20. [Cheat sheet: explain it in 2 minutes](#20-cheat-sheet-explain-it-in-2-minutes)

---

## 1. The 60-second summary

**What is it?** A platform that lets a company (say a TV/AC/solar brand's service arm) get products **installed or demonstrated** at customers' homes by field **technicians**, with proof, tracking and automatic money handling.

**The simplest story:**

> Priya buys a 55" TV from **Crestline Distributors** (a *vendor*). Crestline logs into the **vendor portal** and raises a *ticket*: "Install this TV at Priya's address, pincode 500081".
> Priya gets a WhatsApp link and picks a time slot: "Thursday 10–12".
> The ticket appears in the **job pool** of technicians covering 500081. **Ravi** (a technician) taps **Accept** in his **mobile app** — first to accept wins.
> On Thursday Ravi travels, starts the job, takes **proof photos** (barcode, serial number, product, live geo-tagged photo), and completes it.
> Priya confirms on her link. The ticket **closes**; Ravi's earnings go up by his payout (say ₹600); Crestline now owes the company the product's vendor price.
> Ravi taps **Redeem**, a **UPI QR** appears, a manager scans it and pays him, he confirms the money arrived. Done.

**The four big pieces:**

| Piece | Folder | What it is |
|---|---|---|
| Technician app | `mobileapp/` | Expo / React Native phone app, 5 languages |
| Web console | `adminWeb/` | React website for staff, vendors, franchisees, super admin |
| Backend | `api/` | Python FastAPI + PostgreSQL — all rules live here |
| Requirements | `RequirementDocs/` | Business flow doc + clickable prototype |

---

## 2. The cast of characters (the 11 roles)

There are **11 fixed roles** in three families (plus one platform-level role). Lower rank number = more privilege.

| Rank | Role | Family | One-line description |
|---|---|---|---|
| 0 | **Super Admin** | Platform | Runs the whole platform; belongs to no company |
| 1 | **Admin** | Company staff | Top person inside one company |
| 2 | **National Head** | Company staff | Runs the company nationwide |
| 3 | **Regional Head** | Company staff | Responsible for one or more *regions* |
| 4 | **Area Manager** | Company staff | Responsible for one or more *states* |
| 5 | **Technician** | Field worker | Does the installation, uses the mobile app |
| 6 | **Vendor** | Outside party | A seller company that raises tickets |
| 7 | **Vendor User** | Outside party | A person created by a vendor; sees only own tickets |
| 8 | **Franchisee Admin** | Franchise | Runs one franchisee's technicians and money |
| 9 | **Facility Admin** | Franchise | Runs the franchisee's spare-parts desk and users |
| 10 | **Facility Operator** | Franchise | Works the spare-parts desk |

**Important beginner tip about rank:** rank only answers "may I manage this person?". It does **not** decide everything. Vendors and franchise roles are *separate families*: an Area Manager "outranks" a franchisee admin on paper, yet cannot touch that franchisee's technicians. The code tests *which family* you are in, never just the number.

**Real-time example of the hierarchy:** Acme Appliances (a company) has an Admin (Meera), a National Head (Sanjay), a Regional Head for South (Kavita), an Area Manager for Telangana (Imran), and technicians like Ravi. Their vendor Crestline has a Vendor login plus a Vendor User (Crestline's Hyderabad store clerk).

---

## 3. The four screens/apps

The web console has **four separate "shells"** (different menus for different audiences). A user lands in the right one automatically after login, and cannot wander into another.

| Surface | URL area | Who | What they see |
|---|---|---|---|
| **Superadmin** | `/companies` … | Super Admin | Companies, Geography, platform Rules, recharges |
| **Ops console** | `/` (everything else) | Admin, National Head, Regional Head, Area Manager | Dashboard, tickets, escalations, technicians, masters, ledger, settings |
| **Vendor portal** | `/portal/*` | Vendor, Vendor User | Raise tickets, own tickets, products, brands, users, credit |
| **Franchise portal** | `/franchise/*` | Franchisee Admin, Facility Admin/Operator | Technicians' UPI changes, redemptions, pool, allowances, statements, spare-part queue |

Plus the **technician mobile app** (`mobileapp/`) and two **customer web pages** (no login): the **slot-picking page** and the **feedback/confirmation page**, both reached from WhatsApp links.

**Why separate?** Safety. A vendor must never see staff screens. The portals use *deny-by-default*: if a path is not explicitly allowed for you, you're bounced.

---

## 4. Key words (mini glossary)

| Word | Plain meaning | Example |
|---|---|---|
| **Tenant / Company** | One customer business of the platform; its data is walled off from all others | Acme Appliances |
| **Ticket** | One job request (an install/demo) | "Install Crestline 55" TV at Priya's" |
| **Slot** | The time window the customer agreed to | Thu 10:00–12:00 |
| **Pool / Job pool** | List of open jobs a technician may accept | Ravi sees Priya's job |
| **Pincode** | 6-digit Indian postal code; the unit of "coverage" | 500081 |
| **Coverage** | The pincodes a technician works in | Ravi: 500081, 500082 |
| **Proof** | Photos/data proving work was done | barcode, serial, product photos, live photo |
| **Escalated** | Nobody accepted in time, or customer said "not done" | Manager must act |
| **Ledger** | The list of every money entry | payout, penalty, bonus… |
| **Pool money / Penalty pool** | A franchisee's closed circuit of penalties minus bonuses | Funded by cancellations |
| **Paise** | Money stored as integers (₹1 = 100 paise) | ₹600 = 60000 paise |
| **Credits** | What a *company* pays the *platform* per ticket | 10 credits/ticket |
| **Credit line** | What a *vendor* may owe its *company* | ₹5,000 default |
| **Redeem** | Technician cashing out earnings | Pay by UPI QR |
| **Franchisee** | A business that runs a set of technicians in set pincodes | SkyFix in 500030–500040 |
| **Home franchisee** | The company's own default franchisee, owns every unclaimed pincode | Code `HOME` |
| **White-label** | Every screen shows the *company's* name, not ours | "Acme Appliances" |

---

## 5. Foundations: multi-tenant and white-label

### 5.1 Multi-tenant (the #1 rule)

Many companies share one system, but **Company A can never see Company B's data** — not in lists, not by guessing ids, not through a forgotten join.

**How it works:** every table has a `company_id`; every query filters by the logged-in user's company; a guessed id returns **404** (not 403, so you can't even learn it exists).

**Example:** Meera (Acme admin) types the URL of a ticket that actually belongs to Zenith Corp. The server answers "not found". Same for another *franchisee's* technician.

A script `python -m app.scripts.audit_tenancy` checks isolation after every schema change.

### 5.2 White-label (the brand is the company)

After sign-in, screens show **the company's name and its code as the logo letters** — the console sidebar, browser tab, customer pages, emails, WhatsApp messages.

**Example:** For Acme (code `ACM`), the sidebar says "Acme Appliances" with an "ACM" badge. For Zenith it says Zenith.

**Where the platform's own name appears instead:** both login screens (a phone number doesn't name a company until the OTP succeeds), the superadmin console, the app splash screen, and the invite landing page.

The company's mark (`code`) is created once and **never recomputed** — because it's already printed on tickets.

---

## 6. Setting the stage: territory and the product catalogue

### 6.1 Geography (India map as data)

`Regions → States → Districts → Pincodes` (36 states, 754 districts, 19,496 pincodes). It's **global** (same for all companies), loaded from a spreadsheet by the **Super Admin** on *Super Admin → Geography*. The Super Admin can also add/correct a single pincode by hand, and can switch one off (never delete).

- A **Regional Head** covers **regions**.
- An **Area Manager** covers **states** (and automatically all pincodes inside; his region is derived).
- **Technicians** cover **pincodes**. Many technicians can share a pincode; two area managers can't share a state.

**Example:** Kavita (Regional Head, South) sees all tickets whose pincode falls in South India. Imran (Area Manager, Telangana) only sees Telangana's. He may assign technicians only to pincodes inside Telangana — assigning 600001 (Chennai) gets a 403 that names the offending pincode.

### 6.2 Product catalogue (a tree)

A tree of any depth (max 5 levels): *Electronics → Television → Android TV → OLED*. Only the **last level** ("This is the last sub-category") holds **products** (models).

- Each product has up to 5 photos, free-text specs (name/value pairs; template inherited from its leaf), a **brand**, two prices, and optionally a list of valid **serial numbers**.
- A technician certifies on a **main sub-category** (a direct child of a root, e.g. *Television*), which covers everything beneath it, including nodes added later.

**Two prices (very important):**
- `technician_payout_paise` — what the technician earns.
- `vendor_price_paise` — what the vendor will owe the company.

Both are **stamped on the ticket at intake**, so repricing later never rewrites old jobs. Neither party sees the other's figure (enforced on the server).

**Example:** 55" OLED TV model: technician payout ₹600, vendor price ₹900. Next month the company changes it to ₹700/₹1,000. Priya's already-raised ticket still pays ₹600/₹900.

### 6.3 Vendors, brands and serials

- A **vendor** is a company (Crestline Distributors); a **brand** is what's printed on the unit (*Meridian*, *Sunview*). Each product carries exactly one brand, and that brand must belong to the vendor.
- Brands added by staff are approved immediately; brands added by the vendor from its portal wait on **Approvals** for a National Head/Admin. Max 20 per vendor.
- Products a vendor submits are also **pending and unpriced** until staff price and approve them.
- **Serials:** if a model has serial numbers loaded, intake refuses a serial that doesn't belong to it. **Empty list = unchecked** (not "nothing matches"). Even when unchecked, a serial that belongs to *another product of the same vendor* is refused (`SERIAL_ON_OTHER_PRODUCT`).

**Example:** Crestline loads serials `MR-55-0001…0500` for its 55" TV. Raising a ticket with serial `AC-77-0042` for that TV is rejected. Typing `MR-55-00` in the form's first field offers a dropdown and auto-fills category, model and service type.

---

## 7. Onboarding a technician

Two modes, recorded on the technician's record (`onboarding_mode` and `registered_by` are separate facts).

### 7.1 Direct mode
A manager (or franchisee admin) fills everything: name, photo, phone, subcategories, coverage pincodes, type. The technician just signs in with OTP and lands on Home. They're WhatsApped the app link; "Send app link" resends it.

### 7.2 Invite mode
A manager types **only a phone number**. A WhatsApp link opens the app; the technician self-registers name, photo, subcategories, coverage. **Nothing is saved until they prove the phone with an OTP**, then it all commits in one transaction.

### 7.3 Login (OTP only)
Technician login = phone number + one-time code. No password, no "forgot password".
Console users log in with **email + password** or **Google** (Google never creates accounts — it matches an existing verified email). A forgotten password is a **one-time code emailed** to the address.

**Example:** Ravi enters +91 98xxxxxx01 → server WhatsApps/sends an OTP → he types it → he's in. For Google Play reviewers there is one special fixed-code test number.

### 7.4 Employee vs Freelancer
Every technician is either:
- **Freelancer** (default): earns a per-job payout; cashes out by redeeming.
- **Employee**: salaried, **no per-job payout, cannot redeem** (409 `EMPLOYEE_CANNOT_REDEEM`). Their franchisee admin downloads a **monthly CSV statement** to add to salary. Employees still earn travel, speed rewards and bonuses and still pay penalties.

The type that counts for a job is the one **frozen when they accepted it**.

---

## 8. Franchisees: who runs the technicians

Every company has franchisees. A franchisee is either:
- **Internal** — the company itself under another name, or
- **External** — a separate business leasing the company's name (e.g. SkyFix running Acme's work in 500030–500040).

**Home franchisee:** created with the company, internal, code `HOME`, cannot be deleted/deactivated/made external. It owns **every pincode nobody else claims** (it stores no pincode rows). So a ticket always has a franchisee.

### 8.1 Pincode ranges and the "carve-out"
Franchisees are given ranges like `500001-500099, 500120`. Only codes that exist and are active are stored. No two franchisees share a pincode (409 `FRANCHISEE_PINCODE_TAKEN`, naming clashing codes and owners).

Giving a franchisee pincodes is a **carve-out**: it moves people and *unassigned* work, **never assigned work**:
- A technician fully inside the new range → moves to the new franchisee.
- A technician partly inside → loses those pincodes (if left with none, they move).
- Open tickets nobody holds → re-stamped with a `franchisee_changed` event.
- A job someone already holds keeps its technician AND franchisee.
- The save **previews everything first** (`dryRun=true`).

**Example:** SkyFix gets 500030–500040. Ravi covers only 500035 → he moves to SkyFix. Anita covers 500035 and 500090 → she keeps 500090, loses 500035. A New ticket at 500035 becomes SkyFix's. A ticket at 500035 already accepted by Anita stays hers.

### 8.2 Who controls what
- **Tickets stay company work.** Admin/NH/RH/AM still escalate, reschedule, assign, force-close; the franchisee admin sees its franchisee's tickets **read-only**.
- **Technicians and their money are the franchisee's.** The franchisee admin adds/invites/edits technicians, sets type and base, approves UPI changes, pays redemptions, reverses penalties, runs its pool, travel & speed settings, facility staff, and downloads statements.
- Company staff can **read** a non-home franchisee's technicians but changes are blocked (403 "Managed by …"); Admin/NH can still reverse a penalty anywhere.
- The last active admin of a non-home franchisee cannot be removed (409 `FRANCHISEE_LAST_ADMIN`).

### 8.3 Handing an unassigned ticket to another franchisee
Staff may hand a ticket to another franchisee (reason required, only while nobody holds it). The system sets `routing_override`, which waives **only the pincode-coverage** check — certification, daily cap, availability and the franchisee test are never waived.

---

## 9. The main flow, step by step (the happy path)

Follow Priya's TV from start to finish. Ticket statuses used: **New, Slot Pending, Assigned, In Progress, Awaiting Part, Awaiting Customer, AI Review, Escalated, Closed (and Force-Closed), Cancelled**.

### Step 0 — Preconditions
The company has credits (§13), the vendor has credit line room, the product is priced and approved.

### Step 1 — Vendor raises the ticket (three channels)
Only a **vendor** (or vendor user) raises tickets. Channels the vendor is enabled for:
1. **Manual** form (`/portal/...New ticket`),
2. **Excel** bulk import (a sheet can even name categories that don't exist; a dry run shows what would be created and a checkbox confirms; products unknown are submitted pending),
3. **API** (someone else's app calling ours — no screen).

The form fields include: serial (mandatory, first field), category chain (drills down), model, service type (install or demo), customer name/phone/address, **pincode (checked against the master)**, and optionally a Google address search (browser-side; gives lat/long used for the distance check).

At intake the system **stamps**: the franchisee (from pincode), both prices, and the **rules snapshot** (penalty amounts, windows, etc.). It also charges the **company 10 credits** and **reserves the vendor's price** against the vendor's credit line.

**Example:** Crestline's clerk Asha fills: serial `MR-55-0001`, TV → Android TV → OLED → Meridian 55", Install, Priya Sharma, 500081. Ticket `ACM-000123` is created. Company credits drop 10; Crestline's room drops ₹900.

### Step 2 — Customer picks a slot
Priya gets a WhatsApp with a link (no login). The slot page offers windows allowed by the service level. She picks Thu 10–12. Status moves from **Slot Pending** → **New** (confirmed) and the ticket enters the pool.

If Priya stays silent for `slot_silence_hours` (default **6 h**), someone must phone her. A manager can set the time with **"Change the time"** (a reason is recorded).

### Step 3 — The job pool and first-accept-wins
The ticket is offered (masked: **customer name/phone/address hidden**) to technicians who match **all** of: same franchisee (or routing override), covered pincode, certified subcategory, under the daily cap, online/available. Technicians get a push notification (in their phone's language).

Ravi taps **Accept** → a single guarded database UPDATE settles the race. Losing is a normal outcome, not an error. On accept, the system freezes `accept_snapshot` (franchisee, technician type, travel figure, speed terms). Name, phone, address are now **unmasked**.

- A technician may accept a *Slot Pending* job but **cannot start** it until a time is agreed (409 `NO_TIME_AGREED`).

### Step 4 — Reminders
Shortly before the slot: Ravi gets a push (`slot_reminder_minutes`, default 60) and Priya a WhatsApp naming Ravi and his mobile (`customer_notice_minutes`, default 60). These don't clutter the escalation queue.

### Step 5 — Travel and Start
Ravi travels. At the site he opens the job and taps **Start job** → this begins the proof flow. Status → **In Progress**.

### Step 6 — Proof (four artifacts)
1. **Barcode** scan
2. **Serial number** photo
3. **Product photos**
4. **Live geo-tagged photo** (no gallery uploads, ever)

The server checks the live photo was taken **at the job** — by distance if the ticket has lat/long (picked from the address search), else by comparing pincodes. Vendor setting `location_check_enabled=off` removes the gate (the distance is still measured and recorded).

Currently AI verification is **hidden**; Review submits straight to the server (§19).

### Step 7 — Complete and customer confirms
Ravi taps **Complete**. The job awaits the customer. Priya gets a feedback page and **confirms** (or says it wasn't done). Only the customer closes a job (except a manager's force-closure).

### Step 8 — Closure writes money
On confirmation: status → **Closed**; for a *freelancer* a `payout` ledger entry (₹600) is written; travel and speed allowance rows (if configured) are written; the vendor now **owes** ₹900 on its credit line (the reservation converts into debt).

### Step 9 — Cash out
Ravi redeems (§12).

**Whole picture:**

```
Vendor raises → Customer picks slot → Pool → Technician accepts → Reminders
→ Travel → Start → Proof → Complete → Customer confirms → Closed → Payout → Redeem
```

---

## 10. Edge cases of the job flow

### 10.1 Customer never picks a slot
After 6 hours of silence a manager is prompted to call. The technician may still *accept* a Slot Pending job but not start. A manager uses "Change the time" (no code, written reason, no customer-confirmed claim recorded).

### 10.2 Nobody accepts → Escalation
A job still unassigned `escalate_hours_before_slot` (default **1 h**) before its slot becomes **Escalated** (leaves the pool) and reaches the Area Manager. The manager either **assigns** a technician directly or **funds a bonus** (₹200/400/600/800 bands) that republishes the job to the pool with a 30-minute grace (`renotify_grace_minutes`) so it doesn't instantly re-escalate.

**The escalation queue = two lists in opposite order:**
- Open windows: soonest first (closest to being missed).
- Closed windows: newest first. Emptied only by **rescheduling**.

### 10.3 Technician cancels (gives the job back)
Cancelling costs money, banded by lateness before the slot:

| When cancelled | Default penalty |
|---|---|
| More than 4 hours before | ₹300 |
| 2–4 hours before | ₹500 |
| Less than 2 hours before (or after slot opened) | ₹800 |
| No-show | ₹1,200 |

- **Cap:** ₹5,000 per technician per **calendar month in IST** (0 = no cap).
- Under 4 hours also **escalates** to the Area Manager. Inside the escalation window it escalates immediately.
- The slot never moves; the job returns to the pool.
- A speed penalty also counts toward the same cap.

**Example:** Ravi cancels at 9 am for a 10 am slot → "<2h" band → ₹800 into the penalty pool; the ticket escalates to Imran.

### 10.4 No-show
`sweep_no_shows` detects a technician who never showed, but **charges nothing** — a manager confirms (a dead phone and a deliberate no-show look identical).

### 10.5 Reversing a penalty
A penalty can be given back **in full, with a reason**, by the ticket's Area Manager, else Regional Head, else National Head, else Admin, or anyone senior; done from the ticket page. A **reversal** row is added (the penalty isn't edited); the money returns to the pool that collected it (even if the technician moved franchisee). The cancellation still *counts* against them. A franchisee admin can reverse a speed penalty from the portal.

### 10.6 Rescheduling (the slot can move — but only with consent)
- **Technician from the app:** needs a **one-time code sent to the customer's phone** and read back; the code is valid for **one ticket + one window**. Changing the window means a new code.
- **Area Manager and above from the console:** no code, a written reason, after phoning the customer.
- No charge, no cap on number of moves; each is a `rescheduled` event.
- Customer gets a WhatsApp with old and new times; technician gets a push when a manager moved it; vendor gets a bell.
- The SLA deadline is **not** re-based (reads as breached — honest) and the new window is bounded by a 48-hour horizon.
- An Escalated job **with** a technician (customer said "not done") **cannot** be rescheduled (`ESCALATION_IS_A_REFUSAL`).
- The code sent to the technician's own number is allowed (installing at their own address) but recorded and rung to the area manager.

### 10.7 Customer silent after completion → Force-closure
After `force_close_hours` (default **12 h**) a sweep raises a notification but closes nothing. A manager (Area Manager+) force-closes with a **reason, justification and at least one attachment**. The manager also enters what the technician is owed, capped at the job's price: a technician who travelled and found nobody home is owed something; if the customer never confirmed a slot, owed nothing. A force-closed job **counts as completed** for the technician. No speed allowance is paid on force-closure. This is the **only exit** from the live set besides customer confirmation.

### 10.8 Customer says "not done"
The ticket goes to **Escalated** *with* a technician — a complaint, not an appointment. It can't be rescheduled; managers handle it.

### 10.9 Spare part needed
After starting, the technician raises a part request; job goes **Awaiting Part**; Complete is refused while any request is `requested` or `approved` (409 `PARTS_PENDING`). See §14.4.

### 10.10 Daily job cap
Optional (`NULL` = no limit; new technicians have none). Counted by **slot date in IST**; `Closed` still counts; only `Cancelled` frees a slot. Floor is 1 (0 would mean "offline"). Set in the app (Profile → Availability & bandwidth) or by a manager.

### 10.11 Losing the accept race
Two technicians tap Accept simultaneously; the guarded update gives it to one. The other sees "already taken" — a normal outcome.

### 10.12 Photo/location problems
Live photo too far from the customer → refused (unless the vendor's location check is off). A site that can't produce a GPS fix (basement, warehouse) is why the switch exists. Note an old installed APK keeps blocking until rebuilt.

### 10.13 Invalid pincode
A pincode not in the master would silently make the ticket invisible to everyone but all-India roles, so intake validates it server-side on every channel (including Excel/API).

### 10.14 Company out of credits
When a new ticket would pass the floor (−500 default) → 409 `OUT_OF_CREDITS`. The vendor's New ticket page says intake is paused *before* the form is filled and never shows the balance.

### 10.15 Vendor out of credit line
→ 409 `VENDOR_OUT_OF_CREDITS`. See §13.2.

### 10.16 Duplicate Excel rows
A row whose `Reference` is already on a ticket is skipped, never charged twice, so re-uploading a corrected file is safe.

---

## 11. Money, part 1: price, payout, penalties, bonuses

### 11.1 The ledger
`ledger_entries` holds every kind of money row: `payout`, `travel`, `bonus`, `penalty`, `speed_reward`, `speed_penalty`, `reversal`. Each row stamps the **franchisee** that paid and the technician **type** at the time (so history is never relabelled).

### 11.2 The Earnings number
`net = earned + bonuses − penalties`. A null rating shows `—` not `0.0`.

### 11.3 The penalty pool (a closed circuit per franchisee)
`balance = penalties + speed penalties − reversals − bonuses − speed rewards`. Cancellations and slow jobs **fund** it; bonuses and speed rewards are **paid out of** it. A **payout** and a **travel** allowance are *not* pool money (the company pays for work). The console's pool screen filters to pool kinds only; the technician's Earnings shows everything.

### 11.4 Worked monthly example for Ravi (freelancer)

| Event | Ledger | Effect on Ravi |
|---|---|---|
| Completes 5 jobs @ ₹600 | 5 × payout | +₹3,000 |
| Late cancel (<2h) | penalty ₹800 | −₹800 |
| Bonus on a hard-to-fill job | bonus ₹400 | +₹400 |
| Manager reverses the penalty | reversal ₹800 | +₹800 |
| **Net** | | **₹3,400** |

### 11.5 Pricing rules by category
Any category node may override any rule (`product_node_rules`). Resolution: `code defaults → company rules → ancestors root-first → the node`. **Exception:** the monthly cancellation cap stays company-wide. The ticket stores the resolved set (**rules snapshot**) at intake so later edits never restate accepted work.

**Example:** A 32" TV install uses the default ₹300 early cancel; a rooftop solar category overrides it to ₹1,000.

---

## 12. Money, part 2: redeeming (cashing out) by UPI

No payment gateway. Nothing in the system can *see* money, so two people's words are recorded separately:

1. **Request:** the technician taps Redeem — one request for the **whole balance**, capped at ₹1,00,000 (UPI's limit). Balance = payouts + bonuses − penalties − every redemption not declined.
2. The server builds a `upi://pay?…` string; both clients draw a **QR**.
3. The **payer** scans it on their own phone and pays. Payer is:
   - home technician → company's **National Head, or Admin if none** (and the home franchisee's own admins alongside);
   - franchisee's technician → **that franchisee's admin**.
4. The payer **claims** "I paid" (screenshot, UTR optional).
5. **Only the technician confirms** it arrived — the one thing that makes it *paid*. Nobody else can.
6. The payer may **decline** before claiming; the technician has **no cancel** (the payment could leave the payer's phone any moment).

**Example:** Ravi's balance is ₹3,400 → requests → QR shown to Sanjay (NH) → Sanjay pays and uploads a screenshot → Ravi sees "Payer says paid" → Ravi confirms receipt → status Paid.

**Employees cannot redeem.**

### 12.1 UPI ID setup (once, proved by a code)
Profile → Payout account: either **scan** the UPI QR from a bank app (fills UPI ID and account name) or **type** both. It saves only after a **WhatsApp code to the registered number**. After that, the technician can only **request a change** (new UPI ID + name), which rings the Area Manager → else Regional Head → else National Head → else Admin (for a franchisee's technician: that franchisee's admin only). The approving manager needs **no code** — the manager is the check. Why: it's where money lands; a borrowed phone could redirect it.

---

## 13. Money, part 3: company credits and the vendor credit line

These are **two different systems** — don't mix them. **Either alone can stop a vendor's intake.**

### 13.1 Company credits (company pays the platform)
- 1 credit = ₹1. New company gets **1000 free credits** (default).
- Each ticket costs **10 credits when RAISED**; never refunded (cancellations included).
- Balance may go down to a **floor of −500**; beyond → `OUT_OF_CREDITS`; already-raised tickets carry on.
- **Recharge:** the company's **Admin or National Head** opens *Credits*, enters an amount, sees a UPI QR for the **platform's** UPI ID, pays, then enters UTR + screenshot. Only the **Super Admin** confirms arrival — the one thing that adds credits.
- Numbers (free credits, ticket charge, floor, platform UPI ID) are on the Super Admin's **Rules** page (`platform_settings`). Free credits affect only companies created later; charge and floor affect all from the next ticket.

**Example:** Acme has 15 credits. Crestline raises ticket A (balance 5) and B (−5), then ticket C would be −15… still above −500, allowed. At −495 the next ticket is refused.

### 13.2 Vendor credit line (vendor owes the company)
- Charged when a ticket **CLOSES**, at `tickets.vendor_price_paise`.
- Default line **₹5,000** (company rule, overridable per vendor and **stamped**, so raising the house default never silently extends an old agreement).
- **Room left = limit − owed − stamped price of tickets raised but not yet closed/cancelled.** Raising a ticket reserves its price immediately.
- Cancellation bills nothing (falls out of the model).
- **Closure never refuses** (the customer confirming runs with no principal; a force-closure is a manager settling) — so the line can go negative, which stops the *next* ticket with `VENDOR_OUT_OF_CREDITS`.
- **Two ways out** on the vendor's **Credit** page:
  - **Pay:** UPI QR from the **company's** UPI ID (Rules Config) + UTR + screenshot; only the company's **Admin or National Head** confirms.
  - **Ask for more:** a request those same two decide (maybe for less).
- Both queues are the console's **Vendor Credit** screen. A vendor **sees its own four figures** (limit, owed, reserved, room) — it is a debt they must act on.

**Example:** Crestline limit ₹5,000. It raises 5 TV tickets (₹900 each) → ₹4,500 reserved, room ₹500. A 6th is refused. Two close → owed ₹1,800, reserved ₹2,700, room ₹500. Crestline pays ₹1,800 by UPI; Sanjay confirms; owed returns to 0, room ₹2,300.

---

## 14. Franchise extras: employees, travel, speed, spare parts, transfers

### 14.1 Travel allowance
Paid for distance **beyond a free allowance**, from the technician's **base** to the customer, one way.
- Distance = straight line × road factor **130 %**. Customer point = ticket's map pick, else pincode centre; no point → **0 km** with a recorded reason.
- Free distance: **20 km freelancer, 30 km employee**. Each whole step beyond pays a rate, capped per job. **Defaults are ₹0 → off until a franchisee configures it.**
- Paid as a `travel` row on the customer's confirmation. On force-closure the manager's form starts with the frozen amount and can change it (capped). Never on cancellation.
- **Base** = where the technician starts from (franchisee admin pins it on an OpenStreetMap map, or the technician sets a home pincode/GPS/pin). Copied, not linked. No base at accept → ₹0 travel (never a refused accept). Company staff see the travel *amount* but never the base's coordinates.

### 14.2 Speed allowance
Rewards a fast job and charges a slow one, per franchisee × technician type × category or product (a product's row beats a category's).
- Clock = **later of accept and slot start** → Complete, **minus time in `Awaiting Part`**.
- Within reward hours → `speed_reward`; past penalty hours → `speed_penalty`; between → nothing. Measured at completion, written at customer confirmation, **never on force-closure**. Empty matrix = off.

**Example:** For TVs the franchisee sets reward ≤ 2 h (₹100), penalty > 4 h (₹100). Ravi finishes in 1.5 h → +₹100; in 5 h → −₹100.

### 14.3 Employee statements
Franchisee admins download one CSV per employee per IST calendar month (bonuses, penalties, travel, speed) to add to salary. Salary itself is not recorded.

### 14.4 Spare parts and `Awaiting Part`
- Technician asks for a part **only after starting**. List = category's parts (inherited) + product's own, or *Other* with a typed name.
- Job moves to **Awaiting Part** (not terminal; holds the vendor reservation; counts on its slot day against the daily cap; can be force-closed).
- **Facility staff** (Facility Admin/Operator) log each step: approve/reject (even an approved one can later be rejected with reason), new part issued, old part received back. The technician only raises.
- When all requests are issued/returned/rejected → job returns to **In Progress**. A revisit uses an ordinary reschedule.
- If the franchisee has no active facility user → 409 `NO_FACILITY` and the app hides "Need a spare part".
- No money or stock counts — just a log of who did what, when. **Nobody in the staff console works the queue**, not even for the home franchisee; Admin/NH add the home franchisee's facility users.

### 14.5 Moving a technician
Company **Admin/National Head** can move a technician to another franchisee — refused while they hold an open job, redeemable money or an unsettled redemption. No ticket/ledger/redemption row moves; history stays. Coverage is refitted; every move is an audit row in `technician_transfers`. A freelancer with money to redeem cannot become an employee (409 `TECHNICIAN_HAS_BALANCE`), nor can anyone with an open job (409 `TECHNICIAN_HAS_OPEN_JOBS`).

---

## 15. Role-by-role action list

(Denoted: ✔ = can; ◐ = limited; ✘ = cannot. Exact access can be tuned per company on **Feature Access**; the floors below are the defaults enforced by rank/family.)

### 15.1 Super Admin (rank 0) — the platform owner
- Create/edit/deactivate **companies** (phone mandatory) and their first admin.
- Load the **geography master** (spreadsheet) and add/correct/switch off single pincodes.
- Set platform **Rules**: free credits, ticket charge, floor, platform UPI ID.
- **Confirm company recharges** (the only role that adds credits).
- Switch into any company to view it. Sees console as company-less.
- Cannot be reached by a vendor/franchise user.

### 15.2 Admin (rank 1)
- Everything a National Head can do, plus final fallback for UPI-change approvals and payments when there's no National Head.
- Manage Users & roles, Feature Access, Rules Config.
- Confirm vendor payments / credit requests; recharge company credits; add the home franchisee's facility users and franchisee admins.
- Reverse penalties anywhere; move technicians between franchisees.

### 15.3 National Head (rank 2)
- Create **vendors** (with their login — mandatory) and set credit lines; approve vendor brands/products; price products.
- Create/edit users below them; assign territory to Regional Heads.
- Manage franchisees (create, give pincode ranges with dry run); manage allowances/settings (travel/speed for the home franchisee); edit **Rules Config**.
- Recharge company credits; confirm vendor credit payments and requests.
- Pay technician **redemptions** (home technicians).
- Escalate, reschedule, assign, force-close, reverse penalties across the company.
- View the penalty pool/ledger and employee statements.

### 15.4 Regional Head (rank 3)
- See tickets/technicians in his **regions**; assign Area Managers' states.
- Escalation, assign technician, fund bonus, reschedule, force-close, reverse penalty (within territory).
- Add/edit technicians within the territory; approve UPI changes if no Area Manager covers.
- Read franchisees (AM floor).
- Cannot manage vendors, credits, settings or pay redemptions (NH floor).

### 15.5 Area Manager (rank 4)
- See tickets in his **states**; only assign pincodes inside them.
- Add/invite/edit technicians (home franchisee); approve their UPI changes (first in line).
- Handle **escalations**: assign, fund bonus, reschedule (no code, with reason), **force-close**, **reverse penalty**, confirm no-shows, hand a ticket to another franchisee.
- Receives escalation/job-accepted notifications and warnings.
- Cannot create tickets, edit rules, manage vendors or credits.

### 15.6 Technician (rank 5) — mobile app
- Sign in with OTP; choose language; set availability, daily cap, base location, payout account.
- Browse the **pool** (masked), **accept** a job.
- **Reschedule** with customer's code; **cancel** (penalty by band); **start**, capture **proof**, **complete**; **request a spare part**.
- View Jobs, Earnings (earned/bonuses/penalties/net), **redeem** (freelancers), confirm a received payment, request UPI change.
- Delete own account.
- Never proposes a slot themselves; never sees the vendor price.

### 15.7 Vendor (rank 6) — portal
- **Raise tickets** (manual, Excel, API per its enabled channels), view **all** tickets its people raised, cancel? (not exposed).
- Manage **products** (submit new, pending approval), **brands** (pending approval), **serials** (add/import/correct/remove — with a warning before the last one goes).
- Create/manage its **Vendor Users**.
- See its **Credit** page: pay by UPI, ask for more line, see its four figures.
- Use Google address search (if enabled); each search session is counted.
- Cannot see the technician payout, company credits, or any other vendor.

### 15.8 Vendor User (rank 7)
- Raises tickets; sees **only tickets they raised themselves**.
- No user management.

### 15.9 Franchisee Admin (rank 8)
- Manage its **technicians** (add, invite, edit, set type, set base, deactivate), approve **UPI changes**.
- **Pay redemptions** (for its technicians), run its **penalty pool**, reverse penalties.
- Set **travel and speed** allowances; download **employee statements**.
- Create **facility users** (Facility Admin/Operator).
- See its franchisee's **tickets read-only**.
- Cannot see other franchisees or any company-staff screens.

### 15.10 Facility Admin (rank 9)
- Run the **spare-parts queue**: approve, reject, issue new part, receive old part.
- Manage **facility users** (per portal).
- Read-only tickets.

### 15.11 Facility Operator (rank 10)
- Work the **spare-parts queue** (log steps); no user management.

---

## 16. Notifications: who is told what, and how

| Event | Who | How |
|---|---|---|
| New confirmed job in area | Eligible technicians | Push (in phone's language) |
| Slot link | Customer | WhatsApp |
| Reminder before slot | Technician push; customer WhatsApp (with tech name+mobile) | `ticket_events` (`reminded`, `customer_notified`) |
| Job accepted | Manager | WhatsApp (`job_accepted_manager_v2`) |
| Escalation | Area Manager | WhatsApp (`job_escalation_v2`) |
| Reschedule | Customer WhatsApp; technician push (if manager moved it); vendor bell | `slot_rescheduled` |
| Temporary password | New console user | Email (shown in response if email fails) |
| OTP | Technician / customer / password reset | WhatsApp / email |
| Force-close due | Managers | Notification |

Other facts: WhatsApp messages stay English until each template is approved per language in Meta. Without WhatsApp credentials the OTP comes back as `devCode` (dev only) and invites log a copyable link.

---

## 17. Security and safety rules

1. **Multi-tenant isolation** (§5) — guessed ids → 404.
2. **RBAC is enforced on the server**; the UI merely hides things. Every endpoint carries a feature key plus, where money is involved, a rank floor; franchise routes use a separate `/franchise` twin with their own guards.
3. **Masking:** the customer's name, phone, address hidden until accept.
4. **Neither party sees the other's price** (server-enforced in three places).
5. **Proof must be live**: no gallery photos; geo-tagged.
6. **Images are uploaded, never embedded** (no `data:` URLs).
7. **Money is integer paise; phones E.164; times stored UTC, shown IST.**
8. **Tenancy audit script** run after any schema change.
9. **UPI changes** need a WhatsApp code then manager approval.
10. **Production safety:** `RelianceDB` (dev) vs `RelianceProdDB`; migrating prod requires `CONFIRM_PROD`.

---

## 18. Tech stack and code map

**Mobile:** Expo SDK 54 · React Native 0.81 · React 19 · TypeScript · Expo Router · NativeWind 4 · TanStack Query · Zustand (client state only) · React Hook Form + Zod · expo-camera · i18next (5 languages: English, हिन्दी, తెలుగు, ಕನ್ನಡ, தமிழ்).

**Web console:** React + Vite · Tailwind v4 · shadcn · Leaflet (maps) · Vitest.

**Backend:** FastAPI · SQLAlchemy · Alembic migrations (hand-written, round-trip tested) · PostgreSQL on Azure · Azure App Service · Azure Blob for uploads.

**Analytics:** GA4, Clarity, PostHog in **production builds only**.

**Layout:**
```
RequirementDocs/   business flow + prototype
mobileapp/         technician app (app/ = routes, src/features/* = screens)
adminWeb/          console (pages: dashboard, tickets, escalations, technicians,
                   masters, ledger, redemptions, credits, vendorCredit, settings,
                   franchisees, franchise portal, vendor portal, superadmin)
api/               FastAPI (features/* slices, core/* shared rules)
```

Key rules: no hex colours outside `src/theme`; no server state in Zustand; every list has loading/empty/error states; never invent copy (all text in `en.json`); one commit per completed screen.

---

## 19. What is hidden or not built yet

- **AI verification is hidden in both clients (UI-only).** The three intended outcomes (match → closure, mismatch → ASM review, unreadable → retake on site) exist as designs and as the `AI Review` ticket status, but screens aren't routed; the app submits proof straight to the server. The API still sends `aiFlagged`; thresholds still round-trip.
- Not rebranded on purpose: storage keys, the `installflowapi` Azure hostname, the Android package, etc.
- Vendors are not told when their customer's slot is at risk (open product decision).
- The `technician_app_link` WhatsApp template was rejected by Meta three times; the invite template stands in.
- Money between an external franchisee and the company (lease, revenue share) isn't handled.

---

## 20. Cheat sheet: explain it in 2 minutes

> "It's a white-labelled platform that connects **vendors** who sell products, **companies** that service them, **franchisees** who run local technicians, and **technicians** who do the work.
> A vendor raises a ticket; the customer picks a slot on a WhatsApp link; the job appears in the pool of nearby, certified technicians; the first to accept gets it. On the day they travel, start, take four kinds of proof, and complete; the customer confirms and the job closes.
> Money is handled without a payment gateway: the technician earns a payout per job (or a salary if an employee), pays penalties for late cancellations from a per-franchisee pool, can get bonuses, and cashes out by scanning a UPI QR that a manager pays — with the technician confirming it arrived.
> Companies pay the platform in credits per ticket; vendors pay the company against a credit line when jobs close.
> There are 11 roles: Super Admin, Admin, National Head, Regional Head, Area Manager (staff); Technician; Vendor and Vendor User; and Franchisee Admin, Facility Admin, Facility Operator. Everything is multi-tenant — one company's data is invisible to another — and every rule is enforced on the server."

**Ticket status quick map:**
`Slot Pending → New → Assigned → In Progress ⇄ Awaiting Part → (customer) → Closed`
with side exits: `Escalated` (nobody accepted / customer said not done), `Cancelled`, `Force-Closed`, and the hidden `AI Review`.

**Money quick map:**
```
Ticket raised  → company −10 credits ; vendor room −price (reserved)
Ticket closed  → technician +payout ; vendor owes price ; (+travel, ±speed)
Cancel         → technician −penalty band (pool +) ; vendor reservation released
Bonus          → technician + (pool −)
Redeem         → QR → payer pays → payer claims → technician confirms
Recharge       → company pays platform UPI → superadmin confirms → credits +
Vendor pays    → company UPI → NH/Admin confirms → credit line restored
```
