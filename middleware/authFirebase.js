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
const { getAdminOrThrow } = require('./../config/firebaseAdmin');

const { unauthorized, serviceUnavailable } = require('./../utils/httpErrors');

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

  // Temporary detailed logs for auth auditing.
  // Do NOT log full token.
  console.log('[authFirebase] Authorization header received:', !!header);
  if (header && typeof header === 'string') {
    console.log('[authFirebase] Authorization header prefix:', header.slice(0, 12));
  }

  const hasBearer = !!header && header.startsWith('Bearer ');
  console.log('[authFirebase] Bearer token exists:', hasBearer);

  if (!hasBearer) {
    // A missing/invalid header is a client error, not server error.
    throw unauthorized(
      'Missing Authorization header or invalid format (expected: Bearer <token>).'
    );
  }

  const token = header.slice('Bearer '.length).trim();
  console.log('[authFirebase] token length:', token?.length || 0);
  if (!token) throw unauthorized('Missing Firebase ID token (after Bearer).');

  // Decode & verify the token signature.
  // This is the critical step that guarantees req.user.uid is authentic.
  // Ensure firebase-admin is initialized when this middleware is actually used.
  let admin;
  try {
    admin = getAdminOrThrow();
  } catch (e) {
    // Firebase Admin credentials missing/malformed on the deployment.
    // Fail fast with a clear 503 (Service Unavailable) instead of a generic 500,
    // so the root cause is obvious to both the client and in the logs.
    console.error('[authFirebase] Firebase Admin not initialized:', e?.message);
    throw serviceUnavailable(
      'Authentication service is not configured. Contact the administrator.'
    );
  }

  let decoded;

  try {
    decoded = await admin.auth().verifyIdToken(token);

    console.log('[authFirebase] verifyIdToken SUCCESS');
    console.log('[authFirebase] decoded uid:', decoded?.uid || null);
  } catch (e) {
    const code = e && e.code ? e.code : null;
    const msg = (e && (e.message || e.toString())) || 'unknown error';

    console.log('[authFirebase] verifyIdToken FAILURE');
    console.log('[authFirebase] error code:', code);
    console.log('[authFirebase] error message:', msg);

    // If firebase-admin wasn't initialized due to missing env vars,
    // return a clear client error instead of crashing.
    throw unauthorized(`Firebase token verification failed: code=${code || 'unknown'} message=${msg}`);
  }

  if (!decoded || !decoded.uid) {
    console.log('[authFirebase] decoded missing uid');
    throw unauthorized('Invalid Firebase token: missing uid/claims.');
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
});

module.exports = { verifyFirebaseIdToken };
