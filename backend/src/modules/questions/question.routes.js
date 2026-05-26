const { Router } = require("express");
const { authenticate } = require("../../middleware/auth");
const { authorize } = require("../../middleware/rbac");
const ctrl = require("./question.controller");

const router = Router();

router.use(authenticate);

router.post("/upload-media", authorize("EXAMINER", "ADMIN"), ctrl.mediaUpload.single("file"), ctrl.uploadMedia);
router.post("/exam/:examId", authorize("EXAMINER", "ADMIN"), ctrl.addQuestion);
router.post("/exam/:examId/bulk", authorize("EXAMINER", "ADMIN"), ctrl.addBulkQuestions);
router.get("/exam/:examId", ctrl.getQuestions);
router.put("/:id", authorize("EXAMINER", "ADMIN"), ctrl.updateQuestion);
router.delete("/:id", authorize("EXAMINER", "ADMIN"), ctrl.deleteQuestion);

// Student-flagged question reports
router.post("/:id/report", authorize("STUDENT"), ctrl.reportQuestion);
router.get("/exam/:examId/reports", authorize("EXAMINER", "ADMIN"), ctrl.listReportsForExam);
router.patch("/reports/:id", authorize("EXAMINER", "ADMIN"), ctrl.updateReportStatus);

module.exports = router;
