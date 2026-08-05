/**
 * Central API route registry.
 *
 * All route modules are mounted under /api by backend/index.js.
 * Keeping this file small makes it easy to reason about API surface.
 */
const express = require("express");
const router = express.Router();

// Feature routes
const admin = require("./admin");
const intern = require("./internship");
const job = require("./job");
const application = require("./application.js");
const publicRoutes = require("./public");
const debugSeed = require('./debugSeed');

router.use('/debug', debugSeed);
const subscription = require("./subscription");
const passwordRecovery = require("./passwordRecovery");
const login = require("./login");
const resumeCreation = require("./resumeCreation");
const search = require("./search");

const { verifyFirebaseIdToken } = require("../middleware/authFirebase");
const { requireAdmin } = require("../middleware/requireAdmin");

// Admin endpoints
// /admin/adminlogin remains unprotected (login gate). All other admin routes should require admin.
router.use("/admin", (req, res, next) => {
  if (req.path === "/adminlogin") return admin.handle(req, res, next);
  return verifyFirebaseIdToken(req, res, () => requireAdmin(req, res, next));
});

// Job & internship CRUD
router.use("/internship", intern);
router.use("/job", job);


// Applications (includes subscription quota enforcement for POST)
router.use("/application", application);

// Social / notifications
const friends = require("./friends");
const notifications = require("./notifications");
router.use("/friends", friends);
router.use("/notifications", notifications);


// Public/community endpoints
router.use("/public", publicRoutes);

// Password recovery endpoints
router.use("/password-recovery", passwordRecovery);

// Forgot password (generate new random password in Firebase Auth)
const forgotPassword = require('./forgotPassword');
router.use('/auth', forgotPassword);

// Subscription & billing endpoints (legacy)
router.use("/subscription", subscription);


// Enterprise subscriptions endpoints (Phase B)
const subscriptionsV2 = require('./subscriptions');
router.use('/subscriptions', subscriptionsV2);


// Login security (Chrome OTP) & login history
router.use("/login", login);

// Generic Email OTP authentication (separate module; does not affect /login/*)
const emailOtpAuth = require('./emailOtpAuth');
router.use('/email-otp-auth', emailOtpAuth);


// Admin security endpoints
const adminLoginHistory = require('./adminLoginHistory');
const adminLoginHistoryExport = require('./adminLoginHistoryExport');
router.use('/admin', adminLoginHistory);
router.use('/admin/login-history', adminLoginHistoryExport);



// Premium resume creation
router.use('/resume', resumeCreation);

// Search (internships/jobs/companies)
router.use('/search', search);

// Contact/Query form (forwards to admin email luckynagar1505@gmail.com)
const contact = require('./contact');
router.use('/contact', contact);

// Admin password reset (OTP-based, reuses existing email infrastructure)
const adminPasswordReset = require('./adminPasswordReset');
router.use('/admin/reset-password', adminPasswordReset);

// Email verification (Firebase built-in verification link)
const emailVerification = require('./emailVerification');
router.use('/email-verification', emailVerification);

// Language OTP (French language switch verification)
const languageOtp = require('./languageOtp');
router.use('/language', languageOtp);

module.exports = router;
