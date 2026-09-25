const router = require("express").Router();
const admin = require("../controllers/admin.controller");
// const { requireAdmin } = require("../middleware/requireAdmin");

// /* ─── Auth ─── */
// router.use(requireAdmin);

/* ─── Dashboard ─── */
router.get("/dashboard/summary", admin.getDashboardSummary);
router.get("/dashboard/revenue-chart", admin.getRevenueChart);
router.get("/dashboard/signups-chart", admin.getSignupsChart);
router.get("/dashboard/top-counties", admin.getTopCounties);

/* ─── Employers ─── */
router.get("/employers", admin.getAllEmployers);
router.get("/employers/:uid", admin.getEmployerDetail);
router.put("/employers/:uid", admin.updateEmployer);
router.post("/employers/:uid/suspend", admin.suspendEmployer);
router.delete("/employers/:uid", admin.deleteEmployer);

/* ─── Bureaus ─── */
router.get("/bureaus", admin.getAllBureaus);
router.get("/bureaus/:uid", admin.getBureauDetail);
router.put("/bureaus/:uid", admin.updateBureau);
router.post("/bureaus/:uid/suspend", admin.suspendBureau);
router.delete("/bureaus/:uid", admin.deleteBureau);

/* ─── Candidates ─── */
router.post("/candidates", admin.createCandidate);
router.get("/candidates", admin.getAllCandidates);
router.get("/candidates/search", admin.searchCandidates);
router.get("/candidates/:id", admin.getCandidateDetail);
router.put("/candidates/:id", admin.updateCandidate);
router.delete("/candidates/:id", admin.deleteCandidate);

/* ─── Payments ─── */
router.get("/payments", admin.getAllPayments);

/* ─── Notifications ─── */
router.post("/notify/user", admin.notifyUser);
router.post("/notify/broadcast", admin.broadcast);


/* Settings */
router.get("/settings", admin.getSettings);
router.put("/settings", admin.updateSettings);


router.get("/analytics/advanced-stats", admin.getAdvancedStats);
router.get("/analytics/revenue-by-type", admin.getRevenueByType);
router.get("/analytics/revenue-by-plan", admin.getRevenueByPlan);
router.get("/analytics/top-bureaus", admin.getTopBureaus);
router.get("/analytics/revenue-by-dow", admin.getRevenueByDayOfWeek);

/* SMS Balance */
router.get("/sms/balance", admin.getSmsBalance);

module.exports = router;