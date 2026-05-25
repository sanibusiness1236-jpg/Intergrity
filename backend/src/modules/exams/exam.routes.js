const { Router } = require("express");
const { authenticate } = require("../../middleware/auth");
const { authorize } = require("../../middleware/rbac");
const ctrl = require("./exam.controller");
const { examValidation, uuidParam } = require("../../utils/validators");

const router = Router();

router.use(authenticate);

router.post("/", authorize("EXAMINER", "ADMIN"), examValidation, ctrl.createExam);
router.get("/", ctrl.getExams);
router.get("/:id", uuidParam(), ctrl.getExam);
router.put("/:id", authorize("EXAMINER", "ADMIN"), uuidParam(), ctrl.updateExam);
router.delete("/:id", authorize("EXAMINER", "ADMIN"), uuidParam(), ctrl.deleteExam);
router.patch("/:id/publish", authorize("EXAMINER", "ADMIN"), uuidParam(), ctrl.publishExam);
router.put("/:id/geofence", authorize("EXAMINER", "ADMIN"), uuidParam(), ctrl.saveGeofence);
router.get("/:id/geofence", uuidParam(), ctrl.getGeofence);
router.post("/:id/geofence/validate", uuidParam(), ctrl.validateGeofence);

module.exports = router;
