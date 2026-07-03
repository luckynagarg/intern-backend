/**
 * Subscription & billing routes.
 *
 * Security:
 * - Every route is protected with Firebase ID token verification.
 * - Never trust any identity or payment details from the frontend.
 */
const express = require('express');
const router = express.Router();

// Helpers for consistent error handling and async route safety.
const asyncHandler = require('../middleware/asyncHandler');

// Firebase auth middleware attaches req.user (uid/email/name).
const { verifyFirebaseIdToken } = require('../middleware/authFirebase');

// Subscription plan + quota computation.
const { getQuotaOnly, getActivePlanAndQuota } = require('../services/subscriptionService');

// Razorpay order creation and server-side verification.
const { createRazorpayOrder, verifyPaymentAndActivate } = require('../services/razorpaySubscriptionService');

// Standard HTTP error helpers (400/401/403/404/500).
const { badRequest, forbidden, notFound, unauthorized } = require('../utils/httpErrors');

/**
 * Normalizes plan keys to a safe format.
 *
 * Important: we still validate plan keys server-side inside services.
 */
function safePlanKey(planKey) {
  return String(planKey || '').toLowerCase();
}

// -------------------------------
// Dashboard data (plan + quota)
// -------------------------------
router.get('/me', verifyFirebaseIdToken, asyncHandler(async (req, res) => {
  // req.user.uid is derived from a verified Firebase token.
  const userId = req.user.uid;

  const data = await getActivePlanAndQuota(userId);
  res.json({ success: true, data });
}));

// -------------------------------
// Payment history / invoices
// -------------------------------
router.get('/payments', verifyFirebaseIdToken, asyncHandler(async (req, res) => {
  // Importing model here keeps the route module lightweight.
  const PaymentTransaction = require('../Model/PaymentTransaction');

  const userId = req.user.uid;

  // Retrieve recent payments for UI display.
  const payments = await PaymentTransaction.find({ userId })
    .sort({ createdAt: -1 })
    .limit(50)
    .lean();

  res.json({ success: true, data: payments });
}));

router.get('/invoices', verifyFirebaseIdToken, asyncHandler(async (req, res) => {
  const Invoice = require('../Model/Invoice');

  const userId = req.user.uid;

  // Do not send pdfPath in list view (client can use download endpoint).
  const invoices = await Invoice.find({ userId })
    .sort({ createdAt: -1 })
    .limit(50)
    .select({ pdfPath: 0 })
    .lean();

  res.json({ success: true, data: invoices });
}));

router.get('/invoices/:invoiceNumber/download', verifyFirebaseIdToken, asyncHandler(async (req, res) => {
  const Invoice = require('../Model/Invoice');
  const fs = require('fs');

  const userId = req.user.uid;
  const { invoiceNumber } = req.params;

  // Ensure invoice belongs to the authenticated user.
  const invoice = await Invoice.findOne({ userId, invoiceNumber });
  if (!invoice) throw notFound('Invoice not found.');

  const filePath = invoice.pdfPath;
  if (!fs.existsSync(filePath)) throw notFound('Invoice PDF not found on server.');

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${invoiceNumber}.pdf"`);

  // Stream the PDF to avoid large memory usage for bigger files.
  return fs.createReadStream(filePath).pipe(res);
}));

// -------------------------------
// Razorpay Checkout integration
// -------------------------------
router.post('/razorpay/create-order', verifyFirebaseIdToken, asyncHandler(async (req, res) => {
  const { planKey } = req.body;
  if (!planKey) throw badRequest('planKey is required');

  const userId = req.user.uid;

  // Create order + store a PaymentTransaction record.
  const { orderId, amount, currency, planKey: normalizedPlanKey, subscriptionName, transactionId } = await createRazorpayOrder({
    userId,
    planKey: safePlanKey(planKey),
    userEmail: req.user.email,
    userName: req.user.name,
  });

  return res.json({
    success: true,
    data: {
      orderId,
      amount,
      currency,
      planKey: normalizedPlanKey,
      subscriptionName,
      transactionId,
    },
  });
}));

router.post('/razorpay/verify', verifyFirebaseIdToken, asyncHandler(async (req, res) => {
  // Never trust these values beyond signature verification in the service.
  const { planKey, razorpayOrderId, razorpayPaymentId, razorpaySignature } = req.body;

  if (!planKey || !razorpayOrderId || !razorpayPaymentId || !razorpaySignature) {
    throw badRequest('planKey, razorpayOrderId, razorpayPaymentId and razorpaySignature are required.');
  }

  const userId = req.user.uid;

  const result = await verifyPaymentAndActivate({
    userId,
    planKey: safePlanKey(planKey),
    razorpayOrderId,
    razorpayPaymentId,
    razorpaySignature,
    userEmail: req.user.email,
    userName: req.user.name,
  });

  return res.json({ success: true, data: result });
}));

module.exports = router;


