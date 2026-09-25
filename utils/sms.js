const axios = require("axios");
const db = require("../config/db");

/* ─────────────────────────────────────────────
   CONFIG
   ───────────────────────────────────────────── */
const AT_API_KEY = process.env.ADVANTA_API_KEY || "";
const AT_PARTNER_ID = process.env.ADVANTA_PARTNER_ID || "";
const AT_SHORTCODE = process.env.ADVANTA_SHORTCODE || "";

const ADVANTA_ENDPOINT =
  process.env.ADVANTA_ENDPOINT ||
  "https://quicksms.advantasms.com/api/services/sendsms/";

// Rate limits per phone
const RATE_LIMITS = {
  perMinute: 1,
  perHour: 5,
  perDay: 20,
};

// Cost estimate per SMS in KES
const COST_PER_SMS = 0.8;

/* ─────────────────────────────────────────────
   PHONE NORMALIZATION
   ───────────────────────────────────────────── */
function normalizePhone(phone) {
  if (!phone) return null;

  let p = String(phone).replace(/\D/g, "");

  if (p.startsWith("0")) {
    p = "254" + p.substring(1);
  }

  if (p.length === 9 && p.startsWith("7")) {
    p = "254" + p;
  }

  if (p.startsWith("254") && p.length === 12) {
    return p;
  }

  return null;
}

/* ─────────────────────────────────────────────
   SUPPRESSION CHECK (STOP keyword)
   ───────────────────────────────────────────── */
function checkSuppression(phone) {
  return new Promise((resolve) => {
    db.query(
      `SELECT id FROM yaya_sms_suppression WHERE phone = ? LIMIT 1`,
      [phone],
      (err, rows) => {
        if (err) {
          console.warn("Suppression check DB error:", err.message);
          return resolve(false); // fail open
        }
        resolve(rows.length > 0);
      }
    );
  });
}

/* ─────────────────────────────────────────────
   RATE LIMIT CHECK
   ───────────────────────────────────────────── */
function checkRateLimit(phone) {
  return new Promise((resolve) => {
    const sinceMinute = new Date(Date.now() - 60 * 1000);
    const sinceHour = new Date(Date.now() - 60 * 60 * 1000);
    const sinceDay = new Date(Date.now() - 24 * 60 * 60 * 1000);

    db.query(
      `SELECT
         SUM(created_at >= ?) AS last_minute,
         SUM(created_at >= ?) AS last_hour,
         SUM(created_at >= ?) AS last_day
       FROM yaya_sms_log
       WHERE phone = ? AND status = 'SENT'`,
      [sinceMinute, sinceHour, sinceDay, phone],
      (err, rows) => {
        if (err) {
          console.warn("SMS rate limit DB error:", err.message);
          return resolve({ ok: true });
        }

        const r = rows[0] || {};
        const lm = Number(r.last_minute) || 0;
        const lh = Number(r.last_hour) || 0;
        const ld = Number(r.last_day) || 0;

        if (lm >= RATE_LIMITS.perMinute)
          return resolve({ ok: false, reason: "per_minute", count: lm });
        if (lh >= RATE_LIMITS.perHour)
          return resolve({ ok: false, reason: "per_hour", count: lh });
        if (ld >= RATE_LIMITS.perDay)
          return resolve({ ok: false, reason: "per_day", count: ld });

        return resolve({ ok: true });
      }
    );
  });
}

/* ─────────────────────────────────────────────
   LOG
   ───────────────────────────────────────────── */
function logSms({
  phone,
  message,
  scenario,
  user_type,
  user_uid,
  provider_ref,
  status,
  error_message,
  cost,
}) {
  return new Promise((resolve) => {
    db.query(
      `INSERT INTO yaya_sms_log
       (phone, message, scenario, user_type, user_uid,
        provider_ref, status, error_message, cost)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [
        phone,
        message,
        scenario,
        user_type || null,
        user_uid || null,
        provider_ref || null,
        status,
        error_message || null,
        cost || null,
      ],
      (err) => {
        if (err) console.warn("SMS log insert failed:", err.message);
        resolve();
      }
    );
  });
}

/* ─────────────────────────────────────────────
   SEND SMS (Advanta) — single attempt, no retry
   ───────────────────────────────────────────── */
async function sendSms({
  phone,
  message,
  scenario,
  user_type = null,
  user_uid = null,
}) {
  const normalized = normalizePhone(phone);

  if (!normalized) {
    await logSms({
      phone: String(phone || "").slice(0, 20),
      message,
      scenario,
      user_type,
      user_uid,
      status: "SKIPPED",
      error_message: "Invalid phone number",
    });
    return { ok: false, reason: "INVALID_PHONE" };
  }

  // Suppression check (STOP keyword)
  const suppressed = await checkSuppression(normalized);
  if (suppressed) {
    await logSms({
      phone: normalized,
      message,
      scenario,
      user_type,
      user_uid,
      status: "SKIPPED",
      error_message: "Phone on suppression list (STOP)",
    });
    return { ok: false, reason: "SUPPRESSED" };
  }

  // Rate limit
  const rl = await checkRateLimit(normalized);
  if (!rl.ok) {
    await logSms({
      phone: normalized,
      message,
      scenario,
      user_type,
      user_uid,
      status: "RATE_LIMITED",
      error_message: `Rate limit exceeded: ${rl.reason}`,
    });
    return { ok: false, reason: "RATE_LIMITED", detail: rl.reason };
  }

  if (!AT_API_KEY || !AT_PARTNER_ID || !AT_SHORTCODE) {
    await logSms({
      phone: normalized,
      message,
      scenario,
      user_type,
      user_uid,
      status: "SKIPPED",
      error_message: "Advanta credentials not configured",
    });
    return { ok: false, reason: "NOT_CONFIGURED" };
  }

  try {
    const response = await axios.post(
      ADVANTA_ENDPOINT,
      {
        apikey: AT_API_KEY,
        partnerID: AT_PARTNER_ID,
        message,
        shortcode: AT_SHORTCODE,
        mobile: normalized,
      },
      {
        headers: { "Content-Type": "application/json" },
        timeout: 15000,
      }
    );

    const body = response.data || {};
    const firstPayload = Array.isArray(body.payload) ? body.payload[0] : {};
    const responseCode = Number(firstPayload["response-code"] || body.code || 0);
    const isSuccess = responseCode === 200 || body.success === true;

    if (isSuccess) {
      await logSms({
        phone: normalized,
        message,
        scenario,
        user_type,
        user_uid,
        provider_ref: String(firstPayload.messageid || ""),
        status: "SENT",
        cost: COST_PER_SMS,
      });
      console.log(`✅ SMS sent to ${normalized} [${scenario}]`);
      return { ok: true, ref: firstPayload.messageid };
    }

    const errMsg =
      firstPayload["response-description"] ||
      body.message ||
      "Advanta rejected the message";

    await logSms({
      phone: normalized,
      message,
      scenario,
      user_type,
      user_uid,
      status: "FAILED",
      error_message: errMsg.slice(0, 255),
    });

    console.warn(`⚠️ SMS failed to ${normalized}: ${errMsg}`);
    return { ok: false, reason: "PROVIDER_FAILED", detail: errMsg };
  } catch (err) {
    const msg =
      err.response && err.response.data
        ? JSON.stringify(err.response.data).slice(0, 255)
        : err.message;

    await logSms({
      phone: normalized,
      message,
      scenario,
      user_type,
      user_uid,
      status: "FAILED",
      error_message: msg,
    });

    console.error("SMS send error:", msg);
    return { ok: false, reason: "EXCEPTION", detail: msg };
  }
}

/* ─────────────────────────────────────────────
   SCENARIO 1 — CANDIDATE UPLOADED
   ───────────────────────────────────────────── */
async function smsCandidateUploaded({ candidate_name, phone, bureau_name }) {
  const message =
    `Hi ${candidate_name || "there"}, ${bureau_name || "A bureau"} has listed you on YayaLink — ` +
    `a platform connecting house help with employers. ` +
    `Employers may contact you about work. ` +
    `Reply STOP to opt out.`;

  return sendSms({
    phone,
    message,
    scenario: "CANDIDATE_UPLOAD",
    user_type: "CANDIDATE",
  });
}

/* ─────────────────────────────────────────────
   SCENARIO 2 — CANDIDATE SELECTED
   ───────────────────────────────────────────── */
async function smsCandidateSelected({ candidate_name, phone }) {
  const message =
    `Hi ${candidate_name || "there"}, an employer on YayaLink is interested in your profile. ` +
    `Log in or ask your bureau for details.`;

  return sendSms({
    phone,
    message,
    scenario: "SELECTION",
    user_type: "CANDIDATE",
  });
}

/* ─────────────────────────────────────────────
   SCENARIO 4 — SUBSCRIPTION GRACE
   Only fires once per grace period.
   Caller must pass `grace_started_at` from the subscription row.
   ───────────────────────────────────────────── */
async function smsSubscriptionGrace({
  name,
  phone,
  user_type,
  days_left,
  user_uid,
  grace_started_at,
}) {
  // Guard: caller must supply grace_started_at
  if (!grace_started_at) {
    console.warn(
      "smsSubscriptionGrace: missing grace_started_at — skipping to avoid duplicate sends"
    );
    return { ok: false, reason: "MISSING_GRACE_ANCHOR" };
  }

  // Dedup: has a grace SMS already been sent for THIS grace period?
  const alreadySent = await new Promise((resolve) => {
    db.query(
      `SELECT id FROM yaya_sms_log
       WHERE user_uid = ?
         AND scenario = 'SUBSCRIPTION_GRACE'
         AND created_at >= ?
       LIMIT 1`,
      [user_uid, grace_started_at],
      (err, rows) => {
        if (err) {
          console.warn("Grace dedup check failed:", err.message);
          return resolve(false);
        }
        resolve(rows.length > 0);
      }
    );
  });

  if (alreadySent) {
    console.log(
      `⏭ Grace SMS already sent for uid=${user_uid} since ${grace_started_at}`
    );
    return { ok: false, reason: "ALREADY_SENT_FOR_PERIOD" };
  }

  const message =
    `Hi ${name || "there"}, your YayaLink ${user_type === "BUREAU" ? "bureau" : "employer"} subscription has entered grace. ` +
    `You have ${days_left} day${days_left === 1 ? "" : "s"} before access is locked. ` +
    `Renew at yayalink.com.`;

  return sendSms({
    phone,
    message,
    scenario: "SUBSCRIPTION_GRACE",
    user_type,
    user_uid,
  });
}

/* ─────────────────────────────────────────────
   OPTIONAL — SCENARIO 5: CANDIDATE DISCHARGED
   Only use this if discharge can happen automatically
   (i.e. the candidate may not know). If discharge is always
   employer-initiated, prefer an in-app notification instead.
   ───────────────────────────────────────────── */
async function smsCandidateDischarged({
  candidate_name,
  phone,
  employer_name,
}) {
  const message =
    `Hi ${candidate_name || "there"}, your placement with ` +
    `${employer_name || "your employer"} on YayaLink has ended. ` +
    `Your profile is active again and employers can now see you. ` +
    `Reply STOP to opt out.`;

  return sendSms({
    phone,
    message,
    scenario: "CANDIDATE_DISCHARGED",
    user_type: "CANDIDATE",
  });
}

module.exports = {
  sendSms,
  smsCandidateUploaded,
  smsCandidateSelected,
  smsSubscriptionGrace,
  smsCandidateDischarged, // optional — only call if you actually want it
  normalizePhone,
  checkSuppression,
};