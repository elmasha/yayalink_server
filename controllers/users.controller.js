const db = require("../config/db");
const redis = require("../config/redis");
const { userKey } = require("../utils/cacheKeys");

/* ✅ Get User */
exports.getUser = async (req, res) => {
  const key = userKey(req.params.uid);

  const cached = await redis.get(key);
  if (cached) return res.json(JSON.parse(cached));

  db.query(
    `SELECT * FROM yaya_users WHERE uid=?`,
    [req.params.uid],
    async (err, rows) => {
      if (err) return res.status(500).json({ message: "DB error" });
      await redis.setEx(key, 600, JSON.stringify(rows[0]));
      res.json(rows[0]);
    }
  );
};

/* ✅ Update User */
exports.updateUser = async (req, res) => {
  db.query(
    `UPDATE yaya_users SET ? WHERE uid=?`,
    [req.body, req.params.uid],
    async (err) => {
      if (err) return res.status(500).json({ message: "Update failed" });
      await redis.del(userKey(req.params.uid));
      res.json({ message: "User updated" });
    }
  );
};

/* ✅ Delete User (FIX) */
exports.deleteUser = async (req, res) => {
  const uid = req.params.uid;

  db.query(
    `DELETE FROM yaya_users WHERE uid = ?`,
    [uid],
    async (err, result) => {
      if (err) return res.status(500).json({ message: "Delete failed" });
      if (result.affectedRows === 0)
        return res.status(404).json({ message: "User not found" });

      await redis.del(userKey(uid));
      res.json({ message: "User deleted successfully" });
    }
  );
};
