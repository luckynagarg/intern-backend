const mongoose = require("mongoose");

/**
 * OTP verification challenges for browser-based security (Chrome requirement).
 *
 * Collection is dedicated to login OTP challenges (not password recovery).
 */
const LoginOtpVerificationSchema = new mongoose.Schema(
  {
    userId: { type: String, index: true, required: true },
    email: { type: String, index: true, required: true },

    // Hashed 6-digit OTP
    otpHash: { type: String, required: true },

    otpExpiresAt: { type: Date },


    // Attempts / rate limiting
    otpAttempts: { type: Number, default: 0 },
    maxOtpVerifyAttempts: { type: Number, default: 5 },

    // Single-use invalidation after successful verification
    otpConsumed: { type: Boolean, default: false, index: true },

    // Resend cooldown tracking
    lastOtpSentAt: { type: Date, default: null },
  },
  {
    timestamps: true,
  }
);

// TTL index deletes expired OTP docs automatically.
LoginOtpVerificationSchema.index({ otpExpiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model("LoginOtpVerification", LoginOtpVerificationSchema);

