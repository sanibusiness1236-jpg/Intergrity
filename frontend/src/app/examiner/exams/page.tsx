"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useExamStore } from "@/store/examStore";
import { DashboardShell, GlowButton, GlowCard } from "@/components/dashboard/DashboardShell";
import { AnnouncementBadge } from "@/components/dashboard/AnnouncementBadge";
import { GradientHeading } from "@/components/dashboard/GradientHeading";
import { StatCard } from "@/components/dashboard/StatCard";
import type { Exam, ExamStatus, ExamType } from "@/types";

const STATUS_TONE: Record<string, string> = {
  DRAFT: "bg-white/10 text-white/70 border-white/15",
  PUBLISHED: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  ACTIVE: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  COMPLETED: "bg-slate-500/15 text-slate-300 border-slate-500/30",
  CANCELLED: "bg-rose-500/15 text-rose-300 border-rose-500/30",
};

const STATUS_DOT: Record<string, string> = {
  DRAFT: "bg-white/40",
  PUBLISHED: "bg-emerald-400",
  ACTIVE: "bg-amber-400 animate-pulse",
  COMPLETED: "bg-slate-400",
  CANCELLED: "bg-rose-400",
};

const SECTION_ORDER: ExamStatus[] = ["ACTIVE", "PUBLISHED", "DRAFT", "COMPLETED", "CANCELLED"];
const SECTION_LABEL: Record<ExamStatus, string> = {
  ACTIVE: "Active now",
  PUBLISHED: "Uploaded Exams",
  DRAFT: "Drafts",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};

const EXAM_TYPE_LABELS: Record<ExamType, string> = {
  QUIZ: "Quiz",
  MIDSEMESTER: "Midsemester",
  ASSIGNMENT: "Assignment",
  END_OF_SEMESTER: "End of Semester",
  OTHER: "Other",
};

const Icon = ({ d, size = 16 }: { d: string; size?: number }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
);

interface FormState {
  title: string;
  courseCode: string;
  courseName: string;
  description: string;
  durationMinutes: number;
  examType: ExamType;
  examTypeOther: string;
  shuffleQuestions: boolean;
  allowBacktrack: boolean;
}

const EMPTY_FORM: FormState = {
  title: "",
  courseCode: "",
  courseName: "",
  description: "",
  durationMinutes: 60,
  examType: "QUIZ",
  examTypeOther: "",
  shuffleQuestions: false,
  allowBacktrack: true,
};

interface Toast {
  id: string;
  type: "success" | "error";
  message: string;
}

export default function ExamsListPage() {
  const router = useRouter();
  const { exams, fetchExams, createExam, isLoading } = useExamStore();

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"ALL" | ExamStatus>("ALL");
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  function pushToast(type: Toast["type"], message: string) {
    const id = Math.random().toString(36).slice(2);
    setToasts((t) => [...t, { id, type, message }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3500);
  }

  useEffect(() => {
    fetchExams();
  }, [fetchExams]);

  const stats = useMemo(() => ({
    total: exams.length,
    draft: exams.filter((e) => e.status === "DRAFT").length,
    uploaded: exams.filter((e) => e.status === "PUBLISHED").length,
    active: exams.filter((e) => e.status === "ACTIVE").length,
  }), [exams]);

  const ongoingExams = useMemo(
    () => exams.filter((e) => e.status === "ACTIVE"),
    [exams]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return exams.filter((e) => {
      if (statusFilter !== "ALL" && e.status !== statusFilter) return false;
      if (!q) return true;
      return (
        e.title.toLowerCase().includes(q) ||
        e.courseCode.toLowerCase().includes(q) ||
        (e.courseName || "").toLowerCase().includes(q)
      );
    });
  }, [exams, search, statusFilter]);

  const grouped = useMemo(() => {
    const map = new Map<ExamStatus, Exam[]>();
    for (const e of filtered) {
      const list = map.get(e.status) || [];
      list.push(e);
      map.set(e.status, list);
    }
    for (const [, list] of map) {
      list.sort((a, b) => {
        const da = new Date(a.startTime || (a as any).createdAt || 0).getTime();
        const db = new Date(b.startTime || (b as any).createdAt || 0).getTime();
        return db - da;
      });
    }
    return map;
  }, [filtered]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreateError("");
    setCreating(true);
    try {
      const created = await createExam({
        ...form,
        examTypeOther: form.examType === "OTHER" ? form.examTypeOther : undefined,
        totalMarks: 0,
        startTime: new Date(Date.now() + 60_000).toISOString(),
        endTime: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      });
      pushToast("success", "Exam created");
      setShowCreate(false);
      setForm(EMPTY_FORM);
      router.push(`/examiner/exams/${created.id}?tab=questions`);
    } catch (e: any) {
      setCreateError(e.response?.data?.error?.message || "Could not create exam");
    } finally {
      setCreating(false);
    }
  }

  return (
    <DashboardShell>
      <div className="space-y-8">
        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-3">
            <AnnouncementBadge tag="Builder" message="Canvas-inspired exam builder" />
            <GradientHeading
              title="Exam Builder"
              highlight="Create &"
              subtitle="Author your exams — add typed questions, fine-tune behavior, and preview before uploading."
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link href="/examiner/analytics">
              <GlowButton variant="ghost" size="sm">View analytics</GlowButton>
            </Link>
            <button
              onClick={() => { setShowCreate(true); setForm(EMPTY_FORM); setCreateError(""); }}
              className="inline-flex h-10 items-center gap-2 rounded-md bg-gradient-to-r from-indigo-500 to-purple-500 px-4 text-sm font-semibold text-white transition hover:shadow-lg hover:shadow-purple-500/30"
            >
              <Icon d="M12 4v16m8-8H4" />
              New Exam
            </button>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <StatCard label="Total exams" value={stats.total} accent="indigo" icon={<Icon d="M9 11l3 3L22 4M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" />} />
          <StatCard label="Draft" value={stats.draft} accent="amber" icon={<Icon d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />} />
          <StatCard label="Uploaded" value={stats.uploaded} accent="emerald" icon={<Icon d="M9 12l2 2 4-4M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />} />
          <StatCard label="Live now" value={stats.active} accent="rose" icon={<Icon d="M12 8v4l3 3M12 2a10 10 0 100 20 10 10 0 000-20z" />} />
        </div>

        {/* Ongoing exams panel */}
        {ongoingExams.length > 0 && (
          <GlowCard title="Ongoing Exams" description="Exams currently active and accepting submissions.">
            <div className="space-y-2">
              {ongoingExams.map((exam) => {
                const submitted = exam._count?.submittedSessions ?? 0;
                const total = exam._count?.examSessions ?? 0;
                return (
                  <button
                    key={exam.id}
                    onClick={() => router.push(`/examiner/exams/${exam.id}`)}
                    className="group flex w-full items-center gap-4 rounded-lg border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-left transition hover:border-amber-500/40 hover:bg-amber-500/10"
                  >
                    <span className="flex h-2.5 w-2.5 shrink-0 rounded-full bg-amber-400 ring-4 ring-amber-400/20 animate-pulse" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-white">{exam.title}</p>
                      <p className="text-xs text-white/40">{exam.courseCode} · {exam.durationMinutes} min</p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-sm font-bold text-emerald-300">{submitted}</p>
                      <p className="text-[11px] text-white/40">submitted / {total} enrolled</p>
                    </div>
                    <Icon d="M9 5l7 7-7 7" />
                  </button>
                );
              })}
            </div>
          </GlowCard>
        )}

        {/* Toolbar */}
        <GlowCard className="!p-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative min-w-[240px] flex-1">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-white/40">
                <Icon d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </span>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search exams by title or course code..."
                className="auth-input h-10 w-full rounded-lg pl-9 pr-3 text-sm"
              />
            </div>
            <div className="flex items-center gap-1 rounded-lg border border-white/10 bg-white/[0.02] p-1">
              {(["ALL", ...SECTION_ORDER] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => setStatusFilter(s)}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
                    statusFilter === s
                      ? "bg-white/10 text-white"
                      : "text-white/50 hover:bg-white/5 hover:text-white"
                  }`}
                >
                  {s === "ALL" ? "All" : SECTION_LABEL[s]}
                </button>
              ))}
            </div>
            <span className="text-xs text-white/40">
              {filtered.length} of {exams.length}
            </span>
          </div>
        </GlowCard>

        {isLoading && exams.length === 0 && (
          <GlowCard className="text-center text-sm text-white/40">Loading exams…</GlowCard>
        )}

        {!isLoading && exams.length === 0 && (
          <GlowCard className="text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full border border-white/10 bg-white/5">
              <Icon d="M12 4v16m8-8H4" size={24} />
            </div>
            <h3 className="mt-4 text-base font-semibold text-white">No exams yet</h3>
            <p className="mt-1 text-sm text-white/50">Create your first exam to start building questions and scheduling sessions.</p>
            <div className="mt-4">
              <button
                onClick={() => setShowCreate(true)}
                className="inline-flex h-10 items-center gap-2 rounded-md bg-gradient-to-r from-indigo-500 to-purple-500 px-4 text-sm font-semibold text-white transition hover:shadow-lg hover:shadow-purple-500/30"
              >
                <Icon d="M12 4v16m8-8H4" />
                Create your first exam
              </button>
            </div>
          </GlowCard>
        )}

        {!isLoading && filtered.length === 0 && exams.length > 0 && (
          <GlowCard className="text-center text-sm text-white/50">
            No exams match the current filters.
          </GlowCard>
        )}

        <div className="space-y-6">
          {SECTION_ORDER.map((status) => {
            const list = grouped.get(status) || [];
            if (list.length === 0) return null;
            const isCollapsed = collapsed[status];
            return (
              <section key={status}>
                <button
                  onClick={() => setCollapsed({ ...collapsed, [status]: !isCollapsed })}
                  className="group mb-3 flex w-full items-center gap-2 text-left"
                >
                  <span className={`inline-flex h-5 w-5 items-center justify-center rounded text-white/40 transition group-hover:bg-white/5 group-hover:text-white ${isCollapsed ? "" : "rotate-90"}`}>
                    <Icon d="M9 5l7 7-7 7" size={12} />
                  </span>
                  <span className={`inline-flex h-2 w-2 rounded-full ${STATUS_DOT[status]}`} />
                  <h3 className="text-sm font-semibold uppercase tracking-wider text-white/60">{SECTION_LABEL[status]}</h3>
                  <span className="text-xs text-white/30">({list.length})</span>
                </button>

                {!isCollapsed && (
                  <div className="overflow-hidden rounded-xl border border-white/10 bg-white/[0.02]">
                    {list.map((exam, idx) => (
                      <ExamRow
                        key={exam.id}
                        exam={exam}
                        last={idx === list.length - 1}
                        onOpen={() => router.push(`/examiner/exams/${exam.id}`)}
                      />
                    ))}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      </div>

      {/* Create modal */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" onClick={() => !creating && setShowCreate(false)}>
          <div onClick={(e) => e.stopPropagation()} className="w-full max-w-xl">
            <GlowCard
              title="Create new exam"
              description="Quick details — you can edit everything later."
              action={
                <button onClick={() => !creating && setShowCreate(false)} className="rounded-md p-1 text-white/40 hover:bg-white/5 hover:text-white">
                  <Icon d="M18 6L6 18M6 6l12 12" />
                </button>
              }
            >
              <form onSubmit={handleCreate} className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-semibold uppercase tracking-wider text-white/50">Title</label>
                  <input
                    className="auth-input h-11 w-full rounded-lg px-3 text-sm"
                    value={form.title}
                    onChange={(e) => setForm({ ...form, title: e.target.value })}
                    placeholder="e.g. Database Midterm Exam"
                    required
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-semibold uppercase tracking-wider text-white/50">Course code</label>
                    <input
                      className="auth-input h-11 w-full rounded-lg px-3 text-sm font-mono"
                      value={form.courseCode}
                      onChange={(e) => setForm({ ...form, courseCode: e.target.value })}
                      placeholder="CS301"
                      required
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-semibold uppercase tracking-wider text-white/50">Course name</label>
                    <input
                      className="auth-input h-11 w-full rounded-lg px-3 text-sm"
                      value={form.courseName}
                      onChange={(e) => setForm({ ...form, courseName: e.target.value })}
                      placeholder="Database Systems"
                      required
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-semibold uppercase tracking-wider text-white/50">Exam type</label>
                    <select
                      className="auth-input h-11 w-full rounded-lg px-3 text-sm"
                      value={form.examType}
                      onChange={(e) => setForm({ ...form, examType: e.target.value as ExamType })}
                    >
                      {(Object.entries(EXAM_TYPE_LABELS) as [ExamType, string][]).map(([val, label]) => (
                        <option key={val} value={val} className="bg-slate-900">{label}</option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-semibold uppercase tracking-wider text-white/50">Duration (min)</label>
                    <input
                      type="number"
                      min={1}
                      className="auth-input h-11 w-full rounded-lg px-3 text-sm"
                      value={form.durationMinutes}
                      onChange={(e) => setForm({ ...form, durationMinutes: parseInt(e.target.value) || 0 })}
                      required
                    />
                  </div>
                </div>
                {form.examType === "OTHER" && (
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-semibold uppercase tracking-wider text-white/50">Specify exam type</label>
                    <input
                      className="auth-input h-11 w-full rounded-lg px-3 text-sm"
                      value={form.examTypeOther}
                      onChange={(e) => setForm({ ...form, examTypeOther: e.target.value })}
                      placeholder="e.g. Practical Assessment"
                      required
                    />
                  </div>
                )}
                {createError && (
                  <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-200">{createError}</div>
                )}
                <div className="flex items-center justify-end gap-2 border-t border-white/5 pt-3">
                  <button
                    type="button"
                    onClick={() => setShowCreate(false)}
                    disabled={creating}
                    className="rounded-md border border-white/10 bg-white/5 px-4 py-2 text-xs font-medium text-white/70 transition hover:bg-white/10"
                  >
                    Cancel
                  </button>
                  <GlowButton type="submit" size="sm" disabled={creating}>
                    {creating ? "Creating..." : "Create exam →"}
                  </GlowButton>
                </div>
              </form>
            </GlowCard>
          </div>
        </div>
      )}

      {/* Toasts */}
      <div className="pointer-events-none fixed bottom-6 right-6 z-50 flex flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto rounded-lg border px-4 py-3 text-sm shadow-2xl backdrop-blur-md ${
              t.type === "success"
                ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-200"
                : "border-rose-500/40 bg-rose-500/15 text-rose-200"
            }`}
          >
            {t.message}
          </div>
        ))}
      </div>
    </DashboardShell>
  );
}

function ExamRow({ exam, last, onOpen }: { exam: Exam; last: boolean; onOpen: () => void }) {
  const dt = exam.startTime ? new Date(exam.startTime) : null;
  const dateText = dt
    ? dt.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) +
      " · " +
      dt.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
    : "No schedule";

  const submitted = exam._count?.submittedSessions ?? 0;

  return (
    <button
      onClick={onOpen}
      className={`group flex w-full items-center gap-4 px-4 py-3.5 text-left transition hover:bg-white/[0.04] ${last ? "" : "border-b border-white/5"}`}
    >
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-indigo-300 transition group-hover:border-indigo-400/30 group-hover:bg-indigo-500/10">
        <svg viewBox="0 0 24 24" width={18} height={18} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 11l3 3L22 4M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" />
        </svg>
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[11px] text-indigo-300">{exam.courseCode}</span>
          <span className="text-white/20">·</span>
          <span className="truncate text-xs text-white/50">{exam.courseName}</span>
          {exam.examType && (
            <>
              <span className="text-white/20">·</span>
              <span className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] text-white/40">
                {exam.examType === "OTHER" && exam.examTypeOther ? exam.examTypeOther : (exam.examType === "END_OF_SEMESTER" ? "End of Sem." : exam.examType.charAt(0) + exam.examType.slice(1).toLowerCase().replace("_", " "))}
              </span>
            </>
          )}
        </div>
        <p className="mt-0.5 truncate text-sm font-semibold text-white">{exam.title}</p>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-white/40">
          <span>{dateText}</span>
          <span>·</span>
          <span>{exam.durationMinutes} min</span>
          <span>·</span>
          <span>{exam._count?.questions ?? 0} question{(exam._count?.questions ?? 0) !== 1 ? "s" : ""}</span>
          <span>·</span>
          <span>{exam.totalMarks} pts</span>
          {submitted > 0 && (
            <>
              <span>·</span>
              <span className="text-emerald-300/80">{submitted} submitted</span>
            </>
          )}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-3">
        <span className={`hidden items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider sm:inline-flex ${STATUS_TONE[exam.status]}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[exam.status]}`} />
          {exam.status === "PUBLISHED" ? "Uploaded" : exam.status}
        </span>
        <span className="text-white/30 transition group-hover:translate-x-0.5 group-hover:text-white">
          <svg viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 5l7 7-7 7" />
          </svg>
        </span>
      </div>
    </button>
  );
}
