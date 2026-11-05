"""How a vendor's tickets reach us — §4 of the requirement document.

    "Vendors typically do not have a CRM capable of sending API requests. The
     system must support three intake channels: API (for vendors with CRM /
     system integration capability), Excel upload, Manual entry."

The three split by WHO has to be given something, and that is what decides
which of them a vendor can be marked with today:

    Manual   the vendor, in their own portal. Needs nothing from us —
             the vendor keys the ticket in themselves.
    Excel    the vendor, in their own portal. Needs nothing from us —
             the vendor uploads their own spreadsheet.
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

#: What a vendor may actually be given. All three are real now:
#:
#:   Manual / Excel  need nothing from us beyond the vendor's own portal.
#:   API             the vendor's CRM pushes to `/integration/tickets` with a
#:                   credential an Admin issues on the console's API Credentials
#:                   screen (`features/api_credentials`). The credential only works
#:                   while this channel is ticked on the vendor.
AVAILABLE_INTAKE_CHANNELS = ("API", "Excel", "Manual")

#: Manual, because it is the one that is always true: somebody can always type
#: a ticket in. A vendor nobody has configured is not an API integration.
DEFAULT_INTAKE_CHANNELS = ("Manual",)

#: Why an unavailable channel cannot be picked. Empty while every channel is
#: available; kept so the console still renders one reason from the API rather
#: than inventing its own the day a channel is withdrawn.
UNAVAILABLE_REASON: dict[str, str] = {}

#: One line per channel, shown under the option so the choice is not a guess.
#: Approved prototype copy — do not reword.
CHANNEL_DESCRIPTION = {
    "API": "Tickets are pushed from the vendor's own system.",
    "Excel": "The vendor uploads their spreadsheet in the vendor portal.",
    "Manual": "The vendor keys each ticket in by hand in the vendor portal.",
}


def is_available(channel: str) -> bool:
    return channel in AVAILABLE_INTAKE_CHANNELS
