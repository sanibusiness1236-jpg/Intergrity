const { verifyAccessToken } = require("../utils/jwt");
const { AppError } = require("./errorHandler");
const prisma = require("../config/db");

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

    // Always read the live role and active status from the DB.
    const user = await prisma.user.findUnique({
      where: { id: decoded.id },
      select: { id: true, email: true, role: true, isActive: true },
    });

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

module.exports = { authenticate };
