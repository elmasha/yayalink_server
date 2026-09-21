const redis = require("../config/redis");

/**
 * Delete all Redis keys matching a pattern using SCAN (non-blocking).
 * Safe for production — SCAN iterates in small batches instead of
 * blocking the server like KEYS does.
 *
 * Handles both node-redis v4 (object reply) and v3 (array reply).
 *
 * @param {string} pattern - e.g. "candidates:filter:*"
 * @returns {Promise<number>} number of keys deleted
 */
async function deleteKeysByPattern(pattern) {
  let cursor = "0";
  let deleted = 0;

  try {
    do {
      const reply = await redis.scan(cursor, {
        MATCH: pattern,
        COUNT: 100,
      });

      // node-redis v4 returns { cursor, keys }
      // node-redis v3 returns [cursor, keys]
      let nextCursor;
      let keys;

      if (Array.isArray(reply)) {
        nextCursor = reply[0];
        keys = reply[1] || [];
      } else {
        nextCursor = reply.cursor;
        keys = reply.keys || [];
      }

      cursor = String(nextCursor);

      if (keys.length > 0) {
        await redis.del(keys);
        deleted += keys.length;
      }
    } while (cursor !== "0");
  } catch (err) {
    console.warn(`deleteKeysByPattern(${pattern}) failed:`, err.message);
  }

  return deleted;
}

module.exports = { deleteKeysByPattern };