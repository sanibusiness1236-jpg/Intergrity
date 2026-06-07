const { Router } = require("express");
const { authenticate } = require("../../middleware/auth");
const { authorize } = require("../../middleware/rbac");
const ctrl = require("./session.controller");

const router = Router();

router.use(authenticate);

router.post("/start", authorize("STUDENT"), ctrl.startSession);
router.post("/:sessionId/autosave", authorize("STUDENT"), ctrl.autoSave);
router.post("/:sessionId/submit", authorize("STUDENT"), ctrl.submitExam);
router.post("/:sessionId/log-refresh", authorize("STUDENT"), ctrl.logPageRefresh);
router.get("/my-active", authorize("STUDENT"), ctrl.getMyActiveSession);
router.get("/active", authorize("INVIGILATOR", "EXAMINER", "ADMIN"), ctrl.getActiveSessions);
router.get("/:sessionId", ctrl.getSession);
router.patch("/:sessionId/relocate", authorize("INVIGILATOR", "ADMIN"), ctrl.relocateStudent);

module.exports = router;
