/**
 * Scenario 05 — Exam Submission Storm
 *
 * All students submit at exactly the same moment (timer expiry).
 * This is the most impactful single spike: every in-progress session calls
 * POST /sessions/:id/submit simultaneously.
 *
 * Each submit call:
 *   - Loads session + exam + all questions (Prisma include)
 *   - Grades all answers in memory
 *   - Runs a bulk DELETE + createMany for answers
 *   - Updates the session status
 *   - Fires an async IP-anomaly check
 *
 * Identifies: Transaction lock contention, bulk insert performance,
 *             peak DB connection pool utilisation, query time degradation.
 *
 * Run:  k6 run --env SESSION_IDS=id1,id2,id3 \
 *              --env K6_BASE_URL=https://your-backend/api \
 *              tests/k6/scenarios/05_exam_submit.js
 */

import { sleep, check, group } from "k6";
import http from "k6/http";
import { Rate, Trend, Counter } from "k6/metrics";
import {
  BASE_URL, login, authedPost, submitTime,
  errorCounter, rateLimitCounter, handleSummary, THRESHOLDS,
} from "../utils/helpers.js";

const submitSuccessRate  = new Rate("submit_success_rate");
const gradingTime        = new Trend("grading_time_ms", true);

export const options = {
  scenarios: {
    // All VUs reach action at the same moment — simulates timer expiry
    submission_storm: {
      executor:           "ramping-arrival-rate",
      startRate:          5,
      timeUnit:           "1s",
      preAllocatedVUs:    300,
      maxVUs:             1500,
      stages: [
        { duration:  "5s", target: 5   },  // warm-up
        { duration:  "5s", target: 500 },  // STORM — 500 submissions/s
        { duration: "30s", target: 500 },  // sustain
        { duration: "10s", target: 0   },
      ],
    },
  },
  thresholds: {
    ...THRESHOLDS,
    submit_time_ms:       ["p(95)<8000", "p(99)<15000"],
    submit_success_rate:  ["rate>0.95"],
    grading_time_ms:      ["p(95)<6000"],
  },
};

const EMAIL_DOMAIN = __ENV.K6_EMAIL_DOMAIN || "loadtest.integrity.dev";
const PASSWORD     = __ENV.K6_PASSWORD     || "TestPassword123!";
const EXAM_ID      = __ENV.EXAM_ID         || "replace-with-real-exam-uuid";

let _token     = null;
let _sessionId = null;

// Build a realistic answer payload for a 30-question MCQ exam
function buildAnswers(sessionId) {
  const answers = [];
  for (let i = 0; i < 30; i++) {
    answers.push({
      questionId: `q-placeholder-${i}`,
      answer:     ["A", "B", "C", "D"][Math.floor(Math.random() * 4)],
    });
  }
  return answers;
}

export default function examSubmit() {
  if (!_token) {
    const creds = login(`student_${__VU}@${EMAIL_DOMAIN}`, PASSWORD);
    if (!creds) { sleep(2); return; }
    _token = creds.token;
  }

  // Each VU starts a session before submitting
  if (!_sessionId) {
    const startRes = authedPost("/sessions/start", _token, { examId: EXAM_ID });
    if (startRes.status !== 200) {
      sleep(1); return;
    }
    try { _sessionId = JSON.parse(startRes.body).data?.session?.id; } catch { sleep(1); return; }
  }

  const answers = buildAnswers(_sessionId);

  group("submission", () => {
    const t = Date.now();
    const res = authedPost(`/sessions/${_sessionId}/submit`, _token, { answers });
    const elapsed = Date.now() - t;

    submitTime.add(elapsed);
    gradingTime.add(elapsed);

    const ok = check(res, {
      "submit 200":         (r) => r.status === 200,
      "has score":          (r) => { try { return JSON.parse(r.body).data?.score !== undefined; } catch { return false; } },
      "not 409 (dupe)":     (r) => r.status !== 409,  // 409 = already submitted, non-fatal
      "not 500":            (r) => r.status < 500,
    });

    // 409 already submitted → treat as success (idempotent)
    submitSuccessRate.add(ok || res.status === 409);
    if (!ok && res.status !== 409) {
      errorCounter.add(1);
      if (res.status === 429) rateLimitCounter.add(1);
    }
  });

  // Reset for next iteration (if test runs multiple iterations)
  _sessionId = null;
  sleep(1);
}

export { handleSummary };
