/**
 * Unified Email Service (Resend)
 *
 * Production-ready singleton Resend client.
 * - Single reusable client (created once, cached for the lifetime of the process)
 * - Validates required Resend environment variables
 * - Proper logging (never logs secrets, OTP values, or email bodies)
 * - Supports HTML and plain-text emails with optional attachments (base64)
 * - Adds a dedicated `sendOTPEmail(email, otp)` helper for OTP emails
 */

const { Resend } = require('resend');

// ---------------------------------------------------------------------------
// Resend Environment Variable Helpers
// ---------------------------------------------------------------------------

const RESEND_REQUIRED_VARS = ['RESEND_API_KEY', 'EMAIL_FROM'];

/**
 * Returns the list of missing Resend environment variables.
 * @returns {string[]}
 */
function getMissingResendEnvVars() {
  const missing = [];
  for (const key of RESEND_REQUIRED_VARS) {
    if (!process.env[key]) missing.push(key);
  }
  return missing;
}

/**
 * Validates that all required Resend environment variables are set.
 * Throws a clear error listing all missing variables.
 */
function validateResendEnvVars() {
  const missing = getMissingResendEnvVars();
  if (missing.length > 0) {
    throw new Error(
      `Missing required Resend environment variables: ${missing.join(', ')}. ` +
      'Set them in your .env file or environment before starting the server.'
    );
  }
}

// ---------------------------------------------------------------------------
// Singleton Resend Client
// ---------------------------------------------------------------------------

let _resend = null;

/**
 * Creates or returns the cached Resend client.
 * Uses singleton pattern so the same client is reused for all emails.
 */
function getResend() {
  if (_resend) return _resend;

  validateResendEnvVars();

  const apiKey = process.env.RESEND_API_KEY;

  console.log('[email] Resend client initializing', {
    apiKey: '[set - length: ' + apiKey.length + ']',
  });

  _resend = new Resend(apiKey);

  return _resend;
}

/**
 * Resets the Resend client (useful for testing or re-initialization).
 */
function resetResend() {
  _resend = null;
}

// ---------------------------------------------------------------------------
// Unified Email Sender
// ---------------------------------------------------------------------------

/**
 * Sends an email using the singleton Resend client.
 *
 * @param {Object} options
 * @param {string} options.toEmail - Recipient email address
 * @param {string} [options.toName] - Recipient display name
 * @param {string} options.subject - Email subject line
 * @param {string} options.html - HTML body content
 * @param {string} [options.text] - Plain-text fallback (auto-generated from html if omitted)
 * @param {Array}  [options.attachments] - Attachment objects with `filename` and `content` (base64) or `path`
 * @param {string} [options.fromEmail] - Override sender email (defaults to EMAIL_FROM)
 * @param {string} [options.fromName] - Override sender name (defaults to EMAIL_FROM_NAME)
 * @returns {Promise<Object>} The Resend response object
 */
async function sendEmail({
  toEmail,
  toName,
  subject,
  html,
  text,
  attachments,
  fromEmail,
  fromName,
}) {
  const resend = getResend();

  const senderEmail = fromEmail || process.env.EMAIL_FROM;
  const senderName = fromName || process.env.EMAIL_FROM_NAME || 'InternArea';

  // Log send attempt (never log email body, attachments, or secrets)
  console.log('[email] sendEmail attempt', {
    toEmail: toEmail ? '[set]' : '[missing]',
    toName: toName ? '[set]' : '[missing]',
    subject: subject ? subject.substring(0, 60) + (subject.length > 60 ? '...' : '') : '[missing]',
    hasHtml: !!html,
    hasText: !!text,
    attachmentCount: attachments ? attachments.length : 0,
  });

  if (!senderEmail) {
    throw new Error('EMAIL_FROM is not set. Cannot send email.');
  }

  if (!toEmail) {
    throw new Error('Recipient email (toEmail) is required.');
  }

  // Build the "from" address. Resend expects `Name <email>` format.
  const from = `${senderName} <${senderEmail}>`;

  // Build Resend message payload.
  const message = {
    from,
    to: [toEmail],
    subject,
    html,
    text: text || htmlToPlainText(html),
  };

  // Attachments: Resend accepts `content` as base64 string. Support both
  // `path` (read file) and direct `content` (base64) for compatibility.
  if (attachments && attachments.length > 0) {
    message.attachments = [];
    for (const att of attachments) {
      if (att.content) {
        message.attachments.push({
          filename: att.filename,
          content: att.content,
        });
      } else if (att.path) {
        const fs = require('fs');
        const fileBuffer = fs.readFileSync(att.path);
        message.attachments.push({
          filename: att.filename || att.path.split('/').pop(),
          content: fileBuffer.toString('base64'),
        });
      }
    }
  }

  try {
    const { data, error } = await resend.emails.send(message);

    if (error) {
      throw new Error(`Resend send failed: ${error.message}`);
    }

    console.log('[email] sendEmail success', {
      id: data?.id,
      toEmail: toEmail ? '[set]' : '[missing]',
      subject: subject ? '[set]' : '[missing]',
    });

    return { data, error: null };
  } catch (err) {
    console.error('[email] sendEmail FAILED', {
      error: err.message,
      toEmail: toEmail ? '[set]' : '[missing]',
      subject: subject ? '[set]' : '[missing]',
    });
    throw err;
  }
}

/**
 * Strips HTML tags to produce a rough plain-text fallback.
 * @param {string} html
 * @returns {string}
 */
function htmlToPlainText(html) {
  if (!html) return '';
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/</g, '<')
    .replace(/>/g, '>')
    .replace(/"/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Sends a professional HTML OTP email via Resend.
 *
 * @param {string} email - Recipient email address
 * @param {string} otp - The 6-digit OTP
 * @param {Object} [options] - Optional overrides
 * @param {string} [options.toName] - Recipient display name
 * @param {string} [options.subject] - Custom subject line
 * @param {string} [options.purpose] - 'verification' | 'login' | 'passwordReset' | 'resumeCreation'
 * @param {number} [options.expiryMinutes] - OTP validity in minutes
 * @returns {Promise<Object>} The Resend response object
 */
async function sendOTPEmail(email, otp, options = {}) {
  const { toName, subject, purpose = 'verification', expiryMinutes = 5 } = options;

  if (!email) {
    throw new Error('Recipient email is required for OTP email.');
  }
  if (!otp) {
    throw new Error('OTP is required for OTP email.');
  }

  const { buildOtpEmailHtml, buildOtpPlainText } = require('./emailTemplates');

  const html = buildOtpEmailHtml({
    toName,
    otp,
    purpose,
    expiryMinutes,
  });

  const text = buildOtpPlainText({
    toName,
    otp,
    purpose,
    expiryMinutes,
  });

  const defaultSubject = 'InternArea - Your One-Time Password (OTP)';

  return sendEmail({
    toEmail: email,
    toName,
    subject: subject || defaultSubject,
    html,
    text,
  });
}

/**
 * Shorthand for sending an email using the buildInvoiceEmailHtml template.
 * Kept for backward compatibility with paymentService.js and razorpaySubscriptionService.js.
 */
async function sendInvoiceEmail({ toEmail, toName, subject, html, attachments }) {
  return sendEmail({ toEmail, toName, subject, html, attachments });
}

module.exports = {
  getResend,
  resetResend,
  sendEmail,
  sendInvoiceEmail,
  sendOTPEmail,
  validateResendEnvVars,
  getMissingResendEnvVars,
  htmlToPlainText,
};
