# Pin Code corrections

What was changed when `Reliance Green Tech Pin Code.xlsx` was loaded into the geography master,
and why. Every change below is a correction to the **state a pincode belongs to** — nothing in
the spreadsheet itself was edited, and the file remains the source.

Source of truth for the corrections: **India Post**, via the official lookup at
`https://api.postalpincode.in/pincode/<code>`, checked on 2026-08-21.

---

## The file as received

| | |
|---|---|
| Rows | 165,627 — one per post office, so ~8.5 rows per pincode |
| Columns | `Region`, `State`, `District`, `Pin Code` |
| Regions used | **4** — North, South, East, West. **"Central" does not appear** |
| States | 36 (plus a junk `NA`) |
| Districts | 754 `(state, district)` pairs across 749 distinct names |
| Distinct pincodes imported | **19,490** |

Two structural facts worth recording, because they rule out simpler designs:

- **5 district names are reused across states** — AURANGABAD is in both Maharashtra and Bihar;
  likewise BILASPUR, BALRAMPUR, HAMIRPUR and PRATAPGARH. A district must therefore be identified
  by `(state, name)`, never by name alone.
- **1,258 pincodes span more than one district**, up to 4 (e.g. `505415` covers Peddapalli,
  Karimnagar and Jagitial). A pincode therefore cannot carry a single district column.

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

## 3. Dropped — 96 pincodes

The other 96 are **not pincodes**. India Post does not recognise any of them, which is exactly why
the source lookup returned `#N/A`. They are not imported. Many are visibly synthetic — `121999`,
`122998`, `122999`, `452999` — and a large block sits in Mumbai and Hyderabad ranges.

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

If any of these are real addresses you serve, they need a valid pincode in the source file — the
importer cannot place a code India Post has never issued.

---

## 4. Note: the "Central" region

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
