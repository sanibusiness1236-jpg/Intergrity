"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import api from "@/lib/api";
import { useAuthStore } from "@/store/authStore";
import { DashboardShell, GlowButton, GlowCard } from "@/components/dashboard/DashboardShell";
import { AnnouncementBadge } from "@/components/dashboard/AnnouncementBadge";
import { GradientHeading } from "@/components/dashboard/GradientHeading";
import { StatCard } from "@/components/dashboard/StatCard";

interface ExamRow {
  id: string;
  title: string;
  courseCode: string;
  status: string;
  scheduledAt?: string;
  startTime?: string;
  createdAt?: string;
  _count?: { questions?: number; examSessions?: number };
}

const StatIcon = ({ d }: { d: string }) => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
);

const STATUS_TONE: Record<string, string> = {
  DRAFT: "bg-white/10 text-white/60 border-white/15",
  PUBLISHED: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  ACTIVE: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  COMPLETED: "bg-slate-500/15 text-slate-300 border-slate-500/30",
};

export default function ExaminerDashboard() {
  const { user } = useAuthStore();
  const [exams, setExams] = useState<ExamRow[]>([]);

  useEffect(() => {
    // Pre-warm the backend to avoid cold-start delays on subsequent calls
    api.get("/health").catch(() => {});
    api.get("/exams").then(({ data }) => setExams(data.data || [])).catch(() => {});
  }, []);

  const stats = {
    exams: exams.length,
    published: exams.filter((e) => e.status === "PUBLISHED").length,
    active: exams.filter((e) => e.status === "ACTIVE").length,
    completed: exams.filter((e) => e.status === "COMPLETED").length,
  };

  const recentExams = [...exams]
    .sort((a, b) => (b.createdAt || b.startTime || "").localeCompare(a.createdAt || a.startTime || ""))
    .slice(0, 5);

  return (
    <DashboardShell>
      <header className="mb-10 space-y-5">
        <AnnouncementBadge
          tag="New"
          message={stats.active > 0 ? `${stats.active} exam${stats.active > 1 ? "s" : ""} running now` : "AI Integrity benchmark available"}
          ctaLabel="Open"
          href={stats.active > 0 ? "/examiner/exams" : "/examiner/integrity"}
          tone={stats.active > 0 ? "warning" : "default"}
        />

        <GradientHeading
          highlight="Welcome,"
          title={`${user?.firstName || "Examiner"}.`}
          subtitle="Manage exams, audit AI integrity reports, and analyze student performance — all from one secure command center."
        />

        <div className="flex flex-wrap gap-3 pt-2">
          <Link href="/examiner/exams">
            <GlowButton variant="gradient" size="lg">
              Create Exam
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M5 12h14M13 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </GlowButton>
          </Link>
          <Link href="/examiner/integrity">
            <GlowButton variant="ghost" size="lg">Open AI Integrity</GlowButton>
          </Link>
        </div>
      </header>

      <section className="mb-10 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Total Exams" value={stats.exams} accent="indigo" icon={<StatIcon d="M9 12h6M9 16h6M9 8h6M5 3h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2z" />} />
        <StatCard label="Published" value={stats.published} accent="emerald" icon={<StatIcon d="M5 13l4 4L19 7" />} />
        <StatCard label="Active Now" value={stats.active} accent="amber" icon={<StatIcon d="M13 10V3L4 14h7v7l9-11h-7z" />} />
        <StatCard label="Completed" value={stats.completed} accent="purple" icon={<StatIcon d="M9 12l2 2 4-4M12 2a10 10 0 100 20 10 10 0 000-20z" />} />
      </section>

      <section className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <GlowCard
          className="lg:col-span-2"
          title="Recent Exams"
          description="Your latest exam activity"
          action={
            <Link href="/examiner/exams">
              <GlowButton variant="outline" size="sm">View all</GlowButton>
            </Link>
          }
        >
          {recentExams.length === 0 ? (
            <div className="rounded-lg border border-dashed border-white/10 py-12 text-center text-sm text-white/40">
              No exams created yet. Click <span className="text-white/70">Create Exam</span> to get started.
            </div>
          ) : (
            <ul className="space-y-2">
              {recentExams.map((e) => (
                <li key={e.id} className="group flex items-center justify-between gap-3 rounded-lg border border-white/5 bg-white/[0.02] p-3 transition hover:border-white/10 hover:bg-white/5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-white">{e.title}</p>
                    <p className="text-xs text-white/40">
                      {e.courseCode} · {e._count?.questions ?? 0} question{(e._count?.questions ?? 0) !== 1 ? "s" : ""} · {e._count?.examSessions ?? 0} session{(e._count?.examSessions ?? 0) !== 1 ? "s" : ""}
                    </p>
                  </div>
                  <span className={`inline-flex items-center rounded-md border px-2 py-1 text-[10px] font-semibold uppercase tracking-wider ${STATUS_TONE[e.status] || STATUS_TONE.DRAFT}`}>
                    {e.status}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </GlowCard>

        <GlowCard title="Quick Actions" description="Jump straight to a tool">
          <div className="space-y-2">
            {[
              { href: "/examiner/exams", label: "Manage Exams", desc: "Create, edit, and publish exams" },
              { href: "/examiner/integrity", label: "AI Integrity", desc: "Compare GNN models & benchmarks" },
              { href: "/examiner/analytics", label: "Analytics", desc: "Score scaling & grade boundaries" },
              { href: "/examiner/branding", label: "Branding", desc: "Logo, colors, institution profile" },
            ].map((q) => (
              <Link
                key={q.href}
                href={q.href}
                className="group flex items-center justify-between gap-3 rounded-lg border border-white/5 bg-white/[0.02] p-3 transition hover:border-indigo-400/30 hover:bg-indigo-500/5"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-white">{q.label}</p>
                  <p className="truncate text-xs text-white/40">{q.desc}</p>
                </div>
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0 text-white/30 transition group-hover:translate-x-1 group-hover:text-indigo-300">
                  <path d="M9 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </Link>
            ))}
          </div>
        </GlowCard>
      </section>
    </DashboardShell>
  );
}
