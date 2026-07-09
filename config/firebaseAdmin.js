const admin = require('firebase-admin');

function getServiceAccountFromEnv() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) return null;

  // Some platforms may provide escaped newlines; Firebase service account JSON expects real \n.
  const normalized = String(raw).replace(/\\n/g, '\n');

  try {
    return JSON.parse(normalized);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `[firebaseAdmin] Failed to JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT): ${message}`
    );
  }
}


function initFirebaseAdmin() {
  // Initialize Firebase Admin only once.
  if (admin.apps.length) return admin;

  const serviceAccount = getServiceAccountFromEnv();
  if (!serviceAccount) {
    // On Render, missing/invalid FIREBASE_SERVICE_ACCOUNT is fatal for auth.
    // We return uninitialized admin so callers can handle it (and we avoid crashes).
    console.warn(
      '[firebaseAdmin] Missing FIREBASE_SERVICE_ACCOUNT. Firebase Admin will not be initialized.'
    );
    return admin;
  }

  const credential = admin.credential.cert(serviceAccount);

  admin.initializeApp({
    credential,
  });

  return admin;
}

function assertFirebaseAdminInitialized() {
  // Useful for auth middleware to distinguish misconfiguration (should be 500) vs bad token (401).
  if (!admin.apps.length) {
    throw new Error('[firebaseAdmin] Firebase Admin is not initialized');
  }
}


module.exports = { initFirebaseAdmin, admin };


