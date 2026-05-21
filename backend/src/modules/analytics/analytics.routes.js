const { Router } = require("express");
const { authenticate } = require("../../middleware/auth");
const { authorize } = require("../../middleware/rbac");
const ctrl = require("./analytics.controller");

const router = Router();

router.use(authenticate);
router.use(authorize("EXAMINER", "ADMIN"));

router.get("/exam/:examId", ctrl.getExamStats);
router.get("/exam/:examId/grades", ctrl.getGradeBoundaries);
router.get("/exam/:examId/scaled", ctrl.getScaledScores);
router.get("/exam/:examId/students", ctrl.getStudentScores);
router.get("/exam/:examId/questions", ctrl.getQuestionAnalytics);
router.get("/exam/:examId/leaderboard", ctrl.getLeaderboard);
router.get("/exam/:examId/time", ctrl.getTimeAnalytics);
router.get("/exam/:examId/sessions", ctrl.getSessionSummary);
router.get("/institution/:institutionId", ctrl.getCourseAnalytics);

module.exports = router;
