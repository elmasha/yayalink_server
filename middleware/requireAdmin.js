const db = require("../config/db");

exports.requireAdmin = (req, res, next) => {
  const uid =
    req.body.admin_uid ||
    req.headers["x-admin-uid"] ||
    req.query.admin_uid;

  if (!uid) {
    return res.status(401).json({
      success: false,
      reason: "MISSING_ADMIN_UID",
      message: "Admin UID required.",
    });
  }

  db.query(
    `SELECT uid, is_active FROM yaya_admins WHERE uid = ? LIMIT 1`,
    [uid],
    (err, rows) => {
      if (err) {
        console.error("requireAdmin DB error:", err);
        return res.status(500).json({
          success: false,
          reason: "SERVER_ERROR",
        });
      }

      if (!rows.length) {
        return res.status(403).json({
          success: false,
          reason: "NOT_AN_ADMIN",
          message: "Access denied.",
        });
      }

      if (!rows[0].is_active) {
        return res.status(403).json({
          success: false,
          reason: "ADMIN_DISABLED",
          message: "Admin account is disabled.",
        });
      }

      req.admin_uid = uid;
      next();
    }
  );
};