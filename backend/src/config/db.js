const { PrismaClient } = require("@prisma/client");

// Reuse the same PrismaClient instance across the entire process so we
// don't open a new DB connection pool for every imported module.
// In serverless / module-reload scenarios the global guard prevents leaks.
const globalForPrisma = global;

/**
 * Ensure the DATABASE_URL has a healthy connection pool configuration.
 *
 * Symptom we are fixing: under concurrent load (e.g. many simultaneous
 * sign-ups) Prisma throws "Timed out fetching a new connection from the
 * connection pool (connection limit: 1)". That happens when the URL has
 * connection_limit=1 (or it defaults very low). Each request performs
 * several sequential queries, so a pool of 1 serialises everything and
 * quickly times out.
 *
 * We parse the URL and *raise* connection_limit / pool_timeout to safe
 * floors without ever lowering a value the operator set deliberately.
 */
function withPoolDefaults(rawUrl) {
  if (!rawUrl) return rawUrl;

  // Minimum healthy values for a single Render web instance.
  const MIN_CONNECTION_LIMIT = 10;
  const MIN_POOL_TIMEOUT = 30; // seconds — how long a request waits for a free conn
  const MIN_CONNECT_TIMEOUT = 15; // seconds — how long to wait for the initial TCP/TLS connect

  try {
    const url = new URL(rawUrl);

    // Detect Supabase / PgBouncer transaction pooler (port 6543 or "pooler" host).
    const isPooler =
      url.port === "6543" || /pooler\./i.test(url.hostname);

    // PgBouncer transaction mode requires Prisma to disable prepared statements.
    // Without pgbouncer=true, sporadic "prepared statement already exists" errors
    // surface under concurrency and look like random login failures.
    if (isPooler && !url.searchParams.get("pgbouncer")) {
      url.searchParams.set("pgbouncer", "true");
    }

    const currentLimit = parseInt(url.searchParams.get("connection_limit") || "0", 10);
    if (!currentLimit || currentLimit < MIN_CONNECTION_LIMIT) {
      url.searchParams.set("connection_limit", String(MIN_CONNECTION_LIMIT));
    }

    const currentTimeout = parseInt(url.searchParams.get("pool_timeout") || "0", 10);
    if (!currentTimeout || currentTimeout < MIN_POOL_TIMEOUT) {
      url.searchParams.set("pool_timeout", String(MIN_POOL_TIMEOUT));
    }

    const currentConnectTimeout = parseInt(url.searchParams.get("connect_timeout") || "0", 10);
    if (!currentConnectTimeout || currentConnectTimeout < MIN_CONNECT_TIMEOUT) {
      url.searchParams.set("connect_timeout", String(MIN_CONNECT_TIMEOUT));
    }

    return url.toString();
  } catch {
    // If the URL can't be parsed (shouldn't happen) fall back to the raw value.
    return rawUrl;
  }
}

if (!globalForPrisma._prisma) {
  globalForPrisma._prisma = new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"],
    datasources: {
      db: {
        // Supabase / Postgres connection string with enforced pool defaults.
        url: withPoolDefaults(process.env.DATABASE_URL),
      },
    },
  });
}

const prisma = globalForPrisma._prisma;

module.exports = prisma;
