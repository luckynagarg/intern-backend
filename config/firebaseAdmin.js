const admin = require('firebase-admin');

let initialized = false;

function safeParseServiceAccountJSON(raw) {
  if (!raw) return null;
  if (typeof raw !== 'string') return raw;

  const trimmed = raw.trim();
  if (!trimmed) return null;

  // Support escaped newlines in private_key (\n)
  const normalized = trimmed.replace(/\\n/g, '\n');

  return JSON.parse(normalized);
}

function initFirebaseAdmin() {
  if (initialized) return admin;

  // REQUIRED: only env var. No local JSON file imports.
  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT;

  if (!serviceAccountJson) {
    const msg =
      '[firebaseAdmin] Missing FIREBASE_SERVICE_ACCOUNT env var. Firebase Admin was not initialized.';
    console.error(msg);
    return admin;
  }

  let parsed;
  try {
    parsed = safeParseServiceAccountJSON(serviceAccountJson);
  } catch (e) {
    const msg =
      '[firebaseAdmin] FIREBASE_SERVICE_ACCOUNT is not valid JSON (private_key newlines supported).';
    console.error(msg, e);
    return admin;
  }

  if (!parsed || !parsed.project_id || !parsed.client_email || !parsed.private_key) {
    const msg =
      '[firebaseAdmin] FIREBASE_SERVICE_ACCOUNT JSON is missing required fields: project_id, client_email, private_key.';
    console.error(msg);
    return admin;
  }

  admin.initializeApp({
    credential: admin.credential.cert(parsed),
  });

  initialized = true;
  return admin;
}

module.exports = { initFirebaseAdmin, admin };


