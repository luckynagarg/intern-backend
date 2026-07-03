const path = require('path');
const fs = require('fs');

const Resume = require('../Model/Resume');
const ResumeOtpVerification = require('../Model/ResumeOtpVerification');
const { sendOtpEmail } = require('./otpEmailService');
const { sendLoginOtpEmail } = require('./loginEmailOtpService');

const crypto = require('crypto');
const { badRequest, forbidden, internalServerError, notFound } = require('../utils/httpErrors');

const { generateResumePdf } = require('./resumeGeneratorService');

const OTP_LENGTH = 6;
const OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes
const OTP_RESEND_COOLDOWN_MS = 60 * 1000; // 60 seconds
const MAX_OTP_VERIFY_ATTEMPTS = 5;

function generateOtp() {
  const num = crypto.randomInt(0, 1000000);
  return String(num).padStart(OTP_LENGTH, '0');
}

async function hashOtp(otp) {
  const secret = process.env.OTP_HMAC_SECRET;
  if (!secret) throw internalServerError('OTP_HMAC_SECRET is not set.');

  return crypto.createHmac('sha256', secret).update(String(otp)).digest('hex');
}

async function verifyOtpAgainstHash(otp, otpHash) {
  const computed = await hashOtp(otp);
  return crypto.timingSafeEqual(
    Buffer.from(computed, 'hex'),
    Buffer.from(String(otpHash), 'hex')
  );
}

function ensureEmailPresent(email) {
  if (!email) {
    const err = new Error('Email not available for the authenticated user.');
    err.statusCode = 400;
    throw err;
  }
}

function validateResumeInput(resumeData) {
  if (!resumeData || typeof resumeData !== 'object') {
    throw badRequest('resumeData is required.');
  }
  const { fullName, qualifications, experience, personalInfo } = resumeData;

  if (!fullName) throw badRequest('fullName is required.');
  if (!qualifications) throw badRequest('qualifications is required.');
  if (!experience) throw badRequest('experience is required.');
  if (!personalInfo) throw badRequest('personalInfo is required.');
}

async function createResumePurchase({ userId, email, resumeData, photoUrl }) {
  ensureEmailPresent(email);
  validateResumeInput(resumeData);

  // Create resume record first; payment happens later after OTP verification.
  const resume = await Resume.create({
    userId,
    resumeData,
    photoUrl: photoUrl || null,
    status: 'otp_pending',
    otpVerifiedAt: null,
  });

  // Issue OTP challenge
  const existing = await ResumeOtpVerification.findOne({ userId, email }).sort({ createdAt: -1 });
  const now = new Date();

  if (existing?.lastOtpSentAt) {
    const delta = now.getTime() - existing.lastOtpSentAt.getTime();
    if (delta < OTP_RESEND_COOLDOWN_MS) {
      throw forbidden('OTP resend is too frequent. Please try again shortly.');
    }
  }

  // Invalidate previous OTP
  if (existing && !existing.otpConsumed) {
    existing.otpConsumed = true;
    await existing.save();
  }

  const otp = generateOtp();
  const otpHash = await hashOtp(otp);
  const otpExpiresAt = new Date(Date.now() + OTP_TTL_MS);

  const doc = existing || new ResumeOtpVerification({ userId, email });
  doc.otpHash = otpHash;
  doc.otpExpiresAt = otpExpiresAt;
  doc.otpAttempts = 0;
  doc.maxOtpVerifyAttempts = MAX_OTP_VERIFY_ATTEMPTS;
  doc.otpConsumed = false;
  doc.lastOtpSentAt = now;
  await doc.save();

  // Send email OTP
  await sendOtpEmail({ toEmail: email, otp, toName: resumeData?.fullName || '' });

  return { resumeId: resume._id, otpExpiresAt };
}

async function verifyResumeOtp({ userId, email, otp, resumeId }) {
  ensureEmailPresent(email);

  const resume = await Resume.findOne({ _id: resumeId, userId });
  if (!resume) throw notFound('Resume not found.');

  const record = await ResumeOtpVerification.findOne({ userId, email }).sort({ createdAt: -1 });
  if (!record || !record.otpHash) throw badRequest('Invalid or expired OTP.');
  if (record.otpConsumed) throw badRequest('Invalid or expired OTP.');
  if (!record.otpExpiresAt || record.otpExpiresAt.getTime() < Date.now()) {
    throw badRequest('Invalid or expired OTP.');
  }
  if (record.otpAttempts >= record.maxOtpVerifyAttempts) {
    throw forbidden('Too many incorrect OTP attempts. Please request a new OTP.');
  }

  const isCorrect = await verifyOtpAgainstHash(otp, record.otpHash);
  record.otpAttempts = (record.otpAttempts || 0) + 1;

  if (!isCorrect) {
    await record.save();
    throw badRequest('Invalid or expired OTP.');
  }

  record.otpConsumed = true;
  await record.save();

  resume.otpVerifiedAt = new Date();
  resume.status = 'otp_verified';
  await resume.save();

  return { verified: true };
}

async function markResumePaymentAndGenerate({ resumeId, userId, razorpayPayload, paymentMeta }) {
  const resume = await Resume.findOne({ _id: resumeId, userId });
  if (!resume) throw notFound('Resume not found.');

  if (resume.status === 'generated') {
    return { alreadyGenerated: true, resumePdfPath: resume.resumePdfPath };
  }

  if (!resume.otpVerifiedAt) {
    throw forbidden('OTP not verified yet.');
  }

  resume.status = 'paid_not_generated';
  resume.payment = {
    ...(resume.payment || {}),
    transactionId: paymentMeta?.transactionId || null,
    razorpayOrderId: razorpayPayload.razorpayOrderId || null,
    razorpayPaymentId: razorpayPayload.razorpayPaymentId || null,
    razorpaySignature: razorpayPayload.razorpaySignature || null,
    paidAt: new Date(),
  };
  await resume.save();

  // Generate resume artifact after successful payment verification.
  const safeUserFolder = String(userId).slice(0, 10);
  const baseDir = path.join(process.cwd(), 'uploads', 'resumes', safeUserFolder);
  if (!fs.existsSync(baseDir)) fs.mkdirSync(baseDir, { recursive: true });

  const outBasePath = path.join(baseDir, `resume_${resumeId}`);
  const pdfPath = await generateResumePdf({
    resumeData: resume.resumeData,
    photoUrl: resume.photoUrl,
    userName: resume.resumeData?.fullName,
    outputPath: outBasePath,
  });

  resume.resumePdfPath = pdfPath;
  resume.status = 'generated';
  await resume.save();

  return { resumePdfPath: resume.resumePdfPath, resumeId: resume._id };
}

module.exports = {
  createResumePurchase,
  verifyResumeOtp,
  markResumePaymentAndGenerate,
};

