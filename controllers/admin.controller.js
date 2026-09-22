const db = require("../config/db");
const redis = require("../config/redis");
const {
  parseListQuery,
  buildFilterClauses,
  query,
} = require("../utils/adminHelpers");
const { sendNotification } = require("../utils/notify");
const { computeBureauStatus } = require("../utils/subscription");

/* ─────────────────────────────────────────────
   CACHE HELPERS
   ───────────────────────────────────────────── */
const CACHE = {
  summary: "admin:dashboard:summary",
  revenue: "admin:dashboard:revenue",
  signups: "admin:dashboard:signups",
};

async function clearAdminCaches() {
  try {
    await redis.del(CACHE.summary);
    await redis.del(CACHE.revenue);
    await redis.del(CACHE.signups);
  } catch (err) {
    console.warn("clearAdminCaches failed:", err.message);
  }
}

/* =========================================================
   DASHBOARD
   ========================================================= */

/* ✅ SUMMARY */
exports.getDashboardSummary = async (req, res) => {
  try {
    const cached = await redis.get(CACHE.summary);
    if (cached) return res.status(200).json(JSON.parse(cached));

    const [
      total_candidates,
      available_candidates,
      selected_candidates,
      total_employers,
      total_bureaus,
      total_revenue,
      monthly_revenue,
      suspended_employers,
      suspended_bureaus,
      active_bureaus,
    ] = await Promise.all([
      query(`SELECT COUNT(*) AS c FROM yaya_candidates`).then(
        (r) => r[0].c || 0
      ),
      query(
        `SELECT COUNT(*) AS c FROM yaya_candidates WHERE status='Available'`
      ).then((r) => r[0].c || 0),
      query(
        `SELECT COUNT(*) AS c FROM yaya_candidates WHERE status='Unavailable'`
      ).then((r) => r[0].c || 0),
      query(`SELECT COUNT(*) AS c FROM yaya_employers`).then(
        (r) => r[0].c || 0
      ),
      query(`SELECT COUNT(*) AS c FROM yaya_bureaus`).then(
        (r) => r[0].c || 0
      ),
      query(
        `SELECT IFNULL(SUM(amount),0) AS s FROM yaya_payments`
      ).then((r) => r[0].s || 0),
      query(
        `SELECT IFNULL(SUM(amount),0) AS s FROM yaya_payments
         WHERE MONTH(created_at)=MONTH(NOW())
           AND YEAR(created_at)=YEAR(NOW())`
      ).then((r) => r[0].s || 0),
      query(
        `SELECT COUNT(*) AS c FROM yaya_employers WHERE is_suspended=1`
      ).then((r) => r[0].c || 0),
      query(
        `SELECT COUNT(*) AS c FROM yaya_bureaus WHERE is_suspended=1`
      ).then((r) => r[0].c || 0),
      query(
        `SELECT COUNT(*) AS c FROM yaya_bureaus WHERE user_state='ACTIVE'`
      ).then((r) => r[0].c || 0),
    ]);

    const response = {
      success: true,
      total_candidates,
      available_candidates,
      selected_candidates,
      total_employers,
      total_bureaus,
      total_revenue,
      monthly_revenue,
      suspended_employers,
      suspended_bureaus,
      active_bureaus,
    };

    await redis.setEx(CACHE.summary, 300, JSON.stringify(response));
    return res.status(200).json(response);
  } catch (error) {
    console.error("Dashboard summary error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

/* ✅ REVENUE CHART (last 30 days) */
exports.getRevenueChart = async (req, res) => {
  try {
    const cached = await redis.get(CACHE.revenue);
    if (cached) return res.status(200).json(JSON.parse(cached));

    const rows = await query(
      `SELECT DATE(created_at) AS day,
              IFNULL(SUM(amount),0) AS total,
              COUNT(*) AS count
       FROM yaya_payments
       WHERE created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
       GROUP BY DATE(created_at)
       ORDER BY day ASC`
    );

    // Fill missing days with zeros so the chart isn't gappy
    const map = new Map(rows.map((r) => [toDateKey(r.day), r]));
    const series = [];

    for (let i = 29; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = toDateKey(d);
      const hit = map.get(key);
      series.push({
        day: key,
        total: hit ? Number(hit.total) : 0,
        count: hit ? Number(hit.count) : 0,
      });
    }

    const response = { success: true, series };
    await redis.setEx(CACHE.revenue, 300, JSON.stringify(response));
    return res.json(response);
  } catch (error) {
    console.error("Revenue chart error:", error);
    return res.status(500).json({ success: false, series: [] });
  }
};

/* ✅ SIGNUPS CHART (last 30 days) */
exports.getSignupsChart = async (req, res) => {
  try {
    const cached = await redis.get(CACHE.signups);
    if (cached) return res.status(200).json(JSON.parse(cached));

    const employerRows = await query(
      `SELECT DATE(created_at) AS day, COUNT(*) AS c
       FROM yaya_employers
       WHERE created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
       GROUP BY DATE(created_at)`
    );

    const bureauRows = await query(
      `SELECT DATE(created_at) AS day, COUNT(*) AS c
       FROM yaya_bureaus
       WHERE created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
       GROUP BY DATE(created_at)`
    );

    const empMap = new Map(employerRows.map((r) => [toDateKey(r.day), r.c]));
    const burMap = new Map(bureauRows.map((r) => [toDateKey(r.day), r.c]));

    const series = [];
    for (let i = 29; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = toDateKey(d);
      series.push({
        day: key,
        employers: Number(empMap.get(key) || 0),
        bureaus: Number(burMap.get(key) || 0),
      });
    }

    const response = { success: true, series };
    await redis.setEx(CACHE.signups, 300, JSON.stringify(response));
    return res.json(response);
  } catch (error) {
    console.error("Signups chart error:", error);
    return res.status(500).json({ success: false, series: [] });
  }
};

/* ✅ TOP COUNTIES (by candidate count) */
exports.getTopCounties = async (req, res) => {
  try {
    const rows = await query(
      `SELECT TRIM(county) AS county, COUNT(*) AS total
       FROM yaya_candidates
       WHERE county IS NOT NULL AND TRIM(county) <> ''
       GROUP BY TRIM(county)
       ORDER BY total DESC
       LIMIT 10`
    );

    return res.json({ success: true, counties: rows });
  } catch (error) {
    console.error("Top counties error:", error);
    return res.status(500).json({ success: false, counties: [] });
  }
};

/* =========================================================
   EMPLOYERS
   ========================================================= */

/* ✅ LIST EMPLOYERS */
exports.getAllEmployers = async (req, res) => {
  try {
    const { page, limit, offset, sort, order, search } = parseListQuery(req, {
      allowedSort: ["created_at", "name", "id", "access_expires_at"],
      defaultSort: "created_at",
    });

    const allowedFilters = [
      "county",
      "city",
      "is_suspended",
    ];

    const { clauses, params } = buildFilterClauses(
      {
        county: req.query.county,
        city: req.query.city,
        is_suspended: req.query.is_suspended,
      },
      allowedFilters
    );

    // Search applies across name / email / phone
    if (search) {
      clauses.push("(name LIKE ? OR email LIKE ? OR phone_no LIKE ?)");
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";

    const totalRows = await query(
      `SELECT COUNT(*) AS total FROM yaya_employers ${where}`,
      params
    );
    const total = totalRows[0].total || 0;

    const rows = await query(
      `SELECT * FROM yaya_employers
       ${where}
       ORDER BY ${sort} ${order}
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    return res.json({
      success: true,
      data: rows,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error("getAllEmployers error:", error);
    return res.status(500).json({
      success: false,
      data: [],
      message: "Server error",
    });
  }
};

/* ✅ EMPLOYER DETAIL */
exports.getEmployerDetail = async (req, res) => {
  const { uid } = req.params;

  try {
    const [employerRows, paymentsRows, selectedRows] = await Promise.all([
      query(`SELECT * FROM yaya_employers WHERE uid = ? LIMIT 1`, [uid]),
      query(
        `SELECT * FROM yaya_payments
         WHERE uid = ? AND user_type = 'EMPLOYER'
         ORDER BY created_at DESC
         LIMIT 50`,
        [uid]
      ),
      query(
        `SELECT candidate_id, candidate_name, county, status, date_selected
         FROM yaya_candidates
         WHERE employer_uid = ?
         ORDER BY date_selected DESC`,
        [uid]
      ),
    ]);

    if (!employerRows.length) {
      return res.status(404).json({
        success: false,
        message: "Employer not found",
      });
    }

    return res.json({
      success: true,
      employer: employerRows[0],
      payments: paymentsRows,
      selected_candidates: selectedRows,
    });
  } catch (error) {
    console.error("getEmployerDetail error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

/* ✅ UPDATE EMPLOYER */
exports.updateEmployer = async (req, res) => {
  const { uid } = req.params;

  const allowedFields = [
    "name",
    "email",
    "phone_no",
    "city",
    "street_name",
    "county",
    "user_image",
    "access_expires_at",
    "mpesa_receipt",
    "payment_date",
  ];

  const updates = {};
  for (const key of allowedFields) {
    if (req.body[key] !== undefined) updates[key] = req.body[key];
  }

  if (Object.keys(updates).length === 0) {
    return res.status(400).json({
      success: false,
      message: "No valid fields to update",
    });
  }

  try {
    const setClauses = Object.keys(updates).map((k) => `${k} = ?`).join(", ");
    const values = [...Object.values(updates), uid];

    const result = await query(
      `UPDATE yaya_employers SET ${setClauses} WHERE uid = ?`,
      values
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        message: "Employer not found",
      });
    }

    await redis.del(`employer:${uid}`);
    await redis.del(`employer:access:${uid}`);
    await redis.del(`employer:payment:${uid}`);
    await clearAdminCaches();

    return res.json({ success: true, message: "Employer updated" });
  } catch (error) {
    console.error("updateEmployer error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

/* ✅ SUSPEND / UNSUSPEND EMPLOYER */
exports.suspendEmployer = async (req, res) => {
  const { uid } = req.params;
  const { suspended, reason } = req.body;

  const flag = suspended ? 1 : 0;
  const reasonText = reason || null;

  try {
    const result = await query(
      `UPDATE yaya_employers
       SET is_suspended = ?, suspended_reason = ?
       WHERE uid = ?`,
      [flag, reasonText, uid]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        message: "Employer not found",
      });
    }

    // If suspended, drop access caches so next check sees the new state
    try {
      await redis.del(`employer:access:${uid}`);
      await redis.del(`employer:payment:${uid}`);
      await redis.del(`employer:${uid}`);
    } catch (_) {}

    await clearAdminCaches();

    return res.json({
      success: true,
      message: flag ? "Employer suspended" : "Employer reinstated",
    });
  } catch (error) {
    console.error("suspendEmployer error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

/* ✅ DELETE EMPLOYER */
exports.deleteEmployer = async (req, res) => {
  const { uid } = req.params;

  try {
    const result = await query(
      `DELETE FROM yaya_employers WHERE uid = ?`,
      [uid]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        message: "Employer not found",
      });
    }

    try {
      await redis.del(`employer:${uid}`);
      await redis.del(`employer:access:${uid}`);
      await redis.del(`employer:payment:${uid}`);
    } catch (_) {}

    await clearAdminCaches();

    return res.json({
      success: true,
      message: "Employer deleted successfully",
    });
  } catch (error) {
    console.error("deleteEmployer error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

/* =========================================================
   BUREAUS
   ========================================================= */

/* ✅ LIST BUREAUS */
exports.getAllBureaus = async (req, res) => {
  try {
    const { page, limit, offset, sort, order, search } = parseListQuery(req, {
      allowedSort: ["created_at", "bureau_name", "id", "trial_ends_at"],
      defaultSort: "created_at",
    });

    const allowedFilters = [
      "county",
      "city",
      "is_suspended",
      "user_state",
      "subscription_status",
    ];

    const { clauses, params } = buildFilterClauses(
      {
        county: req.query.county,
        city: req.query.city,
        is_suspended: req.query.is_suspended,
        user_state: req.query.user_state,
        subscription_status: req.query.subscription_status,
      },
      allowedFilters
    );

    if (search) {
      clauses.push(
        "(bureau_name LIKE ? OR name LIKE ? OR email LIKE ? OR phone_no LIKE ?)"
      );
      params.push(
        `%${search}%`,
        `%${search}%`,
        `%${search}%`,
        `%${search}%`
      );
    }

    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";

    const totalRows = await query(
      `SELECT COUNT(*) AS total FROM yaya_bureaus ${where}`,
      params
    );
    const total = totalRows[0].total || 0;

    const rows = await query(
      `SELECT * FROM yaya_bureaus
       ${where}
       ORDER BY ${sort} ${order}
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    // Augment each row with computed subscription status
    const data = rows.map((b) => ({
      ...b,
      subscription: computeBureauStatus(b),
    }));

    return res.json({
      success: true,
      data,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error("getAllBureaus error:", error);
    return res.status(500).json({
      success: false,
      data: [],
      message: "Server error",
    });
  }
};

/* ✅ BUREAU DETAIL */
exports.getBureauDetail = async (req, res) => {
  const { uid } = req.params;

  try {
    const [bureauRows, paymentsRows, candidatesRows] = await Promise.all([
      query(`SELECT * FROM yaya_bureaus WHERE user_id = ? LIMIT 1`, [uid]),
      query(
        `SELECT * FROM yaya_payments
         WHERE uid = ? AND user_type = 'BUREAU'
         ORDER BY created_at DESC
         LIMIT 50`,
        [uid]
      ),
      query(
        `SELECT candidate_id, candidate_name, county, status, working_status, created_at
         FROM yaya_candidates
         WHERE user_id = ?
         ORDER BY created_at DESC`,
        [uid]
      ),
    ]);

    if (!bureauRows.length) {
      return res.status(404).json({
        success: false,
        message: "Bureau not found",
      });
    }

    const bureau = bureauRows[0];
    return res.json({
      success: true,
      bureau,
      subscription: computeBureauStatus(bureau),
      payments: paymentsRows,
      candidates: candidatesRows,
    });
  } catch (error) {
    console.error("getBureauDetail error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

/* ✅ UPDATE BUREAU */
exports.updateBureau = async (req, res) => {
  const { uid } = req.params;

  const allowedFields = [
    "bureau_name",
    "name",
    "email",
    "phone_no",
    "id_no",
    "box_no",
    "building",
    "street_name",
    "city",
    "county",
    "postal_code",
    "bureau_image",
    "user_state",
    "trial_ends_at",
    "access_expires_at",
    "subscription_status",
  ];

  const updates = {};
  for (const key of allowedFields) {
    if (req.body[key] !== undefined) updates[key] = req.body[key];
  }

  if (Object.keys(updates).length === 0) {
    return res.status(400).json({
      success: false,
      message: "No valid fields to update",
    });
  }

  try {
    const setClauses = Object.keys(updates).map((k) => `${k} = ?`).join(", ");
    const values = [...Object.values(updates), uid];

    const result = await query(
      `UPDATE yaya_bureaus SET ${setClauses} WHERE user_id = ?`,
      values
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        message: "Bureau not found",
      });
    }

    await redis.del(`bureau:${uid}`);
    await redis.del(`bureau:${uid}:payment_status`);
    await clearAdminCaches();

    return res.json({ success: true, message: "Bureau updated" });
  } catch (error) {
    console.error("updateBureau error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

/* ✅ SUSPEND / UNSUSPEND BUREAU */
exports.suspendBureau = async (req, res) => {
  const { uid } = req.params;
  const { suspended, reason } = req.body;

  const flag = suspended ? 1 : 0;
  const reasonText = reason || null;

  try {
    const result = await query(
      `UPDATE yaya_bureaus
       SET is_suspended = ?, suspended_reason = ?
       WHERE user_id = ?`,
      [flag, reasonText, uid]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        message: "Bureau not found",
      });
    }

    try {
      await redis.del(`bureau:${uid}`);
      await redis.del(`bureau:${uid}:payment_status`);
    } catch (_) {}

    await clearAdminCaches();

    return res.json({
      success: true,
      message: flag ? "Bureau suspended" : "Bureau reinstated",
    });
  } catch (error) {
    console.error("suspendBureau error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

/* ✅ DELETE BUREAU */
exports.deleteBureau = async (req, res) => {
  const { uid } = req.params;

  try {
    const result = await query(
      `DELETE FROM yaya_bureaus WHERE user_id = ?`,
      [uid]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        message: "Bureau not found",
      });
    }

    try {
      await redis.del(`bureau:${uid}`);
      await redis.del(`bureau:${uid}:payment_status`);
    } catch (_) {}

    await clearAdminCaches();

    return res.json({
      success: true,
      message: "Bureau deleted successfully",
    });
  } catch (error) {
    console.error("deleteBureau error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

/* =========================================================
   CANDIDATES
   ========================================================= */

/* ✅ LIST CANDIDATES */
exports.getAllCandidates = async (req, res) => {
  try {
    const { page, limit, offset, sort, order, search } = parseListQuery(req, {
      allowedSort: ["created_at", "candidate_name", "age", "id"],
      defaultSort: "created_at",
    });

    const allowedFilters = [
      "county",
      "gender",
      "status",
      "working_status",
      "bureau_name",
    ];

    const { clauses, params } = buildFilterClauses(
      {
        county: req.query.county,
        gender: req.query.gender,
        status: req.query.status,
        working_status: req.query.working_status,
        bureau_name: req.query.bureau_name,
      },
      allowedFilters
    );

    if (search) {
      clauses.push(
        "(candidate_name LIKE ? OR mobile_no LIKE ? OR county LIKE ?)"
      );
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";

    const totalRows = await query(
      `SELECT COUNT(*) AS total FROM yaya_candidates ${where}`,
      params
    );
    const total = totalRows[0].total || 0;

    const rows = await query(
      `SELECT * FROM yaya_candidates
       ${where}
       ORDER BY ${sort} ${order}
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    return res.json({
      success: true,
      data: rows,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error("getAllCandidates error:", error);
    return res.status(500).json({
      success: false,
      data: [],
      message: "Server error",
    });
  }
};

/* ✅ CANDIDATE DETAIL */
exports.getCandidateDetail = async (req, res) => {
  const { id } = req.params;

  try {
    const rows = await query(
      `SELECT * FROM yaya_candidates WHERE candidate_id = ? LIMIT 1`,
      [id]
    );

    if (!rows.length) {
      return res.status(404).json({
        success: false,
        message: "Candidate not found",
      });
    }

    return res.json({ success: true, candidate: rows[0] });
  } catch (error) {
    console.error("getCandidateDetail error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

/* ✅ UPDATE CANDIDATE (admin) */
exports.updateCandidate = async (req, res) => {
  const { id } = req.params;

  const allowedFields = [
    "candidate_name",
    "gender",
    "dob",
    "mobile_no",
    "kin_phone_no",
    "next_of_kin",
    "residence",
    "village",
    "ward",
    "county",
    "bureau_name",
    "bureau_no",
    "experience",
    "salary",
    "salary_period",
    "working_status",
    "status",
  ];

  const updates = {};
  for (const key of allowedFields) {
    if (req.body[key] !== undefined) updates[key] = req.body[key];
  }

  if (Object.keys(updates).length === 0) {
    return res.status(400).json({
      success: false,
      message: "No valid fields to update",
    });
  }

  try {
    const setClauses = Object.keys(updates).map((k) => `${k} = ?`).join(", ");
    const values = [...Object.values(updates), id];

    const result = await query(
      `UPDATE yaya_candidates SET ${setClauses} WHERE candidate_id = ?`,
      values
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        message: "Candidate not found",
      });
    }

    await redis.del(`candidate:${id}`);
    await redis.del("candidates:available");
    await clearAdminCaches();

    return res.json({ success: true, message: "Candidate updated" });
  } catch (error) {
    console.error("updateCandidate (admin) error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

/* ✅ DELETE CANDIDATE */
exports.deleteCandidate = async (req, res) => {
  const { id } = req.params;

  try {
    const result = await query(
      `DELETE FROM yaya_candidates WHERE candidate_id = ?`,
      [id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        message: "Candidate not found",
      });
    }

    await redis.del(`candidate:${id}`);
    await redis.del("candidates:available");
    await clearAdminCaches();

    return res.json({
      success: true,
      message: "Candidate deleted successfully",
    });
  } catch (error) {
    console.error("deleteCandidate (admin) error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

/* =========================================================
   PAYMENTS
   ========================================================= */

/* ✅ LIST PAYMENTS */
exports.getAllPayments = async (req, res) => {
  try {
    const { page, limit, offset, sort, order, search } = parseListQuery(req, {
      allowedSort: ["created_at", "amount", "id", "payment_date"],
      defaultSort: "created_at",
    });

    const allowedFilters = ["user_type", "uid"];

    const { clauses, params } = buildFilterClauses(
      {
        user_type: req.query.user_type,
        uid: req.query.uid,
      },
      allowedFilters
    );

    // Date range
    if (req.query.from) {
      clauses.push("created_at >= ?");
      params.push(req.query.from);
    }
    if (req.query.to) {
      clauses.push("created_at <= ?");
      params.push(req.query.to);
    }

    if (search) {
      clauses.push("(mpesa_receipt LIKE ? OR uid LIKE ?)");
      params.push(`%${search}%`, `%${search}%`);
    }

    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";

    const totalRows = await query(
      `SELECT COUNT(*) AS total FROM yaya_payments ${where}`,
      params
    );
    const total = totalRows[0].total || 0;

    const rows = await query(
      `SELECT * FROM yaya_payments
       ${where}
       ORDER BY ${sort} ${order}
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    const sumRows = await query(
      `SELECT IFNULL(SUM(amount),0) AS total_amount
       FROM yaya_payments ${where}`,
      params
    );

    return res.json({
      success: true,
      data: rows,
      total_amount: Number(sumRows[0].total_amount || 0),
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error("getAllPayments error:", error);
    return res.status(500).json({
      success: false,
      data: [],
      message: "Server error",
    });
  }
};

/* =========================================================
   SEARCH (kept for backwards compat)
   ========================================================= */
exports.searchCandidates = async (req, res) => {
  const { keyword } = req.query;

  if (!keyword) {
    return res.json({ success: true, data: [] });
  }

  try {
    const rows = await query(
      `SELECT * FROM yaya_candidates
       WHERE candidate_name LIKE ?
          OR county LIKE ?
          OR mobile_no LIKE ?
       ORDER BY created_at DESC
       LIMIT 50`,
      [`%${keyword}%`, `%${keyword}%`, `%${keyword}%`]
    );

    return res.json({ success: true, data: rows });
  } catch (error) {
    console.error("searchCandidates error:", error);
    return res.status(500).json({ success: false, data: [] });
  }
};

/* =========================================================
   NOTIFICATIONS
   ========================================================= */

/* ✅ SEND TO A SINGLE USER */
exports.notifyUser = async (req, res) => {
  const { user_uid, user_type, title, message, type } = req.body;

  if (!user_uid || !title || !message) {
    return res.status(400).json({
      success: false,
      message: "user_uid, title, and message are required",
    });
  }

  try {
    await sendNotification({
      user_uid,
      user_type: user_type || "EMPLOYER",
      title,
      message,
      type: type || "SYSTEM",
    });

    return res.json({ success: true, message: "Notification sent" });
  } catch (error) {
    console.error("notifyUser error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

/* ✅ BROADCAST */
exports.broadcast = async (req, res) => {
  const { audience, title, message, type } = req.body;

  if (!audience || !title || !message) {
    return res.status(400).json({
      success: false,
      message: "audience, title, and message are required",
    });
  }

  let table;
  let uidColumn;
  let userType;

  if (audience === "employers") {
    table = "yaya_employers";
    uidColumn = "uid";
    userType = "EMPLOYER";
  } else if (audience === "bureaus") {
    table = "yaya_bureaus";
    uidColumn = "user_id";
    userType = "BUREAU";
  } else {
    return res.status(400).json({
      success: false,
      message: "audience must be 'employers' or 'bureaus'",
    });
  }

  try {
    const rows = await query(`SELECT ${uidColumn} AS uid FROM ${table}`);

    let sent = 0;
    for (const row of rows) {
      try {
        await sendNotification({
          user_uid: row.uid,
          user_type: userType,
          title,
          message,
          type: type || "SYSTEM",
        });
        sent++;
      } catch (err) {
        console.warn(`Broadcast failed for ${row.uid}:`, err.message);
      }
    }

    return res.json({
      success: true,
      message: `Sent to ${sent}/${rows.length} ${audience}`,
      sent,
      total: rows.length,
    });
  } catch (error) {
    console.error("broadcast error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

/* =========================================================
   UTILS
   ========================================================= */

function toDateKey(d) {
  if (typeof d === "string") return d.slice(0, 10);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}