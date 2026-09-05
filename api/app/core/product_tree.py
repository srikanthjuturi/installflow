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
