"""The Product Overview deck, slide by slide.

This is a hand-written storyboard rather than a flag on each screenshot, because
a slide is not always one screen: step 7 is four phones at once, and step 5 is a
console and a phone side by side. Keeping the narrative here means the capture
code never has to know anything about slide layout.

Each entry names shot ids. A slide whose shots were not captured is SKIPPED with
a warning rather than failing the build — so the deck can be produced from the
prototype alone while production credentials are still being arranged.

The order follows the real flow: a vendor raises a ticket, the customer picks a
slot, a technician accepts it masked, proves the work on site, and only the
customer closes it. Everything after that is the branches — escalation, money,
consent, audit.
"""

TITLE = {
    "kind": "title",
    "title": "Installation & Demo,\nend to end",
    "subtitle": "From the vendor's ticket to the customer's confirmation —\n"
                "with proof at every step.",
    "footer": "Product overview",
}

STORY = [
    {
        "kind": "section",
        "eyebrow": "The flow",
        "title": "One job, five parties,\nno step taken on trust",
    },
    {
        "kind": "console", "shot": "portal-new-ticket",
        "title": "Only a vendor raises a ticket",
        "sub": "Company staff work tickets — they no longer create them",
    },
    {
        "kind": "phone", "shot": "customer-slot",
        "title": "The customer picks the slot",
        "sub": "Before any technician has seen the job",
    },
    {
        "kind": "split", "console": "console-tickets", "phone": "app-pool",
        "title": "The job reaches the pool",
        "sub": "Offered only to technicians with the skill, the pincode and the capacity",
    },
    {
        # From the RUNNING app, not the prototype: the masking on this screen is
        # the server's own (`mask_name`), so it is worth showing for real.
        "kind": "phone", "shot": "app-offer",
        "title": "Masked until accepted",
        "sub": "Name, phone and address stay hidden — the slot does not",
    },
    {
        "kind": "phone", "shot": "app-accept-sheet",
        "title": "First accept wins",
        "sub": "Losing the race is a normal outcome, not an error",
    },
    {
        "kind": "grid",
        "shots": ["proto-proof-barcode", "proto-proof-serial",
                  "proto-proof-photos", "proto-proof-live"],
        "captions": ["Barcode", "Serial", "Installation", "Geo-tagged live"],
        "title": "Four proofs, on site",
        "sub": "Gallery uploads are never accepted",
    },
    {
        "kind": "phone", "shot": "proto-proof-live",
        "title": "Verified by distance, not trust",
        "sub": "Measured against the ticket's own coordinates — and recorded even where it is not enforced",
    },
    {
        "kind": "phone", "shot": "customer-feedback",
        "title": "Only the customer closes it",
        "sub": "A technician cannot mark their own work done",
    },
    {
        "kind": "section",
        "eyebrow": "When it does not go to plan",
        "title": "The branches that\nactually cost money",
    },
    {
        "kind": "console", "shot": "console-escalations",
        "title": "What is about to be missed",
        "sub": "Open windows soonest-first; missed ones newest-first",
    },
    {
        "kind": "split", "console": "console-ledger", "phone": "proto-cancel",
        "title": "Cancelling costs money",
        "sub": "Banded by lateness, capped per month, and shown before they commit",
    },
    {
        "kind": "console", "shot": "console-assign",
        "title": "A manager can step in",
        "sub": "Assign by hand, or fund a bonus that re-publishes it",
    },
    # The third option, and the only one that ever empties the queue's missed
    # half. It had no slide at all while the deck said a manager had two.
    {
        "kind": "console", "shot": "console-reschedule",
        "title": "Or move it, with the customer",
        "sub": "Nothing is charged — that is the whole difference from cancelling",
    },
    {
        "kind": "console", "shot": "console-force-close",
        "title": "Silence is not approval",
        "sub": "Nothing auto-closes; a manager force-closes with a reason and an attachment",
    },
    {
        "kind": "phone", "shot": "app-earnings",
        "title": "The technician gets paid",
        "sub": "Payouts, bonuses and penalties in one ledger",
    },
    # Step 8. The deck stopped at "credited" and the document's chapter 9 was
    # still telling clients the platform did not move money at all.
    {
        "kind": "split", "console": "console-redemption", "phone": "app-redeem",
        "title": "And takes the money out",
        "sub": "The payer scans a UPI code; only the technician confirms it arrived",
    },
    {
        "kind": "section",
        "eyebrow": "How it is built",
        "title": "Multi-tenant,\nwhite-labelled, audited",
    },
    {
        "kind": "console", "shot": "console-rules",
        "title": "Every penalty is a setting",
        "sub": "Per company, and overridable per product category",
    },
    {
        "kind": "console", "shot": "console-dashboard",
        "title": "Counted, never estimated",
        "sub": "Scoped to the territory the manager actually covers",
    },
    # Act 3 promised three things and evidenced none of them: "configurable" is
    # not multi-tenant, and role scoping is not one company being unreachable
    # from another. These are the screens that actually show the claim.
    {
        "kind": "console", "shot": "super-companies",
        "title": "Many companies, kept apart",
        "sub": "A guessed id from another company answers not found, never forbidden",
    },
    {
        "kind": "console", "shot": "super-geography",
        "title": "One geography, shared",
        "sub": "India is the same for every company — the territory above is drawn from it",
    },
    {
        "kind": "console", "shot": "console-ticket-detail",
        "title": "Every step leaves a record",
        "sub": "The timeline is the audit trail, not the status column",
    },
]

CLOSING = {
    "kind": "closing",
    "title": "Every step leaves a record",
    "lines": [
        "The brand on every screen is the client's, not ours.",
        "One company's data is never reachable from another's.",
        "A ticket's history lives in its events, not its status column.",
    ],
    "footer": "Product overview",
}

# The catalogue's section order. Anything captured under a section not named
# here still appears, after these.
SECTION_ORDER = [
    "Ops console",
    "Ops console — area manager",
    "Vendor portal",
    "Technician app",
    "Technician app — design reference",
    "Customer touchpoints",
    # Last on purpose: it belongs to the platform rather than to the company
    # reading the catalogue, so it is context rather than something they use.
    "Platform console",
]

SECTION_EYEBROWS = {
    "Ops console": "For the company",
    "Ops console — area manager": "For the area manager",
    "Vendor portal": "For the vendor",
    "Technician app": "For the technician",
    "Technician app — design reference": "For the technician",
    "Customer touchpoints": "For the customer",
    "Platform console": "For the platform",
}
