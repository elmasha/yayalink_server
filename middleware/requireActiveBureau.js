// middleware/requireActiveBureau.js

const db = require("../config/db");
const { computeBureauStatus } = require("../utils/subscription");

exports.requireActiveBureau = (req, res, next) => {
  // Accept user_id from params, body, or query
  const user_id =
    req.params.user_id ||
    req.params.uid ||
    req.body.user_id ||
    req.body.uid ||
    req.query.user_id ||
    req.query.uid;

  if (!user_id) {
    return res.status(400).json({
      success: false,
      reason: "MISSING_USER_ID",
      message: "Bureau user id is required.",
    });
  }

  db.query(
    `SELECT user_id, trial_ends_at, access_expires_at, subscription_status
     FROM yaya_bureaus WHERE user_id = ? LIMIT 1`,
    [user_id],
    (err, rows) => {
      if (err) {
        console.error("requireActiveBureau DB error:", err);
        return res.status(500).json({
          success: false,
          reason: "SERVER_ERROR",
        });
      }

      if (!rows || rows.length === 0) {
        return res.status(404).json({
          success: false,
          reason: "BUREAU_NOT_FOUND",
          message: "Bureau account not found.",
        });
      }

      const bureau = rows[0];
      const status = computeBureauStatus(bureau);

      // Attach for downstream handlers
      req.bureauSubscription = status;

      if (status.isExpired) {
        return res.status(402).json({
          success: false,
          reason: "SUBSCRIPTION_EXPIRED",
          message:
            "Your subscription has expired. Please renew to continue adding or managing candidates.",
          subscription: {
            status: status.status,
            days_left: 0,
            expired: true,
          },
        });
      }

      // Grace users still pass through but flagged
      if (status.isGrace) {
        res.setHeader("X-Subscription-Warning", "GRACE_PERIOD");
      }

      return next();
    }
  );
};