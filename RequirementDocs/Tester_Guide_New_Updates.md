# What's New — Tester Guide

**Build date:** 29 October 2026
**Who this is for:** Testers of the vendor portal, the company console and the technician app.

This guide lists everything that changed in this round, what to try, and what you should see.
Please report anything that behaves differently from the "Expected" line, with a screenshot and
the steps you followed.

---

## Quick summary

| # | What changed | Who sees it |
|---|--------------|-------------|
| 1 | Filter tickets and dashboard by vendor | Company staff |
| 2 | High-priority flag on tickets (blinking badge) | Vendors, company staff |
| 3 | Brand dropdown when raising a ticket | Vendors |
| 4 | New order of fields on the raise-ticket form | Vendors |
| 5 | New service type: Uninstall | Vendors, company staff |
| 6 | Alternate phone number for the customer | Vendors, company staff |
| 7 | Online / offline purchase details | Vendors, company staff |
| 8 | Bulk upload of products from a spreadsheet | Vendors, company staff |
| 9 | Reminder to technicians before the job window ends | Technicians |
| 10 | Pincode now updates the city correctly | Vendors |

---

## 1. Filter by vendor

**Where:** Tickets list and the main dashboard (company staff).

**Try this**
1. Open the Tickets list and choose a vendor in the vendor filter.
2. Do the same on the dashboard.
3. Copy the page address, open it in a new tab.

**Expected**
- Only that vendor's tickets / figures are shown.
- The new tab opens with the same vendor already selected (the filter is saved in the page link, so you can bookmark or share it).
- Clearing the filter brings back everything.

---

## 2. High-priority tickets

**Where:** Raise-ticket form, ticket list, ticket page, Tickets menu.

**Try this**
1. As a vendor, raise a ticket with the **High priority** option ticked. Raise another without it.
2. Look at the ticket list as company staff.
3. Open the high-priority ticket.
4. Filter and sort the list by priority.
5. Have a technician accept the high-priority ticket.

**Expected**
- High-priority tickets show a **blinking** badge on the list and on the ticket page.
- High-priority tickets appear **at the top** of the list.
- Staff see a blinking count next to **Tickets** in the menu.
- Once every high-priority ticket has been picked up by a technician, the count disappears by itself.
- Priority is only a visual marker and filter. It does **not** change who gets the job or any deadlines.

---

## 3 & 4. Raise-ticket form: Brand dropdown and new field order

**Where:** Vendor portal → Raise ticket (manual entry).

**New order of fields:** Vendor → Serial number → Brand → Category → Sub-category → Product → Service type.

**Try this**
1. Open the form. Pick a Brand.
2. Check that Category and Product choices only show items for that brand.
3. Start over, type a known serial number first.
4. Try changing the brand after the serial has filled the form.

**Expected**
- The Brand list contains only the vendor's **approved** brands.
- Choosing a brand narrows the Category and Product choices.
- Typing a serial number still fills in the rest of the form automatically, **including the Brand**, and the brand never disagrees with the product.

> Note: Serial number deliberately stays near the top (it was not moved to the end). This was agreed with the client, because auto-fill from the serial is the fastest way to raise a ticket.

---

## 5. New service type: Uninstall

**Where:** Raise-ticket form and product setup screen.

**Try this**
1. Raise a ticket and open the Service type list.
2. Open product setup for a product and look at its service types.

**Expected**
- **Uninstall** appears alongside Installation, Tech Visit and Service in **both** places.
- A ticket raised as Uninstall is saved and shows "Uninstall" as its type.

---

## 6. Alternate phone number

**Where:** Raise-ticket form; ticket page.

**Try this**
1. Enter the customer's main number and an alternate number.
2. Save and open the ticket.
3. Try a wrong alternate number (too short, letters).
4. Leave it empty.

**Expected**
- Alternate number is **optional**.
- An invalid number is rejected with the same message style as the main number.
- A valid one is shown on the ticket page.

---

## 7. Online / offline purchase details

**Where:** Raise-ticket form; ticket page; admin screen for the platform list.

**Try this**
1. Choose **Offline** — you should be asked for the **shop name** (free text).
2. Choose **Online** — you should get a **dropdown of shopping platforms**.
3. Pick **Others** and type a platform that is not in the list. Save the ticket.
4. Raise another ticket (ideally as a different vendor) and open the platform dropdown.
5. Open a ticket as different roles (vendor, staff).

**Expected**
- The list is already filled with well-known shopping platforms.
- The platform you typed under "Others" is **saved automatically** and now appears in the dropdown for everyone — no admin step.
- The details appear on the ticket page, **read-only**, for every role.
- Admins can manage the platform list from its admin screen.

---

## 8. Bulk upload of products

**Where:** Staff product-catalogue screen **and** the vendor's own product page.

**Try this**
1. Click the bulk-upload button and upload a product spreadsheet.
2. Review the preview that appears **before** anything is saved.
3. Confirm the upload.
4. Try a spreadsheet with mistakes (missing columns, wrong values).
5. Do this once as company staff and once as a vendor.

**Expected**
- A preview shows exactly what will be added or changed, and any problem rows, before saving.
- Nothing is saved until you confirm.
- **Staff upload:** products are added as **approved**.
- **Vendor upload:** products are added as **pending and unpriced** — they need approval and a price before they can be used.

---

## 9. Technician reminder before the job window ends

**Where:** Technician mobile app (push notification).

**Try this**
1. Have a technician accept a job and start it, but do **not** upload the serial-number photo.
2. Wait until 30 minutes before the end of the job's time window.
3. Repeat, but this time upload the serial photo before that point.
4. Reschedule a job to a later time and check the reminder again.

**Expected**
- The technician receives **one** reminder 30 minutes before the window closes **if the serial photo is still missing**.
- No reminder if the photo is already uploaded.
- It does not repeat for the same job. If the job is rescheduled, the reminder is set up again for the new time.
- Reminder comes as a **push notification only**. A WhatsApp version is not included yet (waiting on WhatsApp's template approval).

---

## 10. Pincode and city fix

**Where:** Address section of the raise-ticket form.

**Try this**
1. Enter a pincode and let the city fill in.
2. Change the pincode to a different one.
3. Type a city by hand (or pick one from address search), then change the pincode again.

**Expected**
- After changing the pincode, the city **updates to match** the new pincode.
- A city you typed or picked yourself is respected and not overwritten wrongly.

---

## Also worth knowing

- **Address search box:** the address look-up box on the raise-ticket form behaves as before — it is offered or hidden depending on each vendor's existing setting. Please confirm it still works for a vendor that has it switched on, and is absent for one that has it off.
- **A vendor's ticket not showing on the dashboard:** if you cannot see a ticket on the company dashboard, first check that your login belongs to the **same company** as the vendor. This was investigated and is an account setup matter, not a fault.

## Not in this build

The larger items (accounts/invoices and statements, location tree for coverage, per-technician rules, live technician location, bank accounts, spare-part delivery address, post-office dropdown) are **not part of this release**. Please don't log these as missing.

## How to report an issue

Please include: the screen name, your role (vendor / staff / technician), the steps you took, what you expected, what happened, and a screenshot.
