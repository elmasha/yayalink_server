const db = require("../config/db");
const redis = require("../config/redis");
const { employerKey, graceKey } = require("../utils/cacheKeys");
const { getPlans: getPlansFromSettings } = require("../utils/settings");

/* ✅ GET PLANS FOR A USER TYPE */
exports.getPlans = async (req, res) => {
  const { user_type } = req.params;

  if (!["EMPLOYER", "BUREAU"].includes(user_type)) {
    return res.status(400).json({
      success: false,
      message: "Invalid user type",
    });
  }

  try {
    const plans = await getPlansFromSettings(user_type);
    return res.json({ success: true, plans });
  } catch (error) {
    console.error("getPlans error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};

exports.confirmPayment = async (req, res) => {
  const { uid, mpesa_receipt } = req.body;

  db.query(
    `
    UPDATE yaya_employer
    SET mpesa_receipt=?, payment_date=NOW()
    WHERE user_id=?
    `,
    [mpesa_receipt, uid],
    async (err) => {
      if (err) return res.status(500).json({ message: "Payment failed" });

      // 3-day grace period
      await redis.setEx(graceKey(uid), 259200, "active");
      await redis.del(employerKey(uid));

      res.json({ message: "Payment confirmed" });
    }
  );
};


exports.getPaymentStatus = async (req, res) => {
  const uid = req.params.uid;   

  const cached = await redis.get(graceKey(uid));
  if (cached) return res.json({ status: "grace_period", data: JSON.parse(cached) });

  db.query(
    `SELECT payment_date FROM yaya_employer WHERE user_id=?`,
    [uid],
    async (err, rows) => {
      if (err) return res.status(500).json({ message: "DB error" });
      if (rows.length === 0)
        return res.status(404).json({ message: "Employer not found" });

      const paymentDate = rows[0].payment_date;
      const gracePeriodEnd = new Date(paymentDate);
      gracePeriodEnd.setDate(gracePeriodEnd.getDate() + 3);

      const now = new Date();
      const isGracePeriodActive = now <= gracePeriodEnd;

      res.json({
        status: isGracePeriodActive ? "grace_period" : "expired",
        data: { paymentDate, gracePeriodEnd }
      });
    }
  );
};