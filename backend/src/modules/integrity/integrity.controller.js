const axios = require("axios");
const prisma = require("../../config/db");
const { mlServiceUrl } = require("../../config/env");
const { AppError } = require("../../middleware/errorHandler");

const mlClient = axios.create({ baseURL: mlServiceUrl, timeout: 60000 });

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

    const mlResponse = await mlClient.post("/predict", {
      venue_id: venueId,
      exam_id: examId,
      students,
    });

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
    if (err.response) {
      return next(new AppError(`ML service error: ${err.response.data.detail || err.message}`, 502));
    }
    next(err);
  }
}

async function getModels(_req, res, next) {
  try {
    const response = await mlClient.get("/models/");
    res.json({ success: true, data: response.data });
  } catch (err) {
    next(new AppError("ML service unavailable", 502));
  }
}

async function switchModel(req, res, next) {
  try {
    const { model } = req.body;
    const response = await mlClient.post("/models/switch", { model });
    res.json({ success: true, data: response.data });
  } catch (err) {
    if (err.response) {
      return next(new AppError(err.response.data.detail || "Switch failed", 400));
    }
    next(new AppError("ML service unavailable", 502));
  }
}

async function evaluateModel(req, res, next) {
  try {
    const { modelName } = req.params;
    const response = await mlClient.get(`/evaluate/${modelName}`, { params: req.query });
    res.json({ success: true, data: response.data });
  } catch (err) {
    if (err.response) {
      return next(new AppError(err.response.data.detail || "Evaluation failed", err.response.status));
    }
    next(new AppError("ML service unavailable", 502));
  }
}

async function evaluateAll(req, res, next) {
  try {
    const response = await mlClient.get("/evaluate/all", { params: req.query });
    res.json({ success: true, data: response.data });
  } catch (err) {
    next(new AppError("ML service unavailable", 502));
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
    const response = await mlClient.get("/datasets");
    res.json({ success: true, data: response.data });
  } catch (err) {
    next(new AppError("ML service unavailable", 502));
  }
}

async function importDataset(req, res, next) {
  try {
    if (req.file) {
      const csv = req.file.buffer.toString("utf-8");
      const name = req.body.name || req.file.originalname || "imported_dataset";
      const response = await mlClient.post("/datasets/import/csv-text", { name, csv });
      return res.json({ success: true, data: response.data });
    }
    if (req.body.students) {
      const response = await mlClient.post("/datasets/import/json", {
        name: req.body.name || "imported_dataset",
        students: req.body.students,
      });
      return res.json({ success: true, data: response.data });
    }
    throw new AppError("Upload a CSV file or send JSON with students array", 400);
  } catch (err) {
    if (err instanceof AppError) return next(err);
    if (err.response) {
      return next(new AppError(err.response.data.detail || "Import failed", err.response.status || 400));
    }
    next(err);
  }
}

async function predictDataset(req, res, next) {
  try {
    const { datasetId } = req.params;
    const response = await mlClient.post(`/datasets/${datasetId}/predict`);
    res.json({ success: true, data: response.data });
  } catch (err) {
    if (err.response) {
      return next(new AppError(err.response.data.detail || "Prediction failed", err.response.status || 502));
    }
    next(new AppError("ML service unavailable", 502));
  }
}

async function trainDataset(req, res, next) {
  try {
    const { datasetId } = req.params;
    const response = await mlClient.post(
      `/datasets/${datasetId}/train`,
      {},
      { params: { epochs: req.body.epochs, model: req.body.model } },
    );
    res.json({ success: true, data: response.data });
  } catch (err) {
    if (err.response) {
      return next(new AppError(err.response.data.detail || "Training failed", err.response.status || 400));
    }
    next(new AppError("ML service unavailable", 502));
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
};
