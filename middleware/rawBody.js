const getRawBody = (req) => {
  // Express may not provide rawBody by default; we buffer manually.
  // Note: this middleware must be registered before body-parser/json.
  return new Promise((resolve, reject) => {
    let data = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      data += chunk;
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
};

// Middleware to attach raw body to req.rawBody.
// Intended for signature verification endpoints (e.g., Razorpay webhooks).
function rawBodyMiddleware(req, res, next) {
  if (req.method !== 'POST' && req.method !== 'PUT' && req.method !== 'PATCH') {
    return next();
  }

  getRawBody(req)
    .then((raw) => {
      req.rawBody = raw;
      next();
    })
    .catch(() => {
      res.status(400).json({ success: false, error: 'Unable to read raw request body' });
    });
}

module.exports = { rawBodyMiddleware };

