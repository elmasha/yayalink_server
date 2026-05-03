const express = require("express");
const router = express.Router();
const {
  createCandidate,
  getAvailableCandidates,
  getCandidateById,
  updateCandidate,
  deleteCandidate,
  getBureauCandidateById,
  filterCandidates
} = require("../controllers/candidates.controller");

router.post("/register",  createCandidate);
router.get("/available",  getAvailableCandidates);
router.get("/bureau-candidate/:user_id",  getBureauCandidateById);
router.get("/get-candidate/:id",  getCandidateById);
router.put("/update-candidate/:id",  updateCandidate);
router.delete("/delete-candidate/:id",  deleteCandidate);
router.get("/filter", filterCandidates);

module.exports = router;
