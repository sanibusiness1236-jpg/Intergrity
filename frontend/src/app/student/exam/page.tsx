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
  IN_PROGRESS: "border-amber-500/40 bg-amber-500/15 text-amber-200",
  WAITING: "border-white/15 bg-white/5 text-white/70",
  SUBMITTED: "border-emerald-500/40 bg-emerald-500/15 text-emerald-200",
  TIMED_OUT: "border-rose-500/40 bg-rose-500/15 text-rose-200",
  DISCONNECTED: "border-rose-500/40 bg-rose-500/15 text-rose-200",
};

type SessionWithExam = ExamSession & {
  exam: { id: string; title: string; courseCode: string; courseName: string };
};

type RowKind = "in_progress" | "available" | "upcoming" | "completed";

interface ExamRow {
  exam: Exam | SessionWithExam["exam"];
  session?: SessionWithExam;
  kind: RowKind;
  startTime?: string;
  endTime?: string;
  durationMinutes?: number;
}

function fmtDate(iso?: string) {
  if (!iso) return null;
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function isAvailableNow(exam: Pick<Exam, "status" | "startTime" | "endTime">) {
  const now = Date.now();
  const start = exam.startTime ? new Date(exam.startTime).getTime() : null;
  const end = exam.endTime ? new Date(exam.endTime).getTime() : null;
  if (exam.status === "ACTIVE") return true;
  if (exam.status === "PUBLISHED") {
    if (start && start > now) return false;
    if (end && end < now) return false;
    return true;
  }
  return false;
}

export default function StudentExamsListPage() {
  const { user } = useAuthStore();
  const [exams, setExams] = useState<Exam[]>([]);
  const [sessions, setSessions] = useState<SessionWithExam[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"all" | RowKind>("all");

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
      setSessions(sessList);
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [user]);

  const rows = useMemo<ExamRow[]>(() => {
    const byExamId = new Map<string, SessionWithExam>();
    for (const s of sessions) byExamId.set(s.examId, s);

    const out: ExamRow[] = [];
    const seen = new Set<string>();

    for (const s of sessions) {
      if (s.status === "IN_PROGRESS" || s.status === "WAITING") {
        out.push({ exam: s.exam, session: s, kind: "in_progress" });
        seen.add(s.examId);
      }
    }

    for (const e of exams) {
      if (seen.has(e.id)) continue;
      const existing = byExamId.get(e.id);
      if (existing && (existing.status === "SUBMITTED" || existing.status === "TIMED_OUT")) {
        out.push({
          exam: e, session: existing, kind: "completed",
          startTime: e.startTime, endTime: e.endTime, durationMinutes: e.durationMinutes,
        });
        seen.add(e.id);
        continue;
      }
      if (isAvailableNow(e)) {
        out.push({
          exam: e, kind: "available",
          startTime: e.startTime, endTime: e.endTime, durationMinutes: e.durationMinutes,
        });
        seen.add(e.id);
      } else if (e.status === "PUBLISHED" && e.startTime && new Date(e.startTime).getTime() > Date.now()) {
        out.push({
          exam: e, kind: "upcoming",
          startTime: e.startTime, endTime: e.endTime, durationMinutes: e.durationMinutes,
        });
        seen.add(e.id);
      }
    }

    for (const s of sessions) {
      if (seen.has(s.examId)) continue;
      if (s.status === "SUBMITTED" || s.status === "TIMED_OUT") {
        out.push({ exam: s.exam, session: s, kind: "completed" });
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
    return c;
  }, [rows]);

  const visible = tab === "all" ? rows : rows.filter((r) => r.kind === tab);

  return (
    <DashboardShell>
      <div className="space-y-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-3">
            <AnnouncementBadge
              tag={counts.in_progress > 0 ? "Live" : "Hub"}
              message={
                counts.in_progress > 0
                  ? `You have ${counts.in_progress} exam${counts.in_progress > 1 ? "s" : ""} in progress`
                  : "All your exam attempts in one place"
              }
              tone={counts.in_progress > 0 ? "warning" : "default"}
            />
            <GradientHeading
              title="Exams"
              highlight="My"
              subtitle="Continue an in-progress attempt, start an available exam, or review past attempts."
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <StatCard label="In progress" value={counts.in_progress} accent="amber" icon={<Icon d="M12 6v6l4 2" />} />
          <StatCard label="Available now" value={counts.available} accent="emerald" icon={<Icon d="M5 13l4 4L19 7" />} />
          <StatCard label="Upcoming" value={counts.upcoming} accent="indigo" icon={<Icon d="M8 7V3m8 4V3M3 11h18M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />} />
          <StatCard label="Completed" value={counts.completed} accent="purple" icon={<Icon d="M9 12l2 2 4-4M12 2a10 10 0 100 20 10 10 0 000-20z" />} />
        </div>

        <div className="flex items-center gap-1 rounded-lg border border-white/10 bg-white/[0.02] p-1">
          {(["all", "in_progress", "available", "upcoming", "completed"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition ${
                tab === t ? "bg-white/10 text-white" : "text-white/50 hover:bg-white/5 hover:text-white"
              }`}
            >
              {t === "all" ? "All" :
                t === "in_progress" ? `In Progress (${counts.in_progress})` :
                t === "available" ? `Available (${counts.available})` :
                t === "upcoming" ? `Upcoming (${counts.upcoming})` :
                `Completed (${counts.completed})`}
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
                ? "No exams are assigned to you. Your examiner will publish them here when ready."
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

function ExamCard({ row }: { row: ExamRow }) {
  const { exam, session, kind, startTime, endTime, durationMinutes } = row;

  const startStr = fmtDate(startTime);
  const endStr = fmtDate(endTime);

  const pill = (() => {
    if (kind === "in_progress") {
      return { label: session?.status === "WAITING" ? "WAITING" : "IN PROGRESS", tone: SESSION_TONE.IN_PROGRESS, dot: "bg-amber-400 animate-pulse" };
    }
    if (kind === "available") {
      return { label: "AVAILABLE NOW", tone: "border-emerald-500/40 bg-emerald-500/15 text-emerald-200", dot: "bg-emerald-400" };
    }
    if (kind === "upcoming") {
      return { label: "UPCOMING", tone: "border-indigo-500/40 bg-indigo-500/15 text-indigo-200", dot: "bg-indigo-400" };
    }
    return { label: session?.status?.replace(/_/g, " ") || "COMPLETED", tone: SESSION_TONE[session?.status || "SUBMITTED"], dot: "bg-purple-400" };
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
        <Link href={`/student/exam/${exam.id}`}>
          <GlowButton variant="gradient" size="sm">Start →</GlowButton>
        </Link>
      );
    }
    if (kind === "upcoming") {
      return (
        <span className="rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-white/50">
          Opens {startStr}
        </span>
      );
    }
    // Check if retake is allowed (exam must be available and attempts remain)
    const maxAttempts = (exam as any).maxAttempts ?? 1;
    const attemptNumber = (session as any)?.attemptNumber ?? 1;
    const canRetake = isAvailableNow(exam as any) && attemptNumber < maxAttempts;

    return (
      <div className="flex items-center gap-3">
        {session?.score !== null && session?.score !== undefined && session?.maxScore ? (
          <div className="text-right">
            <p className="text-[10px] uppercase tracking-wider text-white/40">Result</p>
            <p className={`text-sm font-bold ${Math.round((session.score / session.maxScore) * 100) >= 50 ? "text-emerald-300" : "text-amber-300"}`}>
              {session.score}/{session.maxScore}
              <span className="ml-1 text-xs text-white/50">({Math.round((session.score / session.maxScore) * 100)}%)</span>
            </p>
          </div>
        ) : (
          <span className="text-xs text-white/40">Awaiting result</span>
        )}
        {canRetake && (
          <Link href={`/student/exam/${exam.id}`}>
            <GlowButton variant="gradient" size="sm">Retake →</GlowButton>
          </Link>
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
