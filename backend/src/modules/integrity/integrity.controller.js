const axios = require("axios");
const prisma = require("../../config/db");
const { mlServiceUrl } = require("../../config/env");
const { AppError } = require("../../middleware/errorHandler");

// 3-minute timeout — HF Spaces can take 60-90 s to cold-start
const mlClient = axios.create({ baseURL: mlServiceUrl, timeout: 180_000 });

// Friendly helper so every ML call returns a readable error instead of hanging
async function safeMlCall(fn) {
  try {
    return await fn();
  } catch (err) {
    if (err.code === "ECONNRESET" || err.code === "ECONNABORTED" || err.message?.includes("socket hang up")) {
      throw new AppError("ML service is starting up — please wait 30 seconds and try again.", 503);
    }
    if (err.code === "ECONNREFUSED") {
      throw new AppError("ML service is offline. Check the Hugging Face Space is running.", 503);
    }
    if (err.response) {
      throw new AppError(err.response.data?.detail || err.response.data?.message || "ML service error", err.response.status || 502);
    }
    throw err;
  }
}

async function predictVenue(req, res, next) {
  try {
    const { venueId, examId } = req.body;

    const venue = await prisma.venue.findUnique({
      where: { id: venueId },
      include: {
        seatingAssignments: {
          include: {
            session: {
              include: {
                student: true,
                behavioralFlags: true,
              },
            },
          },
        },
      },
    });
    if (!venue) throw new AppError("Venue not found", 404);

    const students = venue.seatingAssignments.map((sa) => {
      const flags = sa.session.behavioralFlags;
      const countFlag = (type) => flags.filter((f) => f.flagType === type).length;

      return {
        student_id: sa.session.studentId,
        seat_x: sa.seatX,
        seat_y: sa.seatY,
        tab_switch_count: countFlag("TAB_SWITCH"),
        paste_event_count: countFlag("PASTE_EVENT"),
        window_blur_count: countFlag("WINDOW_BLUR"),
        usb_detected: countFlag("USB_DETECTED") > 0,
        multi_device_login: countFlag("MULTI_DEVICE") > 0,
        avg_answer_similarity: 0,
        time_per_question_std: 0,
        response_time_pattern: 0,
        ip_similarity_score: 0,
      };
    });

    const mlResponse = await safeMlCall(() => mlClient.post("/predict", {
      venue_id: venueId,
      exam_id: examId,
      students,
    }));

    const predictions = mlResponse.data.predictions || [];
    await prisma.$transaction(
      predictions.map((p) =>
        prisma.integrityPrediction.create({
          data: {
            examId,
            venueId,
            studentId: p.student_id,
            modelUsed: mlResponse.data.model_used,
            prediction: p.prediction,
            confidence: p.flagged_prob,
          },
        })
      )
    );

    res.json({ success: true, data: mlResponse.data });
  } catch (err) {
    next(err);
  }
}

async function getModels(_req, res, next) {
  try {
    const response = await safeMlCall(() => mlClient.get("/models/"));
    res.json({ success: true, data: response.data });
  } catch (err) {
    next(err);
  }
}

async function switchModel(req, res, next) {
  try {
    const { model } = req.body;
    const response = await safeMlCall(() => mlClient.post("/models/switch", { model }));
    res.json({ success: true, data: response.data });
  } catch (err) {
    next(err);
  }
}

async function evaluateModel(req, res, next) {
  try {
    const { modelName } = req.params;
    const response = await safeMlCall(() => mlClient.get(`/evaluate/${modelName}`, { params: req.query }));
    res.json({ success: true, data: response.data });
  } catch (err) {
    next(err);
  }
}

async function evaluateAll(req, res, next) {
  try {
    const response = await safeMlCall(() => mlClient.get("/evaluate/all", { params: req.query }));
    res.json({ success: true, data: response.data });
  } catch (err) {
    next(err);
  }
}

async function getPredictions(req, res, next) {
  try {
    const where = {};
    if (req.query.examId) where.examId = req.query.examId;
    if (req.query.venueId) where.venueId = req.query.venueId;

    const predictions = await prisma.integrityPrediction.findMany({
      where,
      orderBy: { createdAt: "desc" },
    });
    res.json({ success: true, data: predictions });
  } catch (err) {
    next(err);
  }
}

async function listDatasets(_req, res, next) {
  try {
    const response = await safeMlCall(() => mlClient.get("/datasets"));
    res.json({ success: true, data: response.data });
  } catch (err) {
    next(err);
  }
}

async function importDataset(req, res, next) {
  try {
    if (req.file) {
      const csv = req.file.buffer.toString("utf-8");
      const name = req.body.name || req.file.originalname || "imported_dataset";
      const response = await safeMlCall(() => mlClient.post("/datasets/import/csv-text", { name, csv }));
      return res.json({ success: true, data: response.data });
    }
    if (req.body.students) {
      const response = await safeMlCall(() => mlClient.post("/datasets/import/json", {
        name: req.body.name || "imported_dataset",
        students: req.body.students,
      }));
      return res.json({ success: true, data: response.data });
    }
    throw new AppError("Upload a CSV file or send JSON with students array", 400);
  } catch (err) {
    next(err);
  }
}

async function predictDataset(req, res, next) {
  try {
    const { datasetId } = req.params;
    const response = await safeMlCall(() => mlClient.post(`/datasets/${datasetId}/predict`));
    res.json({ success: true, data: response.data });
  } catch (err) {
    next(err);
  }
}

async function trainDataset(req, res, next) {
  try {
    const { datasetId } = req.params;
    const response = await safeMlCall(() => mlClient.post(
      `/datasets/${datasetId}/train`,
      {},
      { params: { epochs: req.body.epochs, model: req.body.model } },
    ));
    res.json({ success: true, data: response.data });
  } catch (err) {
    next(err);
  }
}

async function getIntegrityOverview(req, res, next) {
  try {
    const uid = req.user.id;
    const [totalCourses, totalSubmissions, activeSessions, totalPredictions, flaggedPredictions] =
      await Promise.all([
        prisma.exam.count({ where: { createdById: uid } }),
        prisma.examSession.count({ where: { exam: { createdById: uid }, status: "SUBMITTED" } }),
        prisma.examSession.count({ where: { exam: { createdById: uid }, status: "IN_PROGRESS" } }),
        prisma.integrityPrediction.count({ where: { exam: { createdById: uid } } }),
        prisma.integrityPrediction.count({ where: { exam: { createdById: uid }, prediction: "flagged" } }),
      ]);
    res.json({
      success: true,
      data: {
        totalCourses,
        activeSessions,
        totalSubmissions,
        totalPredictions,
        flaggedPredictions,
        cleanPredictions: totalPredictions - flaggedPredictions,
      },
    });
  } catch (err) {
    next(err);
  }
}

async function getExamActivityData(req, res, next) {
  try {
    const { examId } = req.params;
    const exam = await prisma.exam.findUnique({
      where: { id: examId },
      select: { id: true, title: true, courseCode: true },
    });
    if (!exam) throw new AppError("Exam not found", 404);

    const sessions = await prisma.examSession.findMany({
      where: { examId },
      include: {
        student: { select: { id: true, email: true, firstName: true, lastName: true, studentId: true } },
        behavioralFlags: true,
        answers: { orderBy: { answeredAt: "asc" } },
      },
    });

    const rows = sessions.map((s) => {
      const cf = (t) => s.behavioralFlags.filter((f) => f.flagType === t).length;
      const tabs = cf("TAB_SWITCH");
      const pastes = cf("PASTE_EVENT");
      const blurs = cf("WINDOW_BLUR");
      const usb = cf("USB_DETECTED");
      const multi = cf("MULTI_DEVICE") > 0;

      let tpqStd = 0;
      if (s.answers.length > 1) {
        const diffs = s.answers
          .slice(1)
          .map((a, i) => (new Date(a.answeredAt) - new Date(s.answers[i].answeredAt)) / 1000);
        const mean = diffs.reduce((a, b) => a + b, 0) / diffs.length;
        tpqStd =
          parseFloat(
            Math.sqrt(diffs.reduce((a, b) => a + (b - mean) ** 2, 0) / diffs.length).toFixed(2)
          ) || 0;
      }

      return {
        student_id: s.student.studentId || s.studentId,
        student_username: s.student.email?.split("@")[0] || s.student.studentId || s.studentId,
        student_name: `${s.student.firstName} ${s.student.lastName}`,
        tab_switch_flag: tabs > 0 ? 1 : 0,
        tab_switch_count: tabs,
        time_away_exam_site: blurs,
        answer_paste_flag: pastes > 0 ? 1 : 0,
        paste_event_count: pastes,
        usb_device_detection_count: usb,
        window_minimize_flag: blurs > 0 ? 1 : 0,
        window_blur_count: blurs,
        multi_device_login_flag: multi ? 1 : 0,
        avg_answer_similarity: 0,
        time_per_question_std: tpqStd,
        response_time_pattern: 0,
        ip_similarity_score: 0,
        suspicion_label: "",
      };
    });

    res.json({ success: true, data: { exam, rows } });
  } catch (err) {
    next(err);
  }
}

async function predictExamIntegrity(req, res, next) {
  try {
    const { examId } = req.params;
    const { model } = req.body;

    const exam = await prisma.exam.findUnique({
      where: { id: examId },
      select: { id: true, title: true, courseCode: true },
    });
    if (!exam) throw new AppError("Exam not found", 404);

    const sessions = await prisma.examSession.findMany({
      where: { examId, status: "SUBMITTED" },
      include: {
        student: {
          select: { id: true, email: true, firstName: true, lastName: true, studentId: true },
        },
        behavioralFlags: true,
        answers: { orderBy: { answeredAt: "asc" } },
      },
    });
    if (sessions.length === 0)
      throw new AppError("No submitted sessions for this exam", 404);

    const studentPayloads = sessions.map((s, idx) => {
      const cf = (t) => s.behavioralFlags.filter((f) => f.flagType === t).length;
      const tabs = cf("TAB_SWITCH");
      const pastes = cf("PASTE_EVENT");
      const blurs = cf("WINDOW_BLUR");
      const usb = cf("USB_DETECTED");
      const multi = cf("MULTI_DEVICE") > 0;

      let tpqStd = 0;
      if (s.answers.length > 1) {
        const diffs = s.answers
          .slice(1)
          .map((a, i) => (new Date(a.answeredAt) - new Date(s.answers[i].answeredAt)) / 1000);
        const mean = diffs.reduce((a, b) => a + b, 0) / diffs.length;
        tpqStd = Math.sqrt(diffs.reduce((a, b) => a + (b - mean) ** 2, 0) / diffs.length) || 0;
      }

      return {
        _meta: {
          firstName: s.student.firstName,
          lastName: s.student.lastName,
          studentId: s.student.studentId || s.studentId,
          email: s.student.email,
          tab_switch_count: tabs,
          paste_event_count: pastes,
          window_blur_count: blurs,
          usb_detected: usb > 0,
          multi_device_login: multi,
          time_per_question_std: tpqStd,
        },
        student_id: s.studentId,
        seat_x: (idx % 10) * 0.1,
        seat_y: Math.floor(idx / 10) * 0.1,
        tab_switch_count: tabs,
        paste_event_count: pastes,
        window_blur_count: blurs,
        usb_detected: usb > 0,
        multi_device_login: multi,
        avg_answer_similarity: 0,
        time_per_question_std: tpqStd,
        response_time_pattern: 0,
        ip_similarity_score: 0,
      };
    });

    if (model) {
      try {
        await mlClient.post("/models/switch", { model });
      } catch {}
    }

    const mlPayload = {
      venue_id: `exam-${examId}`,
      exam_id: examId,
      students: studentPayloads.map(({ _meta, ...rest }) => rest),
    };

    const mlResponse = await mlClient.post("/predict", mlPayload);
    const mlPreds = mlResponse.data.predictions || [];

    const results = mlPreds.map((p, i) => {
      const m = studentPayloads[i]._meta;
      const isCheat = p.flagged_prob >= 0.5;
      const risk = p.flagged_prob >= 0.7 ? "high" : p.flagged_prob >= 0.3 ? "medium" : "low";
      return {
        student_id: p.student_id,
        student_name: `${m.firstName} ${m.lastName}`,
        student_username: m.email?.split("@")[0] || m.studentId || p.student_id,
        prediction: isCheat ? "cheater" : "honest",
        label: isCheat ? "Cheater" : "Honest",
        risk,
        flagged_prob: p.flagged_prob,
        clean_prob: p.clean_prob,
        features: {
          tab_switch_flag: m.tab_switch_count > 0,
          tab_switch_count: m.tab_switch_count,
          answer_paste_flag: m.paste_event_count > 0,
          paste_event_count: m.paste_event_count,
          window_blur_count: m.window_blur_count,
          usb_detected: m.usb_detected,
          multi_device_login: m.multi_device_login,
          time_per_question_std: m.time_per_question_std,
        },
      };
    });

    res.json({
      success: true,
      data: {
        exam,
        examId,
        model_used: mlResponse.data.model_used,
        total: results.length,
        cheaters: results.filter((r) => r.prediction === "cheater").length,
        honest: results.filter((r) => r.prediction === "honest").length,
        high_risk: results.filter((r) => r.risk === "high").length,
        medium_risk: results.filter((r) => r.risk === "medium").length,
        low_risk: results.filter((r) => r.risk === "low").length,
        results,
      },
    });
  } catch (err) {
    if (err.response)
      return next(new AppError(`ML service error: ${err.response.data?.detail || err.message}`, 502));
    next(err);
  }
}

/* ─── Live Session ─────────────────────────────────────────── */
async function getLiveSessions(req, res, next) {
  try {
    const { examId, search, gender } = req.query;
    if (!examId) throw new AppError("examId is required", 400);

    const exam = await prisma.exam.findFirst({
      where: { id: examId, createdById: req.user.id },
      select: { title: true, courseCode: true },
    });
    if (!exam) throw new AppError("Exam not found", 404);

    const sessions = await prisma.examSession.findMany({
      where: { examId },
      include: {
        student: {
          select: { id: true, firstName: true, lastName: true, email: true, studentId: true, gender: true, program: true },
        },
        behavioralFlags: { orderBy: { createdAt: "asc" } },
      },
      orderBy: { startedAt: "desc" },
    });

    let rows = sessions.map((s) => {
      const cf = (t) => s.behavioralFlags.filter((f) => f.flagType === t).length;
      return {
        sessionId: s.id,
        studentDbId: s.student.id,
        studentName: `${s.student.firstName} ${s.student.lastName}`,
        studentUsername: s.student.email?.split("@")[0] || s.student.studentId || s.student.id,
        gender: s.student.gender || "",
        program: s.student.program || "",
        status: s.status,
        tab_switch_flag: cf("TAB_SWITCH") > 0,
        tab_switch_count: cf("TAB_SWITCH"),
        time_away_exam_site: cf("WINDOW_BLUR"),
        answer_paste_flag: cf("PASTE_EVENT") > 0,
        usb_device_detection_count: cf("USB_DETECTED"),
        window_minimize_flag: cf("WINDOW_BLUR") > 0,
        multi_device_login_flag: cf("MULTI_DEVICE") > 0,
        total_flags: s.behavioralFlags.length,
        lastFlagAt: s.behavioralFlags.length > 0 ? s.behavioralFlags[s.behavioralFlags.length - 1].createdAt : null,
        startedAt: s.startedAt,
      };
    });

    if (search) {
      const q = search.toLowerCase();
      rows = rows.filter(
        (r) => r.studentName.toLowerCase().includes(q) || r.studentUsername.toLowerCase().includes(q)
      );
    }
    if (gender) rows = rows.filter((r) => r.gender?.toLowerCase() === gender.toLowerCase());

    res.json({ success: true, data: { exam, rows, polledAt: new Date().toISOString() } });
  } catch (err) {
    next(err);
  }
}

async function getSessionDeepLog(req, res, next) {
  try {
    const { sessionId } = req.params;

    const session = await prisma.examSession.findUnique({
      where: { id: sessionId },
      include: {
        student: { select: { firstName: true, lastName: true, email: true, studentId: true } },
        behavioralFlags: { orderBy: { createdAt: "asc" } },
        answers: { orderBy: { answeredAt: "asc" } },
        exam: { select: { title: true, courseCode: true } },
      },
    });
    if (!session) throw new AppError("Session not found", 404);

    const FLAG_META = {
      TAB_SWITCH:   { category: "Tab Activity",       description: "Browser tab switched or new tab opened",         severity: "high" },
      PASTE_EVENT:  { category: "Clipboard Activity",  description: "Copy / paste event detected in answer field",    severity: "high" },
      WINDOW_BLUR:  { category: "Window Activity",     description: "Exam window lost focus or was minimised",        severity: "medium" },
      USB_DETECTED: { category: "Device Activity",     description: "USB device plugged in during exam",              severity: "high" },
      MULTI_DEVICE: { category: "Network / Device",    description: "Login detected from multiple devices at once",   severity: "critical" },
      RIGHT_CLICK:  { category: "Interaction",         description: "Right-click context menu triggered",             severity: "low" },
      DEVTOOLS:     { category: "Developer Tools",     description: "Browser developer-tools panel opened",           severity: "critical" },
      INACTIVITY:   { category: "Inactivity",          description: "Extended period of inactivity detected (>90 s)", severity: "medium" },
      PRINT_ATTEMPT:{ category: "Print / Screenshot",  description: "Print-screen or screen-capture attempt detected","severity": "medium" },
      DRAG_DROP:    { category: "Clipboard Activity",  description: "Drag-and-drop text detected in answer field",    severity: "medium" },
      RAPID_SWITCH: { category: "Tab Activity",        description: "Rapid repeated tab switching (>3 switches / 10 s)", severity: "high" },
      EXTERNAL_LINK:{ category: "Navigation",          description: "Navigation to external URL detected",            severity: "high" },
      FULLSCREEN_EXIT:{ category: "Window Activity",   description: "Exited mandatory fullscreen mode",               severity: "medium" },
      KEYBOARD_SHORTCUT:{ category: "Interaction",     description: "Suspicious keyboard shortcut used (Ctrl+A / Ctrl+F / F12)", severity: "low" },
    };

    const flagLogs = session.behavioralFlags.map((f) => ({
      timestamp: f.createdAt,
      type: f.flagType,
      category: FLAG_META[f.flagType]?.category || "Unknown",
      description: FLAG_META[f.flagType]?.description || f.flagType.replace(/_/g, " ").toLowerCase(),
      severity: FLAG_META[f.flagType]?.severity || "low",
    }));

    const answerLogs = session.answers
      .filter((a) => a.answeredAt)
      .map((a, i) => ({
        timestamp: a.answeredAt,
        type: "ANSWER_SUBMITTED",
        category: "Answer Activity",
        description: `Answer submitted for question ${i + 1}`,
        severity: "info",
      }));

    const allLogs = [...flagLogs, ...answerLogs].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );

    const countType = (t) => flagLogs.filter((f) => f.type === t).length;

    res.json({
      success: true,
      data: {
        student: {
          name: `${session.student.firstName} ${session.student.lastName}`,
          id: session.student.studentId || session.student.email,
        },
        exam: { title: session.exam.title, code: session.exam.courseCode },
        status: session.status,
        startedAt: session.startedAt,
        submittedAt: session.submittedAt,
        logs: allLogs,
        summary: {
          total: allLogs.length,
          tab_switches: countType("TAB_SWITCH"),
          paste_events: countType("PASTE_EVENT"),
          window_blurs: countType("WINDOW_BLUR"),
          usb_detections: countType("USB_DETECTED"),
          multi_device: countType("MULTI_DEVICE"),
          devtools: countType("DEVTOOLS"),
          inactivity: countType("INACTIVITY"),
          right_clicks: countType("RIGHT_CLICK"),
        },
      },
    });
  } catch (err) {
    next(err);
  }
}

async function deleteSessionData(req, res, next) {
  try {
    const { examId, password } = req.body;
    if (!examId || !password) throw new AppError("examId and password are required", 400);

    const bcrypt = require("bcryptjs");
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user) throw new AppError("User not found", 404);

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) throw new AppError("Incorrect password", 401);

    const sessions = await prisma.examSession.findMany({
      where: { examId, exam: { createdById: req.user.id } },
      select: { id: true },
    });
    if (sessions.length === 0) throw new AppError("No sessions found for this exam", 404);

    const sessionIds = sessions.map((s) => s.id);
    const deleted = await prisma.behavioralFlag.deleteMany({
      where: { examSessionId: { in: sessionIds } },
    });

    res.json({
      success: true,
      message: `Deleted ${deleted.count} behavioral flag records from ${sessionIds.length} sessions.`,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  predictVenue,
  getModels,
  switchModel,
  evaluateModel,
  evaluateAll,
  getPredictions,
  listDatasets,
  importDataset,
  predictDataset,
  trainDataset,
  getIntegrityOverview,
  getExamActivityData,
  predictExamIntegrity,
  getLiveSessions,
  getSessionDeepLog,
  deleteSessionData,
};
