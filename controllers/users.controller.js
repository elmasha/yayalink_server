const db = require("../config/db");

exports.getUserRole = async (req, res) => {
  const { uid } = req.params;

  if (!uid) {
    return res.status(400).json({ role: null, message: "MISSING_UID" });
  }

  try {
    // Check bureau first
    const bureauRows = await new Promise((resolve, reject) => {
      db.query(
        `SELECT user_id FROM yaya_bureaus WHERE user_id = ? LIMIT 1`,
        [uid],
        (err, rows) => (err ? reject(err) : resolve(rows))
      );
    });

    if (bureauRows.length > 0) {
      return res.json({ role: "bureau", uid });
    }

    // Check employer
    const employerRows = await new Promise((resolve, reject) => {
      db.query(
        `SELECT uid FROM yaya_employers WHERE uid = ? LIMIT 1`,
        [uid],
        (err, rows) => (err ? reject(err) : resolve(rows))
      );
    });

    if (employerRows.length > 0) {
      return res.json({ role: "employer", uid });
    }

    return res.json({ role: null, uid, message: "NOT_REGISTERED" });
  } catch (err) {
    console.error("getUserRole error:", err);
    return res.status(500).json({ role: null, message: "SERVER_ERROR" });
  }
};