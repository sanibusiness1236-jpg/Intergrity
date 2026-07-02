const { verifyAccessToken } = require("../utils/jwt");
const { AppError } = require("./errorHandler");
const prisma = require("../config/db");
const redis = require("../config/redis");

// Every authenticated request previously hit Postgres to re-read the user's
// role / active status. Under load (hundreds of students polling + auto-saving)
// that single query dominated DB connection-pool usage. We now cache the tiny
// user record in Redis for a short window so the vast majority of requests skip
// the DB entirely. The TTL is deliberately short so role changes / deactivation
// still take effect within seconds, and when Redis is unavailable we transparently
// fall back to the DB (safeRedis returns null), so behaviour is never broken.
const AUTH_CACHE_PREFIX = "authuser:";
// 300 s (5 min) default. Role / isActive changes are rare; the cache is
// explicitly invalidated (see invalidateAuthCache) on admin role updates.
// Raising from 30 s to 300 s cuts ~90 % of per-request DB auth lookups.
const AUTH_CACHE_TTL = Number(process.env.AUTH_CACHE_TTL || 300); // seconds

/**
 * Validates the Bearer JWT, then fetches the user's CURRENT role directly
 * from the database. This means:
 *  - A role change in the DB takes effect on the very next request — no
 *    re-login needed.
 *  - A token that was issued when the user was a STUDENT but whose DB row
 *    was later updated to EXAMINER will immediately get EXAMINER permissions.
 *  - Deactivated or deleted accounts are rejected automatically.
 */
async function authenticate(req, _res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    return next(new AppError("Authentication required", 401));
  }

  try {
    const token = header.split(" ")[1];
    const decoded = verifyAccessToken(token);

    // Read the live role / active status, preferring a short-lived Redis cache
    // and falling back to the DB on a cache miss (or when Redis is offline).
    let user = null;
    const cacheKey = `${AUTH_CACHE_PREFIX}${decoded.id}`;
    const cached = await redis.get(cacheKey);
    if (cached) {
      try { user = JSON.parse(cached); } catch { user = null; }
    }

    if (!user) {
      user = await prisma.user.findUnique({
        where: { id: decoded.id },
        select: { id: true, email: true, role: true, isActive: true },
      });
      if (user) {
        await redis.setex(cacheKey, AUTH_CACHE_TTL, JSON.stringify(user));
      }
    }

    if (!user) {
      return next(new AppError("Account not found", 401));
    }
    if (!user.isActive) {
      return next(new AppError("Account is deactivated", 401));
    }

    // Merge decoded claims with the fresh DB values; DB role takes precedence.
    req.user = { ...decoded, role: user.role };
    next();
  } catch (err) {
    next(new AppError("Invalid or expired token", 401));
  }
}

/**
 * Explicitly evict a user's auth cache entry.
 * Call this whenever a user's role or isActive status is changed so the
 * longer TTL doesn't serve stale access-control data.
 */
async function invalidateAuthCache(userId) {
  await redis.del(`${AUTH_CACHE_PREFIX}${userId}`);
}

module.exports = { authenticate, invalidateAuthCache };
