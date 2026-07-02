/**
 * Scenario 01 — Login Storm
 *
 * Simulates the worst-case scenario: every student trying to log in at the
 * same moment an exam opens. This stresses:
 *   - JWT signing / bcrypt verify (CPU-bound on backend)
 *   - Redis auth-cache MISS on first login (→ DB round-trip)
 *   - Database connection pool
 *   - Rate limiter (auth limiter: 50 failed/IP/15min)
 *
 * Run:  k6 run --env K6_BASE_URL=https://your-backend/api \
 *              --env K6_STUDENT_EMAIL=student{VU}@test.com \
 *              --env K6_STUDENT_PASSWORD=testpass123 \
 *              tests/k6/scenarios/01_login_storm.js
 */

import { sleep, check } from "k6";
import http from "k6/http";
import { Rate, Trend, Counter } from "k6/metrics";
import {
  BASE_URL, publicHeaders, loginSuccessRate, authFailRate,
  errorCounter, rateLimitCounter, handleSummary, THRESHOLDS,
} from "../utils/helpers.js";

// ── Metrics ───────────────────────────────────────────────────────────────
const loginDuration   = new Trend("login_duration_ms", true);
const refreshDuration = new Trend("refresh_duration_ms", true);
const concurrentLogins = new Counter("concurrent_logins_attempted");

// ── Options ───────────────────────────────────────────────────────────────
export const options = {
  scenarios: {
    login_storm: {
      executor:           "ramping-vus",
      startVUs:           0,
      stages: [
        { duration: "10s", target: 50  },   // warm-up
        { duration: "20s", target: 200 },   // ramp to 200 concurrent logins
        { duration: "30s", target: 200 },   // sustain
        { duration: "10s", target: 500 },   // spike
        { duration: "20s", target: 500 },   // sustain spike
        { duration: "10s", target: 0   },   // cool-down
      ],
    },
  },
  thresholds: {
    ...THRESHOLDS,
    login_duration_ms: ["p(95)<3000", "p(99)<8000"],
  },
};

// ── Test data ─────────────────────────────────────────────────────────────
const EMAIL_DOMAIN = __ENV.K6_EMAIL_DOMAIN || "loadtest.integrity.dev";
const PASSWORD     = __ENV.K6_PASSWORD     || "TestPassword123!";

// ── Default function ──────────────────────────────────────────────────────
export default function loginStorm() {
  const vu    = __VU;
  const iter  = __ITER;
  const email = `student_${vu}_${iter % 1000}@${EMAIL_DOMAIN}`;

  concurrentLogins.add(1);

  const start = Date.now();
  const res = http.post(
    `${BASE_URL}/auth/login`,
    JSON.stringify({ email, password: PASSWORD }),
    { headers: publicHeaders(), timeout: "15s" },
  );
  loginDuration.add(Date.now() - start);

  const ok = check(res, {
    "status 200 or 401": (r) => r.status === 200 || r.status === 401,
    "not 500":           (r) => r.status < 500,
    "not timeout":       (r) => r.status !== 0,
  });

  if (res.status === 200) {
    loginSuccessRate.add(true);
    authFailRate.add(false);

    // Simulate token refresh after short use
    let body;
    try { body = JSON.parse(res.body); } catch { return; }
    const refreshToken = body?.data?.refreshToken;
    if (refreshToken) {
      sleep(0.5 + Math.random());
      const rStart = Date.now();
      const rRes = http.post(
        `${BASE_URL}/auth/refresh`,
        JSON.stringify({ refreshToken }),
        { headers: publicHeaders(), timeout: "10s" },
      );
      refreshDuration.add(Date.now() - rStart);
      check(rRes, { "refresh 200": (r) => r.status === 200 });
    }
  } else if (res.status === 429) {
    rateLimitCounter.add(1);
    loginSuccessRate.add(false);
    authFailRate.add(true);
    sleep(2); // back off on rate-limit
  } else if (res.status === 401) {
    // Expected for non-existent test accounts
    loginSuccessRate.add(false);
  } else {
    loginSuccessRate.add(false);
    errorCounter.add(1);
  }

  if (!ok) errorCounter.add(1);

  // Small jitter to avoid thundering-herd exactly at second boundaries
  sleep(0.1 + Math.random() * 0.3);
}

export { handleSummary };
