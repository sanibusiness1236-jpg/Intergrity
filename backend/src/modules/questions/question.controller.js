const prisma = require("../../config/db");
const { AppError } = require("../../middleware/errorHandler");

async function addQuestion(req, res, next) {
  try {
    const { examId } = req.params;
    const { type, text, options, correctAnswer, marks, order, explanation, fillInBlankType } = req.body;

    const exam = await prisma.exam.findUnique({ where: { id: examId } });
    if (!exam) throw new AppError("Exam not found", 404);

    const question = await prisma.question.create({
      data: {
        examId, type, text, options, correctAnswer,
        marks: marks != null ? parseFloat(marks) : 1,
        order: order || 0,
        explanation,
        fillInBlankType: type === "FILL_IN_BLANK" ? (fillInBlankType || "text") : null,
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

    const exam = await prisma.exam.findUnique({ where: { id: examId } });
    if (!exam) throw new AppError("Exam not found", 404);

    const created = await prisma.$transaction(
      questions.map((q, i) =>
        prisma.question.create({
          data: {
            examId,
            type: q.type,
            text: q.text,
            options: q.options,
            correctAnswer: q.correctAnswer,
            marks: q.marks != null ? parseFloat(q.marks) : 1,
            order: q.order ?? i,
            explanation: q.explanation,
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

    const { type, text, options, correctAnswer, marks, order, explanation, fillInBlankType } = req.body;
    const data = {};
    if (type !== undefined) data.type = type;
    if (text !== undefined) data.text = text;
    if (options !== undefined) data.options = options;
    if (correctAnswer !== undefined) data.correctAnswer = correctAnswer;
    if (marks !== undefined) data.marks = parseFloat(marks);
    if (order !== undefined) data.order = order;
    if (explanation !== undefined) data.explanation = explanation;
    if (fillInBlankType !== undefined) data.fillInBlankType = fillInBlankType;

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

module.exports = { addQuestion, addBulkQuestions, getQuestions, updateQuestion, deleteQuestion };
