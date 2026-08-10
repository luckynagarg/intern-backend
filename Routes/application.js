/**
 * Application routes.
 *
 * This endpoint is where subscription quota enforcement must happen.
 * The backend must never rely on frontend limits alone.
 */
const express = require("express");
const router = express.Router();

// Mongo model for job/internship applications.
const application = require("../Model/Application");

// Firebase ID token verification.
const { verifyFirebaseIdToken } = require("../middleware/authFirebase");

// Async error forwarding helper.
const asyncHandler = require("../middleware/asyncHandler");

// Standard HTTP error helpers.
const { forbidden, badRequest, notFound } = require("../utils/httpErrors");

// Business logic: quota enforcement based on active subscription.
const subscriptionService = require("../services/subscriptionService");

/**
 * Create a new application.
 *
 * Request flow:
 * 1) Verify Firebase token (req.user.uid)
 * 2) Compute remaining quota for current IST month
 * 3) Reject with 403 if quota is exhausted
 * 4) Persist application using the authenticated userId
 */
router.post("/", verifyFirebaseIdToken, asyncHandler(async (req, res) => {
  const { company, category, coverLetter, Application: internshipId } = req.body;
  const body = req.body?.body;


  // Basic validation: required fields must exist.
  if (!company || !category || !coverLetter || !internshipId) {
    throw badRequest(
      "company, category, coverLetter and Application (internship id) are required."
    );
  }

  // Identity comes ONLY from the verified Firebase token.
  const userId = req.user.uid;

  // Enforce monthly quota server-side.
  const quota = await subscriptionService.getQuotaOnly(userId);

  if (quota.remainingApplications <= 0) {
    // Friendly message for the frontend UX (upgrade CTA).
    throw forbidden(
      "You have reached your monthly internship application limit. Upgrade your plan to apply more."
    );
  }

  // Persist application.
  // IMPORTANT: Never trust client-supplied user ownership.
  const applicationipdata = new application({
    company,
    category,
    coverLetter,
    user: userId, // store authenticated identity
    userId, // efficient counting
    Application: internshipId,
    body: body || undefined,
  });

  const saved = await applicationipdata.save();
  return res.status(201).json(saved);
}));

/**
 * List the authenticated user's own applications.
 *
 * Security: requires a valid Firebase token and only returns applications
 * owned by the caller (userId from the verified token). This prevents IDOR /
 * broken access control where any unauthenticated user could read all
 * applications.
 */
router.get("/", verifyFirebaseIdToken, asyncHandler(async (req, res) => {
  const userId = req.user.uid;
  const data = await application.find({ userId }).sort({ createdAt: -1 }).lean();
  return res.status(200).json({ success: true, data });
}));

/**
 * Fetch a single application by id.
 *
 * Security: only the owner (or an admin) may view an application. We verify
 * ownership against the authenticated token to prevent IDOR.
 */
router.get("/:id", verifyFirebaseIdToken, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const userId = req.user.uid;

  const data = await application.findOne({ _id: id, userId }).lean();

  if (!data) {
    throw notFound("application not found");
  }

  return res.status(200).json({ success: true, data });
}));

/**
 * Update own application status.
 *
 * Security: only the owner may update their own application.
 *
 * Expected action values:
 * - accepted
 * - rejected
 */
router.put("/:id", verifyFirebaseIdToken, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const userId = req.user.uid;
  const { action } = req.body;

  let status;
  if (action === "accepted") {
    status = "accepted";
  } else if (action === "rejected") {
    status = "rejected";
  } else {
    throw badRequest("Invalid action");
  }

  const updateapplication = await application.findOneAndUpdate(
    { _id: id, userId },
    { $set: { status } },
    { new: true }
  );

  if (!updateapplication) {
    throw notFound("application not found");
  }

  return res.status(200).json({ success: true, data: updateapplication });
}));

module.exports = router;


