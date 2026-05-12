const router = require("express").Router();
const controller = require("../controllers/bureau.controller");

router.post("/register", controller.createBureau);
router.post("/update-device-token/:user_id", controller.updateBureauDeviceToken);
router.get("/get-bureau/:user_id", controller.getBureau);
router.put("/:user_id", controller.updateBureau);
router.get("/payment-status/:user_id", controller.getBureauPaymentStatus);

module.exports = router;
