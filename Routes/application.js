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
const { forbidden, badRequest } = require("../utils/httpErrors");

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
 * List applications.
 *
 * NOTE: This route remains unprotected in the current codebase.
 * In a production system, this should be protected/authorized per user.
 */
router.get("/", async (req, res) => {
  try {
    const data = await application.find();
    return res.status(200).json(data);
  } catch (error) {
    console.log(error);
    return res.status(404).json({ error: "internal server error" });
  }
});

/**
 * Fetch a single application by id.
 */
router.get("/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const data = await application.findById(id);

    if (!data) {
      return res.status(404).json({ error: "application not found" });
    }

    return res.status(200).json(data);
  } catch (error) {
    console.log(error);
    return res.status(404).json({ error: "internal server error" });
  }
});

/**
 * Update application status.
 *
 * Expected action values:
 * - accepted
 * - rejected
 */
router.put("/:id", async (req, res) => {
  const { id } = req.params;
  const { action } = req.body;

  let status;
  if (action === "accepted") {
    status = "accepted";
  } else if (action === "rejected") {
    status = "rejected";
  } else {
    return res.status(404).json({ error: "Invalid action" });
  }

  try {
    const updateapplication = await application.findByIdAndUpdate(
      id,
      { $set: { status } },
      { new: true }
    );

    if (!updateapplication) {
      return res
        .status(404)
        .json({ error: "Not able to update the application" });
    }

    return res.status(200).json({ sucess: true, data: updateapplication });
  } catch (error) {
    return res.status(500).json({ error: "internal server error" });
  }
});

module.exports = router;


