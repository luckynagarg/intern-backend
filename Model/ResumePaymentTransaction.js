const mongoose = require('mongoose');

/**
 * Dedicated transaction model for resume ₹50 purchases.
 *
 * Note: Current implementation uses PaymentTransaction model directly,
 * but this model is provided for future separation.
 */
const ResumePaymentTransactionSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, index: true },
    resumeId: { type: String, required: true, index: true },

    amount: { type: Number, required: true },
    currency: { type: String, required: true },

    razorpayOrderId: { type: String, required: true, index: true, unique: true },
    razorpayPaymentId: { type: String, index: true, default: null },
    razorpaySignature: { type: String, default: null },

    status: {
      type: String,
      enum: ['created', 'verified', 'failed', 'cancelled'],
      default: 'created',
      index: true,
    },

    verifiedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model('ResumePaymentTransaction', ResumePaymentTransactionSchema);

