const { PrismaClient } = require("@prisma/client");

// Reuse the same PrismaClient instance across the entire process so we
// don't open a new DB connection pool for every imported module.
// In serverless / module-reload scenarios the global guard prevents leaks.
const globalForPrisma = global;

if (!globalForPrisma._prisma) {
  globalForPrisma._prisma = new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"],
    datasources: {
      db: {
        // Supabase / Postgres connection string.
        // Append ?pgbouncer=true&connection_limit=10 to the DATABASE_URL
        // in your Render env vars to enable PgBouncer session pooling.
        url: process.env.DATABASE_URL,
      },
    },
  });
}

const prisma = globalForPrisma._prisma;

module.exports = prisma;
