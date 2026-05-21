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

const app = express();

app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
app.use(
  cors({
    origin: corsOrigin,
    credentials: true,
  })
);
app.use(morgan("dev"));
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

app.get("/health", (_req, res) => {
  res.json({ status: "healthy", service: "INTEGRITY Backend" });
});

app.use("/api/auth", authRoutes);
app.use("/api/institutions", institutionRoutes);
app.use("/api/exams", examRoutes);
app.use("/api/questions", questionRoutes);
app.use("/api/sessions", sessionRoutes);
app.use("/api/monitoring", monitoringRoutes);
app.use("/api/invigilator", invigilatorRoutes);
app.use("/api/integrity", integrityRoutes);
app.use("/api/analytics", analyticsRoutes);
app.use("/api/students", studentRoutes);
app.use("/api/users", userRoutes);

app.use(errorHandler);

module.exports = app;
