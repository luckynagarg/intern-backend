/**
 * Firebase Authentication middleware.
 *
 * This verifies the Firebase ID token sent by the frontend and attaches
 * a trusted user identity to req.user.
 *
 * Security goal:
 * Never trust user identity from req.body; always derive userId from
 * verified tokens.
 */
const asyncHandler = require('./../middleware/asyncHandler');
const { initFirebaseAdmin } = require('./../config/firebaseAdmin');
const { unauthorized } = require('./../utils/httpErrors');

// Initialize Firebase Admin once (lazy). Avoid eager init so dev can start without creds.
// auth requirements will trigger initialization when the middleware is actually used.
// (initFirebaseAdmin() will warn and keep firebase-admin uninitialized if creds are missing.)


/**
 * Express middleware that verifies Firebase ID tokens.
 *
 * Expected header:
 *   Authorization: Bearer <firebaseIdToken>
 */
const verifyFirebaseIdToken = asyncHandler(async (req, res, next) => {
  const header = req.headers.authorization;

  if (!header || !header.startsWith('Bearer ')) {
    // A missing/invalid header is a client error, not server error.
    throw unauthorized('Missing Authorization header. Expected: Bearer <Firebase_ID_Token>');
  }

  const token = header.slice('Bearer '.length).trim();
  if (!token) throw unauthorized('Missing Firebase ID token.');

  // Decode & verify the token signature.
  // This is the critical step that guarantees req.user.uid is authentic.
  // Ensure firebase-admin is initialized when this middleware is actually used.
  try {
    initFirebaseAdmin();
  } catch (err) {
    // Misconfiguration should be treated as server error.
    console.error('authFirebase initFirebaseAdmin failed:', err);
    throw err;
  }

  try {
    const decoded = await require('firebase-admin').auth().verifyIdToken(token);

    if (!decoded || !decoded.uid) {
      throw unauthorized('Invalid Firebase token.');
    }

    // Attach a minimal, trusted identity object for downstream handlers.
    // Include admin-ish flags if present in custom claims.
    req.user = {
      uid: decoded.uid,
      email: decoded.email || null,
      name: decoded.name || null,
      claims: decoded,
      isAdmin:
        decoded?.admin === true ||
        decoded?.isAdmin === true ||
        decoded?.role === "admin",
      admin: decoded?.admin === true,
    };

    return next();
  } catch (err) {
    // IMPORTANT: token verification errors should never become 500s.
    // Treat anything from verifyIdToken as an auth failure.
    const msg = err?.message ? String(err.message) : 'Invalid Firebase token.';
    console.warn('authFirebase verifyIdToken failed:', msg);
    throw unauthorized('Invalid or expired Firebase token.');
  }

});



module.exports = { verifyFirebaseIdToken };


