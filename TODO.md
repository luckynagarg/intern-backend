# Backend Production Audit & Fix Tracking

Task: Resolve 503 on protected endpoints, Firebase Admin init failure, and MongoDB buffering timeout.

## Confirmed Root Causes
1. **Missing Firebase Admin credentials on Render** — `getRequiredCertFromEnvOrThrow()` throws because
   `FIREBASE_SERVICE_ACCOUNT` / `FIREBASE_PROJECT_ID`+`FIREBASE_CLIENT_EMAIL`+`FIREBASE_PRIVATE_KEY` are not set.
   In `authFirebase.js`, that throw is converted to a **503** via `serviceUnavailable(...)`.
2. **MongoDB never connects** — `DATABASE_URL` is missing/failing; `mongoose.connect()` has no
   `serverSelectionTimeoutMS`, so queries buffer 10s then throw `Operation ... buffering timed out after 10000ms`.

## Fix Checklist
- [x] 1. Add `require('dotenv').config()` at the very top of `index.js` so env vars load before any module reads them.
- [x] 2. Fix `package.json` start script: `node index.js` (production) instead of `nodemon index.js`.
- [x] 3. Harden `db.js`: add `serverSelectionTimeoutMS` and `bufferCommands: false` so connection failures surface fast.
- [x] 4. Fix startup order in `index.js`: `await connect()` before `app.listen`; fail fast in production if Mongo is down.
- [x] 5. Add `unhandledRejection` / `uncaughtException` handlers to avoid silent process crashes.
- [ ] 6. Deployment (operator action): set Render env vars (FIREBASE_*, DATABASE_URL, RESEND_*, OTP_HMAC_SECRET, RAZORPAY_*) and redeploy.

## Non-goals (per user moderation)
- No speculative route restructuring.
- No global buffering disable beyond `bufferCommands: false` on the connection (justified by the timeout symptom).
- No deprecated Mongoose options (`useNewUrlParser` / `useUnifiedTopology`).

## Verification (completed)
- [x] All modified files pass `node --check` syntax validation.
- [x] Module graph loads cleanly: `/api` routes mounted (22 entries), `authFirebase` + `firebaseAdmin` load as functions.
- [x] `db.js` `connect()` returns `{mongoAvailable:false, reason:"missing DATABASE_URL"}` when no URI.
- [x] Server boots successfully: `✅ Database is connected` (a `.env` DATABASE_URL is present), Firebase Admin correctly reports missing creds, `Server running on port 5000`.
- [x] New `uncaughtException` guard caught an `EADDRINUSE` (port 5000) gracefully instead of crashing.
- [ ] ACTION REQUIRED: The currently-running server (PID 15132, started with old `node index.js`) must be restarted to load the fixed code. Deploy the Render env vars (FIREBASE_*, RESEND_*, OTP_HMAC_SECRET, RAZORPAY_*) and redeploy.
