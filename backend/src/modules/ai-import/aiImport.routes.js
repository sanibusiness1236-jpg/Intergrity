const { Router } = require("express");
const { authenticate } = require("../../middleware/auth");
const { authorize } = require("../../middleware/rbac");
const ctrl = require("./aiImport.controller");

const router = Router();
router.use(authenticate);

// Upload file + start background extraction for an exam
router.post(
  "/:examId/upload",
  authorize("EXAMINER", "ADMIN"),
  ctrl.upload.single("file"),
  ctrl.uploadAndExtract
);

// List all extraction jobs for an exam
router.get("/:examId/jobs", authorize("EXAMINER", "ADMIN"), ctrl.listJobs);

// Poll a single job status / results
router.get("/job/:jobId", authorize("EXAMINER", "ADMIN"), ctrl.getJob);

// Regenerate / vary a single question via AI
router.post("/regenerate", authorize("EXAMINER", "ADMIN"), ctrl.regenerateQuestion);

module.exports = router;
