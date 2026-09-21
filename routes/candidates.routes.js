const express = require("express");
const router = express.Router();
const {
  createCandidate,
  getAvailableCandidates,
  getCandidateById,
  updateCandidate,
  deleteCandidate,
  getBureauCandidateById,
  filterCandidates,
} = require("../controllers/candidates.controller");

const { requireActiveBureau } = require("../middleware/requireActiveBureau");

/* ─────────────── PUBLIC / READ-ONLY ─────────────── */

router.get("/available", getAvailableCandidates);

router.get("/bureau-candidate/:user_id", getBureauCandidateById);

router.get("/get-candidate/:id", getCandidateById);

router.get("/filter", filterCandidates);

/* ─────────────── GATED WRITES ─────────────── */

// Create: middleware reads user_id from req.body
router.post("/register", requireActiveBureau, createCandidate);

// Update: middleware reads user_id from req.body
router.post("/update-candidate/:id", requireActiveBureau, updateCandidate);

// Delete: middleware reads user_id from req.query
router.delete("/delete-candidate/:id", requireActiveBureau, deleteCandidate);

module.exports = router;