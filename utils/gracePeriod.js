exports.isGracePeriodValid = (paymentDate, days = 3) => {
  if (!paymentDate) return false;

  const paidAt = new Date(paymentDate);
  const expiresAt = new Date(paidAt);
  expiresAt.setDate(expiresAt.getDate() + days);

  return new Date() <= expiresAt;
};
