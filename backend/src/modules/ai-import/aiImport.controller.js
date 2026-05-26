const prisma = require("../../config/db");
const axios = require("axios");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const pdfParse = require("pdf-parse");
const mammoth = require("mammoth");
const Tesseract = require("tesseract.js");
const { AppError } = require("../../middleware/errorHandler");

const HF_TOKEN = process.env.HF_TOKEN || "";
const HF_MODELS = [
  "mistralai/Mistral-7B-Instruct-v0.3",
  "HuggingFaceH4/zephyr-7b-beta",
  "meta-llama/Meta-Llama-3-8B-Instruct",
];

// ─── Multer ───────────────────────────────────────────────────────────────────
const tmpDir = path.join(process.cwd(), "tmp_uploads");
if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

const upload = multer({
  dest: tmpDir,
  limits: { fileSize: 20 * 1024 * 1024 },
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

// ═══════════════════════════════════════════════════════════════════════════════
// 1. TEXT EXTRACTION — fully local, no ML service dependency
// ═══════════════════════════════════════════════════════════════════════════════
async function extractTextFromFile(filePath, mimetype, originalName) {
  const buf = fs.readFileSync(filePath);
  const lower = (originalName || "").toLowerCase();

  // PDF ──────────────────────────────────────────────────────────────────────
  if (mimetype.includes("pdf") || lower.endsWith(".pdf")) {
    try {
      const data = await pdfParse(buf);
      return (data.text || "").trim();
    } catch (e) {
      throw new AppError(`PDF parse error: ${e.message}`, 400);
    }
  }

  // DOCX ─────────────────────────────────────────────────────────────────────
  if (
    mimetype.includes("word") ||
    mimetype.includes("officedocument") ||
    lower.endsWith(".docx") ||
    lower.endsWith(".doc")
  ) {
    try {
      const result = await mammoth.extractRawText({ buffer: buf });
      return (result.value || "").trim();
    } catch (e) {
      throw new AppError(`DOCX parse error: ${e.message}`, 400);
    }
  }

  // Image (OCR) ──────────────────────────────────────────────────────────────
  if (mimetype.startsWith("image/") || /\.(jpe?g|png)$/.test(lower)) {
    try {
      const { data } = await Tesseract.recognize(buf, "eng", { logger: () => {} });
      return (data.text || "").trim();
    } catch (e) {
      throw new AppError(`OCR error: ${e.message}`, 400);
    }
  }

  // Plain text fallback
  return buf.toString("utf-8");
}

// ═══════════════════════════════════════════════════════════════════════════════
// 2. QUESTION EXTRACTION — robust regex parser
// ═══════════════════════════════════════════════════════════════════════════════
function detectType(text, options) {
  const t = text.toLowerCase();
  if (options && options.length >= 2) return "mcq";
  if (/(true\s*or\s*false|true\/false|^\s*t\s*\/\s*f)/i.test(t)) return "true_false";
  if (/(fill\s*in|fill-in|_{3,}|\.{4,}|\[blank\])/i.test(t)) return "fill_in_blank";
  return "theory";
}

/**
 * Split a body of text into individual question blocks.
 * Handles many numbering styles:  "1." "1)" "(1)" "Q1." "Question 1:" "1:"
 */
function splitIntoBlocks(text) {
  // Normalise whitespace
  const cleaned = text
    .replace(/\r/g, "")
    .replace(/\u00A0/g, " ")
    .replace(/\t/g, "  ");

  // The lookahead pattern captures each question header
  const splitRe =
    /(?=^\s*(?:Question\s*|Q\s*\.?\s*|Problem\s*|Exercise\s*)?(?:\(?\s*\d{1,3}\s*\)?\s*)[.):\]]\s+)/gim;

  const parts = cleaned.split(splitRe).map((p) => p.trim()).filter(Boolean);

  // Remove preamble blocks that don't look like questions (no leading number)
  return parts.filter((p) =>
    /^\s*(?:Question\s*|Q\s*\.?\s*|Problem\s*|Exercise\s*)?\(?\s*\d{1,3}\s*\)?\s*[.):\]]/i.test(p)
  );
}

function parseOneBlock(block, defaultMarks) {
  // Try to pull marks from the end e.g. "[2 marks]" or "(5 pts)"
  let marks = defaultMarks;
  const marksMatch = block.match(/\[\s*(\d+(?:\.\d+)?)\s*(?:marks?|pts?|points?)\s*\]|\((\d+(?:\.\d+)?)\s*(?:marks?|pts?|points?)\)/i);
  if (marksMatch) marks = parseFloat(marksMatch[1] || marksMatch[2]);

  // Remove leading question number
  let body = block.replace(
    /^\s*(?:Question\s*|Q\s*\.?\s*|Problem\s*|Exercise\s*)?\(?\s*\d{1,3}\s*\)?\s*[.):\]]\s*/i,
    ""
  );

  // Pull out option lines (A. / a) / (a) / [A] etc.) — anywhere in the body
  const optionRe = /(?:^|\n)\s*[\(\[]?\s*([A-Ha-h])\s*[\)\].\:]\s*([^\n]+)/g;
  const options = [];
  let m;
  while ((m = optionRe.exec(body)) !== null) {
    const txt = m[2].trim();
    if (txt && txt.length < 300) options.push(txt);
  }

  // Pull answer hint
  let answer = "";
  const ansRe = /\b(?:ans(?:wer)?|key|correct(?:\s*answer)?)\s*[:\-]\s*([^\n]+)/i;
  const ansM = body.match(ansRe);
  if (ansM) {
    answer = ansM[1].trim();
    body = body.replace(ansM[0], "").trim();
  }

  // The question text is the body with options stripped out
  let questionText = body
    .replace(optionRe, "")
    .replace(/\[\s*\d+(?:\.\d+)?\s*(?:marks?|pts?|points?)\s*\]/gi, "")
    .replace(/\(\s*\d+(?:\.\d+)?\s*(?:marks?|pts?|points?)\s*\)/gi, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\n{2,}/g, "\n")
    .trim();

  if (questionText.length < 5) return null;

  return {
    question_text: questionText,
    question_type: detectType(questionText, options),
    options,
    answer,
    marks,
  };
}

function regexExtractQuestions(text, defaultMarks = 1) {
  if (!text || text.trim().length < 10) return [];
  const blocks = splitIntoBlocks(text);
  const questions = [];
  for (const b of blocks) {
    const q = parseOneBlock(b, defaultMarks);
    if (q) questions.push(q);
  }
  return questions;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 3. AI ENHANCEMENT via HF Inference API (optional — only when HF_TOKEN exists)
// ═══════════════════════════════════════════════════════════════════════════════
async function callHFInference(prompt, maxTokens = 1500) {
  if (!HF_TOKEN) return "";
  for (const model of HF_MODELS) {
    try {
      const resp = await axios.post(
        `https://api-inference.huggingface.co/models/${model}`,
        {
          inputs: prompt,
          parameters: {
            max_new_tokens: maxTokens,
            temperature: 0.4,
            return_full_text: false,
          },
        },
        {
          headers: { Authorization: `Bearer ${HF_TOKEN}` },
          timeout: 90_000,
        }
      );
      const data = resp.data;
      if (Array.isArray(data) && data[0]?.generated_text) return data[0].generated_text;
      if (data?.generated_text) return data.generated_text;
    } catch {
      // try next model
    }
  }
  return "";
}

function parseAIJsonArray(raw, defaultMarks) {
  const m = raw.match(/\[[\s\S]*\]/);
  if (!m) return [];
  try {
    const arr = JSON.parse(m[0]);
    const out = [];
    for (const it of arr) {
      if (!it || typeof it !== "object") continue;
      let qt = String(it.question_type || "theory").toLowerCase();
      if (qt.includes("mcq") || qt.includes("multiple")) qt = "mcq";
      else if (qt.includes("fill")) qt = "fill_in_blank";
      else if (qt.includes("true")) qt = "true_false";
      else qt = "theory";
      const qtext = String(it.question_text || it.question || "").trim();
      if (!qtext) continue;
      out.push({
        question_text: qtext,
        question_type: qt,
        options: Array.isArray(it.options) ? it.options.map(String) : [],
        answer: String(it.answer || it.correct_answer || "").trim(),
        marks: Number(it.marks) || defaultMarks,
      });
    }
    return out;
  } catch {
    return [];
  }
}

async function aiExtractQuestions(text, courseName, defaultMarks) {
  if (!HF_TOKEN) return [];
  const snippet = text.length > 6000 ? text.slice(0, 6000) : text;
  const prompt = `<s>[INST]
You are an academic question extractor for the course "${courseName || "General"}".

Extract every exam question from the text below.
Return a JSON ARRAY only — no prose, no markdown fences.

Each item must have these keys exactly:
- "question_text"  : the full question
- "question_type"  : one of "mcq", "fill_in_blank", "true_false", "theory"
- "options"        : array of strings (only for MCQ, else [])
- "answer"         : correct answer or "" if unknown
- "marks"          : numeric (default ${defaultMarks})

TEXT:
${snippet}

Respond with ONLY the JSON array.
[/INST]`;
  const raw = await callHFInference(prompt, 2000);
  return parseAIJsonArray(raw, defaultMarks);
}

// ═══════════════════════════════════════════════════════════════════════════════
// 4. REGENERATION
// ═══════════════════════════════════════════════════════════════════════════════
async function aiRegenerate(q, mode) {
  const description = {
    similar: "Create a different question on the same topic with similar difficulty.",
    harder: "Create a harder version with more complex reasoning.",
    easier: "Create a simpler version of this question.",
  }[mode] || "Create a variation.";

  const optTxt = q.options?.length
    ? "\nOptions were:\n" + q.options.map((o, i) => `  ${String.fromCharCode(65 + i)}. ${o}`).join("\n")
    : "";

  const prompt = `<s>[INST]
You are an academic exam question generator.

Original question (${q.question_type}):
${q.question_text}${optTxt}

Task: ${description}

Return ONE JSON object only with these keys:
- "question_text"  : new question
- "question_type"  : "${q.question_type}"
- "options"        : array of 4 options if MCQ else []
- "answer"         : correct answer
- "marks"          : 1

Respond with ONLY the JSON object.
[/INST]`;

  const raw = await callHFInference(prompt, 600);
  if (raw) {
    const m = raw.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        const obj = JSON.parse(m[0]);
        return {
          question_text: String(obj.question_text || "").trim(),
          question_type: q.question_type,
          options: Array.isArray(obj.options) ? obj.options.map(String) : [],
          answer: String(obj.answer || "").trim(),
          marks: Number(obj.marks) || 1,
        };
      } catch {
        // fall through to placeholder
      }
    }
  }

  // Fallback — return a clearly marked placeholder
  const suffix = { similar: " (variation)", harder: " (harder)", easier: " (simpler)" }[mode] || " (variation)";
  return {
    question_text: q.question_text + suffix,
    question_type: q.question_type,
    options: q.options || [],
    answer: "",
    marks: 1,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// 5. ROUTE HANDLERS
// ═══════════════════════════════════════════════════════════════════════════════

// POST /ai-import/:examId/upload
async function uploadAndExtract(req, res, next) {
  try {
    const { examId } = req.params;
    const exam = await prisma.exam.findUnique({ where: { id: examId } });
    if (!exam) throw new AppError("Exam not found", 404);
    if (exam.createdById !== req.user.id && req.user.role !== "ADMIN") {
      throw new AppError("Not authorised", 403);
    }

    if (!req.file) throw new AppError("No file uploaded", 400);

    const filePath = req.file.path;
    const fileType =
      req.file.mimetype.includes("pdf") ? "pdf" :
      req.file.mimetype.includes("word") || req.file.mimetype.includes("doc") ? "docx" :
      "image";

    const job = await prisma.aIImportJob.create({
      data: {
        examId,
        createdById: req.user.id,
        status: "processing",
        fileType,
        fileName: req.file.originalname,
      },
    });

    // Respond immediately
    res.status(202).json({ success: true, data: { jobId: job.id, status: "processing" } });

    // Background work
    setImmediate(async () => {
      try {
        // Step 1 — extract text locally
        const text = await extractTextFromFile(filePath, req.file.mimetype, req.file.originalname);

        if (!text || text.trim().length < 10) {
          await prisma.aIImportJob.update({
            where: { id: job.id },
            data: {
              status: "error",
              errorMsg: "No text could be read from the file. If it's a scanned PDF, try uploading as image instead.",
            },
          });
          return;
        }

        // Step 2 — run regex extractor (fast, always works)
        let questions = regexExtractQuestions(text, 1);

        // Step 3 — try AI for a smarter parse (additive — keep whichever yields more)
        try {
          const aiQs = await aiExtractQuestions(text, exam.courseName, 1);
          if (aiQs.length > questions.length) questions = aiQs;
        } catch { /* AI is optional */ }

        await prisma.aIImportJob.update({
          where: { id: job.id },
          data: {
            status: questions.length > 0 ? "done" : "error",
            questions,
            errorMsg:
              questions.length === 0
                ? "No numbered questions found. Make sure your file uses numbering like 1., 2., 3. or Q1, Q2…"
                : null,
          },
        });
      } catch (err) {
        await prisma.aIImportJob.update({
          where: { id: job.id },
          data: { status: "error", errorMsg: err.message || "Processing failed" },
        }).catch(() => {});
      } finally {
        fs.unlink(filePath, () => {});
      }
    });
  } catch (err) {
    if (req.file) fs.unlink(req.file.path, () => {});
    next(err);
  }
}

// GET /ai-import/:examId/jobs
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

// GET /ai-import/job/:jobId
async function getJob(req, res, next) {
  try {
    const job = await prisma.aIImportJob.findUnique({ where: { id: req.params.jobId } });
    if (!job) throw new AppError("Job not found", 404);
    res.json({ success: true, data: job });
  } catch (err) {
    next(err);
  }
}

// POST /ai-import/regenerate
async function regenerateQuestion(req, res, next) {
  try {
    const { question_text, question_type, options, mode } = req.body;
    if (!question_text) throw new AppError("question_text is required", 400);

    const result = await aiRegenerate(
      {
        question_text,
        question_type: question_type || "theory",
        options: options || [],
      },
      mode || "similar"
    );

    res.json({ success: true, data: { question: result } });
  } catch (err) {
    next(err);
  }
}

module.exports = { upload, uploadAndExtract, listJobs, getJob, regenerateQuestion };
