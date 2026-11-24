# Vercel Hobby and Azure SQL deployment

The API uses Node 24, the Express preset and the root `index.js`. `vercel.json` sets
the build command, omits the optional local Windows driver, and places the
function in Sydney (`syd1`) near an Australia East SQL database. Builds generate
Prisma and compile TypeScript; they never migrate or seed a database. The root
entry imports `dist/application.js`, so Vercel runs the ESM output of the checked
TypeScript build. The application factory is named `src/application.ts` to avoid
being mistaken for another deployable Express entry. Keep `src/app.ts` and
`src/index.ts` absent. `npm run test:deployment` checks this exact compiled entry
with Node, including Helmet's security headers, after `npm run build`.

## API project environment variables

Add these in Vercel Project Settings > Environment Variables for Production.
Redeploy after changing values. Never commit secrets or a populated `.env`.

| Name | Value |
| --- | --- |
| `SQL_AUTH` | `sql` |
| `SQL_SERVER` | Your full Azure logical server hostname, ending `.database.windows.net` |
| `SQL_DATABASE` | `HouseholdBudgetGrocery` (or your actual database name) |
| `SQL_PORT` | `1433` |
| `SQL_USER` | Dedicated database runtime login |
| `SQL_PASSWORD` | That login's password |
| `SQL_TRUST_CERTIFICATE` | `false`; Azure certificate verification is always enabled |
| `COOKIE_SECURE` | `true` |
| `JWT_SECRET` | A newly generated private random signing key, at least 32 bytes |
| `APP_ORIGIN` | Exact frontend production origin, such as `https://your-app.vercel.app`, without trailing slash |
| `AI_BASE_URL` | Optional OpenAI-compatible provider base URL, reachable from Vercel |
| `AI_MODEL` | Provider's model ID, required for AI assistance |
| `AI_API_KEY` | Provider API key, required for AI assistance |

Vercel sets production `NODE_ENV` itself. A local AI endpoint on `localhost`
cannot be reached from a hosted function. Azure credits do not pay an external
AI provider. Without AI settings the normal application features remain usable.

Generate a signing key privately on your computer, then paste it into Vercel:

```powershell
node -e "process.stdout.write(require('node:crypto').randomBytes(48).toString('base64url'))"
```

Leave `DATABASE_URL` out of Vercel runtime settings; the runtime reads the
`SQL_*` settings above. Use `DATABASE_URL` only in your private migration shell.

## Prepare the database once

1. In a private local shell, set `DATABASE_URL` to the Azure SQL migration
   connection string using a database owner account. Keep it out of shell history
   and committed files. Prisma SQL Server URLs use semicolon-separated options;
   escape special characters in credentials using Prisma's documented syntax.
2. Run `npm run db:deploy` against the intended Azure database.
3. Give the API runtime login only the database permissions the app requires;
   do not use the migration administrator as the deployed runtime login.
4. Do not run the development demo seed on the public production database.
   Register a new household through the app with your own password.

## Networking

Vercel Hobby has dynamic outbound IPs. A SQL firewall rule containing only your
computer's IP permits local migrations, but does not permit Vercel connections.
Azure's "Allow Azure services" option does not grant Vercel's AWS hosts access.
Choose a network access policy deliberately; this deployment does not widen the
Azure firewall. A firewall or login failure makes `/api/v1/health` return 503.

## Frontend project

Use Vite, Node 24, `npm ci`, `npm run build`, output `dist`. Proxy
`/api/:path*` to the API's stable production domain with the same suffix in the
frontend `vercel.json`. Leave `VITE_API_URL` unset so requests and refresh cookies
use the frontend origin. Set API `APP_ORIGIN` to that frontend origin. Do not
point the frontend at a protected preview deployment or temporary build URL.

## Verify

- `/` returns a small service response without querying SQL. This confirms the
  function starts, not database readiness.
- `/api/v1/openapi.json` serves the route contract without SQL.
- `/api/v1/health` must return 200 before testing database features.
- Register, sign in, refresh the page, perform a household operation and sign out.
- Test one AI request once real provider settings have been added.

The authentication attempt limiter is per function instance. A public production
rollout beyond this limited demo needs a shared limiter or suitable platform
rate limits. Tenant isolation and token validation still apply to every instance.

Local Windows development continues to use `npm ci` (including optional
`msnodesqlv8`), `SQL_AUTH=windows`, and the installed ODBC driver. Linux builds
use `npm ci --omit=optional`; the native driver is never loaded in SQL mode.
