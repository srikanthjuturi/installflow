# Task 00 — Prerequisites and the test harness

> Read [00-index.md](00-index.md) first. This task writes **no feature code**. It (a) brings the pincode
> coordinates into the repo and (b) gives all three projects a unit-test runner, so every later task can
> ship the tests its document specifies.

## 1. Goal and why

**Plain version.** Travel allowance measures the distance from a technician's base to the customer's
pincode. The development database already knows where every pincode is, but the code that put the
latitude and longitude columns there lives on someone's branch and not in this repository. Until it is
merged, nobody can write a migration that comes after it. Separately, the repo has **no tests at all**:
CI only checks that Python compiles and that the two clients lint and typecheck. Every task in this
programme specifies unit tests, so the runners have to exist first.

**Worked example.** After this task, a developer writing Task 10 can create
`api/tests/unit/test_travel.py`, run `pytest api/tests/unit -q` and see it pass locally and in the PR
check. A developer writing Task 07 can run `npm test` in `mobileapp/` and in `adminWeb/`.

## 2. Decisions implemented

G1 (coordinates migration owned by the owner's branch), X1 (pytest pure / vitest / jest-expo, in CI).

## 3. Schema

**None authored here.** Step 3.1 merges the owner's existing migration.

### 3.1 Merge the pincode-coordinates branch (owner action, then verify)

1. The owner pushes the branch that contains Alembic revision **`f9c2d8a3e17b`** (it added
   `pincodes.latitude` and `pincodes.longitude`, `double precision`, nullable). RelianceDB is already at
   that revision; this repository's `dev` head is `ea2fb2654b95`.
2. Merge it into `dev`. Confirm:
   - `api/alembic/versions/f9c2d8a3e17b_*.py` exists and its `down_revision` is a revision already in
     this repo's chain (expected `ea2fb2654b95`). If it points elsewhere, the chain has a fork — stop and
     ask the owner; never write a merge migration on a guess.
   - `api/app/models/territory.py` `Pincode` declares `latitude: Mapped[float | None]` and
     `longitude: Mapped[float | None]` (both `Float`, nullable). **If the branch added the columns only
     in the migration and not in the model, add them to the model now** — otherwise SQLAlchemy cannot
     select them and Task 10 fails.
   - `python -m alembic heads` prints exactly one head.
   - Whatever wrote the coordinates (geography importer columns, a one-off script, the Geography screen's
     manual editor) came with the branch. Record in `api/AGENTS.md` → Geography **where the coordinates
     came from** and that **19,195 of 19,496** codes have them (owner ruling G2: trust the data; missing →
     0 km).
3. Production: `RelianceProdDB` must also be at `f9c2d8a3e17b` **with the data loaded** before Task 10
   publishes. Ask the owner (memory: the owner runs prod migrations). Verification query, read-only:

```sql
SELECT count(*) AS total, count(latitude) AS with_point FROM pincodes;   -- expect 19496 / ~19195
SELECT version_num FROM alembic_version;                                  -- expect f9c2d8a3e17b (or later)
```

## 4. API / service changes

### 4.1 pytest, pure tests only

**Owner ruling X1: API tests never touch a database.** pytest is for pure functions (parsers,
calculators, state machines). Database behaviour is proven by each task's acceptance criteria and by
`api/app/scripts/seed/verify.py`.

Files to create:

| File | Content |
|---|---|
| `api/requirements-dev.txt` | `-r requirements.txt` then `pytest==8.*` pinned to the newest 8.x at implementation time. **Do not** add pytest to `requirements.txt` — that file is what Oryx installs on Azure (`scripts/publish.py`), and test tooling must not ship. |
| `api/pytest.ini` | `[pytest]` · `testpaths = tests/unit` · `addopts = -q --strict-markers` · `pythonpath = .` |
| `api/tests/__init__.py`, `api/tests/unit/__init__.py` | empty |
| `api/tests/unit/conftest.py` | A guard fixture, `autouse=True`, that monkeypatches `sqlalchemy.ext.asyncio.create_async_engine` and `psycopg.connect` / `psycopg.AsyncConnection.connect` to raise `RuntimeError("unit tests must not touch a database (00-index X1)")`. Also sets placeholder env vars **before** any `app` import (`POSTGRES_HOST=localhost`, `POSTGRES_DB=unit`, `POSTGRES_USER=unit`, `POSTGRES_PASSWORD=unit`, `JWT_SECRET_KEY=unit-test-secret`) via `os.environ.setdefault` at module top, because `app/core/config.py` instantiates `Settings()` at import time and fails without them. |
| `api/tests/unit/test_coordinates.py` | The harness's own proof: tests the **existing** `app/core/coordinates.metres_between` and `metres_label`. |

Cases for `test_coordinates.py` (they pin behaviour Task 10 relies on):

1. Same point → `0.0`.
2. Symmetry: `metres_between(a, b) == metres_between(b, a)`.
3. Known distance: Hyderabad (17.385, 78.4867) ↔ Bengaluru (12.9716, 77.5946) ≈ 500 km, ±1 %.
4. One degree of latitude ≈ 111,195 m (±0.5 %) — spherical `EARTH_RADIUS_M` as in the module.
5. `metres_label` formats metres and kilometres the way the module already does (read it, then assert
   its current outputs; this test documents, it does not redesign).

**Rule for every later task:** a module tested here must be importable without a database. If a pure
function lives beside DB code, the test imports only the pure symbol; if importing the module pulls in an
engine, move the pure function to its own module in `app/core/` (index §3.7 names them).

### 4.2 CI

Edit `.github/workflows/pr-check.yml`, `api` job. Keep the existing compile and import steps, then add:

```yaml
      - run: pip install -r requirements-dev.txt
      - name: Unit tests (pure — no database, see RequirementDocs/franchisee/00-index.md X1)
        run: python -m pytest
```

Rename the job to `api — import check & unit tests` and replace its comment block's "no pytest
configured" sentence with one line pointing at `pytest.ini`. Update `.github/DEPLOYMENT.md` decision #9
the same way.

## 5. Client changes

### 5.1 adminWeb — vitest

1. Install: `npm i -D vitest @vitest/coverage-v8 jsdom @testing-library/react @testing-library/jest-dom`.
   **Version check:** adminWeb is on **Vite 8** and **React 19.2**. Pick the vitest major whose
   `peerDependencies.vite` includes `^8` (`npm view vitest@latest peerDependencies`); if none does yet,
   stop and report rather than downgrading Vite.
2. `adminWeb/vitest.config.ts`: `mergeConfig` with `vite.config.ts` (so the `@/` alias resolves),
   `test: { environment: 'jsdom', include: ['src/**/*.test.{ts,tsx}'], setupFiles: ['src/test/setup.ts'] }`.
3. `adminWeb/src/test/setup.ts`: `import '@testing-library/jest-dom/vitest'`.
4. `package.json` scripts: `"test": "vitest run"`, `"test:watch": "vitest"`.
5. `tsconfig.app.json`: add `"vitest/globals"` to `types` **only if** globals are enabled; the
   recommendation is **no globals** (import `describe/it/expect` explicitly), which needs no tsconfig
   change. Make sure `tsc -b` still excludes nothing it used to include.
6. ESLint: test files are still linted. If `eslint.config.js` flags them (for example, the
   react-refresh rule), add a scoped override for `**/*.test.{ts,tsx}`, not a global disable.
7. Harness proof: `adminWeb/src/lib/format.test.ts`, or whichever small pure util already exists (grep
   `src/lib` for a money or date formatter). Test 3–5 existing behaviours. Do not change the util.

### 5.2 mobileapp — jest-expo

1. Install with Expo's resolver so versions match SDK 54:
   `npx expo install jest-expo jest @types/jest -- --save-dev`, plus
   `npm i -D @testing-library/react-native` (version per its React 19.1 / RN 0.81 peer range).
   These are **dev dependencies, not native modules**; nothing here needs a new build (root AGENTS.md
   native-module rule is not triggered).
2. `package.json`:
   - `"test": "jest"`
   - `"jest": { "preset": "jest-expo", "testMatch": ["**/__tests__/**/*.test.ts?(x)"], "moduleNameMapper": { "^@/(.*)$": "<rootDir>/src/$1" }, "transformIgnorePatterns": [...] }`.
   For `transformIgnorePatterns`, take the jest-expo README pattern and add `nativewind`,
   `react-native-css-interop` and `@expo-google-fonts/.*`.
3. `jest.setup.ts`: initialise i18n for tests:
   - import `src/i18n/index.ts` if it can run without native modules;
   - otherwise mock `expo-localization` to return `en`.
   Wire it via `"setupFilesAfterEnv": ["<rootDir>/jest.setup.ts"]`.
4. ESLint (`eslint.config.js`): the "no English in components" rule must not flag test files' `describe`
   strings. Add a scoped override for `**/__tests__/**`.
5. `npm run lint` must not try to run jest, and `i18n:check` stays as it is.
6. Harness proof: `mobileapp/src/lib/__tests__/coordinates.test.ts` covers the existing
   `src/lib/coordinates.ts` haversine (same cases 1–4 as the Python test). The two implementations must
   agree, so add one case asserting the Hyderabad↔Bengaluru figure equals the Python test's expected
   value within 1 m.

### 5.3 CI for the clients

In `.github/workflows/pr-check.yml`, add `- run: npm test` after `typecheck` in the `adminweb` and
`mobileapp` jobs.

## 6. Unit tests

| Path | Cases |
|---|---|
| `api/tests/unit/test_coordinates.py` | §4.1 cases 1–5 |
| `api/tests/unit/test_no_db_guard.py` | Calling `create_async_engine("postgresql+psycopg://x/y")` inside a test raises the guard's `RuntimeError`. This proves the X1 wall exists. |
| `adminWeb/src/lib/<existing-util>.test.ts` | 3–5 cases pinning current behaviour |
| `mobileapp/src/lib/__tests__/coordinates.test.ts` | §5.2 cases |

## 7. Acceptance criteria

1. **Given** `dev` after this task, **when** `cd api && python -m alembic heads`, **then** exactly one head is printed and `f9c2d8a3e17b` is in `python -m alembic history`.
2. **Given** RelianceDB, **when** the §3.1 SQL runs, **then** about 19,195 of 19,496 pincodes have a point and the version is `f9c2d8a3e17b` or later.
3. **Given** a clean checkout, **when** `cd api && pip install -r requirements-dev.txt && python -m pytest`, **then** all tests pass, no `.env` is needed, and no network or database connection is attempted. Check by running with the network off, or by seeing the guard test pass.
4. **Given** `api/requirements.txt`, **then** it does not contain pytest. `scripts/publish.py` packaging is unchanged.
5. **Given** `adminWeb/`, **when** `npm ci && npm run lint && npm run typecheck && npm test`, **then** all are green and `npm run build` still succeeds.
6. **Given** `mobileapp/`, **when** `npm ci && npm run lint && npm run typecheck && npm test`, **then** all are green and `npx expo-doctor` reports no new dependency mismatch.
7. **Given** a PR into `dev`, **then** the three PR-check jobs run their unit tests and a deliberately failing test fails the job. Verify once on a throwaway branch, then delete it.
8. `api/AGENTS.md` (Geography + a new short "Unit tests" section), `adminWeb/AGENTS.md` and root `AGENTS.md` Commands list `pytest` / `npm test`.

## 8. Out of scope and traps

- **No database tests.** Do not add a test database, Docker Postgres, or fixtures that call the dev DB.
  The owner declined them (X1). The guard fixture exists to stop this happening by accident.
- `requirements.txt` ships to Azure. Test tools go only in `requirements-dev.txt`.
- `app/core/config.py` builds `Settings()` at import time. Set the placeholder env vars in the
  conftest **module body**, not in a fixture, or collection fails before fixtures run.
- **adminWeb is Tailwind v4 / Vite 8 and mobileapp is NativeWind 4 / Tailwind 3.** Do not share a test
  config between them.
- mobileapp must not gain a native module here. `@testing-library/react-native` and jest-expo are JS
  only.
- Do not "fix" the known bad coordinates (for example 500032). The owner ruled to trust the data (G2).
