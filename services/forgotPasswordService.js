/**
 * Forgot Password service (Task 2 spec).
 *
 * Replaces the previous OTP-based reset with a directly-issued temporary
 * password flow:
 *
 *   1. Reset by registered email OR phone.
 *   2. Only ONE reset request allowed per IST calendar day.
 *   3. Generates a random password containing ONLY letters (uppercase and
 *      lowercase) — NO numbers, NO special characters.
 *   4. Sends the generated password to the user's registered email.
 *   5. If a reset was already requested the same day, returns the message:
 *        "You can use this option only once per day."
 *
 * Security notes:
 *   - We never leak whether an identifier exists (generic responses).
 *   - The generated password is applied via Firebase Admin updateUser.
 */

const crypto = require('crypto');

const { getAdminOrThrow } = require('../config/firebaseAdmin');
const UserProfile = require('../Model/UserProfile');
const { badRequest, internalServerError } = require('../utils/httpErrors');

const { sendEmail } = require('./emailService');
const { buildForgotPasswordEmailHtml, buildForgotPasswordPlainText } = require('./emailTemplates');

/**
 * Normalizes an identifier.
 * - email -> trimmed, lower-cased
 * - phone -> digits only
 */
function normalizeIdentifier(method, identifier) {
  const v = String(identifier || '').trim();
  if (!v) return '';
  if (method === 'email') return v.toLowerCase();
  if (method === 'phone') return v.replace(/[^0-9]/g, '');
  return v;
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/**
 * Generates a random password containing ONLY uppercase and lowercase
 * letters. No numbers, no special characters.
 *
 * Uses rejection sampling to avoid modulo bias.
 */
function generateLettersOnlyPassword(minLen = 12, maxLen = 14) {
  const length = crypto.randomInt(minLen, maxLen + 1);
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
  const alphabetLen = alphabet.length;
  const maxByte = 256;
  const cutoff = Math.floor(maxByte / alphabetLen) * alphabetLen;

  const result = [];
  while (result.length < length) {
    const byte = crypto.randomBytes(1)[0];
    if (byte >= cutoff) continue;
    result.push(alphabet[byte % alphabetLen]);
  }

  return result.join('');
}

/**
 * Determines whether a reset is allowed, based on the user's LAST requested
 * reset in the project timezone (default Asia/Kolkata) calendar day.
 *
 * @param {Date|null|undefined} lastResetAt
 * @returns {boolean} true if a reset is allowed (different day or never)
 */
function isDailyResetAllowed(lastResetAt) {
  if (!lastResetAt) return true;

  const timeZone = process.env.PAYMENT_TIMEZONE || 'Asia/Kolkata';
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

  const lastParts = fmt.formatToParts(new Date(lastResetAt));
  const nowParts = fmt.formatToParts(new Date());

  const toKey = (parts) => {
    const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
    return `${map.year}-${map.month}-${map.day}`;
  };

  return toKey(nowParts) !== toKey(lastParts);
}

/**
 * Records the last reset request time on the user's local profile.
 * Uses findOneAndUpdate upsert so it works even if no profile row exists yet.
 */
async function recordResetRequest(firebaseUid) {
  await UserProfile.findOneAndUpdate(
    { firebaseUid },
    { $set: { lastPasswordResetAt: new Date() } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
}

/**
 * Core reset flow.
 *
 * @param {{ method: 'email'|'phone', identifier: string }}
 * @returns {Promise<{success: boolean, message: string}>}
 */
async function resetPassword({ method, identifier }) {
  const normalized = normalizeIdentifier(method, identifier);
  if (!normalized) throw badRequest('A valid email or phone number is required.');

// Resolve the Firebase user by the identifier.
  const admin = getAdminOrThrow();
  let user = null;
  try {
    if (method === 'email') {
      const users = await admin.auth().listUsers(100, { email: normalized });
      user = users.users && users.users.length ? users.users[0] : null;
    } else {
      const users = await admin.auth().listUsers(100, { phoneNumber: normalized });
      user = users.users && users.users.length ? users.users[0] : null;
    }
  } catch (e) {
    throw internalServerError('Password reset service unavailable. Please try again later.');
  }

  // Generic response — never reveal whether an account exists.
  if (!user) {
    return {
      success: true,
      message: 'If an account exists, we will send a new password to your registered email.',
    };
  }

  const uid = user.uid;

  // Enforce ONE reset per calendar day.
  const profile = await UserProfile.findOne({ firebaseUid: uid });
  if (profile && profile.lastPasswordResetAt) {
    if (!isDailyResetAllowed(profile.lastPasswordResetAt)) {
      return {
        success: false,
        message: 'You can use this option only once per day.',
      };
    }
  }

  // Google-only accounts cannot be reset via password.
  const providerMethods = (user.providerData || []).map((p) => p.providerId);
  if (providerMethods.includes('google.com')) {
    return {
      success: true,
      message: 'If an account exists, we will send a new password to your registered email.',
    };
  }

  // The user's verified email is required for delivery.
  const toEmail = user.email;
  if (!toEmail) {
    // We cannot deliver; keep generic to avoid leaking.
    return {
      success: true,
      message: 'If an account exists, we will send a new password to your registered email.',
    };
  }

  // Generate a letters-only password and apply it via Firebase Admin.
  const newPassword = generateLettersOnlyPassword();
  await admin.auth().updateUser(uid, { password: newPassword });

  // Record the request to enforce the daily limit.
  await recordResetRequest(uid);

  // Send the generated password to the registered email.
  try {
    await sendEmail({
      toEmail,
      toName: user.displayName,
      subject: 'InternArea - Your New Temporary Password',
      html: buildForgotPasswordEmailHtml({
        toName: user.displayName,
        password: newPassword,
      }),
      text: buildForgotPasswordPlainText({
        toName: user.displayName,
        password: newPassword,
      }),
    });
  } catch (e) {
    // Password was already changed; surface a clear error so the user can retry.
    throw internalServerError(
      'Your password was reset, but the email could not be sent. Please contact support.'
    );
  }

  return {
    success: true,
    message: 'A new password has been sent to your registered email.',
  };
}

module.exports = {
  resetPassword,
  generateLettersOnlyPassword,
  normalizeIdentifier,
  isValidEmail,
  isDailyResetAllowed,
};
