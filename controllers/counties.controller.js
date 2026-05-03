const db = require("../config/db");
const redis = require("../config/redis");

const COUNTIES_CACHE_KEY = "kenya:counties";

/* ✅ Get all counties */
exports.getCounties = async (req, res) => {
  const cached = await redis.get(COUNTIES_CACHE_KEY);
  if (cached) return res.json(JSON.parse(cached));

  db.query(`SELECT name FROM kenya_counties ORDER BY name ASC`, async (err, rows) => {
    if (err) return res.status(500).json({ message: "DB error" });

    const counties = rows.map(r => r.name);

    await redis.setEx(COUNTIES_CACHE_KEY, 86400, JSON.stringify(counties));
    res.json(counties);
  });
};