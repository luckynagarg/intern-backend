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

// CORS allowlist
// Comma-separated env var takes precedence:
//   CORS_ALLOWED_ORIGINS=http://localhost:3000,https://your-frontend-domain
const corsAllowedOriginsFromEnv = process.env.CORS_ALLOWED_ORIGINS
  ? process.env.CORS_ALLOWED_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean)
  : [];

const defaultAllowedOrigins = [
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "https://internarea-nine.vercel.app",
];

const allowedOrigins = corsAllowedOriginsFromEnv.length
  ? corsAllowedOriginsFromEnv
  : defaultAllowedOrigins;

const corsOptions = {
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error("CORS origin not allowed"));
  },
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "Accept",
    "X-Requested-With",
  ],
  credentials: false,
  optionsSuccessStatus: 204,
};

// Always apply CORS first
app.use(cors(corsOptions));
app.options("*", cors(corsOptions));

// Extra header guard: ensure Access-Control-Allow-Origin is present
// for responses produced by routes/error handlers.
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (!origin) return next();
  if (allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader(
      "Access-Control-Allow-Methods",
      "GET,POST,PUT,DELETE,PATCH,OPTIONS"
    );
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type,Authorization,Accept,X-Requested-With"
    );
    res.setHeader("Vary", "Origin");
  }
  return next();
});

app.use(bodyParser.json({ limit: "50mb" }));
app.use(bodyParser.urlencoded({ extended: true, limit: "50mb" }));
app.use(express.json());

const buildRateLimiter = require("./middleware/rateLimit");
app.use(buildRateLimiter());

app.get("/", (req, res) => {
  res.send("backend running");
});

// Optional: helps verifying deployment is routing correctly.
app.get("/api/health", (req, res) => {
  res.json({ ok: true, routes: ["/api/job", "/api/internship"] });
});

app.use("/api", router);
app.use(errorHandler);

// Start server even if Mongo is unavailable.
(async () => {
  const result = await connect();
  app.locals.mongoAvailable = !!result?.mongoAvailable;
  app.listen(port, () => {
    console.log(`Server running on port ${port}`);
  });
})();


