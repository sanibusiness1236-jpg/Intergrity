const { Router } = require("express");
const { authenticate } = require("../../middleware/auth");
const { authorize } = require("../../middleware/rbac");
const ctrl = require("./student.controller");

const router = Router();

router.use(authenticate);

router.get("/", authorize("EXAMINER", "ADMIN"), ctrl.getStudents);
router.get("/:studentId/exams", ctrl.getStudentExams);
router.patch("/:id/toggle-status", authorize("EXAMINER", "ADMIN"), ctrl.toggleStudentStatus);
router.patch("/:id", authorize("EXAMINER", "ADMIN"), ctrl.updateStudent);
router.post("/:id/reset-password", authorize("EXAMINER", "ADMIN"), ctrl.adminResetStudentPassword);

module.exports = router;
