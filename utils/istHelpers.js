/**
 * Shared IST utilities.
 *
 * This module exists to avoid circular dependencies and keep date logic consistent
 * across login window enforcement and login history display.
 */

function toISTParts(date = new Date()) {
  // Convert local Date into consistent IST representation.
  // We do it by shifting milliseconds rather than relying on server timezone.
  const utcMs = date.getTime() + date.getTimezoneOffset() * 60000;
  const istMs = utcMs + 5.5 * 60 * 60000;
  const ist = new Date(istMs);

  return {
    year: ist.getUTCFullYear(),
    monthIndex: ist.getUTCMonth(), // 0-11
    day: ist.getUTCDate(),
    hours: ist.getUTCHours(),
    minutes: ist.getUTCMinutes(),
    seconds: ist.getUTCSeconds(),
  };
}

module.exports = { toISTParts };

