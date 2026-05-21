const { Router } = require("express");
const multer = require("multer");
const { authenticate } = require("../../middleware/auth");
const ctrl = require("./user.controller");

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

router.get("/me", ctrl.getProfile);
router.put("/me", ctrl.updateProfile);
router.post("/me/avatar", upload.single("avatar"), ctrl.uploadAvatar);

module.exports = router;
