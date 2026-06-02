const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");

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

const app = express();

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

// ── Lightweight cache helper for authenticated GET responses ──
// Browsers and CDNs will reuse the response for `seconds` without
// hitting the DB again.  We only do this on safe, idempotent endpoints.
function cacheFor(seconds) {
  return (_req, res, next) => {
    res.set("Cache-Control", `private, max-age=${seconds}, stale-while-revalidate=${seconds * 2}`);
    next();
  };
}

app.get("/health", (_req, res) => {
  res.set("Cache-Control", "no-store");
  res.json({ status: "healthy", service: "INTEGRITY Backend", ts: Date.now() });
});

app.use("/api/auth", authRoutes);
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

app.use(errorHandler);

module.exports = app;
