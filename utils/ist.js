/**
 * IST (Indian Standard Time) utilities.
 *
 * Note on correctness:
 * The backend must enforce payment windows and monthly quota rules using
 * a consistent IST interpretation, independent from client timezone.
 */

// IST = UTC + 05:30
function toISTParts(date = new Date()) {
  // Convert local Date into a consistent IST representation.
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

/**
 * Enforces allowed payment time window: 10:00 AM–11:00 AM IST.
 *
 * Boundary policy:
 * - Start time is inclusive (>= 10:00:00)
 * - End time is exclusive (< 11:00:00)
 */
function isWithinPaymentWindowIST(date = new Date()) {
  const { hours, minutes, seconds } = toISTParts(date);
  const totalSeconds = hours * 3600 + minutes * 60 + seconds;

  const start = 10 * 3600; // 10:00:00
  const end = 11 * 3600; // 11:00:00 (exclusive)

  return totalSeconds >= start && totalSeconds < end;
}

/**
 * Returns the current IST calendar month as an instant range.
 *
 * Output:
 * - start: inclusive
 * - endExclusive: exclusive
 */
function getISTMonthRange(now = new Date()) {
  const { year, monthIndex } = toISTParts(now);

  // Build month range in IST using UTC-based construction and then shifting.
  const startUTC = Date.UTC(year, monthIndex, 1, 0, 0, 0);
  const nextMonthUTC = Date.UTC(year, monthIndex + 1, 1, 0, 0, 0);

  // Convert those instants from IST to actual UTC instants by subtracting 5:30.
  const startISTAsUTC = startUTC - 5.5 * 60 * 60000;
  const nextMonthISTAsUTC = nextMonthUTC - 5.5 * 60 * 60000;

  return {
    start: new Date(startISTAsUTC),
    endExclusive: new Date(nextMonthISTAsUTC),
  };
}

module.exports = { isWithinPaymentWindowIST, getISTMonthRange };


