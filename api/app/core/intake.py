"""How a vendor's tickets reach us — §4 of the requirement document.

    "Vendors typically do not have a CRM capable of sending API requests. The
     system must support three intake channels: API (for vendors with CRM /
     system integration capability), Excel upload, Manual entry."

The three split by WHO has to be given something, and that is what decides
which of them a vendor can be marked with today:

    Manual   our ops staff, in our app.  Needs nothing from the vendor —
             the Manual Entry screen already exists.
    Excel    our ops staff, in our app.  Needs nothing from the vendor —
             the Bulk Upload screen already exists.
    API      the VENDOR'S system pushes to us. Needs an endpoint to push to
             and an issued key to authenticate with. Neither exists.

Lives in core rather than the vendors slice because ticket intake will need the
same vocabulary when the jobs slice lands, and hard rule 4 forbids one slice
importing another's.
"""

#: The closed set. Three, and the requirement document is done with it — which
#: is why membership is a CHECK constraint here and not just a schema-layer
#: check like `icon_key`. The icon catalogue changes with a deploy; this does not.
INTAKE_CHANNELS = ("API", "Excel", "Manual")

#: What a vendor may actually be given today.
#:
#: "API" is deliberately absent. Marking a vendor Excel or Manual is true the
#: moment it is saved — ops can start uploading or keying that vendor's tickets
#: immediately. Marking one API would be a promise: there is nothing for their
#: system to call, and no credential for it to call with.
#:
#: Move it across when the push endpoint and key issuance land. Nothing else in
#: this module changes, and the schema layer picks the difference up for free.
AVAILABLE_INTAKE_CHANNELS = ("Excel", "Manual")

#: Manual, because it is the one that is always true: somebody can always type
#: a ticket in. A vendor nobody has configured is not an API integration.
DEFAULT_INTAKE_CHANNELS = ("Manual",)

#: Why an unavailable channel cannot be picked. Returned by the API so the
#: console renders one reason rather than inventing its own, the same way
#: `GET /masters/icons` keeps the icon catalogue in one place.
UNAVAILABLE_REASON = {
    "API": (
        "Coming soon — we'll issue this vendor an API key once the endpoint "
        "their system pushes to is built."
    ),
}

#: One line per channel, shown under the option so the choice is not a guess.
#: Approved prototype copy — do not reword.
CHANNEL_DESCRIPTION = {
    "API": "Tickets are pushed from the vendor's own system.",
    "Excel": "Ops upload the vendor's spreadsheet.",
    "Manual": "Ops key each ticket in by hand.",
}


def is_available(channel: str) -> bool:
    return channel in AVAILABLE_INTAKE_CHANNELS
