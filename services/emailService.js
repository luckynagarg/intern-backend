const nodemailer = require('nodemailer');

function getTransport() {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 587);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    throw new Error('SMTP credentials not set in environment variables.');
  }

  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });
}

function buildInvoiceEmailHtml({ planName, amountPaid, paymentId, invoiceNumber, startDate, expiryDate }) {
  return `
  <div style="font-family: Arial, sans-serif; line-height: 1.5;">
    <h2 style="color:#2563eb;">Subscription Activated 🎉</h2>
    <p>Hi,</p>
    <p>Your payment has been verified and your subscription is now active. Here are your invoice details:</p>

    <ul>
      <li><b>Plan:</b> ${planName}</li>
      <li><b>Amount Paid:</b> ₹${amountPaid}</li>
      <li><b>Payment ID:</b> ${paymentId}</li>
      <li><b>Invoice Number:</b> ${invoiceNumber}</li>
      <li><b>Subscription Start Date:</b> ${new Date(startDate).toDateString()}</li>
      <li><b>Subscription Expiry Date:</b> ${new Date(expiryDate).toDateString()}</li>
    </ul>

    <p>You can also download your PDF invoice from your dashboard.</p>
    <p style="color: #6b7280;">Regards,<br/>InternArea Team</p>
  </div>
  `;
}

async function sendInvoiceEmail({ toEmail, toName, subject, html, attachments }) {
  const transport = getTransport();
  const fromEmail = process.env.SMTP_FROM_EMAIL;
  const fromName = process.env.SMTP_FROM_NAME || 'InternArea';

  if (!fromEmail) {
    throw new Error('SMTP_FROM_EMAIL is not set');
  }

  await transport.sendMail({
    from: `${fromName} <${fromEmail}>`,
    to: `${toName || ''} <${toEmail}>`.trim(),
    subject,
    html,
    attachments,
  });
}

module.exports = { buildInvoiceEmailHtml, sendInvoiceEmail };

