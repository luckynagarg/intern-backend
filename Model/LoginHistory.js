const mongoose = require("mongoose");

/**
 * Login history (per login attempt).
 *
 * Stored fields are designed to support:
 * - audit trails
 * - profile-based login history UI
 * - security analytics (browser/device/IP/method/status)
 */
const LoginHistorySchema = new mongoose.Schema(
  {
    userId: { type: String, index: true, required: true },
    fullName: { type: String, default: "" },
    emailAddress: { type: String, default: "" },

    loginDate: { type: String, index: true }, // YYYY-MM-DD (IST)
    loginTime: { type: String, index: true }, // HH:mm:ss (IST)

    browserType: { type: String, default: "" },
    browserVersion: { type: String, default: "" },
    operatingSystem: { type: String, default: "" },
    deviceType: {
      type: String,
      enum: ["Desktop", "Laptop", "Tablet", "Mobile", "Unknown"],
      default: "Unknown",
      index: true,
    },
    deviceName: { type: String, default: "" },

    ipAddress: { type: String, default: "" },
    userAgent: { type: String, default: "" },

    loginMethod: {
      type: String,
      enum: ["Email & Password", "Google Sign-In", "Unknown"],
      default: "Unknown",
      index: true,
    },

    loginStatus: {
      type: String,
      enum: ["Successful", "Failed", "OTP_Required"],
      default: "Failed",
      index: true,
    },

    logoutTime: { type: Date, default: null },

    // Session duration in seconds (if logout recorded)
    sessionDurationSeconds: { type: Number, default: null },
  },
  {
    timestamps: { createdAt: "createdAt", updatedAt: "updatedAt" },
  }
);

LoginHistorySchema.index({ userId: 1, createdAt: -1 });
LoginHistorySchema.index({ userId: 1, loginDate: -1, loginTime: -1 });

module.exports = mongoose.model("LoginHistory", LoginHistorySchema);

