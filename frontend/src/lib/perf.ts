/**
 * perf — lightweight client-side performance instrumentation.
 *
 * Measures key UX milestones (login→dashboard, dashboard→exam, question fetch,
 * answer sync, API durations) and logs slow operations to the console so
 * bottlenecks are visible in the field. Zero dependencies, no network calls.
 *
 * Usage:
 *   const end = perfStart("question_fetch");
 *   ...await fetch...
 *   end();                       // logs duration, warns if slow
 *
 *   perfMark("login");           // drop a named timestamp
 *   perfMeasure("login_to_dashboard", "login");  // measure since a mark
 */

const SLOW_THRESHOLD_MS = 1000; // operations slower than this are warned

const marks = new Map<string, number>();

function now(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

const enabled =
  typeof window !== "undefined" &&
  (process.env.NODE_ENV !== "production" ||
    (typeof localStorage !== "undefined" && localStorage.getItem("perf:debug") === "1"));

/** Drop a named timestamp you can measure against later. */
export function perfMark(name: string): void {
  marks.set(name, now());
}

/** Measure elapsed time since a previously set mark. Returns ms (or null). */
export function perfMeasure(label: string, fromMark: string): number | null {
  const start = marks.get(fromMark);
  if (start == null) return null;
  const dur = now() - start;
  report(label, dur);
  return dur;
}

/**
 * Start timing an operation. Returns a function to call when it finishes,
 * which returns the elapsed ms.
 */
export function perfStart(label: string): () => number {
  const start = now();
  return () => {
    const dur = now() - start;
    report(label, dur);
    return dur;
  };
}

/** Wrap an async function with timing. */
export async function perfTrack<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const end = perfStart(label);
  try {
    return await fn();
  } finally {
    end();
  }
}

function report(label: string, dur: number): void {
  if (!enabled) return;
  const rounded = Math.round(dur);
  if (dur >= SLOW_THRESHOLD_MS) {
    // eslint-disable-next-line no-console
    console.warn(`[perf] SLOW ${label}: ${rounded}ms`);
  } else {
    // eslint-disable-next-line no-console
    console.info(`[perf] ${label}: ${rounded}ms`);
  }
}
