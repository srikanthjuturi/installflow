# Reliance GreenTech Installation API

FastAPI backend for the Reliance GreenTech technician field app.

**Stack:** FastAPI · PostgreSQL · SQLAlchemy 2.0 (async, `psycopg` 3) · Pydantic v2 ·
Alembic · JWT (PyJWT) · bcrypt

**Python:** 3.12 (developed and verified on 3.12.13).

**Architecture:** Feature-Based + Clean Architecture. Shared foundation lives in `app/core`
and `app/db`; each business capability is a self-contained vertical slice under
`app/features/<slice>/`.

> **Status: multi-tenant core live.** Auth, companies, users, and RBAC slices are implemented
> and verified end-to-end against Azure PostgreSQL.

## Multi-tenancy model

- **Identity vs membership.** One `user` (globally-unique email) has a **fixed role** and can
  belong to **many companies** via `membership`. Login is email + password only; the header
  company switcher (`/auth/switch-company`) re-issues a token scoped to the chosen company.
- **Superadmin** (`role='superadmin'`, no membership) manages companies. **Admin** (created
  atomically with a company) manages everything inside it and provisions users into the roles
  **below** them: `national_head → regional_head → area_manager → technician`. Roles never change.
- **Tenant isolation** is enforced in the service layer: every company-scoped query filters by the
  active `company_id` from the token, so cross-tenant reads/writes return 404.
- **Backend-driven features.** `/auth/me` returns the effective feature keys for the caller's role
  in the active company — `COALESCE(company override, role default, false)`. Admins toggle features
  for lower roles via `/role-features` (per-company overrides). The frontend shows/hides off this.

## Endpoints (`/api/v1`)

| Area | Endpoints |
|---|---|
| auth | `POST /auth/login` · `POST /auth/switch-company` · `POST /auth/refresh` · `POST /auth/logout` · `GET /auth/me` |
| companies (superadmin) | `POST /companies` · `GET /companies` · `GET/PUT/DELETE /companies/{id}` · `PATCH /companies/{id}/status` |
| users (tenant-scoped) | `GET /users` · `POST /users` · `GET/PUT/DELETE /users/{membershipId}` |
| rbac | `GET /roles` · `GET /features` · `GET/PUT /role-features` |

All responses use the envelope `{ success, statusCode, message, timestamp, data, errors[] }`; list
endpoints add a `pagination` block. List query params: `page, limit, search, sortBy, sortDir`.

## Bootstrap the superadmin

```bash
python -m app.scripts.bootstrap    # reads SUPERADMIN_EMAIL / SUPERADMIN_PASSWORD from .env
```

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

Azure PostgreSQL 18, SSL required (`sslmode=require`). **Two databases on one server:**

| Database | Environment | Configured in | Used by |
|---|---|---|---|
| `RelianceDB` | development | `.env` | a laptop running `python run.py`; the console's `.env.local`; Expo Go over the LAN |
| `RelianceProdDB` | production | `.env.production` | the deployed Azure App Service, and therefore the Netlify console and every installed mobile build |

Nothing in the code chooses between them — `DATABASE_URL` is computed from the `POSTGRES_*`
values in whichever file is loaded, and `publish.py` copies `.env.production` into the deployment
zip **as `.env`**. So the file you are editing decides the database, and `publish.py` refuses to
deploy unless `POSTGRES_DB` names the production one.

To point a single command at the other database, set the environment variable — pydantic-settings
ranks it above the `.env` file, so nothing needs editing and there is nothing to revert:

```powershell
$env:POSTGRES_DB='RelianceProdDB'; python -m alembic upgrade head
```

⚠ **Without that override, `alembic upgrade head` migrates DEVELOPMENT.**

Both names are **mixed case**, so they are quoted everywhere they appear in SQL
(`CREATE DATABASE "RelianceProdDB"`); an unquoted `RelianceProdDB` folds to `relianceproddb` and
does not exist. A connection string passes the name through verbatim, so
`POSTGRES_DB=RelianceProdDB` is correct as written.

### Standing up a database from empty

```bash
python -m app.scripts.create_database --name RelianceProdDB   # quotes the identifier for you
POSTGRES_DB=RelianceProdDB python -m alembic upgrade head     # schema + roles, regions, features
POSTGRES_DB=RelianceProdDB python -m app.scripts.bootstrap    # the one superadmin user
python -m app.scripts.copy_geography --to RelianceProdDB      # 41,073 rows of geography master
POSTGRES_DB=RelianceProdDB python -m app.scripts.audit_tenancy
```

`upgrade head` seeds the global reference data itself — 8 roles, 5 regions, 26 features and their
78 role defaults all ship inside the migrations, so there is no separate seed step for them. The
geography master is the exception: the tables are created empty and normally filled from a
spreadsheet through Super Admin → Geography, so `copy_geography` lifts it from an existing
database instead, preserving ids so a pincode means the same thing in both.

Everything else — companies, users, vendors, the product master, technicians — is created through
the console. There is no demo-data seeder.
