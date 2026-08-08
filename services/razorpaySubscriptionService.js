const crypto = require('crypto');
const { getRazorpayInstance } = require('./razorpayService');
const PaymentTransaction = require('../Model/PaymentTransaction');
const Subscription = require('../Model/Subscription');
const Invoice = require('../Model/Invoice');
const plans = require('../config/subscriptionPlans');
const { isWithinPaymentWindowIST } = require('../utils/ist');
const { generateInvoicePdf } = require('./invoicePdfService');
const { buildInvoiceEmailHtml } = require('./emailTemplates');
const { sendInvoiceEmail } = require('./emailService');

function normalizePlanKey(planKey) {
  return String(planKey || '').toLowerCase();
}

function calcSubscriptionPeriod30Days() {
  const start = new Date();
  const end = new Date(start.getTime() + 30 * 24 * 60 * 60 * 1000);
  return { startDate: start, endDate: end };
}

async function createRazorpayOrder({ userId, planKey, userEmail, userName }) {
  const key = normalizePlanKey(planKey);
  const plan = plans[key] || plans.free;

  // Enforce payment window entirely on backend for paid plans.
  if (plan.priceINR > 0) {
    if (!isWithinPaymentWindowIST(new Date())) {
      const err = new Error('Payments are only accepted between 10:00 AM and 11:00 AM IST.');
      err.statusCode = 403;
      throw err;
    }
  }

  if (plan.priceINR === 0) {
    // Free plan assignment is handled by subscription service; no Razorpay order.
    return { orderId: null, amount: 0, currency: 'INR', planKey: plan.planKey };
  }

  const razorpay = getRazorpayInstance();

  const amountPaise = plan.priceINR * 100;
  const currency = process.env.RAZORPAY_CURRENCY || 'INR';

  const order = await razorpay.orders.create({
    amount: amountPaise,
    currency,
    receipt: `internarea_${userId}_${Date.now()}`,
    payment_capture: 1,
  });

  // Store transaction created; activate only after signature verification.
  const txn = await PaymentTransaction.create({
    userId,
    planKey: plan.planKey,
    amount: plan.priceINR,
    currency,
    razorpayOrderId: order.id,
    razorpayPaymentId: null,
    razorpaySignature: null,
    status: 'created',
    invoiceNumber: null,
  });

  return {
    orderId: order.id,
    amount: plan.priceINR,
    currency,
    planKey: plan.planKey,
    // allow frontend to render
    subscriptionName: plan.name,
    transactionId: txn._id,
  };
}

async function verifyPaymentAndActivate({ userId, planKey, razorpayOrderId, razorpayPaymentId, razorpaySignature, userEmail, userName }) {
  // Enforce payment window again here as a final source-of-truth check.
  // A user could theoretically call verify outside the allowed window.
  // Subscription activation must never happen outside 10:00–11:00 IST.
  const now = new Date();
  if (!isWithinPaymentWindowIST(now)) {
    const err = new Error('Payments are only accepted between 10:00 AM and 11:00 AM IST.');
    err.statusCode = 403;
    throw err;
  }

  const key = normalizePlanKey(planKey);
  const plan = plans[key];
  if (!plan) {
    const err = new Error('Invalid subscription plan.');
    err.statusCode = 400;
    throw err;
  }


  const txn = await PaymentTransaction.findOne({ userId, razorpayOrderId });
  if (!txn) {
    const err = new Error('Payment order not found.');
    err.statusCode = 404;
    throw err;
  }

  if (txn.status === 'verified') {
    return { alreadyActivated: true };
  }

  const secret = (() => {
    const v = process.env.RAZORPAY_KEY_SECRET;
    if (!v) {
      const err = new Error('Missing Razorpay environment variable: RAZORPAY_KEY_SECRET');
      err.statusCode = 500;
      throw err;
    }
    return v;
  })();


  const body = `${razorpayOrderId}|${razorpayPaymentId}`;
  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(body)
    .digest('hex');

  if (expectedSignature !== razorpaySignature) {
    // mark failed
    txn.status = 'failed';
    txn.failureReason = 'Signature verification failed.';
    txn.razorpayPaymentId = razorpayPaymentId;
    txn.razorpaySignature = razorpaySignature;
    await txn.save();

    const err = new Error('Payment verification failed.');
    err.statusCode = 400;
    err.publicMessage = 'Payment verification failed. Please try again.';
    throw err;
  }

  // Ensure payment is for the correct amount/plan (we cannot trust frontend amount, but we can at least store planKey)
  txn.status = 'verified';
  txn.razorpayPaymentId = razorpayPaymentId;
  txn.razorpaySignature = razorpaySignature;
  txn.verifiedAt = new Date();

  const { startDate, endDate } = calcSubscriptionPeriod30Days();

  // Activate subscription (store 30 days window)
  await Subscription.updateOne(
    { userId },
    {
      $set: {
        userId,
        planKey: plan.planKey,
        status: 'active',
        startDate,
        endDate,
        lastVerifiedPaymentId: razorpayPaymentId,
      },
    },
    { upsert: true }
  );

  // invoice number
  const invoiceNumber = `INV-${userId.slice(0, 6).toUpperCase()}-${Date.now()}`;
  const invoicePdfPath = await generateInvoicePdf({
    invoiceNumber,
    userName: userName || '',
    userEmail: userEmail || '',
    planName: plan.name,
    amountPaid: plan.priceINR,
    paymentId: razorpayPaymentId,
    subscriptionStart: startDate,
    subscriptionExpiry: endDate,
  });

  const invoice = await Invoice.create({
    userId,
    invoiceNumber,
    planKey: plan.planKey,
    amountPaid: plan.priceINR,
    currency: txn.currency,
    paymentId: razorpayPaymentId,
    subscriptionStart: startDate,
    subscriptionExpiry: endDate,
    pdfPath: invoicePdfPath,
    emailStatus: 'pending',
    paymentMeta: {
      razorpayOrderId,
      razorpaySignature,
    },
  });

  txn.invoiceNumber = invoiceNumber;
  await txn.save();

  // Send email (best-effort)
  try {
    const html = buildInvoiceEmailHtml({
      planName: plan.name,
      amountPaid: plan.priceINR,
      paymentId: razorpayPaymentId,
      invoiceNumber,
      startDate,
      expiryDate: endDate,
    });

    await sendInvoiceEmail({
      toEmail: userEmail,
      toName: userName,
      subject: `InternArea - Invoice ${invoiceNumber}`,
      html,
      attachments: [
        {
          filename: `${invoiceNumber}.pdf`,
          path: invoicePdfPath,
        },
      ],
    });

    await Invoice.updateOne({ _id: invoice._id }, { $set: { emailStatus: 'sent' } });
  } catch (e) {
    await Invoice.updateOne({ _id: invoice._id }, { $set: { emailStatus: 'failed', emailFailureReason: e.message } });
  }

  return {
    subscription: {
      planKey: plan.planKey,
      planName: plan.name,
      startDate,
      endDate,
      status: 'active',
    },
    invoice: {
      invoiceNumber,
      pdfPath: invoicePdfPath,
      emailStatus: invoice.emailStatus,
    },
    payment: {
      razorpayOrderId,
      razorpayPaymentId,
    },
  };
}

module.exports = {
  createRazorpayOrder,
  verifyPaymentAndActivate,
};

