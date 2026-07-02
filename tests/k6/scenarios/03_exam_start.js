/**
 * Scenario 03 — Exam Start (Session Creation Storm)
 *
 * All students attempt to start the SAME exam simultaneously.
 * This is the single most destructive spike in the lifecycle:
 *   - Every VU calls POST /sessions/start concurrently
 *   - Each call reads the exam row + all student sessions + creates a new row
 *   - The exam questions (GET /questions/exam/:id) are fetched after start
 *
 * Identifies: DB connection pool exhaustion, missing indexes on exam_sessions,
 *             queue depth at PgBouncer, response time degradation under burst.
 *
 * Run:  k6 run --env EXAM_ID=<uuid> --env K6_BASE_URL=https://your-backend/api \
 *              tests/k6/scenarios/03_exam_start.js
 */

import { sleep, check, group } from "k6";
import http from "k6/http";
import { Trend, Counter, Rate } from "k6/metrics";
import {
  BASE_URL, login, authedGet, authedPost,
  examLoadTime, errorCounter, rateLimitCounter,
  handleSummary, THRESHOLDS, jitteredSleep, buildRandomAnswers,
} from "../utils/helpers.js";

const sessionStartTime   = new Trend("session_start_time_ms",    true);
const questionsFetchTime = new Trend("questions_fetch_time_ms",   true);
const sessionStartRate   = new Rate("session_start_success_rate");

export const options = {
  scenarios: {
    exam_start_burst: {
      executor: "ramping-arrival-rate",
      startRate: 10,
      timeUnit: "1s",
      preAllocatedVUs: 200,
      maxVUs: 1200,
      stages: [
        { duration: "10s", target: 50  },   // 50 new sessions/s
        { duration: "20s", target: 200 },   // ramp: 200 starts/s
        { duration: "30s", target: 200 },   // sustain 200/s (≈ 6 000 concurrent)
        { duration: "10s", target: 0   },
      ],
    },
  },
  thresholds: {
    ...THRESHOLDS,
    session_start_time_ms:     ["p(95)<5000", "p(99)<10000"],
    session_start_success_rate: ["rate>0.90"],
  },
};

const EMAIL_DOMAIN = __ENV.K6_EMAIL_DOMAIN || "loadtest.integrity.dev";
const PASSWORD     = __ENV.K6_PASSWORD     || "TestPassword123!";
const EXAM_ID      = __ENV.EXAM_ID         || "replace-with-real-exam-uuid";

let _token   = null;
let _session = null;

export default function examStart() {
  if (!_token) {
    const creds = login(`student_${__VU}@${EMAIL_DOMAIN}`, PASSWORD);
    if (!creds) { sleep(1); return; }
    _token = creds.token;
  }

  group("exam_start", () => {
    // 1. Start / resume exam session
    const t1 = Date.now();
    const startRes = authedPost("/sessions/start", _token, {
      examId:   EXAM_ID,
      password: __ENV.EXAM_PASSWORD || undefined,
    });
    sessionStartTime.add(Date.now() - t1);

    const startOk = check(startRes, {
      "session start 200":       (r) => r.status === 200,
      "has sessionId":           (r) => { try { return !!JSON.parse(r.body).data?.session?.id; } catch { return false; } },
      "not pool exhausted (500)":(r) => r.status !== 500,
    });

    sessionStartRate.add(startOk);
    if (!startOk) {
      errorCounter.add(1);
      if (startRes.status === 429) rateLimitCounter.add(1);
      sleep(1);
      return;
    }

    try { _session = JSON.parse(startRes.body).data?.session; } catch { return; }

    jitteredSleep(200, 300);

    // 2. Fetch exam questions (cached on backend, 15 s TTL)
    const t2 = Date.now();
    const qRes = authedGet(`/questions/exam/${EXAM_ID}`, _token);
    questionsFetchTime.add(Date.now() - t2);
    examLoadTime.add(Date.now() - t2);

    check(qRes, {
      "questions 200":      (r) => r.status === 200,
      "questions has data": (r) => { try { return Array.isArray(JSON.parse(r.body).data); } catch { return false; } },
    });
  });

  // Simulate the student reading the first question
  jitteredSleep(3000, 5000);
}

export { handleSummary };
