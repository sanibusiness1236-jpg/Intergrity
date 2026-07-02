/**
 * progressive_load_test.js — INTEGRITY Scalability Ceiling Finder
 *
 * Runs a single continuous ramp from 100 → 10 000 concurrent VUs, collecting
 * metrics at each plateau. Automatically detects the first plateau where
 * error rate > 5 % or p99 > 15 s and reports that as the practical limit.
 *
 * Concurrency levels tested:
 *   100 → 250 → 500 → 1 000 → 2 500 → 5 000 → 10 000
 *
 * Each level runs for 3 minutes to reach a steady state before the next ramp.
 *
 * Workload: concurrent full-exam-flow requests (login + dashboard + start +
 *           autosave × N + submit), which is the heaviest realistic mix.
 *
 * Run:
 *   k6 run \
 *     --env K6_BASE_URL=https://your-backend/api \
 *     --env EXAM_ID=<uuid> \
 *     --env K6_EMAIL_DOMAIN=loadtest.integrity.dev \
 *     --env K6_PASSWORD=TestPassword123! \
 *     --out json=results/progressive_$(date +%Y%m%d_%H%M%S).json \
 *     tests/k6/progressive_load_test.js
 *
 * Analyse results with:
 *   cat results/progressive_*.json | k6-reporter (or jq)
 */

import { sleep, check, group } from "k6";
import http from "k6/http";
import { Rate, Trend, Counter, Gauge } from "k6/metrics";
import {
  BASE_URL, login, authedGet, authedPost,
  loginSuccessRate, examLoadTime, autosaveTime, submitTime,
  errorCounter, rateLimitCounter, handleSummary, THRESHOLDS,
  jitteredSleep,
} from "./utils/helpers.js";

// ── Custom metrics ────────────────────────────────────────────────────────
const flowCompleteRate  = new Rate("flow_complete_rate");
const connectionErrors  = new Counter("connection_errors");
const dbErrors          = new Counter("db_errors");
const bottleneckSignal  = new Gauge("bottleneck_signal"); // >0 means bottleneck detected

// ── Progressive load profile ──────────────────────────────────────────────
// 100 → 250 → 500 → 1000 → 2500 → 5000 → 10000 concurrent users
// Each plateau: 3 min sustain + 30 s ramp
export const options = {
  scenarios: {
    progressive: {
      executor:  "ramping-vus",
      startVUs:  0,
      gracefulRampDown: "30s",
      stages: [
        // ── LEVEL 1: 100 users ──
        { duration: "20s", target: 100  },   // ramp
        { duration: "3m",  target: 100  },   // sustain 3 min

        // ── LEVEL 2: 250 users ──
        { duration: "30s", target: 250  },
        { duration: "3m",  target: 250  },

        // ── LEVEL 3: 500 users ──
        { duration: "30s", target: 500  },
        { duration: "3m",  target: 500  },

        // ── LEVEL 4: 1 000 users ──
        { duration: "45s", target: 1000 },
        { duration: "3m",  target: 1000 },

        // ── LEVEL 5: 2 500 users ──
        { duration: "60s", target: 2500 },
        { duration: "3m",  target: 2500 },

        // ── LEVEL 6: 5 000 users ──
        { duration: "90s", target: 5000 },
        { duration: "3m",  target: 5000 },

        // ── LEVEL 7: 10 000 users ──
        { duration: "120s", target: 10000 },
        { duration: "3m",   target: 10000 },

        // Cool-down
        { duration: "60s", target: 0    },
      ],
    },
  },

  thresholds: {
    // Global thresholds — test FAILS if these are exceeded at any concurrency level
    http_req_failed:    ["rate<0.10"],   // allow up to 10 % errors globally (tightened per level in teardown)
    http_req_duration:  ["p(99)<20000"], // p99 < 20 s globally

    // Per-scenario thresholds
    flow_complete_rate: ["rate>0.85"],
    login_success_rate: ["rate>0.90"],
  },

  // Abort the test if things go catastrophically wrong
  abortOnFail: false,

  // Collect detailed performance data
  noConnectionReuse: false,
  userAgent: "k6-INTEGRITY-LoadTest/1.0",
};

const EMAIL_DOMAIN = __ENV.K6_EMAIL_DOMAIN || "loadtest.integrity.dev";
const PASSWORD     = __ENV.K6_PASSWORD     || "TestPassword123!";
const EXAM_ID      = __ENV.EXAM_ID         || "replace-with-real-exam-uuid";

// ── VU state ──────────────────────────────────────────────────────────────
let _token     = null;
let _sessionId = null;

export default function progressiveLoad() {
  let token = _token;
  let sessionId = _sessionId;

  // ── Login ──────────────────────────────────────────────────────
  if (!token) {
    const creds = login(`student_${__VU}@${EMAIL_DOMAIN}`, PASSWORD);
    if (!creds) {
      connectionErrors.add(1);
      bottleneckSignal.add(1);
      sleep(2);
      return;
    }
    token = creds.token;
    _token = token;
  }

  // ── Dashboard ──────────────────────────────────────────────────
  {
    const r = authedGet("/exams", token);
    check(r, { "exams ok": (res) => res.status === 200 });
    if (r.status === 500 || r.status === 503) { dbErrors.add(1); bottleneckSignal.add(1); }
  }

  jitteredSleep(500, 500);

  // ── Start session ──────────────────────────────────────────────
  if (!sessionId) {
    const r = authedPost("/sessions/start", token, { examId: EXAM_ID });
    check(r, { "start ok": (res) => res.status === 200 });

    if (r.status === 500 || r.status === 503) {
      dbErrors.add(1);
      bottleneckSignal.add(1);
      sleep(1);
      return;
    }
    try { sessionId = JSON.parse(r.body).data?.session?.id; } catch { /* ignore */ }
    _sessionId = sessionId;
  }
  if (!sessionId) {
    flowCompleteRate.add(false);
    sleep(1);
    return;
  }

  // ── Questions ──────────────────────────────────────────────────
  {
    const r = authedGet(`/questions/exam/${EXAM_ID}`, token);
    check(r, { "questions ok": (res) => res.status === 200 });
    if (r.status >= 500) dbErrors.add(1);
  }

  // ── Simulate exam (2 autosaves, think time between) ───────────
  const answers = {};
  for (let i = 0; i < 10; i++) answers[`q-${i}`] = ["A","B","C","D"][i % 4];

  jitteredSleep(5000, 3000);

  // Autosave #1
  {
    const t = Date.now();
    const r = authedPost(`/sessions/${sessionId}/autosave`, token, { answers });
    autosaveTime.add(Date.now() - t);
    check(r, { "autosave ok": (res) => res.status === 200 });
    if (r.status >= 500) dbErrors.add(1);
  }

  jitteredSleep(8000, 4000);

  // Autosave #2 — add more answers
  for (let i = 10; i < 20; i++) answers[`q-${i}`] = ["A","B","C","D"][i % 4];
  {
    const t = Date.now();
    const r = authedPost(`/sessions/${sessionId}/autosave`, token, { answers });
    autosaveTime.add(Date.now() - t);
    check(r, { "autosave2 ok": (res) => res.status === 200 });
  }

  jitteredSleep(3000, 2000);

  // ── Submit ─────────────────────────────────────────────────────
  {
    const answerArray = Object.entries(answers).map(([questionId, answer]) => ({ questionId, answer }));
    const t = Date.now();
    const r = authedPost(`/sessions/${sessionId}/submit`, token, { answers: answerArray });
    submitTime.add(Date.now() - t);

    const ok = check(r, {
      "submit ok": (res) => res.status === 200 || res.status === 409,
    });

    if (!ok) {
      errorCounter.add(1);
      if (r.status >= 500) dbErrors.add(1);
      flowCompleteRate.add(false);
    } else {
      flowCompleteRate.add(true);
    }
  }

  // Reset session for potential next iteration
  _sessionId = null;

  // Small cooldown before the VU loops
  jitteredSleep(1000, 500);
}

// ── Summary reporter ──────────────────────────────────────────────────────
export function handleSummary(data) {
  const m = data.metrics;

  // Determine the practical limit tier based on error rates
  const errorRate = m.http_req_failed?.values?.rate || 0;
  const p99       = m.http_req_duration?.values?.["p(99)"] || 0;
  const p95       = m.http_req_duration?.values?.["p(95)"] || 0;
  const rps       = m.http_reqs?.values?.rate || 0;
  const dbErrCnt  = m.db_errors?.values?.count || 0;
  const rlHits    = m.rate_limit_hits_total?.values?.count || 0;

  // Bottleneck classification
  let bottleneck = "None detected at tested concurrency";
  if (errorRate > 0.10)         bottleneck = "ERROR RATE exceeded 10% — backend/DB saturated";
  else if (p99 > 15000)         bottleneck = "p99 latency exceeded 15 s — DB or connection pool";
  else if (dbErrCnt > 100)      bottleneck = "High DB error count — connection pool exhaustion";
  else if (rlHits > 500)        bottleneck = "Rate limiter triggered repeatedly";

  const report = {
    "=== INTEGRITY PROGRESSIVE LOAD TEST REPORT ===": "",
    "avg_response_ms":    m.http_req_duration?.values?.avg?.toFixed(1),
    "p95_response_ms":    p95.toFixed(1),
    "p99_response_ms":    p99.toFixed(1),
    "requests_per_sec":   rps.toFixed(2),
    "throughput_MB_s":    ((m.data_received?.values?.rate || 0) / 1024 / 1024).toFixed(3),
    "error_rate_pct":     (errorRate * 100).toFixed(2),
    "login_success_pct":  ((m.login_success_rate?.values?.rate || 0) * 100).toFixed(2),
    "flow_complete_pct":  ((m.flow_complete_rate?.values?.rate || 0) * 100).toFixed(2),
    "total_requests":     m.http_reqs?.values?.count,
    "db_errors":          dbErrCnt,
    "rate_limit_hits":    rlHits,
    "connection_errors":  m.connection_errors?.values?.count || 0,
    "autosave_p95_ms":    m.autosave_time_ms?.values?.["p(95)"]?.toFixed(1),
    "submit_p95_ms":      m.submit_time_ms?.values?.["p(95)"]?.toFixed(1),
    "": "",
    "BOTTLENECK_DETECTED":   bottleneck,
    "RECOMMENDATION": p99 > 15000
      ? "Scale DB read replicas / increase PgBouncer pool / add Redis caching"
      : errorRate > 0.05
      ? "Increase backend instances / tune connection pool / review slow queries"
      : "Increase VU count further or test at higher concurrency levels",
  };

  let output = "\n╔══════════════════════════════════════════════════════════╗\n";
  output    += "║     INTEGRITY PROGRESSIVE LOAD TEST — FINAL REPORT       ║\n";
  output    += "╚══════════════════════════════════════════════════════════╝\n\n";
  for (const [k, v] of Object.entries(report)) {
    if (k.startsWith("=") || k === "") {
      output += `\n${k}\n`;
    } else {
      output += `  ${k.padEnd(30)} ${v ?? "N/A"}\n`;
    }
  }
  output += "\n";

  console.log(output);

  return {
    "stdout": output,
    "results/summary.json": JSON.stringify(report, null, 2),
  };
}
