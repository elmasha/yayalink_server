const express = require("express");
const router = express.Router();

const {
  getUser,
  updateUser,
  deleteUser,
} = require("../controllers/users.controller");

router.get("/:uid", getUser);
router.put("/:uid", updateUser);
router.delete("/:uid", deleteUser);

module.exports = router;
