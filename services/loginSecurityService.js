const crypto = require("crypto");

const LoginHistory = require("../Model/LoginHistory");
const LoginOtpVerification = require("../Model/LoginOtpVerification");

const { badRequest, forbidden, internalServerError } = require("../utils/httpErrors");
const { toISTParts } = require("../utils/istHelpers");

// OTP secret HMAC hashing is used (see passwordRecoveryService.js for the same approach).

/**
 * Browser detection (best-effort heuristics).
 *
 * NOTE: This is not perfect; it’s meant to satisfy business logic requirements.
 */
function detectBrowser(userAgent = "") {
  const ua = String(userAgent);

  if (/Edg\//i.test(ua)) return { browserType: "Google Chrome", browserVersion: "" };
  if (/Chrome\//i.test(ua) && !/OPR\//i.test(ua)) {
    // version after Chrome/
    const m = ua.match(/Chrome\/(\d+\.\d+\.\d+\.\d+|\d+\.\d+\.\d+|\d+\.\d+|\d+)/i);
    return { browserType: "Google Chrome", browserVersion: m ? m[1] : "" };
  }

  // Firefox, Safari, etc.
  if (/Firefox\//i.test(ua)) {
    const m = ua.match(/Firefox\/(\d+\.\d+)/i);
    return { browserType: "Firefox", browserVersion: m ? m[1] : "" };
  }

  if (/Safari\//i.test(ua) && !/Chrome\//i.test(ua)) {
    const m = ua.match(/Version\/(\d+\.\d+)/i);
    return { browserType: "Safari", browserVersion: m ? m[1] : "" };
  }

  return { browserType: "Unknown", browserVersion: "" };
}

/**
 * Device type detection based on common UA tokens.
 *
 * Returns one of: Desktop, Laptop, Tablet, Mobile.
 */
function detectDeviceType(userAgent = "") {
  const ua = String(userAgent);

  // Tablet heuristics
  if (/iPad|Tablet|PlayBook|Silk\//i.test(ua)) return "Tablet";

  // Mobile heuristics
  if (/Mobile|Android|iPhone|iPod|IEMobile|BlackBerry|Opera Mini/i.test(ua)) return "Mobile";

  // Laptop/desktop heuristics (very imperfect)
  if (/Windows|Macintosh|Linux/i.test(ua)) {
    if (/Intel\sCore|X11|Ubuntu|Mac OS X/i.test(ua)) return "Laptop";
    return "Desktop";
  }

  return "Unknown";
}

function detectOperatingSystem(userAgent = "") {
  const ua = String(userAgent);
  if (/Windows NT/i.test(ua)) return "Windows";
  if (/Mac OS X/i.test(ua) || /Macintosh/i.test(ua)) return "macOS";
  if (/Android/i.test(ua)) return "Android";
  if (/iPhone|iPad|iPod/i.test(ua)) return "iOS";
  if (/Linux/i.test(ua)) return "Linux";
  return "Unknown";
}

function extractDeviceName(userAgent = "") {
  // Best effort: keep short tokens.
  const ua = String(userAgent);
  const m = ua.match(/(iPhone|iPad|SM-[A-Za-z0-9]+|Pixel\s?\d+|Redmi\s?\d+|Moto\s?\d+|OnePlus\s?\d+)/i);
  return m ? m[1] : "";
}

function getDeviceNetworkIp(req) {
  // If behind proxy, X-Forwarded-For might be present.
  const xff = req.headers["x-forwarded-for"];
  if (xff && typeof xff === "string") {
    return xff.split(",")[0].trim();
  }
  return req.ip || "";
}

function formatLoginDateTimeIST(date = new Date()) {
  // Use IST parts to compute calendar date/time in IST.
  const { year, monthIndex, day, hours, minutes, seconds } = toISTParts(date);
  const loginDate = `${year}-${String(monthIndex + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const loginTime = `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  return { loginDate, loginTime };
}

const {
  ENABLE_CHROME_OTP_POLICY,
  ENABLE_MOBILE_TIME_POLICY,
  MOBILE_ALLOWED_START_HOUR_IST,
  MOBILE_ALLOWED_END_HOUR_IST,
  MOBILE_ALLOWED_START_MINUTE_IST,
  MOBILE_ALLOWED_END_MINUTE_IST,
} = require("../config/loginSecurityPolicies");

/**
 * Mobile login restriction: allowed only between a configurable IST window.
 *
 * Policy: inclusive start, exclusive end.
 */
function isMobileAllowedNowIST(date = new Date()) {
  if (!ENABLE_MOBILE_TIME_POLICY) return true;

  const { hours, minutes, seconds } = toISTParts(date);
  const totalSeconds = hours * 3600 + minutes * 60 + seconds;

  const start =
    MOBILE_ALLOWED_START_HOUR_IST * 3600 + MOBILE_ALLOWED_START_MINUTE_IST * 60;
  const end = MOBILE_ALLOWED_END_HOUR_IST * 3600 + MOBILE_ALLOWED_END_MINUTE_IST * 60;

  return totalSeconds >= start && totalSeconds < end;
}

function isChromeOtpPolicyEnabled() {
  return ENABLE_CHROME_OTP_POLICY;
}


const OTP_LENGTH = 6;
const OTP_TTL_MS = 5 * 60 * 1000;
const OTP_RESEND_COOLDOWN_MS = 60 * 1000;
const MAX_OTP_VERIFY_ATTEMPTS = 5;

function generateOtp() {
  const num = crypto.randomInt(0, 1000000);
  return String(num).padStart(OTP_LENGTH, "0");
}

async function hashOtp(otp) {
  const secret = process.env.OTP_HMAC_SECRET;
  if (!secret) throw internalServerError("OTP_HMAC_SECRET is not set.");

  return crypto.createHmac("sha256", secret).update(String(otp)).digest("hex");
}

async function verifyOtpAgainstHash(otp, otpHash) {
  const computed = await hashOtp(otp);
  return crypto.timingSafeEqual(
    Buffer.from(computed, "hex"),
    Buffer.from(String(otpHash), "hex")
  );
}

function getLoginMethodLabel(loginMethod) {
  if (!loginMethod) return "Unknown";
  if (loginMethod === "password") return "Email & Password";
  if (loginMethod === "google") return "Google Sign-In";
  return "Unknown";
}

/**
 * Create a login attempt document.
 */
async function createLoginAttempt({
  userId,
  fullName,
  emailAddress,
  browserType,
  browserVersion,
  operatingSystem,
  deviceType,
  deviceName,
  ipAddress,
  userAgent,
  loginMethod,
  loginStatus,
  logoutTime,
  sessionDurationSeconds,

  // new spec-friendly fields (optional)
  status,
  failureReason,
  otpVerified,
  firebaseUid,
  name,
  email,
  country,
  city,
}) {
  const { loginDate, loginTime } = formatLoginDateTimeIST(new Date());

  return LoginHistory.create({
    // legacy
    userId,
    fullName: fullName || "",
    emailAddress: emailAddress || "",

    loginDate,
    loginTime,

    browserType: browserType || "",
    browserVersion: browserVersion || "",
    operatingSystem: operatingSystem || "",
    deviceType: deviceType || "Unknown",
    deviceName: deviceName || "",

    ipAddress: ipAddress || "",
    userAgent: userAgent || "",

    loginMethod: getLoginMethodLabel(loginMethod),
    loginStatus,

    logoutTime: logoutTime || null,
    sessionDurationSeconds: sessionDurationSeconds || null,

    // spec
    status,
    failureReason,
    otpVerified: otpVerified ?? false,

    firebaseUid,
    name: name ?? fullName ?? "",
    email: email ?? emailAddress ?? "",

    browser: browserType || "",
    country: country || "",
    city: city || "",
  });
}


async function issueEmailOtpChallenge({ userId, email }) {
  if (!userId) throw badRequest("userId is required");
  if (!email) throw badRequest("email is required");

  const existing = await LoginOtpVerification.findOne({ userId, email }).sort({ createdAt: -1 });
  const now = new Date();

  if (existing?.lastOtpSentAt) {
    const delta = now.getTime() - existing.lastOtpSentAt.getTime();
    if (delta < OTP_RESEND_COOLDOWN_MS) {
      throw forbidden("OTP resend is too frequent. Please try again shortly.");
    }
  }

  // Invalidate previous OTP by consuming
  if (existing && !existing.otpConsumed) {
    existing.otpConsumed = true;
    await existing.save();
  }

  const otp = generateOtp();
  const otpHash = await hashOtp(otp);
  const otpExpiresAt = new Date(Date.now() + OTP_TTL_MS);

  const doc = existing || new LoginOtpVerification({ userId, email });
  doc.otpHash = otpHash;
  doc.otpExpiresAt = otpExpiresAt;
  doc.otpAttempts = 0;
  doc.maxOtpVerifyAttempts = MAX_OTP_VERIFY_ATTEMPTS;
  doc.otpConsumed = false;
  doc.lastOtpSentAt = now;
  await doc.save();

  return { otp, otpExpiresAt };
}

async function verifyEmailOtp({ userId, email, otp }) {
  const record = await LoginOtpVerification.findOne({ userId, email }).sort({ createdAt: -1 });
  if (!record || !record.otpHash) throw badRequest("Invalid or expired OTP.");

  if (record.otpConsumed) throw badRequest("Invalid or expired OTP.");
  if (!record.otpExpiresAt || record.otpExpiresAt.getTime() < Date.now()) {
    throw badRequest("Invalid or expired OTP.");
  }

  if (record.otpAttempts >= record.maxOtpVerifyAttempts) {
    throw forbidden("Too many incorrect OTP attempts. Please request a new OTP.");
  }

  const isCorrect = await verifyOtpAgainstHash(otp, record.otpHash);

  record.otpAttempts = (record.otpAttempts || 0) + 1;

  if (!isCorrect) {
    await record.save();
    throw badRequest("Invalid or expired OTP.");
  }

  record.otpConsumed = true;
  await record.save();

  return { verified: true };
}

module.exports = {
  detectBrowser,
  detectDeviceType,
  detectOperatingSystem,
  extractDeviceName,
  getDeviceNetworkIp,
  formatLoginDateTimeIST,
  isMobileAllowedNowIST,
  isChromeOtpPolicyEnabled,
  createLoginAttempt,
  issueEmailOtpChallenge,
  verifyEmailOtp,
};


