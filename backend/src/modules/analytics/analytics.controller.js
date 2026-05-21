const prisma = require("../../config/db");
const { AppError } = require("../../middleware/errorHandler");

async function getExamStats(req, res, next) {
  try {
    const { examId } = req.params;

    const sessions = await prisma.examSession.findMany({
      where: { examId, status: "SUBMITTED" },
      include: {
        student: { select: { gender: true, program: true } },
      },
    });

    if (sessions.length === 0) {
      return res.json({ success: true, data: { message: "No submissions yet", stats: null } });
    }

    const scores = sessions.map((s) => s.score || 0);
    const maxPossible = sessions[0].maxScore || 1;

    const stats = {
      totalSubmissions: sessions.length,
      maxPossibleScore: maxPossible,
      averageScore: scores.reduce((a, b) => a + b, 0) / scores.length,
      highestScore: Math.max(...scores),
      lowestScore: Math.min(...scores),
      medianScore: median(scores),
      standardDeviation: standardDeviation(scores),
      passRate: null,
    };

    const exam = await prisma.exam.findUnique({ where: { id: examId } });
    if (exam && exam.passingMarks > 0) {
      const passCount = scores.filter((s) => s >= exam.passingMarks).length;
      stats.passRate = ((passCount / scores.length) * 100).toFixed(2);
    }

    stats.scoreDistribution = buildDistribution(scores, maxPossible);
    stats.byGender = groupByField(sessions, "gender");
    stats.byProgram = groupByField(sessions, "program");

    res.json({ success: true, data: stats });
  } catch (err) {
    next(err);
  }
}

async function getGradeBoundaries(req, res, next) {
  try {
    const { examId } = req.params;
    const boundaries = req.query.boundaries
      ? JSON.parse(req.query.boundaries)
      : { A: 70, B: 60, C: 50, D: 40, F: 0 };

    const sessions = await prisma.examSession.findMany({
      where: { examId, status: "SUBMITTED" },
    });

    const maxScore = sessions[0]?.maxScore || 100;
    const grades = {};
    const sortedBounds = Object.entries(boundaries).sort(([, a], [, b]) => b - a);

    for (const [grade] of sortedBounds) {
      grades[grade] = 0;
    }

    for (const s of sessions) {
      const pct = ((s.score || 0) / maxScore) * 100;
      for (const [grade, min] of sortedBounds) {
        if (pct >= min) {
          grades[grade]++;
          break;
        }
      }
    }

    res.json({
      success: true,
      data: { boundaries, grades, totalStudents: sessions.length },
    });
  } catch (err) {
    next(err);
  }
}

async function getScaledScores(req, res, next) {
  try {
    const { examId } = req.params;
    const method = req.query.method || "linear";
    const targetMax = parseInt(req.query.targetMax, 10) || 100;
    const targetMean = parseFloat(req.query.targetMean) || 65;
    const targetStd = parseFloat(req.query.targetStd) || 15;

    const sessions = await prisma.examSession.findMany({
      where: { examId, status: "SUBMITTED" },
      include: { student: { select: { id: true, firstName: true, lastName: true, studentId: true } } },
    });

    if (sessions.length === 0) {
      return res.json({ success: true, data: { method, scaled: [] } });
    }

    const rawScores = sessions.map((s) => s.score || 0);
    const maxPossible = sessions[0].maxScore || 1;
    let scaled;

    if (method === "linear") {
      scaled = rawScores.map((s) => (s / maxPossible) * targetMax);
    } else if (method === "minmax") {
      const min = Math.min(...rawScores);
      const max = Math.max(...rawScores);
      const range = max - min || 1;
      scaled = rawScores.map((s) => ((s - min) / range) * targetMax);
    } else if (method === "zscore") {
      const mean = rawScores.reduce((a, b) => a + b, 0) / rawScores.length;
      const std = Math.sqrt(rawScores.map((s) => Math.pow(s - mean, 2)).reduce((a, b) => a + b, 0) / rawScores.length) || 1;
      scaled = rawScores.map((s) => targetMean + targetStd * ((s - mean) / std));
    } else if (method === "sqrt") {
      scaled = rawScores.map((s) => Math.sqrt(s / maxPossible) * targetMax);
    } else {
      throw new AppError("Unknown scaling method. Use: linear, minmax, zscore, sqrt", 400);
    }

    const result = sessions.map((s, i) => ({
      sessionId: s.id,
      student: s.student,
      rawScore: rawScores[i],
      scaledScore: Math.round(Math.max(0, Math.min(targetMax, scaled[i])) * 100) / 100,
    }));

    res.json({
      success: true,
      data: {
        method,
        targetMax,
        rawMax: maxPossible,
        scaled: result,
        summary: {
          rawMean: rawScores.reduce((a, b) => a + b, 0) / rawScores.length,
          scaledMean: scaled.reduce((a, b) => a + b, 0) / scaled.length,
          scaledMin: Math.min(...scaled),
          scaledMax: Math.max(...scaled),
        },
      },
    });
  } catch (err) {
    next(err);
  }
}

async function getCourseAnalytics(req, res, next) {
  try {
    const { institutionId } = req.params;

    const exams = await prisma.exam.findMany({
      where: { institutionId },
      include: {
        examSessions: { where: { status: "SUBMITTED" } },
      },
    });

    const analytics = exams.map((e) => {
      const scores = e.examSessions.map((s) => s.score || 0);
      return {
        examId: e.id,
        courseCode: e.courseCode,
        courseName: e.courseName,
        title: e.title,
        submissions: scores.length,
        averageScore: scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0,
      };
    });

    res.json({ success: true, data: analytics });
  } catch (err) {
    next(err);
  }
}

// ── helpers ──

function median(arr) {
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function standardDeviation(arr) {
  const avg = arr.reduce((a, b) => a + b, 0) / arr.length;
  const sqDiffs = arr.map((v) => Math.pow(v - avg, 2));
  return Math.sqrt(sqDiffs.reduce((a, b) => a + b, 0) / arr.length);
}

function buildDistribution(scores, maxScore) {
  const buckets = { "0-20%": 0, "21-40%": 0, "41-60%": 0, "61-80%": 0, "81-100%": 0 };
  for (const s of scores) {
    const pct = (s / maxScore) * 100;
    if (pct <= 20) buckets["0-20%"]++;
    else if (pct <= 40) buckets["21-40%"]++;
    else if (pct <= 60) buckets["41-60%"]++;
    else if (pct <= 80) buckets["61-80%"]++;
    else buckets["81-100%"]++;
  }
  return buckets;
}

function groupByField(sessions, field) {
  const groups = {};
  for (const s of sessions) {
    const key = s.student[field] || "Unknown";
    if (!groups[key]) groups[key] = { count: 0, totalScore: 0 };
    groups[key].count++;
    groups[key].totalScore += s.score || 0;
  }
  for (const key of Object.keys(groups)) {
    groups[key].averageScore = groups[key].totalScore / groups[key].count;
  }
  return groups;
}

async function getStudentScores(req, res, next) {
  try {
    const { examId } = req.params;
    const sessions = await prisma.examSession.findMany({
      where: { examId, status: "SUBMITTED" },
      include: {
        student: {
          select: { id: true, firstName: true, lastName: true, studentId: true, program: true, gender: true, avatarUrl: true },
        },
      },
      orderBy: { score: "desc" },
    });
    const maxScore = sessions[0]?.maxScore || 1;
    const result = sessions.map((s, i) => {
      const ms =
        s.submittedAt && s.startedAt
          ? new Date(s.submittedAt).getTime() - new Date(s.startedAt).getTime()
          : null;
      return {
        rank: i + 1,
        sessionId: s.id,
        student: s.student,
        score: s.score || 0,
        maxScore: s.maxScore || 0,
        percentage: Number(((( s.score || 0) / maxScore) * 100).toFixed(1)),
        durationMinutes: ms != null ? Math.round((ms / 60000) * 10) / 10 : null,
        submittedAt: s.submittedAt,
      };
    });
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

async function getQuestionAnalytics(req, res, next) {
  try {
    const { examId } = req.params;
    const [questions, totalSessions] = await Promise.all([
      prisma.question.findMany({
        where: { examId },
        include: { answers: { select: { isCorrect: true } } },
        orderBy: { order: "asc" },
      }),
      prisma.examSession.count({ where: { examId, status: "SUBMITTED" } }),
    ]);
    const result = questions.map((q, i) => {
      const totalAnswered = q.answers.length;
      const correct = q.answers.filter((a) => a.isCorrect === true).length;
      const incorrect = totalAnswered - correct;
      const skipped = Math.max(0, totalSessions - totalAnswered);
      const correctRate = totalAnswered > 0 ? (correct / totalAnswered) * 100 : 0;
      return {
        questionId: q.id,
        questionNumber: i + 1,
        text: q.text.length > 120 ? q.text.substring(0, 120) + "…" : q.text,
        type: q.type,
        marks: q.marks,
        totalAnswered,
        correct,
        incorrect,
        skipped,
        correctRate: Number(correctRate.toFixed(1)),
        difficulty: correctRate < 30 ? "Hard" : correctRate < 60 ? "Medium" : "Easy",
      };
    });
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

async function getLeaderboard(req, res, next) {
  try {
    const { examId } = req.params;
    const limit = Math.min(parseInt(req.query.limit || "20", 10), 100);
    const sessions = await prisma.examSession.findMany({
      where: { examId, status: "SUBMITTED" },
      include: {
        student: { select: { id: true, firstName: true, lastName: true, studentId: true, program: true, avatarUrl: true } },
      },
      orderBy: { score: "desc" },
      take: limit,
    });
    const maxScore = sessions[0]?.maxScore || 1;
    const result = sessions.map((s, i) => ({
      rank: i + 1,
      student: s.student,
      score: s.score || 0,
      maxScore: s.maxScore || 0,
      percentage: Number((((s.score || 0) / maxScore) * 100).toFixed(1)),
    }));
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

async function getTimeAnalytics(req, res, next) {
  try {
    const { examId } = req.params;
    const exam = await prisma.exam.findUnique({ where: { id: examId }, select: { durationMinutes: true } });
    const sessions = await prisma.examSession.findMany({
      where: { examId, status: "SUBMITTED", startedAt: { not: null }, submittedAt: { not: null } },
      include: { student: { select: { id: true, firstName: true, lastName: true, studentId: true } } },
    });
    if (sessions.length === 0) {
      return res.json({ success: true, data: { avgDurationMinutes: 0, sessions: [], fastest: [], suspicious: [] } });
    }
    const timings = sessions
      .map((s) => ({
        sessionId: s.id,
        student: s.student,
        durationMinutes: Math.round(((new Date(s.submittedAt).getTime() - new Date(s.startedAt).getTime()) / 60000) * 10) / 10,
        score: s.score || 0,
        submittedAt: s.submittedAt,
      }))
      .sort((a, b) => a.durationMinutes - b.durationMinutes);
    const durations = timings.map((t) => t.durationMinutes);
    const avg = durations.reduce((a, b) => a + b, 0) / durations.length;
    const threshold = exam?.durationMinutes ? exam.durationMinutes * 0.15 : 3;
    res.json({
      success: true,
      data: {
        avgDurationMinutes: Math.round(avg * 10) / 10,
        fastestMinutes: durations[0],
        slowestMinutes: durations[durations.length - 1],
        allowedMinutes: exam?.durationMinutes || null,
        suspiciousThresholdMinutes: Math.round(threshold * 10) / 10,
        sessions: timings,
        fastest: timings.slice(0, 10),
        suspicious: timings.filter((t) => t.durationMinutes < threshold),
      },
    });
  } catch (err) {
    next(err);
  }
}

async function getSessionSummary(req, res, next) {
  try {
    const { examId } = req.params;
    const groups = await prisma.examSession.groupBy({
      by: ["status"],
      where: { examId },
      _count: { id: true },
    });
    const summary = {};
    for (const g of groups) summary[g.status] = g._count.id;
    res.json({ success: true, data: summary });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getExamStats, getGradeBoundaries, getCourseAnalytics, getScaledScores,
  getStudentScores, getQuestionAnalytics, getLeaderboard, getTimeAnalytics, getSessionSummary,
};
