const express = require("express");
const router = express.Router();
const {
  createFeedback,
  getFeedback,
  deleteFeedback,
} = require("../controllers/feedback.controller");

router.post("/",  createFeedback);
router.get("/",  getFeedback);
router.delete("/:id",  deleteFeedback);

module.exports = router;
