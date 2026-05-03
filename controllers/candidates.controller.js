const db = require("../config/db");
const redis = require("../config/redis");
const {
  candidateKey,
  candidatesAvailableKey,
  candidatesCacheKey,
  filterCacheKey,
} = require("../utils/cacheKeys");



/* ✅ CREATE CANDIDATE */
exports.createCandidate = async (req, res) => {
  const {
    candidate_id,
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

  try {
    const sql = `
      INSERT INTO yaya_candidates (
        candidate_id,
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
        device_token
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `;

    await new Promise((resolve, reject) => {
      db.query(
        sql,
        [
          candidate_id,
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
          working_status || "available",
          status || "Available",
          profile_image,
          device_token,
        ],
        (err) => {
          if (err) return reject(err);
          resolve();
        }
      );
    });

    // 🔥 Invalidate Redis caches
   // await redis.del(candidatesCacheKey);
  
    return res.status(201).json({
      message: "Candidate added successfully",
    });
  } catch (error) {
    console.error("❌ Create candidate error:", error);
    return res.status(500).json({ message: "Server error" });
  }
};




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

exports.getCandidateById = async (req, res) => {
  const key = candidateKey(req.params.id);

  const cached = await redis.get(key);
  if (cached) return res.json(JSON.parse(cached));

  db.query(
    `SELECT * FROM yaya_candidates WHERE candidate_id=?`,
    [req.params.id],
    async (err, rows) => {
      if (err) return res.status(500).json({ message: "Fetch failed" });
      await redis.setEx(key, 600, JSON.stringify(rows[0]));
      res.json(rows[0]);
    }
  );
};


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
      res.json(rows[0]);
    }
  );
};

exports.updateCandidate = async (req, res) => {
  db.query(
    `UPDATE yaya_candidates SET ? WHERE candidate_id=?`,
    [req.body, req.params.id],
    async (err) => {
      if (err) return res.status(500).json({ message: "Update failed" });

      await redis.del(candidateKey(req.params.id));
      await redis.del(candidatesAvailableKey());
      res.json({ message: "Candidate updated" });
    }
  );
};

/* ✅ Delete Candidate (FIX) */
exports.deleteCandidate = async (req, res) => {
  db.query(
    `DELETE FROM yaya_candidates WHERE candidate_id=?`,
    [req.params.id],
    async (err, result) => {
      if (err) return res.status(500).json({ message: "Delete failed" });
      if (result.affectedRows === 0)
        return res.status(404).json({ message: "Candidate not found" });

      await redis.del(candidateKey(req.params.id));
      await redis.del(candidatesAvailableKey());
      res.json({ message: "Candidate deleted successfully" });
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
      max_experience
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
      sql += " AND county = ?";
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
      sql += " AND salary >= ?";
      params.push(min_salary);
    }

    if (max_salary) {
      sql += " AND salary <= ?";
      params.push(max_salary);
    }

    if (min_age) {
      sql += " AND TIMESTAMPDIFF(YEAR, dob, CURDATE()) >= ?";
      params.push(min_age);
    }

    if (max_age) {
      sql += " AND TIMESTAMPDIFF(YEAR, dob, CURDATE()) <= ?";
      params.push(max_age);
    }

    /* ✅ EXPERIENCE FILTER (NUMERIC) */
    if (min_experience) {
      sql += " AND experience >= ?";
      params.push(min_experience);
    }

    if (max_experience) {
      sql += " AND experience <= ?";
      params.push(max_experience);
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



