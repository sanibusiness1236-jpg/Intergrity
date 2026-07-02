/**
 * Scenario 04 — Autosave Storm
 *
 * Simulates N students saving answers every 15 seconds via the HTTP fallback
 * (POST /sessions/:id/autosave). This path writes to Redis and validates
 * session ownership — now using the Redis session-meta cache.
 *
 * Identifies: Redis throughput limits, connection pool under sustained write
 *             load, and latency of the autosave path at scale.
 *
 * Run:  k6 run --env SESSION_ID=<uuid> --env K6_BASE_URL=https://your-backend/api \
 *              tests/k6/scenarios/04_autosave.js
 */

import { sleep, check } from "k6";
import http from "k6/http";
import { Trend, Counter, Rate } from "k6/metrics";
import {
  BASE_URL, login, authedPost, autosaveTime,
  errorCounter, handleSummary, THRESHOLDS, buildRandomAnswers,
} from "../utils/helpers.js";

const autosaveSuccessRate = new Rate("autosave_success_rate");

export const options = {
  scenarios: {
    autosave_sustained: {
      executor:     "constant-vus",
      vus:          500,
      duration:     "2m",
    },
  },
  thresholds: {
    ...THRESHOLDS,
    autosave_time_ms:       ["p(95)<500", "p(99)<1500"],
    autosave_success_rate:  ["rate>0.99"],
  },
};

const EMAIL_DOMAIN = __ENV.K6_EMAIL_DOMAIN || "loadtest.integrity.dev";
const PASSWORD     = __ENV.K6_PASSWORD     || "TestPassword123!";

let _token     = null;
let _sessionId = null;
let _answers   = null;

export default function autosaveLoad() {
  // Login and obtain / create a test session
  if (!_token) {
    const creds = login(`student_${__VU}@${EMAIL_DOMAIN}`, PASSWORD);
    if (!creds) { sleep(2); return; }
    _token = creds.token;
  }

  // Use a pre-seeded session ID from env, or the VU's known test session
  _sessionId = _sessionId || __ENV.SESSION_ID || `test-session-${__VU}`;

  // Build a random answer payload (simulate 20-question exam)
  if (!_answers) {
    _answers = {};
    for (let i = 0; i < 20; i++) {
      _answers[`q-${i}`] = ["A", "B", "C", "D"][Math.floor(Math.random() * 4)];
    }
  }

  // Mutate one answer per save cycle to simulate real behaviour
  const qIdx = Math.floor(Math.random() * 20);
  _answers[`q-${qIdx}`] = ["A", "B", "C", "D"][Math.floor(Math.random() * 4)];

  const t = Date.now();
  const res = authedPost(`/sessions/${_sessionId}/autosave`, _token, { answers: _answers });
  autosaveTime.add(Date.now() - t);

  const ok = check(res, {
    "autosave 200 or 404": (r) => r.status === 200 || r.status === 404,
    "not 500":             (r) => r.status < 500,
  });
  autosaveSuccessRate.add(ok && res.status === 200);
  if (!ok) errorCounter.add(1);

  // Autosave interval is 15 s — simulate that cadence
  sleep(15 + (Math.random() * 2 - 1));
}

export { handleSummary };
