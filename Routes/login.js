const express = require("express");
const router = express.Router();

const asyncHandler = require("../middleware/asyncHandler");
const { verifyFirebaseIdToken } = require("../middleware/authFirebase");

const {
  badRequest,
  forbidden,
  unauthorized,
  internalServerError,
} = require("../utils/httpErrors");

const {
  detectBrowser,
  detectDeviceType,
  detectOperatingSystem,
  extractDeviceName,
  getDeviceNetworkIp,
  isMobileAllowedNowIST,
  isChromeOtpPolicyEnabled,
  createLoginAttempt,
  issueEmailOtpChallenge,
  verifyEmailOtp,
} = require("../services/loginSecurityService");


const { sendLoginOtpEmail } = require("../services/loginEmailOtpService");

const LoginHistory = require("../Model/LoginHistory");

function getLoginMetaFromRequest(req) {
  const userAgent = req.headers["user-agent"] || "";
  const { browserType, browserVersion } = detectBrowser(userAgent);
  const operatingSystem = detectOperatingSystem(userAgent);
  const deviceType = detectDeviceType(userAgent);
  const deviceName = extractDeviceName(userAgent);
  const ipAddress = getDeviceNetworkIp(req);

  return {
    browserType,
    browserVersion,
    operatingSystem,
    deviceType,
    deviceName,
    ipAddress,
    userAgent,
  };
}

router.post(
  "/start",
  verifyFirebaseIdToken,
  asyncHandler(async (req, res) => {
    const userId = req.user.uid;

    const { loginMethod } = req.body || {};

    const fullName = req.user.name || "";
    const emailAddress = req.user.email || "";

    const {
      browserType,
      browserVersion,
      operatingSystem,
      deviceType,
      deviceName,
      ipAddress,
      userAgent,
    } = getLoginMetaFromRequest(req);

    const normalizedLoginMethod =
      loginMethod || (emailAddress ? "Google Sign-In" : "Unknown");

    // Enforce mobile restriction (backend enforced).
    if (deviceType === "Mobile") {

      const allowed = isMobileAllowedNowIST(new Date());
      if (!allowed) {
        // Record BLOCKED attempt (never change response)
        await createLoginAttempt({
          userId,
          firebaseUid: req.user?.uid,
          fullName,
          emailAddress,
          browserType,
          browserVersion,
          operatingSystem,
          deviceType,
          deviceName,
          ipAddress,
          userAgent,
          loginMethod: normalizedLoginMethod,
          loginStatus: "Failed",

          status: "BLOCKED",
          otpVerified: false,
          failureReason: "Outside allowed login time",
        }).catch(() => {});

        // Exact message required by prompt
        throw forbidden("Mobile login is available only between 10:00 AM and 1:00 PM IST.");
      }
    }





        // If Chrome: optionally require an email OTP. This respects the
    // configurable Chrome OTP policy (ENABLE_CHROME_OTP_POLICY), which is
    // opt-in and defaults to OFF so a valid login navigates directly to the
    // dashboard. The mobile time-window check above is applied independently.
    const isChrome = browserType === "Google Chrome";
    const chromeOtpEnabled = isChromeOtpPolicyEnabled();

    if (isChrome && chromeOtpEnabled) {
      if (!emailAddress) {
        // record failed login for audit, but keep existing behavior
        await createLoginAttempt({
          userId,
          firebaseUid: req.user?.uid,
          fullName,
          emailAddress,
          browserType,
          browserVersion,
          operatingSystem,
          deviceType,
          deviceName,
          ipAddress,
          userAgent,
          loginMethod: normalizedLoginMethod,
          loginStatus: "Failed",

          status: "FAILED",
          otpVerified: false,
          failureReason: "Chrome OTP requires email",
        }).catch(() => {});

        throw badRequest("Email address is required for Chrome OTP verification.");
      }


      // Generate OTP + persist
      const { otp } = await issueEmailOtpChallenge({ userId, email: emailAddress });

      // Send OTP email
      await sendLoginOtpEmail({ toEmail: emailAddress, toName: fullName, otp });

      // Record login attempt as OTP required
      await createLoginAttempt({
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
        loginMethod: normalizedLoginMethod === "Google Sign-In" ? "google" : "password",
        loginStatus: "OTP_Required",
      });

      return res.status(200).json({
        success: true,
        otpRequired: true,
        message: "OTP required.",
      });
    }

    // Non-Chrome: grant access directly
    await createLoginAttempt({
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
      loginMethod: normalizedLoginMethod === "Google Sign-In" ? "google" : "password",
      loginStatus: "Successful",
    });

    return res.status(200).json({
      success: true,
      accessGranted: true,
      otpRequired: false,
      message: "Login access granted.",
    });
  })
);

router.post(
  "/verify-otp",
  verifyFirebaseIdToken,
  asyncHandler(async (req, res) => {
    const userId = req.user.uid;
    const { otp } = req.body || {};

    if (!otp) throw badRequest("otp is required.");

    const emailAddress = req.user.email || "";
    const fullName = req.user.name || "";

    if (!emailAddress) throw badRequest("Email address is required.");

    // Verify OTP (single-use)
    try {
      await verifyEmailOtp({ userId, email: emailAddress, otp });
    } catch (err) {
      // Record OTP verification failure, then preserve existing behavior
      const {
        browserType,
        browserVersion,
        operatingSystem,
        deviceType,
        deviceName,
        ipAddress,
        userAgent,
      } = getLoginMetaFromRequest(req);

      await createLoginAttempt({
        userId,
        firebaseUid: req.user?.uid,
        fullName,
        emailAddress,
        browserType,
        browserVersion,
        operatingSystem,
        deviceType,
        deviceName,
        ipAddress,
        userAgent,
        loginMethod: 'google',
        loginStatus: 'Failed',

        status: 'FAILED',
        otpVerified: false,
        failureReason: 'OTP verification failed',
      }).catch(() => {});


      throw err;
    }


    const {
      browserType,
      browserVersion,
      operatingSystem,
      deviceType,
      deviceName,
      ipAddress,
      userAgent,
    } = getLoginMetaFromRequest(req);

    // Record successful attempt after OTP verification
    await createLoginAttempt({
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
      loginMethod: "google",
      loginStatus: "Successful",
    });

    return res.status(200).json({
      success: true,
      accessGranted: true,
      message: "OTP verified. Login access granted.",
    });
  })
);

router.post(
  "/resend-otp",
  verifyFirebaseIdToken,
  asyncHandler(async (req, res) => {
    const userId = req.user.uid;
    const emailAddress = req.user.email || "";
    const fullName = req.user.name || "";

    if (!emailAddress) throw badRequest("Email address is required.");

    const { otp } = await issueEmailOtpChallenge({ userId, email: emailAddress });

    await sendLoginOtpEmail({ toEmail: emailAddress, toName: fullName, otp });

    return res.status(200).json({
      success: true,
      message: "OTP resent.",
    });
  })
);

// Login history for the user
router.get(
  "/history",
  verifyFirebaseIdToken,
  asyncHandler(async (req, res) => {
    const userId = req.user.uid;
    const {
      search,
      filter,
      sortBy,
      sortOrder,
      page,
      pageSize,
    } = req.query || {};

    const p = Math.max(parseInt(String(page || "1"), 10), 1);
    const ps = Math.min(Math.max(parseInt(String(pageSize || "10"), 10), 1), 50);
    const skip = (p - 1) * ps;

    // filter can be status or deviceType (keep flexible)
    const query = { userId };

    if (filter) {
      const f = String(filter);
      // status filtering first
      if (["Successful", "Failed", "OTP_Required"].includes(f)) {
        query.loginStatus = f;
      } else {
        // device type filtering
        query.deviceType = f;
      }
    }

    if (search) {
      const s = String(search);
      query.$or = [
        { browserType: { $regex: s, $options: "i" } },
        { operatingSystem: { $regex: s, $options: "i" } },
        { ipAddress: { $regex: s, $options: "i" } },
        { loginMethod: { $regex: s, $options: "i" } },
      ];
    }

    const sortKey = sortBy || "createdAt";
    const sortDir = String(sortOrder || "desc").toLowerCase() === "asc" ? 1 : -1;

    const total = await LoginHistory.countDocuments(query);
    const items = await LoginHistory.find(query)
      .sort({ [sortKey]: sortDir, createdAt: -1 })
      .skip(skip)
      .limit(ps)
      .lean();

    const formatted = items.map((x) => ({
      loginTime: x.loginTime,
      logoutTime: x.logoutTime || null,
      browser: x.browser || x.browserType || '',
      browserVersion: x.browserVersion || '',

      operatingSystem: x.operatingSystem,
      deviceType: x.deviceType,
      deviceName: x.deviceName || '',
      ipAddress: x.ipAddress,
      country: x.country || '',
      city: x.city || '',
      loginMethod: x.loginMethod || x.loginMethodRaw || '',
      status: x.status || x.loginStatus || '',
      failureReason: x.failureReason || '',
      otpVerified: !!x.otpVerified,

      // backward-compatible extras
      id: x._id,
      loginDate: x.loginDate,
      createdAt: x.createdAt,
      updatedAt: x.updatedAt,
    }));


    return res.status(200).json({
      success: true,
      data: formatted,
      pagination: {
        page: p,
        pageSize: ps,
        total,
        totalPages: Math.max(Math.ceil(total / ps), 1),
      },
    });
  })
);

module.exports = router;

