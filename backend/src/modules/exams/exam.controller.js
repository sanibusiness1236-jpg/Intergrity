const prisma = require("../../config/db");
const { AppError } = require("../../middleware/errorHandler");

async function resolveInstitutionId(userId, explicitId) {
  if (explicitId) return explicitId;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { institutionId: true },
  });
  if (user?.institutionId) return user.institutionId;

  const defaultInst = await prisma.institution.upsert({
    where: { name: "Default Institution" },
    create: { name: "Default Institution", shortName: "DEFAULT" },
    update: {},
  });
  await prisma.user.update({
    where: { id: userId },
    data: { institutionId: defaultInst.id },
  });
  return defaultInst.id;
}

async function createExam(req, res, next) {
  try {
    const {
      title, description, instructions, courseCode, courseName,
      examType, examTypeOther, examPassword,
      durationMinutes, startTime, endTime, totalMarks,
      shuffleQuestions, allowBacktrack, institutionId,
      maxAttempts, showScoreToStudents, showRemarksToStudents,
      gradingSystem, scoreRemarks,
    } = req.body;

    const resolvedInstId = await resolveInstitutionId(req.user.id, institutionId);

    const exam = await prisma.exam.create({
      data: {
        title,
        description,
        instructions,
        courseCode,
        courseName,
        examType: examType || "QUIZ",
        examTypeOther: examType === "OTHER" ? examTypeOther : null,
        examPassword: examPassword || null,
        durationMinutes,
        startTime: startTime ? new Date(startTime) : null,
        endTime: endTime ? new Date(endTime) : null,
        totalMarks: totalMarks || 0,
        shuffleQuestions: shuffleQuestions || false,
        allowBacktrack: allowBacktrack !== false,
        maxAttempts: maxAttempts ? parseInt(maxAttempts, 10) : 1,
        showScoreToStudents: showScoreToStudents !== false,
        showRemarksToStudents: showRemarksToStudents || false,
        gradingSystem: gradingSystem || null,
        scoreRemarks: scoreRemarks || null,
        isActive: true,
        createdById: req.user.id,
        institutionId: resolvedInstId,
      },
    });

    res.status(201).json({ success: true, data: exam });
  } catch (err) {
    next(err);
  }
}

async function getExams(req, res, next) {
  try {
    const where = {};
    if (req.user.role === "EXAMINER") {
      where.createdById = req.user.id;
    }
    if (req.user.role === "STUDENT") {
      where.status = { in: ["PUBLISHED", "ACTIVE"] };
      where.isActive = true;
    }
    if (req.query.institutionId) {
      where.institutionId = req.query.institutionId;
    }
    if (req.query.status && req.user.role !== "STUDENT") {
      where.status = req.query.status;
    }

    const exams = await prisma.exam.findMany({
      where,
      include: {
        createdBy: { select: { id: true, firstName: true, lastName: true } },
        _count: {
          select: {
            questions: true,
            examSessions: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    // Attach submitted count to each exam
    const examIds = exams.map((e) => e.id);
    const submittedCounts = await prisma.examSession.groupBy({
      by: ["examId"],
      where: {
        examId: { in: examIds },
        status: "SUBMITTED",
      },
      _count: { id: true },
    });
    const submittedMap = Object.fromEntries(submittedCounts.map((r) => [r.examId, r._count.id]));

    const enriched = exams.map((e) => ({
      ...e,
      _count: {
        ...e._count,
        submittedSessions: submittedMap[e.id] || 0,
      },
    }));

    res.json({ success: true, data: enriched });
  } catch (err) {
    next(err);
  }
}

async function getExam(req, res, next) {
  try {
    const exam = await prisma.exam.findUnique({
      where: { id: req.params.id },
      include: {
        questions: { orderBy: { order: "asc" } },
        createdBy: { select: { id: true, firstName: true, lastName: true } },
        venues: true,
        _count: { select: { examSessions: true } },
      },
    });
    if (!exam) throw new AppError("Exam not found", 404);

    // Count submitted sessions
    const submittedCount = await prisma.examSession.count({
      where: { examId: req.params.id, status: "SUBMITTED" },
    });

    res.json({
      success: true,
      data: {
        ...exam,
        _count: { ...exam._count, submittedSessions: submittedCount },
      },
    });
  } catch (err) {
    next(err);
  }
}

async function saveGeofence(req, res, next) {
  try {
    const exam = await prisma.exam.findUnique({ where: { id: req.params.id } });
    if (!exam) throw new AppError("Exam not found", 404);
    if (exam.createdById !== req.user.id && req.user.role !== "ADMIN") {
      throw new AppError("Not authorised", 403);
    }

    const { geofenceEnabled, geofenceLat, geofenceLng, geofenceRadius } = req.body;

    if (geofenceEnabled && (geofenceLat == null || geofenceLng == null)) {
      throw new AppError("Latitude and longitude are required when geofence is enabled", 400);
    }

    const updated = await prisma.exam.update({
      where: { id: req.params.id },
      data: {
        geofenceEnabled: Boolean(geofenceEnabled),
        geofenceLat: geofenceLat != null ? parseFloat(geofenceLat) : null,
        geofenceLng: geofenceLng != null ? parseFloat(geofenceLng) : null,
        geofenceRadius: geofenceRadius != null ? parseFloat(geofenceRadius) : 30,
      },
      select: { id: true, geofenceEnabled: true, geofenceLat: true, geofenceLng: true, geofenceRadius: true },
    });

    res.json({ success: true, data: updated });
  } catch (err) {
    next(err);
  }
}

async function getGeofence(req, res, next) {
  try {
    const exam = await prisma.exam.findUnique({
      where: { id: req.params.id },
      select: {
        id: true, courseCode: true, courseName: true,
        geofenceEnabled: true, geofenceLat: true, geofenceLng: true, geofenceRadius: true,
      },
    });
    if (!exam) throw new AppError("Exam not found", 404);
    res.json({ success: true, data: exam });
  } catch (err) {
    next(err);
  }
}

async function validateGeofence(req, res, next) {
  try {
    const exam = await prisma.exam.findUnique({
      where: { id: req.params.id },
      select: { geofenceEnabled: true, geofenceLat: true, geofenceLng: true, geofenceRadius: true },
    });
    if (!exam) throw new AppError("Exam not found", 404);

    if (!exam.geofenceEnabled) {
      return res.json({ success: true, allowed: true, reason: "geofence_disabled" });
    }

    const { lat, lng } = req.body;
    if (lat == null || lng == null) {
      return res.json({ success: true, allowed: false, reason: "no_location" });
    }

    const distance = haversineMeters(
      parseFloat(lat), parseFloat(lng),
      exam.geofenceLat, exam.geofenceLng
    );

    const allowed = distance <= exam.geofenceRadius;
    res.json({
      success: true,
      allowed,
      distance: Math.round(distance),
      radius: exam.geofenceRadius,
      reason: allowed ? "inside" : "outside",
    });
  } catch (err) {
    next(err);
  }
}

function haversineMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function updateExam(req, res, next) {
  try {
    const exam = await prisma.exam.findUnique({ where: { id: req.params.id } });
    if (!exam) throw new AppError("Exam not found", 404);
    if (exam.createdById !== req.user.id && req.user.role !== "ADMIN") {
      throw new AppError("Not authorised", 403);
    }

    const {
      title, description, instructions, courseCode, courseName,
      examType, examTypeOther, examPassword,
      durationMinutes, startTime, endTime,
      shuffleQuestions, allowBacktrack,
      isActive, maxAttempts, showScoreToStudents, showRemarksToStudents,
      gradingSystem, scoreRemarks,
    } = req.body;

    const data = {};
    if (title !== undefined) data.title = title;
    if (description !== undefined) data.description = description;
    if (instructions !== undefined) data.instructions = instructions;
    if (courseCode !== undefined) data.courseCode = courseCode;
    if (courseName !== undefined) data.courseName = courseName;
    if (examType !== undefined) {
      data.examType = examType;
      data.examTypeOther = examType === "OTHER" ? (examTypeOther || null) : null;
    }
    if (examPassword !== undefined) data.examPassword = examPassword || null;
    if (durationMinutes !== undefined) data.durationMinutes = durationMinutes;
    if (startTime !== undefined) data.startTime = startTime ? new Date(startTime) : null;
    if (endTime !== undefined) data.endTime = endTime ? new Date(endTime) : null;
    if (shuffleQuestions !== undefined) data.shuffleQuestions = shuffleQuestions;
    if (allowBacktrack !== undefined) data.allowBacktrack = allowBacktrack;
    if (isActive !== undefined) data.isActive = isActive;
    if (maxAttempts !== undefined) data.maxAttempts = parseInt(maxAttempts, 10);
    if (showScoreToStudents !== undefined) data.showScoreToStudents = showScoreToStudents;
    if (showRemarksToStudents !== undefined) data.showRemarksToStudents = showRemarksToStudents;
    if (gradingSystem !== undefined) data.gradingSystem = gradingSystem;
    if (scoreRemarks !== undefined) data.scoreRemarks = scoreRemarks;

    const updated = await prisma.exam.update({
      where: { id: req.params.id },
      data,
    });
    res.json({ success: true, data: updated });
  } catch (err) {
    next(err);
  }
}

async function deleteExam(req, res, next) {
  try {
    const exam = await prisma.exam.findUnique({ where: { id: req.params.id } });
    if (!exam) throw new AppError("Exam not found", 404);
    if (exam.createdById !== req.user.id && req.user.role !== "ADMIN") {
      throw new AppError("Not authorised", 403);
    }

    await prisma.exam.delete({ where: { id: req.params.id } });
    res.json({ success: true, message: "Exam deleted" });
  } catch (err) {
    next(err);
  }
}

async function publishExam(req, res, next) {
  try {
    const exam = await prisma.exam.update({
      where: { id: req.params.id },
      data: { status: "PUBLISHED" },
    });
    res.json({ success: true, data: exam });
  } catch (err) {
    next(err);
  }
}

module.exports = { createExam, getExams, getExam, updateExam, deleteExam, publishExam, saveGeofence, getGeofence, validateGeofence };
