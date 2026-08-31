"""Email bodies — the ONE folder every HTML template lives in.

Content only. The egress is `app.integrations.acs_email`, which owns the single
place a message leaves this process; this package decides what is in it.

    from app.emails import send_temporary_password

Templates are `templates/*.html`, filled by `render.py`. They ship with the
deploy because `scripts/publish.py` copies `app/` with `shutil.copytree`, which
takes non-Python files along with everything else.
"""

from app.emails.account import send_temporary_password
from app.emails.alerts import send_gstin_lookup_unavailable
from app.emails.render import render

__all__ = ["render", "send_gstin_lookup_unavailable", "send_temporary_password"]
