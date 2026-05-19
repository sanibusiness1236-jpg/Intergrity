# Supabase + Upstash Migration Runbook

This guide walks through moving INTEGRITY off local pgAdmin/Postgres and Redis
onto fully managed, internet-accessible services so the platform can be hosted
online.

| Layer | Was | Becomes |
|---|---|---|
| Database | Local Postgres (managed via pgAdmin 4) | **Supabase Postgres** |
| Cache / sessions | Local Redis | **Upstash Redis** |
| Backend | Local Node/Express | Render / Railway / Fly / EC2 (any Node host) |
| ML service | Local FastAPI | Render / Railway / Fly (Python host) |
| Frontend | Local Vite/Next | Vercel / Netlify |

The application code does **not** need to change. Only environment variables
and one Prisma config block are touched. Both swaps have already been wired
into the repo:

- `backend/prisma/schema.prisma` now reads `DATABASE_URL` for runtime and
  `DATABASE_URL_DIRECT` for migrations.
- `backend/.env.example` documents the new Supabase + Upstash format.

---

## Why Supabase (and not "use pgAdmin in the cloud")

pgAdmin is a *client* — it doesn't host the database, it only connects to one.
Your local Postgres server is what's not reachable from the internet. Supabase
gives you the same Postgres engine, hosted, with TLS, automatic backups, and a
public connection string the deployed backend can reach. Nothing about the
Prisma schema, queries, or business logic changes — Supabase *is* Postgres.

You are using Supabase as a **managed Postgres host only**. You are not adopting
Supabase Auth (you already have JWT + bcrypt + a `User` table), and you are not
using the Supabase JS client in the frontend (the frontend calls your Express
API, which talks to Postgres via Prisma).

---

## 1. Create the Supabase project

1. Sign in at [supabase.com](https://supabase.com).
2. **New project** -> name `integrity` (or any).
3. Region: pick the one closest to you / your users. For Ghana, `eu-west-3`
   (Paris) is typically the lowest latency; `us-east-1` is a fine fallback.
4. **Database password** — generate a strong one and store it in a password
   manager. You will not be shown it again.
5. Wait ~2 minutes for provisioning.

## 2. Collect both connection strings

Open **Project Settings -> Database -> Connection string**. You need two
different URIs:

| Purpose | Tab in Supabase | Port | Used as |
|---|---|---|---|
| App runtime queries | **Transaction pooler** | `6543` | `DATABASE_URL` |
| Prisma migrations / schema introspection | **Direct connection** | `5432` | `DATABASE_URL_DIRECT` |

Why both? Supabase routes pooled connections through PgBouncer in *transaction*
mode, which does not support the prepared statements Prisma uses for
migrations. Runtime queries are fine through the pooler — migrations must use
a direct connection.

Copy them into `backend/.env` (not committed):

```bash
DATABASE_URL="postgresql://postgres.PROJECT_REF:PASSWORD@aws-0-REGION.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1"
DATABASE_URL_DIRECT="postgresql://postgres.PROJECT_REF:PASSWORD@aws-0-REGION.pooler.supabase.com:5432/postgres"
```

> Tip: the `?pgbouncer=true&connection_limit=1` flags on `DATABASE_URL` are
> mandatory for Prisma against Supabase's pooler. Don't drop them.

## 3. Apply the schema to Supabase

From `backend/`:

```bash
npm install
npx prisma generate
npx prisma migrate dev --name init
```

`migrate dev` will:
- Connect via `DATABASE_URL_DIRECT` (port 5432).
- Create a `prisma/migrations/<timestamp>_init/` folder — **commit this folder
  to git**. Production deploys reuse it via `prisma migrate deploy`.
- Apply every model in `schema.prisma` to Supabase as real tables.

Verify in **Supabase Dashboard -> Table Editor**. You should see
`institutions`, `users`, `exams`, `questions`, `venues`, `seating_assignments`,
`exam_sessions`, `answers`, `behavioral_flags`, `integrity_predictions`,
`invigilator_reports`.

## 4. (Optional) Move existing pgAdmin data into Supabase

Skip this section if your local DB only has test/scratch data.

```bash
# From a machine that has both pgAdmin's Postgres and pg_dump:
pg_dump --data-only --disable-triggers \
  -h localhost -U postgres -d integrity \
  -f integrity_data.sql

# Push it into Supabase using the DIRECT URL (port 5432):
psql "$DATABASE_URL_DIRECT" -f integrity_data.sql
```

Notes:
- `--data-only` because Prisma already created the tables in step 3.
- `--disable-triggers` lets `psql` skip FK / constraint checks during the bulk
  load (constraints are still enforced after the load completes).
- If `pg_dump` complains about version mismatch, use the version that ships
  with your local Postgres install (matching majors).

## 5. Lock the tables down with RLS

Supabase exposes a REST API (PostgREST) over every table by default, gated by
**Row Level Security**. Because your frontend only talks to *your* Express
backend (not directly to Supabase), the safest configuration is:

1. **Authentication -> Policies** in the Supabase dashboard.
2. For each Prisma-managed table, **Enable RLS** with **zero policies**.
3. Result: anonymous / authenticated client keys can't read or write anything.
   Only connections that authenticate with your DB password (i.e. your
   Express backend via Prisma) can touch the data.

You can re-enable specific Supabase features (storage, realtime, edge
functions) later without affecting this.

## 6. Switch Redis to Upstash

The repo uses Redis for sessions and exam auto-save (`ioredis`). Localhost
Redis can't be reached from a deployed backend, so swap to **Upstash Redis**:

1. [console.upstash.com](https://console.upstash.com) -> **Create Database**.
2. Choose the same region as Supabase if possible.
3. On the database page, open the **Node / ioredis** tab and copy the
   `rediss://` connection string (TLS — note the double `s`).
4. Set `REDIS_URL` in `backend/.env` (and in your hosting provider's env vars):

```bash
REDIS_URL="rediss://default:UPSTASH_PASSWORD@HOST.upstash.io:6379"
```

No code change needed — `backend/src/config/env.js` already reads
`process.env.REDIS_URL`, and `ioredis` handles TLS automatically when the URL
starts with `rediss://`.

## 7. Deploy the backend

Any Node host works (Render, Railway, Fly.io, EC2, Cloud Run). Use this build
+ start sequence on the host:

```bash
# Install
npm ci

# Generate Prisma client
npx prisma generate

# Apply migrations to the live database
#   - use `migrate deploy`, NOT `migrate dev`, in production
#   - it applies any committed migrations and exits non-zero on failure
npx prisma migrate deploy

# Start the server
node src/server.js
```

Environment variables the host needs:

| Variable | Source |
|---|---|
| `DATABASE_URL` | Supabase pooler URI (port 6543) |
| `DATABASE_URL_DIRECT` | Supabase direct URI (port 5432) |
| `REDIS_URL` | Upstash `rediss://` URI |
| `JWT_SECRET` | A long random string (e.g. `openssl rand -hex 64`) |
| `JWT_REFRESH_SECRET` | A different long random string |
| `JWT_EXPIRES_IN` | `15m` |
| `JWT_REFRESH_EXPIRES_IN` | `7d` |
| `ML_SERVICE_URL` | Public URL of the deployed FastAPI service |
| `PORT` | Whatever the host expects (often injected automatically) |
| `NODE_ENV` | `production` |

## 8. Smoke test

```bash
# Check the backend connected
curl https://your-backend.example.com/api/health

# Confirm tables exist (run from your laptop via the direct URL)
psql "$DATABASE_URL_DIRECT" -c "\dt"
```

You should see all the tables Prisma created.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `prisma migrate` hangs forever | Using the pooler URL for migrations | Set `directUrl` in `schema.prisma` and `DATABASE_URL_DIRECT` in env |
| `prepared statement "s0" already exists` at runtime | Missing `pgbouncer=true` flag on the pooler URL | Append `?pgbouncer=true&connection_limit=1` to `DATABASE_URL` |
| Random connection drops in production | Too many connections, no `connection_limit` | Ensure pooler URL has `connection_limit=1` (Prisma manages its own pool on top of PgBouncer) |
| `permission denied for schema public` after enabling RLS | Tried to use Supabase `anon` key instead of the DB password | You don't need anon keys; backend should use the DB connection string directly |
| Upstash returns `ECONNRESET` immediately | Used `redis://` instead of `rediss://` | Switch to the TLS URL (`rediss://`) |
| Local dev still wants to use Supabase | `.env` has Supabase URL | Override `DATABASE_URL` to `postgresql://postgres:password@localhost:5432/integrity` for local; leave `DATABASE_URL_DIRECT` matching |

---

## What did *not* change

- `prisma/schema.prisma` — all 12 models, all relations, all enums: identical.
- `src/config/db.js` — still `new PrismaClient(...)`.
- `src/config/env.js` — still reads `DATABASE_URL` and `REDIS_URL`.
- Auth flow — still your own JWT + `bcryptjs` against the `users` table. Do
  **not** swap to Supabase Auth; the `passwordHash` column is yours.
- Frontend — still calls the Express API, not Supabase directly.

You're moving the *host* of two services. Everything above the connection
string stays the same.
