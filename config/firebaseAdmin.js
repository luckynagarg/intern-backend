const admin = require('firebase-admin');

let initialized = false;

function initFirebaseAdmin() {
  if (initialized) return admin;

  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;

  // In local dev/test environments, Firebase Admin credentials may be absent.
  // Avoid crashing the entire server; consumers will fail with clear runtime
  // errors when they actually need Firebase Admin.
  if (!serviceAccountJson && !serviceAccountPath) {
    console.warn(
      "[firebaseAdmin] Missing FIREBASE_SERVICE_ACCOUNT_JSON or FIREBASE_SERVICE_ACCOUNT_PATH. Firebase Admin will not be initialized."
    );
    return admin;
  }


  let credential;
  if (serviceAccountJson) {
    const parsed = JSON.parse(serviceAccountJson);
    credential = admin.credential.cert(parsed);
  } else {
    // Lazy require so dev without file doesn't crash module load.
    const sa = require(serviceAccountPath);
    credential = admin.credential.cert(sa);
  }

  admin.initializeApp({
    credential,
  });

  initialized = true;
  return admin;
}

module.exports = { initFirebaseAdmin, admin };

