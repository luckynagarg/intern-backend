/**
 * OTP delivery hook.
 *
 * Backend currently has an email pipeline (nodemailer) wired via ./emailService.
 * This module provides a dedicated OTP HTML template for resume OTP verification.
 */

const { sendInvoiceEmail } = require('./emailService');

function buildOtpHtml({ toName, otp }) {
  return `
  <div style="font-family: Arial, sans-serif; line-height: 1.5;">
    <h2 style="color:#2563eb;">InternArea Verification OTP</h2>
    <p>Hi ${toName || ''},</p>
    <p>Your one-time password (OTP) is:</p>
    <div style="font-size:28px;font-weight:700;letter-spacing:2px;">${otp}</div>
    <p>This OTP will expire in 10 minutes.</p>
    <p style="color:#6b7280;">If you didn’t request this, please ignore this email.</p>
    <p style="color: #6b7280;">Regards,<br/>InternArea Team</p>
  </div>
  `;
}

async function sendOtpEmail({ toEmail, toName, otp }) {
  const html = buildOtpHtml({ toName, otp });

  await sendInvoiceEmail({
    toEmail,
    toName,
    subject: 'InternArea Resume Creation - OTP Verification',
    html,
  });
}

async function sendOtpSms({ phoneNumber, otp }) {
  // SMS architecture stub.
  throw new Error('sendOtpSms is not wired yet. Integrate Firebase/SMS provider.');
}

module.exports = { sendOtpEmail, sendOtpSms };

