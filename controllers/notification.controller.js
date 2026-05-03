const db = require("../config/db");
const redis = require("../config/redis");
const { notificationKey } = require("../utils/cacheKeys");

exports.getNotifications = async (req, res) => {
  const { uid } = req.params;
  const notificationKeyStr = notificationKey(uid);
  try {
    /* 🔹 Redis first */
    const cached = await redis.get(notificationKeyStr);
    if (cached) {
      return res.status(200).json(JSON.parse(cached));
    }   
    /* 🔹 Fetch from DB */
    db.query(
      `
      SELECT * FROM yaya_notifications
      WHERE user_uid=?
      ORDER BY created_at DESC    
      `,
      [uid],
      async (err, rows) => {
        if (err) return res.status(500).json({ message: "DB error" });
        await redis.setEx(notificationKeyStr, 600, JSON.stringify(rows));
        res.json(rows);
      }
    );
  } catch (error) {
    console.error("Error fetching notifications:", error);
    res.status(500).json({ message: "Server error" });
  }
};

exports.markNotificationRead = async (req, res) => {
  const { id } = req.params;
  notificationKey = notificationKey(req.body.user_uid);
  await redis.del(notificationKey);
  db.query(
    `UPDATE yaya_notifications SET is_read=1 WHERE id=?`,
    [id],
    () => res.json({ success: true })
  );
};