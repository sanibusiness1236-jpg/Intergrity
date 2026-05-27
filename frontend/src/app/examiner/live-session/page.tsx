"use client";

import { type ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import api from "@/lib/api";
import { connectSocket } from "@/lib/socket";
import { DashboardShell, GlowButton } from "@/components/dashboard/DashboardShell";
import type { Exam } from "@/types";

/* ── Types ─────────────────────────────────────────────────── */
interface LiveRow {
  sessionId: string; examId: string; examTitle: string; examCourseCode: string;
  studentDbId: string; studentName: string; studentUsername: string;
  gender: string; program: string; status: string;
  submittedAt: string | null;
  tab_switch_flag: boolean; tab_switch_count: number; time_away_exam_site: number;
  answer_paste_flag: boolean;
  // ── File-usage detections (replaces the old USB column) ──
  file_drop_flag: boolean; file_drop_count: number;
  file_input_flag: boolean; file_input_count: number;
  clipboard_file_flag: boolean; clipboard_file_count: number;
  window_minimize_flag: boolean; multi_device_login_flag: boolean;
  total_flags: number; lastFlagAt: string | null; startedAt: string;
}
interface LogEntry { timestamp: string; type: string; category: string; description: string; severity: "critical" | "high" | "medium" | "low" | "info"; }
interface DeepLog {
  student: { name: string; id: string }; exam: { title: string; code: string };
  status: string; startedAt: string; submittedAt: string | null;
  logs: LogEntry[];
  summary: { total: number; tab_switches: number; paste_events: number; window_blurs: number; usb_detections: number; multi_device: number; devtools: number; inactivity: number; right_clicks: number; };
}

/* ── Helpers ───────────────────────────────────────────────── */
const Svg = ({ d, size = 16 }: { d: string; size?: number }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>
);

const SEV_STYLES: Record<string, string> = {
  critical: "bg-rose-500/20 text-rose-300 border-rose-500/30",
  high:     "bg-orange-500/15 text-orange-300 border-orange-500/30",
  medium:   "bg-amber-500/15 text-amber-300 border-amber-500/30",
  low:      "bg-blue-500/10 text-blue-300 border-blue-500/20",
  info:     "bg-white/5 text-white/50 border-white/10",
};
const SEV_DOT: Record<string, string> = {
  critical: "bg-rose-400 animate-pulse", high: "bg-orange-400", medium: "bg-amber-400", low: "bg-blue-400", info: "bg-white/30",
};

function fmtTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}
function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString();
}
function fmtSubmittedAt(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString();
}

function downloadCSV(filename: string, headers: string[], rows: (string | number | boolean | null)[][]) {
  const esc = (v: string | number | boolean | null) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const csv = [headers, ...rows].map((r) => r.map(esc).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = filename; a.click(); URL.revokeObjectURL(url);
}

/* ── Column definitions ────────────────────────────────────── */
type SortDir = "asc" | "desc";
interface SortState { key: string; dir: SortDir; }

interface ColumnDef {
  key: string;                              // sort key (must be a top-level field of LiveRow)
  label: string;                            // header label
  align?: "left" | "right" | "center";
  // Optional getter for sorting — defaults to row[key]
  getValue?: (r: LiveRow) => string | number | boolean | null;
}

const COLUMNS: ColumnDef[] = [
  { key: "examCourseCode", label: "EXAM" },
  { key: "studentName",    label: "STUDENT NAME" },
  { key: "status",         label: "STATUS" },
  { key: "submittedAt",    label: "SUBMISSION TIME", getValue: (r) => r.submittedAt || "" },
  { key: "tab_switch_flag",         label: "TAB SWITCH FLAG",            align: "center", getValue: (r) => (r.tab_switch_flag ? 1 : 0) },
  { key: "tab_switch_count",        label: "TAB SWITCH COUNT",           align: "center" },
  { key: "time_away_exam_site",     label: "TIME AWAY FROM EXAM SITE (s)", align: "center" },
  { key: "answer_paste_flag",       label: "ANSWER PASTE FLAG",          align: "center", getValue: (r) => (r.answer_paste_flag ? 1 : 0) },
  // ── File-usage detections ──
  { key: "file_drop_flag",          label: "Dragging a file onto the exam window", align: "center", getValue: (r) => (r.file_drop_flag ? 1 : 0) },
  { key: "file_input_flag",         label: "Opening the file picker",              align: "center", getValue: (r) => (r.file_input_flag ? 1 : 0) },
  { key: "clipboard_file_flag",     label: "Pasting file content from clipboard", align: "center", getValue: (r) => (r.clipboard_file_flag ? 1 : 0) },
  { key: "window_minimize_flag",    label: "WINDOW MINIMIZE FLAG",       align: "center", getValue: (r) => (r.window_minimize_flag ? 1 : 0) },
  { key: "multi_device_login_flag", label: "MULTI DEVICE LOGIN FLAG",    align: "center", getValue: (r) => (r.multi_device_login_flag ? 1 : 0) },
];

const CSV_HEADERS = [
  "Exam", "Course Code", "Student Name", "Username", "Gender", "Program",
  "Status", "Submission Time",
  "Tab Switch Flag", "Tab Switch Count", "Time Away From Exam Site (s)",
  "Answer Paste Flag",
  "Dragging a file onto the exam window",
  "Opening the file picker",
  "Pasting file content from clipboard",
  "Window Minimize Flag", "Multi Device Login Flag",
  "Total Flags", "Last Flag At", "Started At",
];
function rowToCSV(r: LiveRow) {
  return [
    r.examTitle, r.examCourseCode,
    r.studentName, r.studentUsername, r.gender, r.program,
    r.status, fmtSubmittedAt(r.submittedAt),
    r.tab_switch_flag ? "Yes" : "No", r.tab_switch_count, r.time_away_exam_site,
    r.answer_paste_flag ? "Yes" : "No",
    r.file_drop_flag ? "Yes" : "No",
    r.file_input_flag ? "Yes" : "No",
    r.clipboard_file_flag ? "Yes" : "No",
    r.window_minimize_flag ? "Yes" : "No",
    r.multi_device_login_flag ? "Yes" : "No",
    r.total_flags, r.lastFlagAt ?? "", r.startedAt,
  ];
}

/* ══════════════════════════════════════════════════════════════ */
export default function LiveSessionPage() {
  const [exams, setExams] = useState<Exam[]>([]);
  // Multi-exam selection
  const [selectedExamIds, setSelectedExamIds] = useState<string[]>([]);
  const [examInfos, setExamInfos] = useState<{ id: string; title: string; courseCode: string }[]>([]);

  const [rows, setRows] = useState<LiveRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [polling, setPolling] = useState(false);
  const [polledAt, setPolledAt] = useState<string | null>(null);
  const [error, setError] = useState("");

  // Filters
  const [search, setSearch] = useState("");
  const [genderFilter, setGenderFilter] = useState("");

  // Row selection
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Sort
  const [sort, setSort] = useState<SortState>({ key: "startedAt", dir: "desc" });

  // New-flag highlights
  const [highlighted, setHighlighted] = useState<Set<string>>(new Set());
  const prevCounts = useRef<Record<string, number>>({});

  // Deeper insight mode
  const [deepMode, setDeepMode] = useState(false);
  const [deepLog, setDeepLog] = useState<DeepLog | null>(null);
  const [deepLogLoading, setDeepLogLoading] = useState(false);
  const [deepLogOpen, setDeepLogOpen] = useState(false);

  // Delete modal
  const [showDelete, setShowDelete] = useState(false);
  const [deletePassword, setDeletePassword] = useState("");
  const [deleteError, setDeleteError] = useState("");
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    api.get("/exams").then(({ data }) => setExams(data.data || [])).catch(() => {});
  }, []);

  /* ── Live polling ───────────────────────────────────────── */
  useEffect(() => {
    if (selectedExamIds.length === 0) { setRows([]); setExamInfos([]); return; }
    let active = true;
    async function poll() {
      try {
        setPolling(true);
        const params = new URLSearchParams({ examId: selectedExamIds.join(",") });
        if (search) params.set("search", search);
        if (genderFilter) params.set("gender", genderFilter);
        const { data } = await api.get(`/integrity/live-sessions?${params}`);
        if (!active) return;
        const newRows: LiveRow[] = data.data.rows;
        setExamInfos(data.data.exams || []);
        setPolledAt(data.data.polledAt);

        // Highlight rows whose total_flags increased since the last poll
        const newHighlights = new Set<string>();
        newRows.forEach((r) => {
          const prev = prevCounts.current[r.sessionId];
          if (prev !== undefined && r.total_flags > prev) newHighlights.add(r.sessionId);
          prevCounts.current[r.sessionId] = r.total_flags;
        });
        if (newHighlights.size > 0) {
          setHighlighted(newHighlights);
          setTimeout(() => setHighlighted(new Set()), 3500);
        }
        setRows(newRows);
        setError("");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } catch (e: any) {
        if (active) setError(e.response?.data?.error?.message || "Failed to fetch session data");
      } finally {
        if (active) setPolling(false);
      }
    }
    setLoading(true);
    poll().finally(() => setLoading(false));
    const timer = setInterval(poll, 5000);
    return () => { active = false; clearInterval(timer); };
  }, [selectedExamIds, search, genderFilter]);

  /* ── Real-time socket: instant flag updates ─────────────────
   *
   * Flow:
   *   Exam starts → useAntiCheat hook emits flag:report via socket
   *   → backend saves to DB → emits flag:new to exam:${examId} room
   *   → this handler receives it and updates the row IMMEDIATELY
   *     (no waiting for the next 5-second poll)
   *
   * The polling above stays as a reconciliation fallback in case a
   * socket event is missed during a reconnect.
   * ─────────────────────────────────────────────────────────── */
  useEffect(() => {
    if (selectedExamIds.length === 0) return;

    const socket = connectSocket();

    // Join the examiner monitor room for every selected exam
    selectedExamIds.forEach((id) => socket.emit("join:monitor", { examId: id }));

    function onFlagNew(payload: {
      sessionId: string;
      flagType: string;
      metadata?: Record<string, unknown>;
      createdAt: string;
    }) {
      const { sessionId, flagType, metadata, createdAt } = payload;

      setRows((prev) =>
        prev.map((row) => {
          if (row.sessionId !== sessionId) return row;

          const updated = { ...row, total_flags: row.total_flags + 1, lastFlagAt: createdAt };

          switch (flagType) {
            case "USB_DETECTED": {
              // Route to the right column based on device_type metadata
              const deviceType = metadata?.device_type;
              if (deviceType === "file_input") {
                updated.file_input_flag = true;
                updated.file_input_count = (row.file_input_count ?? 0) + 1;
              } else if (deviceType === "clipboard_file") {
                updated.clipboard_file_flag = true;
                updated.clipboard_file_count = (row.clipboard_file_count ?? 0) + 1;
              } else {
                // drag_drop_file (default for legacy / unknown USB events)
                updated.file_drop_flag = true;
                updated.file_drop_count = (row.file_drop_count ?? 0) + 1;
              }
              break;
            }
            case "TAB_SWITCH":
              updated.tab_switch_flag = true;
              updated.tab_switch_count = (row.tab_switch_count ?? 0) + 1;
              updated.time_away_exam_site =
                (row.time_away_exam_site ?? 0) +
                (typeof metadata?.seconds === "number" ? metadata.seconds : 0);
              break;
            case "PASTE_EVENT":
              updated.answer_paste_flag = true;
              break;
            case "WINDOW_BLUR":
              updated.window_minimize_flag = true;
              break;
            case "MULTI_DEVICE":
              updated.multi_device_login_flag = true;
              break;
          }

          // Flash-highlight this row so the examiner sees it change
          setHighlighted((h) => {
            const next = new Set(h);
            next.add(sessionId);
            setTimeout(() => setHighlighted((hh) => { const s = new Set(hh); s.delete(sessionId); return s; }), 3500);
            return next;
          });

          return updated;
        })
      );
    }

    socket.on("flag:new", onFlagNew);

    return () => {
      socket.off("flag:new", onFlagNew);
    };
  }, [selectedExamIds]);

  /* ── Sorted view ────────────────────────────────────────── */
  const sortedRows = useMemo(() => {
    const col = COLUMNS.find((c) => c.key === sort.key);
    const get = col?.getValue ?? ((r: LiveRow) => (r as unknown as Record<string, string | number | boolean | null>)[sort.key]);
    const copy = [...rows];
    copy.sort((a, b) => {
      const va = get(a);
      const vb = get(b);
      if (va === null || va === undefined) return 1;
      if (vb === null || vb === undefined) return -1;
      if (typeof va === "number" && typeof vb === "number") return sort.dir === "asc" ? va - vb : vb - va;
      const sa = String(va).toLowerCase();
      const sb = String(vb).toLowerCase();
      return sort.dir === "asc" ? sa.localeCompare(sb) : sb.localeCompare(sa);
    });
    return copy;
  }, [rows, sort]);

  function toggleSort(key: string) {
    setSort((prev) => {
      if (prev.key === key) return { key, dir: prev.dir === "asc" ? "desc" : "asc" };
      return { key, dir: "asc" };
    });
  }

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const s = new Set(prev);
      if (s.has(id)) s.delete(id); else s.add(id);
      return s;
    });
  }
  function toggleAll() {
    if (selected.size === sortedRows.length) setSelected(new Set());
    else setSelected(new Set(sortedRows.map((r) => r.sessionId)));
  }

  function toggleExam(id: string) {
    setSelectedExamIds((prev) => {
      const has = prev.includes(id);
      const next = has ? prev.filter((x) => x !== id) : [...prev, id];
      prevCounts.current = {};
      setRows([]);
      return next;
    });
  }
  function selectAllExams() {
    setSelectedExamIds(exams.map((e) => e.id));
    prevCounts.current = {};
  }
  function clearExams() {
    setSelectedExamIds([]);
    prevCounts.current = {};
  }

  function handleDownload(all: boolean) {
    const target = all ? sortedRows : sortedRows.filter((r) => selected.has(r.sessionId));
    if (!target.length) return;
    const label = examInfos.length === 1 ? examInfos[0].courseCode : `multi_${examInfos.length}_exams`;
    downloadCSV(`live_session_${label}.csv`, CSV_HEADERS, target.map(rowToCSV));
  }

  function handleSaveSnapshot() {
    const label = examInfos.length === 1 ? examInfos[0].courseCode : `multi_${examInfos.length}_exams`;
    downloadCSV(`snapshot_${label}_${Date.now()}.csv`, CSV_HEADERS, sortedRows.map(rowToCSV));
  }

  async function openDeepLog(sessionId: string) {
    setDeepLogLoading(true); setDeepLogOpen(true); setDeepLog(null);
    try {
      const { data } = await api.get(`/integrity/live-sessions/${sessionId}/deep-log`);
      setDeepLog(data.data);
    } catch {
      setDeepLog(null);
    } finally {
      setDeepLogLoading(false);
    }
  }

  async function handleDelete() {
    if (selectedExamIds.length === 0 || !deletePassword) return;
    setDeleting(true); setDeleteError("");
    try {
      // Delete for each selected exam
      for (const id of selectedExamIds) {
        await api.delete("/integrity/live-sessions", { data: { examId: id, password: deletePassword } });
      }
      setRows([]); setShowDelete(false); setDeletePassword("");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (e: any) {
      setDeleteError(e.response?.data?.error?.message || "Deletion failed");
    } finally {
      setDeleting(false);
    }
  }

  function downloadDeepLog() {
    if (!deepLog) return;
    const headers = ["Timestamp", "Type", "Category", "Description", "Severity"];
    const logRows = deepLog.logs.map((l) => [fmtDateTime(l.timestamp), l.type, l.category, l.description, l.severity]);
    downloadCSV(`deep_log_${deepLog.student.name.replace(/ /g, "_")}.csv`, headers, logRows);
  }

  const live = sortedRows.filter((r) => r.status === "IN_PROGRESS").length;
  const flagged = sortedRows.filter((r) => r.total_flags > 0).length;
  const monitoringCount = selectedExamIds.length;

  return (
    <DashboardShell>
      <div className="flex gap-5 min-h-[80vh]">
        {/* ── Left sidebar ───────────────────────────────── */}
        <aside className="w-72 shrink-0">
          <div className="sticky top-6 rounded-xl border border-white/5 bg-slate-950/70 p-5 backdrop-blur-xl space-y-5">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className={`h-2 w-2 rounded-full ${monitoringCount > 0 && !error ? "bg-emerald-400 animate-pulse" : "bg-white/20"}`} />
                <h2 className="text-sm font-bold text-white">Live Session</h2>
              </div>
              <p className="text-[11px] leading-relaxed text-white/40">Track students live activities during exams</p>
            </div>

            {/* Multi-exam selector */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-[10px] font-semibold uppercase tracking-wider text-white/40">
                  Exams to monitor ({monitoringCount}/{exams.length})
                </label>
                <div className="flex gap-1">
                  <button
                    onClick={selectAllExams}
                    className="text-[10px] text-indigo-300 hover:text-indigo-200"
                    title="Select all exams"
                  >All</button>
                  <span className="text-[10px] text-white/20">·</span>
                  <button
                    onClick={clearExams}
                    className="text-[10px] text-white/40 hover:text-white"
                  >Clear</button>
                </div>
              </div>
              <div className="max-h-56 overflow-y-auto rounded-lg border border-white/10 bg-white/[0.02] p-1.5">
                {exams.length === 0 ? (
                  <p className="px-2 py-1 text-[11px] text-white/30">No exams yet.</p>
                ) : exams.map((e) => {
                  const isChecked = selectedExamIds.includes(e.id);
                  return (
                    <label
                      key={e.id}
                      className={`flex cursor-pointer items-start gap-2 rounded px-2 py-1.5 text-[11px] transition ${
                        isChecked ? "bg-indigo-500/10" : "hover:bg-white/5"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => toggleExam(e.id)}
                        className="mt-0.5 accent-indigo-500"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium text-white">{e.title}</span>
                        <span className="block text-[10px] text-white/40">{e.courseCode}</span>
                      </span>
                    </label>
                  );
                })}
              </div>
              <p className="text-[10px] text-white/30">
                Tick multiple exams to monitor them simultaneously.
              </p>
            </div>

            {/* Search */}
            <div className="space-y-1.5">
              <label className="text-[10px] font-semibold uppercase tracking-wider text-white/40">Search Student</label>
              <div className="relative">
                <input className="auth-input h-10 w-full rounded-lg px-3 text-xs" placeholder="Name or username…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ paddingLeft: "2rem" }} />
                <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-white/30 pointer-events-none">
                  <Svg d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0" size={13} />
                </span>
              </div>
            </div>

            {/* Gender filter */}
            <div className="space-y-1.5">
              <label className="text-[10px] font-semibold uppercase tracking-wider text-white/40">Filter by Gender</label>
              <select className="auth-input h-10 w-full rounded-lg px-3 text-xs" value={genderFilter} onChange={(e) => setGenderFilter(e.target.value)}>
                <option value="" className="bg-slate-900">All genders</option>
                <option value="male" className="bg-slate-900">Male</option>
                <option value="female" className="bg-slate-900">Female</option>
                <option value="other" className="bg-slate-900">Other</option>
              </select>
            </div>

            {/* Stats */}
            {monitoringCount > 0 && sortedRows.length > 0 && (
              <div className="rounded-lg border border-white/5 bg-white/[0.02] p-3 space-y-2">
                <div className="flex justify-between text-[10px]"><span className="text-white/40">Total Students</span><span className="font-bold text-white">{sortedRows.length}</span></div>
                <div className="flex justify-between text-[10px]"><span className="text-white/40">Live Now</span><span className="font-bold text-emerald-400">{live}</span></div>
                <div className="flex justify-between text-[10px]"><span className="text-white/40">Flagged</span><span className={`font-bold ${flagged > 0 ? "text-rose-400" : "text-white/40"}`}>{flagged}</span></div>
                {polledAt && <div className="text-[9px] text-white/20 pt-1 border-t border-white/5">Updated {fmtTime(polledAt)}</div>}
              </div>
            )}

            {/* Action buttons */}
            <div className="space-y-2 pt-1">
              <button onClick={() => setDeepMode(!deepMode)} className={`w-full rounded-lg border px-3 py-2 text-xs font-semibold transition ${deepMode ? "border-indigo-400/40 bg-indigo-500/15 text-indigo-300" : "border-white/10 bg-white/5 text-white/70 hover:bg-white/10"}`}>
                {deepMode ? "✓ Seek Deeper Insight" : "Seek Deeper Insight"}
              </button>
              <button onClick={handleSaveSnapshot} disabled={!sortedRows.length} className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-white/70 transition hover:bg-white/10 disabled:opacity-40">
                Save & Download Session
              </button>
              <button onClick={() => handleDownload(true)} disabled={!sortedRows.length} className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-white/70 transition hover:bg-white/10 disabled:opacity-40">
                Download All as CSV
              </button>
              <button onClick={() => handleDownload(false)} disabled={selected.size === 0} className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-white/70 transition hover:bg-white/10 disabled:opacity-40">
                Download Selected ({selected.size})
              </button>
              <button onClick={() => setShowDelete(true)} disabled={monitoringCount === 0 || !sortedRows.length} className="w-full rounded-lg border border-rose-500/20 bg-rose-500/5 px-3 py-2 text-xs font-semibold text-rose-400 transition hover:bg-rose-500/10 disabled:opacity-40">
                Delete Session Data
              </button>
            </div>
          </div>
        </aside>

        {/* ── Main content ────────────────────────────────── */}
        <div className="min-w-0 flex-1 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-white">Live Session Monitor</h1>
              {examInfos.length > 0 && (
                <p className="text-sm text-white/40">
                  {examInfos.length === 1
                    ? `${examInfos[0].title} · ${examInfos[0].courseCode}`
                    : `Monitoring ${examInfos.length} exams simultaneously`}
                </p>
              )}
            </div>
            <div className="flex items-center gap-2 text-xs text-white/40">
              {polling && <><span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" /> Polling</>}
              {monitoringCount === 0 && <span>Select one or more exams to begin monitoring</span>}
            </div>
          </div>

          {error && <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">{error}</div>}

          {monitoringCount === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-2xl border border-white/5 bg-white/[0.02] py-32 text-center">
              <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-white/5">
                <Svg d="M15 10l4.553-2.069A1 1 0 0121 8.87v6.26a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" size={28} />
              </div>
              <p className="text-white/40 text-sm">Tick one or more exams in the sidebar to start live monitoring</p>
            </div>
          ) : loading && sortedRows.length === 0 ? (
            <div className="flex items-center justify-center py-32"><svg className="h-8 w-8 animate-spin text-indigo-400" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25" /><path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="3" strokeLinecap="round" /></svg></div>
          ) : sortedRows.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-2xl border border-white/5 bg-white/[0.02] py-24 text-center">
              <p className="text-white/30 text-sm">No active sessions found for the selected exam(s).</p>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-2xl border border-white/10">
              <table className="w-full text-xs">
                <thead className="sticky top-0 z-10 bg-slate-950/95">
                  <tr>
                    <th className="border-b border-white/10 p-3 text-left">
                      <input type="checkbox" checked={selected.size === sortedRows.length && sortedRows.length > 0} onChange={toggleAll} className="accent-indigo-500" />
                    </th>
                    {COLUMNS.map((c) => {
                      const isActive = sort.key === c.key;
                      return (
                        <th
                          key={c.key}
                          onClick={() => toggleSort(c.key)}
                          className={`cursor-pointer border-b border-white/10 p-3 ${c.align === "center" ? "text-center" : "text-left"} font-semibold uppercase tracking-wider transition select-none ${
                            isActive ? "text-indigo-300" : "text-white/35 hover:text-white/60"
                          }`}
                          title="Click to sort"
                        >
                          <span className="inline-flex items-center gap-1">
                            {c.label}
                            <span className="text-[9px] opacity-60">
                              {isActive ? (sort.dir === "asc" ? "▲" : "▼") : ""}
                            </span>
                          </span>
                        </th>
                      );
                    })}
                    {deepMode && <th className="border-b border-white/10 p-3 text-left font-semibold uppercase tracking-wider text-indigo-400">Deeper Insight</th>}
                  </tr>
                </thead>
                <tbody>
                  {sortedRows.map((r) => {
                    const isNew = highlighted.has(r.sessionId);
                    const isSel = selected.has(r.sessionId);
                    return (
                      <tr key={r.sessionId} className={`border-b border-white/5 transition-all duration-700 ${isNew ? "bg-indigo-500/10 ring-1 ring-inset ring-indigo-500/20" : isSel ? "bg-white/[0.03]" : "hover:bg-white/[0.02]"}`}>
                        <td className="p-3"><input type="checkbox" checked={isSel} onChange={() => toggleSelect(r.sessionId)} className="accent-indigo-500" /></td>

                        <td className="p-3">
                          <div className="flex flex-col">
                            <span className="font-semibold text-white/90 truncate max-w-[140px]">{r.examCourseCode || "—"}</span>
                            <span className="text-[10px] text-white/35 truncate max-w-[140px]">{r.examTitle}</span>
                          </div>
                        </td>

                        <td className="p-3">
                          <div className="flex flex-col">
                            <span className="font-semibold text-white">{r.studentName}</span>
                            <span className="text-[10px] text-white/35">{r.studentUsername}</span>
                          </div>
                        </td>

                        <td className="p-3">
                          <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${r.status === "IN_PROGRESS" ? "bg-emerald-500/15 text-emerald-300" : r.status === "SUBMITTED" ? "bg-blue-500/15 text-blue-300" : "bg-white/5 text-white/30"}`}>
                            {r.status.replace(/_/g, " ")}
                          </span>
                        </td>

                        <td className="p-3 text-white/70">
                          <span className="text-[11px]">{fmtSubmittedAt(r.submittedAt)}</span>
                        </td>

                        <BoolCell v={r.tab_switch_flag} />
                        <NumCell v={r.tab_switch_count} warn={3} critical={8} />
                        <NumCell v={r.time_away_exam_site} warn={10} critical={30} suffix="s" />
                        <BoolCell v={r.answer_paste_flag} />
                        <BoolCell v={r.file_drop_flag} />
                        <BoolCell v={r.file_input_flag} />
                        <BoolCell v={r.clipboard_file_flag} />
                        <BoolCell v={r.window_minimize_flag} />
                        <BoolCell v={r.multi_device_login_flag} />

                        {deepMode && (
                          <td className="p-3">
                            <button onClick={() => openDeepLog(r.sessionId)} className="text-indigo-400 underline underline-offset-2 hover:text-indigo-300 transition text-[11px] font-medium">
                              View Logs {r.total_flags > 0 && <span className="ml-0.5 rounded bg-rose-500/20 px-1 text-rose-300">{r.total_flags}</span>}
                            </button>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Legend */}
          {sortedRows.length > 0 && (
            <div className="flex flex-wrap items-center gap-4 text-[10px] text-white/30">
              <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-indigo-400 animate-pulse" /> Row flashes blue when a new flag is detected</span>
              <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-rose-400" /> Critical value</span>
              <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-amber-400" /> Warning value</span>
              <span>Click any column header to sort · Polls every 5 s</span>
            </div>
          )}
        </div>
      </div>

      {/* ── Deep Log Panel ───────────────────────────────── */}
      {deepLogOpen && (
        <div className="fixed inset-0 z-50 flex">
          <div className="flex-1 bg-black/60 backdrop-blur-sm" onClick={() => setDeepLogOpen(false)} />
          <aside className="flex w-full max-w-lg flex-col bg-slate-900 shadow-2xl ring-1 ring-white/10 overflow-hidden">
            <div className="border-b border-white/10 p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-base font-bold text-white">Activity Logs</h2>
                  {deepLog && <p className="mt-0.5 text-xs text-white/40">{deepLog.student.name} · {deepLog.exam.title}</p>}
                </div>
                <div className="flex items-center gap-2">
                  <GlowButton onClick={downloadDeepLog} disabled={!deepLog} variant="ghost" size="sm">
                    <Svg d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" size={13} /> Download
                  </GlowButton>
                  <button onClick={() => setDeepLogOpen(false)} className="rounded-lg border border-white/10 p-2 text-white/40 hover:bg-white/5">
                    <Svg d="M6 18L18 6M6 6l12 12" size={14} />
                  </button>
                </div>
              </div>
              {deepLog && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {[
                    { l: "Tab Switches", v: deepLog.summary.tab_switches, c: "text-orange-300" },
                    { l: "Paste Events", v: deepLog.summary.paste_events, c: "text-rose-300" },
                    { l: "Window Blurs", v: deepLog.summary.window_blurs, c: "text-amber-300" },
                    { l: "USB", v: deepLog.summary.usb_detections, c: "text-rose-300" },
                    { l: "Multi-Device", v: deepLog.summary.multi_device, c: "text-rose-300" },
                    { l: "Dev Tools", v: deepLog.summary.devtools, c: "text-rose-300" },
                    { l: "Inactivity", v: deepLog.summary.inactivity, c: "text-amber-300" },
                    { l: "Right Clicks", v: deepLog.summary.right_clicks, c: "text-blue-300" },
                  ].map((x) => (
                    <span key={x.l} className="rounded border border-white/5 bg-white/[0.03] px-2 py-0.5 text-[10px]">
                      <span className="text-white/40">{x.l}: </span>
                      <span className={`font-bold ${x.c}`}>{x.v}</span>
                    </span>
                  ))}
                </div>
              )}
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-1">
              {deepLogLoading && (
                <div className="flex items-center justify-center py-20">
                  <svg className="h-8 w-8 animate-spin text-indigo-400" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25" /><path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="3" strokeLinecap="round" /></svg>
                </div>
              )}
              {deepLog && deepLog.logs.length === 0 && (
                <div className="flex items-center justify-center py-20 text-sm text-white/30">No activity logs recorded.</div>
              )}
              {deepLog?.logs.map((log, i) => (
                <div key={i} className={`flex gap-3 rounded-lg border p-3 ${SEV_STYLES[log.severity]}`}>
                  <div className="mt-1 flex-shrink-0">
                    <span className={`block h-2 w-2 rounded-full ${SEV_DOT[log.severity]}`} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[10px] font-mono text-white/40">{fmtDateTime(log.timestamp)}</span>
                      <span className={`rounded border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider ${SEV_STYLES[log.severity]}`}>{log.severity}</span>
                      <span className="text-[10px] text-white/40">{log.category}</span>
                    </div>
                    <p className="mt-0.5 text-xs font-medium text-white/80">{log.description}</p>
                  </div>
                </div>
              ))}
            </div>

            <div className="border-t border-white/5 p-4">
              <p className="text-[10px] text-white/20 leading-relaxed">
                Tracked: copy/paste · right-click · developer tools · inactivity · tab changes · window focus · USB · multi-device · print-screen · rapid switching · external navigation · fullscreen exit · keyboard shortcuts
              </p>
            </div>
          </aside>
        </div>
      )}

      {/* ── Delete Confirmation Modal ─────────────────────── */}
      {showDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => { setShowDelete(false); setDeletePassword(""); setDeleteError(""); }} />
          <div className="relative w-full max-w-sm rounded-2xl border border-rose-500/20 bg-slate-900 p-6 shadow-2xl">
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-rose-500/10 ring-1 ring-rose-500/20">
              <Svg d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" size={22} />
            </div>
            <h3 className="text-base font-bold text-white">Delete Session Data</h3>
            <p className="mt-1 text-xs text-white/50">
              This will permanently delete all behavioral flag records for{" "}
              <span className="font-semibold text-white">
                {examInfos.length === 1 ? examInfos[0].title : `${examInfos.length} selected exams`}
              </span>. This cannot be undone.
            </p>
            <div className="mt-4 space-y-1.5">
              <label className="text-[10px] font-semibold uppercase tracking-wider text-white/50">Enter your password to confirm</label>
              <input type="password" className="auth-input h-11 w-full rounded-lg px-3 text-sm" placeholder="Your password…" value={deletePassword} onChange={(e: ChangeEvent<HTMLInputElement>) => setDeletePassword(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleDelete()} />
            </div>
            {deleteError && <p className="mt-2 text-xs text-rose-400">{deleteError}</p>}
            <div className="mt-5 flex gap-3">
              <button onClick={() => { setShowDelete(false); setDeletePassword(""); setDeleteError(""); }} className="flex-1 rounded-lg border border-white/10 py-2.5 text-sm text-white/60 hover:bg-white/5">Cancel</button>
              <button onClick={handleDelete} disabled={!deletePassword || deleting} className="flex-1 rounded-lg bg-rose-600 py-2.5 text-sm font-bold text-white transition hover:bg-rose-500 disabled:opacity-50">
                {deleting ? "Deleting…" : "Delete Data"}
              </button>
            </div>
          </div>
        </div>
      )}
    </DashboardShell>
  );
}

/* ── Sub-components for table cells ─────────────────────────── */
function BoolCell({ v }: { v: boolean }) {
  return (
    <td className="p-3 text-center">
      {v
        ? <span className="rounded bg-rose-500/15 px-1.5 py-0.5 text-[10px] font-bold text-rose-300">YES</span>
        : <span className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] font-semibold text-white/30">NO</span>}
    </td>
  );
}
function NumCell({ v, warn, critical, suffix }: { v: number; warn: number; critical: number; suffix?: string }) {
  const color = v >= critical ? "text-rose-400 font-bold" : v >= warn ? "text-amber-400 font-semibold" : "text-white/40";
  return (
    <td className="p-3 text-center">
      <span className={`text-xs ${color}`}>{v}{suffix ? ` ${suffix}` : ""}</span>
    </td>
  );
}
