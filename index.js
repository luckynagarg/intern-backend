/**
 * Main backend entry point.
 *
 * Responsibilities:
 * - Configure CORS and body parsing
 * - Install global middleware (rate limiting)
 * - Mount feature routes under /api
 * - Install centralized error handler
 * - Connect to MongoDB
 */
const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const { connect } = require("./db");
const router = require("./Routes/index");
const { errorHandler } = require("./middleware/errorHandler");

const app = express();

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

// Body parsing
app.use(bodyParser.json({ limit: "50mb" }));
app.use(bodyParser.urlencoded({ extended: true, limit: "50mb" }));
app.use(express.json());

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

// Start server even if Mongo is unavailable.
(async () => {
  const result = await connect();
  app.locals.mongoAvailable = !!result?.mongoAvailable;

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





