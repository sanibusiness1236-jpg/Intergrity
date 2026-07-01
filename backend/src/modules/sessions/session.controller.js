const prisma = require("../../config/db");
const redis = require("../../config/redis");
const { AppError } = require("../../middleware/errorHandler");

const AUTOSAVE_PREFIX = "autosave:";
const AUTOSAVE_TTL = 60 * 60 * 4; // 4 hours

/** Extract the real client IP, honouring reverse-proxy X-Forwarded-For */
function getClientIp(req) {
  const xff = req.headers["x-forwarded-for"];
  if (xff) return xff.split(",")[0].trim();
  return req.ip || req.socket?.remoteAddress || null;
}

async function startSession(req, res, next) {
  try {
    const { examId, password, venueId } = req.body;
    const studentId = req.user.id;

    const exam = await prisma.exam.findUnique({ where: { id: examId } });
    if (!exam) throw new AppError("Exam not found", 404);
    if (exam.status !== "PUBLISHED" && exam.status !== "ACTIVE") {
      throw new AppError("Exam not available", 400);
    }

    // Verify exam password if one is set
    if (exam.examPassword) {
      if (!password || password !== exam.examPassword) {
        throw new AppError("Incorrect exam password", 401);
      }
    }

    // All sessions for this student + exam, newest first
    const allSessions = await prisma.examSession.findMany({
      where: { examId, studentId },
      orderBy: { createdAt: "desc" },
    });

    // Resume any active/disconnected session
    const activeSession = allSessions.find(
      (s) => s.status === "IN_PROGRESS" || s.status === "WAITING" || s.status === "DISCONNECTED"
    );
    if (activeSession) {
      const session =
        activeSession.status !== "IN_PROGRESS"
          ? await prisma.examSession.update({
              where: { id: activeSession.id },
              data: { status: "IN_PROGRESS" },
            })
          : activeSession;

      const savedAnswers = await redis.get(`${AUTOSAVE_PREFIX}${session.id}`);
      const attemptsUsed = allSessions.filter(
        (s) => s.status === "SUBMITTED" || s.status === "TIMED_OUT"
      ).length;

      return res.json({
        success: true,
        data: {
          session,
          recoveredAnswers: savedAnswers ? JSON.parse(savedAnswers) : null,
          attemptNumber: session.attemptNumber,
          attemptsUsed,
          maxAttempts: exam.maxAttempts,
        },
      });
    }

    // Count completed attempts and enforce max
    const completedAttempts = allSessions.filter(
      (s) => s.status === "SUBMITTED" || s.status === "TIMED_OUT"
    ).length;

    if (completedAttempts >= exam.maxAttempts) {
      throw new AppError(
        `No attempts remaining. You have used all ${exam.maxAttempts} attempt(s) for this exam.`,
        400
      );
    }

    // Create a fresh session
    const session = await prisma.examSession.create({
      data: {
        examId,
        studentId,
        status: "IN_PROGRESS",
        startedAt: new Date(),
        ipAddress: req.ip,
        userAgent: req.get("user-agent"),
        attemptNumber: completedAttempts + 1,
      },
    });

    // Record the student's chosen venue (if provided)
    if (venueId) {
      try {
        const venue = await prisma.venue.findFirst({ where: { id: venueId, examId } });
        if (venue) {
          await prisma.seatingAssignment.upsert({
            where: { sessionId: session.id },
            create: { venueId, sessionId: session.id, seatX: 0, seatY: 0 },
            update: { venueId },
          });
        }
      } catch (_) {
        // Non-fatal — venue assignment failure should not block exam start
      }
    }

    res.json({
      success: true,
      data: {
        session,
        recoveredAnswers: null,
        attemptNumber: session.attemptNumber,
        attemptsUsed: completedAttempts,
        maxAttempts: exam.maxAttempts,
      },
    });
  } catch (err) {
    next(err);
  }
}

async function autoSave(req, res, next) {
  try {
    const { sessionId } = req.params;
    const { answers } = req.body;

    const session = await prisma.examSession.findUnique({ where: { id: sessionId } });
    if (!session || session.studentId !== req.user.id) {
      throw new AppError("Session not found", 404);
    }
    if (session.status === "SUBMITTED") {
      throw new AppError("Session already submitted", 400);
    }

    await redis.setex(
      `${AUTOSAVE_PREFIX}${sessionId}`,
      AUTOSAVE_TTL,
      JSON.stringify(answers),
    );

    res.json({ success: true, message: "Answers auto-saved" });
  } catch (err) {
    next(err);
  }
}

async function submitExam(req, res, next) {
  try {
    const { sessionId } = req.params;
    const { answers } = req.body;

    const session = await prisma.examSession.findUnique({
      where: { id: sessionId },
      include: { exam: { include: { questions: true } } },
    });
    if (!session || session.studentId !== req.user.id) {
      throw new AppError("Session not found", 404);
    }
    if (session.status === "SUBMITTED") {
      throw new AppError("Already submitted", 400);
    }

    const questionMap = new Map(session.exam.questions.map((q) => [q.id, q]));

    // maxScore is the sum of marks for ALL questions on the exam —
    // not just the ones the student answered.  A student who skips
    // 2 of 4 questions still scores out of the full exam total.
    const maxScore = session.exam.questions.reduce((sum, q) => sum + (q.marks || 0), 0);
    let totalScore = 0;

    const answerRecords = [];
    for (const ans of answers) {
      const question = questionMap.get(ans.questionId);
      if (!question) continue;

      const { isCorrect, score } = gradeAnswer(question, ans.answer);
      totalScore += score;

      answerRecords.push({
        sessionId,
        questionId: ans.questionId,
        answer: ans.answer,
        isCorrect,
        score,
      });
    }

    await prisma.$transaction([
      ...answerRecords.map((a) =>
        prisma.answer.upsert({
          where: { sessionId_questionId: { sessionId: a.sessionId, questionId: a.questionId } },
          create: a,
          update: { answer: a.answer, isCorrect: a.isCorrect, score: a.score },
        })
      ),
      prisma.examSession.update({
        where: { id: sessionId },
        data: { status: "SUBMITTED", submittedAt: new Date(), score: totalScore, maxScore },
      }),
    ]);

    await redis.del(`${AUTOSAVE_PREFIX}${sessionId}`);

    // Respond immediately. When time expires every student submits at once —
    // awaiting the extra IP-anomaly queries here would hold a DB connection on
    // the critical path and starve the pool during that spike.
    res.json({
      success: true,
      data: { score: totalScore, maxScore, percentage: maxScore > 0 ? ((totalScore / maxScore) * 100).toFixed(2) : 0 },
    });

    // Record submission IP and check for IP-based anomalies — fire-and-forget,
    // strictly after the response. Failures are non-fatal and never surface.
    const submissionIp = getClientIp(req);
    const userId = req.user.id;
    const examId = session.examId;
    setImmediate(async () => {
      try {
        if (!submissionIp) return;
        await prisma.examSession.update({
          where: { id: sessionId },
          data: { ipAddress: submissionIp },
        });

        const sharedIpSessions = await prisma.examSession.findMany({
          where: {
            examId,
            ipAddress: submissionIp,
            studentId: { not: userId },
            status: { in: ["SUBMITTED", "IN_PROGRESS", "TIMED_OUT"] },
          },
        });

        if (sharedIpSessions.length > 0) {
          await prisma.behavioralFlag.create({
            data: {
              sessionId,
              studentId: userId,
              flagType: "IP_ANOMALY",
              metadata: {
                sharedIp: submissionIp,
                otherStudentIds: sharedIpSessions.map((s) => s.studentId),
                otherSessionIds: sharedIpSessions.map((s) => s.id),
                detectedAt: new Date().toISOString(),
              },
            },
          });
        }
      } catch (_) {
        // Non-fatal — anomaly detection must not affect submission.
      }
    });
  } catch (err) {
    next(err);
  }
}

async function getSession(req, res, next) {
  try {
    const session = await prisma.examSession.findUnique({
      where: { id: req.params.sessionId },
      include: { answers: true, behavioralFlags: true },
    });
    if (!session) throw new AppError("Session not found", 404);
    res.json({ success: true, data: session });
  } catch (err) {
    next(err);
  }
}

async function getActiveSessions(req, res, next) {
  try {
    const where = { status: "IN_PROGRESS" };
    if (req.query.examId) where.examId = req.query.examId;

    const sessions = await prisma.examSession.findMany({
      where,
      include: {
        student: { select: { id: true, firstName: true, lastName: true, studentId: true } },
        exam: { select: { id: true, title: true, courseCode: true } },
        seatingAssignment: { include: { venue: { select: { id: true, name: true } } } },
      },
      orderBy: { startedAt: "asc" },
    });

    res.json({ success: true, data: sessions });
  } catch (err) {
    next(err);
  }
}

async function relocateStudent(req, res, next) {
  try {
    const { sessionId } = req.params;
    const { newIpAddress, newSeatX, newSeatY, newSeatLabel } = req.body;

    const session = await prisma.examSession.findUnique({ where: { id: sessionId } });
    if (!session) throw new AppError("Session not found", 404);

    await prisma.examSession.update({
      where: { id: sessionId },
      data: { ipAddress: newIpAddress || session.ipAddress },
    });

    if (newSeatX !== undefined && newSeatY !== undefined) {
      await prisma.seatingAssignment.upsert({
        where: { sessionId },
        create: { venueId: req.body.venueId, sessionId, seatX: newSeatX, seatY: newSeatY, seatLabel: newSeatLabel },
        update: { seatX: newSeatX, seatY: newSeatY, seatLabel: newSeatLabel },
      });
    }

    res.json({ success: true, message: "Student relocated" });
  } catch (err) {
    next(err);
  }
}

function gradeAnswer(question, studentAnswer) {
  const { type, correctAnswer, marks } = question;

  if (type === "MULTI_BLANK_EQUATION") {
    if (!Array.isArray(correctAnswer) || !Array.isArray(studentAnswer)) {
      return { isCorrect: false, score: 0 };
    }
    let correctCount = 0;
    for (let i = 0; i < correctAnswer.length; i++) {
      const expected = String(correctAnswer[i] ?? "").trim().toLowerCase();
      const given = String(studentAnswer[i] ?? "").trim().toLowerCase();
      if (expected === given) correctCount++;
    }
    const fraction = correctCount / correctAnswer.length;
    const score = Math.round(marks * fraction);
    return { isCorrect: fraction === 1, score };
  }

  if (type === "FILL_IN_BLANK") {
    const given = String(studentAnswer ?? "").trim();

    // New format: { answers: string[], caseSensitive: boolean }
    if (correctAnswer && typeof correctAnswer === "object" && !Array.isArray(correctAnswer) && Array.isArray(correctAnswer.answers)) {
      const { answers, caseSensitive } = correctAnswer;
      const isCorrect = answers.some((ans) => {
        const expected = String(ans ?? "").trim();
        return caseSensitive
          ? expected === given
          : expected.toLowerCase() === given.toLowerCase();
      });
      return { isCorrect, score: isCorrect ? marks : 0 };
    }

    // Legacy format: plain string (case-insensitive by default)
    const expected = String(correctAnswer ?? "").trim().toLowerCase();
    const isCorrect = expected === given.toLowerCase();
    return { isCorrect, score: isCorrect ? marks : 0 };
  }

  if (type === "TEMPLATE_FILL") {
    // correctAnswer: { BLANK_1: { answers: string[], caseSensitive: boolean }, ... }
    // studentAnswer: { BLANK_1: "value", BLANK_2: "value", ... }
    if (!correctAnswer || typeof correctAnswer !== "object" || Array.isArray(correctAnswer)) {
      return { isCorrect: false, score: 0 };
    }
    if (!studentAnswer || typeof studentAnswer !== "object" || Array.isArray(studentAnswer)) {
      return { isCorrect: false, score: 0 };
    }
    const blanks = Object.keys(correctAnswer);
    if (blanks.length === 0) return { isCorrect: false, score: 0 };
    let correct = 0;
    for (const blankId of blanks) {
      const spec = correctAnswer[blankId];
      if (!spec || !Array.isArray(spec.answers)) continue;
      const given = String(studentAnswer[blankId] ?? "").trim();
      if (!given) continue;
      const matched = spec.answers.some((ans) => {
        const expected = String(ans ?? "").trim();
        return spec.caseSensitive
          ? expected === given
          : expected.toLowerCase() === given.toLowerCase();
      });
      if (matched) correct++;
    }
    const fraction = correct / blanks.length;
    const score = Math.round(marks * fraction);
    return { isCorrect: fraction === 1, score };
  }

  const isCorrect = JSON.stringify(correctAnswer) === JSON.stringify(studentAnswer);
  return { isCorrect, score: isCorrect ? marks : 0 };
}

/**
 * GET /sessions/my-active?examId=xxx
 * Returns the student's current active session for a given exam,
 * including recovered answers and remaining time. Used to restore
 * the exam state after a page refresh without re-entering the password.
 */
async function getMyActiveSession(req, res, next) {
  try {
    const { examId } = req.query;
    const studentId = req.user.id;
    if (!examId) throw new AppError("examId is required", 400);

    const session = await prisma.examSession.findFirst({
      where: {
        examId: String(examId),
        studentId,
        status: { in: ["IN_PROGRESS", "WAITING", "DISCONNECTED"] },
      },
      orderBy: { createdAt: "desc" },
    });

    if (!session) return res.json({ success: true, data: null });

    const [savedAnswers, exam] = await Promise.all([
      redis.get(`${AUTOSAVE_PREFIX}${session.id}`),
      prisma.exam.findUnique({
        where: { id: String(examId) },
        select: { durationMinutes: true },
      }),
    ]);

    const elapsed = session.startedAt
      ? Math.floor((Date.now() - new Date(session.startedAt).getTime()) / 1000)
      : 0;
    const totalSecs = (exam?.durationMinutes || 0) * 60;
    const remaining = Math.max(0, totalSecs - elapsed);

    res.json({
      success: true,
      data: {
        session,
        recoveredAnswers: savedAnswers ? JSON.parse(savedAnswers) : null,
        remaining,
        alreadyExpired: remaining <= 0,
      },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /sessions/:sessionId/log-refresh
 * Creates a PAGE_REFRESH behavioral flag for integrity monitoring.
 * Called automatically by the client every time a page reload is detected.
 */
async function logPageRefresh(req, res, next) {
  try {
    const { sessionId } = req.params;
    const session = await prisma.examSession.findUnique({ where: { id: sessionId } });
    if (!session || session.studentId !== req.user.id) {
      throw new AppError("Session not found", 404);
    }
    if (session.status !== "IN_PROGRESS") {
      return res.json({ success: true });
    }

    await prisma.behavioralFlag.create({
      data: {
        sessionId,
        studentId: req.user.id,
        flagType: "PAGE_REFRESH",
        metadata: {
          ip: getClientIp(req),
          userAgent: req.get("user-agent"),
          refreshedAt: new Date().toISOString(),
        },
      },
    });

    // Notify examiner monitor in real time
    try {
      const { getIO } = require("../../socket");
      getIO().to(`exam:${session.examId}`).emit("flag:new", {
        sessionId,
        studentId: req.user.id,
        flagType: "PAGE_REFRESH",
        createdAt: new Date(),
      });
    } catch (_) {}

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
}

module.exports = { startSession, autoSave, submitExam, getSession, getActiveSessions, relocateStudent, getMyActiveSession, logPageRefresh };
