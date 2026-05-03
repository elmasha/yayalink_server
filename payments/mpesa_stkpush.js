const express = require("express");
const request = require("request");
const bodyParser = require("body-parser");
const app = express();
const cors = require("cors");
const db = require("../config/db");
const redis = require("../config/redis")
const { parseMpesaCallback } = require("../utils/mpesa");
const { sendNotification } = require("../utils/notify");



///-----Port-----///
const port = process.env.PORT1 || 3000;
const _urlencoded = express.urlencoded({ extended: false });
app.use(cors());
app.use(express.json());
app.use(express.static("public"));

///----FireStore ----//




//----AllOW ACCESS -----//
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

let _checkoutRequestId, _UserID, _Username,plan_days;

///------STK push Activate------/////

app.post("/stk", access, _urlencoded, function (req, res) {
  let _phoneNumber = req.body.phone;
  let _Amount = req.body.amount;
  _UserID = req.body.user_id;
  _Username = req.body.User_name;
  plan_days = req.body.plan_days;

  let endpoint = "https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest";
  let auth = "Bearer " + req.access_token;

  let _shortCode = process.env.MP_SHORTCODE_DEV;
  let _passKey = process.env.MP_PASSKEY_DEV;

  const timeStamp = new Date()
    .toISOString()
    .replace(/[^0-9]/g, "")
    .slice(0, -3);
  const password = Buffer.from(`${_shortCode}${_passKey}${timeStamp}`).toString(
    "base64"
  );

  request(
    {
      url: endpoint,
      method: "POST",
      headers: {
        Authorization: auth,
      },

      json: {
        BusinessShortCode: _shortCode,
        Password: password,
        Timestamp: timeStamp,
        TransactionType: "CustomerPayBillOnline",
        Amount: _Amount,
        PartyA: _phoneNumber,
        PartyB: _shortCode, //Till  No.
        PhoneNumber: _phoneNumber,
        CallBackURL: "https://yayalinkserver-production-4990.up.railway.app/api/payments/stk_callback",
        AccountReference: "Yaya Nanies App",
        TransactionDesc: "_transDec",
      },
    },
    (error, response, body) => {
      if (error) {
        console.log(error);
      return  res.status(404).json(error);
      } else {
        console.log(body);
      return  res.status(200).json(body);
        
      }
    }
  );
});
//----MIDDLEWARE---///
const middleware = (req, res, next) => {
  req.checkoutID = _checkoutRequestId;
  req.uid = _UserID;
  req.plan_days = plan_days;
  req.name = _Username;
  next();
};

///------STK_CALLBACK-----///
app.post("/stk_callback", _urlencoded, middleware, async (req, res) => {
  console.log("Received STK callback:", req.body);
  try {
    const callback = req.body?.Body?.stkCallback;

    if (!callback || callback.ResultCode !== 0) {
      return res.status(200).json({ message: "Payment failed" });
    }

    const { mpesa_receipt, amount } = parseMpesaCallback(callback);

    const uid = _UserID;              // ✅ FIXED
    const planDays = plan_days;   // 3 | 7 | 30

    if (!uid || !mpesa_receipt || !planDays) {
      return res.status(200).json({ message: "Invalid callback data" });
    }

    /* 🔒 Prevent duplicate payment */
    const existing = await new Promise((resolve, reject) => {
      db.query(
        `SELECT id FROM yaya_payments WHERE mpesa_receipt=? LIMIT 1`,
        [mpesa_receipt],
        (err, rows) => (err ? reject(err) : resolve(rows))
      );
    });

    if (existing.length) {
      return res.status(200).json({ message: "Already processed" });
    }

    /* ✅ Insert payment record */
    await new Promise((resolve, reject) => {
      db.query(
        `
        INSERT INTO yaya_payments
        (uid, user_type, mpesa_receipt, amount, payment_date)
        VALUES (?, 'EMPLOYER', ?, ?, NOW())
        `,
        [uid, mpesa_receipt, amount],
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
    const name = _Username;
    const message = `Hi ${name}, your payment of KES ${amount} was successful. Your access has been updated.`;
    await sendNotification({
      user_uid: uid,
      user_type: "EMPLOYER",
      title: "Payment Successful",
      message,
      type: "PAYMENT",
    });


    /* 🧹 Clear caches */
    await redis.del(`employer:access:${uid}`);
    await redis.del(`employer:payment:${uid}`);

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error("❌ Employer payment callback error:", error);
    return res.status(200).json({ success: false });
  }
});



///----STK QUERY ---//
app.post("/stk/query", access, _urlencoded, function (req, res, next) {
  let _checkoutRequestId = req.body.checkoutRequestId;

  auth = "Bearer " + req.access_token;

  let endpoint = "https://sandbox.safaricom.co.ke/mpesa/stkpushquery/v1/query";
  let _shortCode = process.env.MP_SHORTCODE_DEV;
  let _passKey = process.env.MP_PASSKEY_DEV;

  const timeStamp = new Date()
    .toISOString()
    .replace(/[^0-9]/g, "")
    .slice(0, -3);
  const password = Buffer.from(`${_shortCode}${_passKey}${timeStamp}`).toString(
    "base64"
  );

  request(
    {
      url: endpoint,
      method: "POST",
      headers: {
        Authorization: auth,
      },

      json: {
        BusinessShortCode: _shortCode,
        Password: password,
        Timestamp: timeStamp,
        CheckoutRequestID: _checkoutRequestId,
      },
    },
    function (error, response, body) {
      if (error) {
        console.log(error);
        res.status(404).json(body);
      } else {
        res.status(200).json(body);
        console.log(body);
        next();
      }
    }
  );
});

///-------  Stk Registration-----////
let _BfName,
  _BureauImage,
  _BureauName,
  _BIdNo,
  _BBuilding,
  _BStreetName,
  _BCity,
  _BCounty,
  _BEmail,
  _BBox,
  _BPostalCode,
  _BPhone,
  _BAmount,
  _BUiD;
let _CheckoutRequestId;

app.post("/stk_register", access, _urlencoded, function (req, res) {
  _BPhone = req.body.phone;
  _BAmount = req.body.amount;
  _BUiD = req.body.user_id;
  _BfName = req.body.User_name;

  let endpoint = "https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest";
  let auth = "Bearer " + req.access_token;

  let _shortCode = "4087943";
  let _passKey =
    "bb2724f53956f05ca6772b8a79e193c88953048d221b8f4f47d96c9b8f641dbb";

  const timeStamp = new Date()
    .toISOString()
    .replace(/[^0-9]/g, "")
    .slice(0, -3);
  const password = Buffer.from(`${_shortCode}${_passKey}${timeStamp}`).toString(
    "base64"
  );

  request(
    {
      url: endpoint,
      method: "POST",
      headers: {
        Authorization: auth,
      },

      json: {
        BusinessShortCode: _shortCode,
        Password: password,
        Timestamp: timeStamp,
        TransactionType: "CustomerPayBillOnline",
        Amount: _BAmount,
        PartyA: _BPhone,
        PartyB: _shortCode, //Till  No.
        PhoneNumber: _BPhone,
        CallBackURL: "https://yayalinkserver-production-4990.up.railway.app/api/payments/stk_callback2",
        AccountReference: "Yaya Bureau App ",
        TransactionDesc: "_transDec",
      },
    },
    (error, response, body) => {
      if (error) {
        console.log(error);
       return res.status(404).json(error);
      } else {
        console.log(body);
      return  res.status(200).json(body);
       
      }
    }
  );
});
//----MIDDLEWARE---///
const middleware2 = (req, res, next) => {
  req.checkoutID = _CheckoutRequestId;
  req.uid = _BUiD;
  req.name = _BfName;
  next();
};

///------STK_CALLBACK-----///
app.post("/stk_callback2", _urlencoded, middleware2, async (req, res) => {
  try {
    const callback = req.body.Body.stkCallback;

    if (callback.ResultCode !== 0) {
      return res.status(200).json({ message: "Payment failed" });
    }

    const { mpesa_receipt, amount } = parseMpesaCallback(callback);
    const uid = req.uid;

    if (!uid || !mpesa_receipt) {
      return res.status(200).json({ message: "Invalid callback data" });
    }

    /* 🔒 Prevent duplicates */
    const exists = await new Promise((resolve, reject) => {
      db.query(
        `SELECT id FROM yaya_payments WHERE mpesa_receipt=?`,
        [mpesa_receipt],
        (err, rows) => (err ? reject(err) : resolve(rows.length))
      );
    });

    if (exists) {
      return res.status(200).json({ message: "Already processed" });
    }

    /* ✅ Insert payment */
    await new Promise((resolve, reject) => {
      db.query(
        `
        INSERT INTO yaya_payments
        (uid, user_type, mpesa_receipt, amount, payment_date)
        VALUES (?, 'BUREAU', ?, ?, NOW())
        `,
        [uid, mpesa_receipt, amount],
        (err) => (err ? reject(err) : resolve())
      );
    });

    /* ✅ Update bureau */
    await new Promise((resolve, reject) => {
      db.query(
        `
        UPDATE yaya_bureaus
        SET mpesa_receipt=?, payment_date=NOW()
        WHERE user_id=?
        `,
        [mpesa_receipt, uid],
        (err) => (err ? reject(err) : resolve())
      );
    });

    await redis.del(`bureau:${uid}`);

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error("❌ Bureau payment error:", error);
    return res.status(200).json({ success: false });
  }
});

///----STK QUERY ---//
app.post("/stk/query2", access, _urlencoded, function (req, res, next) {
  let _checkoutRequestId = req.body.checkoutRequestId;

  auth = "Bearer " + req.access_token;

  let endpoint = "https://sandbox.safaricom.co.ke/mpesa/stkpushquery/v1/query";
  let _shortCode = process.env.MP_SHORTCODE_DEV;
  let _passKey = process.env.MP_PASSKEY_DEV;

  const timeStamp = new Date()
    .toISOString()
    .replace(/[^0-9]/g, "")
    .slice(0, -3);
  const password = Buffer.from(`${_shortCode}${_passKey}${timeStamp}`).toString(
    "base64"
  );

  request(
    {
      url: endpoint,
      method: "POST",
      headers: {
        Authorization: auth,
      },

      json: {
        BusinessShortCode: _shortCode,
        Password: password,
        Timestamp: timeStamp,
        CheckoutRequestID: _checkoutRequestId,
      },
    },
    function (error, response, body) {
      if (error) {
        console.log(error);
        res.status(404).json(body);
      } else {
        res.status(200).json(body);
        console.log(body);
        next();
      }
    }
  );
});

////-----ACCESS_TOKEN-----
app.get("/access_token", access, (req, res) => {
  res.status(200).json({ access_token: req.access_token });
});

let consumer_key = process.env.MP_CONSUMER_KEY_DEV;
let consumer_secret = process.env.MP_SECRET_KEY_DEV;
function access(res, req, next) {
  let endpoint =
    "https://api.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials";
  let auth = new Buffer.from(
    consumer_key + ":" + consumer_secret
  ).toString("base64");

  request(
    {
      url: endpoint,
      headers: {
        Authorization: "Basic " + auth,
      },
    },
    (error, response, body) => {
      if (error) {
        console.log(error);
      } else {
        res.access_token = JSON.parse(body).access_token;
        console.log(body);
        next();
      }
    }
  );
}
///----END ACCESS_TOKEN---

/////-----Home ------/////
app.get("/", (req, res, next) => {
  res.status(200).send("Hello welcome to Yaya Mpesa API");
});

//-- listen
app.listen(port ,'0.0.0.0', (error) => {
  if (error) {
  } else {
    console.log(`Server running on port http://localhost:${port}`);
  }
});


module.exports = app;