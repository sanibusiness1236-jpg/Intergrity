const prisma = require("../../config/db");

/**
 * GET /anomaly/ip
 * Returns all exam sessions grouped by (examId, ipAddress) where more than
 * one student has submitted from the same IP — these are potential collusion
 * or shared-device integrity violations.
 *
 * Only returns data for exams created by the authenticated examiner.
 */
async function getIpAnomalies(req, res, next) {
  try {
    const examinerId = req.user.id;

    const exams = await prisma.exam.findMany({
      where: { createdById: examinerId },
      select: { id: true, title: true, courseCode: true, courseName: true },
    });

    const examIds = exams.map((e) => e.id);
    if (examIds.length === 0) {
      return res.json({ success: true, data: [] });
    }

    // Fetch all sessions that have an IP and a non-trivial status
    const sessions = await prisma.examSession.findMany({
      where: {
        examId: { in: examIds },
        ipAddress: { not: null },
        status: { in: ["SUBMITTED", "IN_PROGRESS", "TIMED_OUT"] },
      },
      include: {
        student: {
          select: { id: true, firstName: true, lastName: true, email: true, studentId: true },
        },
      },
      orderBy: { submittedAt: "asc" },
    });

    // Group by (examId, ipAddress)
    const grouped = {};
    for (const s of sessions) {
      if (!s.ipAddress) continue;
      const key = `${s.examId}::${s.ipAddress}`;
      if (!grouped[key]) {
        const exam = exams.find((e) => e.id === s.examId);
        grouped[key] = {
          examId: s.examId,
          examTitle: exam?.title || "",
          examCourseCode: exam?.courseCode || "",
          examCourseName: exam?.courseName || "",
          ipAddress: s.ipAddress,
          sessions: [],
        };
      }
      grouped[key].sessions.push({
        sessionId: s.id,
        student: s.student,
        status: s.status,
        startedAt: s.startedAt,
        submittedAt: s.submittedAt,
      });
    }

    // Only return groups with more than one distinct student
    const anomalies = Object.values(grouped)
      .filter((g) => g.sessions.length > 1)
      .sort((a, b) => b.sessions.length - a.sessions.length);

    res.json({ success: true, data: anomalies });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /anomaly/page-refreshes
 * Returns all PAGE_REFRESH behavioral flags for the examiner's exams,
 * grouped by student session so the examiner can see which students
 * refreshed their exam page (and how many times).
 */
async function getPageRefreshes(req, res, next) {
  try {
    const examinerId = req.user.id;

    const exams = await prisma.exam.findMany({
      where: { createdById: examinerId },
      select: { id: true, title: true, courseCode: true },
    });

    const examIds = exams.map((e) => e.id);
    if (examIds.length === 0) {
      return res.json({ success: true, data: [] });
    }

    const flags = await prisma.behavioralFlag.findMany({
      where: {
        flagType: "PAGE_REFRESH",
        session: { examId: { in: examIds } },
      },
      include: {
        session: {
          select: {
            id: true,
            examId: true,
            status: true,
            student: {
              select: { id: true, firstName: true, lastName: true, email: true, studentId: true },
            },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    // Group by sessionId
    const grouped = {};
    for (const f of flags) {
      const sid = f.sessionId;
      if (!grouped[sid]) {
        const exam = exams.find((e) => e.id === f.session.examId);
        grouped[sid] = {
          sessionId: sid,
          examId: f.session.examId,
          examTitle: exam?.title || "",
          examCourseCode: exam?.courseCode || "",
          student: f.session.student,
          sessionStatus: f.session.status,
          refreshCount: 0,
          refreshEvents: [],
        };
      }
      grouped[sid].refreshCount++;
      grouped[sid].refreshEvents.push({
        flagId: f.id,
        refreshedAt: f.metadata?.refreshedAt || f.createdAt,
        ip: f.metadata?.ip,
      });
    }

    const rows = Object.values(grouped).sort((a, b) => b.refreshCount - a.refreshCount);

    res.json({ success: true, data: rows });
  } catch (err) {
    next(err);
  }
}

module.exports = { getIpAnomalies, getPageRefreshes };
