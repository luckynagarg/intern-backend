const Razorpay = require('razorpay');

function getRazorpayInstance() {
  const mode = (process.env.RAZORPAY_MODE || 'test').toLowerCase();
  const isLive = mode === 'live';

  const key_id = process.env.RAZORPAY_KEY_ID;
  const key_secret = process.env.RAZORPAY_KEY_SECRET;

  if (!key_id || !key_secret) {
    throw new Error('Razorpay credentials are not set in environment variables.');
  }

  // Razorpay constructor uses creds; mode is determined by test/live keys.
  // Keeping compatibility via env flag only.
  return new Razorpay({
    key_id,
    key_secret,
  });
}

module.exports = { getRazorpayInstance };

