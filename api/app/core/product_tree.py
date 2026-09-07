"""Shape rules for the product tree, shared by every slice that reads it.

The catalogue is a recursive `product_nodes` table with `product_models` hanging
off it as the priced leaf. Two limits on that shape have to agree in several
places at once, so they are declared here rather than in whichever slice needed
them first.

`app.core.rules` is the sibling module for the *numbers* a node carries; this one
is about its *structure*.
"""

#: How many levels below a root a node may sit. Six levels in total (0..5).
#:
#: A cap rather than "as deep as you like" for three reasons, none of them
#: storage: `ancestor_ids` is an array every eligibility test scans, the console
#: has to indent the tree on a screen of finite width, and a catalogue that has
#: run away to eleven levels is a data-entry accident nobody notices until a
#: vendor cannot find their own product. Raising it is a one-line change plus a
#: CHECK; there is no algorithm here that degrades.
MAX_NODE_DEPTH = 5

#: The level a technician certifies on: a MAIN sub-category — *Television*
#: under *Electronics* — and no other.
#:
#: Coverage is still descendant-aware, so one tick on *Television* covers every
#: node beneath it, at any depth, including ones created later. Narrowing the
#: CHOICE while keeping that reach is the whole point:
#:
#:  * A root would mean "send them anything, for ever". A real thing a small
#:    company might want, but one accidental tick away and nothing on screen
#:    says how much it covers.
#:  * A deeper node goes stale in silence. Certify on the last sub-category
#:    today, add a sibling next month, and that technician quietly stops being
#:    offered half the work with nothing to show for it.
#:  * A main sub-category is also how the skill is actually described. Somebody
#:    is a TV person, not a "32 inch OLED" person.
#:
#: It can never leave a job uncoverable, and that is structural rather than
#: careful: `leaf_below_root` forbids a root from holding products, so every
#: model sits at depth >= 1 and every ticket's `node_path_ids` therefore
#: contains exactly one node at this depth.
CERTIFY_DEPTH = 1

#: Entries in one product's `parameters` array. Bounded for the same reason
#: `product_models.image_urls` is bounded at five: the list is always read whole
#: with its row, so an unbounded one is an unbounded response.
#:
#: Only a PRODUCT carries specs. A category does not, and deliberately: fields
#: describe a thing you can install, and a category is a way of finding one.
#: There is therefore nothing above a product to inherit from — the first cut of
#: this feature had categories carrying them too, and the merge that implied.
MAX_PARAMETERS = 20

#: Where a product sits between "a vendor asked for it" and "somebody can be
#: sent to install it".
#:
#: A vendor may add products to their own book, but not price them — what a
#: technician earns is never shown to a vendor, and what a vendor is charged is
#: a term between them and the company rather than something they set for
#: themselves. So a submitted product waits, unpriced, until a National Head or
#: an Admin types both figures and approves it.
#:
#: These live here rather than in `masters` because `tickets._resolve_product`
#: tests them too, and slices never import each other (hard rule 4) — the same
#: reason `CERTIFY_DEPTH` is here.
#:
#: Lowercase on the wire, matching every other CHECK-constrained vocabulary in
#: this schema (`notifications.kind`, `ticket_events.kind`, `ledger_entries.kind`).
#: `tickets.status` is the one capitalised exception and is not the model to
#: follow; the console maps these to a display label the way `kinds.ts` already
#: does for notification kinds.
PENDING = "pending"
APPROVED = "approved"
REJECTED = "rejected"

#: Interpolated into the CHECK on `product_models.approval_status`, so the
#: constraint and the code cannot drift — the same trick `MAX_NODE_DEPTH` and
#: `MAX_PARAMETERS` already play.
APPROVAL_STATES = (PENDING, APPROVED, REJECTED)

#: What the catalogue is being READ for — `masters.service.get_tree`'s `purpose`.
#:
#:     catalogue   every approval state, empty branches KEPT. Maintenance
#:                 screens: the ops Categories page, a vendor's own product
#:                 page, and the subtree every write echoes back.
#:     intake      approved products only, empty branches pruned. The ticket
#:                 form's pickers.
#:
#: ONE parameter rather than two booleans, because the two settings are not
#: independent choices — they are one question, "am I filling this in or picking
#: from it?" A caller that could ask for approved-only while keeping empty
#: branches would get a picker full of dead ends, which is exactly what the
#: pruning exists to prevent.
CATALOGUE = "catalogue"
INTAKE = "intake"
TREE_PURPOSES = (CATALOGUE, INTAKE)
