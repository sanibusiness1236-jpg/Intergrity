const bcrypt = require("bcryptjs");
const prisma = require("../../config/db");
const { signAccessToken, signRefreshToken, verifyRefreshToken } = require("../../utils/jwt");
const { AppError } = require("../../middleware/errorHandler");

function blankToNull(v) {
  if (v === undefined || v === null) return null;
  if (typeof v === "string" && v.trim() === "") return null;
  return v;
}

async function register(req, res, next) {
  try {
    const { email, password, firstName, lastName, institutionId, studentId, program, gender, inviteToken } = req.body;

    // ── Invite token is required for all registrations ──────────────────────
    if (!inviteToken) {
      throw new AppError("Registration is by invitation only. Please use a valid invite link.", 403);
    }

    const invite = await prisma.inviteLink.findUnique({ where: { token: inviteToken } });
    if (!invite || !invite.isActive) {
      throw new AppError("Invalid or expired invitation link.", 403);
    }
    if (new Date() > invite.expiresAt) {
      throw new AppError("This invitation link has expired.", 403);
    }
    if (invite.usedCount >= invite.maxUses) {
      throw new AppError("This invitation link has already been fully used.", 403);
    }

    // Role is dictated by the invite — ignore any role sent in the body
    const role = invite.role;
    // ─────────────────────────────────────────────────────────────────────────

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new AppError("Email already registered", 409);
    }

    const isStudent = role === "STUDENT";

    const normalizedStudentId = isStudent ? blankToNull(studentId) : null;
    const normalizedProgram = isStudent ? blankToNull(program) : null;
    const normalizedGender = isStudent ? blankToNull(gender) : null;
    const normalizedInstitutionId = blankToNull(institutionId);

    if (isStudent && normalizedStudentId) {
      const dup = await prisma.user.findUnique({ where: { studentId: normalizedStudentId } });
      if (dup) {
        throw new AppError("That student ID is already in use", 409);
      }
    }

    // Cost 10 is the widely-used secure default and ~4x faster than 12.
    // On a single-core free instance, cost 12 saturates the CPU during
    // registration spikes and makes concurrent sign-ups/sign-ins time out.
    const passwordHash = await bcrypt.hash(password, 10);

    const user = await prisma.user.create({
      data: {
        email,
        passwordHash,
        firstName,
        lastName,
        role,
        institutionId: normalizedInstitutionId,
        studentId: normalizedStudentId,
        program: normalizedProgram,
        gender: normalizedGender,
      },
      select: { id: true, email: true, firstName: true, lastName: true, role: true, isSuperAdmin: true },
    });

    // Mark invite as used (deactivate if single-use / all uses exhausted)
    await prisma.inviteLink.update({
      where: { id: invite.id },
      data: {
        usedCount: { increment: 1 },
        isActive: invite.usedCount + 1 < invite.maxUses,
      },
    });

    const tokenPayload = { id: user.id, email: user.email, role: user.role };
    const accessToken = signAccessToken(tokenPayload);
    const refreshToken = signRefreshToken(tokenPayload);

    res.status(201).json({
      success: true,
      data: { user, accessToken, refreshToken },
    });
  } catch (err) {
    if (err && err.code === "P2002") {
      const fields = Array.isArray(err.meta?.target) ? err.meta.target.join(", ") : err.meta?.target || "field";
      return next(new AppError(`That ${fields} is already in use`, 409));
    }
    next(err);
  }
}

async function login(req, res, next) {
  try {
    const { email, password } = req.body;

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !user.isActive) {
      throw new AppError("Invalid credentials", 401);
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      throw new AppError("Invalid credentials", 401);
    }

    const currentIp = req.ip;
    const currentUserAgent = req.get("user-agent") || "";

    // Fire-and-forget: multi-device detection must NOT block the login response
    // or hold a DB connection on the critical path. Under concurrent sign-ins
    // awaiting this extra query starves the connection pool and times logins out.
    if (user.role === "STUDENT") {
      detectMultiDeviceLogin(user.id, currentIp, currentUserAgent).catch(() => {});
    }

    const tokenPayload = { id: user.id, email: user.email, role: user.role };
    const accessToken = signAccessToken(tokenPayload);
    const refreshToken = signRefreshToken(tokenPayload);

    res.json({
      success: true,
      data: {
        user: { id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName, role: user.role, isSuperAdmin: user.isSuperAdmin },
        accessToken,
        refreshToken,
      },
    });
  } catch (err) {
    next(err);
  }
}

async function detectMultiDeviceLogin(studentId, currentIp, currentUserAgent) {
  const activeSessions = await prisma.examSession.findMany({
    where: { studentId, status: "IN_PROGRESS" },
  });

  for (const session of activeSessions) {
    const ipMismatch = session.ipAddress && session.ipAddress !== currentIp;
    const uaMismatch = session.userAgent && session.userAgent !== currentUserAgent;

    if (ipMismatch || uaMismatch) {
      await prisma.behavioralFlag.create({
        data: {
          sessionId: session.id,
          studentId,
          flagType: "MULTI_DEVICE",
          metadata: {
            originalIp: session.ipAddress,
            newIp: currentIp,
            originalUserAgent: session.userAgent,
            newUserAgent: currentUserAgent,
            detectedAt: new Date().toISOString(),
          },
        },
      });

      try {
        const { getIO } = require("../../socket");
        getIO().to(`exam:${session.examId}`).emit("flag:new", {
          sessionId: session.id,
          studentId,
          flagType: "MULTI_DEVICE",
          createdAt: new Date(),
        });
      } catch {}
    }
  }
}

/**
 * POST /auth/reset-password
 * Self-service password reset for students. Because there is no email
 * delivery configured, identity is verified by matching BOTH the account
 * email and the student ID on record. Only STUDENT accounts can use this.
 */
async function resetPassword(req, res, next) {
  try {
    const { email, studentId, newPassword } = req.body;

    if (!email || !studentId || !newPassword) {
      throw new AppError("Email, student ID and new password are required.", 400);
    }
    if (String(newPassword).length < 6) {
      throw new AppError("New password must be at least 6 characters.", 400);
    }

    const user = await prisma.user.findUnique({ where: { email: String(email).trim() } });

    // Always respond the same way for non-matching identities to avoid leaking
    // which emails exist, but still enforce the student-ID + role checks.
    const identityOk =
      user &&
      user.role === "STUDENT" &&
      user.isActive &&
      user.studentId &&
      String(user.studentId).trim().toLowerCase() === String(studentId).trim().toLowerCase();

    if (!identityOk) {
      throw new AppError(
        "We couldn't verify your identity. Check your email and student ID, or contact your examiner.",
        400
      );
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash } });

    res.json({ success: true, message: "Password reset successful. You can now sign in." });
  } catch (err) {
    next(err);
  }
}

async function refreshToken(req, res, next) {
  try {
    const { refreshToken: token } = req.body;
    if (!token) throw new AppError("Refresh token required", 400);

    const decoded = verifyRefreshToken(token);
    const user = await prisma.user.findUnique({ where: { id: decoded.id } });
    if (!user || !user.isActive) {
      throw new AppError("Invalid refresh token", 401);
    }

    const tokenPayload = { id: user.id, email: user.email, role: user.role };
    const accessToken = signAccessToken(tokenPayload);
    const newRefresh = signRefreshToken(tokenPayload);

    res.json({ success: true, data: { accessToken, refreshToken: newRefresh } });
  } catch (err) {
    next(new AppError("Invalid refresh token", 401));
  }
}

async function getProfile(req, res, next) {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: {
        id: true, email: true, firstName: true, lastName: true, role: true,
        studentId: true, program: true, gender: true,
        institutionId: true, institution: true, createdAt: true, isSuperAdmin: true,
      },
    });
    if (!user) throw new AppError("User not found", 404);
    res.json({ success: true, data: user });
  } catch (err) {
    next(err);
  }
}

module.exports = { register, login, refreshToken, getProfile, resetPassword };
