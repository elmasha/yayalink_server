const router = require("express").Router();
const { getCounties } = require("../controllers/counties.controller");

router.get("/get-counties", getCounties);

module.exports = router;
