module.exports = {
  userKey: (uid) => `user:${uid}`,
  bureauKey: (uid) => `bureau:${uid}`,
  employerKey: (uid) => `employer:${uid}`,
  candidateKey: (id) => `candidate:${id}`,
  candidatesAvailableKey: () => `candidates:available`,
  candidatesCacheKey: () => `candidates:all`,
  feedbackKey: () => `feedback:all`,
  graceKey: (uid) => `grace:${uid}`,
  notificationKey: (uid) => `notification:${uid}`,
  filterCacheKey: (filters) =>
  `candidates:filter:${JSON.stringify(filters)}`,
};
