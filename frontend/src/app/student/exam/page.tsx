"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import api from "@/lib/api";
import { useAuthStore } from "@/store/authStore";
import { DashboardShell, GlowButton, GlowCard } from "@/components/dashboard/DashboardShell";
import { AnnouncementBadge } from "@/components/dashboard/AnnouncementBadge";
import { GradientHeading } from "@/components/dashboard/GradientHeading";
import { StatCard } from "@/components/dashboard/StatCard";
import type { Exam, ExamSession, ExamStatus } from "@/types";

const Icon = ({ d, size = 16 }: { d: string; size?: number }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
);

const SESSION_TONE: Record<string, string> = {
  IN_PROGRESS:  "border-amber-500/40 bg-amber-500/15 text-amber-200",
  WAITING:      "border-white/15 bg-white/5 text-white/70",
  SUBMITTED:    "border-emerald-500/40 bg-emerald-500/15 text-emerald-200",
  TIMED_OUT:    "border-rose-500/40 bg-rose-500/15 text-rose-200",
  DISCONNECTED: "border-rose-500/40 bg-rose-500/15 text-rose-200",
};

type SessionWithExam = ExamSession & {
  exam: {
    id: string; title: string; courseCode: string; courseName: string;
    status: string; isActive: boolean; startTime?: string; endTime?: string;
    maxAttempts: number; durationMinutes: number;
  };
  attemptNumber?: number;
};

type RowKind = "in_progress" | "available" | "upcoming" | "completed";
type TabKind = "opened" | "all" | RowKind;

interface ExamRow {
  exam: Exam | SessionWithExam["exam"];
  /** Most recent session for this exam (may be null for pure upcoming rows). */
  session?: SessionWithExam;
  kind: RowKind;
  startTime?: string;
  endTime?: string;
  durationMinutes?: number;
  /** How many attempts the student has already submitted. */
  completedCount: number;
  /** Examiner-configured limit. */
  maxAttempts: number;
}

function fmtDate(iso?: string) {
  if (!iso) return null;
  return new Date(iso).toLocaleString(undefined, {
    weekday: "short", month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function isAvailableNow(exam: Pick<Exam, "status" | "startTime" | "endTime">) {
  const now = Date.now();
  const start = exam.startTime ? new Date(exam.startTime).getTime() : null;
  const end   = exam.endTime   ? new Date(exam.endTime  ).getTime() : null;
  if (exam.status === "ACTIVE") return true;
  if (exam.status === "PUBLISHED") {
    if (start && start > now) return false;
    if (end   && end   < now) return false;
    return true;
  }
  return false;
}

export default function StudentExamsListPage() {
  const { user } = useAuthStore();
  const [exams,    setExams]    = useState<Exam[]>([]);
  const [sessions, setSessions] = useState<SessionWithExam[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [tab, setTab] = useState<TabKind>("opened");

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    setLoading(true);
    Promise.all([
      api.get("/exams").then((r) => r.data.data as Exam[]).catch(() => []),
      api.get(`/students/${user.id}/exams`).then((r) => r.data.data as SessionWithExam[]).catch(() => []),
    ]).then(([examList, sessList]) => {
      if (cancelled) return;
      setExams(examList);
      setSessions(sessList);  // already sorted desc by createdAt
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [user]);

  const rows = useMemo<ExamRow[]>(() => {
    // Group sessions by examId (array already desc by createdAt, so [0] = latest)
    const sessionsByExam = new Map<string, SessionWithExam[]>();
    for (const s of sessions) {
      if (!sessionsByExam.has(s.examId)) sessionsByExam.set(s.examId, []);
      sessionsByExam.get(s.examId)!.push(s);
    }

    const out: ExamRow[] = [];
    const seen = new Set<string>();

    // Pass 1 — active / resumable sessions
    for (const s of sessions) {
      if (seen.has(s.examId)) continue;
      if (s.status === "IN_PROGRESS" || s.status === "WAITING" || s.status === "DISCONNECTED") {
        const examSessions = sessionsByExam.get(s.examId) ?? [];
        const completedCount = examSessions.filter(
          (x) => x.status === "SUBMITTED" || x.status === "TIMED_OUT"
        ).length;
        const maxAttempts = (s.exam as any).maxAttempts ?? 1;
        out.push({ exam: s.exam, session: s, kind: "in_progress", completedCount, maxAttempts,
          startTime: (s.exam as any).startTime, endTime: (s.exam as any).endTime,
          durationMinutes: (s.exam as any).durationMinutes });
        seen.add(s.examId);
      }
    }

    // Pass 2 — exams from the master list
    for (const e of exams) {
      if (seen.has(e.id)) continue;
      const examSessions  = sessionsByExam.get(e.id) ?? [];
      const completedCount = examSessions.filter(
        (s) => s.status === "SUBMITTED" || s.status === "TIMED_OUT"
      ).length;
      const maxAttempts = (e as any).maxAttempts ?? 1;
      const latestSession = examSessions[0]; // most recent (sessions sorted desc)

      if (isAvailableNow(e)) {
        if (completedCount < maxAttempts) {
          // Still has attempts left → available (first attempt OR retake)
          out.push({ exam: e, session: latestSession, kind: "available", completedCount,
            maxAttempts, startTime: e.startTime, endTime: e.endTime,
            durationMinutes: e.durationMinutes });
        } else {
          // All attempts exhausted but exam is still open
          out.push({ exam: e, session: latestSession, kind: "completed", completedCount,
            maxAttempts, startTime: e.startTime, endTime: e.endTime,
            durationMinutes: e.durationMinutes });
        }
        seen.add(e.id);
        continue;
      }

      // Exam not open right now
      if (completedCount > 0) {
        out.push({ exam: e, session: latestSession, kind: "completed", completedCount,
          maxAttempts, startTime: e.startTime, endTime: e.endTime,
          durationMinutes: e.durationMinutes });
        seen.add(e.id);
      } else if (
        e.status === "PUBLISHED" && e.startTime &&
        new Date(e.startTime).getTime() > Date.now()
      ) {
        out.push({ exam: e, kind: "upcoming", completedCount: 0, maxAttempts,
          startTime: e.startTime, endTime: e.endTime, durationMinutes: e.durationMinutes });
        seen.add(e.id);
      }
    }

    // Pass 3 — sessions whose exam isn't in the public list anymore (edge case)
    for (const s of sessions) {
      if (seen.has(s.examId)) continue;
      if (s.status === "SUBMITTED" || s.status === "TIMED_OUT") {
        out.push({ exam: s.exam, session: s, kind: "completed", completedCount: 1,
          maxAttempts: (s.exam as any).maxAttempts ?? 1 });
        seen.add(s.examId);
      }
    }

    const order: Record<RowKind, number> = { in_progress: 0, available: 1, upcoming: 2, completed: 3 };
    out.sort((a, b) => {
      const k = order[a.kind] - order[b.kind];
      if (k !== 0) return k;
      const ta = a.startTime ? new Date(a.startTime).getTime() : 0;
      const tb = b.startTime ? new Date(b.startTime).getTime() : 0;
      return tb - ta;
    });
    return out;
  }, [exams, sessions]);

  const counts = useMemo(() => {
    const c = { in_progress: 0, available: 0, upcoming: 0, completed: 0 };
    for (const r of rows) c[r.kind]++;
    return { ...c, opened: c.in_progress + c.available };
  }, [rows]);

  const visible = useMemo(() => {
    if (tab === "all")    return rows;
    if (tab === "opened") return rows.filter((r) => r.kind === "in_progress" || r.kind === "available");
    return rows.filter((r) => r.kind === tab);
  }, [tab, rows]);

  return (
    <DashboardShell>
      <div className="space-y-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-3">
            <AnnouncementBadge
              tag={counts.in_progress > 0 ? "Live" : counts.opened > 0 ? "Open" : "Hub"}
              message={
                counts.in_progress > 0
                  ? `You have ${counts.in_progress} exam${counts.in_progress > 1 ? "s" : ""} in progress`
                  : counts.opened > 0
                  ? `${counts.opened} exam${counts.opened > 1 ? "s are" : " is"} open for you right now`
                  : "All your exam attempts in one place"
              }
              tone={counts.in_progress > 0 ? "warning" : counts.opened > 0 ? "success" : "default"}
            />
            <GradientHeading
              title="Exams"
              highlight="My"
              subtitle="Continue an in-progress attempt, start or retake an available exam, or review past results."
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <StatCard label="Opened Exams"  value={counts.opened}      accent="emerald" icon={<Icon d="M8 11V7a4 4 0 118 0m-4 8v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2z" />} />
          <StatCard label="In Progress"   value={counts.in_progress} accent="amber"   icon={<Icon d="M12 6v6l4 2" />} />
          <StatCard label="Upcoming"      value={counts.upcoming}    accent="indigo"  icon={<Icon d="M8 7V3m8 4V3M3 11h18M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />} />
          <StatCard label="Completed"     value={counts.completed}   accent="purple"  icon={<Icon d="M9 12l2 2 4-4M12 2a10 10 0 100 20 10 10 0 000-20z" />} />
        </div>

        {/* Tab bar */}
        <div className="flex flex-wrap items-center gap-1 rounded-lg border border-white/10 bg-white/[0.02] p-1">
          {([
            { id: "opened",      label: `Opened Exams (${counts.opened})`,        highlight: true },
            { id: "all",         label: "All" },
            { id: "in_progress", label: `In Progress (${counts.in_progress})` },
            { id: "upcoming",    label: `Upcoming (${counts.upcoming})` },
            { id: "completed",   label: `Completed (${counts.completed})` },
          ] as { id: TabKind; label: string; highlight?: boolean }[]).map(({ id, label, highlight }) => (
            <button key={id} onClick={() => setTab(id)}
              className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition
                ${tab === id
                  ? highlight
                    ? "bg-emerald-500/20 text-emerald-200 ring-1 ring-emerald-500/40"
                    : "bg-white/10 text-white"
                  : "text-white/50 hover:bg-white/5 hover:text-white"}`}>
              {label}
            </button>
          ))}
        </div>

        {loading ? (
          <GlowCard className="text-center text-sm text-white/40">Loading exams…</GlowCard>
        ) : visible.length === 0 ? (
          <GlowCard className="text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white/40">
              <Icon d="M9 12h6M9 16h6M9 8h6M5 3h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2z" size={22} />
            </div>
            <h3 className="mt-4 text-base font-semibold text-white">Nothing here yet</h3>
            <p className="mt-1 text-sm text-white/50">
              {tab === "all"
                ? "No exams assigned to you. Your examiner will publish them here when ready."
                : tab === "opened"
                ? "No exams are open right now. Check back later or ask your examiner to activate an exam."
                : "No exams match this filter right now."}
            </p>
          </GlowCard>
        ) : (
          <div className="space-y-2">
            {visible.map((row) => (
              <ExamCard key={`${row.exam.id}-${row.kind}`} row={row} />
            ))}
          </div>
        )}
      </div>
    </DashboardShell>
  );
}

/* ─────────────────────────────────────────────── */
function ExamCard({ row }: { row: ExamRow }) {
  const { exam, session, kind, startTime, endTime, durationMinutes, completedCount, maxAttempts } = row;
  const startStr = fmtDate(startTime);
  const endStr   = fmtDate(endTime);
  const attemptsLeft = maxAttempts - completedCount;
  const isRetake = completedCount > 0 && kind === "available";
  const multiAttempt = maxAttempts > 1;

  const pill = (() => {
    if (kind === "in_progress") {
      return { label: session?.status === "WAITING" ? "WAITING" : "IN PROGRESS",
               tone: SESSION_TONE.IN_PROGRESS, dot: "bg-amber-400 animate-pulse" };
    }
    if (kind === "available") {
      return isRetake
        ? { label: "RETAKE OPEN", tone: "border-indigo-500/40 bg-indigo-500/15 text-indigo-200", dot: "bg-indigo-400 animate-pulse" }
        : { label: "AVAILABLE NOW", tone: "border-emerald-500/40 bg-emerald-500/15 text-emerald-200", dot: "bg-emerald-400" };
    }
    if (kind === "upcoming") {
      return { label: "UPCOMING", tone: "border-indigo-500/40 bg-indigo-500/15 text-indigo-200", dot: "bg-indigo-400" };
    }
    // completed
    return { label: completedCount >= maxAttempts ? "ALL ATTEMPTS USED" : "SUBMITTED",
             tone: SESSION_TONE.SUBMITTED, dot: "bg-purple-400" };
  })();

  const cta = (() => {
    if (kind === "in_progress") {
      return (
        <Link href={`/student/exam/${exam.id}`}>
          <GlowButton variant="gradient" size="sm">Resume →</GlowButton>
        </Link>
      );
    }

    if (kind === "available") {
      return (
        <div className="flex flex-col items-end gap-1">
          <Link href={`/student/exam/${exam.id}`}>
            <GlowButton variant="gradient" size="sm">
              {isRetake ? "Retake →" : "Start →"}
            </GlowButton>
          </Link>
          {multiAttempt && (
            <span className="text-[10px] text-white/30">
              {attemptsLeft} attempt{attemptsLeft !== 1 ? "s" : ""} left
            </span>
          )}
        </div>
      );
    }

    if (kind === "upcoming") {
      return (
        <span className="rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-white/50">
          Opens {startStr}
        </span>
      );
    }

    // completed
    return (
      <div className="flex flex-col items-end gap-1">
        {session?.score != null && session?.maxScore ? (
          <div className="text-right">
            <p className="text-[10px] uppercase tracking-wider text-white/40">Best result</p>
            <p className={`text-sm font-bold ${Math.round((session.score / session.maxScore) * 100) >= 50 ? "text-emerald-300" : "text-amber-300"}`}>
              {session.score}/{session.maxScore}
              <span className="ml-1 text-xs text-white/50">({Math.round((session.score / session.maxScore) * 100)}%)</span>
            </p>
          </div>
        ) : (
          <span className="text-xs text-white/40">Awaiting result</span>
        )}
        {multiAttempt && (
          <span className="text-[10px] text-white/25">{completedCount}/{maxAttempts} attempts used</span>
        )}
      </div>
    );
  })();

  return (
    <div className="group flex items-center gap-4 rounded-xl border border-white/10 bg-white/[0.02] p-4 transition hover:border-white/20 hover:bg-white/[0.04]">
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-indigo-300 transition group-hover:border-indigo-400/30 group-hover:bg-indigo-500/10">
        <Icon d="M9 12h6M9 16h6M9 8h6M5 3h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2z" size={20} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[11px] text-indigo-300">{exam.courseCode}</span>
          <span className="text-white/20">·</span>
          <span className="truncate text-xs text-white/50">{exam.courseName}</span>
        </div>
        <p className="mt-0.5 truncate text-sm font-semibold text-white">{exam.title}</p>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-white/40">
          {startStr && <span>📅 {startStr}</span>}
          {durationMinutes && <span>⏱ {durationMinutes} min</span>}
          {endStr && kind === "available" && <span>Closes {endStr}</span>}
          {multiAttempt && kind !== "in_progress" && (
            <span className={attemptsLeft > 0 ? "text-indigo-300/60" : "text-white/25"}>
              🔄 {completedCount}/{maxAttempts} attempts
            </span>
          )}
        </div>
      </div>
      <span className={`hidden items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider sm:inline-flex ${pill.tone}`}>
        <span className={`h-1.5 w-1.5 rounded-full ${pill.dot}`} />
        {pill.label}
      </span>
      <div className="shrink-0">{cta}</div>
    </div>
  );
}
