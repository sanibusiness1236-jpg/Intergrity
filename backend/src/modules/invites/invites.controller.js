const crypto = require("crypto");
const prisma = require("../../config/db");
const { AppError } = require("../../middleware/errorHandler");

const VALID_ROLES = ["STUDENT", "EXAMINER", "INVIGILATOR"];

async function requireSuperAdmin(userId) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true, isSuperAdmin: true } });
  if (!user || (!user.isSuperAdmin && user.role !== "ADMIN")) {
    throw new AppError("Access denied — Super Admin only", 403);
  }
}

async function createInvite(req, res, next) {
  try {
    await requireSuperAdmin(req.user.id);

    const { role, expiresAt, singleUse, maxUses, note } = req.body;

    if (!VALID_ROLES.includes(role)) {
      throw new AppError(`Role must be one of: ${VALID_ROLES.join(", ")}`, 400);
    }
    if (!expiresAt) throw new AppError("Expiry date is required", 400);
    const expiry = new Date(expiresAt);
    if (isNaN(expiry.getTime()) || expiry <= new Date()) {
      throw new AppError("Expiry must be a future date/time", 400);
    }

    const isSingle = singleUse !== false && singleUse !== "false";
    const uses = isSingle ? 1 : Math.max(1, parseInt(maxUses, 10) || 10);

    const token = crypto.randomBytes(24).toString("hex");

    const invite = await prisma.inviteLink.create({
      data: {
        token,
        role,
        expiresAt: expiry,
        singleUse: isSingle,
        maxUses: uses,
        createdById: req.user.id,
        note: note?.trim() || null,
      },
    });

    res.status(201).json({ success: true, data: invite });
  } catch (err) {
    next(err);
  }
}

async function listInvites(req, res, next) {
  try {
    await requireSuperAdmin(req.user.id);

    const invites = await prisma.inviteLink.findMany({
      where: { createdById: req.user.id },
      orderBy: { createdAt: "desc" },
    });

    res.json({ success: true, data: invites });
  } catch (err) {
    next(err);
  }
}

async function revokeInvite(req, res, next) {
  try {
    await requireSuperAdmin(req.user.id);

    const invite = await prisma.inviteLink.findUnique({ where: { id: req.params.id } });
    if (!invite || invite.createdById !== req.user.id) {
      throw new AppError("Invite not found", 404);
    }

    await prisma.inviteLink.update({ where: { id: req.params.id }, data: { isActive: false } });
    res.json({ success: true, message: "Invite revoked" });
  } catch (err) {
    next(err);
  }
}

async function validateToken(req, res, next) {
  try {
    const { token } = req.params;
    const invite = await prisma.inviteLink.findUnique({ where: { token } });

    if (!invite || !invite.isActive) {
      throw new AppError("Invalid invitation link", 400);
    }
    if (new Date() > invite.expiresAt) {
      throw new AppError("This invitation link has expired", 400);
    }
    if (invite.usedCount >= invite.maxUses) {
      throw new AppError("This invitation link has already been fully used", 400);
    }

    res.json({
      success: true,
      data: {
        role: invite.role,
        expiresAt: invite.expiresAt,
        singleUse: invite.singleUse,
        usesRemaining: invite.maxUses - invite.usedCount,
      },
    });
  } catch (err) {
    next(err);
  }
}

async function listExaminers(req, res, next) {
  try {
    await requireSuperAdmin(req.user.id);

    const users = await prisma.user.findMany({
      where: { role: { in: ["EXAMINER", "ADMIN"] }, isActive: true },
      select: { id: true, firstName: true, lastName: true, email: true, role: true, isSuperAdmin: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    });

    res.json({ success: true, data: users });
  } catch (err) {
    next(err);
  }
}

async function grantSuperAdmin(req, res, next) {
  try {
    await requireSuperAdmin(req.user.id);

    const target = await prisma.user.findUnique({ where: { id: req.params.userId } });
    if (!target) throw new AppError("User not found", 404);
    if (target.role === "STUDENT" || target.role === "INVIGILATOR") {
      throw new AppError("Super Admin can only be granted to Examiners or Admins", 400);
    }

    const updated = await prisma.user.update({
      where: { id: req.params.userId },
      data: { isSuperAdmin: !target.isSuperAdmin },
      select: { id: true, firstName: true, lastName: true, email: true, isSuperAdmin: true },
    });

    res.json({ success: true, data: updated });
  } catch (err) {
    next(err);
  }
}

module.exports = { createInvite, listInvites, revokeInvite, validateToken, listExaminers, grantSuperAdmin };
