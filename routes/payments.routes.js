const express = require("express");
const router = express.Router();
const {
  confirmPayment,
  getPaymentStatus,
} = require("../controllers/payments.controller");

router.post("/confirm",  confirmPayment);
router.get("/status/:uid",  getPaymentStatus);

module.exports = router;
