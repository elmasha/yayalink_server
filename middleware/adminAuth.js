const admin = require("../config/firebaseAdmin");
const db = require("../config/db");

async function adminAuth(req, res, next) {
  try {
    // 1. Extract token from Authorization header
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        success: false,
        message: "Missing or invalid Authorization header",
      });
    }

    const idToken = authHeader.split("Bearer ")[1];

    // 2. Verify the Firebase ID token
    const decoded = await admin.auth().verifyIdToken(idToken);

    const uid = decoded.uid;

    // 3. Confirm this UID exists in yaya_admins
    const rows = await new Promise((resolve, reject) => {
      db.query(
        `SELECT id, name, email, is_active
         FROM yaya_admins
         WHERE uid = ? LIMIT 1`,
        [uid],
        (err, rows) => (err ? reject(err) : resolve(rows))
      );
    });

    if (!rows.length) {
      return res.status(403).json({
        success: false,
        message: "Not an admin account",
      });
    }

    if (!rows[0].is_active) {
      return res.status(403).json({
        success: false,
        message: "Admin account is suspended",
      });
    }

    // 4. Attach verified admin identity to the request
    req.admin = {
      uid,
      name: rows[0].name,
      email: rows[0].email,
      dbId: rows[0].id,
    };

    next();
  } catch (err) {
    console.error("adminAuth error:", err.message);

    // Firebase-specific error codes
    if (err.code === "auth/id-token-expired") {
      return res.status(401).json({
        success: false,
        message: "Session expired. Please log in again.",
      });
    }

    if (err.code === "auth/id-token-revoked") {
      return res.status(401).json({
        success: false,
        message: "Session revoked. Please log in again.",
      });
    }

    return res.status(401).json({
      success: false,
      message: "Invalid authentication token",
    });
  }
}

module.exports = adminAuth;