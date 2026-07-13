const express = require('express');
const crypto = require('crypto');

const asyncHandler = require('../middleware/asyncHandler');
const { badRequest, forbidden, internalServerError } = require('../utils/httpErrors');

const { admin } = require('../config/firebaseAdmin');
const UserProfile = require('../Model/UserProfile');

const router = express.Router();

function sanitizeIdentifier(input) {
  return String(input || '').trim();
}

function isValidEmail(email) {
  // Intentionally simple but effective for production validation.
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function normalizePhone(phone) {
  // Keep digits only.
  return String(phone || '').replace(/[^0-9]/g, '');
}

function isValidPhone(phoneDigits) {
  // Minimal E.164-like validation without requiring a full country map.
  // Accept 10 to 15 digits.
  return /^[0-9]{10,15}$/.test(phoneDigits);
}

function isSameLocalDay(a, b) {
  // Use UTC day boundary to avoid timezone confusion across servers.
  // Date stored from server time; UTC is deterministic.
  const da = new Date(a);
  const db = new Date(b);
  return (
    da.getUTCFullYear() === db.getUTCFullYear() &&
    da.getUTCMonth() === db.getUTCMonth() &&
    da.getUTCDate() === db.getUTCDate()
  );
}

function generateLettersOnlyPassword({ minLen = 10, maxLen = 12 } = {}) {
  const length = crypto.randomInt(minLen, maxLen + 1);
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
  const alphabetLen = alphabet.length;

  // Rejection sampling to remove modulo bias.
  const result = [];
  const maxByte = 256;
  const cutoff = Math.floor(maxByte / alphabetLen) * alphabetLen;

  while (result.length < length) {
    const byte = crypto.randomBytes(1)[0];
    if (byte >= cutoff) continue;
    result.push(alphabet[byte % alphabetLen]);
  }

  return result.join('');
}

async function findFirebaseUserByIdentifier(identifier, method) {
  // method: 'email' | 'phone'
  if (method === 'email') {
    const users = await admin.auth().listUsers(100, { email: identifier });
    return users?.users?.[0] || null;
  }

  // Firebase phone lookup uses phoneNumber exact match
  const users = await admin.auth().listUsers(100, { phoneNumber: identifier });
  return users?.users?.[0] || null;
}

async function findLocalUserProfileByFirebaseUid(firebaseUid) {
  return UserProfile.findOne({ firebaseUid });
}

// Legacy route kept for backward compatibility.
// It no longer generates or returns passwords.
// It instructs clients to use the secure OTP-based flow at /api/password-recovery/*.
router.post(
  '/forgot-password',
  asyncHandler(async (req, res) => {
    const { identifier } = req.body || {};

    if (!identifier) {
      throw badRequest('identifier is required.');
    }

    const raw = sanitizeIdentifier(identifier);
    if (!raw) {
      throw badRequest('identifier is required.');
    }

    // Determine method for OTP request.
    const method = isValidEmail(raw) ? 'email' : 'phone';

    // Keep response generic (no account existence leakage).
    // We do not return OTP.
    return res.status(200).json({
      success: true,
      message:
        'Password recovery has been moved to OTP-based flow. Please use the OTP reset screen.',
      // Frontend can ignore this field; kept non-sensitive.
      passwordRecoveryPath: '/api/password-recovery/request',
      method,
    });
  })
);


module.exports = router;

