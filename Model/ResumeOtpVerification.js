const mongoose = require('mongoose');

/**
 * Short-lived OTP verification challenges for resume purchase.
 *
 * Separate from login OTP to avoid mixing purposes.
 */
const ResumeOtpVerificationSchema = new mongoose.Schema(
  {
    userId: { type: String, index: true, required: true },
    email: { type: String, index: true, required: true },

    // Hashed 6-digit OTP
    otpHash: { type: String, required: true },

    otpExpiresAt: { type: Date },


    // attempts / throttling
    otpAttempts: { type: Number, default: 0 },
    maxOtpVerifyAttempts: { type: Number, default: 5 },

    // single use
    otpConsumed: { type: Boolean, default: false, index: true },

    lastOtpSentAt: { type: Date, default: null },
  },
  { timestamps: true }
);

ResumeOtpVerificationSchema.index({ otpExpiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('ResumeOtpVerification', ResumeOtpVerificationSchema);

