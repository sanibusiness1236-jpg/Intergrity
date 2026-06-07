const { Router } = require("express");
const { authenticate } = require("../../middleware/auth");
const { authorize } = require("../../middleware/rbac");
const ctrl = require("./anomaly.controller");

const router = Router();

router.use(authenticate);
router.use(authorize("EXAMINER", "ADMIN"));

router.get("/ip", ctrl.getIpAnomalies);
router.get("/page-refreshes", ctrl.getPageRefreshes);

module.exports = router;
