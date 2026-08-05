const admin = require('firebase-admin');

function safeParseServiceAccountJSON(raw) {
  if (!raw) return null;
  if (typeof raw !== 'string') return raw;

  const trimmed = raw.trim();
  if (!trimmed) return null;

  // Support escaped newlines in private_key (\n)
  const normalized = trimmed.replace(/\\n/g, "\n");
  return JSON.parse(normalized);
}

function getRequiredCertFromEnvOrThrow() {
  // Support either:
  // 1) FIREBASE_SERVICE_ACCOUNT: full JSON string
  // 2) Individual vars: FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY

  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT;

  if (serviceAccountJson) {
    let parsed;
    try {
      parsed = safeParseServiceAccountJSON(serviceAccountJson);
    } catch (e) {
      throw new Error(
        '[firebaseAdmin] FIREBASE_SERVICE_ACCOUNT is not valid JSON (private_key newlines supported).'
      );
    }

    const missing = [];
    if (!parsed?.project_id) missing.push('project_id');
    if (!parsed?.client_email) missing.push('client_email');
    if (!parsed?.private_key) missing.push('private_key');

    if (missing.length) {
      throw new Error(
        `[firebaseAdmin] FIREBASE_SERVICE_ACCOUNT JSON is missing required fields: ${missing.join(
          ', '
        )}.`
      );
    }

    return {
      project_id: parsed.project_id,
      client_email: parsed.client_email,
      private_key: parsed.private_key,
    };
  }

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  let privateKey = process.env.FIREBASE_PRIVATE_KEY;

  const missing = [];
  if (!projectId) missing.push('FIREBASE_PROJECT_ID');
  if (!clientEmail) missing.push('FIREBASE_CLIENT_EMAIL');
  if (!privateKey) missing.push('FIREBASE_PRIVATE_KEY');

  if (missing.length) {
    throw new Error(
      `[firebaseAdmin] Missing required Firebase Admin credentials in env. Provide either FIREBASE_SERVICE_ACCOUNT, or all of: ${missing.join(
        ', '
      )}.`
    );
  }

  // Restore newlines in Render/CI where private keys are stored as escaped \n.
  privateKey = privateKey.replace(/\\n/g, "\n");

  return {
    project_id: projectId,
    client_email: clientEmail,
    private_key: privateKey,
  };
}

function initFirebaseAdmin() {
  // Initialize exactly once.
  if (admin.apps && admin.apps.length > 0) return admin;

  const cert = getRequiredCertFromEnvOrThrow();

  // Never log secrets.
  admin.initializeApp({
    credential: admin.credential.cert(cert),
  });

  return admin;
}

function getAdminOrThrow() {
  // Fail fast with clear startup error.
  try {
    return initFirebaseAdmin();
  } catch (e) {
    throw new Error(
      e?.message
        ? e.message
        : '[firebaseAdmin] Firebase Admin initialization failed due to invalid/missing environment credentials.'
    );
  }
}

module.exports = { initFirebaseAdmin, admin, getAdminOrThrow };

