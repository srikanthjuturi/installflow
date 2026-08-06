# Videocon Installation API

FastAPI backend for the Videocon technician field app.

**Stack:** FastAPI · PostgreSQL · SQLAlchemy 2.0 (async, `psycopg` 3) · Pydantic v2 ·
Alembic · JWT (PyJWT) · bcrypt

**Python:** 3.12 (developed and verified on 3.12.13).

**Architecture:** Feature-Based + Clean Architecture. Shared foundation lives in `app/core`
and `app/db`; each business capability is a self-contained vertical slice under
`app/features/<slice>/`.

> **Status: scaffold only.** The database connection, settings, JWT/security helpers, and
> Alembic are wired and verified. No business API endpoints exist yet.

## Layout

```
api/
├─ app/
│  ├─ main.py              # FastAPI app factory (health check + DB-connectivity lifespan)
│  ├─ core/
│  │  ├─ config.py         # Settings (pydantic-settings) → builds DATABASE_URL
│  │  ├─ database.py       # async engine, AsyncSessionLocal, get_db() dependency
│  │  └─ security.py       # JWT create/decode + bcrypt hash/verify
│  ├─ db/
│  │  ├─ base_class.py     # DeclarativeBase + naming convention + auto __tablename__
│  │  └─ base.py           # model registry imported by Alembic autogenerate
│  └─ features/            # vertical slices land here (empty for now)
├─ alembic/                # migration environment (async)
├─ alembic.ini
├─ run.py                  # dev launcher (REQUIRED entry point on Windows)
├─ requirements.txt
└─ .env                    # local secrets (git-ignored)
```

## Setup

Create the venv with a **Python 3.12** interpreter (on this machine that is
`D:\Python312\python.exe`, a portable python-build-standalone build):

```bash
cd api
"D:/Python312/python.exe" -m venv .venv          # Windows (3.12)
.venv/Scripts/python.exe -m pip install -r requirements.txt
# python3.12 -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt  # macOS/Linux
cp .env.example .env      # then fill in DB + JWT secret
```

## Run

```bash
python run.py             # http://localhost:8000  ·  /health  ·  /docs
```

> **Windows:** always start with `python run.py`, **not** the bare `uvicorn app.main:app`
> CLI. psycopg's async driver can't use Windows' default `ProactorEventLoop`; `run.py`
> selects the `SelectorEventLoop` before uvicorn creates its loop. On Linux/macOS either
> works.

## Migrations (Alembic)

The DB URL is read from `app.core.config` at runtime — it is **not** stored in `alembic.ini`.

```bash
python -m alembic revision --autogenerate -m "create X table"
python -m alembic upgrade head
python -m alembic current      # show applied revision
```

Register every new model in `app/db/base.py` so autogenerate can see it.

## Database

Azure PostgreSQL 16, database `videocondb`, SSL required (`sslmode=require`). Connection
parameters live in `.env`.
