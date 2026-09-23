const express = require("express");
const router = express.Router();
const {
  confirmPayment,
  getPaymentStatus,
  getPlans
} = require("../controllers/payments.controller");

router.post("/confirm",  confirmPayment);
router.get("/status/:uid",  getPaymentStatus);
router.get("/plans/:user_type",  getPlans);   // 👈 NEW
module.exports = router;
