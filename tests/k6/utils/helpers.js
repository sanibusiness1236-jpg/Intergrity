/**
 * helpers.js — Shared utilities for INTEGRITY k6 load test suite.
 *
 * Provides: login, authenticated GET/POST wrappers, random data generation,
 * metric recorders, and threshold definitions shared across all scenarios.
 */

import http from "k6/http";
import { check, sleep } from "k6";
import { Rate, Trend, Counter } from "k6/metrics";

// ── Base URL (override via K6_BASE_URL env var) ───────────────────────────
export const BASE_URL = __ENV.K6_BASE_URL || "https://intergrity-backend.onrender.com/api";
export const SOCKET_URL = __ENV.K6_SOCKET_URL || "https://intergrity-backend.onrender.com";

// ── Custom metrics ────────────────────────────────────────────────────────
export const loginSuccessRate    = new Rate("login_success_rate");
export const authFailRate        = new Rate("auth_fail_rate");
export const examLoadTime        = new Trend("exam_load_time_ms",     true);
export const questionNavTime     = new Trend("question_nav_time_ms",  true);
export const autosaveTime        = new Trend("autosave_time_ms",      true);
export const submitTime          = new Trend("submit_time_ms",        true);
export const liveMonitorTime     = new Trend("live_monitor_time_ms",  true);
export const dashboardLoadTime   = new Trend("dashboard_load_time_ms",true);
export const errorCounter        = new Counter("errors_total");
export const timeoutCounter      = new Counter("timeouts_total");
export const dbErrorCounter      = new Counter("db_errors_total");
export const rateLimitCounter    = new Counter("rate_limit_hits_total");

// ── Standard thresholds shared by all test files ──────────────────────────
export const THRESHOLDS = {
  http_req_duration:        ["p(95)<3000", "p(99)<8000"],
  http_req_failed:          ["rate<0.05"],       // < 5 % error rate overall
  login_success_rate:       ["rate>0.95"],        // > 95 % logins succeed
  exam_load_time_ms:        ["p(95)<2000"],
  autosave_time_ms:         ["p(95)<500"],
  submit_time_ms:           ["p(95)<5000"],
  live_monitor_time_ms:     ["p(95)<3000"],
  dashboard_load_time_ms:   ["p(95)<2000"],
};

// ── Shared headers ────────────────────────────────────────────────────────
export function authHeaders(token) {
  return {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${token}`,
    "Accept-Encoding": "gzip, deflate, br",
  };
}

export function publicHeaders() {
  return {
    "Content-Type": "application/json",
    "Accept-Encoding": "gzip, deflate, br",
  };
}

// ── Login helper — returns { token, userId, role } or null ───────────────
export function login(email, password) {
  const res = http.post(
    `${BASE_URL}/auth/login`,
    JSON.stringify({ email, password }),
    { headers: publicHeaders(), timeout: "15s" },
  );

  const ok = check(res, {
    "login 200":       (r) => r.status === 200,
    "login has token": (r) => {
      try { return !!JSON.parse(r.body)?.data?.accessToken; } catch { return false; }
    },
  });

  loginSuccessRate.add(ok);
  if (!ok) {
    authFailRate.add(1);
    errorCounter.add(1);
    if (res.status === 429) rateLimitCounter.add(1);
    return null;
  }

  const body = JSON.parse(res.body);
  return {
    token:  body.data.accessToken,
    userId: body.data.user?.id,
    role:   body.data.user?.role,
  };
}

// ── Authenticated GET ─────────────────────────────────────────────────────
export function authedGet(path, token, params = {}) {
  return http.get(`${BASE_URL}${path}`, {
    headers: authHeaders(token),
    params,
    timeout: "30s",
  });
}

// ── Authenticated POST ────────────────────────────────────────────────────
export function authedPost(path, token, body) {
  return http.post(`${BASE_URL}${path}`, JSON.stringify(body), {
    headers: authHeaders(token),
    timeout: "30s",
  });
}

// ── Record error type from response ──────────────────────────────────────
export function recordErrors(res) {
  if (!res) { errorCounter.add(1); timeoutCounter.add(1); return; }
  if (res.status >= 500)     { errorCounter.add(1); dbErrorCounter.add(1); }
  else if (res.status === 429) { errorCounter.add(1); rateLimitCounter.add(1); }
  else if (res.status >= 400)  errorCounter.add(1);
}

// ── Random answer generator ───────────────────────────────────────────────
export function randomMcqAnswer(options = ["A", "B", "C", "D"]) {
  return options[Math.floor(Math.random() * options.length)];
}

export function buildRandomAnswers(questions) {
  const answers = {};
  for (const q of questions) {
    switch (q.type) {
      case "MCQ":
      case "TRUE_FALSE":
        if (q.options?.length) {
          answers[q.id] = q.options[Math.floor(Math.random() * q.options.length)];
        } else {
          answers[q.id] = "A";
        }
        break;
      case "FILL_IN_BLANK":
        answers[q.id] = `answer_${Math.random().toString(36).slice(2, 7)}`;
        break;
      default:
        answers[q.id] = "default_answer";
    }
  }
  return answers;
}

// ── Jittered sleep to spread load across the second ──────────────────────
export function jitteredSleep(baseMs, jitterMs = 500) {
  sleep((baseMs + Math.random() * jitterMs) / 1000);
}

// ── Pretty-print summary for a scenario ──────────────────────────────────
export function handleSummary(data) {
  const metrics = data.metrics;
  const out = {
    "avg_response_ms":     metrics.http_req_duration?.values?.avg?.toFixed(1),
    "p95_ms":              metrics.http_req_duration?.values?.["p(95)"]?.toFixed(1),
    "p99_ms":              metrics.http_req_duration?.values?.["p(99)"]?.toFixed(1),
    "rps":                 metrics.http_reqs?.values?.rate?.toFixed(1),
    "throughput_kb_s":     (metrics.data_received?.values?.rate / 1024)?.toFixed(1),
    "error_rate_pct":      ((metrics.http_req_failed?.values?.rate || 0) * 100)?.toFixed(2),
    "login_success_pct":   ((metrics.login_success_rate?.values?.rate || 0) * 100)?.toFixed(2),
    "errors_total":        metrics.errors_total?.values?.count,
    "rate_limit_hits":     metrics.rate_limit_hits_total?.values?.count,
    "db_errors":           metrics.db_errors_total?.values?.count,
  };

  console.log("\n─── INTEGRITY Load Test Summary ─────────────────────────");
  for (const [k, v] of Object.entries(out)) {
    console.log(`  ${k.padEnd(25)} ${v ?? "N/A"}`);
  }
  console.log("──────────────────────────────────────────────────────────\n");

  return { stdout: JSON.stringify(out, null, 2) + "\n" };
}
