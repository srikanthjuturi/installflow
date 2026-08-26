"""The company's short code — the first token of every human-facing code.

`RGT-INST-0001` reads as whose / what / which. The company half is what makes
the whole string unique ACROSS tenants: the counter behind it is per-company, so
without this every company would mint its own `INST-0001` and a code alone would
not identify a ticket in any report that spans more than one of them.

It is STORED on the company rather than derived from the name at read time, and
that is the important part. A ticket keeps the code it was created with forever
— it is printed, quoted on the phone, and searched for — so a rule that
recomputed initials from the current name would leave renamed companies minting
`RGT-INST-0042` next to an older `RG-INST-0041` for no reason a human could see.
Stored once, immutable after, and the string can never drift from the row.

Kept in `core/` because tickets and technicians both need it and hard rule 4
forbids one slice importing another.
"""

import re

#: Words that carry no identity. A code built from "Reliance GreenTech Private
#: Limited" should be RGT, not RGTPL — the suffix is a legal form, not a name.
_NOISE = {
    "and", "the", "of", "co", "company", "corp", "corporation",
    "pvt", "private", "ltd", "limited", "llp", "llc", "inc", "plc",
    "india", "indian", "services", "service", "solutions", "enterprises",
}

MIN_LEN = 2
MAX_LEN = 6

#: Split on anything that is not a letter or digit, AND on camelCase joins, so
#: "Reliance GreenTech" yields Reliance/Green/Tech (→ RGT) rather than
#: Reliance/GreenTech (→ RG). Company names are written both ways and a human
#: reads the capital as a word boundary either way.
_CAMEL = re.compile(r"(?<=[a-z0-9])(?=[A-Z])")


def tokenize(name: str) -> list[str]:
    parts: list[str] = []
    for chunk in re.split(r"[^A-Za-z0-9]+", name or ""):
        if chunk:
            parts.extend(p for p in _CAMEL.split(chunk) if p)
    return parts


def derive(name: str) -> str:
    """Suggest a code from a company name. Never raises; always returns something.

    Initials of the meaningful words. Falls back through progressively dumber
    rules rather than failing, because a company must always be creatable — a
    name of pure punctuation is not a reason to refuse the form, and the
    superadmin can type a better code over the top.
    """
    tokens = tokenize(name)
    meaningful = [t for t in tokens if t.lower() not in _NOISE] or tokens

    code = "".join(t[0] for t in meaningful).upper()[:MAX_LEN]
    if len(code) >= MIN_LEN:
        return code

    # Dropping the noise left too little to work with ("company A" → "A"). Put
    # it back before resorting to padding: "CA" says something about the name,
    # and an invented filler letter says nothing at all.
    if len(tokens) > len(meaningful):
        code = "".join(t[0] for t in tokens).upper()[:MAX_LEN]
        if len(code) >= MIN_LEN:
            return code

    # One word only ("Videocon") — take its opening letters instead of a single
    # initial, which would be too thin to recognise on a printed ticket.
    if tokens:
        return tokens[0][:3].upper().ljust(MIN_LEN, "X")

    stripped = re.sub(r"[^A-Za-z0-9]", "", name or "").upper()
    return (stripped[:3] or "CO").ljust(MIN_LEN, "X")


def normalise(code: str) -> str:
    """What a hand-typed code becomes before it is stored or compared."""
    return re.sub(r"[^A-Za-z0-9]", "", code or "").upper()[:MAX_LEN]


def validate(code: str) -> str | None:
    """Returns an error message, or None when the code is usable."""
    cleaned = normalise(code)
    if len(cleaned) < MIN_LEN:
        return f"Company code needs at least {MIN_LEN} letters or digits"
    if not cleaned[0].isalpha():
        return "Company code must start with a letter"
    return None
