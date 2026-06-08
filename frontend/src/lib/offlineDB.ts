/**
 * offlineDB — Production-grade offline storage layer for the INTEGRITY exam platform.
 *
 * IndexedDB schema v2
 * ─────────────────────────────────────────────────────────────────
 *  Store            Key                   Purpose
 *  ───────────────────────────────────────────────────────────────
 *  exams            examId                Full exam object (meta + questions)
 *  answers          sessionId_questionId  Per-question answer, durable
 *  syncQueue        autoIncrement (id)    Pending mutations to sync to server
 *  integrityQueue   autoIncrement (id)    Offline integrity/monitoring events
 *  sessionState     sessionId             Current question index + exam state
 * ─────────────────────────────────────────────────────────────────
 *
 * All operations degrade gracefully: any IDB failure falls back to
 * localStorage or a no-op so the UI never throws.
 *
 * Re-exports the localStorage-backed helpers from the original examCache.ts
 * so existing callers don't need to change their imports.
 */

// ─── DB bootstrap ───────────────────────────────────────────────────────────

const DB_NAME    = "integrity-v2";
const DB_VERSION = 2;

const S = {
  EXAMS:      "exams",
  ANSWERS:    "answers",
  SYNC_QUEUE: "syncQueue",
  INTEGRITY:  "integrityQueue",
  SESSION:    "sessionState",
} as const;

let _dbPromise: Promise<IDBDatabase | null> | null = null;

function openDB(): Promise<IDBDatabase | null> {
  if (typeof window === "undefined" || !("indexedDB" in window)) {
    return Promise.resolve(null);
  }
  if (_dbPromise) return _dbPromise;

  _dbPromise = new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION);

      req.onupgradeneeded = (ev) => {
        const db  = req.result;
        const old = ev.oldVersion;

        // v1 → v2: clear v1 stores (different schema), recreate cleanly
        if (old < 2) {
          for (const name of Array.from(db.objectStoreNames)) {
            db.deleteObjectStore(name);
          }
        }

        if (!db.objectStoreNames.contains(S.EXAMS)) {
          db.createObjectStore(S.EXAMS, { keyPath: "examId" });
        }
        if (!db.objectStoreNames.contains(S.ANSWERS)) {
          const ans = db.createObjectStore(S.ANSWERS, { keyPath: "key" });
          ans.createIndex("bySession", "sessionId", { unique: false });
        }
        if (!db.objectStoreNames.contains(S.SYNC_QUEUE)) {
          const sq = db.createObjectStore(S.SYNC_QUEUE, {
            keyPath: "id",
            autoIncrement: true,
          });
          sq.createIndex("byType",    "type",   { unique: false });
          sq.createIndex("bySession", "sessionId", { unique: false });
        }
        if (!db.objectStoreNames.contains(S.INTEGRITY)) {
          const iq = db.createObjectStore(S.INTEGRITY, {
            keyPath: "id",
            autoIncrement: true,
          });
          iq.createIndex("bySession", "sessionId", { unique: false });
          iq.createIndex("bySynced",  "synced",    { unique: false });
        }
        if (!db.objectStoreNames.contains(S.SESSION)) {
          db.createObjectStore(S.SESSION, { keyPath: "sessionId" });
        }
      };

      req.onsuccess = () => resolve(req.result);
      req.onerror   = () => resolve(null);
    } catch {
      resolve(null);
    }
  });

  return _dbPromise;
}

// Thin helper: run a transaction and return the result
async function idbGet<T>(storeName: string, key: IDBValidKey): Promise<T | null> {
  const db = await openDB();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx  = db.transaction(storeName, "readonly");
      const req = tx.objectStore(storeName).get(key);
      req.onsuccess = () => resolve((req.result as T) ?? null);
      req.onerror   = () => resolve(null);
    } catch { resolve(null); }
  });
}

async function idbPut(storeName: string, value: object): Promise<void> {
  const db = await openDB();
  if (!db) return;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(storeName, "readwrite");
      tx.objectStore(storeName).put(value);
      tx.oncomplete = () => resolve();
      tx.onerror    = () => resolve();
      tx.onabort    = () => resolve();
    } catch { resolve(); }
  });
}

async function idbDelete(storeName: string, key: IDBValidKey): Promise<void> {
  const db = await openDB();
  if (!db) return;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(storeName, "readwrite");
      tx.objectStore(storeName).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror    = () => resolve();
    } catch { resolve(); }
  });
}

async function idbGetByIndex<T>(storeName: string, indexName: string, value: IDBValidKey): Promise<T[]> {
  const db = await openDB();
  if (!db) return [];
  return new Promise((resolve) => {
    try {
      const tx      = db.transaction(storeName, "readonly");
      const idx     = tx.objectStore(storeName).index(indexName);
      const req     = idx.getAll(value);
      req.onsuccess = () => resolve((req.result as T[]) ?? []);
      req.onerror   = () => resolve([]);
    } catch { resolve([]); }
  });
}

async function idbGetAll<T>(storeName: string): Promise<T[]> {
  const db = await openDB();
  if (!db) return [];
  return new Promise((resolve) => {
    try {
      const tx  = db.transaction(storeName, "readonly");
      const req = tx.objectStore(storeName).getAll();
      req.onsuccess = () => resolve((req.result as T[]) ?? []);
      req.onerror   = () => resolve([]);
    } catch { resolve([]); }
  });
}

async function idbAdd(storeName: string, value: object): Promise<IDBValidKey | null> {
  const db = await openDB();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx  = db.transaction(storeName, "readwrite");
      const req = tx.objectStore(storeName).add(value);
      req.onsuccess = () => resolve(req.result);
      req.onerror   = () => resolve(null);
    } catch { resolve(null); }
  });
}

// ─── 1. Full Exam Cache (meta + questions) ────────────────────────────────────

export interface OfflineExam {
  examId:      string;
  ts:          number;       // when it was cached
  meta:        Record<string, unknown>;
  questions:   unknown[];
  instructions?: string | null;
  settings?:  Record<string, unknown>;
}

/** Cache the full exam bundle so students can work entirely offline. */
export async function cacheFullExam(exam: Omit<OfflineExam, "ts">): Promise<void> {
  await idbPut(S.EXAMS, { ...exam, ts: Date.now() });
}

/** Retrieve the full cached exam bundle. Null if not cached. */
export async function getCachedExam(examId: string): Promise<OfflineExam | null> {
  return idbGet<OfflineExam>(S.EXAMS, examId);
}

// ─── examCache.ts backward-compat: questions-only cache ──────────────────────

export async function cacheQuestions(examId: string, questions: unknown[]): Promise<void> {
  // Store in the new exams store; preserve existing meta if present
  const existing = await getCachedExam(examId);
  await idbPut(S.EXAMS, {
    ...(existing ?? { examId, meta: {}, instructions: null, settings: {} }),
    examId,
    questions,
    ts: Date.now(),
  });
  // Fallback to localStorage for very old browsers
  try {
    localStorage.setItem(
      `cache:questions:${examId}`,
      JSON.stringify({ examId, ts: Date.now(), questions })
    );
  } catch { /* quota */ }
}

export async function getCachedQuestions(examId: string): Promise<unknown[] | null> {
  const rec = await idbGet<OfflineExam>(S.EXAMS, examId);
  if (rec?.questions?.length) return rec.questions;
  // localStorage fallback
  try {
    const raw = localStorage.getItem(`cache:questions:${examId}`);
    if (raw) {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed?.questions) ? parsed.questions : null;
    }
  } catch { /* ignore */ }
  return null;
}

// ─── 2. Per-question answer store ─────────────────────────────────────────────

export interface AnswerRecord {
  key:        string;   // `${sessionId}_${questionId}`
  sessionId:  string;
  questionId: string;
  value:      unknown;
  ts:         number;
  synced:     boolean;
}

/** Persist a single answer immediately. */
export async function saveAnswerIDB(
  sessionId: string,
  questionId: string,
  value: unknown
): Promise<void> {
  await idbPut(S.ANSWERS, {
    key:       `${sessionId}_${questionId}`,
    sessionId,
    questionId,
    value,
    ts:     Date.now(),
    synced: false,
  });
}

/** Load all answers for a session → {questionId: value} map. */
export async function loadAnswersIDB(sessionId: string): Promise<Record<string, unknown>> {
  const rows = await idbGetByIndex<AnswerRecord>(S.ANSWERS, "bySession", sessionId);
  const map: Record<string, unknown> = {};
  for (const row of rows) map[row.questionId] = row.value;
  return map;
}

/** Mark all answers for a session as synced (after successful submit). */
export async function markAnswersSynced(sessionId: string): Promise<void> {
  const db = await openDB();
  if (!db) return;
  const rows = await idbGetByIndex<AnswerRecord>(S.ANSWERS, "bySession", sessionId);
  await Promise.all(rows.map((r) => idbPut(S.ANSWERS, { ...r, synced: true })));
}

/** Clear all local answers after successful exam submission. */
export async function clearAnswersIDB(sessionId: string): Promise<void> {
  const rows = await idbGetByIndex<AnswerRecord>(S.ANSWERS, "bySession", sessionId);
  await Promise.all(rows.map((r) => idbDelete(S.ANSWERS, r.key)));
}

// ─── 3. Session state (current question index + phase) ───────────────────────

export interface SessionStateRecord {
  sessionId:     string;
  currentIndex:  number;
  phase:         string;
  startedAt?:    string;
  lastUpdated:   number;
}

export async function saveSessionState(state: Omit<SessionStateRecord, "lastUpdated">): Promise<void> {
  await idbPut(S.SESSION, { ...state, lastUpdated: Date.now() });
}

export async function loadSessionState(sessionId: string): Promise<SessionStateRecord | null> {
  return idbGet<SessionStateRecord>(S.SESSION, sessionId);
}

export async function clearSessionState(sessionId: string): Promise<void> {
  await idbDelete(S.SESSION, sessionId);
}

// ─── 4. Sync queue ────────────────────────────────────────────────────────────

export type SyncItemType =
  | "AUTOSAVE"
  | "LOG_REFRESH"
  | "INTEGRITY_FLAG"
  | "SUBMIT";

export interface SyncQueueItem {
  id?:        number;   // auto
  type:       SyncItemType;
  sessionId:  string;
  payload:    Record<string, unknown>;
  retries:    number;
  createdAt:  number;
  nextRetry:  number;
}

/** Enqueue an operation for background sync. Returns the assigned id. */
export async function enqueueSyncItem(
  type: SyncItemType,
  sessionId: string,
  payload: Record<string, unknown>
): Promise<IDBValidKey | null> {
  return idbAdd(S.SYNC_QUEUE, {
    type,
    sessionId,
    payload,
    retries:   0,
    createdAt: Date.now(),
    nextRetry: 0,
  });
}

/** Get all pending sync items that are ready to retry now. */
export async function getPendingSyncItems(): Promise<SyncQueueItem[]> {
  const all = await idbGetAll<SyncQueueItem>(S.SYNC_QUEUE);
  const now = Date.now();
  return all.filter((item) => item.nextRetry <= now);
}

/** Update retry count / nextRetry after a failed attempt. */
export async function updateSyncItemRetry(item: SyncQueueItem): Promise<void> {
  const backoffMs = Math.min(30_000, 1_000 * 2 ** item.retries); // exp. backoff, max 30s
  await idbPut(S.SYNC_QUEUE, {
    ...item,
    retries:   item.retries + 1,
    nextRetry: Date.now() + backoffMs,
  });
}

/** Remove a successfully synced item. */
export async function removeSyncItem(id: number): Promise<void> {
  await idbDelete(S.SYNC_QUEUE, id);
}

/** Count pending items (for the UI badge). */
export async function countPendingSyncItems(): Promise<number> {
  const all = await idbGetAll<SyncQueueItem>(S.SYNC_QUEUE);
  return all.length;
}

// ─── 5. Integrity / monitoring offline queue ──────────────────────────────────

export interface IntegrityLogRecord {
  id?:        number;
  sessionId:  string;
  flagType:   string;
  metadata:   Record<string, unknown>;
  ts:         number;
  synced:     boolean;
}

/** Store an integrity event locally when offline. */
export async function queueIntegrityLog(
  sessionId: string,
  flagType: string,
  metadata: Record<string, unknown>
): Promise<void> {
  await idbAdd(S.INTEGRITY, {
    sessionId,
    flagType,
    metadata,
    ts:     Date.now(),
    synced: false,
  });
}

/** Fetch all un-synced integrity logs for a session. */
export async function getUnsynedIntegrityLogs(sessionId: string): Promise<IntegrityLogRecord[]> {
  const rows = await idbGetByIndex<IntegrityLogRecord>(S.INTEGRITY, "bySession", sessionId);
  return rows.filter((r) => !r.synced);
}

/** Mark an integrity log as synced. */
export async function markIntegrityLogSynced(id: number): Promise<void> {
  const db = await openDB();
  if (!db) return;
  const rec = await idbGet<IntegrityLogRecord>(S.INTEGRITY, id);
  if (rec) await idbPut(S.INTEGRITY, { ...rec, synced: true });
}

// ─── examCache.ts backward-compat: localStorage answer helpers ──────────────

const answersLSKey = (sessionId: string) => `cache:answers:${sessionId}`;

export function saveLocalAnswers(sessionId: string, answers: Record<string, unknown>): void {
  if (typeof window === "undefined" || !sessionId) return;
  try {
    localStorage.setItem(answersLSKey(sessionId), JSON.stringify({ ts: Date.now(), answers }));
  } catch { /* quota */ }
}

export function loadLocalAnswers(sessionId: string): Record<string, unknown> {
  if (typeof window === "undefined" || !sessionId) return {};
  try {
    const raw = localStorage.getItem(answersLSKey(sessionId));
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed?.answers && typeof parsed.answers === "object" ? parsed.answers : {};
  } catch { return {}; }
}

export function clearLocalAnswers(sessionId: string): void {
  if (typeof window === "undefined" || !sessionId) return;
  try { localStorage.removeItem(answersLSKey(sessionId)); } catch { /* ignore */ }
}

export function mergeAnswers(
  server: Record<string, unknown> | null | undefined,
  local: Record<string, unknown> | null | undefined
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...(server || {}) };
  for (const [qid, val] of Object.entries(local || {})) {
    const isEmpty = val === undefined || val === null || val === "";
    if (!isEmpty) merged[qid] = val;
    else if (!(qid in merged)) merged[qid] = val;
  }
  return merged;
}

// ─── examCache.ts backward-compat: exam list (localStorage) ─────────────────

const EXAM_LIST_KEY    = "cache:exams:v1";
const EXAM_LIST_TTL_MS = 5 * 60 * 1000;

interface ExamListEnvelope { ts: number; data: unknown[]; }

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

export function loadCachedExams(): { data: unknown[]; stale: boolean } | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(EXAM_LIST_KEY);
    if (!raw) return null;
    const env = JSON.parse(raw) as ExamListEnvelope;
    if (!env || !Array.isArray(env.data)) return null;
    return { data: env.data, stale: Date.now() - env.ts > EXAM_LIST_TTL_MS };
  } catch { return null; }
}

export function saveCachedExams(data: unknown[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(EXAM_LIST_KEY, JSON.stringify({ ts: Date.now(), data } as ExamListEnvelope));
  } catch { /* quota */ }
}
