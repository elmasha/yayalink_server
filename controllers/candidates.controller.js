const db = require("../config/db");
const redis = require("../config/redis");
const {
  candidateKey,
  candidatesAvailableKey,
  candidatesCacheKey,
} = require("../utils/cacheKeys");
const { computeBureauStatus } = require("../utils/subscription");
const { deleteKeysByPattern } = require("../utils/redisHelpers");
const { smsCandidateUploaded } = require("../utils/sms");

/* ─────────────── SUBSCRIPTION GUARD ─────────────── */

/**
 * Verifies the bureau that owns this request has an active subscription.
 * Returns:
 *   { ok: true, subscription }              → continue
 *   { ok: false, code, message, subscription } → block with 402
 */
function checkBureauSubscription(user_id) {
  return new Promise((resolve) => {
    if (!user_id) {
      return resolve({ ok: true, skipped: true });
    }

    db.query(
      `SELECT user_id, trial_ends_at, access_expires_at, subscription_status
       FROM yaya_bureaus WHERE user_id = ? LIMIT 1`,
      [user_id],
      (err, rows) => {
        if (err) {
          console.error("checkBureauSubscription DB error:", err);
          return resolve({
            ok: false,
            code: "SERVER_ERROR",
            message: "Could not verify subscription. Try again.",
          });
        }

        // user_id isn't a bureau — allow (employer, admin, etc.)
        if (!rows || rows.length === 0) {
          return resolve({ ok: true, skipped: true });
        }

        const status = computeBureauStatus(rows[0]);

        if (status.isExpired) {
          return resolve({
            ok: false,
            code: "SUBSCRIPTION_EXPIRED",
            message:
              "Your subscription has expired. Please renew to continue managing candidates.",
            subscription: {
              status: status.status,
              days_left: 0,
              expired: true,
            },
          });
        }

        return resolve({
          ok: true,
          grace: status.isGrace,
          subscription: {
            status: status.status,
            days_left: status.daysLeft,
            is_grace: status.isGrace,
            expires_at: status.expiresAt,
          },
        });
      }
    );
  });
}

/* ─────────────── UTIL ─────────────── */

function generateCandidateId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  const hex = () => Math.floor(Math.random() * 16).toString(16);
  const seg = (n) => Array.from({ length: n }, hex).join("");
  return `${seg(8)}-${seg(4)}-4${seg(3)}-${seg(4)}-${seg(12)}`;
}

/* ✅ CREATE CANDIDATE */
exports.createCandidate = async (req, res) => {
  const {
    candidate_id: incomingId,
    user_id,
    candidate_name,
    age,
    gender,
    dob,
    mobile_no,
    kin_phone_no,
    next_of_kin,
    residence,
    village,
    ward,
    county,
    bureau_name,
    bureau_no,
    experience,
    salary,
    salary_period,
    working_status,
    status,
    profile_image,
    device_token,
  } = req.body;

  // 🔒 Minimum required validation
  if (!candidate_name || !mobile_no || !gender || !county) {
    return res.status(400).json({
      message: "candidate_name, mobile_no, gender and county are required",
    });
  }

  if (!user_id) {
    return res.status(400).json({
      message: "user_id is required",
    });
  }

  // 🔒 Subscription check
  const guard = await checkBureauSubscription(user_id);

  if (!guard.ok) {
    return res.status(402).json({
      success: false,
      reason: guard.code,
      message: guard.message,
      subscription: guard.subscription,
    });
  }

  try {
    // Generate candidate_id if the client didn't send one
    const candidate_id = incomingId || generateCandidateId();

    const sql = `
      INSERT INTO yaya_candidates (
        candidate_id, user_id, candidate_name, age, gender, dob, mobile_no,
        kin_phone_no, next_of_kin, residence, village, ward, county,
        bureau_name, bureau_no, experience, salary, salary_period,
        working_status, status, profile_image, device_token
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `;

    await new Promise((resolve, reject) => {
      db.query(
        sql,
        [
          candidate_id,
          user_id,
          candidate_name,
          age || null,
          gender,
          dob || null,
          mobile_no,
          kin_phone_no || null,
          next_of_kin || null,
          residence || null,
          village || null,
          ward || null,
          county,
          bureau_name || null,
          bureau_no || null,
          experience || null,
          salary || null,
          salary_period || "Monthly",
          working_status || "available",
          status || "Available",
          profile_image || null,
          device_token || null,
        ],
        (err) => {
          if (err) return reject(err);
          resolve();
        }
      );
    });

    // 🔥 Invalidate Redis caches
    try {
      await redis.del(candidatesAvailableKey());
      await redis.del(candidatesCacheKey());
      await deleteKeysByPattern("candidates:filter:*");
    } catch (cacheErr) {
      console.warn("Redis clear error:", cacheErr.message);
    }

    // 🔔 Fire-and-forget SMS to the uploaded candidate
    // Use the bureau_name from req.body only — the `bureau` object doesn't exist here.
    smsCandidateUploaded({
      candidate_name,
      phone: mobile_no,
      bureau_name: bureau_name || "A bureau",
    }).catch((err) =>
      console.warn("Candidate upload SMS failed:", err.message)
    );

    return res.status(201).json({
      success: true,
      message: "Candidate added successfully",
      candidate_id,
      subscription: guard.subscription || null,
    });
  } catch (error) {
    console.error("❌ Create candidate error:", error);

    if (error.code === "ER_DUP_ENTRY") {
      return res.status(409).json({
        message: "Candidate ID collision — please retry",
      });
    }

    return res.status(500).json({ message: "Server error" });
  }
};

/* ✅ AVAILABLE CANDIDATES (public read) */
exports.getAvailableCandidates = async (req, res) => {
  const key = candidatesAvailableKey();

  const cached = await redis.get(key);
  if (cached) return res.json(JSON.parse(cached));

  db.query(
    `SELECT * FROM yaya_candidates WHERE status='Available'`,
    async (err, rows) => {
      if (err) return res.status(500).json({ message: "Fetch failed" });
      await redis.setEx(key, 300, JSON.stringify(rows));
      res.json(rows);
    }
  );
};

/* ✅ GET CANDIDATE BY CANDIDATE_ID (public read) */
exports.getCandidateById = async (req, res) => {
  const key = candidateKey(req.params.id);

  const cached = await redis.get(key);
  if (cached) return res.json(JSON.parse(cached));

  db.query(
    `SELECT * FROM yaya_candidates WHERE candidate_id=?`,
    [req.params.id],
    async (err, rows) => {
      if (err) return res.status(500).json({ message: "Fetch failed" });
      if (!rows.length) return res.status(404).json({ message: "Not found" });
      await redis.setEx(key, 600, JSON.stringify(rows[0]));
      res.json(rows[0]);
    }
  );
};

/* ✅ GET CANDIDATES BY BUREAU USER_ID */
exports.getBureauCandidateById = async (req, res) => {
  const key = candidateKey(req.params.user_id);

  const cached = await redis.get(key);
  if (cached) return res.json(JSON.parse(cached));

  db.query(
    `SELECT * FROM yaya_candidates WHERE user_id=?`,
    [req.params.user_id],
    async (err, rows) => {
      if (err) return res.status(500).json({ message: "Fetch failed" });
      await redis.setEx(key, 300, JSON.stringify(rows));
      res.json(rows);
    }
  );
};

/* ✅ UPDATE CANDIDATE */
exports.updateCandidate = async (req, res) => {
  const { id } = req.params;

  if (!id) {
    return res.status(400).json({
      success: false,
      message: "Candidate ID is required",
    });
  }

  const {
    candidate_name,
    gender,
    dob,
    mobile_no,
    device_token,
    profile_image,
    county,
    ward,
    village,
    next_of_kin,
    kin_phone_no,
    experience,
    user_id,
    salary,
    age,
    bureau_name,
    salary_period,
    bureau_no,
    working_status,
    status,
  } = req.body;

  if (!user_id) {
    return res.status(400).json({
      success: false,
      message: "user_id is required to authorize this update",
    });
  }

  const guard = await checkBureauSubscription(user_id);

  if (!guard.ok) {
    return res.status(402).json({
      success: false,
      reason: guard.code,
      message: guard.message,
      subscription: guard.subscription,
    });
  }

  const sql = `
    UPDATE yaya_candidates
    SET
      candidate_name = ?,
      gender = ?,
      dob = ?,
      mobile_no = ?,
      device_token = ?,
      profile_image = ?,
      county = ?,
      ward = ?,
      village = ?,
      next_of_kin = ?,
      kin_phone_no = ?,
      experience = ?,
      salary = ?,
      age = ?,
      bureau_name = ?,
      salary_period = ?,
      bureau_no = ?,
      working_status = ?,
      status = ?
    WHERE candidate_id = ?
  `;

  const values = [
    candidate_name || "",
    gender || "",
    dob || null,
    mobile_no || "",
    device_token || "",
    profile_image || "",
    county || "",
    ward || "",
    village || "",
    next_of_kin || "",
    kin_phone_no || "",
    experience || 0,
    salary || 0,
    age || 0,
    bureau_name || "",
    salary_period || "",
    bureau_no || "",
    working_status || "available",
    status || "Available",
    id,
  ];

  db.query(sql, values, async (err, result) => {
    if (err) {
      console.error("updateCandidate DB error:", err);
      return res.status(500).json({
        success: false,
        message: "Failed to update candidate",
        error: err.message,
      });
    }

    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        message: "Candidate not found. Check candidate_id.",
        candidate_id: id,
      });
    }

    try {
      await redis.del(candidateKey(id));
      await redis.del(candidatesAvailableKey());
      await deleteKeysByPattern("candidates:filter:*");
    } catch (cacheErr) {
      console.warn("Redis clear error:", cacheErr.message);
    }

    return res.status(200).json({
      success: true,
      message: "Candidate updated successfully",
      candidate_id: id,
    });
  });
};

/* ✅ DELETE CANDIDATE */
exports.deleteCandidate = async (req, res) => {
  const { id } = req.params;
  const user_id = req.query.user_id || req.body.user_id;

  if (!user_id) {
    return res.status(400).json({
      success: false,
      message: "user_id is required to authorize this delete",
    });
  }

  const guard = await checkBureauSubscription(user_id);

  if (!guard.ok) {
    return res.status(402).json({
      success: false,
      reason: guard.code,
      message: guard.message,
      subscription: guard.subscription,
    });
  }

  db.query(
    `DELETE FROM yaya_candidates WHERE candidate_id=?`,
    [id],
    async (err, result) => {
      if (err) return res.status(500).json({ message: "Delete failed" });
      if (result.affectedRows === 0)
        return res.status(404).json({ message: "Candidate not found" });

      try {
        await redis.del(candidateKey(id));
        await redis.del(candidatesAvailableKey());
        await deleteKeysByPattern("candidates:filter:*");
      } catch (cacheErr) {
        console.warn("Redis clear error:", cacheErr.message);
      }

      res.json({ success: true, message: "Candidate deleted successfully" });
    }
  );
};

/**
 * Employer candidate filtering
 */
exports.filterCandidates = async (req, res) => {
  try {
    const {
      gender,
      county,
      ward,
      bureau_name,
      working_status,
      min_salary,
      max_salary,
      min_age,
      max_age,
      min_experience,
      max_experience,
    } = req.query;

    const cacheKey = `candidates:filter:${JSON.stringify(req.query)}`;

    const cached = await redis.get(cacheKey);
    if (cached) {
      return res.json(JSON.parse(cached));
    }

    let sql = `
      SELECT *,
        TIMESTAMPDIFF(YEAR, dob, CURDATE()) AS age
      FROM yaya_candidates
      WHERE status = 'Available'
    `;

    const params = [];

    if (gender) {
      sql += " AND gender = ?";
      params.push(gender);
    }

    if (county) {
      sql += " AND LOWER(TRIM(county)) = LOWER(TRIM(?))";
      params.push(county);
    }

    if (ward) {
      sql += " AND ward = ?";
      params.push(ward);
    }

    if (bureau_name) {
      sql += " AND bureau_name = ?";
      params.push(bureau_name);
    }

    if (working_status) {
      sql += " AND working_status = ?";
      params.push(working_status);
    }

    if (min_salary) {
      sql += " AND CAST(salary AS UNSIGNED) >= ?";
      params.push(Number(min_salary));
    }

    if (max_salary) {
      sql += " AND CAST(salary AS UNSIGNED) <= ?";
      params.push(Number(max_salary));
    }

    if (min_age) {
      sql += " AND TIMESTAMPDIFF(YEAR, dob, CURDATE()) >= ?";
      params.push(Number(min_age));
    }

    if (max_age) {
      sql += " AND TIMESTAMPDIFF(YEAR, dob, CURDATE()) <= ?";
      params.push(Number(max_age));
    }

    if (min_experience) {
      sql += " AND CAST(experience AS UNSIGNED) >= ?";
      params.push(Number(min_experience));
    }

    if (max_experience) {
      sql += " AND CAST(experience AS UNSIGNED) <= ?";
      params.push(Number(max_experience));
    }

    sql += " ORDER BY created_at DESC";

    db.query(sql, params, async (err, rows) => {
      if (err) {
        console.error("DB error:", err);
        return res.status(500).json({ message: "DB error" });
      }

      await redis.setEx(cacheKey, 300, JSON.stringify(rows));
      res.json(rows);
    });
  } catch (error) {
    console.error("❌ Filter candidates error:", error);
    res.status(500).json({ message: "Server error" });
  }
};