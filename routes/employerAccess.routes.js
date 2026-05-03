const router = require("express").Router();
const { checkEmployerAccess ,checkEmployerPaymentStatus,selectCandidate} = require("../controllers/employerAccess.controller");

router.get("/:uid", checkEmployerAccess);
router.get(
  "/payment-status/:uid",
  checkEmployerPaymentStatus
);

router.post("/select", selectCandidate);


module.exports = router;
