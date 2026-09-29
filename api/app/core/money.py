"""Rupees, spelled the way this product spells them.

Money is integer paise everywhere below the wire (hard rule 9). This is the one
place paise become a string a person reads, for the sentences a bell, a push or
an error carries. Anything a SCREEN formats, it formats itself: the console
renders its own amounts so a currency change is a re-skin, not a redeploy.

Indian digit grouping, because that is the only grouping that is right here —
`₹1,00,000`, not `₹100,000`. And paise are shown only when there are any, so a
whole amount reads `₹250` rather than `₹250.00`.

`features/redemptions/service.py` keeps a private `_rupees` of its own with
plain three-digit grouping. It is deliberately NOT collapsed into this: the two
agree on every amount below a lakh, and the one value they disagree about is
exactly `UPI_MAX_PAISE`, which is a redemption's cap and therefore appears on a
signed-off screen. Changing that text is a copy decision, not a refactor.
"""


def indian(n: int) -> str:
    """`1,00,000` — the last three digits, then pairs."""
    digits = str(abs(n))
    if len(digits) <= 3:
        grouped = digits
    else:
        head, tail = digits[:-3], digits[-3:]
        pairs: list[str] = []
        while len(head) > 2:
            pairs.insert(0, head[-2:])
            head = head[:-2]
        if head:
            pairs.insert(0, head)
        grouped = ",".join(pairs) + "," + tail
    return f"-{grouped}" if n < 0 else grouped


def rupees(paise: int) -> str:
    """Paise as money a person reads: `₹250`, `₹1,00,000`, `₹4,250.50`.

    WITH the symbol, because every caller wants it and a bell reading "your
    payment of 3,200 was confirmed" is a sentence that does not say what it is
    counting. The console's own `money()` includes it for the same reason.

    A real minus sign (U+2212) for a negative, not a hyphen — matching
    `credits.credits_label` and the console, so the two never disagree about
    what a debit looks like.
    """
    whole = indian(abs(paise) // 100)
    out = whole if abs(paise) % 100 == 0 else f"{whole}.{abs(paise) % 100:02d}"
    return f"−₹{out}" if paise < 0 else f"₹{out}"
