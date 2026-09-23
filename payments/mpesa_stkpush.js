const express = require("express");
const request = require("request");
const bodyParser = require("body-parser");
const app = express();
const cors = require("cors");
const db = require("../config/db");
const redis = require("../config/redis");
const { parseMpesaCallback } = require("../utils/mpesa");
const { sendNotification } = require("../utils/notify");

///-----Config-----///
const port = process.env.PORT1 || 3000;
const CALLBACK_BASE =
  process.env.CALLBACK_BASE ||
  "https://yayalinkserver-production-b920.up.railway.app/api/payments";

const _urlencoded = express.urlencoded({ extended: false });
app.use(cors());
app.use(express.json());
app.use(express.static("public"));

///----CORS-----///
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header(
    "Access-Control-Allow-Headers",
    "Origin, X-Requested-With, Content-Type, Accept, Authorization"
  );

  if (req.method === "OPTIONS") {
    res.header("Access-Control-Allow-Methods", "PUT, POST, PATCH, DELETE, GET");
    return res.status(200).json({});
  }

  next();
});

/* ═══════════════════════════════════════════════════════════════
   SAFARICOM ACCESS TOKEN MIDDLEWARE
   ═══════════════════════════════════════════════════════════════ */
const consumer_key = process.env.PROD_CONSUMER_KEY_DEV;
const consumer_secret = process.env.PROD_SECRET_KEY_DEV;

function access(req, res, next) {
  // ✅ Fixed parameter order: (req, res, next)
  const endpoint =
    "https://api.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials";

  const auth = Buffer.from(`${consumer_key}:${consumer_secret}`).toString("base64");

  request(
    {
      url: endpoint,
      headers: { Authorization: "Basic " + auth },
    },
    (error, response, body) => {
      if (error) {
        console.error("Access token error:", error);
        return res.status(500).json({ error: "Failed to get access token" });
      }
      try {
        const token = JSON.parse(body).access_token;
        req.access_token = token;
        next();
      } catch (e) {
        console.error("Token parse error:", e, body);
        return res.status(500).json({ error: "Invalid token response" });
      }
    }
  );
}

/* ═══════════════════════════════════════════════════════════════
   EMPLOYER STK PUSH
   ═══════════════════════════════════════════════════════════════ */
app.post("/stk", access, _urlencoded, function (req, res) {
  const _phoneNumber = req.body.phone;
  const _Amount = req.body.amount;
  const _UserID = req.body.user_id;
  const _Username = req.body.User_name;
  const _planDays = Number(req.body.plan_days) || 30;

  if (!_phoneNumber || !_Amount || !_UserID) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  const endpoint = "https://api.safaricom.co.ke/mpesa/stkpush/v1/processrequest";
  const auth = "Bearer " + req.access_token;

  const _shortCode = process.env.PROD_SHORTCODE_DEV;
  const _passKey = process.env.PROD_PASSKEY_DEV;

  const timeStamp = new Date()
    .toISOString()
    .replace(/[^0-9]/g, "")
    .slice(0, -3);
  const password = Buffer.from(
    `${_shortCode}${_passKey}${timeStamp}`
  ).toString("base64");

  request(
    {
      url: endpoint,
      method: "POST",
      headers: { Authorization: auth },
      json: {
        BusinessShortCode: _shortCode,
        Password: password,
        Timestamp: timeStamp,
        TransactionType: "CustomerPayBillOnline",
        Amount: _Amount,
        PartyA: _phoneNumber,
        PartyB: _shortCode,
        PhoneNumber: _phoneNumber,
        CallBackURL: `${CALLBACK_BASE}/stk_callback`,
        AccountReference: `YayaLink App ${_UserID}`,
        TransactionDesc: "Payment for YayaLink access",
      },
    },
    async (error, response, body) => {
      if (error) {
        console.error("STK error:", error);
        return res.status(500).json({ error: "STK request failed" });
      }

      console.log("STK response:", body);

      // 🔥 Persist payment context in Redis keyed by CheckoutRequestID
      const checkoutId = body?.CheckoutRequestID;
      if (checkoutId) {
        try {
          await redis.setEx(
            `stk:context:${checkoutId}`,
            600, // 10 minutes
            JSON.stringify({
              uid: _UserID,
              name: _Username,
              plan_days: _planDays,
              user_type: "EMPLOYER",
              amount: _Amount,
            })
          );
        } catch (e) {
          console.warn("Failed to cache STK context:", e.message);
        }
      }

      return res.status(200).json(body);
    }
  );
});

/* ═══════════════════════════════════════════════════════════════
   EMPLOYER STK CALLBACK
   ═══════════════════════════════════════════════════════════════ */
app.post("/stk_callback", _urlencoded, async (req, res) => {
  console.log("Received STK callback:", JSON.stringify(req.body));

  try {
    const callback = req.body?.Body?.stkCallback;

    if (!callback || callback.ResultCode !== 0) {
      return res.status(200).json({ message: "Payment failed" });
    }

    const checkoutId = callback.CheckoutRequestID;

    // 🔥 Look up the context we stored when the STK was initiated
    let ctx = null;
    try {
      const cached = await redis.get(`stk:context:${checkoutId}`);
      if (cached) ctx = JSON.parse(cached);
    } catch (e) {
      console.warn("Failed to read STK context:", e.message);
    }

    const uid = ctx?.uid;
    const planDays = ctx?.plan_days || 30;
    const userName = ctx?.name || "Employer";

    if (!uid) {
      console.error("No STK context for checkout:", checkoutId);
      return res.status(200).json({ message: "Missing context" });
    }

    const { mpesa_receipt, amount } = parseMpesaCallback(callback);

    if (!mpesa_receipt) {
      return res.status(200).json({ message: "Invalid callback data" });
    }

    /* 🔒 Prevent duplicate payment */
    const existing = await new Promise((resolve, reject) => {
      db.query(
        `SELECT id FROM yaya_payments WHERE mpesa_receipt = ? LIMIT 1`,
        [mpesa_receipt],
        (err, rows) => (err ? reject(err) : resolve(rows))
      );
    });

    if (existing.length) {
      return res.status(200).json({ message: "Already processed" });
    }

    /* ✅ Insert payment record with plan_days */
    await new Promise((resolve, reject) => {
      db.query(
        `
        INSERT INTO yaya_payments
        (uid, user_type, mpesa_receipt, amount, plan_days, payment_date)
        VALUES (?, 'EMPLOYER', ?, ?, ?, NOW())
        `,
        [uid, mpesa_receipt, amount, planDays],
        (err) => (err ? reject(err) : resolve())
      );
    });

    /* ✅ Update employer access */
    await new Promise((resolve, reject) => {
      db.query(
        `
        UPDATE yaya_employers
        SET
          mpesa_receipt = ?,
          payment_date = NOW(),
          access_expires_at = DATE_ADD(NOW(), INTERVAL ? DAY)
        WHERE uid = ?
        `,
        [mpesa_receipt, planDays, uid],
        (err) => (err ? reject(err) : resolve())
      );
    });

    /* ✅ Send notification */
    try {
      await sendNotification({
        user_uid: uid,
        user_type: "EMPLOYER",
        title: "Payment Successful",
        message: `Hi ${userName}, your payment of KES ${amount} was successful. Your access has been updated.`,
        type: "PAYMENT",
      });
    } catch (notifyErr) {
      console.warn("Notification failed:", notifyErr.message);
    }

    /* 🧹 Clear caches */
    try {
      await redis.del(`employer:access:${uid}`);
      await redis.del(`employer:payment:${uid}`);
      await redis.del(`stk:context:${checkoutId}`);
    } catch (_) {}

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error("❌ Employer payment callback error:", error);
    return res.status(200).json({ success: false });
  }
});

/* ═══════════════════════════════════════════════════════════════
   STK QUERY (generic)
   ═══════════════════════════════════════════════════════════════ */
app.post("/stk/query", access, _urlencoded, function (req, res) {
  const _checkoutRequestId = req.body.checkoutRequestId;

  if (!_checkoutRequestId) {
    return res.status(400).json({ error: "Missing checkoutRequestId" });
  }

  const auth = "Bearer " + req.access_token;
  const endpoint = "https://api.safaricom.co.ke/mpesa/stkpushquery/v1/query";
  const _shortCode = process.env.PROD_SHORTCODE_DEV;
  const _passKey = process.env.PROD_PASSKEY_DEV;

  const timeStamp = new Date()
    .toISOString()
    .replace(/[^0-9]/g, "")
    .slice(0, -3);
  const password = Buffer.from(
    `${_shortCode}${_passKey}${timeStamp}`
  ).toString("base64");

  request(
    {
      url: endpoint,
      method: "POST",
      headers: { Authorization: auth },
      json: {
        BusinessShortCode: _shortCode,
        Password: password,
        Timestamp: timeStamp,
        CheckoutRequestID: _checkoutRequestId,
      },
    },
    function (error, response, body) {
      if (error) {
        console.error("STK query error:", error);
        return res.status(500).json({ error: "Query failed" });
      }
      console.log("STK query response:", body);
      return res.status(200).json(body);
    }
  );
});

/* ═══════════════════════════════════════════════════════════════
   BUREAU STK PUSH
   ═══════════════════════════════════════════════════════════════ */
app.post("/stk_register", access, _urlencoded, function (req, res) {
  const _BPhone = req.body.phone;
  const _BAmount = req.body.amount;
  const _BUiD = req.body.user_id;
  const _BfName = req.body.User_name;
  const _planDays = Number(req.body.plan_days) || 30;

  if (!_BPhone || !_BAmount || !_BUiD) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  const endpoint = "https://api.safaricom.co.ke/mpesa/stkpush/v1/processrequest";
  const auth = "Bearer " + req.access_token;

  const _shortCode = process.env.PROD_SHORTCODE_DEV;
  const _passKey = process.env.PROD_PASSKEY_DEV;

  const timeStamp = new Date()
    .toISOString()
    .replace(/[^0-9]/g, "")
    .slice(0, -3);
  const password = Buffer.from(
    `${_shortCode}${_passKey}${timeStamp}`
  ).toString("base64");

  request(
    {
      url: endpoint,
      method: "POST",
      headers: { Authorization: auth },
      json: {
        BusinessShortCode: _shortCode,
        Password: password,
        Timestamp: timeStamp,
        TransactionType: "CustomerPayBillOnline",
        Amount: _BAmount,
        PartyA: _BPhone,
        PartyB: _shortCode,
        PhoneNumber: _BPhone,
        CallBackURL: `${CALLBACK_BASE}/stk_register_callback`,
        AccountReference: `Yaya Bureau App ${_BUiD}`,
        TransactionDesc: "Bureau subscription payment",
      },
    },
    async (error, response, body) => {
      if (error) {
        console.error("Bureau STK error:", error);
        return res.status(500).json({ error: "STK request failed" });
      }

      console.log("Bureau STK response:", body);

      // 🔥 Persist context
      const checkoutId = body?.CheckoutRequestID;
      if (checkoutId) {
        try {
          await redis.setEx(
            `stk:context:${checkoutId}`,
            600,
            JSON.stringify({
              uid: _BUiD,
              name: _BfName,
              plan_days: _planDays,
              user_type: "BUREAU",
              amount: _BAmount,
            })
          );
        } catch (e) {
          console.warn("Failed to cache bureau STK context:", e.message);
        }
      }

      return res.status(200).json(body);
    }
  );
});

/* ═══════════════════════════════════════════════════════════════
   BUREAU STK CALLBACK
   ═══════════════════════════════════════════════════════════════ */
app.post("/stk_register_callback", _urlencoded, async (req, res) => {
  console.log("Received bureau callback:", JSON.stringify(req.body));

  try {
    const callback = req.body?.Body?.stkCallback;

    if (!callback || callback.ResultCode !== 0) {
      return res.status(200).json({ message: "Payment failed" });
    }

    const checkoutId = callback.CheckoutRequestID;

    let ctx = null;
    try {
      const cached = await redis.get(`stk:context:${checkoutId}`);
      if (cached) ctx = JSON.parse(cached);
    } catch (e) {
      console.warn("Failed to read bureau STK context:", e.message);
    }

    const uid = ctx?.uid;
    const planDays = ctx?.plan_days || 30;
    const bureauName = ctx?.name || "Bureau";

    if (!uid) {
      console.error("No STK context for bureau checkout:", checkoutId);
      return res.status(200).json({ message: "Missing context" });
    }

    const { mpesa_receipt, amount } = parseMpesaCallback(callback);

    if (!mpesa_receipt) {
      return res.status(200).json({ message: "Invalid callback data" });
    }

    /* 🔒 Prevent duplicates */
    const exists = await new Promise((resolve, reject) => {
      db.query(
        `SELECT id FROM yaya_payments WHERE mpesa_receipt = ?`,
        [mpesa_receipt],
        (err, rows) => (err ? reject(err) : resolve(rows.length))
      );
    });

    if (exists) {
      return res.status(200).json({ message: "Already processed" });
    }

    /* ✅ Insert payment with plan_days */
    await new Promise((resolve, reject) => {
      db.query(
        `
        INSERT INTO yaya_payments
        (uid, user_type, mpesa_receipt, amount, plan_days, payment_date)
        VALUES (?, 'BUREAU', ?, ?, ?, NOW())
        `,
        [uid, mpesa_receipt, amount, planDays],
        (err) => (err ? reject(err) : resolve())
      );
    });

    /* ✅ Update bureau with extended access */
    await new Promise((resolve, reject) => {
      db.query(
        `
        UPDATE yaya_bureaus
        SET
          mpesa_receipt = ?,
          payment_date = NOW(),
          access_expires_at = DATE_ADD(NOW(), INTERVAL ? DAY),
          subscription_status = 'ACTIVE',
          user_state = 'ACTIVE'
        WHERE user_id = ?
        `,
        [mpesa_receipt, planDays, uid],
        (err) => (err ? reject(err) : resolve())
      );
    });

    /* ✅ Notify */
    try {
      await sendNotification({
        user_uid: uid,
        user_type: "BUREAU",
        title: "Payment Successful",
        message: `Hi ${bureauName}, your payment of KES ${amount} was successful. Your access has been extended by ${planDays} days.`,
        type: "PAYMENT",
      });
    } catch (notifyErr) {
      console.warn("Bureau notification failed:", notifyErr.message);
    }

    /* 🧹 Clear caches */
    try {
      await redis.del(`bureau:${uid}`);
      await redis.del(`bureau:${uid}:payment_status`);
      await redis.del(`stk:context:${checkoutId}`);
    } catch (_) {}

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error("❌ Bureau payment error:", error);
    return res.status(200).json({ success: false });
  }
});

/* ═══════════════════════════════════════════════════════════════
   BUREAU STK QUERY
   ═══════════════════════════════════════════════════════════════ */
app.post("/stk_register/query", access, _urlencoded, function (req, res) {
  const _checkoutRequestId = req.body.checkoutRequestId;

  if (!_checkoutRequestId) {
    return res.status(400).json({ error: "Missing checkoutRequestId" });
  }

  const auth = "Bearer " + req.access_token;
  const endpoint = "https://api.safaricom.co.ke/mpesa/stkpushquery/v1/query";
  const _shortCode = process.env.PROD_SHORTCODE_DEV;
  const _passKey = process.env.PROD_PASSKEY_DEV;

  const timeStamp = new Date()
    .toISOString()
    .replace(/[^0-9]/g, "")
    .slice(0, -3);
  const password = Buffer.from(
    `${_shortCode}${_passKey}${timeStamp}`
  ).toString("base64");

  request(
    {
      url: endpoint,
      method: "POST",
      headers: { Authorization: auth },
      json: {
        BusinessShortCode: _shortCode,
        Password: password,
        Timestamp: timeStamp,
        CheckoutRequestID: _checkoutRequestId,
      },
    },
    function (error, response, body) {
      if (error) {
        console.error("Bureau query error:", error);
        return res.status(500).json({ error: "Query failed" });
      }
      console.log("Bureau query response:", body);
      return res.status(200).json(body);
    }
  );
});

/* ═══════════════════════════════════════════════════════════════
   ACCESS TOKEN ENDPOINT
   ═══════════════════════════════════════════════════════════════ */
app.get("/access_token", access, (req, res) => {
  res.status(200).json({ access_token: req.access_token });
});

/* ═══════════════════════════════════════════════════════════════
   HOME
   ═══════════════════════════════════════════════════════════════ */
app.get("/", (req, res) => {
  res.status(200).send("Hello welcome to Yaya Mpesa API");
});

/* ═══════════════════════════════════════════════════════════════
   LISTEN
   ═══════════════════════════════════════════════════════════════ */
app.listen(port, "0.0.0.0", () => {
  console.log(`Server running on port http://localhost:${port}`);
  console.log(`Callback base: ${CALLBACK_BASE}`);
});

module.exports = app;