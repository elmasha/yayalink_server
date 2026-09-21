const db = require("../config/db");
const redis = require("../config/redis");
const { bureauKey } = require("../utils/cacheKeys");
const {
  computeBureauStatus,
  TRIAL_DAYS,
  SUBSCRIPTION_DAYS,
} = require("../utils/subscription");

/* ✅ REGISTER BUREAU */
exports.createBureau = async (req, res) => {
  const {
    user_id,
    bureau_name,
    name,
    email,
    phone_no,
    id_no,
    box_no,
    building,
    street_name,
    city,
    county,
    postal_code,
    bureau_image,
    device_token,
  } = req.body;

  if (!user_id || !bureau_name || !phone_no) {
    return res.status(200).json({
      success: false,
      message: "Missing required fields",
    });
  }

  try {
    // Trial starts at creation, ends 14 days later
    const trialEndsAt = new Date();
    trialEndsAt.setDate(trialEndsAt.getDate() + TRIAL_DAYS);

    db.query(
      `INSERT INTO yaya_bureaus (
        user_id, bureau_name, name, email, phone_no, id_no,
        box_no, building, street_name, city, county,
        postal_code, bureau_image, device_token, user_state,
        trial_ends_at, subscription_status
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        user_id,
        bureau_name,
        name,
        email,
        phone_no,
        id_no,
        box_no,
        building,
        street_name,
        city,
        county,
        postal_code,
        bureau_image,
        device_token,
        "Bureau",
        trialEndsAt,
        "TRIAL",
      ],
      async (err) => {
        if (err) {
          if (err.code === "ER_DUP_ENTRY") {
            return res.status(200).json({
              success: false,
              message: "Bureau already registered",
            });
          }

          console.error("Create bureau error:", err);
          return res.status(500).json({ success: false });
        }

        await redis.del(bureauKey(user_id));

        res.status(200).json({
          success: true,
          message: "Bureau registered successfully",
          trial_ends_at: trialEndsAt,
        });
      }
    );
  } catch (error) {
    console.error("Create bureau fatal:", error);
    res.status(500).json({ success: false });
  }
};

/* ✅ GET BUREAU */
exports.getBureau = async (req, res) => {
  const { user_id } = req.params;
  const key = bureauKey(user_id);

  try {
    const cached = await redis.get(key);
    if (cached) return res.json(JSON.parse(cached));

    db.query(
      `SELECT * FROM yaya_bureaus WHERE user_id=? LIMIT 1`,
      [user_id],
      async (err, rows) => {
        if (err) return res.status(500).json({ message: "DB error" });
        if (!rows.length) return res.status(200).json({ exists: false });

        const bureau = rows[0];
        const status = computeBureauStatus(bureau);

        const payload = {
          ...bureau,
          subscription: {
            status: status.status,
            days_left: status.daysLeft,
            expires_at: status.expiresAt,
            is_trial: status.status === "TRIAL",
            is_active: status.isActive,
            is_grace: status.isGrace,
            is_expired: status.isExpired,
          },
        };

        // Cache for only 60s so subscription status stays fresh
        await redis.setEx(key, 60, JSON.stringify(payload));
        res.json(payload);
      }
    );
  } catch (error) {
    console.error("Get bureau error:", error);
    res.status(500).json({ message: "Server error" });
  }
};

/* ✅ UPDATE BUREAU DEVICE TOKEN ON LOGIN */
exports.updateBureauDeviceToken = async (req, res) => {
  const { user_id } = req.params;
  const { device_token } = req.body;

  if (!user_id) {
    return res.status(200).json({
      success: false,
      message: "Missing user_id",
    });
  }

  if (!device_token) {
    return res.status(200).json({
      success: false,
      message: "Missing device_token",
    });
  }

  try {
    db.query(
      `UPDATE yaya_bureaus SET device_token = ? WHERE user_id = ?`,
      [device_token, user_id],
      async (err, result) => {
        if (err) {
          console.error("Update bureau device token error:", err);
          return res.status(500).json({
            success: false,
            message: "Failed to update device token",
            error: err.message,
          });
        }

        if (!result.affectedRows) {
          return res.status(200).json({
            success: false,
            message: "Bureau not found",
          });
        }

        try {
          await redis.del(bureauKey(user_id));
        } catch (cacheErr) {
          console.warn("Redis clear error:", cacheErr.message);
        }

        return res.status(200).json({
          success: true,
          message: "Device token updated successfully",
        });
      }
    );
  } catch (error) {
    console.error("Update bureau device token fatal:", error);
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

/* ✅ UPDATE BUREAU */
exports.updateBureau = async (req, res) => {
  const { user_id } = req.params;

  try {
    db.query(
      `UPDATE yaya_bureaus SET ? WHERE user_id=?`,
      [req.body, user_id],
      async (err, result) => {
        if (err) return res.status(500).json({ message: "Update failed" });
        if (!result.affectedRows)
          return res.status(200).json({ message: "Bureau not found" });

        await redis.del(bureauKey(user_id));
        res.json({ message: "Bureau updated successfully" });
      }
    );
  } catch (error) {
    console.error("Update bureau error:", error);
    res.status(500).json({ message: "Server error" });
  }
};

/* ✅ GET BUREAU PAYMENT / SUBSCRIPTION STATUS */
// GET /api/bureaus/payment-status/:user_id
exports.getBureauPaymentStatus = async (req, res) => {
  const { user_id } = req.params;

  if (!user_id) {
    return res.status(200).json({
      paid: false,
      message: "INVALID_USER_ID",
    });
  }

  try {
    const cacheKey = `${bureauKey(user_id)}:payment_status`;
    try {
      const cached = await redis.get(cacheKey);
      if (cached) return res.status(200).json(JSON.parse(cached));
    } catch (e) {
      console.warn("Redis error:", e.message);
    }

    db.query(
      `SELECT mpesa_receipt, payment_date, trial_ends_at,
              access_expires_at, subscription_status, last_payment_amount
       FROM yaya_bureaus WHERE user_id = ? LIMIT 1`,
      [user_id],
      async (err, rows) => {
        if (err) {
          console.error("DB Error:", err);
          return res.status(500).json({
            paid: false,
            message: "SERVER_ERROR",
          });
        }

        if (!rows || rows.length === 0) {
          return res.status(200).json({
            paid: false,
            message: "BUREAU_NOT_FOUND",
          });
        }

        const bureau = rows[0];
        const status = computeBureauStatus(bureau);

        const response = {
          paid: status.isActive,
          subscription_status: status.status,
          days_left: status.daysLeft,
          expires_at: status.expiresAt,
          is_trial: status.status === "TRIAL",
          is_grace: status.isGrace,
          is_expired: status.isExpired,
          last_payment_amount: bureau.last_payment_amount,
          message:
            status.status === "TRIAL"
              ? "TRIAL_ACTIVE"
              : status.status === "ACTIVE"
              ? "SUBSCRIPTION_ACTIVE"
              : status.status === "GRACE"
              ? "GRACE_PERIOD"
              : "SUBSCRIPTION_EXPIRED",
        };

        // Cache 30s while trial/active, 5min when expired
        const ttl = status.isExpired ? 300 : 30;
        try {
          await redis.setEx(cacheKey, ttl, JSON.stringify(response));
        } catch (e) {}

        return res.status(200).json(response);
      }
    );
  } catch (error) {
    console.error("Payment status fatal error:", error);
    return res.status(500).json({
      paid: false,
      message: "SERVER_ERROR",
    });
  }
};

/* ✅ RENEW BUREAU SUBSCRIPTION (called after successful STK) */
// This is invoked from your payments controller callback after M-Pesa confirms.
exports.activateBureauSubscription = (user_id, amount, receipt, callback) => {
  db.query(
    `SELECT access_expires_at FROM yaya_bureaus WHERE user_id = ? LIMIT 1`,
    [user_id],
    (err, rows) => {
      if (err) return callback(err);
      if (!rows || rows.length === 0)
        return callback(new Error("BUREAU_NOT_FOUND"));

      // Extend from max(now, current_expiry) so early renewals stack
      const now = new Date();
      const current = rows[0].access_expires_at
        ? new Date(rows[0].access_expires_at)
        : null;

      const base = current && current > now ? current : now;
      const newExpiry = new Date(base);
      newExpiry.setDate(newExpiry.getDate() + SUBSCRIPTION_DAYS);

      db.query(
        `UPDATE yaya_bureaus
         SET access_expires_at = ?,
             subscription_status = 'ACTIVE',
             user_state = 'ACTIVE',
             mpesa_receipt = ?,
             payment_date = NOW(),
             last_payment_amount = ?
         WHERE user_id = ?`,
        [newExpiry, receipt, amount, user_id],
        async (updateErr) => {
          if (updateErr) return callback(updateErr);

          try {
            await redis.del(bureauKey(user_id));
            await redis.del(`${bureauKey(user_id)}:payment_status`);
          } catch (e) {}

          callback(null, { expires_at: newExpiry });
        }
      );
    }
  );
};