"use client";

import { useCallback, useEffect, useState } from "react";
import api from "@/lib/api";

const Icon = ({ d, size = 16 }: { d: string; size?: number }) => (
  <svg
    viewBox="0 0 24 24"
    width={size}
    height={size}
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d={d} />
  </svg>
);

/* ─── Types ─────────────────────────────────────────── */
interface StudentInfo {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  studentId?: string;
}

interface SessionEntry {
  sessionId: string;
  student: StudentInfo;
  status: string;
  startedAt: string | null;
  submittedAt: string | null;
}

interface IpAnomaly {
  examId: string;
  examTitle: string;
  examCourseCode: string;
  examCourseName: string;
  ipAddress: string;
  sessions: SessionEntry[];
}

interface RefreshEvent {
  flagId: string;
  refreshedAt: string;
  ip: string | null;
}

interface RefreshRow {
  sessionId: string;
  examId: string;
  examTitle: string;
  examCourseCode: string;
  student: StudentInfo;
  sessionStatus: string;
  refreshCount: number;
  refreshEvents: RefreshEvent[];
}

/* ─── Helpers ────────────────────────────────────────── */
function fmt(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString();
}

function statusBadge(status: string) {
  const map: Record<string, string> = {
    SUBMITTED: "bg-emerald-500/15 text-emerald-200 border-emerald-500/30",
    IN_PROGRESS: "bg-indigo-500/15 text-indigo-200 border-indigo-500/30",
    TIMED_OUT: "bg-rose-500/15 text-rose-200 border-rose-500/30",
  };
  return map[status] || "bg-white/5 text-white/50 border-white/10";
}

/* ─── Component ──────────────────────────────────────── */
export default function AnomalySubmissionsPage() {
  const [tab, setTab] = useState<"ip" | "refresh">("ip");
  const [ipAnomalies, setIpAnomalies] = useState<IpAnomaly[]>([]);
  const [refreshRows, setRefreshRows] = useState<RefreshRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [expandedIp, setExpandedIp] = useState<string | null>(null);
  const [expandedRefresh, setExpandedRefresh] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [ipRes, refreshRes] = await Promise.all([
        api.get("/anomaly/ip"),
        api.get("/anomaly/page-refreshes"),
      ]);
      setIpAnomalies(ipRes.data.data || []);
      setRefreshRows(refreshRes.data.data || []);
    } catch {
      setError("Failed to load anomaly data. Please try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 p-6 text-white">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-rose-500/15 border border-rose-500/25">
            <Icon d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" size={20} />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">Anomaly Submissions</h1>
            <p className="text-sm text-white/50">IP-based integrity monitoring and page-refresh tracking</p>
          </div>
        </div>
      </div>

      {/* Tab switcher */}
      <div className="mb-6 flex gap-2">
        <button
          onClick={() => setTab("ip")}
          className={`inline-flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium transition ${
            tab === "ip"
              ? "border-rose-500/40 bg-rose-500/15 text-rose-200"
              : "border-white/10 bg-white/5 text-white/50 hover:bg-white/10"
          }`}
        >
          <Icon d="M9 3H5a2 2 0 00-2 2v4m6-6h10a2 2 0 012 2v4M9 3v18m0 0h10a2 2 0 002-2V9M9 21H5a2 2 0 01-2-2V9m0 0h18" size={14} />
          Shared IP Alerts
          {ipAnomalies.length > 0 && (
            <span className="rounded-full bg-rose-500 px-1.5 py-0.5 text-[10px] font-bold text-white">
              {ipAnomalies.length}
            </span>
          )}
        </button>
        <button
          onClick={() => setTab("refresh")}
          className={`inline-flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium transition ${
            tab === "refresh"
              ? "border-amber-500/40 bg-amber-500/15 text-amber-200"
              : "border-white/10 bg-white/5 text-white/50 hover:bg-white/10"
          }`}
        >
          <Icon d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" size={14} />
          Page Refreshes
          {refreshRows.length > 0 && (
            <span className="rounded-full bg-amber-500 px-1.5 py-0.5 text-[10px] font-bold text-white">
              {refreshRows.length}
            </span>
          )}
        </button>
        <button
          onClick={loadData}
          className="ml-auto inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/60 transition hover:bg-white/10"
        >
          <Icon d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" size={13} />
          Refresh
        </button>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-20">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/20 border-t-white" />
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-rose-200">
          {error}
        </div>
      )}

      {/* ── Shared IP Alerts ────────────────────────── */}
      {!loading && !error && tab === "ip" && (
        <>
          {ipAnomalies.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-500/10 border border-emerald-500/20">
                <Icon d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" size={28} />
              </div>
              <p className="text-lg font-semibold text-white/70">No shared-IP anomalies found</p>
              <p className="mt-1 text-sm text-white/35">
                All exam submissions appear to originate from unique IP addresses.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-sm text-white/40">
                {ipAnomalies.length} alert{ipAnomalies.length !== 1 ? "s" : ""} — multiple students submitted from the same IP address within the same exam.
              </p>
              {ipAnomalies.map((anomaly, idx) => {
                const key = `${anomaly.examId}::${anomaly.ipAddress}`;
                const expanded = expandedIp === key;
                return (
                  <div
                    key={idx}
                    className="rounded-2xl border border-rose-500/25 bg-rose-500/5 overflow-hidden"
                  >
                    <button
                      onClick={() => setExpandedIp(expanded ? null : key)}
                      className="flex w-full items-center gap-4 p-4 text-left transition hover:bg-rose-500/10"
                    >
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-rose-500/20 border border-rose-500/30">
                        <Icon d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" size={16} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-white">
                            {anomaly.examCourseCode} — {anomaly.examTitle}
                          </span>
                          <span className="rounded-full border border-rose-500/30 bg-rose-500/10 px-2 py-0.5 text-[11px] font-semibold text-rose-300">
                            {anomaly.sessions.length} students · same IP
                          </span>
                        </div>
                        <p className="mt-0.5 font-mono text-sm text-white/50">
                          IP: {anomaly.ipAddress}
                        </p>
                      </div>
                      <Icon
                        d={expanded ? "M18 15l-6-6-6 6" : "M6 9l6 6 6-6"}
                        size={16}
                      />
                    </button>

                    {expanded && (
                      <div className="border-t border-rose-500/15 px-4 pb-4">
                        <table className="mt-3 w-full text-sm">
                          <thead>
                            <tr className="border-b border-white/5 text-[10px] font-semibold uppercase tracking-wider text-white/30">
                              <th className="py-2 text-left">Student</th>
                              <th className="py-2 text-left">Student ID</th>
                              <th className="py-2 text-left">Status</th>
                              <th className="py-2 text-left">Started</th>
                              <th className="py-2 text-left">Submitted</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-white/5">
                            {anomaly.sessions.map((s) => (
                              <tr key={s.sessionId} className="text-white/70">
                                <td className="py-2.5 pr-4">
                                  <div className="font-medium text-white">
                                    {s.student.firstName} {s.student.lastName}
                                  </div>
                                  <div className="text-xs text-white/40">{s.student.email}</div>
                                </td>
                                <td className="py-2.5 pr-4 font-mono text-xs">
                                  {s.student.studentId || "—"}
                                </td>
                                <td className="py-2.5 pr-4">
                                  <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${statusBadge(s.status)}`}>
                                    {s.status}
                                  </span>
                                </td>
                                <td className="py-2.5 pr-4 text-xs">{fmt(s.startedAt)}</td>
                                <td className="py-2.5 text-xs">{fmt(s.submittedAt)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* ── Page Refresh Log ──────────────────────── */}
      {!loading && !error && tab === "refresh" && (
        <>
          {refreshRows.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-500/10 border border-emerald-500/20">
                <Icon d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" size={28} />
              </div>
              <p className="text-lg font-semibold text-white/70">No page refresh events</p>
              <p className="mt-1 text-sm text-white/35">
                No student has refreshed their exam page yet.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-white/40">
                {refreshRows.length} student session{refreshRows.length !== 1 ? "s" : ""} recorded at least one page refresh during their exam.
              </p>
              {refreshRows.map((row, idx) => {
                const expanded = expandedRefresh === row.sessionId;
                return (
                  <div
                    key={idx}
                    className="rounded-2xl border border-amber-500/20 bg-amber-500/5 overflow-hidden"
                  >
                    <button
                      onClick={() => setExpandedRefresh(expanded ? null : row.sessionId)}
                      className="flex w-full items-center gap-4 p-4 text-left transition hover:bg-amber-500/10"
                    >
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-500/20 border border-amber-500/30">
                        <Icon d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" size={16} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-white">
                            {row.student.firstName} {row.student.lastName}
                          </span>
                          {row.student.studentId && (
                            <span className="font-mono text-xs text-white/40">({row.student.studentId})</span>
                          )}
                          <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[11px] font-semibold text-amber-300">
                            {row.refreshCount} refresh{row.refreshCount !== 1 ? "es" : ""}
                          </span>
                          <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${statusBadge(row.sessionStatus)}`}>
                            {row.sessionStatus}
                          </span>
                        </div>
                        <p className="mt-0.5 text-xs text-white/40">
                          {row.examCourseCode} — {row.examTitle}
                        </p>
                      </div>
                      <Icon d={expanded ? "M18 15l-6-6-6 6" : "M6 9l6 6 6-6"} size={16} />
                    </button>

                    {expanded && (
                      <div className="border-t border-amber-500/10 px-4 pb-4">
                        <table className="mt-3 w-full text-sm">
                          <thead>
                            <tr className="border-b border-white/5 text-[10px] font-semibold uppercase tracking-wider text-white/30">
                              <th className="py-2 text-left">#</th>
                              <th className="py-2 text-left">Refreshed At</th>
                              <th className="py-2 text-left">IP Address</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-white/5">
                            {row.refreshEvents.map((ev, i) => (
                              <tr key={ev.flagId} className="text-white/70">
                                <td className="py-2 pr-4 text-white/30">{i + 1}</td>
                                <td className="py-2 pr-4 text-xs">{fmt(ev.refreshedAt)}</td>
                                <td className="py-2 font-mono text-xs text-white/50">{ev.ip || "—"}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
