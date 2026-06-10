const { body, param, query } = require("express-validator");

const registerValidation = [
  body("email").isEmail().normalizeEmail(),
  body("password").isLength({ min: 8 }),
  body("firstName").trim().notEmpty(),
  body("lastName").trim().notEmpty(),
  body("role").isIn(["EXAMINER", "STUDENT", "INVIGILATOR", "ADMIN"]),
];

const loginValidation = [
  body("email").isEmail().normalizeEmail(),
  body("password").notEmpty(),
];

const examValidation = [
  body("title").trim().notEmpty(),
  body("courseCode").trim().notEmpty(),
  body("courseName").trim().notEmpty(),
  body("durationMinutes").isInt({ min: 1 }),
];

const questionValidation = [
  body("type").isIn(["MCQ", "TRUE_FALSE", "FILL_IN_BLANK", "MULTI_BLANK_EQUATION", "TEMPLATE_FILL"]),
  body("text").trim().notEmpty(),
  body("correctAnswer").notEmpty(),
  body("marks").optional().isInt({ min: 1 }),
];

const uuidParam = (name = "id") => param(name).isUUID();

module.exports = {
  registerValidation,
  loginValidation,
  examValidation,
  questionValidation,
  uuidParam,
};
