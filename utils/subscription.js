// utils/subscription.js

const GRACE_DAYS = 3;
const TRIAL_DAYS = 14;
const SUBSCRIPTION_DAYS = 30;

/**
 * Compute the subscription state for a bureau row.
 * Returns { status, daysLeft, expiresAt, isActive, isGrace, isExpired }
 */
function computeBureauStatus(bureau) {
  if (!bureau) {
    return {
      status: "UNKNOWN",
      daysLeft: 0,
      expiresAt: null,
      isActive: false,
      isGrace: false,
      isExpired: true,
    };
  }

  const now = new Date();

  const trialEnds = bureau.trial_ends_at ? new Date(bureau.trial_ends_at) : null;
  const accessEnds = bureau.access_expires_at
    ? new Date(bureau.access_expires_at)
    : null;

  // Paid period takes priority
  if (accessEnds) {
    const graceEnd = new Date(accessEnds);
    graceEnd.setDate(graceEnd.getDate() + GRACE_DAYS);

    if (now <= accessEnds) {
      const daysLeft = Math.ceil((accessEnds - now) / (1000 * 60 * 60 * 24));
      return {
        status: "ACTIVE",
        daysLeft,
        expiresAt: accessEnds,
        isActive: true,
        isGrace: false,
        isExpired: false,
      };
    }

    if (now <= graceEnd) {
      const graceLeft = Math.ceil((graceEnd - now) / (1000 * 60 * 60 * 24));
      return {
        status: "GRACE",
        daysLeft: graceLeft,
        expiresAt: graceEnd,
        isActive: true,
        isGrace: true,
        isExpired: false,
      };
    }

    return {
      status: "EXPIRED",
      daysLeft: 0,
      expiresAt: accessEnds,
      isActive: false,
      isGrace: false,
      isExpired: true,
    };
  }

  // Trial period
  if (trialEnds) {
    const graceEnd = new Date(trialEnds);
    graceEnd.setDate(graceEnd.getDate() + GRACE_DAYS);

    if (now <= trialEnds) {
      const daysLeft = Math.ceil((trialEnds - now) / (1000 * 60 * 60 * 24));
      return {
        status: "TRIAL",
        daysLeft,
        expiresAt: trialEnds,
        isActive: true,
        isGrace: false,
        isExpired: false,
      };
    }

    if (now <= graceEnd) {
      const graceLeft = Math.ceil((graceEnd - now) / (1000 * 60 * 60 * 24));
      return {
        status: "GRACE",
        daysLeft: graceLeft,
        expiresAt: graceEnd,
        isActive: true,
        isGrace: true,
        isExpired: false,
      };
    }

    return {
      status: "EXPIRED",
      daysLeft: 0,
      expiresAt: trialEnds,
      isActive: false,
      isGrace: false,
      isExpired: true,
    };
  }

  return {
    status: "EXPIRED",
    daysLeft: 0,
    expiresAt: null,
    isActive: false,
    isGrace: false,
    isExpired: true,
  };
}

module.exports = {
  computeBureauStatus,
  GRACE_DAYS,
  TRIAL_DAYS,
  SUBSCRIPTION_DAYS,
};