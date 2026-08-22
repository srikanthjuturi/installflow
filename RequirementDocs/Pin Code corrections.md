# Pin Code corrections

What was changed when `Reliance Green Tech Pin Code.xlsx` was loaded into the geography master,
and why. Nothing in the spreadsheet itself was edited — the file remains the source, and every
correction lives in code where the importer reports it.

Source of truth: **India Post**, via `https://api.postalpincode.in/pincode/<code>` and office-name
lookups.

| Round | Date | What was done |
|---|---|---|
| 1 | 2026-08-21 | 52 two-state conflicts and 100 stateless codes checked. 6 states corrected, 4 recovered, 96 left out |
| 2 | 2026-08-22 | The 4 recovered codes had **no district**; all 4 fixed. The 96 re-checked and **identified**. A coverage audit against India Post added **6 missing pincodes** and corrected **1 wrong district** |

> **Round 1 got one thing wrong.** It recorded the 96 leftover codes as "not pincodes — India Post
> does not recognise them". They *are* real pincodes. Section 4 says what they actually are.

**`Pin Code corrections.xlsx` beside this file carries the same record with the working shown** —
eight sheets, and it is the one to open if you want to check a decision rather than read about it:

| Sheet | What is in it |
|---|---|
| Read me | Why the source sheet is never edited, and where corrections live instead |
| Summary | Counts before and after, and what was deliberately *not* changed |
| **Corrections** | All 21 changes, one row each: what the sheet said, what India Post said, before → after, and why |
| **Evidence — source sheet** | Every one of the 43 vendor rows behind those changes, with its row number |
| **Evidence — India Post** | Every one of the 77 post offices, with branch type — this is what breaks the ties |
| Unplaceable codes | All 96, with what each turned out to be |
| **Coverage audit** | What was checked against India Post, what it found, and what is still open |
| Verification | The checks run afterwards, and their results |

---

## The file as received

| | |
|---|---|
| Rows | 165,627 — one per post office, so ~8.5 rows per pincode |
| Columns | `Region`, `State`, `District`, `Pin Code` |
| Regions used | **4** — North, South, East, West. **"Central" does not appear** |
| States | 36 (plus a junk `NA`) |
| Districts | 754 `(state, district)` pairs across 749 distinct names |
| Distinct pincodes imported | **19,486** (plus 4 recovered and 6 added = **19,496** in the master) |

Two structural facts worth recording, because they rule out simpler designs:

- **5 district names are reused across states** — AURANGABAD is in both Maharashtra and Bihar;
  likewise BILASPUR, BALRAMPUR, HAMIRPUR and PRATAPGARH. A district must therefore be identified
  by `(state, name)`, never by name alone.
- **1,209 pincodes span more than one district** — 1,142 in two, 58 in three and **9 in four**
  (`192124` covers Anantnag, Kulgam, Pulwama and Shopian). A pincode therefore cannot carry a
  single district column. *(An earlier draft said 1,258 spanning up to four "e.g. 505415" —
  both wrong: the figure is 1,209, and 505415 spans three.)*

Every state maps to exactly one region, with **no conflicts** — that part of the file is clean.

---

## 1. State corrections — 6 pincodes

52 pincodes were listed under two different states. All 52 were checked against India Post.

**46 needed no change** — the spreadsheet's own majority was already right, and India Post agrees
with all 46. These were single stray rows against many correct ones, in two recognisable clusters:

- 7 Rajasthan pincodes (`3xxxxx`) each carrying one row tagged `Telangana / Mulugu`
- 14 Telangana pincodes (`50xxxx`) each carrying one row tagged `Andhra Pradesh / Vizianagaram`,
  `Bapatla` or `Parvathipuram Manyam`

Those strays are ignored; the majority stands.

**6 were corrected.** Two because the spreadsheet's own majority was wrong, four because the
spreadsheet was exactly tied and could not decide:

| Pincode | Spreadsheet says | Its majority | **Corrected to** | Region | Basis |
|---|---|---|---|---|---|
| `605014` | Tamil Nadu ×2, Puducherry ×2 | *(tie)* | **Puducherry** | South | India Post also tied 2–2; broken by the Sub Post Office, `Pondicherry University` |
| `605106` | Tamil Nadu ×5, Puducherry ×5 | *(tie)* | **Puducherry** | South | India Post also tied 5–5; broken by the Sub Post Office, `Nettapakkam` |
| `605107` | Puducherry ×4, Tamil Nadu ×4 | *(tie)* | **Tamil Nadu** | South | India Post 5–3 for Tamil Nadu |
| `607403` | Puducherry ×2, Tamil Nadu ×1 | Puducherry | **Tamil Nadu** | South | India Post 2–1 for Tamil Nadu |
| `781029` | Meghalaya ×1, Assam ×1 | *(tie)* | **Assam** | East | Both post offices are in Kamrup, Assam |
| `781131` | Meghalaya ×3, Assam ×1 | **Meghalaya** | **Assam** | East | All four post offices are in Kamrup, Assam. `781xxx` is the Guwahati circle; Meghalaya is `793xxx`/`794xxx` |

**No pincode changes region.** All six stay inside South or East, so no work moves between
Regional Heads — the corrections only affect which **Area Manager** covers that pincode.

### How ties were broken

Where India Post itself reports an equal split, the **Sub Post Office** decides. A pincode's Sub
Post Office (or Head Post Office) is its administrative centre; the Branch Post Offices hang off
it. Both cases resolved to Puducherry:

```
605014   Calapet                  Branch PO   Pondicherry
         Kaluperumbakkam          Branch PO   Tamil Nadu
         Kilpudupattu             Branch PO   Tamil Nadu
         Pondicherry University   Sub PO      Pondicherry   <-- decides

605106   Embalam, Karayamputhur, Kariyamanikam, Kijour   Branch PO   Pondicherry
         Chellanchery, Mandagapet, Nallathur, Pakkam, Viranam   Branch PO   Tamil Nadu
         Nettapakkam              Sub PO      Pondicherry   <-- decides
```

---

## 2. Recovered pincodes — 4

The file contains **715 rows** where the source lookup failed: region `#N/A`, state `NA`. They
touch 338 pincodes, of which **238 also appear elsewhere in the file with a real state** and are
imported normally from those rows.

The remaining **100 exist only as `#N/A`**. All 100 were checked against India Post. Four are real
and have been recovered rather than lost:

| Pincode | Recovered state | Region |
|---|---|---|
| `222101` | Uttar Pradesh | North |
| `390008` | Gujarat | West |
| `605012` | Puducherry | South |
| `804454` | Bihar | East |

---

## 3. Districts recovered — 4 pincodes  *(round 2)*

The four codes recovered in section 2 came back with a **state but no district**: the rows that
carry them say `NA` in the district column too. They sat in the master under a state with nothing
beneath them — real and correctly placed, but invisible to anything walking
state → district → pincode, and not reachable by drilling down.

All four districts **already existed** in the master, so this added four links and no new rows.

| Pincode | State | District added | India Post |
|---|---|---|---|
| `222101` | Uttar Pradesh | **Jaunpur** | 8 post offices, all Jaunpur |
| `390008` | Gujarat | **Vadodara** | Vadodara |
| `605012` | Puducherry | **Pondicherry** | Pondicherry |
| `804454` | Bihar | **Patna** | Patna |

Applied with `python -m app.scripts.link_recovered_districts --apply`, which is idempotent, and
carried by `DISTRICT_RECOVERED` so a re-import produces the same result.

**Pincodes with no district: 4 → 0.**

---

## 4. The 96 unplaceable codes — what they actually are

**These are real pincodes.** Round 1 recorded them as not recognised by India Post; that was
wrong, and the mistake came from trusting a single API that does not index them.

Every one of the 96 returns `No records found` from `api.postalpincode.in`. But looking them up
**by office name** finds them immediately, and every one checked is the same thing:

| Pincode | Post office |
|---|---|
| `273011` | NDC Gorakhpur |
| `395015` | NDC Surat |
| `400111` | NDC Mumbai GPO |
| `400114` | NDC Dadar HO |
| `400118` | NDC Mumbai Central |
| `400150` | Bandra W eCOM Nodal Delivery Centre |
| `400153` | NDC Azad Nagar |
| `411074` | NDC Ganeshkhind |
| `500901` | NDC Hyderabad GPO |
| `500903` | NDC Secunderabad |
| `682053` | NDC Edapally |

They are **Nodal Delivery Centres** — the bulk-mail and e-commerce hubs a postal division runs.
India Post's own directory records them with **`District: NA`, `State: NA`**, because a hub does
not sit in a delivery area. That is exactly why the vendor's `VLOOKUP` wrote `#N/A`, and why they
have no state or district to import.

**They are not service coverage.** Nobody lives at a distribution hub, so no customer address
carries one and no technician would ever be dispatched to one. That is why they are still out of
the master — not because they are fake.

12 of the 96 are confirmed individually by name; the remaining 84 share the identical signature
(present only on `#N/A` rows, absent from the pincode API). The full list is in the workbook.

```
121999  122998  122999  132035  134999  201319  201320  248020  273011  360008
380010  380011  380012  390026  395014  395015  400111  400113  400114  400118
400150  400153  400160  400167  400171  400183  400186  400193  400201  400609
401108  403522  411074  411075  411076  411077  411078  411079  411080  415635
422014  431025  440038  441124  452999  457111  462034  462057  462099  462116
473106  476338  482007  490004  495002  500119  500901  500903  500915  500918
500920  500927  500930  500931  500934  500939  500955  500958  500962  500970
500972  500984  500989  502932  504300  504314  517510  532184  590100  600200
600201  600202  682053  683051  688051  691051  712291  733139  734091  736209
781041  794116  795160  800033  800036  805142
```

If you do want them in the master, they can be added with a **state** (the hub's city gives it)
but never a district, because India Post does not record one. Say the word and it is a one-line
change to `pincode_overrides.py`.

---

## 6. Coverage audit — is anything missing?  *(round 2)*

Four questions, four answers.

### Does the master hold everything the vendor sheet contains?

**Yes — nothing was lost.** Checked cell by cell, no sampling:

| | Sheet | Master |
|---|---|---|
| States | 36 | **36** |
| Districts | 754 | **754** |
| Pincodes | 19,486 | **19,486** |

### Are our 36 states the real 36?

**Yes.** Matched against the official 28 states + 8 union territories. None missing, none spurious.
(India Post spells it `CHATTISGARH`; we spell it `Chhattisgarh`. Same state.)

### Is our data right, per India Post?

600 pincodes sampled at random (seed `20260822`), every one looked up:

| | |
|---|---|
| Lookup errors | 0 |
| State matches | 571 / 579 |
| **Real state errors** | **0** |
| District disagreements | 167 / 579 |
| **Real district errors** | **1** — `494446`, corrected |
| Not found by India Post | 21 / 600 — the same NDC / sorting-hub category as the 96 |

**The 167 district disagreements are not 167 errors.** Nearly every one is India Post's directory
being *older than ours*:

| Pincode says | We hold | India Post still says | Because |
|---|---|---|---|
| `505214` | Peddapalli | Karimnagar | Telangana split it in **2016** |
| `518411` | Nandyal | Kurnool | Andhra split it in **2022** |
| `211003` | Prayagraj | Allahabad | renamed **2018** |
| `736123` | Alipurduar | Jalpaiguri | created **2014** |
| `627813` | Tenkasi | Tirunelveli | Tamil Nadu split it in **2019** |

A disagreement with India Post is therefore **not** automatically an error — in this master it is
usually the opposite.

The one real error: **`494446`**. The sheet says `RAIPUR` on all 18 of its rows. All nine India
Post offices — Bhopalpatnam S.O and its branches — are in **Bijapur**, about 300 km away. A wrong
district is worse than a missing one, because an area manager covering Raipur would have been
handed work far outside it. Corrected, and the Raipur link removed.

### Does India Post have pincodes we don't?

Diffed against the Government of India open-data directory (155,570 post office records,
resource `6176ee09-…`). The shared demo key returns ten records per call and rate-limits hard, so
this is a **sample, not a full pull**: 3,540 records covering 1,321 distinct pincodes — 6.8% of
India's ~19,300.

**7 were missing. 6 were real and have been added:**

| Pincode | State | District | India Post |
|---|---|---|---|
| `335705` | Rajasthan | Ganganagar | 3 F D M B.O, Sardargarh S.O — both Delivery |
| `364485` | Gujarat | Rajkot | 5 offices, all Delivery |
| `393155` | Gujarat | Narmada, Bharuch | 6 offices, all Delivery |
| `396424` | Gujarat | Navsari | Kabilpore S.O, Delivery |
| `396440` | Gujarat | Navsari | Karadi S.O, Machhad B.O — both Delivery |
| `845102` | Bihar | Pashchim Champaran | Gaunaha S.O, Delivery |

The seventh, `110050`, is **not** added: it is Safdarjung Sorting Delivery Office, and India Post's
live lookup returns no record for it. Same call as the 96 — a sorting hub is not an address.

**Pincodes: 19,490 → 19,496.**

> ### This audit is not complete
>
> 0.53% of the sampled pincodes were missing, which implies **roughly 100 nationally** — so about
> **95 are still to find**. They will all look like the six above: small rural branch and sub post
> offices the vendor's export skipped.
>
> To close it properly, register a free API key at **data.gov.in** (a minute, no cost) and re-run
> the sweep over all 155,570 records instead of a 6.8% sample. Everything else is already in place:
> the diff, the verification and the apply script all work unchanged.

---

## 7. Note: the "Central" region

The database seeds **five** regions — North, South, East, West and **Central**. Your file uses
only four. Central therefore has **zero states**, so a Regional Head assigned to it would cover
nothing at all.

This is reported by the importer but **not changed automatically**. Deactivate Central on the
Super Admin → Geography screen if it is not part of the structure, or add its states to the file.

---

## Where these corrections live in the code

`api/app/features/geo/pincode_overrides.py` — the 6 corrections and 4 recoveries above, each with
its justification. The importer applies them on top of the file and **reports which ones fired**,
so they can never diverge from the source silently. If a corrected spreadsheet is uploaded later,
they become no-ops and the import report says so.

For any pincode still listed under two states that is *not* in that file, the importer takes the
majority of rows and, where the count is exactly tied, rejects the pincode and names it rather
than guessing.
