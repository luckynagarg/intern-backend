# Render environment variables (Firebase Admin)

## Required

- `FIREBASE_SERVICE_ACCOUNT`
  - Raw JSON string for the Firebase Admin service account.

OR

- `FIREBASE_PROJECT_ID`
- `FIREBASE_CLIENT_EMAIL`
- `FIREBASE_PRIVATE_KEY`
  - The private key may be provided with escaped newlines; the backend will restore `\\n` -> `\n`.

