# Backend Production Audit & Fix Tracking

Task: Resolve 503 on protected endpoints, Firebase Admin init failure, and MongoDB buffering timeout.

## Confirmed Root Causes
1. **Missing Firebase Admin credentials on Render** — `getRequiredCertFromEnvOrThrow()` throws because
   `FIREBASE_SERVICE_ACCOUNT` / `FIREBASE_PROJECT_ID`+`FIREBASE_CLIENT_EMAIL`+`FIREBASE_PRIVATE_KEY` are not set.
   In `authFirebase.js`, that throw is converted to a **503** via `serviceUnavailable(...)`.
2. **MongoDB never connects** — `DATABASE_URL` is missing/failing; `mongoose.connect()` had no
   `serverSelectionTimeoutMS`, so queries buffer 10s then throw `Operation ... buffering timed out after 10000ms`.

## CRITICAL Env Var Mismatch
- Backend `.env` defines `FIREBASE_SERVICE_ACCOUNT_PATH` (a file path).
- `config/firebaseAdmin.js` reads `FIREBASE_SERVICE_ACCOUNT` (JSON string) OR the three individual vars.
- **`FIREBASE_SERVICE_ACCOUNT_PATH` is never read anywhere in the code** (confirmed via search).
- Therefore Firebase Admin will ALWAYS fail to initialize regardless of `.env`, producing 503 on protected routes.
- Fix: set the correct var on Render:
  - `FIREBASE_SERVICE_ACCOUNT` = full JSON string, OR
  - `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY` (all three).

## Backend env vars needed on Render
- `DATABASE_URL` (or `MONGO_URI`) — MongoDB connection string.
- `FIREBASE_SERVICE_ACCOUNT` (JSON) OR the 3 individual vars.
- `RESEND_API_KEY`, `EMAIL_FROM`, `EMAIL_FROM_NAME`.
- `OTP_HMAC_SECRET`.
- `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_CURRENCY`.
- `PORT` (Render sets automatically), `NODE_ENV=production`.

## Fix Checklist
- [x] 1. Add `require('dotenv').config()` at the very top of `index.js`.
- [x] 2. Fix `package.json` start script: `node index.js`; add `dev` script for nodemon.
- [x] 3. Harden `db.js`: add `serverSelectionTimeoutMS` and `bufferCommands: false`.
- [x] 4. Fix startup order in `index.js`: fail fast in production if Mongo is down.
- [x] 5. Add `unhandledRejection` / `uncaughtException` handlers.
- [ ] 6. Deployment: set correct Render env vars (see above). **Must fix `FIREBASE_SERVICE_ACCOUNT_PATH` → `FIREBASE_SERVICE_ACCOUNT`/individual vars.**

## Non-goals (per user moderation)
- No route restructuring.
- No global buffering disable beyond `bufferCommands: false` (justified by timeout symptom).
- No deprecated Mongoose options.
</content>
