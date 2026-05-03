const db = require("../config/db");
const redis = require("../config/redis");
const { userKey } = require("../utils/cacheKeys");

exports.syncUser = (req, res) => {
  const { uid, email, name, phone_no, user_state } = req.body;

  const sql = `
    INSERT INTO yaya_users (uid,email,name,phone_no,user_state)
    VALUES (?,?,?,?,?)
    ON DUPLICATE KEY UPDATE
      email=VALUES(email),
      name=VALUES(name),
      phone_no=VALUES(phone_no),
      user_state=VALUES(user_state)
  `;

  db.query(sql, [uid, email, name, phone_no, user_state], async (err) => {
    if (err) return res.status(500).json({ message: "DB error" });

    await redis.del(userKey(uid)); // invalidate cache
    res.json({ message: "User synced" });
  });
};



const emailKey = (email) =>
  `auth:email:exists:${email.toLowerCase()}`;

exports.checkEmailExists = async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(200).json({
      exists: false,
      type: null,
      message: "INVALID_EMAIL",
    });
  }

  try {
    /* 🔹 Redis first */
    // const cached = await redis.get(emailKey(email));
    // if (cached) {
    //   return res.status(200).json(JSON.parse(cached));
    // }

    /* 🔹 Check employer */
    const employer = await new Promise((resolve, reject) => {
      db.query(
        `SELECT uid FROM yaya_employers WHERE email=? LIMIT 1`,
        [email],
        (err, rows) => (err ? reject(err) : resolve(rows))
      );
    });

    if (employer.length) {
      const response = {
        exists: true,
        type: "EMPLOYER",
      };

      await redis.setEx(emailKey(email), 100, JSON.stringify(response));
      return res.status(200).json(response);
    }

    /* 🔹 Check bureau */
    const bureau = await new Promise((resolve, reject) => {
      db.query(
        `SELECT id FROM yaya_bureaus WHERE email=? LIMIT 1`,
        [email],
        (err, rows) => (err ? reject(err) : resolve(rows))
      );
    });

    const response = bureau.length
      ? { exists: true, type: "BUREAU" }
      : { exists: false, type: null };

    await redis.setEx(emailKey(email), 100, JSON.stringify(response));

    return res.status(200).json(response);
  } catch (error) {
    console.error("Email check error:", error);
    return res.status(500).json({
      exists: false,
      type: null,
      message: "SERVER_ERROR",
    });
  }
};