/**
 * syncQueue — Background synchronisation engine for offline exam operations.
 *
 * When the network is unavailable, answer saves, integrity flags, and
 * page-refresh logs are written to IndexedDB instead of being sent
 * immediately.  This module handles:
 *
 *   • Flushing all pending items when connectivity returns
 *   • Exponential-backoff retry on individual item failure
 *   • Abandoning items that have failed MAX_RETRIES times
 *   • Broadcasting sync status to registered listeners
 *   • Responding to the Service Worker's SW_SYNC_NOW message
 *
 * Usage:
 *   import { initSyncQueue, enqueueSyncOp, onSyncStatus } from "@/lib/syncQueue";
 *   initSyncQueue(getAuthToken);          // call once on app mount
 *   enqueueSyncOp("AUTOSAVE", sessionId, payload);
 */

import {
  getPendingSyncItems,
  updateSyncItemRetry,
  removeSyncItem,
  enqueueSyncItem,
  getUnsynedIntegrityLogs,
  markIntegrityLogSynced,
  SyncQueueItem,
  SyncItemType,
} from "@/lib/offlineDB";

const MAX_RETRIES    = 5;
const FLUSH_INTERVAL = 30_000; // try flushing every 30 s even while online

type StatusKind = "online" | "offline" | "syncing" | "error";
export type SyncStatus = { kind: StatusKind; pending: number };

type StatusListener = (s: SyncStatus) => void;

let _getToken: (() => string | null) | null = null;
let _flushTimer: ReturnType<typeof setInterval> | null = null;
let _listeners: StatusListener[] = [];
let _isFlushing = false;

const BASE_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:5000";

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Initialise the queue once on app mount.
 * @param getToken  Returns the JWT access-token for authorised requests.
 */
export function initSyncQueue(getToken: () => string | null) {
  if (typeof window === "undefined") return;
  if (_getToken) return; // already initialised

  _getToken = getToken;

  // Online / offline events
  window.addEventListener("online",  handleOnline);
  window.addEventListener("offline", handleOffline);

  // Service Worker posts SW_SYNC_NOW when a background sync fires
  navigator.serviceWorker?.addEventListener("message", (ev) => {
    if (ev.data?.type === "SW_SYNC_NOW") flushQueue();
  });

  // Periodic flush while the tab is open
  _flushTimer = setInterval(() => {
    if (navigator.onLine) flushQueue();
  }, FLUSH_INTERVAL);

  // Initial flush in case there are items from a previous session
  if (navigator.onLine) setTimeout(flushQueue, 3_000);
}

/** Tear down (call on unmount / logout). */
export function destroySyncQueue() {
  if (typeof window === "undefined") return;
  window.removeEventListener("online",  handleOnline);
  window.removeEventListener("offline", handleOffline);
  if (_flushTimer) clearInterval(_flushTimer);
  _flushTimer = null;
  _getToken   = null;
}

/** Enqueue an operation; broadcasts an updated status. */
export async function enqueueSyncOp(
  type: SyncItemType,
  sessionId: string,
  payload: Record<string, unknown>
): Promise<void> {
  await enqueueSyncItem(type, sessionId, payload);
  broadcastStatus("offline");
  // If we're actually online, try an immediate flush
  if (navigator.onLine) flushQueue();
}

/** Subscribe to status updates (for the online/offline indicator UI). */
export function onSyncStatus(fn: StatusListener): () => void {
  _listeners.push(fn);
  return () => { _listeners = _listeners.filter((l) => l !== fn); };
}

/** Trigger an immediate flush attempt (idempotent). */
export function triggerSync() {
  if (navigator.onLine) flushQueue();
}

// ── Internal ──────────────────────────────────────────────────────────────

function handleOnline() {
  broadcastStatus("online");
  flushQueue();
  // Register a Background Sync tag so the SW can retry if the tab closes
  navigator.serviceWorker?.ready.then((reg) => {
    if ("sync" in reg) {
      // @ts-expect-error BackgroundSyncManager not yet in TS lib
      reg.sync.register("integrity-sync").catch(() => {/* ignore */});
    }
  });
}

function handleOffline() {
  broadcastStatus("offline");
}

async function flushQueue() {
  if (_isFlushing) return;
  _isFlushing = true;
  broadcastStatus("syncing");

  try {
    const items = await getPendingSyncItems();
    if (items.length === 0) {
      broadcastStatus("online");
      return;
    }

    // Process all ready items in parallel (max 6 concurrent)
    await runConcurrent(items, 6, processItem);
    broadcastStatus("online");
  } catch (err) {
    console.warn("[syncQueue] flush error:", err);
    broadcastStatus("error");
  } finally {
    _isFlushing = false;
  }
}

async function processItem(item: SyncQueueItem) {
  if (item.retries >= MAX_RETRIES) {
    // Give up — remove the item; answers are still in localStorage as fallback
    console.warn(`[syncQueue] giving up on item ${item.id} after ${MAX_RETRIES} retries`);
    await removeSyncItem(item.id!);
    return;
  }

  const token = _getToken?.();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  try {
    let ok = false;

    switch (item.type) {
      case "AUTOSAVE": {
        const { sessionId, answers } = item.payload as { sessionId: string; answers: Record<string, unknown> };
        const res = await fetch(`${BASE_URL}/api/sessions/${sessionId}/autosave`, {
          method:  "POST",
          headers,
          body:    JSON.stringify({ answers }),
        });
        ok = res.ok;
        break;
      }

      case "LOG_REFRESH": {
        const { sessionId } = item;
        const res = await fetch(`${BASE_URL}/api/sessions/${sessionId}/log-refresh`, {
          method:  "POST",
          headers,
          body:    JSON.stringify(item.payload),
        });
        ok = res.ok;
        break;
      }

      case "INTEGRITY_FLAG": {
        const res = await fetch(`${BASE_URL}/api/sessions/flag`, {
          method:  "POST",
          headers,
          body:    JSON.stringify({ sessionId: item.sessionId, ...item.payload }),
        });
        ok = res.ok;
        break;
      }

      case "SUBMIT": {
        // Exam submission — only retry if the server explicitly 5xx-es
        const { sessionId, answers } = item.payload as { sessionId: string; answers: Record<string, unknown> };
        const res = await fetch(`${BASE_URL}/api/sessions/${sessionId}/submit`, {
          method:  "POST",
          headers,
          body:    JSON.stringify({ answers }),
        });
        ok = res.ok || res.status === 409; // 409 = already submitted → treat as success
        break;
      }

      default:
        ok = true; // unknown type → drop it
    }

    if (ok) {
      await removeSyncItem(item.id!);
    } else {
      await updateSyncItemRetry(item);
    }
  } catch {
    // Network error → increment retry counter
    await updateSyncItemRetry(item);
  }
}

/** Flush offline integrity logs (stored in the integrityQueue store) */
export async function flushIntegrityLogs(sessionId: string): Promise<void> {
  const token = _getToken?.();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  const logs = await getUnsynedIntegrityLogs(sessionId);
  for (const log of logs) {
    try {
      const res = await fetch(`${BASE_URL}/api/sessions/flag`, {
        method:  "POST",
        headers,
        body:    JSON.stringify({
          sessionId: log.sessionId,
          flagType:  log.flagType,
          metadata:  log.metadata,
          ts:        log.ts,
        }),
      });
      if (res.ok) await markIntegrityLogSynced(log.id!);
    } catch { /* will retry next time */ }
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────

function broadcastStatus(kind: StatusKind) {
  // Count from IDB is async; for the indicator we just care about the kind
  const status: SyncStatus = { kind, pending: 0 };
  for (const fn of _listeners) {
    try { fn(status); } catch { /* ignore */ }
  }
}

async function runConcurrent<T>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<void>
): Promise<void> {
  let index = 0;
  async function worker() {
    while (index < items.length) {
      const item = items[index++];
      await fn(item);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
}
