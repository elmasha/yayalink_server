const db = require("../config/db");
const redis = require("../config/redis");

/* =========================================================
   ADMIN DASHBOARD CONTROLLER
   ========================================================= */

/* ✅ DASHBOARD SUMMARY */
exports.getDashboardSummary = async (req, res) => {
  try {
    const cacheKey = "admin:dashboard:summary";

    /* 🔹 Check Redis Cache */
    const cached = await redis.get(cacheKey);
    if (cached) {
      return res.status(200).json(JSON.parse(cached));
    }

    /* 🔹 TOTAL CANDIDATES */
    const candidatesPromise = new Promise((resolve, reject) => {
      db.query(
        `SELECT COUNT(*) AS total_candidates FROM yaya_candidates`,
        (err, rows) => {
          if (err) return reject(err);
          resolve(rows[0].total_candidates || 0);
        }
      );
    });

    /* 🔹 AVAILABLE CANDIDATES */
    const availablePromise = new Promise((resolve, reject) => {
      db.query(
        `SELECT COUNT(*) AS available_candidates
         FROM yaya_candidates
         WHERE status='Available'`,
        (err, rows) => {
          if (err) return reject(err);
          resolve(rows[0].available_candidates || 0);
        }
      );
    });

    /* 🔹 SELECTED CANDIDATES */
    const selectedPromise = new Promise((resolve, reject) => {
      db.query(
        `SELECT COUNT(*) AS selected_candidates
         FROM yaya_candidates
         WHERE status='Selected'`,
        (err, rows) => {
          if (err) return reject(err);
          resolve(rows[0].selected_candidates || 0);
        }
      );
    });

    /* 🔹 TOTAL EMPLOYERS */
    const employersPromise = new Promise((resolve, reject) => {
      db.query(
        `SELECT COUNT(*) AS total_employers FROM yaya_employers`,
        (err, rows) => {
          if (err) return reject(err);
          resolve(rows[0].total_employers || 0);
        }
      );
    });

    /* 🔹 TOTAL BUREAUS */
    const bureausPromise = new Promise((resolve, reject) => {
      db.query(
        `SELECT COUNT(*) AS total_bureaus FROM yaya_bureaus`,
        (err, rows) => {
          if (err) return reject(err);
          resolve(rows[0].total_bureaus || 0);
        }
      );
    });

    /* 🔹 TOTAL REVENUE */
    const revenuePromise = new Promise((resolve, reject) => {
      db.query(
        `
        SELECT 
          IFNULL(SUM(amount),0) AS total_revenue
        FROM yaya_payments
        `,
        (err, rows) => {
          if (err) return reject(err);
          resolve(rows[0].total_revenue || 0);
        }
      );
    });

    /* 🔹 MONTHLY REVENUE */
    const monthlyRevenuePromise = new Promise((resolve, reject) => {
      db.query(
        `
        SELECT 
          IFNULL(SUM(amount),0) AS monthly_revenue
        FROM yaya_payments
        WHERE MONTH(created_at)=MONTH(NOW())
        AND YEAR(created_at)=YEAR(NOW())
        `,
        (err, rows) => {
          if (err) return reject(err);
          resolve(rows[0].monthly_revenue || 0);
        }
      );
    });

    /* 🔹 EXECUTE */
    const [
      total_candidates,
      available_candidates,
      selected_candidates,
      total_employers,
      total_bureaus,
      total_revenue,
      monthly_revenue,
    ] = await Promise.all([
      candidatesPromise,
      availablePromise,
      selectedPromise,
      employersPromise,
      bureausPromise,
      revenuePromise,
      monthlyRevenuePromise,
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
    };

    /* 🔹 Cache 5 mins */
    await redis.setEx(cacheKey, 300, JSON.stringify(response));

    return res.status(200).json(response);

  } catch (error) {
    console.error("Dashboard summary error:", error);

    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};

/* =========================================================
   USERS
   ========================================================= */

/* ✅ GET ALL EMPLOYERS */
exports.getAllEmployers = async (req, res) => {
  try {
    db.query(
      `
      SELECT *
      FROM yaya_employers
      ORDER BY id DESC
      `,
      (err, rows) => {
        if (err) {
          console.error(err);
          return res.status(500).json([]);
        }

        res.json(rows);
      }
    );
  } catch (error) {
    console.error(error);
    res.status(500).json([]);
  }
};

/* ✅ GET ALL BUREAUS */
exports.getAllBureaus = async (req, res) => {
  try {
    db.query(
      `
      SELECT *
      FROM yaya_bureaus
      ORDER BY id DESC
      `,
      (err, rows) => {
        if (err) {
          console.error(err);
          return res.status(500).json([]);
        }

        res.json(rows);
      }
    );
  } catch (error) {
    console.error(error);
    res.status(500).json([]);
  }
};

/* ✅ GET ALL CANDIDATES */
exports.getAllCandidates = async (req, res) => {
  try {
    db.query(
      `
      SELECT *
      FROM yaya_candidates
      ORDER BY candidate_id DESC
      `,
      (err, rows) => {
        if (err) {
          console.error(err);
          return res.status(500).json([]);
        }

        res.json(rows);
      }
    );
  } catch (error) {
    console.error(error);
    res.status(500).json([]);
  }
};

/* =========================================================
   PAYMENTS
   ========================================================= */

/* ✅ GET ALL PAYMENTS */
exports.getAllPayments = async (req, res) => {
  try {
    db.query(
      `
      SELECT *
      FROM yaya_payments
      ORDER BY id DESC
      `,
      (err, rows) => {
        if (err) {
          console.error(err);
          return res.status(500).json([]);
        }

        res.json(rows);
      }
    );
  } catch (error) {
    console.error(error);
    res.status(500).json([]);
  }
};

/* =========================================================
   DELETE OPERATIONS
   ========================================================= */

/* ✅ DELETE CANDIDATE */
exports.deleteCandidate = async (req, res) => {
  const { id } = req.params;

  try {
    db.query(
      `DELETE FROM yaya_candidates WHERE candidate_id=?`,
      [id],
      async (err, result) => {
        if (err) {
          console.error(err);
          return res.status(500).json({
            success: false,
            message: "Delete failed",
          });
        }

        if (!result.affectedRows) {
          return res.status(404).json({
            success: false,
            message: "Candidate not found",
          });
        }

        await redis.del(`candidate:${id}`);
        await redis.del("candidates:available");

        res.json({
          success: true,
          message: "Candidate deleted successfully",
        });
      }
    );
  } catch (error) {
    console.error(error);

    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};

/* ✅ DELETE EMPLOYER */
exports.deleteEmployer = async (req, res) => {
  const { uid } = req.params;

  try {
    db.query(
      `DELETE FROM yaya_employers WHERE uid=?`,
      [uid],
      async (err, result) => {
        if (err) {
          console.error(err);

          return res.status(500).json({
            success: false,
            message: "Delete failed",
          });
        }

        await redis.del(`employer:${uid}`);

        res.json({
          success: true,
          message: "Employer deleted successfully",
        });
      }
    );
  } catch (error) {
    console.error(error);

    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};

/* ✅ DELETE BUREAU */
exports.deleteBureau = async (req, res) => {
  const { uid } = req.params;

  try {
    db.query(
      `DELETE FROM yaya_bureaus WHERE user_id=?`,
      [uid],
      async (err, result) => {
        if (err) {
          console.error(err);

          return res.status(500).json({
            success: false,
            message: "Delete failed",
          });
        }

        await redis.del(`bureau:${uid}`);

        res.json({
          success: true,
          message: "Bureau deleted successfully",
        });
      }
    );
  } catch (error) {
    console.error(error);

    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};

/* =========================================================
   SEARCH
   ========================================================= */

/* ✅ SEARCH CANDIDATES */
exports.searchCandidates = async (req, res) => {
  const { keyword } = req.query;

  try {
    db.query(
      `
      SELECT *
      FROM yaya_candidates
      WHERE
        name LIKE ?
        OR county LIKE ?
        OR phone_no LIKE ?
      ORDER BY candidate_id DESC
      `,
      [
        `%${keyword}%`,
        `%${keyword}%`,
        `%${keyword}%`,
      ],
      (err, rows) => {
        if (err) {
          console.error(err);
          return res.status(500).json([]);
        }

        res.json(rows);
      }
    );
  } catch (error) {
    console.error(error);
    res.status(500).json([]);
  }
};