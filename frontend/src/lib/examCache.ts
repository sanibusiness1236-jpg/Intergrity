/**
 * examCache — client-side caching & reliable local persistence layer.
 *
 * Three concerns live here:
 *   1. Exam-list cache       (localStorage)  — instant dashboard render.
 *   2. Exam-questions cache  (IndexedDB)     — instant question render + offline.
 *   3. Answer persistence    (localStorage)  — answers are saved synchronously
 *                                              on every keystroke and can NEVER
 *                                              be lost to a refresh / disconnect.
 *
 * Everything is defensive: any storage failure degrades gracefully to a
 * network fetch, never throws into the UI.
 */

/* ────────────────────────────────────────────────────────────
 * 1. EXAM LIST CACHE (localStorage)
 * ──────────────────────────────────────────────────────────── */

const EXAM_LIST_KEY = "cache:exams:v1";
// Consider cached exams "fresh enough" to show instantly for this long.
// We always refresh in the background regardless.
const EXAM_LIST_TTL_MS = 5 * 60 * 1000; // 5 minutes

export interface CachedExamMeta {
  id: string;
  title: string;
  status: string;
  startTime?: string | null;
  endTime?: string | null;
  courseCode?: string;
  courseName?: string;
  durationMinutes?: number;
  totalMarks?: number;
  isActive?: boolean;
  maxAttempts?: number;
}

interface ExamListEnvelope {
  ts: number;
  data: unknown[];
}

/** Read cached exam list. Returns null if missing/corrupt. */
export function loadCachedExams(): { data: any[]; stale: boolean } | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(EXAM_LIST_KEY);
    if (!raw) return null;
    const env = JSON.parse(raw) as ExamListEnvelope;
    if (!env || !Array.isArray(env.data)) return null;
    return { data: env.data, stale: Date.now() - env.ts > EXAM_LIST_TTL_MS };
  } catch {
    return null;
  }
}

/** Persist the latest exam list so the next visit renders instantly. */
export function saveCachedExams(data: unknown[]): void {
  if (typeof window === "undefined") return;
  try {
    const env: ExamListEnvelope = { ts: Date.now(), data };
    localStorage.setItem(EXAM_LIST_KEY, JSON.stringify(env));
  } catch {
    /* quota / private mode — ignore */
  }
}

/* ────────────────────────────────────────────────────────────
 * 2. EXAM QUESTIONS CACHE (IndexedDB, with localStorage fallback)
 * ──────────────────────────────────────────────────────────── */

const DB_NAME = "integrity-exam-cache";
const DB_VERSION = 1;
const QUESTIONS_STORE = "questions";

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDB(): Promise<IDBDatabase | null> {
  if (typeof window === "undefined" || !("indexedDB" in window)) {
    return Promise.resolve(null);
  }
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(QUESTIONS_STORE)) {
          db.createObjectStore(QUESTIONS_STORE, { keyPath: "examId" });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

interface QuestionCacheRecord {
  examId: string;
  ts: number;
  questions: unknown[];
}

/** Store the full question set for an exam (called once after first fetch). */
export async function cacheQuestions(examId: string, questions: unknown[]): Promise<void> {
  const db = await openDB();
  if (!db) {
    try {
      localStorage.setItem(
        `cache:questions:${examId}`,
        JSON.stringify({ examId, ts: Date.now(), questions } as QuestionCacheRecord)
      );
    } catch { /* ignore */ }
    return;
  }
  try {
    await new Promise<void>((resolve) => {
      const tx = db.transaction(QUESTIONS_STORE, "readwrite");
      tx.objectStore(QUESTIONS_STORE).put({ examId, ts: Date.now(), questions });
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    });
  } catch { /* ignore */ }
}

/** Read cached questions for an exam (instant render). Null if absent. */
export async function getCachedQuestions(examId: string): Promise<unknown[] | null> {
  const db = await openDB();
  if (!db) {
    try {
      const raw = localStorage.getItem(`cache:questions:${examId}`);
      if (!raw) return null;
      const rec = JSON.parse(raw) as QuestionCacheRecord;
      return Array.isArray(rec.questions) ? rec.questions : null;
    } catch {
      return null;
    }
  }
  try {
    return await new Promise<unknown[] | null>((resolve) => {
      const tx = db.transaction(QUESTIONS_STORE, "readonly");
      const req = tx.objectStore(QUESTIONS_STORE).get(examId);
      req.onsuccess = () => {
        const rec = req.result as QuestionCacheRecord | undefined;
        resolve(rec && Array.isArray(rec.questions) ? rec.questions : null);
      };
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

/* ────────────────────────────────────────────────────────────
 * 3. ANSWER PERSISTENCE (localStorage — synchronous, durable)
 *
 * This is the safety net that guarantees answers are never lost.
 * localStorage writes are synchronous, so even a hard crash / refresh
 * immediately after typing keeps the answer. We key by sessionId so
 * concurrent attempts never collide.
 * ──────────────────────────────────────────────────────────── */

const answersKey = (sessionId: string) => `cache:answers:${sessionId}`;

/** Save the entire answers map synchronously. Called on every change. */
export function saveLocalAnswers(sessionId: string, answers: Record<string, unknown>): void {
  if (typeof window === "undefined" || !sessionId) return;
  try {
    localStorage.setItem(answersKey(sessionId), JSON.stringify({ ts: Date.now(), answers }));
  } catch { /* ignore */ }
}

/** Read locally-persisted answers for a session. Returns {} if none. */
export function loadLocalAnswers(sessionId: string): Record<string, unknown> {
  if (typeof window === "undefined" || !sessionId) return {};
  try {
    const raw = localStorage.getItem(answersKey(sessionId));
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed?.answers && typeof parsed.answers === "object" ? parsed.answers : {};
  } catch {
    return {};
  }
}

/** Clear local answers once the exam is successfully submitted. */
export function clearLocalAnswers(sessionId: string): void {
  if (typeof window === "undefined" || !sessionId) return;
  try {
    localStorage.removeItem(answersKey(sessionId));
  } catch { /* ignore */ }
}

/**
 * Merge two answer maps, preferring locally-persisted (newest) values but
 * keeping any server answer the local copy doesn't have. A non-empty local
 * value always wins over the server value for the same question.
 */
export function mergeAnswers(
  server: Record<string, unknown> | null | undefined,
  local: Record<string, unknown> | null | undefined
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...(server || {}) };
  for (const [qid, val] of Object.entries(local || {})) {
    const isEmpty = val === undefined || val === null || val === "";
    if (!isEmpty) merged[qid] = val; // local non-empty wins
    else if (!(qid in merged)) merged[qid] = val;
  }
  return merged;
}
