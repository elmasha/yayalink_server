const db = require("../config/db");
const redis = require("../config/redis");
const { feedbackKey } = require("../utils/cacheKeys");

exports.getFeedback = async (req, res) => {
  const cached = await redis.get(feedbackKey());
  if (cached) return res.json(JSON.parse(cached));

  db.query(`SELECT * FROM yaya_feedback`, async (err, rows) => {
    if (err) return res.status(500).json({ message: "Fetch failed" });
    await redis.setEx(feedbackKey(), 600, JSON.stringify(rows));
    res.json(rows);
  });
};

exports.createFeedback = async (req, res) => {
  db.query(`INSERT INTO yaya_feedback SET ?`, req.body, async (err) => {
    if (err) return res.status(500).json({ message: "Create failed" });
    await redis.del(feedbackKey());
    res.status(201).json({ message: "Feedback submitted" });
  });
};
