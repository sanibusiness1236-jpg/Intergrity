const prisma = require("../../config/db");
const axios = require("axios");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { AppError } = require("../../middleware/errorHandler");

const ML_SERVICE_URL = process.env.ML_SERVICE_URL || "http://localhost:8000";

// ─── Multer — store uploads in /tmp ───────────────────────────────────────────
const upload = multer({
  dest: path.join(process.cwd(), "tmp_uploads"),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB
  fileFilter(_req, file, cb) {
    const allowed = [
      "application/pdf",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "image/jpeg",
      "image/png",
      "image/jpg",
    ];
    if (allowed.includes(file.mimetype)) return cb(null, true);
    cb(new AppError("Unsupported file type. Upload PDF, DOC, DOCX, JPG or PNG.", 400));
  },
});

// ─── Helper: extract raw text from uploaded file ──────────────────────────────
async function extractText(filePath, mimetype) {
  // For images and complex docs we forward to the ML service which has
  // pytesseract / pymupdf / python-docx installed.
  // For plain text PDFs we can often just return the raw buffer; the ML
  // service handles proper extraction.
  const form = new (require("form-data"))();
  form.append("file", fs.createReadStream(filePath));
  try {
    const resp = await axios.post(`${ML_SERVICE_URL}/ai/extract-text`, form, {
      headers: form.getHeaders(),
      timeout: 60_000,
    });
    return resp.data?.text || "";
  } catch {
    // fallback: read raw bytes as utf-8 (works for text-based PDFs)
    try {
      return fs.readFileSync(filePath, "utf-8");
    } catch {
      return "";
    }
  }
}

// ─── POST /ai-import/:examId/upload ──────────────────────────────────────────
async function uploadAndExtract(req, res, next) {
  try {
    const { examId } = req.params;
    const exam = await prisma.exam.findUnique({ where: { id: examId } });
    if (!exam) throw new AppError("Exam not found", 404);
    if (exam.createdById !== req.user.id && req.user.role !== "ADMIN") {
      throw new AppError("Not authorised", 403);
    }

    if (!req.file) throw new AppError("No file uploaded", 400);

    const fileType = req.file.mimetype.includes("pdf")
      ? "pdf"
      : req.file.mimetype.includes("word") || req.file.mimetype.includes("doc")
      ? "docx"
      : "image";

    // Create job record
    const job = await prisma.aIImportJob.create({
      data: {
        examId,
        createdById: req.user.id,
        status: "processing",
        fileType,
        fileName: req.file.originalname,
      },
    });

    // Process asynchronously — respond immediately with job id
    res.status(202).json({ success: true, data: { jobId: job.id, status: "processing" } });

    // Background processing (does NOT block the response)
    setImmediate(async () => {
      try {
        const text = await extractText(req.file.path, req.file.mimetype);

        // Ask ML service to extract questions from the text
        const mlResp = await axios.post(
          `${ML_SERVICE_URL}/ai/extract-questions`,
          {
            text,
            course_name: exam.courseName,
            default_marks: 1,
          },
          { timeout: 120_000 }
        );

        const questions = mlResp.data?.questions || [];
        await prisma.aIImportJob.update({
          where: { id: job.id },
          data: {
            status: questions.length > 0 ? "done" : "error",
            questions: questions,
            errorMsg: questions.length === 0 ? "No questions could be extracted." : null,
          },
        });
      } catch (err) {
        await prisma.aIImportJob.update({
          where: { id: job.id },
          data: { status: "error", errorMsg: err.message || "Processing failed" },
        }).catch(() => {});
      } finally {
        // Clean up temp file
        fs.unlink(req.file.path, () => {});
      }
    });
  } catch (err) {
    if (req.file) fs.unlink(req.file.path, () => {});
    next(err);
  }
}

// ─── GET /ai-import/:examId/jobs ─────────────────────────────────────────────
async function listJobs(req, res, next) {
  try {
    const jobs = await prisma.aIImportJob.findMany({
      where: { examId: req.params.examId },
      orderBy: { createdAt: "desc" },
      take: 20,
    });
    res.json({ success: true, data: jobs });
  } catch (err) {
    next(err);
  }
}

// ─── GET /ai-import/job/:jobId ────────────────────────────────────────────────
async function getJob(req, res, next) {
  try {
    const job = await prisma.aIImportJob.findUnique({ where: { id: req.params.jobId } });
    if (!job) throw new AppError("Job not found", 404);
    res.json({ success: true, data: job });
  } catch (err) {
    next(err);
  }
}

// ─── POST /ai-import/regenerate ───────────────────────────────────────────────
async function regenerateQuestion(req, res, next) {
  try {
    const { question_text, question_type, options, mode } = req.body;
    if (!question_text) throw new AppError("question_text is required", 400);

    const mlResp = await axios.post(
      `${ML_SERVICE_URL}/ai/regenerate-question`,
      { question_text, question_type: question_type || "theory", options: options || [], mode: mode || "similar" },
      { timeout: 60_000 }
    );
    res.json({ success: true, data: mlResp.data });
  } catch (err) {
    next(err);
  }
}

module.exports = { upload, uploadAndExtract, listJobs, getJob, regenerateQuestion };
