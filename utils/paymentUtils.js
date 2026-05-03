exports.getDaysRemaining = (paymentDate, graceDays = 3) => {
  const start = new Date(paymentDate);
  const now = new Date();

  const expiry = new Date(start);
  expiry.setDate(expiry.getDate() + graceDays);

  const diffMs = expiry - now;
  const days = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

  return days > 0 ? days : 0;
};
