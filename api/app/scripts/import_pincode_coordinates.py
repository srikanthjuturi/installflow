"""Load pincode latitude/longitude from an external CSV or XLSX file.

    # Dry run (default — no writes, full report):
    python -m app.scripts.import_pincode_coordinates coords.csv

    # Commit to dev DB:
    python -m app.scripts.import_pincode_coordinates coords.csv --commit

    # Commit to prod DB:
    # (PowerShell)
    $env:POSTGRES_DB='RelianceProdDB'; python -m app.scripts.import_pincode_coordinates coords.csv --commit

## UPDATE-ONLY. This script NEVER inserts a pincode.

A code in the file that the master does not already have is COUNTED and
REPORTED, never created. The geography master's shape (state, districts,
source) is owned by the geo importer and the superadmin console, and a
coordinate file has no authority to mint a bare row with no state.
Do not add an insert branch.

## Coordinates survive geo re-imports.

import_geography writes state_id, source and district links only — it never
touches latitude or longitude — so a loaded point survives every future sheet
upload, exactly as is_active does.

## Source format

CSV (.csv) or Excel (.xlsx / .xls). The header is normalised (lower-case,
non-letters stripped), so "Pin Code", "PINCODE" and "pin_code" all work.

    Required columns (any of the accepted spellings):
        pincode / pin / code
        latitude / lat
        longitude / lon / lng / long

## Conflict policy (when a code already has coordinates)

File wins — the new value overwrites, counted as "updated". Run with
--skip-existing to leave already-loaded codes alone and report them instead.

## Validation

Every row is validated in Python before reaching the database:
  - Code must match ^[1-9][0-9]{5}$
  - Both lat and lon must be present or both absent
  - lat must be in [6.0, 38.0] (India box)
  - lon must be in [68.0, 98.0] (India box)
  A row that fails any check is rejected with a reason; the rest still commit.
"""

import argparse
import csv
import io
import re
import sys
from dataclasses import dataclass, field

import psycopg

from app.core.config import settings
from app.core.coordinates import INDIA_LAT, INDIA_LON

PINCODE_RE = re.compile(r"^[1-9][0-9]{5}$")

#: Header spellings accepted, normalised the same way geo/service.py does it.
_LAT_KEYS = {"latitude", "lat"}
_LON_KEYS = {"longitude", "lon", "lng", "long"}
_PIN_KEYS = {"pincode", "pin", "code"}

#: Values that mean "no data" in the file.
_EMPTY = {"", "none", "null", "na", "n/a", "-"}


def _norm_header(raw: object) -> str:
    return re.sub(r"[^a-z]", "", str(raw or "").lower())


def _in_india(lat: float, lon: float) -> bool:
    return INDIA_LAT[0] <= lat <= INDIA_LAT[1] and INDIA_LON[0] <= lon <= INDIA_LON[1]


def _to_float(raw: object) -> float | None:
    if raw is None:
        return None
    s = str(raw).strip()
    if s.lower() in _EMPTY:
        return None
    try:
        return float(s)
    except ValueError:
        return None


# ── parsing ────────────────────────────────────────────────────────────────


@dataclass
class _Row:
    row_num: int
    code: str
    lat: float | None
    lon: float | None


@dataclass
class _Reject:
    row_num: int
    code: str
    reason: str


@dataclass
class _Parsed:
    rows: list[_Row] = field(default_factory=list)
    rejects: list[_Reject] = field(default_factory=list)


def _iter_raw(data: bytes, filename: str):
    """Yield raw tuples from .csv or .xlsx, streaming in both cases."""
    if filename.lower().endswith(".csv"):
        text = data.decode("utf-8-sig", errors="replace")
        yield from csv.reader(io.StringIO(text))
        return

    try:
        import openpyxl
    except ModuleNotFoundError:
        print("ERROR: openpyxl is not installed. Install it or use a CSV file.")
        sys.exit(1)

    try:
        book = openpyxl.load_workbook(io.BytesIO(data), read_only=True, data_only=True)
    except Exception as exc:
        print(f"ERROR: Could not open the file as a spreadsheet: {exc}")
        sys.exit(1)

    try:
        yield from book[book.sheetnames[0]].iter_rows(values_only=True)
    finally:
        book.close()


def parse_file(data: bytes, filename: str) -> _Parsed:
    out = _Parsed()
    rows = _iter_raw(data, filename)

    header = next(rows, None)
    if header is None:
        print("ERROR: The file is empty.")
        sys.exit(1)

    # Map normalised header names to column indices.
    col_pin = col_lat = col_lon = None
    for i, cell in enumerate(header):
        key = _norm_header(cell)
        if key in _PIN_KEYS and col_pin is None:
            col_pin = i
        elif key in _LAT_KEYS and col_lat is None:
            col_lat = i
        elif key in _LON_KEYS and col_lon is None:
            col_lon = i

    missing = []
    if col_pin is None:
        missing.append("pincode (or pin / code)")
    if col_lat is None:
        missing.append("latitude (or lat)")
    if col_lon is None:
        missing.append("longitude (or lon / lng / long)")
    if missing:
        print(f"ERROR: Missing required columns: {', '.join(missing)}")
        print(f"  Found: {', '.join(str(h) for h in header if h)}")
        sys.exit(1)

    def get(row, idx):
        if idx is None or idx >= len(row):
            return None
        v = row[idx]
        if isinstance(v, float) and v.is_integer():
            v = int(v)
        return v

    for num, row in enumerate(rows, start=2):
        if row is None:
            continue
        raw_code = str(get(row, col_pin) or "").strip()
        raw_lat = get(row, col_lat)
        raw_lon = get(row, col_lon)

        # Skip entirely blank rows.
        if not raw_code and raw_lat is None and raw_lon is None:
            continue

        lat = _to_float(raw_lat)
        lon = _to_float(raw_lon)

        # Validate code format.
        if not PINCODE_RE.match(raw_code):
            out.rejects.append(
                _Reject(num, raw_code, "Not a valid 6-digit pincode (cannot start with 0)")
            )
            continue

        # Both-or-neither.
        if (lat is None) != (lon is None):
            out.rejects.append(
                _Reject(
                    num,
                    raw_code,
                    f"Only one coordinate present (lat={raw_lat!r}, lon={raw_lon!r}) — need both or neither",
                )
            )
            continue

        # India-box validation (only when coordinates are present).
        if lat is not None and not _in_india(lat, lon):
            out.rejects.append(
                _Reject(
                    num,
                    raw_code,
                    f"Coordinates ({lat}, {lon}) are outside the India bounding box "
                    f"(lat {INDIA_LAT[0]}–{INDIA_LAT[1]}, lon {INDIA_LON[0]}–{INDIA_LON[1]})",
                )
            )
            continue

        out.rows.append(_Row(num, raw_code, lat, lon))

    return out


# ── database ────────────────────────────────────────────────────────────────


def dsn() -> str:
    return (
        f"host={settings.POSTGRES_HOST} "
        f"port={settings.POSTGRES_PORT} "
        f"dbname={settings.POSTGRES_DB} "
        f"user={settings.POSTGRES_USER} "
        f"password={settings.POSTGRES_PASSWORD} "
        f"sslmode={settings.POSTGRES_SSLMODE}"
    )


@dataclass
class _Report:
    dry_run: bool
    rows_read: int
    not_in_master: int = 0
    unchanged: int = 0
    updated: int = 0    # includes first-time loads
    null_pairs: int = 0  # rows with no coordinates (skipped)
    rejected: int = 0
    rejects: list[_Reject] = field(default_factory=list)

    def print(self) -> None:
        mode = "DRY RUN -- no changes written" if self.dry_run else "COMMITTED"
        sep = "-" * 50
        print(f"\n{sep}")
        print(f"  {mode}")
        print(sep)
        print(f"  Rows read from file : {self.rows_read:,}")
        print(f"  Rejected (bad data) : {self.rejected:,}")
        print(f"  Not in master       : {self.not_in_master:,}  (never inserted)")
        print(f"  Null coordinate pair: {self.null_pairs:,}  (skipped)")
        print(f"  Unchanged           : {self.unchanged:,}")
        print(f"  Updated / loaded    : {self.updated:,}")
        print(f"{sep}\n")
        if self.rejects:
            print(f"  Rejected rows ({len(self.rejects)} shown):")
            for r in self.rejects[:200]:
                print(f"    row {r.row_num}: {r.code!r} -- {r.reason}")
            if self.rejected > 200:
                print(f"    ... and {self.rejected - 200} more")
            print()


def run(parsed: _Parsed, *, commit: bool, skip_existing: bool) -> _Report:
    report = _Report(dry_run=not commit, rows_read=len(parsed.rows) + len(parsed.rejects))
    report.rejected = len(parsed.rejects)
    report.rejects = parsed.rejects

    with psycopg.connect(dsn(), connect_timeout=30) as conn:
        # Load all existing pincode codes and their current coordinates in one
        # round-trip. 19,496 rows of (code, lat, lon) is ~400 KB — fits easily.
        with conn.cursor() as cur:
            cur.execute("SELECT code, latitude, longitude FROM pincodes")
            master: dict[str, tuple[float | None, float | None]] = {
                row[0]: (row[1], row[2]) for row in cur.fetchall()
            }

        to_update: list[dict] = []

        for row in parsed.rows:
            if row.lat is None and row.lon is None:
                report.null_pairs += 1
                continue

            if row.code not in master:
                report.not_in_master += 1
                continue

            current_lat, current_lon = master[row.code]

            if skip_existing and current_lat is not None:
                report.unchanged += 1
                continue

            if current_lat == row.lat and current_lon == row.lon:
                report.unchanged += 1
                continue

            report.updated += 1
            to_update.append({"c": row.code, "lat": row.lat, "lon": row.lon})

        if commit and to_update:
            with conn.cursor() as cur:
                cur.executemany(
                    "UPDATE pincodes "
                    "SET latitude = %(lat)s, longitude = %(lon)s, updated_at = now() "
                    "WHERE code = %(c)s",
                    to_update,
                )
            conn.commit()

    return report


# ── entry point ─────────────────────────────────────────────────────────────


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Load pincode lat/lon from CSV/XLSX into pincodes table (UPDATE-only)."
    )
    parser.add_argument("file", help="Path to the CSV or XLSX coordinate file")
    parser.add_argument(
        "--commit",
        action="store_true",
        default=False,
        help="Write to the database (default: dry run, no writes)",
    )
    parser.add_argument(
        "--skip-existing",
        action="store_true",
        default=False,
        help="Do not overwrite codes that already have coordinates (report as unchanged)",
    )
    args = parser.parse_args()

    try:
        with open(args.file, "rb") as fh:
            data = fh.read()
    except FileNotFoundError:
        print(f"ERROR: File not found: {args.file}")
        return 1

    filename = args.file.split("\\")[-1].split("/")[-1]
    parsed = parse_file(data, filename)

    print(f"Parsed {len(parsed.rows):,} valid rows, {len(parsed.rejects):,} rejected.")
    print(f"Database: {settings.POSTGRES_DB}")
    if not args.commit:
        print("Dry run — pass --commit to write.")

    report = run(parsed, commit=args.commit, skip_existing=args.skip_existing)
    report.print()

    if report.not_in_master:
        print(
            f"NOTE: {report.not_in_master:,} codes in the file are not in the pincode master "
            f"and were NOT inserted. Run without --commit first to review."
        )

    return 0


if __name__ == "__main__":
    sys.exit(main())
