const express = require("express");
const router = express.Router();
const { syncUser,checkEmailExists } = require("../controllers/auth.controller");

router.post("/sync", syncUser);
router.post("/auth/check-email", checkEmailExists);


module.exports = router;
