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

// CORS allowlist (fail-closed for browser requests)
// Dev/preview origins should be provided via env.
// Comma-separated, e.g.:
//   CORS_ALLOWED_ORIGINS=http://localhost:3000,http://127.0.0.1:3000,https://internarea-nine.vercel.app
const corsAllowedOriginsFromEnv = process.env.CORS_ALLOWED_ORIGINS
  ? process.env.CORS_ALLOWED_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean)
  : [];

// Backward compatible defaults (only used if env var is not set)
const defaultAllowedOrigins = [
  "http://localhost:3000",
  "http://localhost:3001",
  "http://127.0.0.1:3000",
  "http://127.0.0.1:3001",
  "http://192.168.1.8:3000",
  "http://192.168.1.8:3001",
  "https://internarea-nine.vercel.app",
];

const allowedOrigins = corsAllowedOriginsFromEnv.length
  ? corsAllowedOriginsFromEnv
  : defaultAllowedOrigins;

const corsOptions = {
  // If Origin is missing (e.g. curl), allow.
  // If Origin is present but not in allowlist, reject.
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error("CORS origin not allowed"));
  },

  // Explicitly include PATCH because some browsers/tools may send it.
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],

  // Must include any header your frontend may send (especially Authorization)
  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "Accept",
    "X-Requested-With",
  ],

  // If credentials=true on frontend, set this to true.
  credentials: false,

  // Ensure preflight works consistently
  optionsSuccessStatus: 204,
};


// Reject disallowed preflight requests deterministically.
// Note: cors() will set the response headers for allowed origins.
// For disallowed origins, browsers will correctly block.


app.use(cors(corsOptions));
app.options("*", cors(corsOptions));

// Allow large JSON payloads (e.g., media or rich text) with an upper bound.
app.use(bodyParser.json({ limit: "50mb" }));
app.use(bodyParser.urlencoded({ extended: true, limit: "50mb" }));
app.use(express.json());

// Basic production hardening.
const buildRateLimiter = require("./middleware/rateLimit");
app.use(buildRateLimiter());

// Health check endpoint
app.get("/", (req, res) => {
  res.send("backend running");
});

// Mount API under /api
app.use("/api", router);

// Error handler must be registered after all routes/middlewares.
app.use(errorHandler);

// Start MongoDB connection and then listen.
connect();

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});

