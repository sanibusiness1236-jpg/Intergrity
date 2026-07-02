/**
 * Scenario 06 — Live Session Monitoring (Examiner Polling)
 *
 * Simulates N examiners polling the live-session endpoint every 15 s while
 * an exam is running. With the Redis-backed cache (LIVE_CACHE_MS = 4 000 ms),
 * all examiners watching the same exam collapse into a single DB query per
 * cache period.
 *
 * Without the cache (old behaviour): N × (1 / 15) DB queries/second
 * With the cache (new behaviour):    1 × (1 / 4)  DB queries/second per exam
 *
 * Stresses: Redis read throughput, response payload size, backend CPU
 *           (serialising large JSON arrays).
 *
 * Run:  k6 run --env EXAM_IDS=id1,id2 --env K6_BASE_URL=https://your-backend/api \
 *              tests/k6/scenarios/06_live_monitoring.js
 */

import { sleep, check, group } from "k6";
import http from "k6/http";
import { Rate, Trend } from "k6/metrics";
import {
  BASE_URL, login, authedGet, liveMonitorTime,
  errorCounter, handleSummary, THRESHOLDS, jitteredSleep,
} from "../utils/helpers.js";

const monitorSuccessRate = new Rate("monitor_success_rate");
const payloadSize        = new Trend("monitor_payload_bytes", true);

export const options = {
  scenarios: {
    live_monitoring: {
      executor:  "constant-vus",
      vus:       50,      // 50 examiners watching simultaneously
      duration:  "3m",
    },
  },
  thresholds: {
    ...THRESHOLDS,
    live_monitor_time_ms:  ["p(95)<3000", "p(99)<6000"],
    monitor_success_rate:  ["rate>0.99"],
  },
};

const EMAIL_DOMAIN = __ENV.K6_EMAIL_DOMAIN || "loadtest.integrity.dev";
const PASSWORD     = __ENV.K6_PASSWORD     || "TestPassword123!";
const EXAM_IDS     = (__ENV.EXAM_IDS || "replace-with-real-exam-uuid").split(",");

let _token = null;

export default function liveMonitoring() {
  if (!_token) {
    const creds = login(`examiner_${__VU}@${EMAIL_DOMAIN}`, PASSWORD);
    if (!creds) { sleep(2); return; }
    _token = creds.token;
  }

  group("live_monitor_poll", () => {
    // Pick one or more exam IDs to watch (simulate multi-exam monitoring)
    const examId = EXAM_IDS[__VU % EXAM_IDS.length];

    const t = Date.now();
    const res = authedGet(`/integrity/live-sessions?examId=${examId}`, _token);
    liveMonitorTime.add(Date.now() - t);

    const ok = check(res, {
      "monitor 200":    (r) => r.status === 200,
      "has rows":       (r) => { try { return Array.isArray(JSON.parse(r.body).data?.rows); } catch { return false; } },
      "not 500":        (r) => r.status < 500,
    });

    monitorSuccessRate.add(ok);
    if (!ok) errorCounter.add(1);

    payloadSize.add(res.body ? res.body.length : 0);
  });

  // Poll interval: 15 s + random jitter (matches frontend schedule() timing)
  jitteredSleep(15000, 5000);
}

export { handleSummary };
