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

The full record, including what the 96 unplaceable codes turned out to be, is in
`RequirementDocs/Pin Code corrections.md` and the matching `.xlsx`.

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
#: rather than dropped.
#:
#: The other 96 are a different animal and are rejected, not recovered: every one
#: checked is an **NDC** — a Nodal Delivery Centre, the bulk-mail hub a division
#: runs — and India Post's own directory records those with `District: NA` and
#: `State: NA`. That is exactly why the vendor's lookup wrote `#N/A`. They are
#: real post office codes but not places anybody lives, so they are not service
#: coverage. See the `.xlsx` record for the full list and the evidence.
RECOVERED: dict[str, tuple[str, str]] = {
    "222101": ("UTTAR PRADESH", "Only on #N/A rows; India Post: Uttar Pradesh."),
    "390008": ("GUJARAT", "Only on #N/A rows; India Post: Gujarat."),
    "605012": ("PUDUCHERRY", "Only on #N/A rows; India Post: Puducherry."),
    "804454": ("BIHAR", "Only on #N/A rows; India Post: Bihar."),
}

#: pincode -> (district name, why).
#:
#: The four above were recovered with a STATE but no district, because the rows
#: that carry them have `NA` in the district column too. That left them in the
#: master under a state with no district beneath them — real, correctly placed,
#: and invisible to anything walking state -> district -> pincode.
#:
#: Districts checked against India Post on 2026-08-22. All four already exist in
#: the master, so this only adds the missing link. `Pondicherry` is India Post's
#: spelling for the district inside the union territory our sheet calls
#: `PUDUCHERRY`, and it is what the master already holds.
DISTRICT_RECOVERED: dict[str, tuple[str, str]] = {
    "222101": ("JAUNPUR", "District was NA on every row; India Post: Jaunpur."),
    "390008": ("VADODARA", "District was NA on every row; India Post: Vadodara."),
    "605012": ("PONDICHERRY", "District was NA on every row; India Post: Pondicherry."),
    "804454": ("PATNA", "District was NA on every row; India Post: Patna."),
}

#: pincode -> ((district, ...), why). REPLACES what the sheet says, unlike
#: `DISTRICT_RECOVERED`, which only fills a blank.
#:
#: The sheet's district column is not merely incomplete, it is sometimes wrong,
#: and a wrong district is worse than a missing one: an area manager who covers
#: that district is handed work hundreds of kilometres outside it.
#:
#: Found by sampling 600 pincodes against India Post. Be careful reading a
#: disagreement as an error — nearly every one turned out to be OUR data being
#: NEWER: India Post's published directory still uses pre-2016 Telangana and
#: pre-2022 Andhra districts, so Peddapalli reads as Karimnagar and Nandyal as
#: Kurnool there. Only a pincode whose offices sit in a genuinely unrelated
#: district belongs below.
DISTRICT_OVERRIDES: dict[str, tuple[tuple[str, ...], str]] = {
    "494446": (
        ("BIJAPUR",),
        "Sheet says Raipur on all 18 rows. All 9 India Post offices "
        "(Bhopalpatnam S.O and its branches) are in Bijapur, ~300km away.",
    ),
}

#: pincode -> (state, (district, ...), why).
#:
#: Pincodes India Post HAS and the vendor sheet does not mention at all — not on
#: a bad row, not on any row. The sheet is a post office export and a stale one:
#: it carries 165,627 rows against India Post's 157,126 offices, and it still
#: misses live delivery offices.
#:
#: Found by sampling the Government of India open-data directory
#: (`api.data.gov.in`, resource 6176ee09-…, 155,570 post office records) and
#: diffing it against the master, then confirming each hit against India Post
#: directly. Every one below is a DELIVERY office — a real address somebody
#: receives post at, which is exactly what this master is for.
#:
#: **This list is not complete.** The shared demo API key returns ten records a
#: call and rate-limits hard, so the diff was run on a sample, not the whole
#: directory. The sample rate suggests roughly 90 such codes nationally. To
#: close the gap properly, register a free data.gov.in key and re-run
#: `scripts/sweep_ogd.py` over the full 155,570 records.
MISSING_PINCODES: dict[str, tuple[str, tuple[str, ...], str]] = {
    "335705": (
        "RAJASTHAN",
        ("GANGANAGAR",),
        "Absent from the sheet entirely. India Post: 3 F D M B.O and Sardargarh "
        "S.O, both Delivery, Ganganagar.",
    ),
    "393155": (
        "GUJARAT",
        ("NARMADA", "BHARUCH"),
        "Absent from the sheet entirely. India Post: 6 offices, all Delivery — "
        "Bhilvashi, Gora and Indravarna in Narmada, Gora Colony in Bharuch.",
    ),
    "845102": (
        "BIHAR",
        ("PASHCHIM CHAMPARAN",),
        "Absent from the sheet entirely. India Post: Gaunaha S.O, Delivery, "
        "West Champaran — the master spells it Pashchim Champaran.",
    ),
    "364485": (
        "GUJARAT",
        ("RAJKOT",),
        "Absent from the sheet entirely. India Post: 5 offices, all Delivery — "
        "Amarnagar S.O, Devla, Khirasara and others in Rajkot.",
    ),
    "396424": (
        "GUJARAT",
        ("NAVSARI",),
        "Absent from the sheet entirely. India Post: Kabilpore S.O, Delivery, "
        "Navsari.",
    ),
    "396440": (
        "GUJARAT",
        ("NAVSARI",),
        "Absent from the sheet entirely. India Post: Karadi S.O and Machhad "
        "B.O, both Delivery, Navsari.",
    ),
}

#: Codes the OGD directory lists that are NOT added, and why — so a later sweep
#: does not keep re-finding them and wondering.
#:
#: `110050` is Safdarjung Sorting Delivery Office. The OGD dump gives it a
#: district, but India Post's live lookup returns no record, and a sorting hub
#: is not an address anybody receives post at — the same call as the 96 NDCs.
NOT_SERVICE_COVERAGE: dict[str, str] = {
    "110050": "Safdarjung Sorting Delivery Office — a sorting hub, not a delivery area.",
}
