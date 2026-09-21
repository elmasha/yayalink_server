const router = require("express").Router();
const controller = require("../controllers/bureau.controller");
const candidateController = require("../controllers/candidate.controller");
const { requireActiveBureau } = require("../middleware/requireActiveBureau");

/* ─────────────── BUREAU ACCOUNT ─────────────── */

router.post("/register", controller.createBureau);

router.post(
  "/update-device-token/:user_id",
  controller.updateBureauDeviceToken
);

router.get("/get-bureau/:user_id", controller.getBureau);

router.put("/:user_id", controller.updateBureau);

router.get("/payment-status/:user_id", controller.getBureauPaymentStatus);

/* ─────────────── GATED CANDIDATE ROUTES ─────────────── */

/*
  These routes are blocked when the bureau's trial/subscription
  has expired (past trial + grace). The middleware accepts user_id
  from:
    - req.params.user_id
    - req.body.user_id
    - req.query.user_id
*/

router.post(
  "/candidates/create",
  requireActiveBureau,
  candidateController.createCandidate
);

router.put(
  "/candidates/update/:candidate_id",
  requireActiveBureau,
  candidateController.updateCandidate
);

router.delete(
  "/candidates/delete/:candidate_id",
  requireActiveBureau,
  candidateController.deleteCandidate
);

module.exports = router;