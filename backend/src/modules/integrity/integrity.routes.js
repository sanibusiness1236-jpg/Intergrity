const { Router } = require("express");
const multer = require("multer");
const { authenticate } = require("../../middleware/auth");
const { authorize } = require("../../middleware/rbac");
const ctrl = require("./integrity.controller");

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === "text/csv" || file.originalname.endsWith(".csv") || file.mimetype === "application/json") {
      cb(null, true);
    } else {
      cb(new Error("Only CSV or JSON files allowed"));
    }
  },
});

router.use(authenticate);
router.use(authorize("EXAMINER", "ADMIN"));

router.post("/predict", ctrl.predictVenue);
router.get("/models", ctrl.getModels);
router.post("/models/switch", ctrl.switchModel);
router.get("/evaluate/all", ctrl.evaluateAll);
router.get("/evaluate/:modelName", ctrl.evaluateModel);
router.get("/predictions", ctrl.getPredictions);

router.get("/datasets", ctrl.listDatasets);
router.post("/datasets/import", upload.single("file"), ctrl.importDataset);
router.post("/datasets/:datasetId/predict", ctrl.predictDataset);
router.post("/datasets/:datasetId/train", ctrl.trainDataset);

router.get("/overview", ctrl.getIntegrityOverview);
router.get("/exam/:examId/activity", ctrl.getExamActivityData);
router.post("/exam/:examId/predict", ctrl.predictExamIntegrity);

module.exports = router;
