/**
 * Main backend entry point.
 *
 * Responsibilities:
 * - Configure CORS and body parsing
 * - Install global middleware (rate limiting)
 * - Mount feature routes under /api
 * - Install centralized error handler
 * - Connect to MongoDB
 * - Validate SMTP configuration and verify email transport on startup
 */
// Load environment variables FIRST so every module (db, firebaseAdmin, services)
// reading process.env at require-time sees the correct values.
require("dotenv").config();

const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const { connect } = require("./db");
const router = require("./Routes/index");
const { errorHandler } = require("./middleware/errorHandler");
const { validateResendEnvVars } = require("./services/emailService");

const app = express();

// Security headers via helmet (production-grade defaults)
const helmet = require("helmet");
app.use(helmet());

// Global process-level error guards.
// Prevents a single unhandled promise rejection / uncaught exception from
// silently crashing the process (which Render would report as 503/unavailable).
process.on("unhandledRejection", (reason, promise) => {
  console.error("[process] Unhandled Rejection at:", promise, "reason:", reason);
});

process.on("uncaughtException", (err) => {
  console.error("[process] Uncaught Exception:", err?.stack || err);
});

// Render / Express proxy deployments require trust proxy for correct client IP handling.
// This prevents issues with rate-limit / forwarded-for parsing.
app.set('trust proxy', 1);


const port = process.env.PORT || 5000;

const environment = process.env.NODE_ENV || "development";

// CORS allowlist
// - FRONTEND_URL / CORS_ORIGIN (single) are treated as an extra value if provided.
// - CORS_ALLOWED_ORIGINS can provide a comma-separated full list and takes precedence.
const frontendUrl = process.env.FRONTEND_URL || process.env.CORS_ORIGIN;

const corsAllowedOriginsFromEnv = process.env.CORS_ALLOWED_ORIGINS
  ? process.env.CORS_ALLOWED_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean)
  : [];

const defaultAllowedOrigins = [
  "http://localhost:3000",
  "http://127.0.0.1:3000",
];

// Ensure Render frontend (if provided) can pass without custom env wiring.
// (Does not break existing deployments; harmless if unused.)
const renderFrontendFallback = "https://internshala-clone-y2p2.onrender.com";



const allowedOriginsSet = new Set([

  ...(corsAllowedOriginsFromEnv.length ? corsAllowedOriginsFromEnv : defaultAllowedOrigins),
  ...(frontendUrl ? [frontendUrl] : []),
  // keep historical value (harmless if not used)
  "https://internarea-nine.vercel.app",
  ...(renderFrontendFallback ? [renderFrontendFallback] : []),
]);


const allowedOrigins = Array.from(allowedOriginsSet);

// Always apply CORS middleware first
const corsOptions = {
  origin: function (origin, callback) {
    // non-browser requests (no Origin) should pass
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);

    // If not allowed, still allow request to reach routes so we can return JSON.
    // CORS headers will not be set, so browsers will block (correct behavior).
    return callback(null, false);
  },

  methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "Accept",
    "X-Requested-With",
  ],
  credentials: true,
  optionsSuccessStatus: 204,
};

app.use(cors(corsOptions));
app.options("*", cors(corsOptions));

// Ensure Access-Control-* headers exist for ALL responses (including 404/500 and errors)
// by applying an early middleware that sets allow headers when Origin is allowlisted.
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (!origin) return next();

  if (allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader(
      "Access-Control-Allow-Methods",
      "GET,POST,PUT,DELETE,PATCH,OPTIONS"
    );
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type,Authorization,Accept,X-Requested-With"
    );

    // credentials=true requires explicit allow-credentials
    res.setHeader("Access-Control-Allow-Credentials", "true");
  }

  return next();
});

// Raw body middleware for webhook signature verification
const { rawBodyMiddleware } = require('./middleware/rawBody');
app.post('/api/subscriptions/webhook', rawBodyMiddleware);

// Body parsing
app.use(bodyParser.json({ limit: "50mb" }));
app.use(bodyParser.urlencoded({ extended: true, limit: "50mb" }));


const buildRateLimiter = require("./middleware/rateLimit");
app.use(buildRateLimiter());

// Basic health routes
app.get("/", (req, res) => {
  res.send("backend running");
});

app.get("/api/health", (req, res) => {
  res.json({ ok: true, routes: ["/api/job", "/api/internship"] });
});

// Diagnostic endpoint for deployed route mounting
app.get("/api/routes", (req, res) => {
  res.json({
    ok: true,
    environment,
    mounted: {
      "GET /api/job": "handled",
      "POST /api/job": "handled",
      "GET /api/job/:id": "handled",
      "GET /api/internship": "handled",
      "POST /api/internship": "handled",
      "GET /api/internship/:id": "handled",
      "GET /api/application": "handled",
      "POST /api/application": "handled",
      "GET /api/public": "handled",
    },
  });
});

app.use("/api", router);

// Error handler must be after routes
app.use(errorHandler);

// Connect to MongoDB BEFORE listening. In production, fail fast if Mongo is down
// so Render restarts the service and we never serve traffic against an unconnected DB.
(async () => {
  const result = await connect();
  app.locals.mongoAvailable = !!result?.mongoAvailable;

  if (!result?.mongoAvailable) {
    const reason = result?.reason || 'unknown';
    console.warn(
      '[startup] MongoDB is NOT available. Reason:',
      reason
    );

    // In production, a missing/unreachable database is a fatal startup condition.
    // Render will see the non-zero exit and mark the deploy as failed, signalling
    // the operator to fix DATABASE_URL before traffic is served.
    if (process.env.NODE_ENV === 'production') {
      console.error('[startup] Fatal: MongoDB unavailable in production. Exiting.');
      process.exit(1);
    }
  }

  // Validate Firebase Admin environment on startup.
  // If Firebase Admin can't initialize, every protected route will fail with 503.
  try {
    const { getAdminOrThrow } = require('./config/firebaseAdmin');
    getAdminOrThrow();
    console.log('[startup] Firebase Admin: initialized OK');
  } catch (err) {
    console.warn('[startup] Firebase Admin NOT initialized:', err.message);
    console.warn('[startup] Protected routes (/api/notifications, /api/resume/my-resumes, /api/login/history, etc.) will return 503 until Firebase Admin env vars are set.');
  }

  // Validate Resend environment variables on startup.
  // This ensures email system is operational before accepting requests.
  try {
    validateResendEnvVars();
    console.log('[startup] Resend environment variables: OK');
  } catch (err) {
    console.warn('[startup] Resend configuration issue:', err.message);
    console.warn('[startup] Email sending will fail until Resend is configured correctly.');
    // Do NOT block server start. Resend misconfiguration is non-fatal for the API,
    // but email-dependent features will log errors on use.
  }

  console.log(`Server running on port ${port}`);
  console.log(`Environment: ${environment}`);
  console.log(`Allowed CORS origins: ${JSON.stringify(allowedOrigins)}`);
  console.log(
    `Mounted diagnostic routes: /api/routes, /api/health, /api/job, /api/internship`
  );

  app.listen(port, () => {
    console.log(`Listening on ${port}`);
  });
})();
