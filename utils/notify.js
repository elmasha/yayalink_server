const db = require("../config/db");

exports.sendNotification = async ({
  user_uid,
  user_type,
  title,
  message,
  type = "SYSTEM",
}) => {
  /* 1️⃣ Save to DB */
  await new Promise((resolve, reject) => {
    db.query(
      `
      INSERT INTO yaya_notifications
      (user_uid, user_type, title, message, type)
      VALUES (?, ?, ?, ?, ?)
      `,
      [user_uid, user_type, title, message, type],
      (err) => (err ? reject(err) : resolve())
    );
  });

  /* 2️⃣ Emit real-time */
  if (global.io) {
    global.io.to(user_uid).emit("notification", {
      title,
      message,
      type,
      created_at: new Date(),
    });
  }
};
