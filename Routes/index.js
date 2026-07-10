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
const subscription = require("./subscription");
const passwordRecovery = require("./passwordRecovery");
const login = require("./login");
const resumeCreation = require("./resumeCreation");


const { verifyFirebaseIdToken } = require("../middleware/authFirebase");
const { requireAdmin } = require("../middleware/requireAdmin");

// Admin endpoints
// /admin/adminlogin remains unprotected (login gate). All other admin routes should require admin.
router.use("/admin", (req, res, next) => {
  if (req.path === "/adminlogin") return admin(req, res, next);
  return verifyFirebaseIdToken(req, res, () => requireAdmin(req, res, next));
});




// Job & internship CRUD
router.use("/internship", intern);
router.use("/job", job);

// Applications (includes subscription quota enforcement for POST)
router.use("/application", application);

// Public/community endpoints
router.use("/public", publicRoutes);

// Notifications (user-specific; requires Firebase auth)
const notifications = require('./notifications');
router.use('/notifications', notifications);

// Friends (user-specific; requires Firebase auth)
const friends = require('./friends');
router.use('/friends', friends);


// Search endpoints (public/unauthed)
const search = require('./search');
router.use('/search', search);



// Password recovery endpoints
router.use("/password-recovery", passwordRecovery);

// Subscription & billing endpoints
router.use("/subscription", subscription);

// Login security (Chrome OTP) & login history
router.use("/login", login);

// Premium resume creation
router.use('/resume', resumeCreation);

// User profile bootstrap (lazy creation)
const profile = require('./profile');
router.use('/profile', profile);

module.exports = router;








