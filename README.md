# Homewise API

Express REST API for household budgeting, inventory, price imports, shopping plans and account administration. Database access uses Prisma 7.10.1 with SQL Server or Azure SQL Database. Local Windows development supports integrated authentication; Vercel uses the JavaScript SQL driver and SQL authentication. Financial and quantity calculations use decimal arithmetic.

For Vercel Hobby deployment, environment variables, Azure migrations and networking, see [deployment instructions](DEPLOYMENT.md).

## Prerequisites

- Windows with Node.js 24 LTS (64-bit), npm and Git. `.nvmrc` and `package.json` record the supported Node major version.
- SQL Server 2022 and Microsoft ODBC Driver 17 for SQL Server (64-bit).
- A Windows account permitted to create/use the dedicated application database. The API and Prisma migration commands run as this account.
- The native `msnodesqlv8` dependency must match the Node version and architecture. Keep npm install scripts enabled; if a matching prebuilt binary is unavailable, its installer requires the Windows native build tools and Python.

This repository runs independently of the frontend checkout. The companion Homewise web app connects to `/api/v1`; placing its checkout in a sibling `app` directory is optional.

## Run

```powershell
npm ci
if (!(Test-Path .env)) { Copy-Item .env.example .env }
# Configure .env and create the empty SQL Server database before continuing.
npm run auth:setup
npm run db:generate
npm run db:deploy
npm run db:seed
npm run dev
```

Create the dedicated database first if it is absent. Configure `.env` for the actual SQL Server instance; defaults are `localhost` and database `HouseholdBudgetGrocery`. Keep `DATABASE_URL` (Prisma migrations) consistent with `SQL_SERVER` and `SQL_DATABASE` (runtime). No database password is required. Local TLS trusts the development certificate by default; set `SQL_TRUST_CERTIFICATE=false` with a verifiable server certificate when appropriate.

The API listens on `127.0.0.1:4000`. `APP_ORIGIN` defaults to `http://localhost:5173`; browser development uses the Vite proxy. Household routes require a JWT and are isolated by the signed-in account. Administration requires the admin role.

## Layout

| Location | Responsibility |
| --- | --- |
| `prisma/schema.prisma`, `prisma/migrations/` | Relational SQL Server models and tracked initial migration |
| `src/domain.ts` | Budget, stock, conversions, pack costs and bounded optimisation |
| `src/budget.ts` | Settings, monthly budgets, expense settlements and reports |
| `src/inventory.ts` | Inventory batches/movements, replenishment, purchase confirmation/corrections |
| `src/catalogue.ts`, `src/providers.ts` | Source registry, imports, product matching and provider contract |
| `src/planning.ts` | Store rules, saved results, approval and purchase-draft handoff |
| `src/assistant.ts` | Configurable AI service, grounding checks and explicit list changes |
| `src/vendor/` | Documented Apache-2.0 adaptation of Prisma's SQL Server adapter for current-user Windows authentication |
| `src/contract.ts`, `openapi.json` | Route contract and shared wire schemas |
| `tests/` | Deterministic and isolated SQL integration scenarios |

Generated Prisma code is excluded from Git. Run `db:generate` after installation and schema changes. Transactions use serializable isolation with revision checks; confirmation and import mutations require `Idempotency-Key` headers.

## Build and test

```powershell
npm test
npm run test:sql
npm run build
npm start
```

`npm run check` runs the deterministic tests, production build and contract consistency check without requiring a live database. Run `npm audit` to check the full locked dependency tree. SQL integration tests are separate and require the local prerequisites and development seed above.

`test:sql` requires access to the configured database and seeded household, creates uniquely named test records and removes only those records. Live model calls are not needed; AI validation tests use a local mock endpoint.

`npm run contract` exports `openapi.json`. The running API also serves `/api/v1/openapi.json`. Request schemas and paths are generated from the same registration used by Express. Core response models are defined in `src/contract.ts`; some detailed result responses are intentionally open schemas in this prototype.

## Limits

- Optimisation accepts 1–30 items, up to 10 eligible stores and a maximum of 5 used stores. Assignment search is bounded at 100,000 visited nodes; deferral comparisons are bounded at 10,000 nodes each. Results state whether search completed and never claim a proven optimum after a cap.
- Each item is fulfilled from one listing/store, in whole packages. Unsupported conditional promotions are excluded when marked with `conditional:`.
- Imports accept at most 1,000 rows and 2 MB of text. All rows must pass validation before commit. Conflicting snapshots and SKU/package changes abort the transaction.
- Saved import previews, calculation snapshots and minimal AI evaluation results use validated JSON text; core expense, stock, product, price, purchase and store-rule records are relational.
- AI requires backend environment settings. API credentials never go to the frontend. There is no authorised live supermarket provider yet.

See [Windows adapter notes](src/vendor/README.md) before changing pinned Prisma packages.

## Accounts, JWT and demo users

Run `npm run auth:setup` once to generate a private JWT key in `.env`, then `npm run db:deploy` and `npm run db:demo`. The database still uses Windows authentication; web login credentials are separate application accounts.

Development accounts: `admin@homewise.demo` (admin), `alice@homewise.demo` and `ben@homewise.demo` (household), initially using **HomewiseDemo!2026**. Seeds preserve changed passwords and existing records; they refuse production mode.

Access JWTs live for 15 minutes. Refresh cookies are HttpOnly, SameSite=Strict, rotate on use and expire after seven days. Production cookies are Secure. Logout and administrative access changes revoke server sessions immediately. Passwords use salted scrypt hashes. The API applies tenant ownership to all feature queries and foreign references, including nested inserts and saved results.

See `src/auth.ts`, `src/admin.ts`, `src/tenant.ts` and the authentication tests. `systemDb` is reserved for authentication, guarded administration, migrations and isolated test/seed maintenance; feature services use the scoped `db` facade. Do not bypass the scoped facade for household features.

## Repository maintenance

Commit `package-lock.json`, `.env.example`, `openapi.json`, Prisma schema/migrations, source, scripts and tests. Environment files, generated Prisma code, build output, database backups and private keys are ignored. Never put real household exports or credentials in fixtures.

The `@prisma/config` dependency has a scoped override to patched `effect` 3.22.5. This resolves [GHSA-7589-6fvf-x4pw](https://github.com/advisories/GHSA-7589-6fvf-x4pw) while preserving the pinned Prisma 7.10.1 adapter family. Review this override when upgrading Prisma. CSV parsing uses the patched 7.x release; the Windows adapter's upstream licence and modification notes remain in `src/vendor/`.

The GitHub Actions workflow checks fresh Windows and Linux installs, generation, tests, build, contract and dependency audit. It does not deploy or run SQL integration tests against a developer's database.

This is a local research prototype. Publishing source does not configure public hosting. Demo accounts have public development credentials; public deployment needs separate provisioning and security review. An application licence has not been selected; the third-party Prisma licence applies to the vendored adapter.
