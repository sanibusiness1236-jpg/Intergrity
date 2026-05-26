const path = require("path");
const { v4: uuidv4 } = require("uuid");
const multer = require("multer");
const prisma = require("../../config/db");
const { AppError } = require("../../middleware/errorHandler");
const { getSupabaseClient } = require("../../config/supabase");

const MEDIA_BUCKET = "question-media";

const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png"];
const ALLOWED_AUDIO_TYPES = ["audio/mpeg", "audio/mp4", "audio/aac", "audio/wav", "audio/x-wav", "audio/x-m4a"];
const IMAGE_SIZE_LIMIT = 5 * 1024 * 1024;  // 5 MB
const AUDIO_SIZE_LIMIT = 10 * 1024 * 1024; // 10 MB (generous for WAV/AAC)

const mediaUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: IMAGE_SIZE_LIMIT },   // multer hard cap; audio checked manually below
  fileFilter(req, file, cb) {
    const isImage = ALLOWED_IMAGE_TYPES.includes(file.mimetype);
    const isAudio = ALLOWED_AUDIO_TYPES.includes(file.mimetype);
    if (!isImage && !isAudio) {
      return cb(new AppError("Only JPG/PNG images or MP3/M4A/AAC/WAV audio files are allowed", 400));
    }
    cb(null, true);
  },
});

async function ensureMediaBucket(supabase) {
  const { data: buckets } = await supabase.storage.listBuckets();
  const exists = buckets?.some((b) => b.name === MEDIA_BUCKET);
  if (!exists) {
    await supabase.storage.createBucket(MEDIA_BUCKET, { public: true });
  }
}

async function uploadMedia(req, res, next) {
  try {
    if (!req.file) throw new AppError("No file provided", 400);

    const isAudio = ALLOWED_AUDIO_TYPES.includes(req.file.mimetype);
    const isImage = ALLOWED_IMAGE_TYPES.includes(req.file.mimetype);
    if (isImage && req.file.size > IMAGE_SIZE_LIMIT) {
      throw new AppError("Image must be 5 MB or smaller", 400);
    }
    if (isAudio && req.file.size > AUDIO_SIZE_LIMIT) {
      throw new AppError("Audio file must be 10 MB or smaller", 400);
    }

    const supabase = getSupabaseClient();
    await ensureMediaBucket(supabase);

    const ext = path.extname(req.file.originalname).toLowerCase() || (isAudio ? ".mp3" : ".jpg");
    const fileName = `${uuidv4()}${ext}`;
    const folder = req.file.mimetype.startsWith("audio/") ? "audio" : "images";
    const storagePath = `${folder}/${fileName}`;

    const { error } = await supabase.storage
      .from(MEDIA_BUCKET)
      .upload(storagePath, req.file.buffer, {
        contentType: req.file.mimetype,
        upsert: false,
      });

    if (error) throw new AppError(`Storage upload failed: ${error.message}`, 500);

    const { data: { publicUrl } } = supabase.storage
      .from(MEDIA_BUCKET)
      .getPublicUrl(storagePath);

    res.json({ success: true, url: publicUrl });
  } catch (err) {
    next(err);
  }
}

const VALID_TYPES = ["MCQ", "TRUE_FALSE", "FILL_IN_BLANK", "MULTI_BLANK_EQUATION"];

function validateQuestionPayload({ type, text, correctAnswer, options }) {
  if (!type || !VALID_TYPES.includes(type)) {
    throw new AppError(`Invalid question type. Must be one of: ${VALID_TYPES.join(", ")}`, 400);
  }
  if (!text || typeof text !== "string" || !text.trim()) {
    throw new AppError("Question text is required", 400);
  }
  if (correctAnswer === undefined || correctAnswer === null || correctAnswer === "") {
    throw new AppError("Correct answer is required", 400);
  }
  if (type === "MCQ") {
    if (!Array.isArray(options) || options.length < 2) {
      throw new AppError("MCQ questions need at least 2 options", 400);
    }
    if (!options.includes(correctAnswer)) {
      throw new AppError("Correct answer must match one of the options", 400);
    }
  }
  if (type === "MULTI_BLANK_EQUATION" && !Array.isArray(correctAnswer)) {
    throw new AppError("Multi-blank equation needs an array of answers", 400);
  }
}

async function ensureExamOwnership(examId, user) {
  const exam = await prisma.exam.findUnique({
    where: { id: examId },
    select: { id: true, createdById: true },
  });
  if (!exam) throw new AppError("Exam not found", 404);
  if (exam.createdById !== user.id && user.role !== "ADMIN") {
    throw new AppError("You can only modify questions on exams you created", 403);
  }
  return exam;
}

async function addQuestion(req, res, next) {
  try {
    const { examId } = req.params;
    const { type, text, options, correctAnswer, marks, order, explanation, fillInBlankType, blocks } = req.body;

    await ensureExamOwnership(examId, req.user);

    // For block-based questions, text is optional (summary derived from blocks)
    const isBlockBased = Array.isArray(blocks) && blocks.length > 0;
    if (!isBlockBased) {
      validateQuestionPayload({ type, text, correctAnswer, options });
    } else if (!type || !VALID_TYPES.includes(type)) {
      throw new AppError(`Invalid question type. Must be one of: ${VALID_TYPES.join(", ")}`, 400);
    }

    const parsedMarks = marks != null && marks !== "" ? parseFloat(marks) : 1;
    if (Number.isNaN(parsedMarks)) {
      throw new AppError("Marks must be a valid number", 400);
    }

    const question = await prisma.question.create({
      data: {
        examId,
        type,
        text: text || (isBlockBased ? "[block-based question]" : ""),
        options: options ?? null,
        correctAnswer: correctAnswer ?? (isBlockBased ? "" : undefined),
        marks: parsedMarks,
        order: order || 0,
        explanation: explanation ?? null,
        fillInBlankType: type === "FILL_IN_BLANK" ? (fillInBlankType || "text") : null,
        blocks: isBlockBased ? blocks : null,
      },
    });

    await prisma.exam.update({
      where: { id: examId },
      data: { totalMarks: { increment: question.marks } },
    });

    res.status(201).json({ success: true, data: question });
  } catch (err) {
    next(err);
  }
}

async function addBulkQuestions(req, res, next) {
  try {
    const { examId } = req.params;
    const { questions } = req.body;

    if (!Array.isArray(questions) || questions.length === 0) {
      throw new AppError("Provide a non-empty array of questions", 400);
    }

    await ensureExamOwnership(examId, req.user);

    questions.forEach((q, i) => {
      try {
        validateQuestionPayload(q);
      } catch (e) {
        throw new AppError(`Question #${i + 1}: ${e.message}`, 400);
      }
    });

    const created = await prisma.$transaction(
      questions.map((q, i) =>
        prisma.question.create({
          data: {
            examId,
            type: q.type,
            text: q.text,
            options: q.options ?? null,
            correctAnswer: q.correctAnswer,
            marks: q.marks != null && q.marks !== "" ? parseFloat(q.marks) : 1,
            order: q.order ?? i,
            explanation: q.explanation ?? null,
            fillInBlankType: q.type === "FILL_IN_BLANK" ? (q.fillInBlankType || "text") : null,
          },
        })
      )
    );

    const totalNewMarks = created.reduce((sum, q) => sum + q.marks, 0);
    await prisma.exam.update({
      where: { id: examId },
      data: { totalMarks: { increment: totalNewMarks } },
    });

    res.status(201).json({ success: true, data: created });
  } catch (err) {
    next(err);
  }
}

async function getQuestions(req, res, next) {
  try {
    const questions = await prisma.question.findMany({
      where: { examId: req.params.examId },
      orderBy: { order: "asc" },
    });
    res.json({ success: true, data: questions });
  } catch (err) {
    next(err);
  }
}

async function updateQuestion(req, res, next) {
  try {
    const existing = await prisma.question.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new AppError("Question not found", 404);

    await ensureExamOwnership(existing.examId, req.user);

    const { type, text, options, correctAnswer, marks, order, explanation, fillInBlankType, blocks } = req.body;
    const data = {};
    if (type !== undefined) data.type = type;
    if (text !== undefined) data.text = text;
    if (options !== undefined) data.options = options;
    if (correctAnswer !== undefined) data.correctAnswer = correctAnswer;
    if (marks !== undefined) {
      const parsed = parseFloat(marks);
      if (Number.isNaN(parsed)) throw new AppError("Marks must be a valid number", 400);
      data.marks = parsed;
    }
    if (order !== undefined) data.order = order;
    if (explanation !== undefined) data.explanation = explanation;
    if (fillInBlankType !== undefined) data.fillInBlankType = fillInBlankType;
    if (blocks !== undefined) data.blocks = Array.isArray(blocks) && blocks.length > 0 ? blocks : null;

    const question = await prisma.question.update({
      where: { id: req.params.id },
      data,
    });

    if (marks !== undefined && parseFloat(marks) !== existing.marks) {
      const delta = parseFloat(marks) - existing.marks;
      await prisma.exam.update({
        where: { id: existing.examId },
        data: { totalMarks: { increment: delta } },
      });
    }

    res.json({ success: true, data: question });
  } catch (err) {
    next(err);
  }
}

async function deleteQuestion(req, res, next) {
  try {
    const question = await prisma.question.findUnique({ where: { id: req.params.id } });
    if (!question) throw new AppError("Question not found", 404);

    await ensureExamOwnership(question.examId, req.user);

    await prisma.question.delete({ where: { id: req.params.id } });

    await prisma.exam.update({
      where: { id: question.examId },
      data: { totalMarks: { decrement: question.marks } },
    });

    res.json({ success: true, message: "Question deleted" });
  } catch (err) {
    next(err);
  }
}

module.exports = { addQuestion, addBulkQuestions, getQuestions, updateQuestion, deleteQuestion, uploadMedia, mediaUpload };
