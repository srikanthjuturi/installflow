# Hands-On Walkthrough — Build a Demo Company From Scratch

> Purpose: learn the project by **using** it. Every step says where to click, what to paste, and what you should see.
> Pair this with `PROJECT_GUIDE.md` (the theory). This file is the practice.
>
> **How to use it:** go in order. Each Part builds on the one before. Tick the boxes. Write passwords in the tracker (Part 0.4).

All names, emails, phones, GST numbers and addresses below are **fake demo data** made to pass the app's validation rules. Paste them exactly.

---

## Contents

0. Before you start (setup, shortcuts, trackers)
1. Super Admin: check the platform, create the company
2. Company Admin: first login, create staff users
3. National Head: create the vendor
4. Product catalogue: categories, brand, product, serials
5. Franchisees: create SkyFix (no pincodes yet)
6. Technicians: add Ravi, Anita, Deepak
7. Vendor: raise tickets
8. Customer picks a slot
9. Technician app: accept, start, proof, complete
10. Carve-out: give SkyFix pincodes
11. Edge cases to try
12. Money: payouts, redeem, penalties, bonus, reversal
13. Credits and vendor credit line
14. Franchise portal: employee, travel, speed, spare parts
15. Quick checklist: "did I see everything?"
16. Troubleshooting

---

## Part 0 — Before you start

### 0.1 Start the system

From the repo root, in separate terminals:

```powershell
# Terminal 1 - backend (uses the DEVELOPMENT database RelianceDB)
cd api
.\.venv\Scripts\python.exe -m alembic upgrade head
.\.venv\Scripts\python.exe -m app.scripts.bootstrap      # creates the superadmin (once)
.\.venv\Scripts\python.exe run.py                        # http://localhost:8000

# Terminal 2 - console
cd adminWeb
npm run dev                                              # prints a localhost URL

# Terminal 3 - mobile app (optional until Part 9)
cd mobileapp
npm start                                                # scan the QR with Expo Go
```

Check that only one process listens on port 8000 (`netstat -ano | findstr :8000`). A leftover process can serve old code.

### 0.2 Two things that make testing easy (dev only)

1. **Leave `WHATSAPP_*` empty in `api/.env`.** Then OTP codes come back on screen as `devCode` and invites show a copyable link. No WhatsApp account is needed.
2. **Make the temporary password appear on screen.** The server shows a new account's temporary password **only when the email did not go out**. Two ways to get that on dev:
   - leave `ACS_CONNECTION_STRING` / `ACS_SENDER_ADDRESS` empty in `api/.env` (email is "not configured"), **or**
   - if email *is* configured, set `ACS_EMAIL_ALLOWLIST=<your own real address>` in `api/.env`. Every other address (including the `@seed.example.com` ones below) is then refused, so the password comes back on screen instead of mail going to a stranger.

   Restart the API after editing `.env`. Use emails ending in `@seed.example.com` for the demo accounts so no real person is emailed. **If email is configured and the allowlist is empty, the password is emailed to that address and you will never see it on screen**, so a fake address means a lost password.

   The password is shown **once**, in a panel that replaces the form. Copy it before clicking Done; it is stored nowhere readable.

The Super Admin login is whatever `SUPERADMIN_EMAIL` and `SUPERADMIN_PASSWORD` are in `api/.env`.

### 0.3 Everything is created from the application itself

No seed or data scripts are used in this guide. Everything except the three one-time prerequisites below is created by clicking in the console or the mobile app.

**The only things that cannot be created from a screen (do them once):**
1. **Database and tables:** `alembic upgrade head` (Part 0.1).
2. **The Super Admin login (the very first account):** the application has no sign-up screen, because anyone able to sign up as the platform owner would own everything. The only built-in way to create it is `python -m app.scripts.bootstrap`, which reads `SUPERADMIN_EMAIL` / `SUPERADMIN_PASSWORD` from `api/.env`. **You may not need it at all:** if the development database already has a Super Admin, just sign in with those `.env` values on the login page. Try that first; only if the login fails do you need the one-time bootstrap. From then on, **every other account (company Admin, National Head, Regional Head, Area Manager, vendor, vendor user, technician, franchisee admin, facility staff) is created by you in the app.** The `.env` email and password are the Super Admin's login, so set them to values you choose before the first run.
3. **The geography data:** it is uploaded **in the app** (Super Admin -> Geography -> import) using the spreadsheet in the repo: `RequirementDocs/Reliance Green Tech Pin Code.xlsx` (and `RequirementDocs/Pin Code corrections.xlsx` for fixes). Part 1.2 covers this.

If the database already has a Super Admin and geography loaded, skip those.

### 0.4 Tracker (fill in as you go)

| Login | Email | Temporary password | New password |
|---|---|---|---|
| Super Admin | (from `.env`) | (from `.env`) | |
| Company Admin | meera.admin@seed.example.com | | |
| National Head | sanjay.nh@seed.example.com | | |
| Regional Head | kavita.rh@seed.example.com | | |
| Area Manager | imran.am@seed.example.com | | |
| Vendor | crestline.vendor@seed.example.com | | |
| Vendor User | asha.clerk@seed.example.com | | |
| SkyFix Admin | farhan.skyfix@seed.example.com | | |
| Facility Operator | lakshmi.parts@seed.example.com | | |

**Suggested new password for all of them:** `Demo@12345` (the rules may demand upper, lower, digit, symbol; this satisfies all).

### 0.5 Master demo data (reference sheet)

| Item | Value |
|---|---|
| Company | Acme Appliances |
| Company code | `ACM` |
| Company phone | +919000000001 |
| Company GSTIN | 36AABCA1234F1Z5 |
| Company PAN | AABCA1234F |
| GST status | Active |
| Address | Plot 12, Hitech City Road |
| City / State / Pincode | Hyderabad / Telangana / 500081 |
| Vendor | Crestline Distributors |
| Vendor GSTIN / PAN | 36AAGCC9012M1Z8 / AAGCC9012M |
| Home franchisee | auto-created (code `HOME`) |
| External franchisee | SkyFix Services (code `SKYFIX`) |
| Pincodes (Hyderabad) | 500081, 500082, 500084 (home); 500032, 500033, 500034 (SkyFix) |

### 0.6 Menu names as they appear on screen (from the code)

| Who signs in | Left menu entries |
|---|---|
| Super Admin | Companies, Recharges, Rules, Geography |
| Admin / National Head / Regional Head / Area Manager | Dashboard, Ticket List, Escalation Queue, Approvals, Redemptions, Technicians, Franchisees, Penalty & Bonus, Vendors, Territory, Categories, Rules Config, Allowances, Users & Roles, Vendor Credit, Credits (each person sees only the ones their role allows) |
| Vendor / Vendor User | Raise a ticket, Import tickets, My products, My brands, My tickets, Credit, Users |
| Franchisee Admin / Facility staff | Technicians, UPI changes, Redemptions, Penalty & bonus pool, Employee statements, Allowance rules, Spare parts, Tickets, Facility users |

The steps below use these exact names.

### 0.7 Who creates whom (so you create every account yourself)

```
Super Admin (created once, Part 0.3)
  └─ Companies -> "Add company"  creates the company AND its Admin login (the "Admin login" section of the form)
       └─ Admin (Meera) -> Users & Roles -> "Invite user" creates: National Head, Regional Head, Area Manager
            ├─ National Head -> Vendors -> "Add vendor"  creates the Vendor AND its login
            │     └─ Vendor -> Users -> creates Vendor Users
            ├─ National Head -> Franchisees -> "Add franchisee"  creates the franchisee AND its admin login
            │     └─ Franchisee Admin -> Facility users -> creates Facility Admin / Operator
            └─ Area Manager / National Head -> Technicians -> add or invite technicians (they sign in by OTP, no password)
```

So the **Company Admin is created by you** inside the **Add company** form (Part 1.4), and then **you sign in as that Admin** and create everyone else from the Users & Roles screen (Part 2). Nothing is created by a script.

### 0.8 Important: the GSTIN lookup (read before Part 1)

When you type a GSTIN, the company and vendor forms may ask a real GST registry service whether it exists. This only happens if `GSTZEN_TOKEN` is set in `api/.env`.
- **If `GSTZEN_TOKEN` is empty (recommended for demo data):** the lookup reports "unavailable", blocks nothing, and you type every field by hand. The made-up GSTINs in this guide work.
- **If it is set:** made-up GSTINs may be rejected as "not registered", which **blocks the save**. Either empty `GSTZEN_TOKEN` and restart the API, or use a real GSTIN you are allowed to use.
- A GSTIN already used by another company on this platform is refused ("already registered") in either case.

> **Important:** pincodes must exist in the loaded geography master. If a pincode below is rejected, open **Super Admin → Geography** and pick any active Hyderabad pincodes instead, then use them consistently. Before Part 5, make sure Geography has been imported.

---

## Part 1 — Super Admin: check the platform, create the company

**Who:** Super Admin. **Where:** the console login page.

### 1.1 Sign in
- [ ] Open the console URL. Sign in with the Super Admin email and password from `.env`.
- **You should see:** the superadmin shell (menu: Companies, Recharges, Rules, Geography). There is no company sidebar because the Super Admin belongs to no company. The brand shown is the **platform's** name.

### 1.2 Check the geography
- [ ] Go to **Geography**.
- **You should see:** regions, states, districts, pincodes (numbers like 36 states, 754 districts, 19,496 pincodes).
- [ ] Search for `500081` to confirm it exists and is active.
- **If the master is empty:** use the import control on this screen and upload `RequirementDocs/Reliance Green Tech Pin Code.xlsx`. Run it as a **dry run first** if offered, read the report, then confirm. Afterwards you should see 36 states, 754 districts and 19,496 pincodes.
- **Add one pincode by hand (practice):** use the add-pincode control to add a test pincode that the sheet lacks, then switch it off. You can only switch a pincode off, never delete it or change its code.

### 1.3 Look at the platform rules
- [ ] Go to **Rules** (in the Super Admin menu).
- **You should see:** free credits (default 1000), ticket charge (default 10), floor (default -500), and the platform UPI ID.
- [ ] Set the **platform UPI ID** to: `acmeplatform@seeddemo`
  (Deliberately not a real handle, so a scanned QR fails instead of paying a stranger.)

### 1.4 Create the company
- [ ] Go to **Companies** and click **Add company**. The dialog has four sections. Fill them in order:

**Section "Statutory identity"**

| Label on screen | Paste |
|---|---|
| GSTIN | 36AABCA1234F1Z5 |
| PAN | AABCA1234F |
| GST company status | Active |

**Section "Company"**

| Label on screen | Paste |
|---|---|
| Company name | Acme Appliances |
| Contact / admin email | meera.admin@seed.example.com |
| Phone | +919000000001 |

**Section "Registered address"**

| Label on screen | Paste |
|---|---|
| Building, street and area | Plot 12, Hitech City Road |
| City | Hyderabad |
| State | Telangana |
| PIN code | 500081 |

**Section "Admin login"**

| Label on screen | Paste |
|---|---|
| Admin name | Meera Nair |

Click **Create company**. (The company code `ACM` is derived from the name; the code is stamped once and never changes. If the dialog offers a code box, type `ACM`.)

- **This is how the Company Admin is created:** the **Contact / admin email** becomes Meera's login, and the **Admin name** is her name. There is no separate "create admin" screen.
- **You should see:** the company created, and a **panel with Meera's temporary password** replacing the form (it appears because the email was not sent, see Part 0.2). Copy it into the tracker before closing the panel.
- **What happened behind the scenes:** the company got its **HOME franchisee**, its rules row (defaults), 1000 free credits, and a code `ACM` that will never change.

> If the form auto-fills details from the GST number and the lookup fails or disagrees, just type the values above manually.

**Try this:** create the company again with the same GSTIN. **Expected:** it is refused (duplicate). This shows tenant uniqueness rules.

---

## Part 2 — Company Admin: first login, create staff users

### 2.1 First login
- [ ] Sign out. Sign in as `meera.admin@seed.example.com` with the temporary password.
- [ ] If forced, change the password to `Demo@12345`.
- **You should see:** the **ops console** (Dashboard, Ticket List, Escalation Queue, Approvals, Technicians, Franchisees, Vendors, Territory, Categories, Rules Config, Users & Roles, Credits...). The sidebar tile and tab title say **Acme Appliances**, with **ACM** as the badge. That is white-labelling.

### 2.2 Create the National Head
Open **Users & Roles** and click the add button (the dialog is titled **"Invite user"**). It has three sections: **Person** (full name, email, phone), **Access** (role) and **Territory**.

| Where | Paste |
|---|---|
| Person: Full name | Sanjay Kulkarni |
| Person: Email | sanjay.nh@seed.example.com |
| Person: Phone | +919000000002 |
| Access: Role | National Head |
| Territory | none (National Head is all-India) |

- [ ] Copy the temporary password to the tracker.

### 2.3 Create the Regional Head
| Field | Paste |
|---|---|
| Full name | Kavita Rao |
| Email | kavita.rh@seed.example.com |
| Role | Regional Head |
| Phone | +919000000003 |
| Regions | South (the region that contains Telangana) |
| Manager | Sanjay Kulkarni (if asked) |

- **You should see:** the states under the chosen region shown **read-only**. The Regional Head is responsible for all of them.

### 2.4 Create the Area Manager
| Field | Paste |
|---|---|
| Full name | Imran Sheikh |
| Email | imran.am@seed.example.com |
| Role | Area Manager |
| Phone | +919000000004 |
| States | Telangana |
| Manager | Kavita Rao (if asked) |

- **You should see:** his region is **derived** from Telangana, not chosen.

**Try these checks:**
- [ ] Create a second Area Manager with the same state (Telangana). **Expected:** refused. A state belongs to one Area Manager.
- [ ] Try to create a user with an empty phone. **Expected:** refused. Phone is mandatory for console users.
- [ ] Look through **Users & Roles** for any feature-access / permissions area and read which role holds which feature. Do not change anything yet.

---

## Part 3 — National Head: create the vendor

### 3.1 Sign in as Sanjay
- [ ] Sign out, sign in as `sanjay.nh@seed.example.com`, change password.

### 3.2 Check the rules page (read it, do not change)
- [ ] Open **Rules Config**. You should see the defaults: cancel penalties ₹300 / ₹500 / ₹800 / ₹1,200, monthly cap ₹5,000, bonus bands ₹200-₹800, silence 6 h, escalation 1 h before slot, force-close 12 h, vendor credit line ₹5,000.
- [ ] Find the **company UPI ID** field and set it to: `acmecompany@seeddemo`

### 3.3 Create the vendor
Open **Vendors** and click **Add vendor**. Sections, in order:

| Section | Label on screen | Paste |
|---|---|---|
| Statutory identity | GSTIN | 36AAGCC9012M1Z8 |
| Statutory identity | PAN | AAGCC9012M |
| Statutory identity | GST company status | Active |
| Company | Company name | Crestline Distributors |
| Company | Contact person | Rahul Verma |
| Company | Mobile number | +919000000005 |
| Brands | first brand | Meridian |
| Registered address | Building, street and area | 14, Industrial Estate, Balanagar |
| Registered address | City | Hyderabad |
| Registered address | State | Telangana |
| Registered address | Pincode | 500081 |
| Ticket intake | channels | tick **Manual** and **Excel** |
| Ticket intake | address search / location check | leave both ON |
| Portal access | Login email | crestline.vendor@seed.example.com |
| Credit | Credit limit (₹) | leave the default (₹5,000) |

- **You should see:** the vendor created with its login, and a temporary password for `crestline.vendor@seed.example.com`. Copy it to the tracker.
- **You should see:** the vendor's name became its **first brand** or you can add *Meridian* here. Staff-added brands are approved at once.

**Try this:** add a second brand `Sunview`. Then try an 21st brand later to see the limit (max 20 per vendor).

---

## Part 4 — Product catalogue

**Who:** Sanjay or Meera. **Where:** **Categories** (left menu).

### 4.1 Build the category tree
Create in this order (the tree is 3 levels here; max is 5):

1. Root: **Electronics**
2. Child of Electronics: **Television**
3. Child of Television: **Android TV** -> tick **"This is the last sub-category"**

- [ ] On *Android TV* add **spec template fields** (name only, values optional):
  `Screen size`, `Resolution`, `Panel type`
- **You should see:** only *Android TV* offers "Add product", because only the last level holds products.

**Try these checks:**
- [ ] Try to add a product directly under *Electronics*. **Expected:** not possible (not a last sub-category).
- [ ] Try to tick "last sub-category" on *Television* now that it has a child. **Expected:** refused. (It cannot be ticked while sub-categories exist.)

### 4.2 Add a product (model)
On *Android TV* -> **Add product**:

| Field | Paste |
|---|---|
| Name | Meridian 55" OLED Smart TV |
| Vendor | Crestline Distributors |
| Brand | Meridian |
| Service types | Installation + Demo (and Tech Visit, Service if you like) |
| Technician payout (₹) | 600 |
| Vendor price (₹) | 900 |
| Warranty (months) | 12 |
| Spec: Screen size | 55 inch |
| Spec: Resolution | 4K |
| Spec: Panel type | OLED |
| Photos | upload one if you have it (not mandatory) |

- **You should see:** after saving, a step **"Add serial numbers"** appears.

### 4.3 Load serials
- [ ] In the serial box paste (one per line):
```
MR55-0001
MR55-0002
MR55-0003
MR55-0004
MR55-0005
MR55-0006
```
- **You should see:** the model now shows a serial **count** of 6.
- [ ] Open the model -> Edit -> **Serial numbers** -> **Import spreadsheet** -> download the **template** to see the layout. Optional: fill and upload it to see the **dry run** report before confirming.

**Why it matters:** with serials loaded, intake **refuses** a serial that is not on this model. With zero serials the check is off.

### 4.4 Add a second product (for variety)
| Field | Paste |
|---|---|
| Name | Meridian 43" LED Smart TV |
| Vendor / Brand | Crestline Distributors / Meridian |
| Technician payout | 400 |
| Vendor price | 650 |
| Serials | leave empty (unchecked on purpose) |

Now you can compare a **checked** model vs an **unchecked** one at ticket intake.

---

## Part 5 — Franchisees: create SkyFix (no pincodes yet)

**Who:** Sanjay (National Head and above). **Where:** the Franchisees screen.

### 5.1 Look at HOME
- [ ] Open **Franchisees**. You should see **Acme Appliances (HOME)** already there. Try to delete or deactivate it. **Expected:** refused. It is permanent and internal.

### 5.2 Create SkyFix
| Field | Paste |
|---|---|
| Name | SkyFix Services |
| Code | SKYFIX |
| Kind | External |
| Contact name | Farhan Ali |
| Contact phone | +919000000006 |
| Contact email | farhan.skyfix@seed.example.com |
| First admin: Full name | Farhan Ali |
| First admin: Email | farhan.skyfix@seed.example.com |
| First admin: Phone | +919000000006 |
| Pincode ranges | **leave EMPTY for now** |

- **You should see:** SkyFix created with a **franchisee admin** login and a temporary password. Copy it to the tracker.
- **We leave pincodes empty on purpose.** In Part 10 you will give SkyFix its pincodes and watch the carve-out happen on real data.

### 5.3 Create the Facility Operator for HOME (needed for spare parts later)
**Who:** Meera (Admin) or Sanjay (National Head). Create a facility user for the **home** franchisee:

| Field | Paste |
|---|---|
| Name | Lakshmi Devi |
| Email | lakshmi.parts@seed.example.com |
| Role | Facility Operator |
| Phone | +919000000007 |

> Facility staff are created from the Franchisees screen / franchise portal, **never** on Users & roles.

---

## Part 6 — Technicians: add Ravi, Anita, Deepak

**Who:** Imran (Area Manager) or Sanjay. **Where:** Technicians -> Add.

All three are added to the **HOME** franchisee for now.

### 6.1 Ravi — covers only 500033
| Field | Paste |
|---|---|
| Full name | Ravi Kumar |
| Phone | +919100000001 |
| Type | Freelancer |
| Sub-categories | Television |
| Coverage pincodes | 500033 |
| Daily job cap | leave empty (no limit) |
| UPI ID / name | leave empty (the technician adds it in the app) |

### 6.2 Anita — covers 500033 AND 500081
| Field | Paste |
|---|---|
| Full name | Anita Desai |
| Phone | +919100000002 |
| Type | Freelancer |
| Sub-categories | Television |
| Coverage pincodes | 500033, 500081 |

### 6.3 Deepak — covers home-only pincodes
| Field | Paste |
|---|---|
| Full name | Deepak Reddy |
| Phone | +919100000003 |
| Type | Freelancer |
| Sub-categories | Television |
| Coverage pincodes | 500081, 500082, 500084 |

- **You should see for each:** the technician in the list, and a toast about the app link (without WhatsApp configured it says it failed with a copyable link; that is fine).
- **Territory check:** Imran may only assign pincodes inside **Telangana**. Try adding a technician with `600001` (Chennai) as Imran. **Expected:** 403 naming `600001`.

### 6.4 Try the invite mode as well
- [ ] **Invite technician** -> phone only: `+919100000004`.
- **You should see:** a copyable invite link (since WhatsApp is not configured). Open it later in Part 9 to see self-registration (name, photo, sub-categories, coverage, then OTP).

---

## Part 7 — Vendor: raise tickets

### 7.1 Sign in to the vendor portal
- [ ] Sign in as `crestline.vendor@seed.example.com` and change the password.
- **You should see:** the **vendor portal** (`/portal/*`) with **Raise a ticket, Import tickets, My products, My brands, My tickets, Credit, Users**. No ops menu. Try typing an ops URL like `/escalations` in the address bar. **Expected:** bounced back to the portal.

### 7.2 Create a vendor user
**Users -> Add**

| Field | Paste |
|---|---|
| Name | Asha Menon |
| Email | asha.clerk@seed.example.com |
| Phone | +919000000008 |

(Asha raises tickets but later sees **only her own**.)

### 7.3 Raise Ticket A (will go to Deepak, a plain happy path)
**Raise a ticket.** Start with the **Serial** field. Type `MR55-0001`, pick it from the dropdown. **Expected:** category, model and service type auto-fill.

| Field | Paste |
|---|---|
| Serial | MR55-0001 |
| Service type | Installation + Demo |
| Customer name | Priya Sharma |
| Customer phone | +919200000001 |
| Address | Flat 402, Lotus Residency, Madhapur |
| City / State | Hyderabad / Telangana |
| Pincode | 500081 |
| Expected date | tomorrow |
| Service level | 24 hours |
| Description | Wall mount 55-inch TV in the living room |

### 7.4 Raise Ticket B (will be accepted by Anita, then stays put in the carve-out)
| Field | Paste |
|---|---|
| Serial | MR55-0002 |
| Customer name | Vikram Singh |
| Customer phone | +919200000002 |
| Address | House 8-2-120, Road No 36, Jubilee Hills |
| City / State | Hyderabad / Telangana |
| Pincode | 500033 |
| Expected date | tomorrow |
| Description | Install and demo, customer wants a soundbar setup |

### 7.5 Raise Ticket C (stays unaccepted, gets re-stamped in the carve-out)
| Field | Paste |
|---|---|
| Serial | MR55-0003 |
| Customer name | Sunita Patel |
| Customer phone | +919200000003 |
| Address | Villa 21, Green Meadows, Jubilee Hills |
| City / State | Hyderabad / Telangana |
| Pincode | 500033 |
| Expected date | tomorrow |

**Try these refusals (each one teaches a rule):**
- [ ] Serial `ZZZ-9999` on the 55" TV. **Expected:** refused (not on this model's serial list).
- [ ] Pincode `999999`. **Expected:** refused (not in the master).
- [ ] Leave the serial empty. **Expected:** required.
- [ ] Use the **43" model** with a made-up serial `ANY-123`. **Expected:** accepted (model has no serials, so unchecked), unless that serial belongs to another product of the same vendor.

### 7.6 What happened
- Company credits: 1000 -> 970 (3 tickets x 10). Staff can see this on **Credits**. The vendor does not see the balance.
- Vendor credit line: 3 x ₹900 = ₹2,700 reserved. Open **Credit** in the portal. **Expected:** limit ₹5,000, owed ₹0, reserved ₹2,700, room ₹2,300.
- Each ticket got a **code** like `ACM-000001`, its **franchisee (HOME)**, both **prices stamped**, and a **rules snapshot**.
- [ ] Sign in as Asha. **Expected:** she sees **no** tickets from the others unless she raised them (raise one as Asha and compare).

---

## Part 8 — Customer picks a slot

The customer has no login. The slot page is reached from a link.

### 8.1 Get the link
- [ ] Sign in as Imran (Area Manager). Open **Tickets** -> Ticket A -> look for the **slot link** (copy link) in the detail page.
- [ ] Open that link in a private window. **Expected:** a branded page ("Acme Appliances") offering time windows allowed by the 24-hour service level.
- [ ] Pick a window for tomorrow, e.g. **10:00-12:00**.
- **You should see:** the ticket status change from **Slot Pending** to **New**, and it now appears in the technician pool.

Repeat for Ticket B and Ticket C (pick any window).

**Try these:**
- [ ] Open the **same link again** after booking. The old link should not overwrite a newer booking.
- [ ] On Ticket C, use **Change the time** from the console instead (needs a reason, no code). Notice the detail page does **not** claim "the customer confirmed", because a manager set it.
- [ ] Leave one extra ticket (raise Ticket D at 500082 as the vendor) with no slot. After the silence window (6 h) it asks for a phone call. Technicians can accept a **Slot Pending** job but cannot **Start** it (`NO_TIME_AGREED`).

---

## Part 9 — Technician app: accept, start, proof, complete

You need the mobile app running in Expo Go (or a dev build).

### 9.1 Sign in as Deepak
- [ ] Choose a language on first launch (try Hindi, then switch back to English from Profile -> Language).
- [ ] Phone: `+919100000003` -> request OTP.
- **You should see:** with WhatsApp unconfigured, the code appears on screen as `devCode` (and in the API log). Enter it.
- **You should see:** Home. If asked, fill the profile and **base location** (home pincode `500081`, or a pin). No base means travel pay would be ₹0 for that job.

### 9.2 Pool and accept
- [ ] Open the **Pool**. You see Ticket A (pincode 500081) **masked**: no customer name, phone or address.
- [ ] **Accept** it.
- **You should see:** the customer name, phone and address now unmasked, and the job under **Jobs**.
- **Race test:** sign in as Anita on a second device/emulator (`+919100000002`, her own `devCode`) and both tap Accept on the same job. **Expected:** one wins, the other sees "already taken". This is normal.

### 9.3 Anita accepts Ticket B
- [ ] As Anita, open the Pool and **accept Ticket B** (500033). Do **not** start it. We need it accepted-but-held for Part 10.
- Leave Ticket C unaccepted.

### 9.4 Run Ticket A end to end (as Deepak)
1. Open the job -> note the slot. (If the slot is tomorrow the Start button may be gated by time and location rules; if it blocks you for the location check, see "Troubleshooting".)
2. Tap **Start job**.
3. **Proof**: barcode, serial photo, product photos, live photo. Gallery uploads are not accepted.
4. **Review** -> submit. (AI verification screens are hidden; Review goes straight to the server.)
5. Tap **Complete**.
- **You should see:** the job awaiting the customer's confirmation.

> The **live photo** is checked for being taken at the customer's location. Ticket A has no map pin (unless you used the address search), so the check compares **pincodes**. If you cannot be on site, ask staff to turn the vendor's **Location check** off (Vendors -> Crestline -> edit) for testing, and notice that the distance is still measured and recorded.

### 9.5 Customer confirms
- [ ] Open the customer's **feedback/confirmation** link for Ticket A and confirm the work is done.
- **You should see:** status **Closed**. Then check three places:
  - **Technician -> Earnings (Deepak):** earned **₹600**, net ₹600.
  - **Vendor portal -> Credit:** owed ₹900, reserved ₹1,800 (B and C), room ₹2,300 unchanged (reservation became debt).
  - **Ticket detail -> events/timeline:** accepted, started, completed, closed, with times.

---

## Part 10 — Carve-out: give SkyFix its pincodes

**Current state:** Ravi covers 500033. Anita covers 500033 and 500081 and holds Ticket B (500033). Ticket C (500033) is New and held by nobody. All are HOME.

### 10.1 Run it
**Who:** Sanjay. **Franchisees -> SkyFix -> Pincodes.**

| Field | Paste |
|---|---|
| Pincode ranges | `500032-500034` |

- [ ] Click save. **The save first shows a preview (dry run).** Read it before confirming.

### 10.2 Expected preview and result

| Thing | What should happen | Why |
|---|---|---|
| Ravi (only 500033) | **Moves to SkyFix**, keeps coverage | all of his pincodes are inside the new range |
| Anita (500033 + 500081) | **Stays at HOME**, loses 500033, keeps 500081 | only some inside |
| Deepak (500081, 500082, 500084) | Untouched | none inside |
| Ticket C (New, nobody holds it) | **Re-stamped to SkyFix**; a `franchisee_changed` event appears | unassigned work moves |
| Ticket B (Anita already accepted) | **Stays with Anita and HOME** | assigned work never moves |
| Ticket A (closed) | Untouched | not at 500032-34 anyway |

- [ ] Confirm, then verify each row above on the Technicians list and each ticket's detail/timeline.

### 10.3 Pincode clash test
- [ ] Try to give **another** franchisee `500033`. **Expected:** 409 `FRANCHISEE_PINCODE_TAKEN` naming the clashing code and its owner (SkyFix).
- [ ] Try a range with nonexistent codes (e.g. `999990-999999`). **Expected:** they are skipped; only codes in the master are stored.

### 10.4 Who is offered Ticket C now?
- [ ] In the app, Ravi (now SkyFix) should see Ticket C in his pool. Deepak and Anita (HOME) should **not**.
- Ravi accepts it? Fine; leave it accepted-not-started for the escalation/cancel tests below.

### 10.5 Reverse (optional)
- [ ] Remove `500034` from SkyFix's ranges. Preview, confirm. **Expected:** that pincode returns to HOME by the same rules.

---

## Part 11 — Edge cases to try

Create fresh tickets for these (vendor portal), using unused serials `MR55-0004` to `MR55-0006` or the 43" model.

### 11.1 Technician cancels (penalty bands)
- [ ] A technician cancels a job **more than 4 h** before its slot: penalty **₹300**.
- [ ] Cancel **2-4 h** before: **₹500**. Cancel **<2 h** before (or after the slot opens): **₹800**.
- **How to test timing:** create tickets whose slot is soon, using **Change the time** (as manager) to put the slot at "in 3 hours", "in 1 hour", etc.
- **You should see:** the cancel screen shows the amount first; after cancelling, **Earnings** shows a negative penalty; the **Ledger** (Penalty & Bonus) shows a `penalty` row; cancellation under 4 h **escalates** the ticket.
- **Cap test:** repeat until the month total reaches **₹5,000**. Further cancels charge nothing more.

### 11.2 Escalation queue, assign, bonus
- [ ] Leave a ticket unaccepted until it is within 1 h of its slot (use Change the time). It becomes **Escalated** and leaves the pool.
- [ ] Open **Escalations** (as Imran). **Option 1:** **Assign** a technician directly. **Option 2:** **Bonus setup** -> choose ₹400 -> the job is **republished** to the pool with a 30-minute grace.
- **You should see:** the queue split into two lists (open windows soonest-first; closed windows newest-first), and the bell badge counting only the live half.

### 11.3 Reschedule
- [ ] **Technician (app):** open a job -> Reschedule -> pick a new window -> a one-time code goes to the **customer's** phone (dev: shown on screen as `devCode`). Enter it. Change the window and notice the code must be re-requested.
- [ ] **Manager (console):** Ticket -> Change the time -> new window + written reason (no code).
- **You should see:** no penalty either way; a `rescheduled` event carries both windows; no cap on how many times.
- [ ] Try to reschedule a ticket that is **Escalated with a technician** (customer said not done). **Expected:** refused `ESCALATION_IS_A_REFUSAL`.

### 11.4 No-show
- [ ] Let a job's slot pass with the technician never starting. The sweep flags a possible no-show but **charges nothing**. A manager confirms it (₹1,200 band).

### 11.5 Customer silent after completion -> force-close
- [ ] Complete a job but do **not** confirm as the customer. After `force_close_hours` (12 h by default; you can lower it temporarily in Rules Config) a notification appears.
- [ ] As Imran: ticket -> **Force close**. Fill: reason, justification, **at least one attachment**, and **what the technician is owed** (capped at the job's payout, ₹600).
- **You should see:** the job **Closed**, counted as completed for the technician, with the amount you entered in their ledger. **No speed allowance** is paid on force-closure.

### 11.6 Customer says "not done"
- [ ] On the customer's confirmation page choose the "not done" outcome. **Expected:** ticket goes to **Escalated with a technician**, a complaint not an appointment.

### 11.7 Daily cap
- [ ] Technician -> Profile -> Availability & bandwidth -> set the cap to **1**. Try to accept a second job for the **same slot date**. **Expected:** refused/hidden. A **Cancelled** job frees the slot; a **Closed** one still counts.

### 11.8 Reverse a penalty
- [ ] On a ticket with a penalty (Imran or above): **Reverse penalty** -> reason (e.g., "Customer asked us to reschedule"). **Expected:** a `reversal` row appears; the technician's month total drops; the cancellation still counts against them.

---

## Part 12 — Money: payouts, redeem, UPI, penalties, bonus

### 12.1 See the numbers
- [ ] Technician (Deepak) -> **Earnings**: earned, bonuses, penalties, net (`earned + bonuses - penalties`).
- [ ] Console -> **Ledger**: the **penalty pool** for the home franchisee (`penalties + speed penalties - reversals - bonuses - speed rewards`). Notice a **payout** is not in the pool.

### 12.2 Add a payout account (UPI), proved by a code
**Technician app -> Profile -> Payout account**
- [ ] Choose **type**. UPI ID: `deepak@seeddemo`. Name: `Deepak Reddy`.
- [ ] A one-time code goes to his registered number (dev: shown as `devCode`). Enter it. **Expected:** saved.
- [ ] Now try to change it. **Expected:** you can only **request a change**; the Area Manager gets notified, and approving needs no code.
- [ ] As Imran: Technicians -> Deepak -> approve the UPI change.

### 12.3 Redeem
**Technician app -> Redeem** (needs a balance; Deepak has ₹600 after Part 9).
1. Tap Redeem for the full balance. A **QR** (from `upi://pay?...`) appears. It fails in real UPI apps on purpose because of the `seeddemo` handle.
2. As the payer (Sanjay, because Deepak is a home technician and Sanjay is National Head): console -> **Redemptions** -> open the request -> **Mark as paid / claim** with a screenshot (UTR optional).
3. Back in the app: Deepak sees "payer says paid" -> taps **Confirm received**.
- **You should see:** status becomes **Paid** only after the technician confirms. Nobody else can mark it paid.
- [ ] Try the **Decline** path with another redemption (payer declines before claiming). The technician has **no cancel**.
- [ ] Ravi (SkyFix) redeeming should go to **Farhan (SkyFix admin)**, not to Sanjay.

---

## Part 13 — Credits and the vendor credit line

### 13.1 Company credits (Acme pays the platform)
- [ ] As Meera or Sanjay: **Credits**. You see the balance (1000 minus 10 per ticket raised).
- [ ] Click **Recharge**: amount `500`. A QR for the **platform** UPI ID (`acmeplatform@seeddemo`) appears. Enter UTR `UTR123456789012` and attach any screenshot.
- [ ] Sign in as **Super Admin** -> **Recharges** -> confirm it arrived. **Expected:** credits increase by 500. Only the Super Admin can add credits.
- **Floor test:** to see `OUT_OF_CREDITS`, lower the **floor** and free credits on the Super Admin's Rules page or burn tickets until the balance is below the floor. The vendor's New ticket page then says intake is paused **before** the form, and never shows the balance.

### 13.2 Vendor credit line (Crestline owes Acme)
- [ ] Vendor portal -> **Credit**: see limit, owed, reserved, room.
- **Reserve test:** raise tickets until room hits zero. **Expected:** the next one is refused `VENDOR_OUT_OF_CREDITS`. With limit ₹5,000 and ₹900 tickets, the 6th is refused.
- **Pay:** Credit -> Pay -> QR from the **company** UPI (`acmecompany@seeddemo`) -> UTR `UTR998877665544` + screenshot. As Meera or Sanjay: **Vendor Credit** -> confirm. **Expected:** owed goes down and room is restored.
- **Ask for more:** Credit -> Request more -> ask for ₹10,000. As Sanjay: **Vendor Credit** -> approve a smaller figure (₹8,000) and see the limit change.
- **Negative line:** close a ticket while room is already negative. **Expected:** closure still works (it never refuses); the **next** intake is what stops.

---

## Part 14 — Franchise portal: employee, travel, speed, spare parts

### 14.1 Sign in as the SkyFix admin
- [ ] `farhan.skyfix@seed.example.com`, change password.
- **You should see:** the **franchise portal** (`/franchise/*`). The tile still says **Acme Appliances**; the second line says SkyFix Services. Try an ops URL. **Expected:** bounced.
- **Isolation test:** as Farhan you see only SkyFix technicians (Ravi). Paste an id of a HOME technician. **Expected:** 404.
- **Read-only tickets:** Farhan sees SkyFix tickets read-only.

### 14.2 Add an employee
Franchise portal -> Technicians -> Add:

| Field | Paste |
|---|---|
| Full name | Meena Joshi |
| Phone | +919100000005 |
| Type | **Employee** |
| Sub-categories | Television |
| Coverage | 500032, 500034 |

- **Expected for an employee:** no per-job payout; **Redeem** is refused (`EMPLOYEE_CANNOT_REDEEM`); a **Statements** page lets Farhan download a monthly CSV.
- [ ] Try to change Ravi (a freelancer **with balance**) to Employee. **Expected:** 409 `TECHNICIAN_HAS_BALANCE`. With an open job: `TECHNICIAN_HAS_OPEN_JOBS`.

### 14.3 Travel allowance (off by default)
Franchise portal -> **Allowances / Travel rules**. For **Freelancer**:

| Field | Paste |
|---|---|
| Free distance (km) | 20 |
| Step (km) | 1 |
| Amount per step (₹) | 10 |
| Most per job (₹) | 200 |

- [ ] Try **Amount per step 10** with **Most per job 0**. **Expected:** refused (a rate needs a ceiling).
- **Test:** set Ravi's **base** far from a customer (pin on the OpenStreetMap map, e.g. 40 km away), accept a job, complete it. **Expected:** a `travel` ledger row after the customer confirms. Remember: the amount is **frozen at accept**; changing the rule later does not affect that job.
- Worked check: 60 km road distance -> (60-20) x ₹10 = ₹400 -> capped at **₹200**.

### 14.4 Speed allowance
Franchise portal -> **Speed rules**. Create a row for Freelancer x *Television*:

| Field | Paste |
|---|---|
| Reward within (hours) | 2 |
| Reward amount (₹) | 100 |
| Penalty after (hours) | 4 |
| Penalty amount (₹) | 100 |

- **Test:** finish a job in under 2 hours from the **later of accept and slot start** -> `speed_reward`. Finish after 4 hours -> `speed_penalty` (it counts toward the monthly cap). Time spent in **Awaiting Part** is subtracted.

### 14.5 Spare parts and Awaiting Part
Requires the **Facility Operator** from Part 5.3 (without one, the app hides "Need a spare part" and the API answers `NO_FACILITY`).
1. Technician (HOME, e.g. Deepak) starts a job, then taps **Need a spare part** -> pick from the list (or *Other* with a typed name, e.g. "Remote control").
2. The job becomes **Awaiting Part**. Try **Complete**. **Expected:** refused `PARTS_PENDING`.
3. Sign in as `lakshmi.parts@seed.example.com`: **Spare parts queue** -> **Approve** -> **New part issued** -> **Old part received back**.
4. **Expected:** when every request is issued/returned/rejected, the job returns to **In Progress**. Try rejecting an already-approved request (allowed, needs a reason).
5. The **speed clock** excluded the waiting time.

### 14.6 Move a technician between franchisees
**Who:** Meera or Sanjay. Technicians -> Anita -> **Move to franchisee** -> SkyFix.
- **Expected refused** while Anita has an open job, redeemable money, or an unsettled redemption.
- After settling, the move works; **no ticket, ledger or redemption row moves**; an audit row is written in transfers.

### 14.7 Hand an unassigned ticket to another franchisee
**Who:** Imran or above. On a ticket nobody holds -> **Hand over** -> SkyFix -> reason required.
- **Expected:** it flips to SkyFix even if its pincode belongs to HOME (`routing_override`). Only the **pincode-coverage** check is waived; certification, cap and availability still apply.

---

## Part 15 — Checklist: "did I see everything?"

**Roles logged in as:** [ ] Super Admin [ ] Admin [ ] National Head [ ] Regional Head [ ] Area Manager [ ] Technician (app) [ ] Vendor [ ] Vendor User [ ] Franchisee Admin [ ] Facility Operator [ ] Customer (links)

**Ticket statuses seen:** [ ] Slot Pending [ ] New [ ] Assigned [ ] In Progress [ ] Awaiting Part [ ] Escalated [ ] Closed [ ] Force-Closed [ ] Cancelled

**Rules seen refusing something:**
[ ] duplicate GSTIN [ ] second Area Manager on same state [ ] serial not on model [ ] bad pincode [ ] pincode outside Area Manager's territory [ ] pincode clash between franchisees [ ] home franchisee delete [ ] complete with parts pending [ ] reschedule an escalated-with-technician job [ ] employee redeem [ ] vendor out of credit [ ] company out of credits [ ] ops URL as vendor [ ] other franchisee's technician -> 404

**Money rows seen in the ledger:** [ ] payout [ ] penalty [ ] bonus [ ] reversal [ ] travel [ ] speed_reward [ ] speed_penalty

**Flows completed end to end:** [ ] ticket raised -> closed [ ] redemption paid [ ] company recharge [ ] vendor payment [ ] carve-out [ ] force-close

---

## Part 16 — Troubleshooting

| Symptom | Likely cause and fix |
|---|---|
| Code change not showing | A leftover API process on port 8000 is still serving old code. `netstat -ano | findstr :8000`, then `taskkill /PID <pid> /F`, restart. |
| No temporary password on screen | The server emailed it instead (email is configured and `ACS_EMAIL_ALLOWLIST` is empty), or the API was not restarted after you edited `.env`. See Part 0.2. For a user already created, use "Reissue password" in Users & Roles. |
| No OTP on screen | `WHATSAPP_*` is set in `.env`, so a real send is attempted. Empty it, or read the code from the API log. |
| "Pincode not found" | It is missing or inactive in Geography. Pick another from the master, or add it (Super Admin -> Geography). |
| Technician cannot start (location) | The live photo is checked against the customer's location. For testing, turn **Location check** off on the vendor. The distance is still recorded. |
| Cannot see a ticket in the pool | Check all of: slot is set (status `New`), technician is online, franchisee matches, pincode is covered, subcategory is certified, daily cap is not full. |
| `OUT_OF_CREDITS` / `VENDOR_OUT_OF_CREDITS` | Company credits or vendor credit line is exhausted. Recharge (Part 13). |
| Redemption QR "fails" in a real UPI app | By design: `seeddemo` is not a real handle. |
| Something looks like another company's data | It is not. Switch company only through the session switcher; ids from other tenants return 404. |

### Starting over
To redo the walkthrough without touching any script, create a second company (for example "Acme Appliances 2", with a different GSTIN such as `36AABCB2345G1Z6` / PAN `AABCB2345G`, a different email and phone) and repeat the Parts with new emails and phones. Each company's data is separate. Companies can be deactivated from Super Admin -> Companies.
Never run anything in this guide against the production database (`RelianceProdDB`).

---

### A note on exact screen wording
Field labels and menu names above come from the code and the project docs, but I could not click through the live UI while writing this. If a label differs slightly on your screen (for example "Pincodes" vs "Pincode ranges"), use the closest match; the **values** to paste stay the same. If any value is rejected, the validation message names the reason, and Part 16 covers the common ones.
