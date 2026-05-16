const express = require("express");
const router = express.Router();

const admin = require("../controllers/admin.controller");

/* DASHBOARD */
router.get("/dashboard", admin.getDashboardSummary);

/* USERS */
router.get("/employers", admin.getAllEmployers);
router.get("/bureaus", admin.getAllBureaus);
router.get("/candidates", admin.getAllCandidates);

/* PAYMENTS */
router.get("/payments", admin.getAllPayments);

/* DELETE */
router.delete("/candidate/:id", admin.deleteCandidate);
router.delete("/employer/:uid", admin.deleteEmployer);
router.delete("/bureau/:uid", admin.deleteBureau);

/* SEARCH */
router.get("/search/candidates", admin.searchCandidates);

module.exports = router;