"""Build the client-facing explanatory document.

    deck/.venv/Scripts/python.exe build/build_document.py
    → dist/Reliance GreenTech - How It Works.docx

Where the decks are screenshot-led and low-text — you talk over them — this is
the opposite: something a client reads alone and comes away understanding the
whole product. So it leads with plain language and follows ONE job the whole way
through, using the real figures the demo system holds, and puts the detail
underneath rather than in place of the explanation.

Screenshots come from the same `out/shots.json` the decks use, so a re-capture
updates the document too.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from docx import Document  # noqa: E402

import docx_kit as K  # noqa: E402

DECK_ROOT = Path(__file__).resolve().parent.parent
REPO_ROOT = DECK_ROOT.parent
SHOTS_JSON = DECK_ROOT / "out" / "shots.json"
DIST = DECK_ROOT / "dist"
MARK = REPO_ROOT / "mobileapp" / "assets" / "icon.png"

missing: list[str] = []


def load_shots() -> dict:
    shots = json.loads(SHOTS_JSON.read_text(encoding="utf8"))
    return {shot["id"]: shot for shot in shots}


class Doc:
    """Thin wrapper so the narrative below reads as prose, not as API calls."""

    def __init__(self, shots):
        self.document = K.configure(Document())
        self.shots = shots

    def path(self, shot_id: str) -> Path:
        shot = self.shots.get(shot_id)
        if shot is None:
            missing.append(shot_id)
            return Path("/nonexistent")
        return DECK_ROOT / shot["file"]

    # Passthroughs
    def h1(self, text, **kw): K.h1(self.document, text, **kw)
    def h2(self, text): K.h2(self.document, text)
    def h3(self, text): K.h3(self.document, text)
    def p(self, text, **kw): K.p(self.document, text, **kw)
    def bullet(self, text): K.bullet(self.document, text)
    def callout(self, text): K.callout(self.document, text)
    def table(self, headers, rows, **kw): K.table(self.document, headers, rows, **kw)
    def page_break(self): K.page_break(self.document)

    def figure(self, shot_id, caption, **kw):
        path = self.path(shot_id)
        if path.exists():
            K.figure(self.document, path, caption, **kw)

    def figure_row(self, shot_ids, captions, **kw):
        paths = [self.path(sid) for sid in shot_ids]
        K.figure_row(self.document, paths, captions, **kw)


def build(shots) -> Document:
    d = Doc(shots)
    doc = d.document

    # ── Cover ────────────────────────────────────────────────────────────────
    K.title_block(
        doc,
        eyebrow="Installation & Demo platform",
        title="How it works",
        subtitle="A complete walkthrough of the platform — every screen, "
                 "every rule, and what happens when things go wrong.",
        mark=MARK,
        date=K.today(),
    )
    d.p(
        "This document follows one installation job from the moment it is raised to the "
        "moment the technician is paid, then explains what the system does when the job "
        "does not go to plan. Every screenshot is the real product, running on live data.",
        colour=K.MUTED,
    )
    d.callout(
        "**About the screenshots.** They show a demonstration company called "
        "**Meridian Appliances**. The platform is white-labelled: in your deployment "
        "every screen, email and WhatsApp message carries **your** company name and mark "
        "instead. Nothing here is hard-coded to a brand."
    )

    # ── 1. What this is ──────────────────────────────────────────────────────
    d.h1("1. What this is")
    d.p(
        "When a customer buys an appliance, somebody has to go to their home and install it. "
        "Today that is arranged over phone calls and spreadsheets, and nobody can prove "
        "afterwards what was actually done. This platform replaces that."
    )
    d.p(
        "It does three things. It **schedules the visit around the customer** instead of "
        "guessing a date. It **puts the job in front of the right technicians** — the ones "
        "who are certified for that product, cover that pincode, and still have room that "
        "day — and lets the first one accept it. And it **captures proof on site**, "
        "geo-verified, so that months later you can answer exactly who attended, when, and "
        "what they installed."
    )
    d.h2("What it is not")
    d.p(
        "It is not a call centre tool and it is not a CRM. The customer never logs in; they "
        "tap two links. Your staff do not raise jobs — the vendors whose products you install "
        "do that themselves, from their own restricted portal. Your people supervise, "
        "intervene when something is going wrong, and settle the money."
    )

    # ── 2. The five parties ──────────────────────────────────────────────────
    d.h1("2. The five people it serves")
    d.p("Five parties touch a job, and each sees only what they need to.")
    d.table(
        ["Who", "What they do", "How they use it"],
        [
            ["**Vendor**", "Raises the ticket. The brand whose product is being installed.",
             "Their own restricted web portal"],
            ["**Customer**", "Chooses the time, and closes the job at the end.",
             "Two WhatsApp links — no login, no app"],
            ["**Technician**", "Accepts the job, attends, captures proof.",
             "Mobile app, signs in with a one-time code"],
            ["**Your ops team**", "Watches, intervenes, assigns, settles.",
             "The console"],
            ["**Your admin**", "Sets the rules, the catalogue and who covers where.",
             "The console"],
        ],
        widths=[3.2, 8.0, 4.8],
    )
    d.callout(
        "**Only a vendor raises a ticket.** This is deliberate. The vendor holds the invoice, "
        "so they know the serial number, the model and the customer's details at the moment "
        "of sale. Your staff can see and work every ticket, but they no longer type them in — "
        "which removes the commonest source of wrong data at the very start of the job."
    )

    # ── 3. The journey ───────────────────────────────────────────────────────
    d.h1("3. Follow one job, start to finish")
    d.p(
        "The worked example below is a real job on the demonstration system: a **1.5-tonne "
        "5-star inverter air conditioner** for a customer in Bengaluru. Follow it through "
        "seven steps."
    )
    d.table(
        ["Step", "Who acts", "The job becomes"],
        [
            ["1  Ticket raised", "Vendor", "Slot Pending"],
            ["2  Time chosen", "Customer", "New — visible to technicians"],
            ["3  Offered, masked", "System", "New"],
            ["4  Accepted", "Technician", "Assigned"],
            ["5  Proof captured", "Technician", "In Progress"],
            ["6  Work confirmed", "Customer", "Closed"],
            ["7  Payout recorded", "System", "Closed, and paid"],
        ],
        widths=[4.6, 3.4, 8.0],
    )

    # 3.1
    d.h2("Step 1 — The vendor raises the ticket")
    d.p(
        "The vendor signs in to their own portal and fills one form: the product, the "
        "customer, the address and the date they were promised. They never see your other "
        "vendors, your technicians, or anybody else's jobs."
    )
    d.figure("portal-new-ticket", "The vendor's ticket form. The left rail is all they can reach.")
    d.h3("Two fields that matter more than they look")
    d.p(
        "**The serial number is mandatory, and it leads the form.** It is the serial the "
        "vendor **expects** to find, read off the invoice. On site the technician photographs "
        "the serial actually fitted. A mismatch between those two numbers is how you catch a "
        "unit that was swapped, and it is why the field cannot be optional."
    )
    d.p(
        "It is also the fastest way to fill the form in. Typing the first few characters "
        "searches your catalogue and offers matching units in a dropdown; picking one fills "
        "in the category, the model and the service type by itself. A serial you have not "
        "loaded yet is still accepted — the boxes below are simply chosen by hand."
    )
    d.p(
        "**The address is searched, not typed.** Picking a result off the map stores the "
        "actual coordinates of the customer's door. That single fact upgrades the proof check "
        "later from *\"was the photo taken in roughly the right postal area?\"* to *\"was the "
        "photo taken within 1 km of the door?\"* — a postal code can span kilometres."
    )
    d.callout(
        "**The job is priced the moment it is raised.** Two amounts are stamped onto the "
        "ticket: what the technician will earn, and what the vendor is charged. They are "
        "frozen at this point, so re-pricing your catalogue next month can never change what "
        "an already-accepted job was worth. **Neither party ever sees the other's figure** — "
        "that is enforced on the server, not hidden in the interface."
    )

    # 3.2
    d.h2("Step 2 — The customer chooses the time")
    d.p(
        "The customer gets a WhatsApp message with a link. They tap it and see the page below "
        "— no app, no login, no password. They pick a two-hour window and that is the "
        "appointment."
    )
    d.figure_row(
        ["customer-slot", "customer-slot-confirmed"],
        ["Choosing a window", "Confirmed"],
        height_cm=10.5,
    )
    d.p(
        "The windows offered are not arbitrary. They are generated from the service level on "
        "the ticket — a 24-hour commitment produces different options from a 48-hour one — so "
        "the customer can only choose a time you can actually meet."
    )
    d.callout(
        "**This happens before any technician sees the job.** It is the single most important "
        "sequencing decision in the product. The technician is never asked to propose a time "
        "and then chase the customer for agreement; they are offered a fixed appointment the "
        "customer has already confirmed. That is why the acceptance step later is instant."
    )
    d.p(
        "If the customer does not answer, the ticket does not sit there silently. After a set "
        "number of hours it is raised for a human to chase — because a customer who never "
        "replied is a problem somebody has to ring, not a state to leave alone."
    )

    # 3.3
    d.h2("Step 3 — The job reaches the pool, masked")
    d.p(
        "Now the job becomes visible — but only to technicians who pass three tests at once: "
        "they are **certified** for that product category, they **cover** that pincode, and "
        "they are **under their daily job cap** for the day the work actually happens."
    )
    d.figure("app-pool", "The technician's pool. Only jobs they are eligible for appear here.")
    d.p(
        "When a technician opens one, they see the product, the area, the fixed slot and what "
        "they will earn. They do **not** see the customer's name, phone number or street "
        "address."
    )
    d.figure("app-offer", "The masked offer. Customer details are hidden until the job is theirs.")
    d.callout(
        "**Why mask it?** A job in the pool is visible to every eligible technician in the "
        "area. Showing the customer's name and mobile number to a dozen people who will never "
        "attend is a privacy leak with no upside. The details unlock the moment somebody "
        "takes responsibility for the job."
    )

    # 3.4
    d.h2("Step 4 — A technician accepts")
    d.p(
        "Acceptance is **first come, first served**. Two technicians tapping at the same "
        "instant is handled properly: one gets the job, the other is told it has gone. Losing "
        "that race is a normal outcome, not an error."
    )
    d.figure_row(
        ["app-accept-sheet", "app-job-detail"],
        ["Confirming the commitment", "Accepted — details unlocked"],
        height_cm=10.0,
    )
    d.p(
        "Note what is visible behind the sheet on the left: the customer's name and number "
        "are still masked at the moment of committing. They unlock on the right, once the job "
        "is theirs.",
        colour=K.MUTED,
    )
    d.p(
        "The moment it is accepted, three things happen: the customer's details unlock for "
        "that technician alone, the customer gets a WhatsApp naming the technician and their "
        "mobile number, and the job appears on the technician's home screen for the day."
    )
    d.p(
        "**Shortly before the slot, both sides are reminded separately** — the technician gets "
        "a push notification, the customer gets a WhatsApp. These are two different settings, "
        "because warning your technicians earlier than your customers is a policy you may "
        "reasonably want."
    )

    # 3.5
    d.h2("Step 5 — On site: four pieces of proof")
    d.p(
        "This is the part that makes the record defensible. Before a technician can finish, "
        "they capture four things with the camera in the app."
    )
    d.figure_row(
        ["proto-proof-barcode", "proto-proof-serial", "proto-proof-photos", "proto-proof-live"],
        ["1. Barcode", "2. Serial number", "3. The installation", "4. Geo-tagged live shot"],
        height_cm=8.2,
    )
    d.table(
        ["Proof", "What it settles"],
        [
            ["**Barcode**", "Which unit this is, machine-read rather than typed."],
            ["**Serial number**", "Compared against the serial the vendor expected at intake."],
            ["**Product photos**", "That the unit is installed, from two or three angles."],
            ["**Live site photo**", "That the technician was physically at the address."],
        ],
        widths=[4.2, 11.8],
    )
    d.h3("Gallery uploads are never accepted")
    d.p(
        "Every one of these must come from the camera, in the moment. A photo chosen from the "
        "phone's gallery could have been taken anywhere, at any time, by anyone — which would "
        "make the whole exercise decorative."
    )
    d.h3("How the location check actually works")
    d.p(
        "The live photo carries the phone's coordinates. The server compares them with the "
        "job's own location and refuses a photo taken too far away — currently **1 km**, which "
        "you set."
    )
    d.p(
        "There is a second setting for sites that genuinely cannot get a GPS fix — a basement "
        "plant room, a steel-clad warehouse, a rural dead spot. Switching the gate off for "
        "such a vendor does **not** make the system blind: the distance is still measured and "
        "still written to the job's permanent record, marked as recorded-but-not-enforced. A "
        "photo taken four kilometres away becomes a fact somebody can act on, rather than a "
        "technician stuck at a customer's door unable to start."
    )

    # 3.6
    d.h2("Step 6 — Only the customer closes the job")
    d.p(
        "The technician marks the work done. That does **not** close the job. The customer "
        "receives a second WhatsApp link and confirms the work themselves."
    )
    d.figure("customer-feedback", "The customer's confirmation. Nothing closes without this.")
    d.callout(
        "**A technician cannot mark their own work complete.** The person who did the work is "
        "not the person who signs it off. That one rule is what makes a closed job in this "
        "system mean something."
    )

    # 3.7
    d.h2("Step 7 — The technician is paid")
    d.p(
        "The customer's confirmation is what releases the money. At that instant the "
        "technician's payout — the figure stamped on the ticket back in step 1 — is written "
        "into the ledger and appears in their app."
    )
    d.figure("app-earnings", "The technician's own ledger: payouts, bonuses and penalties.")
    d.p(
        "Their earnings screen shows all three kinds of entry, and a net figure that is "
        "**earned + bonuses − penalties**. It can be negative, and it is shown honestly if it "
        "is."
    )

    # ── 4. When it doesn't go to plan ────────────────────────────────────────
    d.h1("4. When it does not go to plan")
    d.p(
        "The seven steps above are the happy path. Most of the value of the system is in what "
        "it does the rest of the time — and in every case the answer is designed so that no "
        "job can quietly disappear."
    )

    d.h2("Nobody accepts the job")
    d.p(
        "If a job sits in the pool and the slot is approaching, it is **escalated** — pulled "
        "out of the pool and put in front of a manager, who has two options: assign a "
        "technician by hand, or attach a bonus which re-publishes it to the pool as a more "
        "attractive job."
    )
    d.figure("console-escalations", "The escalation queue. The badge on the rail counts the live half.")
    d.p(
        "**The queue is two lists running in opposite directions**, and this is worth "
        "understanding. Jobs whose window is still open sort **soonest first** — the one "
        "closest to being missed is the one to act on. Jobs whose slot has already passed sort "
        "**newest first** — because what just went wrong is what somebody can still ring a "
        "customer about."
    )
    d.figure_row(
        ["console-assign", "console-bonus"],
        ["Assigning by hand", "Funding a bonus"],
        height_cm=7.5,
    )

    d.h2("The technician cancels")
    d.p(
        "Cancelling costs money, and the amount depends on how late it is. The technician sees "
        "the exact figure **before** they confirm — the system never charges a penalty the "
        "person did not know about."
    )
    d.figure("proto-cancel", "The cancellation screen. The band and the amount are shown up front.")
    d.table(
        ["When they cancel", "Penalty"],
        [
            ["More than 4 hours before the slot", "**₹300**"],
            ["Between 2 and 4 hours before", "**₹500**"],
            ["Less than 2 hours before", "**₹800**"],
            ["No-show — they simply did not attend", "**₹1,200**"],
        ],
        widths=[10.0, 6.0],
    )
    d.p(
        "There is a cap of **₹5,000 per technician per calendar month**, so a bad month cannot "
        "become an unpayable debt. Every one of these five numbers is a setting you control."
    )
    d.callout(
        "**Why is a no-show the most expensive, rather than a very late cancellation?** "
        "Because cancelling — even ten minutes before — means they told somebody, and the "
        "customer could be called. The gap between ₹800 and ₹1,200 is precisely what speaking "
        "up is worth. A no-show is also never charged automatically: a dead phone and a "
        "deliberate no-show look identical to software, so a manager confirms it."
    )

    d.h2("The time no longer suits the customer")
    d.p(
        "A confirmed appointment can be moved, and **only with the customer's agreement**. "
        "There are two doors onto it:"
    )
    d.bullet(
        "**The technician**, from the app — the system sends a one-time code to the "
        "**customer's** phone, the customer reads it back, and the slot moves. The code is "
        "issued for one specific window, so choosing a different time means asking again."
    )
    d.bullet(
        "**A manager**, from the console — no code, but a written reason is required. They "
        "have just been on the phone to the customer."
    )
    d.p(
        "**Nothing is charged either way.** That is the whole difference from a cancellation: "
        "the customer agreed. All three other parties are told — the customer gets a WhatsApp "
        "naming the old time and the new, the technician gets a push if a manager moved their "
        "day, and the vendor is notified, because they asked for the visit."
    )

    d.h2("The customer never replies")
    d.p(
        "This is the one gap the design leaves, and it is handled deliberately. If a customer "
        "simply says nothing after the work is done, the job is flagged for a manager after a "
        "set number of hours. **The system does not close it.**"
    )
    d.figure("console-force-close", "Force-closure. A reason, a justification and an attachment are all required.")
    d.p(
        "A manager closes it by hand, with a reason, a written justification and at least one "
        "attachment, all kept for audit. They also enter what the technician should be paid, "
        "capped at the job's value — because a technician who travelled and found nobody home "
        "is owed something, one whose customer never confirmed a time is owed nothing, and "
        "only the person closing it knows which."
    )
    d.callout(
        "**Why not close it automatically after a week of silence?** Because that would record "
        "a customer approval that nobody gave. The whole point of step 6 is that a closed job "
        "means the customer said the work was done. A system that manufactures that sentence "
        "on a timer has thrown away the only thing that made closure meaningful."
    )
    d.p(
        "A force-closed job **counts as completed for the technician**. They did the work; "
        "what failed was the customer answering, which was never theirs to fix."
    )

    # ── 5. Money ─────────────────────────────────────────────────────────────
    d.h1("5. The money")
    d.p(
        "Three kinds of money move through the system, and they are deliberately kept apart."
    )
    d.table(
        ["Kind", "Direction", "Where it comes from"],
        [
            ["**Payout**", "You pay the technician", "The company, for work done"],
            ["**Penalty**", "The technician pays in", "Cancellations and no-shows"],
            ["**Bonus**", "Paid out to attract a technician", "The penalty pool"],
        ],
        widths=[3.4, 6.0, 6.6],
    )
    d.p(
        "**The penalty pool is a closed circuit.** Penalties fund it; bonuses spend it. Its "
        "balance is simply penalties minus bonuses. A payout is not part of that circuit at "
        "all — it is the company paying for work, from outside the pool."
    )
    d.figure("console-ledger", "The penalty and bonus pool. Every entry names its job and its reason.")
    d.p(
        "In the demonstration data above there is one penalty: **₹500 charged to Nikhil Rao** "
        "for cancelling job MA-INST-0013 between two and four hours before the slot. It names "
        "the technician, the job and the band — so the technician can see exactly why, and so "
        "can you, months later."
    )

    # ── 6. What you control ──────────────────────────────────────────────────
    d.h1("6. What you control")
    d.p(
        "Almost every number in this document is a setting, not a constant. They live on one "
        "screen."
    )
    d.figure("console-rules", "Rules configuration. Every figure quoted in this document is set here.")
    d.table(
        ["Setting", "Default", "What it decides"],
        [
            ["Cancellation penalties", "₹300 / ₹500 / ₹800 / ₹1,200", "What each band costs"],
            ["Monthly penalty cap", "₹5,000", "The most one technician can be charged in a month"],
            ["Bonus amounts", "₹200 – ₹800", "The incentives a manager can attach"],
            ["Escalation trigger", "4 hours", "How close to the slot an unaccepted job escalates"],
            ["Slot confirmation timeout", "6 hours", "How long a customer has before you chase"],
            ["Technician reminder", "60 minutes", "How long before the slot they are pushed"],
            ["Customer notice", "60 minutes", "How long before the slot they are messaged"],
            ["Force-close wait", "12 hours", "Silence after which a manager is alerted"],
            ["Location radius", "1 km", "How far from the door a live photo may be taken"],
        ],
        widths=[5.0, 4.4, 6.6],
    )
    d.callout(
        "**A rule can also belong to a product category.** A penalty that is right for a 32-inch "
        "television is wrong for a rooftop solar installation. Any category can override any of "
        "these, and a job remembers the rules that applied on the day it was raised — so "
        "changing a rule tomorrow never restates what somebody already accepted."
    )

    d.h2("Your catalogue")
    d.p(
        "Products live in a tree of your own making — for example *Electronics → Television → "
        "Android TV* — and only the last level holds actual models. Each model carries its two "
        "prices and up to five photographs."
    )
    d.figure("console-categories", "The product master. Only the last sub-category holds products.")
    d.p(
        "A technician is certified on a **main sub-category** — they are a *television* person, "
        "not a *32-inch OLED* person — and that certification covers everything beneath it, "
        "including models you add next year. It is a deliberate middle ground: certifying on "
        "the whole root would mean \"send them anything, for ever\", while certifying on a "
        "single model means a technician quietly stops being offered work every time you add "
        "a product."
    )

    # ── 7. Who sees what ─────────────────────────────────────────────────────
    d.h1("7. Who sees what")
    d.p(
        "Visibility follows geography. Nobody assigns their own territory — a senior does it "
        "for them."
    )
    d.figure("console-territory", "Territory: region, state, district and pincode.")
    d.table(
        ["Role", "Covers", "Can do"],
        [
            ["**Admin**", "The whole company", "Everything, including rules and users"],
            ["**National Head**", "The whole country", "Everything operational, plus vendors"],
            ["**Regional Head**", "Chosen regions", "Supervise and assign in those regions"],
            ["**Area Manager**", "Chosen states", "Assign, escalate, force-close, confirm no-shows"],
            ["**Technician**", "Their own pincodes", "Their own jobs, in the app"],
            ["**Vendor**", "Their own tickets", "Raise and watch, nothing else"],
        ],
        widths=[3.6, 4.6, 7.8],
    )
    d.p(
        "The console narrows itself accordingly. An area manager signing in does not see a "
        "greyed-out menu of things they cannot do — those entries are simply not there."
    )
    d.figure("console-am-dashboard", "The same console, signed in as an area manager. Compare the rail.")
    d.p(
        "An area manager may only assign pincodes inside their own states, and the system "
        "refuses — naming the offending pincodes — if they try to reach outside. This is "
        "enforced on the server, so it holds no matter how the request was made."
    )

    d.h2("Your people")
    d.p(
        "Console users sign in with an email and password, or with Google. Nobody types a "
        "password when an account is created: the system generates one and emails it. "
        "Technicians have no password at all — their **phone is the credential**, and they "
        "sign in with a one-time code. There is nothing for them to forget."
    )
    d.figure_row(
        ["console-users", "console-technicians"],
        ["Console users and roles", "The technician master"],
        height_cm=6.5,
    )

    # ── 8. Brand and data ────────────────────────────────────────────────────
    d.h1("8. Your brand, and your data")
    d.h2("The product carries your name, not ours")
    d.p(
        "Every surface that knows which company it is acting for shows **that company's** name "
        "and mark: the console, the technician app after sign-in, the customer's booking and "
        "confirmation pages, and every email and WhatsApp message. There is no product name "
        "written into any screen."
    )
    d.figure("customer-slot", "The customer's page carries the company's own name and mark.")

    d.h2("One company's data is never reachable from another's")
    d.p(
        "The platform hosts many companies at once, and separation is structural rather than a "
        "matter of filtering a list correctly. Every record belongs to a company, every query "
        "is scoped to the signed-in user's company, and a request naming a record belonging to "
        "somebody else is answered as **not found** — not as *forbidden*, which would itself "
        "confirm the record exists."
    )
    d.p(
        "That includes your catalogue, your technicians, your vendors, your rules and your "
        "jobs. Two companies may start from the same starter catalogue, but they never share "
        "a row."
    )

    d.h2("Nothing is closed without a trail")
    d.p(
        "A job's history is kept as a sequence of events — raised, slot confirmed, accepted, "
        "reminded, started, completed, closed, and every intervention in between — rather than "
        "as a single status that gets overwritten. The status tells you where a job is now; "
        "the trail tells you how it got there, and it is written in the same breath as the "
        "change it describes, so the two can never disagree."
    )
    d.figure("console-ticket-detail", "A job's full timeline. This is the audit record.")

    # ── 9. Honest gaps ───────────────────────────────────────────────────────
    d.h1("9. What is not built yet")
    d.p(
        "Two things are designed and visible in the product's architecture but not switched on, "
        "and it is better to say so plainly than to let them be discovered later."
    )
    d.h3("Automated photo verification")
    d.p(
        "The intended next step is for the serial number and product photographs to be checked "
        "automatically — a match closes the job, a mismatch goes to a manager for review, an "
        "unreadable photo asks the technician to retake it before they leave the site. The "
        "screens for this exist and the flow is designed, but nothing runs the check yet, so "
        "the screens are hidden rather than shown empty."
    )
    d.figure_row(
        ["proto-verifying", "proto-ai-result", "proto-ai-mismatch"],
        ["Checking", "Verified", "Sent for review"],
        height_cm=8.0,
    )
    d.p(
        "Until it is switched on, proof is captured and stored exactly as described in step 5 "
        "— the serial mismatch is still visible to your staff, it is simply a person who "
        "notices it rather than a model.", colour=K.MUTED,
    )
    d.h3("Technician cash-out")
    d.p(
        "Earnings are calculated and shown correctly, and a technician can save a UPI ID, but "
        "the platform does not yet move the money — settlement happens through your existing "
        "process."
    )

    # ── 10. Appendix ─────────────────────────────────────────────────────────
    d.h1("10. Appendix — every screen")
    d.p(
        "For completeness, every screen in the platform, grouped by who uses it. The pages "
        "above cover the important ones in context; this is the full inventory.",
        colour=K.MUTED,
    )

    order = [
        ("Ops console", "For your operations team"),
        ("Ops console — area manager", "For the area manager"),
        ("Vendor portal", "For the vendor"),
        ("Technician app", "For the technician"),
        ("Customer touchpoints", "For the customer"),
        ("Technician app — design reference",
         "The approved designs for the remaining technician screens. These are the "
         "signed-off reference, not the running app, so the product names and job "
         "numbers in them are placeholders."),
    ]

    by_section: dict[str, list] = {}
    for shot in shots.values():
        by_section.setdefault(shot["section"], []).append(shot)

    for section, blurb in order:
        rows = by_section.get(section)
        if not rows:
            continue
        d.h2(section)
        d.p(blurb, colour=K.MUTED, space_after=4)
        for shot in rows:
            path = DECK_ROOT / shot["file"]
            if not path.exists():
                continue
            caption = shot["title"] + (f" — {shot['sub']}" if shot.get("sub") else "")
            K.figure(doc, path, caption,
                     width_cm=K.TEXT_WIDTH_CM if shot["kind"] == "console" else 6.4)

    K.footer_text(doc, f"Installation & Demo platform — how it works · {K.today()}")
    return doc


def main() -> int:
    if not SHOTS_JSON.exists():
        print("no out/shots.json — run `npm run capture` first")
        return 1

    shots = load_shots()
    DIST.mkdir(exist_ok=True)

    document = build(shots)
    path = DIST / "Reliance GreenTech - How It Works.docx"
    document.save(path)

    paragraphs = len(document.paragraphs)
    print(f"{len(shots)} screenshot(s) available")
    print(f"  {path.name}: {paragraphs} paragraphs, {len(document.inline_shapes)} images")

    if missing:
        print(f"\n{len(set(missing))} screenshot(s) referenced but not captured:")
        for item in sorted(set(missing)):
            print(f"  - {item}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
