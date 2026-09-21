// routes/userRole.routes.js
const router = require("express").Router();
const controller = require("../controllers/userRole.controller");

router.get("/:uid", controller.getUserRole);

module.exports = router;