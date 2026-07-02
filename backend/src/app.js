const express = require("express");
const cors = require("cors");
const compression = require("compression");
const helmet = require("helmet");
const morgan = require("morgan");
const rateLimit = require("express-rate-limit");

const { errorHandler } = require("./middleware/errorHandler");
const { corsOrigin } = require("./config/env");

const authRoutes = require("./modules/auth/auth.routes");
const institutionRoutes = require("./modules/institutions/institution.routes");
const examRoutes = require("./modules/exams/exam.routes");
const questionRoutes = require("./modules/questions/question.routes");
const sessionRoutes = require("./modules/sessions/session.routes");
const monitoringRoutes = require("./modules/monitoring/monitoring.routes");
const invigilatorRoutes = require("./modules/invigilator/invigilator.routes");
const integrityRoutes = require("./modules/integrity/integrity.routes");
const analyticsRoutes = require("./modules/analytics/analytics.routes");
const studentRoutes = require("./modules/students/student.routes");
const userRoutes = require("./modules/users/user.routes");
const aiImportRoutes = require("./modules/ai-import/aiImport.routes");
const invitesRoutes = require("./modules/invites/invites.routes");
const anomalyRoutes = require("./modules/anomaly/anomaly.routes");

const app = express();

// Behind Render/Vercel/any reverse proxy the client IP arrives in
// X-Forwarded-For. Trusting the first proxy hop makes req.ip (and therefore
// the rate limiters below) key on the real client IP instead of the proxy's.
app.set("trust proxy", 1);

// Compress all HTTP responses — typically 60-70 % smaller JSON payloads.
// Skip for already-compressed formats (images, video) and small responses.
app.use(compression({ threshold: 1024, level: 6 }));

app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
app.use(
  cors({
    origin: corsOrigin,
    credentials: true,
  })
);
// Use "combined" in prod (structured) and "dev" locally (colourised)
app.use(morgan(process.env.NODE_ENV === "production" ? "combined" : "dev"));
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

// ── Rate limiting ──
// Protects the process from request floods (the "lots of people hop on"
// scenario, accidental client retry storms, or abuse). Limits are generous
// enough not to interfere with a legitimate exam sitting, where each student
// makes a steady but bounded number of requests.
const isProd = process.env.NODE_ENV === "production";

// Global limiter — broad ceiling per IP across the whole API.
const globalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: Number(process.env.RATE_LIMIT_GLOBAL || 600), // ~10 req/s sustained per IP
  standardHeaders: true,
  legacyHeaders: false,
  // /health is hit by the platform keep-alive ping; never throttle it.
  skip: (req) => req.path === "/health" || !isProd,
});

// Auth limiter — much stricter, targeting login/registration brute-force and
// the bcrypt-driven CPU spikes that happen during sign-in storms.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.RATE_LIMIT_AUTH || 50),
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true, // only failed attempts count toward the cap
  skip: () => !isProd,
});

app.use(globalLimiter);

// ── Performance monitoring ──
// Log any request slower than the threshold so bottlenecks under heavy
// concurrent load are visible in the server logs.
const SLOW_REQUEST_MS = Number(process.env.SLOW_REQUEST_MS || 800);
app.use((req, res, next) => {
  const start = process.hrtime.bigint();
  res.on("finish", () => {
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    if (ms >= SLOW_REQUEST_MS) {
      // eslint-disable-next-line no-console
      console.warn(`[perf] SLOW ${req.method} ${req.originalUrl} ${res.statusCode} ${ms.toFixed(0)}ms`);
    }
  });
  next();
});

// ── Lightweight cache helper for authenticated GET responses ──
// Browsers and CDNs will reuse the response for `seconds` without
// hitting the DB again.  We only do this on safe, idempotent endpoints.
function cacheFor(seconds) {
  return (req, res, next) => {
    if (req.method === "GET") {
      res.set("Cache-Control", `private, max-age=${seconds}, stale-while-revalidate=${seconds * 2}`);
    } else {
      res.set("Cache-Control", "no-store");
    }
    next();
  };
}

app.get("/health", (_req, res) => {
  res.set("Cache-Control", "no-store");
  res.json({ status: "healthy", service: "INTEGRITY Backend", ts: Date.now() });
});

app.use("/api/auth", authLimiter, authRoutes);
// Institution brand rarely changes — cache 60 s in the browser
app.use("/api/institutions", cacheFor(60), institutionRoutes);
// Exam list/detail: 15 s cache so dashboards feel instant on re-visit
app.use("/api/exams", cacheFor(15), examRoutes);
// Questions are read-heavy and change infrequently — 15 s cache
app.use("/api/questions", cacheFor(15), questionRoutes);
app.use("/api/sessions", sessionRoutes);
app.use("/api/monitoring", monitoringRoutes);
app.use("/api/invigilator", invigilatorRoutes);
app.use("/api/integrity", integrityRoutes);
// Analytics are heavy queries — 30 s cache
app.use("/api/analytics", cacheFor(30), analyticsRoutes);
app.use("/api/students", studentRoutes);
app.use("/api/users", cacheFor(30), userRoutes);
app.use("/api/ai-import", aiImportRoutes);
app.use("/api/invites", invitesRoutes);
app.use("/api/anomaly", anomalyRoutes);

app.use(errorHandler);

module.exports = app;
