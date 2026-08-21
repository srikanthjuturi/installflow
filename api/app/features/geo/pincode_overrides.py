"""Researched corrections applied on top of whatever the spreadsheet says.

`Reliance Green Tech Pin Code.xlsx` lists 52 pincodes under two different states
and leaves 100 more with no state at all (the rows where the source lookup
failed and wrote `#N/A`). Every one of those was checked against India Post's
official directory (`api.postalpincode.in`) on 2026-08-21, and the outcome lives
here rather than in the spreadsheet, for three reasons:

  * the spreadsheet stays the source, unedited, so a fresh export can replace it;
  * the importer REPORTS which overrides fired, so a correction can never
    diverge from the file silently;
  * if a later upload already has these right, each override becomes a no-op and
    is reported as `agreed` instead of `applied`.

The full record, including the 96 codes India Post does not recognise either,
is in `RequirementDocs/Pin Code corrections.md`.

The importer's own rule for a conflict NOT listed here is majority-of-rows, and
it rejects an exact tie by name rather than guessing. These entries exist
precisely because that rule was not good enough: four were exact ties, and two
had a majority that India Post contradicts.
"""

#: pincode -> (state name, why). Applied after parsing, before writing.
#:
#: State names are matched case-insensitively against the sheet's own
#: vocabulary, so they read the way the file spells them.
STATE_OVERRIDES: dict[str, tuple[str, str]] = {
    # --- the sheet's own majority was WRONG -------------------------------
    "781131": (
        "ASSAM",
        "Sheet says Meghalaya 3-1. All four post offices are in Kamrup, Assam. "
        "781xxx is the Guwahati circle; Meghalaya is 793xxx/794xxx.",
    ),
    "607403": (
        "TAMIL NADU",
        "Sheet says Puducherry 2-1. India Post has 2 offices in Tamil Nadu "
        "(Villupuram, Cuddalore) against 1 in Puducherry.",
    ),
    # --- the sheet was exactly tied and could not decide ------------------
    "781029": (
        "ASSAM",
        "Sheet tied 1-1 with Meghalaya. Both India Post offices are in Kamrup, Assam.",
    ),
    "605107": (
        "TAMIL NADU",
        "Sheet tied 4-4 with Puducherry. India Post breaks it 5-3 for Tamil Nadu.",
    ),
    "605014": (
        "PUDUCHERRY",
        "Sheet tied 2-2 and India Post is also tied 2-2. Broken by the sub post "
        "office, Pondicherry University, which the branch offices hang off.",
    ),
    "605106": (
        "PUDUCHERRY",
        "Sheet tied 5-5 and India Post is also tied 5-5. Broken by the sub post "
        "office, Nettapakkam.",
    ),
}

#: Pincodes the sheet carries ONLY on an `#N/A` row, recovered from India Post
#: rather than dropped. The other 96 orphans are not pincodes at all — India
#: Post does not recognise them either, which is why the source lookup failed —
#: and they are rejected with that reason.
RECOVERED: dict[str, tuple[str, str]] = {
    "222101": ("UTTAR PRADESH", "Only on #N/A rows; India Post: Uttar Pradesh."),
    "390008": ("GUJARAT", "Only on #N/A rows; India Post: Gujarat."),
    "605012": ("PUDUCHERRY", "Only on #N/A rows; India Post: Puducherry."),
    "804454": ("BIHAR", "Only on #N/A rows; India Post: Bihar."),
}
