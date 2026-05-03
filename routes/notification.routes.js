const express = require("express");
const router = express.Router();
const { getNotifications,markNotificationRead } = require("../controllers/notification.controller");

router.get("/get-notifications/:uid", getNotifications);
router.post("/read/:id", markNotificationRead);

module.exports = router;
