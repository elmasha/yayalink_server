const express = require("express");
const router = express.Router();
const db = require("../config/db");
const { normalizePhone } = require("../utils/sms");

/* Advanta inbound webhook.
   Configure this URL in your Advanta dashboard:
   https://your-api.com/api/sms/webhooks/advanta/inbound
*/
router.post("/webhooks/advanta/inbound", async (req, res) => {
  try {
    // Adjust field names to whatever Advanta actually posts.
    // Common: from / mobile / sender, text / message
    const incomingPhone =
      req.body.from || req.body.mobile || req.body.sender || req.body.msisdn;
    const rawText = String(
      req.body.text || req.body.message || req.body.msg || ""
    ).trim();

    if (!incomingPhone) {
      return res.status(400).json({ ok: false, error: "Missing sender phone" });
    }

    const normalized = normalizePhone(incomingPhone);
    if (!normalized) {
      return res.status(400).json({ ok: false, error: "Invalid phone" });
    }

    const upper = rawText.toUpperCase();
    const stopKeywords = ["STOP", "UNSUBSCRIBE", "CANCEL", "STOP ALL", "OPT OUT", "OPTOUT"];
    const isStop = stopKeywords.some(
      (kw) => upper === kw || upper.startsWith(kw + " ")
    );

    if (isStop) {
      await new Promise((resolve, reject) => {
        db.query(
          `INSERT INTO yaya_sms_suppression (phone, reason)
           VALUES (?, ?)
           ON DUPLICATE KEY UPDATE reason = VALUES(reason), created_at = CURRENT_TIMESTAMP`,
          [normalized, `STOP_KEYWORD:${upper.slice(0, 32)}`],
          (err) => (err ? reject(err) : resolve())
        );
      });

      console.log(`🚫 Opt-out recorded for ${normalized} (${upper})`);
      return res.json({ ok: true, action: "opted_out" });
    }

    // Not a STOP — just log it
    console.log(`📥 Inbound SMS from ${normalized}: ${rawText.slice(0, 120)}`);
    return res.json({ ok: true, action: "logged" });
  } catch (error) {
    console.error("Inbound SMS webhook error:", error.message);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

module.exports = router;