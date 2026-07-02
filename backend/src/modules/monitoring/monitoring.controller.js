const prisma = require("../../config/db");
const { AppError } = require("../../middleware/errorHandler");

async function reportFlag(req, res, next) {
  try {
    const { sessionId, flagType, metadata } = req.body;

    const session = await prisma.examSession.findUnique({ where: { id: sessionId } });
    if (!session) throw new AppError("Session not found", 404);

    const flag = await prisma.behavioralFlag.create({
      data: {
        sessionId,
        studentId: session.studentId,
        flagType,
        metadata,
      },
    });

    res.status(201).json({ success: true, data: flag });
  } catch (err) {
    next(err);
  }
}

async function getFlags(req, res, next) {
  try {
    const where = {};
    if (req.query.sessionId) where.sessionId = req.query.sessionId;
    if (req.query.studentId) where.studentId = req.query.studentId;
    if (req.query.flagType) where.flagType = req.query.flagType;

    const flags = await prisma.behavioralFlag.findMany({
      where,
      include: {
        student: { select: { id: true, firstName: true, lastName: true, studentId: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    res.json({ success: true, data: flags });
  } catch (err) {
    next(err);
  }
}

async function getFlagSummary(req, res, next) {
  try {
    const { examId } = req.params;

    // Two targeted queries instead of one massive join that loads every flag row.
    // groupBy gives us per-session flag-type counts in a single round-trip.
    const [sessions, flagGroups] = await Promise.all([
      prisma.examSession.findMany({
        where: { examId },
        select: {
          studentId: true,
          student: { select: { id: true, firstName: true, lastName: true, studentId: true } },
        },
      }),
      prisma.behavioralFlag.groupBy({
        by: ["sessionId", "flagType"],
        where: { session: { examId } },
        _count: { _all: true },
      }),
    ]);

    // Build a lookup: sessionId → { flagType: count }
    const flagsBySession = {};
    for (const g of flagGroups) {
      if (!flagsBySession[g.sessionId]) flagsBySession[g.sessionId] = {};
      flagsBySession[g.sessionId][g.flagType] = g._count._all;
    }

    // Map sessions → student_id to session_id
    const sessionForStudent = {};
    const [sessionRows] = await Promise.all([
      prisma.examSession.findMany({
        where: { examId },
        select: { id: true, studentId: true },
      }),
    ]);
    for (const s of sessionRows) sessionForStudent[s.studentId] = s.id;

    const summary = sessions.map((s) => {
      const sessionId = sessionForStudent[s.studentId];
      const breakdown = flagsBySession[sessionId] || {};
      const totalFlags = Object.values(breakdown).reduce((a, b) => a + b, 0);
      return {
        studentId: s.studentId,
        student: s.student,
        totalFlags,
        flagBreakdown: breakdown,
      };
    });

    res.json({ success: true, data: summary });
  } catch (err) {
    next(err);
  }
}

module.exports = { reportFlag, getFlags, getFlagSummary };
