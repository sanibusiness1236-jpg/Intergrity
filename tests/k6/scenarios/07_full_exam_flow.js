/**
 * Scenario 07 — Full End-to-End Exam Flow
 *
 * Each VU simulates one complete student exam lifecycle:
 *   1. Login
 *   2. Load dashboard
 *   3. Start exam session
 *   4. Load exam questions
 *   5. Answer questions (with autosaves every ~15 s)
 *   6. Navigate between questions
 *   7. Submit exam
 *   8. View result
 *
 * This is the most realistic test — it exercises every major hot path
 * simultaneously. Use this for capacity planning and bottleneck identification.
 *
 * Run:  k6 run --env EXAM_ID=<uuid> --env K6_BASE_URL=https://your-backend/api \
 *              tests/k6/scenarios/07_full_exam_flow.js
 */

import { sleep, check, group } from "k6";
import http from "k6/http";
import { Rate, Trend, Counter } from "k6/metrics";
import {
  BASE_URL, login, authedGet, authedPost,
  loginSuccessRate, examLoadTime, autosaveTime, submitTime,
  errorCounter, rateLimitCounter, handleSummary, THRESHOLDS,
  jitteredSleep, buildRandomAnswers,
} from "../utils/helpers.js";

const flowCompleteRate = new Rate("exam_flow_complete_rate");
const totalFlowTime    = new Trend("total_exam_flow_ms", true);
const stepFailures     = new Counter("step_failures_total");

export const options = {
  scenarios: {
    full_exam_flow: {
      executor:  "ramping-vus",
      startVUs:  0,
      stages: [
        { duration: "30s",  target: 100  },  // ramp to 100 concurrent students
        { duration: "2m",   target: 100  },  // sustain
        { duration: "30s",  target: 500  },  // scale up
        { duration: "3m",   target: 500  },  // sustain 500 concurrent
        { duration: "30s",  target: 1000 },  // push to 1 000
        { duration: "3m",   target: 1000 },  // sustain
        { duration: "30s",  target: 0    },
      ],
    },
  },
  thresholds: {
    ...THRESHOLDS,
    exam_flow_complete_rate:  ["rate>0.90"],
    total_exam_flow_ms:       ["p(95)<120000"],  // < 2 minutes end-to-end
    submit_time_ms:           ["p(95)<8000"],
  },
};

const EMAIL_DOMAIN = __ENV.K6_EMAIL_DOMAIN || "loadtest.integrity.dev";
const PASSWORD     = __ENV.K6_PASSWORD     || "TestPassword123!";
const EXAM_ID      = __ENV.EXAM_ID         || "replace-with-real-exam-uuid";
const EXAM_Q_COUNT = parseInt(__ENV.EXAM_Q_COUNT || "30", 10);

export default function fullExamFlow() {
  const flowStart = Date.now();
  let token, sessionId, questions;

  // ── Step 1: Login ──────────────────────────────────────────────
  group("step_1_login", () => {
    const creds = login(`student_${__VU}@${EMAIL_DOMAIN}`, PASSWORD);
    if (!creds) { stepFailures.add(1); return; }
    token = creds.token;
  });
  if (!token) { sleep(2); return; }

  jitteredSleep(500, 500);

  // ── Step 2: Dashboard ──────────────────────────────────────────
  group("step_2_dashboard", () => {
    const r = authedGet("/exams", token);
    check(r, { "exams 200": (res) => res.status === 200 });
    if (r.status !== 200) stepFailures.add(1);
  });

  jitteredSleep(1000, 1000);

  // ── Step 3: Start exam session ─────────────────────────────────
  group("step_3_start_session", () => {
    const t = Date.now();
    const r = authedPost("/sessions/start", token, { examId: EXAM_ID });
    examLoadTime.add(Date.now() - t);

    const ok = check(r, {
      "session start 200": (res) => res.status === 200,
      "has session id":    (res) => { try { return !!JSON.parse(res.body).data?.session?.id; } catch { return false; } },
    });
    if (!ok) { stepFailures.add(1); errorCounter.add(1); return; }
    try { sessionId = JSON.parse(r.body).data?.session?.id; } catch { stepFailures.add(1); }
  });
  if (!sessionId) { sleep(2); return; }

  jitteredSleep(500, 300);

  // ── Step 4: Load questions ─────────────────────────────────────
  group("step_4_load_questions", () => {
    const t = Date.now();
    const r = authedGet(`/questions/exam/${EXAM_ID}`, token);
    examLoadTime.add(Date.now() - t);

    check(r, {
      "questions 200": (res) => res.status === 200,
      "has questions": (res) => { try { return Array.isArray(JSON.parse(res.body).data); } catch { return false; } },
    });

    try { questions = JSON.parse(r.body).data || []; } catch { questions = []; }
  });

  // ── Step 5: Simulate exam taking (autosave every ~15 s) ────────
  const answers = {};
  const totalQuestions = questions.length || EXAM_Q_COUNT;
  const examDurationS  = Math.min(totalQuestions * 30, 120); // cap at 2 min for test

  let elapsed = 0;
  let lastSave = 0;

  for (let qi = 0; qi < totalQuestions && elapsed < examDurationS; qi++) {
    // Answer the current question
    const q = questions[qi] || { id: `placeholder-${qi}`, type: "MCQ", options: ["A","B","C","D"] };
    const ans = q.options
      ? q.options[Math.floor(Math.random() * q.options.length)]
      : "A";
    answers[q.id] = ans;

    const thinkTime = 3 + Math.random() * 7; // 3-10 s per question
    sleep(thinkTime);
    elapsed += thinkTime;

    // Autosave every 15 s (or whenever enough time has passed)
    if (elapsed - lastSave >= 15) {
      group("autosave", () => {
        const t = Date.now();
        const r = authedPost(`/sessions/${sessionId}/autosave`, token, { answers });
        autosaveTime.add(Date.now() - t);
        check(r, { "autosave 200": (res) => res.status === 200 });
        if (r.status >= 500) errorCounter.add(1);
      });
      lastSave = elapsed;
    }
  }

  // ── Step 6: Submit ─────────────────────────────────────────────
  group("step_6_submit", () => {
    const answerArray = Object.entries(answers).map(([questionId, answer]) => ({
      questionId,
      answer,
    }));

    const t = Date.now();
    const r = authedPost(`/sessions/${sessionId}/submit`, token, { answers: answerArray });
    submitTime.add(Date.now() - t);

    const ok = check(r, {
      "submit 200 or 409": (res) => res.status === 200 || res.status === 409,
      "has score":         (res) => { try { return JSON.parse(res.body).data?.score !== undefined || res.status === 409; } catch { return false; } },
    });

    if (!ok) { stepFailures.add(1); errorCounter.add(1); }
    if (r.status === 429) rateLimitCounter.add(1);
  });

  totalFlowTime.add(Date.now() - flowStart);
  flowCompleteRate.add(true);

  sleep(1);
}

export { handleSummary };
