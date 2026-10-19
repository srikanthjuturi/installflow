"""Pincode-list grammar for the Franchisees screen — F2 in one file.

The technician screens take a list one pincode at a time; the franchisee
screen takes RANGES, which can cover thousands at once. This module is the
single grammar for that list: parse (`parse`), intersect with the master's
ACTIVE codes (`expand`), measure (`span`), report misses (`empty_ranges`),
and invert — turn owned codes back into ranges for display (`compress`).

Pure and stdlib-only: this file never imports SQLAlchemy or any app module,
so the unit suite exercises it with no database and the API code can call it
from anywhere without import cycles. Errors are ``PincodeRangeError``, a
``ValueError`` subclass; the service layer turns them into 422s and, when the
exception names tokens, echoes them in ``errors``.
"""

import re
import unicodedata
from bisect import bisect_left, bisect_right
from typing import Iterable

Range = tuple[int, int]

PINCODE_RE = re.compile(r"[1-9][0-9]{5}")

# en dash accepted as a range separator; the split itself is on , ; \r \n only —
# a space is never a separator (a pasted block with spaces still parses).
DASHES = "-–"
_RANGE_RE = re.compile(r"([0-9]+)\s*[-–]\s*([0-9]+)")

MAX_TEXT_CHARS = 20_000
MAX_TOKENS = 500
MAX_RANGE_SPAN = 100_000
MAX_CODES = 10_000


class PincodeRangeError(ValueError):
    """Raised with one message the service surfaces as a 422. `.tokens` may name
    the offending entries (as typed) so the errors array can echo them."""

    def __init__(self, message: str, *, tokens: list[str] | None = None):
        super().__init__(message)
        self.tokens = tokens


def format_range(rng: Range) -> str:
    """``(500099, 500099)`` → ``"500099"``; a span → ``"500001-500099"``."""
    a, b = rng
    return f"{a:06d}" if a == b else f"{a:06d}-{b:06d}"


def parse(text: str | None) -> list[Range]:
    """The text box → sorted, merged, inclusive ranges.

    Grammar, in order:
    1. empty → []
    2. text longer than MAX_TEXT_CHARS → error
    3. NFKC-normalise (fixes full-width commas and digits from some keyboards)
    4. split on any run of , ; CR LF (NOT space)
    5. more than MAX_TOKENS entries → error
    6. an entry that is two numbers joined by a dash is a range
    7. an entry that matches PINCODE_RE is a single pincode
    8. anything else is invalid
    9. any invalid or backwards entry → ONE error naming up to 10 of them
    10. a range spanning more than MAX_RANGE_SPAN numbers → error
    11. sort and merge overlapping, adjacent and repeated runs
    """
    if text is None or not text.strip():
        return []
    if len(text) > MAX_TEXT_CHARS:
        raise PincodeRangeError(
            f"That list is too long — at most {MAX_TEXT_CHARS:,} characters."
        )
    text = unicodedata.normalize("NFKC", text)
    entries = [e.strip() for e in re.split(r"[,;\r\n]+", text) if e.strip()]
    if len(entries) > MAX_TOKENS:
        raise PincodeRangeError(
            f"Too many entries — at most {MAX_TOKENS}. Use wider ranges."
        )

    invalid: list[str] = []
    backwards: list[str] = []
    ranges: list[Range] = []
    for entry in entries:
        match = _RANGE_RE.fullmatch(entry)
        if match is not None:
            a_txt, b_txt = match.groups()
            if PINCODE_RE.fullmatch(a_txt) and PINCODE_RE.fullmatch(b_txt):
                a, b = int(a_txt), int(b_txt)
                if a > b:
                    backwards.append(entry)
                else:
                    ranges.append((a, b))
            else:
                invalid.append(entry)
            continue
        if PINCODE_RE.fullmatch(entry):
            n = int(entry)
            ranges.append((n, n))
        else:
            invalid.append(entry)

    if invalid or backwards:
        parts: list[str] = []
        if invalid:
            seen: list[str] = []
            for token in invalid:
                if token not in seen:
                    seen.append(token)
            sample = ", ".join(f'"{t}"' for t in seen[:10])
            if len(seen) > 10:
                sample += f" and {len(seen) - 10} more"
            parts.append(
                f"Not a pincode or range: {sample}."
                " Use six digits that do not start with 0 (500001),"
                " or two joined by a dash (500001-500099)."
            )
        for token in backwards[:10]:
            parts.append(
                f'"{token}" runs backwards — put the smaller pincode first.'
            )
        seen_tokens: list[str] = []
        for token in invalid + backwards:
            if token not in seen_tokens:
                seen_tokens.append(token)
        raise PincodeRangeError(" ".join(parts), tokens=seen_tokens)

    for a, b in ranges:
        if b - a + 1 > MAX_RANGE_SPAN:
            raise PincodeRangeError(
                f"{format_range((a, b))} spans more than"
                f" {MAX_RANGE_SPAN:,} numbers — split it."
            )

    return merge(ranges)


def merge(ranges: Iterable[Range]) -> list[Range]:
    """Sort, then absorb overlapping, adjacent and repeated runs."""
    out: list[Range] = []
    for a, b in sorted(ranges):
        if out and a <= out[-1][1] + 1:
            out[-1] = (out[-1][0], max(out[-1][1], b))
        else:
            out.append((a, b))
    return out


def span(ranges: Iterable[Range]) -> int:
    """How many numbers the (merged) ranges cover, duplicates counted once."""
    return sum(b - a + 1 for a, b in merge(ranges))


def _existing_index(existing: Iterable[str]) -> list[str]:
    """Sorted list of well-formed six-digit codes; anything else is junk and
    drops out (master codes are validated on write, so this only defends
    against hand-edited rows and old test data)."""
    return sorted({c for c in existing if isinstance(c, str) and len(c) == 6 and c.isdigit()})


def expand(ranges: Iterable[Range], existing: Iterable[str]) -> list[str]:
    """Ranges ∩ master codes: only codes that exist keep meaning.
    More than MAX_CODES matches → error (one franchisee, one bounded list)."""
    index = _existing_index(existing)
    out: list[str] = []
    for a, b in ranges:
        lo = bisect_left(index, f"{a:06d}")
        hi = bisect_right(index, f"{b:06d}")
        out.extend(index[lo:hi])
    if len(out) > MAX_CODES:
        raise PincodeRangeError(
            f"Those ranges cover {len(out):,} pincodes"
            f" — one franchisee may own at most {MAX_CODES:,}."
        )
    return out


def empty_ranges(ranges: Iterable[Range], existing: Iterable[str]) -> list[Range]:
    """The ranges that matched no master code, so the 422 can point at them
    instead of making the admin diff the list by eye."""
    index = _existing_index(existing)
    empty: list[Range] = []
    for a, b in merge(ranges):
        lo = bisect_left(index, f"{a:06d}")
        hi = bisect_right(index, f"{b:06d}")
        if lo >= hi:
            empty.append((a, b))
    return empty


def compress(
    codes: Iterable[str], *, universe: Iterable[str] | None = None
) -> str:
    """Codes → display text. Sorted, deduped, runs compressed to ``a-b``.

    With a universe (the company's ACTIVE master codes, F2), a run continues
    across numbers the master does not hold — nothing to own there — and breaks
    only at a master code that is not in `codes`, which is the difference the
    admin has to see. Codes absent from the universe are still printed.

    Without a universe every gap breaks the run: nothing certifies the numbers
    in between are unownable, so printing them as held would lie.
    """
    ordered = sorted({c for c in codes if isinstance(c, str) and len(c) == 6 and c.isdigit()})
    if not ordered:
        return ""
    if universe is None:
        holes: set[int] | None = None
    else:
        holes = {int(c) for c in universe if len(c) == 6 and c.isdigit()} - {
            int(c) for c in ordered
        }

    runs: list[Range] = []
    for c in ordered:
        n = int(c)
        gap = range(runs[-1][1] + 1, n) if runs else ()
        bridges = not gap if holes is None else all(k not in holes for k in gap)
        if runs and bridges:
            runs[-1] = (runs[-1][0], n)
        else:
            runs.append((n, n))
    return ", ".join(format_range(r) for r in runs)