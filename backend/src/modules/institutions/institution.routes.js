const { Router } = require("express");
const multer = require("multer");
const { authenticate } = require("../../middleware/auth");
const { authorize } = require("../../middleware/rbac");
const ctrl = require("./institution.controller");

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith("image/")) cb(null, true);
    else cb(new Error("Only image files allowed"));
  },
});

router.use(authenticate);

router.get("/me", ctrl.getMyInstitution);
router.post("/", authorize("ADMIN"), ctrl.createInstitution);
router.get("/", ctrl.getInstitutions);
router.get("/:id", ctrl.getInstitution);
router.put("/:id", authorize("ADMIN", "EXAMINER"), ctrl.updateInstitution);
router.post("/:id/logo", authorize("ADMIN", "EXAMINER"), upload.single("logo"), ctrl.uploadLogo);

module.exports = router;
