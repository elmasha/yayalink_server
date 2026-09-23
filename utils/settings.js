const db = require("../config/db");
const redis = require("../config/redis");

const CACHE_KEY = "app:settings";
const CACHE_TTL = 300;

const PLANS = {
  EMPLOYER: [3, 7, 30],
  BUREAU: [30],
};

async function getSettings() {
  try {
    const cached = await redis.get(CACHE_KEY);
    if (cached) return JSON.parse(cached);
  } catch (e) {}

  const rows = await new Promise((resolve, reject) => {
    db.query(`SELECT \`key\`, \`value\` FROM yaya_settings`, (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });

  const settings = {};
  for (const row of rows) {
    const n = Number(row.value);
    settings[row.key] = Number.isFinite(n) && row.value !== "" ? n : row.value;
  }

  try {
    await redis.setEx(CACHE_KEY, CACHE_TTL, JSON.stringify(settings));
  } catch (e) {}

  return settings;
}

async function getPlanFee(userType, days) {
  const type = userType === "BUREAU" ? "bureau" : "employer";
  if (type === "bureau") days = 30;

  const settings = await getSettings();
  const key = `${type}_plan_${days}_fee`;
  const defaults = { employer: { 3: 150, 7: 300, 30: 900 }, bureau: { 30: 1000 } };

  return settings[key] !== undefined ? Number(settings[key]) : (defaults[type][days] || 0);
}

async function getPlans(userType) {
  const type = userType === "BUREAU" ? "BUREAU" : "EMPLOYER";
  const settings = await getSettings();
  const planDays = PLANS[type] || [30];

  return planDays.map((days) => ({
    days,
    fee: Number(settings[`${type.toLowerCase()}_plan_${days}_fee`]) || 0,
  }));
}

async function clearSettingsCache() {
  try { await redis.del(CACHE_KEY); } catch (e) {}
}

module.exports = { getSettings, getPlanFee, getPlans, clearSettingsCache, PLANS };