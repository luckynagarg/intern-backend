const { sendInvoiceEmail } = require("./emailService");

/**
 * NOTE:
 * The backend already has nodemailer wiring inside emailService.js,
 * but it currently only provides invoice email helpers.
 *
 * For production OTP delivery, you should implement an OTP-specific HTML template.
 * For now, this module provides a safe integration point.
 */

function buildLoginOtpHtml({ fullName, otp }) {
  return `
    <div style="font-family: Arial, sans-serif; line-height: 1.5;">
      <h2 style="color:#2563eb;">Your InternArea Login OTP</h2>
      <p>Hi ${fullName || ""},</p>
      <p>Your one-time password (OTP) is:</p>
      <div style="font-size:28px;font-weight:700;letter-spacing:2px;">${otp}</div>
      <p>This OTP will expire in 5 minutes.</p>
      <p style="color:#6b7280;">If you didn’t request this, please ignore this email.</p>
      <p style="color: #6b7280;">Regards,<br/>InternArea Team</p>
    </div>
  `;
}

async function sendLoginOtpEmail({ toEmail, toName, otp }) {
  // Reusing sendInvoiceEmail as a transport mechanism is not ideal (naming mismatch).
  // We will still use SMTP transport from emailService.js via sendInvoiceEmail.

  // sendInvoiceEmail signature: { toEmail, toName, subject, html, attachments }
  const html = buildLoginOtpHtml({ fullName: toName, otp });

  await sendInvoiceEmail({
    toEmail,
    toName,
    subject: "InternArea Login Verification OTP",
    html,
  });
}

module.exports = { sendLoginOtpEmail };

