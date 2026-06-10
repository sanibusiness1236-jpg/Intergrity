const bcrypt = require("bcrypt");
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

/**
 * PATCH /api/students/:id
 * Examiner can update a student's profile fields (studentId, program, gender).
 * This is needed when a student registered without a student ID and therefore
 * cannot use the self-service password-reset flow.
 */
async function updateStudent(req, res, next) {
  try {
    const student = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!student || student.role !== "STUDENT") {
      throw new AppError("Student not found", 404);
    }

    const { studentId, program, gender, firstName, lastName } = req.body;
    const data = {};

    if (firstName !== undefined) data.firstName = String(firstName).trim() || undefined;
    if (lastName  !== undefined) data.lastName  = String(lastName).trim()  || undefined;
    if (program   !== undefined) data.program   = String(program).trim()   || null;
    if (gender    !== undefined) data.gender    = String(gender).trim()    || null;

    if (studentId !== undefined) {
      const trimmed = String(studentId).trim();
      if (trimmed) {
        // Make sure no other student already has this ID
        const conflict = await prisma.user.findUnique({ where: { studentId: trimmed } });
        if (conflict && conflict.id !== student.id) {
          throw new AppError("That student ID is already in use by another account.", 409);
        }
        data.studentId = trimmed;
      } else {
        data.studentId = null;
      }
    }

    if (Object.keys(data).length === 0) {
      throw new AppError("No valid fields to update", 400);
    }

    const updated = await prisma.user.update({
      where: { id: req.params.id },
      data,
      select: {
        id: true, email: true, firstName: true, lastName: true,
        studentId: true, program: true, gender: true, isActive: true,
      },
    });

    res.json({ success: true, data: updated });
  } catch (err) {
    if (err?.code === "P2002") {
      return next(new AppError("That student ID is already in use.", 409));
    }
    next(err);
  }
}

/**
 * POST /api/students/:id/reset-password
 * Examiner-initiated password reset for a student — useful when the student
 * has no student ID on file and cannot use self-service reset.
 */
async function adminResetStudentPassword(req, res, next) {
  try {
    const student = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!student || student.role !== "STUDENT") {
      throw new AppError("Student not found", 404);
    }

    const { newPassword } = req.body;
    if (!newPassword || String(newPassword).length < 6) {
      throw new AppError("New password must be at least 6 characters.", 400);
    }

    const passwordHash = await bcrypt.hash(String(newPassword), 10);
    await prisma.user.update({ where: { id: req.params.id }, data: { passwordHash } });

    res.json({ success: true, message: "Password reset successfully." });
  } catch (err) {
    next(err);
  }
}

module.exports = { getStudents, getStudentExams, toggleStudentStatus, updateStudent, adminResetStudentPassword };
