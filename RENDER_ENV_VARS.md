# Render environment variables (Firebase Admin)

## Required

- `FIREBASE_SERVICE_ACCOUNT`
  - Raw JSON string for the Firebase Admin service account.

OR

- `FIREBASE_PROJECT_ID`
- `FIREBASE_CLIENT_EMAIL`
- `FIREBASE_PRIVATE_KEY`
  - The private key may be provided with escaped newlines; the backend will restore them.

## Also required for protected endpoints

- `DATABASE_URL`
  - MongoDB connection string. Without it, `db.js` logs "Mongo will be treated as unavailable"
    and protected routes that query the DB will return 500.
  - **Must start with `mongodb://` or `mongodb+srv://`.** If Render logs
    `Invalid scheme, expected connection string to start with "mongodb://" or "mongodb+srv://"`,
    the `DATABASE_URL` value is not a valid MongoDB URI. Fix it in
    Render dashboard > your service > Environment > `DATABASE_URL`.
  - Example (MongoDB Atlas): `mongodb+srv://<user>:<password>@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority`
  - The backend now validates the scheme at startup and prints an actionable message
    (`DATABASE_URL is not a valid MongoDB connection string...`) before exiting in production.

## Troubleshooting 500s on protected endpoints

`GET /api/notifications`, `GET /api/resume/my-resumes`, and `GET /api/login/history`
all pass through `verifyFirebaseIdToken`. If you see 500s there, check the Render
startup logs for:

- `[startup] Firebase Admin NOT initialized: <reason>` -> set the Firebase Admin env vars above.
- `[startup] MongoDB is NOT available...` -> set `DATABASE_URL`.

After the hardening fix, a misconfigured Firebase Admin returns **503**
("Authentication service is not configured") instead of a generic 500, making the
root cause unmistakable.

## How to obtain the Firebase Admin service account

1. Go to the Firebase Console > Project Settings > Service accounts.
2. Click "Generate new private key" to download a JSON file.
3. Copy the entire JSON contents into `FIREBASE_SERVICE_ACCOUNT` on Render.
   (If you prefer individual vars, use `project_id`, `client_email`, and `private_key`
   from that JSON as `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`.)
4. Ensure the private key's newlines are escaped (Render/CI often store them as `\n`).
