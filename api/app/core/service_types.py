"""What a technician can be sent to do with a product model.

A model declares which of these it supports, and that is what a ticket raised
against it may ask for. A washing machine gets installed and demonstrated; a
water purifier mostly gets serviced; a television that is already installed gets
a tech visit when something is wrong with it.

    Installation + Demo   Fit the unit and show the customer how to use it.
                          The core job this product was built around.
    Tech Visit            Attend an installed unit to diagnose or check it.
    Service               Scheduled or requested maintenance on an installed unit.

Lives in core rather than the masters slice because the jobs slice will need the
same vocabulary to type a ticket, and hard rule 4 forbids one slice importing
another's. The ticket side is deliberately NOT wired yet — the model records
what it supports first, and ticket intake reads it later.
"""

#: The closed set. Membership is a CHECK constraint in the migration, not just a
#: schema-layer rule: unlike the icon catalogue — which changes with a deploy and
#: would make every addition a migration — these are the shapes of work the
#: business does, and they do not change on a release cadence.
SERVICE_TYPES = ("Installation + Demo", "Tech Visit", "Service")

#: What a model supports unless somebody says otherwise. This product exists for
#: installation and demo work (see the root AGENTS.md), so it is the honest
#: baseline for a model nobody has configured — not a guess, the default case.
DEFAULT_SERVICE_TYPES = ("Installation + Demo",)

#: One line each, shown beside the option so the choice is not a guess.
SERVICE_TYPE_DESCRIPTION = {
    "Installation + Demo": "Fit the unit and show the customer how to use it.",
    "Tech Visit": "Attend an installed unit to diagnose or check it.",
    "Service": "Maintenance on a unit that is already installed.",
}
