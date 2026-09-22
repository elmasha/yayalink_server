/**
 * Parse pagination + sort + search params from req.query
 */
function parseListQuery(req, options = {}) {
  const {
    allowedSort = ["created_at"],
    defaultSort = "created_at",
    defaultOrder = "DESC",
    maxLimit = 100,
    defaultLimit = 20,
  } = options;

  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(
    maxLimit,
    Math.max(1, parseInt(req.query.limit, 10) || defaultLimit)
  );
  const offset = (page - 1) * limit;

  let sort = req.query.sort || defaultSort;
  if (!allowedSort.includes(sort)) sort = defaultSort;

  let order = String(req.query.order || defaultOrder).toUpperCase();
  if (order !== "ASC" && order !== "DESC") order = defaultOrder;

  const search = req.query.search ? String(req.query.search).trim() : "";

  return { page, limit, offset, sort, order, search };
}

/**
 * Build a WHERE fragment from allowed filters.
 * filters = { column: value | [min, max] | {like: value} }
 */
function buildFilterClauses(filters, allowed) {
  const clauses = [];
  const params = [];

  for (const key of Object.keys(filters)) {
    if (!allowed.includes(key)) continue;

    const value = filters[key];
    if (value === undefined || value === null || value === "") continue;

    // Range: [min, max]
    if (Array.isArray(value) && value.length === 2) {
      const [min, max] = value;
      if (min !== "" && min !== undefined && min !== null) {
        clauses.push(`${key} >= ?`);
        params.push(min);
      }
      if (max !== "" && max !== undefined && max !== null) {
        clauses.push(`${key} <= ?`);
        params.push(max);
      }
      continue;
    }

    // LIKE search
    if (typeof value === "object" && value.like !== undefined) {
      clauses.push(`${key} LIKE ?`);
      params.push(`%${value.like}%`);
      continue;
    }

    // Exact match
    clauses.push(`${key} = ?`);
    params.push(value);
  }

  return { clauses, params };
}

/**
 * Promise wrapper around db.query
 */
function query(sql, params = []) {
  const db = require("../config/db");
  return new Promise((resolve, reject) => {
    db.query(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)));
  });
}

module.exports = {
  parseListQuery,
  buildFilterClauses,
  query,
};