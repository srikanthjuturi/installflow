"""The one place an email template file is read.

Substitution is `string.Template` (`$placeholder`), NOT `str.format()`, and that
is a decision worth not undoing. An HTML email is mostly CSS, and `.format()`
requires every literal brace to be doubled — `features/onboarding/landing.py`
shows how unpleasant that gets with ten rules, and an email has forty. jinja2
would be a new dependency for substitution we do not need.

Every value is HTML-escaped on the way in. Names here are user-supplied and land
in both text and attribute positions.
"""

from __future__ import annotations

import html
import re
from pathlib import Path
from string import Template

_TEMPLATES = Path(__file__).parent / "templates"

#: Developer-supplied, so this is documentation more than defence — but it
#: states the contract and it is one line.
_NAME = re.compile(r"^[a-z0-9_]+$")


def render(template: str, /, **values: object) -> str:
    """Fill one template from `templates/`. Every value is HTML-escaped.

    Uses `.substitute`, never `.safe_substitute`: a missing key must raise
    loudly here rather than deliver a literal `$temporary_password` to
    somebody's inbox.

    Deliberately uncached. One 4 KB read per account created is nothing beside a
    bcrypt hash and a network round trip, and an lru_cache would guarantee that
    an edited template serves stale until somebody works out why. (Note that
    uvicorn's --reload does not watch .html either — restart after editing one.)
    """
    if not _NAME.match(template):
        raise ValueError(f"Not a template name: {template!r}")

    # Relative to this module, never to the working directory — that is what
    # survives copytree into the deploy zip and Oryx's extraction to /tmp.
    source = (_TEMPLATES / f"{template}.html").read_text(encoding="utf-8")
    escaped = {k: html.escape(str(v), quote=True) for k, v in values.items()}
    return Template(source).substitute(escaped)
