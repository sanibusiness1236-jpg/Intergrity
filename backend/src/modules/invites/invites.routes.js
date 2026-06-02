const { Router } = require("express");
const { authenticate } = require("../../middleware/auth");
const ctrl = require("./invites.controller");

const router = Router();

// Public — validate a token before showing the register form
router.get("/validate/:token", ctrl.validateToken);

// All routes below require authentication
router.use(authenticate);

router.post("/", ctrl.createInvite);
router.get("/", ctrl.listInvites);
router.delete("/:id", ctrl.revokeInvite);

// Super-admin user management
router.get("/examiners", ctrl.listExaminers);
router.patch("/users/:userId/super-admin", ctrl.grantSuperAdmin);

module.exports = router;
