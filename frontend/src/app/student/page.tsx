"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import api from "@/lib/api";
import { useAuthStore } from "@/store/authStore";
import { DashboardShell, GlowButton, GlowCard } from "@/components/dashboard/DashboardShell";
import { AnnouncementBadge } from "@/components/dashboard/AnnouncementBadge";
import { GradientHeading } from "@/components/dashboard/GradientHeading";
import { StatCard } from "@/components/dashboard/StatCard";
import type { Exam, ExamSession } from "@/types";

const Icon = ({ d, size = 18 }: { d: string; size?: number }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
);

const STATUS_TONE: Record<string, string> = {
  IN_PROGRESS: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  SUBMITTED: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  GRADED: "bg-purple-500/15 text-purple-300 border-purple-500/30",
  NOT_STARTED: "bg-white/10 text-white/60 border-white/15",
};

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

export default function StudentDashboard() {
  const { user } = useAuthStore();
  const [sessions, setSessions] = useState<(ExamSession & { exam: any })[]>([]);
  const [availableExams, setAvailableExams] = useState<Exam[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;

    // Pre-warm the backend so subsequent API calls don't hit a cold start
    api.get("/health").catch(() => {});

    Promise.all([
      api.get(`/students/${user.id}/exams`).then(({ data }) => {
        setSessions(data.data || []);
      }).catch(() => {}),
      api.get("/exams").then(({ data }) => {
        const all: Exam[] = data.data || [];
        setAvailableExams(all.filter(isAvailableNow));
      }).catch(() => {}),
    ]).finally(() => setLoading(false));
  }, [user]);

  const total = sessions.length;
  const submitted = sessions.filter((s) => s.status === "SUBMITTED").length;
  const inProgress = sessions.filter((s) => s.status === "IN_PROGRESS").length;
  const averageScore = (() => {
    const graded = sessions.filter((s) => s.score !== null && s.score !== undefined && s.maxScore);
    if (graded.length === 0) return null;
    const avg = graded.reduce((sum, s) => sum + (s.score! / s.maxScore!) * 100, 0) / graded.length;
    return Math.round(avg);
  })();

  const startedExamIds = useMemo(() => new Set(sessions.map((s) => s.examId)), [sessions]);

  const newlyAvailable = useMemo(
    () => availableExams.filter((e) => !startedExamIds.has(e.id)),
    [availableExams, startedExamIds]
  );

  if (loading) {
    return (
      <DashboardShell>
        <div className="flex flex-col gap-4 animate-pulse">
          {/* hero skeleton */}
          <div className="min-h-[280px] rounded-3xl bg-white/5" />
          {/* stat cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-24 rounded-2xl bg-white/5" />
            ))}
          </div>
          {/* table rows */}
          <div className="rounded-2xl bg-white/5 h-64" />
        </div>
      </DashboardShell>
    );
  }

  return (
    <DashboardShell>
      {/* ── Cinematic hero with student/AI background image ───────── */}
      <section className="relative mb-10 min-h-[280px] overflow-hidden rounded-3xl border border-white/10 bg-slate-950/40">
        {/* Background image — Next.js <Image fill> is resolved by Vercel
            regardless of repo root-directory setting, unlike raw CSS url() */}
        <Image
          src="/student-hero.png"
          alt=""
          fill
          priority
          sizes="100vw"
          className="pointer-events-none object-cover object-center"
          style={{ opacity: 0.22 }}
          aria-hidden
        />
        {/* Dark gradient wash so foreground text/buttons keep enough contrast */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-gradient-to-r from-slate-950 via-slate-950/85 to-slate-950/40"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-slate-950/85"
        />
        {/* Purple/indigo glow accents */}
        <div
          aria-hidden
          className="pointer-events-none absolute -top-24 -left-20 h-72 w-72 rounded-full bg-indigo-500/25 blur-3xl"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-24 -right-20 h-72 w-72 rounded-full bg-purple-500/20 blur-3xl"
        />

        <div className="relative z-10 px-6 py-10 md:px-12 md:py-14 space-y-5">
          <AnnouncementBadge
            tag={inProgress > 0 ? "Live" : newlyAvailable.length > 0 ? "New" : "Tip"}
            message={
              inProgress > 0
                ? `You have ${inProgress} exam${inProgress > 1 ? "s" : ""} in progress`
                : newlyAvailable.length > 0
                ? `${newlyAvailable.length} exam${newlyAvailable.length > 1 ? "s are" : " is"} available for you to start`
                : "Pro tip: Don't switch tabs during exams"
            }
            tone={inProgress > 0 || newlyAvailable.length > 0 ? "warning" : "default"}
          />

          <GradientHeading
            highlight="Welcome,"
            title={`${user?.firstName || "Student"}.`}
            subtitle="Stay focused, stay honest. Your exams, schedules, and scores — protected by real-time AI integrity monitoring."
          />

          <div className="flex flex-wrap gap-3 pt-2">
            {inProgress > 0 ? (
              <Link href={`/student/exam/${sessions.find((s) => s.status === "IN_PROGRESS")?.examId}`}>
                <GlowButton variant="gradient" size="lg">
                  Resume Exam
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M5 3l14 9-14 9V3z" strokeLinejoin="round" />
                  </svg>
                </GlowButton>
              </Link>
            ) : newlyAvailable.length > 0 ? (
              <Link href="/student/exam">
                <GlowButton variant="gradient" size="lg">
                  View Available Exams →
                </GlowButton>
              </Link>
            ) : (
              <GlowButton variant="gradient" size="lg" disabled>
                No active exam
              </GlowButton>
            )}
            <Link href="/student/exam">
              <GlowButton variant="ghost" size="lg">My Exams</GlowButton>
            </Link>
          </div>
        </div>
      </section>

      <section className="mb-10 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Total Exams" value={total} accent="indigo" icon={<Icon d="M9 12h6M9 16h6M9 8h6M5 3h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2z" />} />
        <StatCard label="Submitted" value={submitted} accent="emerald" icon={<Icon d="M5 13l4 4L19 7" />} />
        <StatCard label="In Progress" value={inProgress} accent="amber" icon={<Icon d="M12 6v6l4 2" />} />
        <StatCard
          label="Average"
          value={averageScore !== null ? `${averageScore}%` : "—"}
          accent="purple"
          icon={<Icon d="M3 3v18h18M7 14l4-4 4 4 5-5" />}
        />
      </section>

      <section className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {/* Available exams to start */}
          {newlyAvailable.length > 0 && (
            <GlowCard title="Available Now" description="These exams are open — click Start to begin.">
              <ul className="space-y-2">
                {newlyAvailable.map((exam) => (
                  <li key={exam.id} className="flex items-center gap-4 rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-4 transition hover:border-emerald-500/30 hover:bg-emerald-500/10">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-emerald-500/20 bg-emerald-500/10">
                      <Icon d="M9 12l2 2 4-4M12 2a10 10 0 100 20 10 10 0 000-20z" size={16} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-white">{exam.title}</p>
                      <p className="text-xs text-white/40">{exam.courseCode} · {exam.durationMinutes} min · {exam.totalMarks} pts</p>
                    </div>
                    <Link href={`/student/exam/${exam.id}`} className="shrink-0">
                      <GlowButton variant="gradient" size="sm">Start →</GlowButton>
                    </Link>
                  </li>
                ))}
              </ul>
            </GlowCard>
          )}

          {/* Past sessions */}
          <GlowCard
            title="Your Exams"
            description="Recent attempts and in-progress sessions"
          >
            {sessions.length === 0 ? (
              <div className="rounded-lg border border-dashed border-white/10 py-12 text-center text-sm text-white/40">
                <p className="mb-2 text-base text-white/60">No started exams yet</p>
                <p className="mb-4">Available exams will appear above once your examiner publishes them.</p>
                <Link href="/student/exam" className="text-xs text-indigo-300 hover:text-indigo-200 underline">
                  Browse all exams →
                </Link>
              </div>
            ) : (
              <ul className="space-y-2">
                {sessions.map((s) => (
                  <li key={s.id} className="group rounded-lg border border-white/5 bg-white/[0.02] p-4 transition hover:border-white/10 hover:bg-white/5">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-white">{s.exam?.title || "Exam"}</p>
                        <p className="text-xs text-white/40">{s.exam?.courseCode}</p>
                      </div>
                      <div className="flex shrink-0 items-center gap-3">
                        {s.score !== null && s.score !== undefined && s.maxScore && (
                          <div className="text-right">
                            <p className="text-xs text-white/40">Score</p>
                            <p className="text-sm font-semibold text-white">
                              {s.score}<span className="text-white/40">/{s.maxScore}</span>
                            </p>
                          </div>
                        )}
                        <span className={`inline-flex items-center rounded-md border px-2 py-1 text-[10px] font-semibold uppercase tracking-wider ${STATUS_TONE[s.status] || STATUS_TONE.NOT_STARTED}`}>
                          {s.status.replace(/_/g, " ")}
                        </span>
                        {s.status === "IN_PROGRESS" && (
                          <Link href={`/student/exam/${s.examId}`}>
                            <GlowButton variant="gradient" size="sm">Continue</GlowButton>
                          </Link>
                        )}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </GlowCard>
        </div>

        <GlowCard title="Exam Integrity" description="What we monitor for you">
          <ul className="space-y-3 text-sm">
            {[
              { label: "Tab switching", desc: "Detected if you leave the page" },
              { label: "Copy/paste", desc: "Pasting external text is flagged" },
              { label: "USB devices", desc: "Live USB scan during exams" },
              { label: "Multi-device", desc: "Same account on two devices" },
              { label: "Auto-save", desc: "Every keystroke is preserved" },
            ].map((f) => (
              <li key={f.label} className="flex items-start gap-3">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-300">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                    <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
                <div>
                  <p className="font-medium text-white">{f.label}</p>
                  <p className="text-xs text-white/40">{f.desc}</p>
                </div>
              </li>
            ))}
          </ul>
        </GlowCard>
      </section>
    </DashboardShell>
  );
}
