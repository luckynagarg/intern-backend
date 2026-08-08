const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

/**
 * Safely parse Firebase service-account JSON.
 *
 * Supports:
 * 1. Normal JSON
 * 2. JSON stored in Render environment variables
 * 3. Literal \n inside private_key
 */
function safeParseServiceAccountJSON(raw) {
  if (!raw) {
    return null;
  }

  if (typeof raw !== 'string') {
    return raw;
  }

  const trimmed = raw.trim();

  if (!trimmed) {
    return null;
  }

  // Convert literal "\n" characters into real newlines.
  const normalized = trimmed.replace(/\\n/g, '\n');

  return JSON.parse(normalized);
}

/**
 * Load Firebase service-account credentials from a file.
 *
 * Mainly useful for local development.
 * Render production should preferably use FIREBASE_SERVICE_ACCOUNT.
 */
function readServiceAccountFromPath() {
  const rawPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;

  if (!rawPath) {
    return null;
  }

  let resolved = String(rawPath).trim();

  // Resolve relative paths from backend root.
  if (!/^([a-zA-Z]:[\\/]|\/)/.test(resolved)) {
    resolved = path.join(__dirname, '..', resolved);
  }

  if (!fs.existsSync(resolved)) {
    throw new Error(
      `[firebaseAdmin] FIREBASE_SERVICE_ACCOUNT_PATH points to a missing file: ${resolved}`
    );
  }

  try {
    return JSON.parse(fs.readFileSync(resolved, 'utf8'));
  } catch (error) {
    throw new Error(
      '[firebaseAdmin] Firebase service-account file contains invalid JSON.'
    );
  }
}

/**
 * Get Firebase Admin credentials.
 *
 * Priority:
 * 1. FIREBASE_SERVICE_ACCOUNT
 * 2. FIREBASE_SERVICE_ACCOUNT_PATH
 * 3. Individual environment variables
 */
function getRequiredCertFromEnvOrThrow() {
  // =========================================================
  // OPTION 1: Complete Firebase service-account JSON
  // =========================================================

  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT;

  if (serviceAccountJson) {
    let parsed;

    try {
      parsed = safeParseServiceAccountJSON(serviceAccountJson);
    } catch (error) {
      throw new Error(
        '[firebaseAdmin] FIREBASE_SERVICE_ACCOUNT is not valid JSON.'
      );
    }

    if (!parsed || typeof parsed !== 'object') {
      throw new Error(
        '[firebaseAdmin] FIREBASE_SERVICE_ACCOUNT must contain a JSON object.'
      );
    }

    const missing = [];

    if (!parsed.project_id) {
      missing.push('project_id');
    }

    if (!parsed.client_email) {
      missing.push('client_email');
    }

    if (!parsed.private_key) {
      missing.push('private_key');
    }

    if (missing.length > 0) {
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

  // =========================================================
  // OPTION 2: Firebase service-account JSON file
  // =========================================================

  const fromPath = readServiceAccountFromPath();

  if (fromPath) {
    const missing = [];

    if (!fromPath.project_id) {
      missing.push('project_id');
    }

    if (!fromPath.client_email) {
      missing.push('client_email');
    }

    if (!fromPath.private_key) {
      missing.push('private_key');
    }

    if (missing.length > 0) {
      throw new Error(
        `[firebaseAdmin] Service account file is missing required fields: ${missing.join(
          ', '
        )}.`
      );
    }

    return {
      project_id: fromPath.project_id,
      client_email: fromPath.client_email,
      private_key: fromPath.private_key,
    };
  }

  // =========================================================
  // OPTION 3: Individual Firebase environment variables
  // =========================================================

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  let privateKey = process.env.FIREBASE_PRIVATE_KEY;

  const missing = [];

  if (!projectId) {
    missing.push('FIREBASE_PROJECT_ID');
  }

  if (!clientEmail) {
    missing.push('FIREBASE_CLIENT_EMAIL');
  }

  if (!privateKey) {
    missing.push('FIREBASE_PRIVATE_KEY');
  }

  if (missing.length > 0) {
    throw new Error(
      `[firebaseAdmin] Missing Firebase Admin credentials. Provide FIREBASE_SERVICE_ACCOUNT, FIREBASE_SERVICE_ACCOUNT_PATH, or all of: ${missing.join(
        ', '
      )}.`
    );
  }

  // Convert literal "\n" characters into real newlines.
  privateKey = privateKey.replace(/\\n/g, '\n');

  return {
    project_id: projectId,
    client_email: clientEmail,
    private_key: privateKey,
  };
}

/**
 * Initialize Firebase Admin exactly once.
 */
function initFirebaseAdmin() {
  // Prevent multiple Firebase Admin initializations.
  if (
    typeof admin.getApps === 'function' &&
    admin.getApps().length > 0
  ) {
    return admin;
  }

  const cert = getRequiredCertFromEnvOrThrow();

  // Never log Firebase credentials.
  admin.initializeApp({
    credential: admin.credential.cert(cert),
  });

  return admin;
}

/**
 * Return Firebase Admin or throw a clear configuration error.
 */
function getAdminOrThrow() {
  try {
    return initFirebaseAdmin();
  } catch (error) {
    throw new Error(
      error?.message ||
        '[firebaseAdmin] Firebase Admin initialization failed due to invalid or missing credentials.'
    );
  }
}

module.exports = {
  initFirebaseAdmin,
  getAdminOrThrow,
  admin,
};