const prisma = require("../../config/db");
const { AppError } = require("../../middleware/errorHandler");

async function getStudents(req, res, next) {
  try {
    const where = { role: "STUDENT" };
    if (req.query.institutionId) where.institutionId = req.query.institutionId;
    if (req.query.program) where.program = req.query.program;

    const students = await prisma.user.findMany({
      where,
      select: {
        id: true, email: true, firstName: true, lastName: true,
        studentId: true, program: true, gender: true, isActive: true, createdAt: true,
      },
      orderBy: { lastName: "asc" },
    });

    res.json({ success: true, data: students });
  } catch (err) {
    next(err);
  }
}

async function getStudentExams(req, res, next) {
  try {
    const { studentId } = req.params;

    const sessions = await prisma.examSession.findMany({
      where: { studentId },
      include: {
        exam: {
          select: {
            id: true,
            title: true,
            courseCode: true,
            courseName: true,
            status: true,
            isActive: true,
            startTime: true,
            endTime: true,
            maxAttempts: true,
            durationMinutes: true,
            showScoreToStudents: true,   // needed to gate score display
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    // Mask score and maxScore when the examiner has not released results.
    // The fields are nulled out so the student dashboard treats them as
    // "not yet available" without any client-side logic needed.
    const data = sessions.map((s) => {
      if (s.exam?.showScoreToStudents === false) {
        return { ...s, score: null, maxScore: null };
      }
      return s;
    });

    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

async function toggleStudentStatus(req, res, next) {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!user || user.role !== "STUDENT") {
      throw new AppError("Student not found", 404);
    }

    const updated = await prisma.user.update({
      where: { id: req.params.id },
      data: { isActive: !user.isActive },
      select: { id: true, isActive: true },
    });

    res.json({ success: true, data: updated });
  } catch (err) {
    next(err);
  }
}

module.exports = { getStudents, getStudentExams, toggleStudentStatus };
