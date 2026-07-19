const { sendInvoiceEmail } = require('./emailService');

function buildEmailOtpHtml({ toName, otp }) {
  return `
  <div style="font-family: Arial, sans-serif; line-height: 1.5;">
    <h2 style="color:#2563eb;">Your InternArea Email Verification OTP</h2>
    <p>Hi ${toName || ''},</p>
    <p>Your one-time password (OTP) is:</p>
    <div style="font-size:28px;font-weight:700;letter-spacing:2px;">${otp}</div>
    <p>This OTP will expire shortly.</p>
    <p style="color:#6b7280;">If you didn’t request this, please ignore this email.</p>
    <p style="color: #6b7280;">Regards,<br/>InternArea Team</p>
  </div>
  `;
}

async function sendEmailOtp({ toEmail, toName, otp }) {
  // Never log OTP value.
  await sendInvoiceEmail({
    toEmail,
    toName,
    subject: 'InternArea Email Verification OTP',
    html: buildEmailOtpHtml({ toName, otp }),
  });
}

module.exports = { sendEmailOtp };

