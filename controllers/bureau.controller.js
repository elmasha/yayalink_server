const db = require("../config/db");
const redis = require("../config/redis");
const { bureauKey } = require("../utils/cacheKeys");

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
    device_token
  } = req.body;

  if (!user_id || !bureau_name || !phone_no) {
    return res.status(200).json({
      success: false,
      message: "Missing required fields"
    });
  }

  try {
    db.query(
      `INSERT INTO yaya_bureaus (
        user_id, bureau_name, name, email, phone_no, id_no,
        box_no, building, street_name, city, county,
        postal_code, bureau_image, device_token, user_state
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
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
        "Bureau"
      ],
      async (err) => {
        if (err) {
          if (err.code === "ER_DUP_ENTRY") {
            return res.status(200).json({
              success: false,
              message: "Bureau already registered"
            });
          }

          console.error("Create bureau error:", err);
          return res.status(500).json({ success: false });
        }

        await redis.del(bureauKey(user_id));

        res.status(200).json({
          success: true,
          message: "Bureau registered successfully"
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
        if (!rows.length)
          return res.status(200).json({ exists: false });

        await redis.setEx(key, 600, JSON.stringify(rows[0]));
        res.json(rows[0]);
      }
    );
  } catch (error) {
    console.error("Get bureau error:", error);
    res.status(500).json({ message: "Server error" });
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


// GET /api/bureaus/payment-status/:user_id
exports.getBureauPaymentStatus = async (req, res) => {
  const { user_id } = req.params;

  if (!user_id) {
    return res.status(200).json({
      paid: false,
      message: "INVALID_USER_ID"
    });
  }

  try {
    /* 🔹 1. Optional: Check Redis cache first (high performance) */
    const cacheKey = `${bureauKey(user_id)}:payment_status`;
    try {
      const cached = await redis.get(cacheKey);
      if (cached) {
        return res.status(200).json(JSON.parse(cached));
      }
    } catch (e) {
      console.warn("Redis error:", e.message);
    }

    /* 🔹 2. Fetch bureau from DB */
    db.query(
      `
      SELECT mpesa_receipt, payment_date, user_state
      FROM yaya_bureaus
      WHERE user_id = ?
      LIMIT 1
      `,
      [user_id],
      async (err, rows) => {
        if (err) {
          console.error("DB Error:", err);
          return res.status(500).json({
            paid: false,
            message: "SERVER_ERROR"
          });
        }

        /* ❌ Bureau not found */
        if (!rows || rows.length === 0) {
          return res.status(200).json({
            paid: false,
            message: "BUREAU_NOT_FOUND"
          });
        }

        const bureau = rows[0];

        /* ❌ Not paid yet */
        if (!bureau.mpesa_receipt || !bureau.payment_date) {
          const response = {
            paid: false,
            user_state: "INACTIVE",
            message: "PAYMENT_REQUIRED"
          };

          // Cache for 30 seconds (avoid DB spam)
          try {
            await redis.setEx(cacheKey, 30, JSON.stringify(response));
          } catch (e) {}

          return res.status(200).json(response);
        }

        /* ✅ Paid → Activate account if not already */
        if (bureau.user_state !== "ACTIVE") {
          db.query(
            `
            UPDATE yaya_bureaus
            SET user_state = 'ACTIVE'
            WHERE user_id = ?
            `,
            [user_id],
            async (updateErr) => {
              if (updateErr) {
                console.error("Activation error:", updateErr);
              }

              const response = {
                paid: true,
                user_state: "ACTIVE",
                message: "ACCOUNT_ACTIVATED"
              };

              // Cache for 5 minutes
              try {
                await redis.setEx(cacheKey, 300, JSON.stringify(response));
              } catch (e) {}

              return res.status(200).json(response);
            }
          );
        } else {
          /* ✅ Already active */
          const response = {
            paid: true,
            user_state: "ACTIVE",
            message: "ALREADY_ACTIVE"
          };

          // Cache for 5 minutes
          try {
            await redis.setEx(cacheKey, 300, JSON.stringify(response));
          } catch (e) {}

          return res.status(200).json(response);
        }
      }
    );
  } catch (error) {
    console.error("Payment status fatal error:", error);
    return res.status(500).json({
      paid: false,
      message: "SERVER_ERROR"
    });
  }
};