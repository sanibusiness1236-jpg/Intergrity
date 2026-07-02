/**
 * Scenario 02 — Student Dashboard Load
 *
 * Simulates students opening their dashboard after login. Each VU:
 *   1. Logs in
 *   2. Fetches the exam list  (GET /exams)
 *   3. Fetches their active session if any  (GET /sessions/my-active)
 *   4. Fetches their institution branding  (GET /institutions/me)
 *
 * Stresses: Redis auth cache, exam list cache, N concurrent SELECT queries.
 *
 * Run:  k6 run --env K6_BASE_URL=https://your-backend/api \
 *              tests/k6/scenarios/02_dashboard_load.js
 */

import { sleep, check, group } from "k6";
import http from "k6/http";
import { Trend, Counter } from "k6/metrics";
import {
  BASE_URL, login, authedGet, authHeaders, publicHeaders,
  dashboardLoadTime, errorCounter, rateLimitCounter,
  handleSummary, THRESHOLDS, jitteredSleep,
} from "../utils/helpers.js";

const examListTime       = new Trend("exam_list_time_ms",      true);
const activeSessionTime  = new Trend("active_session_time_ms", true);
const institutionTime    = new Trend("institution_time_ms",    true);

export const options = {
  scenarios: {
    dashboard_load: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "15s", target: 100  },
        { duration: "30s", target: 500  },
        { duration: "30s", target: 1000 },
        { duration: "30s", target: 1000 },
        { duration: "15s", target: 0    },
      ],
    },
  },
  thresholds: {
    ...THRESHOLDS,
    exam_list_time_ms:      ["p(95)<1500"],
    active_session_time_ms: ["p(95)<1000"],
  },
};

const EMAIL_DOMAIN = __ENV.K6_EMAIL_DOMAIN || "loadtest.integrity.dev";
const PASSWORD     = __ENV.K6_PASSWORD     || "TestPassword123!";

// VU-level state: cache credentials so we only log in once per VU lifecycle
let _token = null;

export function setup() {
  // Nothing to set up at the suite level — each VU logs in independently
}

export default function dashboardLoad() {
  // Login once per VU lifecycle
  if (!_token) {
    const creds = login(`student_${__VU}@${EMAIL_DOMAIN}`, PASSWORD);
    if (!creds) { sleep(1); return; }
    _token = creds.token;
  }

  const dashStart = Date.now();

  group("dashboard_requests", () => {
    // 1. Exam list (cached on backend, 15 s TTL)
    const t1 = Date.now();
    const examsRes = authedGet("/exams", _token);
    examListTime.add(Date.now() - t1);
    const examsOk = check(examsRes, {
      "exams 200":      (r) => r.status === 200,
      "exams has data": (r) => { try { return Array.isArray(JSON.parse(r.body).data); } catch { return false; } },
    });
    if (!examsOk) {
      errorCounter.add(1);
      if (examsRes.status === 429) rateLimitCounter.add(1);
    }

    jitteredSleep(100, 200); // simulate tiny render pause

    // 2. Check for active sessions (not cached — hits DB)
    const examList = [];
    try {
      const parsed = JSON.parse(examsRes.body);
      if (parsed?.data?.[0]?.id) examList.push(parsed.data[0].id);
    } catch { /* ignore */ }

    if (examList.length > 0) {
      const t2 = Date.now();
      const sessionRes = authedGet(`/sessions/my-active?examId=${examList[0]}`, _token);
      activeSessionTime.add(Date.now() - t2);
      check(sessionRes, { "my-active 200 or 404": (r) => r.status === 200 || r.status === 404 });
    }

    // 3. Institution branding (cached 60 s)
    const t3 = Date.now();
    const instRes = authedGet("/institutions/me", _token);
    institutionTime.add(Date.now() - t3);
    check(instRes, { "institution 200": (r) => r.status === 200 || r.status === 404 });
  });

  dashboardLoadTime.add(Date.now() - dashStart);

  // Simulate the student reading the dashboard before their next action
  jitteredSleep(2000, 3000);
}

export { handleSummary };
