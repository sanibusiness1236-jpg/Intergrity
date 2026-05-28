"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import api from "@/lib/api";
import { useExamStore } from "@/store/examStore";
import { DashboardShell, GlowButton, GlowCard } from "@/components/dashboard/DashboardShell";
import {
  QuestionEditor,
  QTYPE_LABEL,
  QTYPE_TONE,
  QTYPE_ICON,
} from "@/components/exams/QuestionEditor";
import { BlockList } from "@/components/exams/blocks";
import type { Exam, ExamType, GradeRange, Question, QuestionType, ScoreRemark, Venue } from "@/types";
import type { GeofenceData, GeofenceZone } from "@/components/exams/GeofenceMap";

const GeofenceMap = dynamic(() => import("@/components/exams/GeofenceMap"), { ssr: false });

const STATUS_TONE: Record<string, string> = {
  DRAFT: "bg-white/10 text-white/70 border-white/15",
  PUBLISHED: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  ACTIVE: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  COMPLETED: "bg-slate-500/15 text-slate-300 border-slate-500/30",
  CANCELLED: "bg-rose-500/15 text-rose-300 border-rose-500/30",
};

const EXAM_TYPE_LABELS: Record<ExamType, string> = {
  QUIZ: "Quiz",
  MIDSEMESTER: "Midsemester",
  ASSIGNMENT: "Assignment",
  END_OF_SEMESTER: "End of Semester",
  OTHER: "Other",
};

const TABS = [
  { id: "details", label: "Details", icon: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" },
  { id: "questions", label: "Questions", icon: "M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" },
  { id: "settings", label: "Settings", icon: "M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065zM15 12a3 3 0 11-6 0 3 3 0 016 0z" },
  { id: "location", label: "Set Location/Venue Boundary", icon: "M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0zM15 11a3 3 0 11-6 0 3 3 0 016 0z" },
  { id: "ai-import", label: "AI Question Import", icon: "M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" },
  { id: "reports", label: "Flagged Questions", icon: "M4 21V4m0 0l8 5 8-5v12l-8 5-8-5z" },
  { id: "preview", label: "Preview", icon: "M15 12a3 3 0 11-6 0 3 3 0 016 0zM2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" },
];

const Icon = ({ d, size = 16 }: { d: string; size?: number }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
);

interface Toast { id: string; type: "success" | "error" | "info"; message: string; }

export default function ExamEditorPage() {
  const params = useParams();
  const router = useRouter();
  const examId = String(params?.examId || "");

  const { updateExam, publishExam, deleteExam, setExamActive } = useExamStore();

  const [exam, setExam] = useState<Exam | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<string>("details");
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const sp = new URLSearchParams(window.location.search);
      const t = sp.get("tab");
      if (t && TABS.some((x) => x.id === t)) setActiveTab(t);
    }
  }, []);

  function pushToast(type: Toast["type"], message: string) {
    const id = Math.random().toString(36).slice(2);
    setToasts((t) => [...t, { id, type, message }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3500);
  }

  async function loadExam() {
    setLoading(true);
    try {
      const { data } = await api.get(`/exams/${examId}`);
      setExam(data.data);
      setQuestions(Array.isArray(data.data.questions) ? data.data.questions : []);
    } catch (e: any) {
      pushToast("error", e.response?.data?.error?.message || "Failed to load exam");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { if (examId) loadExam(); }, [examId]);

  function switchTab(tab: string) {
    setActiveTab(tab);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", tab);
    window.history.replaceState({}, "", url.toString());
  }

  async function handlePublish() {
    if (!exam) return;
    if (questions.length === 0) {
      pushToast("error", "Add at least one question before uploading");
      return;
    }
    try {
      await publishExam(exam.id);
      pushToast("success", "Exam uploaded");
      await loadExam();
    } catch (e: any) {
      pushToast("error", e.response?.data?.error?.message || "Upload failed");
    }
  }

  async function handleToggleActive() {
    if (!exam) return;
    try {
      const updated = await setExamActive(exam.id, !exam.isActive);
      setExam((prev) => prev ? { ...prev, ...updated } : prev);
      pushToast("success", updated.isActive ? "Exam is now visible to students" : "Exam hidden from students");
    } catch {
      pushToast("error", "Failed to update exam visibility");
    }
  }

  async function handleDelete() {
    if (!exam) return;
    if (!confirm(`Delete exam "${exam.title}"? This cannot be undone.`)) return;
    try {
      await deleteExam(exam.id);
      router.push("/examiner/exams");
    } catch (e: any) {
      pushToast("error", e.response?.data?.error?.message || "Delete failed");
    }
  }

  if (loading && !exam) {
    return (
      <DashboardShell>
        <div className="flex h-[60vh] items-center justify-center">
          <div className="text-sm text-white/50">Loading exam…</div>
        </div>
      </DashboardShell>
    );
  }

  if (!exam) {
    return (
      <DashboardShell>
        <div className="flex h-[60vh] flex-col items-center justify-center gap-3">
          <p className="text-white/70">Exam not found.</p>
          <Link href="/examiner/exams" className="text-sm text-indigo-300 hover:text-indigo-200">
            ← Back to exams
          </Link>
        </div>
      </DashboardShell>
    );
  }

  const submitted = exam._count?.submittedSessions ?? 0;
  const examTypeLabel = exam.examType === "OTHER" && exam.examTypeOther
    ? exam.examTypeOther
    : EXAM_TYPE_LABELS[exam.examType] ?? exam.examType;

  return (
    <DashboardShell>
      <div className="space-y-6">
        {/* Breadcrumb + header */}
        <div className="space-y-4">
          <nav className="flex items-center gap-1.5 text-xs text-white/40">
            <Link href="/examiner" className="hover:text-white/70">Examiner</Link>
            <span>/</span>
            <Link href="/examiner/exams" className="hover:text-white/70">Exams</Link>
            <span>/</span>
            <span className="text-white/60">{exam.courseCode}</span>
          </nav>

          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0 flex-1 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs text-indigo-300">{exam.courseCode}</span>
                <span className="text-white/30">·</span>
                <span className="text-xs text-white/50">{exam.courseName}</span>
                <span className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] text-white/40">{examTypeLabel}</span>
                <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${STATUS_TONE[exam.status] || STATUS_TONE.DRAFT}`}>
                  <span className={`h-1.5 w-1.5 rounded-full ${
                    exam.status === "PUBLISHED" ? "bg-emerald-400" :
                    exam.status === "ACTIVE" ? "bg-amber-400 animate-pulse" :
                    exam.status === "COMPLETED" ? "bg-slate-400" :
                    exam.status === "CANCELLED" ? "bg-rose-400" : "bg-white/40"
                  }`} />
                  {exam.status === "PUBLISHED" ? "Uploaded" : exam.status}
                </span>
                {exam.examPassword && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] text-amber-300">
                    <Icon d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" size={10} />
                    Password protected
                  </span>
                )}
              </div>
              <h1 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">{exam.title}</h1>
              <div className="flex flex-wrap items-center gap-4 text-xs text-white/50">
                <span className="flex items-center gap-1.5">
                  <Icon d="M12 8v4l3 3M12 2a10 10 0 100 20 10 10 0 000-20z" />
                  {exam.durationMinutes} min
                </span>
                <span className="flex items-center gap-1.5">
                  <Icon d="M9 12l2 2 4-4M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  {questions.length} question{questions.length !== 1 ? "s" : ""}
                </span>
                <span className="flex items-center gap-1.5">
                  <Icon d="M12 6v6l4 2M12 2a10 10 0 100 20 10 10 0 000-20z" />
                  {exam.totalMarks} pts total
                </span>
                {submitted > 0 && (
                  <span className="flex items-center gap-1.5 text-emerald-300">
                    <Icon d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
                    {submitted} submitted
                  </span>
                )}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Link href="/examiner/exams">
                <GlowButton variant="ghost" size="sm">← Back</GlowButton>
              </Link>
              {exam.status === "DRAFT" && (
                <GlowButton variant="gradient" size="sm" onClick={handlePublish}>
                  Upload Exam
                </GlowButton>
              )}
              {exam.status !== "DRAFT" && (
                <button
                  onClick={handleToggleActive}
                  className={`inline-flex h-9 items-center gap-1.5 rounded-md border px-3 text-xs font-medium transition ${
                    exam.isActive
                      ? "border-amber-500/30 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20"
                      : "border-emerald-500/30 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20"
                  }`}
                >
                  {exam.isActive ? (
                    <>
                      <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9.5 9.5l5 5M14.5 9.5l-5 5" strokeLinecap="round"/></svg>
                      Deactivate
                    </>
                  ) : (
                    <>
                      <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round"/></svg>
                      Activate
                    </>
                  )}
                </button>
              )}
              <button
                onClick={handleDelete}
                className="inline-flex h-9 items-center justify-center rounded-md border border-rose-500/30 bg-rose-500/10 px-3 text-xs font-medium text-rose-300 transition hover:bg-rose-500/20"
              >
                Delete
              </button>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="border-b border-white/10">
          <div className="flex flex-wrap gap-1">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => switchTab(t.id)}
                className={`group relative inline-flex items-center gap-2 rounded-t-lg px-4 py-2.5 text-sm font-medium transition ${
                  activeTab === t.id ? "text-white" : "text-white/50 hover:text-white/80"
                }`}
              >
                <Icon d={t.icon} />
                {t.label}
                {activeTab === t.id && (
                  <span className="absolute inset-x-0 -bottom-px h-0.5 bg-gradient-to-r from-indigo-400 via-purple-400 to-pink-400" />
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Tab content */}
        <div>
          {activeTab === "details" && (
            <DetailsTab exam={exam} onSave={async (data) => {
              try {
                await updateExam(exam.id, data);
                pushToast("success", "Details saved");
                await loadExam();
              } catch (e: any) {
                pushToast("error", e.response?.data?.error?.message || "Save failed");
              }
            }} />
          )}
          {activeTab === "questions" && (
            <QuestionsTab
              examId={exam.id}
              examStatus={exam.status}
              questions={questions}
              onQuestionsChange={setQuestions}
              onChange={loadExam}
              pushToast={pushToast}
            />
          )}
          {activeTab === "settings" && (
            <SettingsTab exam={exam} onSave={async (data) => {
              try {
                await updateExam(exam.id, data);
                pushToast("success", "Settings saved");
                await loadExam();
              } catch (e: any) {
                pushToast("error", e.response?.data?.error?.message || "Save failed");
              }
            }} />
          )}
          {activeTab === "location" && (
            <GeofenceTab examId={exam.id} exam={exam} pushToast={pushToast} onSaved={loadExam} />
          )}
          {activeTab === "ai-import" && (
            <AIImportTab examId={exam.id} onImported={loadExam} pushToast={pushToast} />
          )}
          {activeTab === "reports" && (
            <ReportsTab examId={exam.id} questions={questions} pushToast={pushToast} />
          )}
          {activeTab === "preview" && <PreviewTab exam={exam} questions={questions} />}
        </div>
      </div>

      {/* Toasts */}
      <div className="pointer-events-none fixed bottom-6 right-6 z-50 flex flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto rounded-lg border px-4 py-3 text-sm shadow-2xl backdrop-blur-md ${
              t.type === "success" ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-200" :
              t.type === "error" ? "border-rose-500/40 bg-rose-500/15 text-rose-200" :
              "border-white/15 bg-white/10 text-white"
            }`}
          >
            {t.message}
          </div>
        ))}
      </div>
    </DashboardShell>
  );
}

/* ============================================================ */
/* Details Tab                                                  */
/* ============================================================ */

function DetailsTab({ exam, onSave }: { exam: Exam; onSave: (data: Partial<Exam>) => Promise<void> }) {
  const [form, setForm] = useState({
    title: exam.title,
    courseCode: exam.courseCode,
    courseName: exam.courseName,
    description: exam.description || "",
    instructions: exam.instructions || "",
    examType: exam.examType || "QUIZ" as ExamType,
    examTypeOther: exam.examTypeOther || "",
    examPassword: exam.examPassword || "",
  });
  const [saving, setSaving] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const dirty =
    form.title !== exam.title ||
    form.courseCode !== exam.courseCode ||
    form.courseName !== exam.courseName ||
    (form.description || "") !== (exam.description || "") ||
    (form.instructions || "") !== (exam.instructions || "") ||
    form.examType !== (exam.examType || "QUIZ") ||
    (form.examTypeOther || "") !== (exam.examTypeOther || "") ||
    (form.examPassword || "") !== (exam.examPassword || "");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    await onSave({
      ...form,
      examTypeOther: form.examType === "OTHER" ? form.examTypeOther : "",
      examPassword: form.examPassword || null as any,
    });
    setSaving(false);
  }

  return (
    <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      <GlowCard className="lg:col-span-2">
        <div className="space-y-5">
          {/* Title */}
          <div className="space-y-2">
            <label className="text-[10px] font-semibold uppercase tracking-wider text-white/50">Exam Title</label>
            <input
              className="auth-input h-11 w-full rounded-lg px-3 text-sm"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              required
            />
          </div>

          {/* Course code + name */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <label className="text-[10px] font-semibold uppercase tracking-wider text-white/50">Course Code</label>
              <input
                className="auth-input h-11 w-full rounded-lg px-3 text-sm font-mono"
                value={form.courseCode}
                onChange={(e) => setForm({ ...form, courseCode: e.target.value })}
                required
              />
            </div>
            <div className="space-y-2">
              <label className="text-[10px] font-semibold uppercase tracking-wider text-white/50">Course Name</label>
              <input
                className="auth-input h-11 w-full rounded-lg px-3 text-sm"
                value={form.courseName}
                onChange={(e) => setForm({ ...form, courseName: e.target.value })}
                required
              />
            </div>
          </div>

          {/* Exam type */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <label className="text-[10px] font-semibold uppercase tracking-wider text-white/50">Exam Type</label>
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
            {form.examType === "OTHER" && (
              <div className="space-y-2">
                <label className="text-[10px] font-semibold uppercase tracking-wider text-white/50">Specify Type</label>
                <input
                  className="auth-input h-11 w-full rounded-lg px-3 text-sm"
                  value={form.examTypeOther}
                  onChange={(e) => setForm({ ...form, examTypeOther: e.target.value })}
                  placeholder="e.g. Practical Assessment"
                  required
                />
              </div>
            )}
          </div>

          {/* Exam password */}
          <div className="space-y-2">
            <label className="text-[10px] font-semibold uppercase tracking-wider text-white/50">
              Exam Password <span className="ml-1 normal-case text-white/30">(optional — students must enter this to begin)</span>
            </label>
            <div className="relative">
              <input
                type={showPassword ? "text" : "password"}
                className="auth-input h-11 w-full rounded-lg px-3 pr-10 text-sm"
                value={form.examPassword}
                onChange={(e) => setForm({ ...form, examPassword: e.target.value })}
                placeholder="Leave blank for no password"
                autoComplete="new-password"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60"
              >
                <Icon d={showPassword ? "M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24M1 1l22 22" : "M15 12a3 3 0 11-6 0 3 3 0 016 0zM2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"} size={15} />
              </button>
            </div>
          </div>

          {/* Description */}
          <div className="space-y-2">
            <label className="text-[10px] font-semibold uppercase tracking-wider text-white/50">
              Description <span className="ml-1 text-white/30">(brief summary)</span>
            </label>
            <textarea
              className="auth-input min-h-[80px] w-full rounded-lg px-3 py-2 text-sm"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="e.g. Final assessment for Database Systems covering SQL and normalization."
            />
          </div>

          {/* Instructions */}
          <div className="space-y-2">
            <label className="text-[10px] font-semibold uppercase tracking-wider text-white/50">
              Exam Instructions <span className="ml-1 text-white/30">(shown to students before they start)</span>
            </label>
            <p className="text-[11px] text-white/30">
              Use bullet points (start lines with • or -) or numbering (1. 2. 3.) to format vertically.
            </p>
            <textarea
              className="auth-input min-h-[160px] w-full rounded-lg px-3 py-2 text-sm leading-relaxed"
              value={form.instructions}
              onChange={(e) => setForm({ ...form, instructions: e.target.value })}
              placeholder={`e.g.\n1. Read each question carefully before answering.\n2. You may not use external resources.\n3. All answers are final once submitted.\n• Do not switch browser tabs.\n• Ensure your internet connection is stable.`}
            />
            <p className="text-[11px] text-white/30">
              Lines starting with a number + period or • / - will appear as a numbered/bulleted list to students.
            </p>
          </div>

          <div className="flex items-center justify-end gap-2 border-t border-white/5 pt-4">
            <button
              type="button"
              onClick={() => setForm({
                title: exam.title,
                courseCode: exam.courseCode,
                courseName: exam.courseName,
                description: exam.description || "",
                instructions: exam.instructions || "",
                examType: exam.examType || "QUIZ",
                examTypeOther: exam.examTypeOther || "",
                examPassword: exam.examPassword || "",
              })}
              disabled={!dirty}
              className="rounded-md border border-white/10 bg-white/5 px-4 py-2 text-xs font-medium text-white/70 transition hover:bg-white/10 disabled:opacity-40"
            >
              Discard
            </button>
            <GlowButton type="submit" size="sm" disabled={!dirty || saving}>
              {saving ? "Saving..." : "Save changes"}
            </GlowButton>
          </div>
        </div>
      </GlowCard>

      {/* Sidebar */}
      <div className="space-y-4">
        <GlowCard title="At a glance">
          <dl className="space-y-3 text-sm">
            <Row label="Status" value={<span className="font-mono text-xs">{exam.status === "PUBLISHED" ? "Uploaded" : exam.status}</span>} />
            <Row label="Type" value={exam.examType === "OTHER" && exam.examTypeOther ? exam.examTypeOther : EXAM_TYPE_LABELS[exam.examType] ?? exam.examType} />
            <Row label="Duration" value={`${exam.durationMinutes} min`} />
            <Row label="Total marks" value={exam.totalMarks} />
            <Row label="Questions" value={exam._count?.questions ?? "—"} />
            <Row label="Enrolled" value={exam._count?.examSessions ?? 0} />
            <Row
              label="Submitted"
              value={
                <span className={exam._count?.submittedSessions ? "font-bold text-emerald-300" : ""}>
                  {exam._count?.submittedSessions ?? 0}
                </span>
              }
            />
            <Row
              label="Password"
              value={exam.examPassword ? (
                <span className="flex items-center gap-1 text-amber-300">
                  <Icon d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" size={11} />
                  Set
                </span>
              ) : <span className="text-white/30">None</span>}
            />
          </dl>
        </GlowCard>
        <GlowCard>
          <p className="text-xs leading-relaxed text-white/50">
            Use the <span className="text-white">Questions</span> tab to build the exam,
            then configure timing and behavior under <span className="text-white">Settings</span>.
            Use <span className="text-white">Preview</span> before uploading to verify what students will see.
          </p>
        </GlowCard>

        <VenueManagerCard examId={exam.id} initialVenues={exam.venues ?? []} />
      </div>
    </form>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-xs uppercase tracking-wider text-white/40">{label}</dt>
      <dd className="text-white">{value}</dd>
    </div>
  );
}

/* ── Venue Manager Card ──────────────────────────────────────── */
function VenueManagerCard({ examId, initialVenues }: { examId: string; initialVenues: Venue[] }) {
  const [venues, setVenues] = useState<Venue[]>(initialVenues);
  const [newName, setNewName] = useState("");
  const [newCapacity, setNewCapacity] = useState("");
  const [adding, setAdding] = useState(false);
  const [showForm, setShowForm] = useState(false);

  async function addVenue() {
    if (!newName.trim()) return;
    setAdding(true);
    try {
      const { data } = await api.post(`/exams/${examId}/venues`, {
        name: newName.trim(),
        capacity: parseInt(newCapacity, 10) || 0,
      });
      setVenues((v) => [...v, data.data]);
      setNewName("");
      setNewCapacity("");
      setShowForm(false);
    } catch {}
    finally { setAdding(false); }
  }

  async function removeVenue(id: string) {
    try {
      await api.delete(`/exams/venues/${id}`);
      setVenues((v) => v.filter((x) => x.id !== id));
    } catch {}
  }

  return (
    <GlowCard title="Exam Venues">
      <div className="space-y-3">
        <p className="text-[11px] text-white/40">
          Students will pick one of these venues when starting the exam.
        </p>

        {venues.length === 0 && (
          <p className="text-[11px] italic text-white/25">No venues added yet.</p>
        )}

        <ul className="space-y-1.5">
          {venues.map((v) => (
            <li key={v.id} className="flex items-center justify-between gap-2 rounded-lg border border-white/5 bg-white/[0.02] px-3 py-2">
              <div className="min-w-0">
                <span className="block truncate text-xs font-medium text-white">{v.name}</span>
                {v.capacity > 0 && (
                  <span className="text-[10px] text-white/35">Capacity: {v.capacity}</span>
                )}
              </div>
              <button
                type="button"
                onClick={() => removeVenue(v.id)}
                className="shrink-0 rounded p-1 text-white/30 transition hover:bg-rose-500/10 hover:text-rose-400"
                title="Remove venue"
              >
                <Icon d="M6 18L18 6M6 6l12 12" size={12} />
              </button>
            </li>
          ))}
        </ul>

        {showForm ? (
          <div className="space-y-2 rounded-lg border border-white/5 bg-white/[0.02] p-3">
            <input
              className="auth-input h-9 w-full rounded-lg px-3 text-xs"
              placeholder="Venue name (e.g. Hall A, Lab 3)"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addVenue()}
            />
            <input
              className="auth-input h-9 w-full rounded-lg px-3 text-xs"
              placeholder="Capacity (optional)"
              type="number"
              min={0}
              value={newCapacity}
              onChange={(e) => setNewCapacity(e.target.value)}
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={addVenue}
                disabled={adding || !newName.trim()}
                className="flex-1 rounded-lg bg-indigo-600 py-2 text-xs font-semibold text-white transition hover:bg-indigo-500 disabled:opacity-50"
              >
                {adding ? "Adding…" : "Add Venue"}
              </button>
              <button
                type="button"
                onClick={() => { setShowForm(false); setNewName(""); setNewCapacity(""); }}
                className="rounded-lg border border-white/10 px-3 py-2 text-xs text-white/50 hover:bg-white/5"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setShowForm(true)}
            className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-white/10 py-2 text-xs text-white/40 transition hover:border-indigo-400/40 hover:text-indigo-300"
          >
            <Icon d="M12 4v16m8-8H4" size={12} />
            Add Venue
          </button>
        )}
      </div>
    </GlowCard>
  );
}

/* ============================================================ */
/* Questions Tab                                                */
/* ============================================================ */

interface QuestionsTabProps {
  examId: string;
  examStatus: string;
  questions: Question[];
  onQuestionsChange: (qs: Question[]) => void;
  onChange: () => Promise<void>;
  pushToast: (type: Toast["type"], message: string) => void;
}

function QuestionsTab({ examId, examStatus, questions, onQuestionsChange, onChange, pushToast }: QuestionsTabProps) {
  const { addQuestion, updateQuestion, deleteQuestion } = useExamStore();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [newQuestionType, setNewQuestionType] = useState<QuestionType | null>(null);
  const [busy, setBusy] = useState(false);

  // Questions are always editable — removed DRAFT-only lock
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const q of questions) c[q.type] = (c[q.type] || 0) + 1;
    return c;
  }, [questions]);

  async function handleCreate(payload: Partial<Question>) {
    setBusy(true);
    try {
      const created = await addQuestion(examId, payload);
      // Update list locally — no need for a full exam reload
      onQuestionsChange([...questions, created]);
      setNewQuestionType(null);
      pushToast("success", "Question added");
    } catch (e: any) {
      pushToast("error", e.response?.data?.error?.message || "Failed to add question");
      throw e;
    } finally {
      setBusy(false);
    }
  }

  async function handleUpdate(qid: string, payload: Partial<Question>) {
    setBusy(true);
    try {
      const updated = await updateQuestion(qid, payload);
      onQuestionsChange(questions.map((q) => q.id === qid ? { ...q, ...updated } : q));
      setEditingId(null);
      pushToast("success", "Question updated");
    } catch (e: any) {
      pushToast("error", e.response?.data?.error?.message || "Update failed");
      throw e;
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(qid: string) {
    if (!confirm("Delete this question?")) return;
    setBusy(true);
    try {
      await deleteQuestion(qid);
      onQuestionsChange(questions.filter((q) => q.id !== qid));
      pushToast("success", "Question deleted");
    } catch (e: any) {
      pushToast("error", e.response?.data?.error?.message || "Delete failed");
    } finally {
      setBusy(false);
    }
  }

  async function handleDuplicate(q: Question) {
    setBusy(true);
    try {
      const created = await addQuestion(examId, {
        type: q.type,
        text: q.text + " (copy)",
        options: q.options,
        correctAnswer: q.correctAnswer,
        marks: q.marks,
      });
      onQuestionsChange([...questions, created]);
      pushToast("success", "Question duplicated");
    } catch (e: any) {
      pushToast("error", e.response?.data?.error?.message || "Duplicate failed");
    } finally {
      setBusy(false);
    }
  }

  const typeCards: { type: QuestionType; description: string }[] = [
    { type: "MCQ", description: "One correct answer from several options" },
    { type: "TRUE_FALSE", description: "Single binary True / False answer" },
    { type: "FILL_IN_BLANK", description: "Type-in box or dropdown select" },
    { type: "MULTI_BLANK_EQUATION", description: "Multiple blanks with partial credit" },
  ];

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[280px_1fr]">
      {/* Left rail */}
      <aside className="space-y-4">
        <GlowCard>
          <div className="space-y-3">
            <div>
              <h3 className="text-sm font-semibold text-white">Add Question</h3>
              <p className="mt-0.5 text-xs text-white/40">Pick a type to insert at the end.</p>
            </div>
            <div className="space-y-2">
              {typeCards.map((tc) => (
                <button
                  key={tc.type}
                  onClick={() => {
                    setNewQuestionType(tc.type);
                    setEditingId(null);
                    setTimeout(() => {
                      document.getElementById("new-question-editor")?.scrollIntoView({ behavior: "smooth", block: "center" });
                    }, 50);
                  }}
                  className={`group flex w-full items-start gap-3 rounded-lg border border-white/10 bg-white/[0.02] p-3 text-left transition hover:border-white/20 hover:bg-white/5 ${
                    newQuestionType === tc.type ? "border-indigo-400/40 bg-indigo-500/10" : ""
                  }`}
                >
                  <span className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md border ${QTYPE_TONE[tc.type]}`}>
                    <Icon d={QTYPE_ICON[tc.type]} size={14} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs font-semibold text-white">{QTYPE_LABEL[tc.type]}</span>
                    <span className="mt-0.5 block text-[11px] leading-tight text-white/40">{tc.description}</span>
                  </span>
                  <span className="shrink-0 text-xs text-white/30 group-hover:text-white/60">+</span>
                </button>
              ))}
            </div>
          </div>
        </GlowCard>

        <GlowCard>
          <h3 className="mb-3 text-sm font-semibold text-white">Question Bank</h3>
          <dl className="space-y-2 text-xs">
            <div className="flex items-center justify-between">
              <dt className="text-white/50">Total</dt>
              <dd className="font-bold text-white">{questions.length}</dd>
            </div>
            {Object.entries(QTYPE_LABEL).map(([k, lbl]) => (
              <div key={k} className="flex items-center justify-between">
                <dt className="text-white/40">{lbl}</dt>
                <dd className="text-white/70">{counts[k] || 0}</dd>
              </div>
            ))}
            <div className="mt-2 flex items-center justify-between border-t border-white/5 pt-2">
              <dt className="text-white/50">Total points</dt>
              <dd className="font-bold text-white">
                {questions.reduce((s, q) => s + (q.marks || 0), 0)}
              </dd>
            </div>
          </dl>
        </GlowCard>

        {examStatus !== "DRAFT" && (
          <div className="rounded-lg border border-indigo-500/20 bg-indigo-500/5 p-3 text-xs text-indigo-200">
            Exam is <span className="font-semibold">{examStatus === "PUBLISHED" ? "uploaded" : examStatus.toLowerCase()}</span>. Questions can still be edited.
          </div>
        )}
      </aside>

      {/* Main: question list */}
      <div className="space-y-3">
        {questions.length === 0 && !newQuestionType && (
          <GlowCard className="text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full border border-white/10 bg-white/5">
              <Icon d="M12 4v16m8-8H4" size={22} />
            </div>
            <h3 className="mt-4 text-base font-semibold text-white">No questions yet</h3>
            <p className="mt-1 text-sm text-white/50">Pick a question type from the palette on the left.</p>
          </GlowCard>
        )}

        {questions.map((q, i) => (
          <div key={q.id}>
            {editingId === q.id ? (
              <div className="rounded-xl border border-indigo-400/30 bg-slate-950/40 p-1">
                <div className="flex items-center justify-between px-4 py-2">
                  <span className="text-xs font-semibold uppercase tracking-wider text-indigo-300">
                    Editing Question {i + 1}
                  </span>
                </div>
                <QuestionEditor
                  initial={q}
                  lockedType
                  onSave={(payload) => handleUpdate(q.id, payload)}
                  onCancel={() => setEditingId(null)}
                  saveLabel="Save question"
                />
              </div>
            ) : (
              <QuestionCard
                question={q}
                index={i}
                locked={busy}
                onEdit={() => setEditingId(q.id)}
                onDuplicate={() => handleDuplicate(q)}
                onDelete={() => handleDelete(q.id)}
              />
            )}
          </div>
        ))}

        {newQuestionType && (
          <div id="new-question-editor" className="rounded-xl border border-emerald-400/30 bg-slate-950/40 p-1">
            <div className="flex items-center justify-between px-4 py-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-emerald-300">
                New {QTYPE_LABEL[newQuestionType]} Question
              </span>
              <button onClick={() => setNewQuestionType(null)} className="text-xs text-white/40 hover:text-white">
                Cancel
              </button>
            </div>
            <QuestionEditor
              initial={{ type: newQuestionType, marks: 1, text: "", options: newQuestionType === "MCQ" ? ["", "", "", "", "None of the above"] as any : ["", "", "", ""] as any }}
              onSave={handleCreate}
              onCancel={() => setNewQuestionType(null)}
              saveLabel="Add question"
            />
          </div>
        )}

        {questions.length > 0 && !newQuestionType && (
          <button
            onClick={() => { setNewQuestionType("MCQ"); setEditingId(null); }}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-white/15 bg-white/[0.02] py-4 text-sm text-white/50 transition hover:border-white/30 hover:bg-white/5 hover:text-white"
          >
            <Icon d="M12 4v16m8-8H4" />
            Add another question
          </button>
        )}
      </div>
    </div>
  );
}

function QuestionCard({
  question, index, locked, onEdit, onDuplicate, onDelete,
}: {
  question: Question; index: number; locked: boolean;
  onEdit: () => void; onDuplicate: () => void; onDelete: () => void;
}) {
  const fibType = (question as any).fillInBlankType;

  const correctAnswerDisplay = useMemo(() => {
    if (question.type === "MCQ") return String(question.correctAnswer);
    if (question.type === "TRUE_FALSE") return String(question.correctAnswer);
    if (question.type === "FILL_IN_BLANK") return String(question.correctAnswer);
    if (question.type === "MULTI_BLANK_EQUATION" && Array.isArray(question.correctAnswer)) {
      return (question.correctAnswer as string[]).join(" · ");
    }
    return "";
  }, [question]);

  return (
    <div className="group rounded-xl border border-white/10 bg-white/[0.02] p-4 transition hover:border-white/20 hover:bg-white/[0.04]">
      <div className="flex items-start gap-3">
        <div className="flex shrink-0 flex-col items-center gap-1">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/5 text-xs font-bold text-white">
            {index + 1}
          </span>
          <span className="text-[10px] font-semibold text-white/40">{question.marks}pt</span>
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${QTYPE_TONE[question.type]}`}>
              <Icon d={QTYPE_ICON[question.type]} size={10} />
              {QTYPE_LABEL[question.type]}
            </span>
            {question.type === "FILL_IN_BLANK" && fibType && (
              <span className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] text-white/40">
                {fibType === "dropdown" ? "Dropdown" : "Text box"}
              </span>
            )}
          </div>
          {question.text && question.text !== "[block-based question]" && (
            <div
              className="qe-prose text-sm text-white"
              dangerouslySetInnerHTML={{ __html: question.text }}
            />
          )}

          {Array.isArray(question.blocks) && question.blocks.length > 0 && (
            <div className="space-y-2 rounded-lg border border-white/5 bg-white/[0.02] p-3">
              <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-white/40">
                <Icon d="M4 6h16M4 12h16M4 18h7" size={10} />
                {question.blocks.length} attached block{question.blocks.length === 1 ? "" : "s"}
              </div>
              <BlockList blocks={question.blocks} />
            </div>
          )}

          {question.type === "MCQ" && Array.isArray(question.options) && (
            <div className="space-y-1">
              {(question.options as string[]).map((opt, idx) => {
                const isCorrect = opt === question.correctAnswer;
                return (
                  <div key={idx} className={`flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs ${
                    isCorrect ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200" : "border-white/5 bg-white/[0.02] text-white/60"
                  }`}>
                    <span className="font-mono text-[10px] opacity-60">{String.fromCharCode(65 + idx)}.</span>
                    <span className="flex-1">{opt}</span>
                    {isCorrect && <span className="text-[10px] font-semibold uppercase tracking-wider text-emerald-300">Correct</span>}
                  </div>
                );
              })}
            </div>
          )}

          {(question.type === "TRUE_FALSE" || question.type === "FILL_IN_BLANK" || question.type === "MULTI_BLANK_EQUATION") && (
            <div className="text-xs text-white/50">
              <span className="text-white/40">Answer: </span>
              <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 font-mono text-emerald-200">
                {correctAnswerDisplay}
              </span>
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1 opacity-0 transition group-hover:opacity-100">
          <button onClick={onEdit} disabled={locked} className="rounded-md border border-white/10 bg-white/5 p-1.5 text-white/60 transition hover:bg-white/10 hover:text-white disabled:opacity-40" title="Edit">
            <Icon d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" size={14} />
          </button>
          <button onClick={onDuplicate} disabled={locked} className="rounded-md border border-white/10 bg-white/5 p-1.5 text-white/60 transition hover:bg-white/10 hover:text-white disabled:opacity-40" title="Duplicate">
            <Icon d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" size={14} />
          </button>
          <button onClick={onDelete} disabled={locked} className="rounded-md border border-white/10 bg-white/5 p-1.5 text-white/60 transition hover:bg-rose-500/15 hover:text-rose-300 disabled:opacity-40" title="Delete">
            <Icon d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M1 7h22M9 7V4a1 1 0 011-1h4a1 1 0 011 1v3" size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}

/* ============================================================ */
/* Settings Tab                                                 */
/* ============================================================ */

const DEFAULT_GRADING: GradeRange[] = [
  { grade: "A", min: 80, max: 100 },
  { grade: "B", min: 70, max: 79 },
  { grade: "C", min: 60, max: 69 },
  { grade: "D", min: 50, max: 59 },
  { grade: "F", min: 0, max: 49 },
];

const DEFAULT_REMARKS: ScoreRemark[] = [
  { min: 80, max: 100, remark: "Excellent performance!" },
  { min: 60, max: 79, remark: "Good work, keep it up." },
  { min: 0, max: 59, remark: "Needs improvement." },
];

function SettingsTab({ exam, onSave }: { exam: Exam; onSave: (data: Partial<Exam>) => Promise<void> }) {
  const toLocalInput = (iso?: string) => {
    if (!iso) return "";
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  const [form, setForm] = useState({
    durationMinutes: exam.durationMinutes,
    startTime: toLocalInput(exam.startTime),
    endTime: toLocalInput(exam.endTime),
    shuffleQuestions: exam.shuffleQuestions,
    allowBacktrack: exam.allowBacktrack,
    maxAttempts: exam.maxAttempts ?? 1,
    showScoreToStudents: exam.showScoreToStudents !== false,
    showRemarksToStudents: exam.showRemarksToStudents ?? false,
    gradingSystem: (exam.gradingSystem as GradeRange[] | undefined) ?? DEFAULT_GRADING,
    scoreRemarks: (exam.scoreRemarks as ScoreRemark[] | undefined) ?? DEFAULT_REMARKS,
  });
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    await onSave({
      durationMinutes: form.durationMinutes,
      shuffleQuestions: form.shuffleQuestions,
      allowBacktrack: form.allowBacktrack,
      startTime: form.startTime ? new Date(form.startTime).toISOString() : undefined,
      endTime: form.endTime ? new Date(form.endTime).toISOString() : undefined,
      maxAttempts: form.maxAttempts,
      showScoreToStudents: form.showScoreToStudents,
      showRemarksToStudents: form.showRemarksToStudents,
      gradingSystem: form.gradingSystem,
      scoreRemarks: form.showRemarksToStudents ? form.scoreRemarks : undefined,
    });
    setSaving(false);
  }

  function updateGradeRow(i: number, field: keyof GradeRange, value: string | number) {
    const updated = form.gradingSystem.map((row, idx) =>
      idx === i ? { ...row, [field]: field === "grade" ? value : Number(value) } : row
    );
    setForm({ ...form, gradingSystem: updated });
  }

  function addGradeRow() {
    setForm({ ...form, gradingSystem: [...form.gradingSystem, { grade: "", min: 0, max: 0 }] });
  }

  function removeGradeRow(i: number) {
    setForm({ ...form, gradingSystem: form.gradingSystem.filter((_, idx) => idx !== i) });
  }

  function updateRemarkRow(i: number, field: keyof ScoreRemark, value: string | number) {
    const updated = form.scoreRemarks.map((row, idx) =>
      idx === i ? { ...row, [field]: field === "remark" ? value : Number(value) } : row
    );
    setForm({ ...form, scoreRemarks: updated });
  }

  function addRemarkRow() {
    setForm({ ...form, scoreRemarks: [...form.scoreRemarks, { min: 0, max: 0, remark: "" }] });
  }

  function removeRemarkRow(i: number) {
    setForm({ ...form, scoreRemarks: form.scoreRemarks.filter((_, idx) => idx !== i) });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Timing */}
        <GlowCard title="Timing & Scheduling" description="When and for how long the exam runs.">
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-[10px] font-semibold uppercase tracking-wider text-white/50">Duration (minutes)</label>
                <input
                  type="number"
                  min={1}
                  step={1}
                  className="auth-input h-11 w-full rounded-lg px-3 text-sm"
                  value={form.durationMinutes || ""}
                  onKeyDown={(e) => {
                    if (e.key === "0" && !(e.target as HTMLInputElement).value) e.preventDefault();
                  }}
                  onChange={(e) => {
                    const stripped = e.target.value.replace(/^0+(\d)/, "$1").replace(/[^0-9]/g, "");
                    setForm({ ...form, durationMinutes: parseInt(stripped, 10) || 0 });
                  }}
                  placeholder="e.g. 60"
                  required
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-semibold uppercase tracking-wider text-white/50">Max attempts</label>
                <input
                  type="number"
                  min={1}
                  step={1}
                  className="auth-input h-11 w-full rounded-lg px-3 text-sm"
                  value={form.maxAttempts}
                  onChange={(e) => setForm({ ...form, maxAttempts: parseInt(e.target.value, 10) || 1 })}
                />
                <p className="text-[10px] text-white/30">How many times can each student attempt</p>
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-semibold uppercase tracking-wider text-white/50">Opens at (available from)</label>
              <input
                type="datetime-local"
                className="auth-input h-11 w-full rounded-lg px-3 text-sm"
                value={form.startTime}
                onChange={(e) => setForm({ ...form, startTime: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-semibold uppercase tracking-wider text-white/50">Closes at (available until)</label>
              <input
                type="datetime-local"
                className="auth-input h-11 w-full rounded-lg px-3 text-sm"
                value={form.endTime}
                onChange={(e) => setForm({ ...form, endTime: e.target.value })}
              />
            </div>
          </div>
        </GlowCard>

        {/* Behaviour */}
        <GlowCard title="Quiz Behaviour" description="Control how students experience the exam.">
          <div className="space-y-3">
            <ToggleRow
              label="Shuffle questions"
              description="Randomize question order for each student."
              value={form.shuffleQuestions}
              onChange={(v) => setForm({ ...form, shuffleQuestions: v })}
            />
            <ToggleRow
              label="Allow backtracking"
              description="Students can navigate back to previous questions."
              value={form.allowBacktrack}
              onChange={(v) => setForm({ ...form, allowBacktrack: v })}
            />
          </div>
        </GlowCard>
      </div>

      {/* Results visibility */}
      <GlowCard title="Results & Feedback" description="Choose what students see after submitting.">
        <div className="space-y-3">
          <ToggleRow
            label="Show score to students"
            description="Students can see their final score after submission."
            value={form.showScoreToStudents}
            onChange={(v) => setForm({ ...form, showScoreToStudents: v })}
          />
          <ToggleRow
            label="Show remarks to students"
            description="Students see a custom remark based on their score range."
            value={form.showRemarksToStudents}
            onChange={(v) => setForm({ ...form, showRemarksToStudents: v })}
          />
        </div>

        {form.showRemarksToStudents && (
          <div className="mt-4 space-y-3 rounded-lg border border-white/5 bg-white/[0.02] p-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-white/50">Score Remarks</p>
            <p className="text-xs text-white/30">Define a remark for each score range. Students see the remark for their score.</p>
            <div className="space-y-2">
              {form.scoreRemarks.map((row, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    type="number"
                    className="auth-input h-9 w-16 rounded-md px-2 text-xs"
                    placeholder="Min"
                    value={row.min}
                    onChange={(e) => updateRemarkRow(i, "min", e.target.value)}
                  />
                  <span className="text-white/30 text-xs">–</span>
                  <input
                    type="number"
                    className="auth-input h-9 w-16 rounded-md px-2 text-xs"
                    placeholder="Max"
                    value={row.max}
                    onChange={(e) => updateRemarkRow(i, "max", e.target.value)}
                  />
                  <input
                    className="auth-input h-9 flex-1 rounded-md px-2 text-xs"
                    placeholder="Remark (e.g. Excellent!)"
                    value={row.remark}
                    onChange={(e) => updateRemarkRow(i, "remark", e.target.value)}
                  />
                  <button
                    type="button"
                    onClick={() => removeRemarkRow(i)}
                    className="shrink-0 rounded-md border border-white/10 bg-white/5 p-1.5 text-white/40 hover:bg-rose-500/15 hover:text-rose-300"
                  >
                    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" /></svg>
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={addRemarkRow}
                className="text-xs text-white/50 hover:text-white"
              >
                + Add remark range
              </button>
            </div>
          </div>
        )}
      </GlowCard>

      {/* Grading system */}
      <GlowCard title="Grading System" description="Set grade boundaries as percentages (0–100). Students' scores are compared to the percentage of total marks.">
        <div className="space-y-2">
          <div className="grid grid-cols-[60px_80px_80px_1fr_36px] gap-2 px-1">
            {["Grade", "Min %", "Max %", "", ""].map((h) => (
              <span key={h} className="text-[10px] font-semibold uppercase tracking-wider text-white/30">{h}</span>
            ))}
          </div>
          {form.gradingSystem.map((row, i) => (
            <div key={i} className="grid grid-cols-[60px_80px_80px_1fr_36px] items-center gap-2">
              <input
                className="auth-input h-9 rounded-md px-2 text-center text-sm font-bold"
                placeholder="A"
                value={row.grade}
                maxLength={4}
                onChange={(e) => updateGradeRow(i, "grade", e.target.value.toUpperCase())}
              />
              <input
                type="number"
                min={0}
                max={100}
                className="auth-input h-9 rounded-md px-2 text-sm"
                placeholder="80"
                value={row.min}
                onChange={(e) => updateGradeRow(i, "min", e.target.value)}
              />
              <input
                type="number"
                min={0}
                max={100}
                className="auth-input h-9 rounded-md px-2 text-sm"
                placeholder="100"
                value={row.max}
                onChange={(e) => updateGradeRow(i, "max", e.target.value)}
              />
              <div
                className="h-3 rounded-full"
                style={{
                  background: `hsl(${120 - (i / Math.max(form.gradingSystem.length - 1, 1)) * 120}, 70%, 55%)`,
                  opacity: 0.7,
                }}
              />
              <button
                type="button"
                onClick={() => removeGradeRow(i)}
                className="flex h-9 w-9 items-center justify-center rounded-md border border-white/10 bg-white/5 text-white/40 hover:bg-rose-500/15 hover:text-rose-300"
              >
                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" /></svg>
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={addGradeRow}
            className="mt-1 text-xs text-white/50 hover:text-white"
          >
            + Add grade row
          </button>
        </div>
      </GlowCard>

      <div className="flex justify-end">
        <GlowButton type="submit" disabled={saving}>
          {saving ? "Saving..." : "Save all settings"}
        </GlowButton>
      </div>
    </form>
  );
}

function ToggleRow({ label, description, value, onChange }: {
  label: string; description: string; value: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-lg border border-white/5 bg-white/[0.02] p-3">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-white">{label}</p>
        <p className="mt-0.5 text-xs text-white/40">{description}</p>
      </div>
      <button
        type="button"
        onClick={() => onChange(!value)}
        className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
          value ? "bg-gradient-to-r from-indigo-500 to-purple-500" : "bg-white/10"
        }`}
      >
        <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${value ? "translate-x-5" : "translate-x-0.5"}`} />
      </button>
    </div>
  );
}

/* ============================================================ */
/* AI Question Import Tab                                       */
/* ============================================================ */

interface AIQuestion {
  question_text: string;
  question_type: string;   // mcq | fill_in_blank | true_false | theory
  options: string[];
  answer: string;
  marks: number;
}

function AIImportTab({
  examId,
  onImported,
  pushToast,
}: {
  examId: string;
  onImported: () => void;
  pushToast: (type: "success" | "error" | "info", msg: string) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<"idle" | "processing" | "done" | "error">("idle");
  const [questions, setQuestions] = useState<AIQuestion[]>([]);
  const [edited, setEdited] = useState<AIQuestion[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [importing, setImporting] = useState(false);
  const [regenerating, setRegenerating] = useState<number | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Upload ──────────────────────────────────────────────────────────────────
  async function handleUpload() {
    if (!file) return;
    setUploading(true);
    setErrorMsg("");
    setQuestions([]);
    setEdited([]);
    setSelected(new Set());
    setJobStatus("processing");
    try {
      const form = new FormData();
      form.append("file", file);
      const { data } = await api.post(`/ai-import/${examId}/upload`, form, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      setJobId(data.data.jobId);
      startPolling(data.data.jobId);
    } catch (err: any) {
      setJobStatus("error");
      setErrorMsg(err.response?.data?.error?.message || "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  // ── Poll job until done ─────────────────────────────────────────────────────
  function startPolling(id: string) {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const { data } = await api.get(`/ai-import/job/${id}`);
        const job = data.data;
        if (job.status === "done") {
          clearInterval(pollRef.current!);
          const qs: AIQuestion[] = Array.isArray(job.questions) ? job.questions : [];
          setQuestions(qs);
          setEdited(qs.map((q) => ({ ...q })));
          setSelected(new Set(qs.map((_, i) => i)));
          setJobStatus("done");
        } else if (job.status === "error") {
          clearInterval(pollRef.current!);
          setJobStatus("error");
          setErrorMsg(job.errorMsg || "Extraction failed");
        }
      } catch { /* keep polling */ }
    }, 3000);
  }

  // ── Edit a question field ───────────────────────────────────────────────────
  function updateQ(i: number, field: keyof AIQuestion, value: unknown) {
    setEdited((prev) => prev.map((q, idx) => idx === i ? { ...q, [field]: value } : q));
  }
  function updateOption(qi: number, oi: number, value: string) {
    setEdited((prev) => prev.map((q, idx) => {
      if (idx !== qi) return q;
      const opts = [...(q.options || [])];
      opts[oi] = value;
      return { ...q, options: opts };
    }));
  }

  // ── Regenerate ──────────────────────────────────────────────────────────────
  async function handleRegenerate(i: number, mode: string) {
    setRegenerating(i);
    try {
      const q = edited[i];
      const { data } = await api.post("/ai-import/regenerate", {
        question_text: q.question_text,
        question_type: q.question_type,
        options: q.options,
        mode,
      });
      const newQ: AIQuestion = data.data?.question || data.data;
      setEdited((prev) => prev.map((old, idx) => idx === i ? { ...old, ...newQ } : old));
      pushToast("success", "Question regenerated.");
    } catch {
      pushToast("error", "Regeneration failed. Check ML service connection.");
    } finally {
      setRegenerating(null);
    }
  }

  // ── Import selected questions into exam ─────────────────────────────────────
  async function handleImport() {
    const toImport = [...selected].map((i) => edited[i]);
    if (!toImport.length) { pushToast("info", "Select at least one question."); return; }
    setImporting(true);
    try {
      const mapType = (t: string) => {
        const l = t.toLowerCase();
        if (l.includes("mcq") || l.includes("multiple")) return "MCQ";
        if (l.includes("fill")) return "FILL_IN_BLANK";
        if (l.includes("true")) return "TRUE_FALSE";
        return "FILL_IN_BLANK";
      };
      await Promise.all(
        toImport.map((q) =>
          api.post(`/questions/${examId}`, {
            type: mapType(q.question_type),
            text: q.question_text,
            options: q.options?.length ? q.options : undefined,
            correctAnswer: q.answer || (q.options?.[0] ?? ""),
            marks: q.marks || 1,
          })
        )
      );
      pushToast("success", `${toImport.length} question(s) imported successfully!`);
      onImported();
      setQuestions([]);
      setEdited([]);
      setSelected(new Set());
      setJobId(null);
      setJobStatus("idle");
      setFile(null);
    } catch (err: any) {
      pushToast("error", err.response?.data?.error?.message || "Import failed");
    } finally {
      setImporting(false);
    }
  }

  const TYPE_LABELS: Record<string, string> = {
    mcq: "MCQ", fill_in_blank: "Fill in Blank", true_false: "True / False", theory: "Theory",
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <GlowCard
        title="AI Question Import + Regeneration"
        description="Upload a PDF, Word document, or image of an exam paper. The AI will extract, structure, and let you review every question before importing."
      >
        <div className="space-y-4">
          {/* File picker */}
          <div className="flex flex-col gap-2">
            <label className="text-[10px] font-semibold uppercase tracking-wider text-white/50">
              Upload Exam File (PDF, DOC, DOCX, JPG, PNG — max 20 MB)
            </label>
            <div className="flex items-center gap-3">
              <label className="flex flex-1 cursor-pointer items-center gap-3 rounded-lg border border-dashed border-white/20 bg-white/[0.02] p-4 transition hover:border-indigo-400/40 hover:bg-indigo-500/5">
                <svg viewBox="0 0 24 24" width={20} height={20} fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0 text-indigo-400">
                  <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12" />
                </svg>
                <span className="text-sm text-white/60">
                  {file ? file.name : "Click to choose a file…"}
                </span>
                <input
                  type="file"
                  accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"
                  className="hidden"
                  onChange={(e) => { setFile(e.target.files?.[0] || null); setJobStatus("idle"); setQuestions([]); }}
                />
              </label>
              <GlowButton
                onClick={handleUpload}
                disabled={!file || uploading || jobStatus === "processing"}
              >
                {uploading ? "Uploading…" : jobStatus === "processing" ? "Processing…" : "Extract Questions"}
              </GlowButton>
            </div>
          </div>

          {/* Status */}
          {jobStatus === "processing" && (
            <div className="flex items-center gap-3 rounded-lg border border-indigo-500/30 bg-indigo-500/10 px-4 py-3 text-sm text-indigo-300">
              <span className="h-3 w-3 animate-spin rounded-full border-2 border-indigo-400 border-t-transparent" />
              AI is extracting questions in the background. This usually takes 15–60 seconds…
            </div>
          )}
          {jobStatus === "error" && (
            <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
              {errorMsg || "Extraction failed. Try a different file or check the ML service."}
            </div>
          )}
          {jobStatus === "done" && questions.length === 0 && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-300">
              No questions found. Make sure your file contains numbered exam questions.
            </div>
          )}
        </div>
      </GlowCard>

      {/* Review panel */}
      {edited.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-white">{edited.length} question(s) extracted</p>
              <p className="text-xs text-white/40">Review and edit before importing. Uncheck questions you don't want.</p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setSelected(selected.size === edited.length ? new Set() : new Set(edited.map((_, i) => i)))}
                className="text-xs text-indigo-300 hover:text-indigo-200"
              >
                {selected.size === edited.length ? "Deselect all" : "Select all"}
              </button>
              <GlowButton onClick={handleImport} disabled={importing || selected.size === 0}>
                {importing ? "Importing…" : `Import ${selected.size} Question${selected.size !== 1 ? "s" : ""}`}
              </GlowButton>
            </div>
          </div>

          {edited.map((q, i) => (
            <div
              key={i}
              className={`rounded-xl border p-4 space-y-3 transition ${
                selected.has(i) ? "border-indigo-500/30 bg-indigo-500/5" : "border-white/10 bg-white/[0.02] opacity-50"
              }`}
            >
              {/* Header row */}
              <div className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={selected.has(i)}
                  onChange={() => {
                    const next = new Set(selected);
                    next.has(i) ? next.delete(i) : next.add(i);
                    setSelected(next);
                  }}
                  className="h-4 w-4 accent-indigo-500"
                />
                <span className="text-xs font-bold text-indigo-300">Q{i + 1}</span>

                {/* Type selector */}
                <select
                  value={q.question_type}
                  onChange={(e) => updateQ(i, "question_type", e.target.value)}
                  className="rounded-md border border-white/10 bg-white/5 px-2 py-1 text-xs text-white outline-none"
                >
                  {Object.entries(TYPE_LABELS).map(([v, l]) => (
                    <option key={v} value={v}>{l}</option>
                  ))}
                </select>

                {/* Marks */}
                <div className="flex items-center gap-1.5 ml-auto">
                  <span className="text-[10px] text-white/40">Marks</span>
                  <input
                    type="number"
                    min={0.5}
                    step={0.5}
                    value={q.marks}
                    onChange={(e) => updateQ(i, "marks", parseFloat(e.target.value) || 1)}
                    className="w-16 rounded-md border border-white/10 bg-white/5 px-2 py-1 text-xs text-white outline-none"
                  />
                </div>
              </div>

              {/* Question text */}
              <textarea
                rows={2}
                value={q.question_text}
                onChange={(e) => updateQ(i, "question_text", e.target.value)}
                className="w-full resize-none rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-white outline-none focus:border-indigo-500/50"
                placeholder="Question text…"
              />

              {/* MCQ options */}
              {q.question_type === "mcq" && (
                <div className="space-y-1.5">
                  <p className="text-[10px] uppercase tracking-wider text-white/40">Options</p>
                  {(q.options?.length ? q.options : ["", "", "", ""]).map((opt, oi) => (
                    <div key={oi} className="flex items-center gap-2">
                      <span className="text-[11px] text-white/30 w-4">{String.fromCharCode(65 + oi)}.</span>
                      <input
                        type="text"
                        value={opt}
                        onChange={(e) => updateOption(i, oi, e.target.value)}
                        className="flex-1 rounded-md border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs text-white outline-none focus:border-indigo-500/40"
                        placeholder={`Option ${String.fromCharCode(65 + oi)}`}
                      />
                    </div>
                  ))}
                </div>
              )}

              {/* Answer */}
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-white/40 shrink-0">Answer</span>
                <input
                  type="text"
                  value={q.answer}
                  onChange={(e) => updateQ(i, "answer", e.target.value)}
                  className="flex-1 rounded-md border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs text-white outline-none focus:border-indigo-500/40"
                  placeholder="Correct answer…"
                />
              </div>

              {/* Regeneration actions */}
              <div className="flex flex-wrap gap-2 pt-1 border-t border-white/5">
                {[
                  { mode: "similar",  label: "🔄 Similar" },
                  { mode: "harder",   label: "💪 Harder" },
                  { mode: "easier",   label: "🎯 Easier" },
                ].map(({ mode, label }) => (
                  <button
                    key={mode}
                    type="button"
                    disabled={regenerating === i}
                    onClick={() => handleRegenerate(i, mode)}
                    className="rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] text-white/60 transition hover:border-indigo-400/30 hover:bg-indigo-500/10 hover:text-indigo-300 disabled:opacity-40"
                  >
                    {regenerating === i ? "…" : label}
                  </button>
                ))}
              </div>
            </div>
          ))}

          {/* Bottom import button */}
          <div className="flex justify-end pt-2">
            <GlowButton onClick={handleImport} disabled={importing || selected.size === 0}>
              {importing ? "Importing…" : `Import ${selected.size} Question${selected.size !== 1 ? "s" : ""} into Exam`}
            </GlowButton>
          </div>
        </div>
      )}
    </div>
  );
}

/* ============================================================ */
/* Geofence / Location Boundary Tab                             */
/* ============================================================ */

function GeofenceTab({
  examId, exam, pushToast, onSaved,
}: {
  examId: string;
  exam: Exam;
  pushToast: (type: "success" | "error" | "info", msg: string) => void;
  onSaved: () => void;
}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const examAny = exam as any;
  const [enabled, setEnabled] = useState<boolean>(examAny.geofenceEnabled ?? false);

  // Seed zones from the new geofenceZones JSON column or fall back to the
  // legacy single-zone columns so old exams keep working.
  const seedZones: GeofenceZone[] = (() => {
    if (Array.isArray(examAny.geofenceZones) && examAny.geofenceZones.length > 0) {
      return examAny.geofenceZones.map((z: GeofenceData & { name?: string }, i: number) => ({
        id: `seed-${i}`,
        name: z.name,
        lat: z.lat,
        lng: z.lng,
        radius: z.radius ?? 30,
      }));
    }
    if (examAny.geofenceLat != null) {
      return [{
        id: "seed-0",
        name: "Zone 1",
        lat: examAny.geofenceLat,
        lng: examAny.geofenceLng,
        radius: examAny.geofenceRadius ?? 30,
      }];
    }
    return [];
  })();

  const [zones, setZones] = useState<GeofenceZone[]>(seedZones);
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (enabled && zones.length === 0) {
      pushToast("error", "Please drop at least one pin on the map before saving.");
      return;
    }
    setSaving(true);
    try {
      const cleanZones = zones.map((z, i) => ({
        name: z.name?.trim() || `Zone ${i + 1}`,
        lat: z.lat,
        lng: z.lng,
        radius: z.radius,
      }));
      await api.put(`/exams/${examId}/geofence`, {
        geofenceEnabled: enabled,
        zones: cleanZones,
      });
      pushToast(
        "success",
        `Saved ${cleanZones.length} location boundar${cleanZones.length === 1 ? "y" : "ies"}.`
      );
      onSaved();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (e: any) {
      pushToast("error", e.response?.data?.error?.message || "Save failed");
    } finally {
      setSaving(false);
    }
  }

  const savedZoneCount = Array.isArray(examAny.geofenceZones)
    ? examAny.geofenceZones.length
    : (examAny.geofenceLat != null ? 1 : 0);

  return (
    <div className="space-y-6">
      {/* Header card */}
      <GlowCard
        title="Set Location / Venue Boundary"
        description="Restrict exam access to students who are physically within one of the configured location boundaries. Add multiple zones if the exam is held in different buildings or venues."
      >
        <div className="space-y-4">
          {/* Enable toggle */}
          <div className="flex items-start justify-between gap-3 rounded-lg border border-white/5 bg-white/[0.02] p-3">
            <div>
              <p className="text-sm font-medium text-white">Enable geofencing for this exam</p>
              <p className="mt-0.5 text-xs text-white/40">
                When on, students must be inside <strong>any one</strong> of the configured zones
                to start or continue the exam.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setEnabled((v) => !v)}
              className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
                enabled ? "bg-gradient-to-r from-indigo-500 to-purple-500" : "bg-white/10"
              }`}
            >
              <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${enabled ? "translate-x-5" : "translate-x-0.5"}`} />
            </button>
          </div>

          {/* Status badge */}
          {examAny.geofenceEnabled && savedZoneCount > 0 && (
            <div className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">
              <span className="h-2 w-2 rounded-full bg-emerald-400" />
              Geofence active · {savedZoneCount} zone{savedZoneCount === 1 ? "" : "s"} configured
            </div>
          )}
        </div>
      </GlowCard>

      {/* Map */}
      <GlowCard
        title="Map — Drop Pins & Draw Boundaries"
        description="Search for a location, click the map to drop a pin, drag the coloured handle to resize. Use “Add another zone” for additional buildings."
      >
        <GeofenceMap
          initialZones={seedZones}
          onZonesChange={setZones}
        />
      </GlowCard>

      {/* Save */}
      <div className="flex justify-end">
        <GlowButton onClick={handleSave} disabled={saving}>
          {saving ? "Saving…" : `Save ${zones.length} location boundar${zones.length === 1 ? "y" : "ies"}`}
        </GlowButton>
      </div>
    </div>
  );
}

/* ============================================================ */
/* Preview Tab                                                  */
/* ============================================================ */

function renderInstructions(raw: string) {
  const lines = raw.split("\n").filter((l) => l.trim());
  const isNumbered = (l: string) => /^\d+[.)]\s/.test(l.trim());
  const isBullet = (l: string) => /^[•\-\*]\s/.test(l.trim());

  return lines.map((line, i) => {
    const text = line.replace(/^(\d+[.)]\s|[•\-\*]\s)/, "").trim();
    if (isNumbered(line)) {
      const num = line.trim().match(/^(\d+)/)?.[1];
      return (
        <div key={i} className="flex gap-2 text-sm text-white/70">
          <span className="shrink-0 font-semibold text-white/40">{num}.</span>
          <span>{text}</span>
        </div>
      );
    }
    if (isBullet(line)) {
      return (
        <div key={i} className="flex gap-2 text-sm text-white/70">
          <span className="shrink-0 text-indigo-400">•</span>
          <span>{text}</span>
        </div>
      );
    }
    return <p key={i} className="text-sm text-white/70">{line}</p>;
  });
}

/* ============================================================ */
/* Flagged Questions (student-submitted reports) Tab            */
/* ============================================================ */

interface ReportRecord {
  id: string;
  questionId: string;
  examId: string;
  sessionId: string | null;
  studentId: string;
  reason: "TYPO" | "WRONG_ANSWER" | "UNCLEAR" | "OTHER";
  message: string | null;
  resolved: boolean;
  createdAt: string;
  question: { id: string; text: string; order: number } | null;
  student: {
    id: string; firstName: string; lastName: string;
    email: string; studentId: string | null;
  } | null;
}

const REASON_LABEL: Record<ReportRecord["reason"], string> = {
  TYPO: "Typo / spelling",
  WRONG_ANSWER: "Wrong correct answer",
  UNCLEAR: "Unclear wording",
  OTHER: "Other",
};
const REASON_TONE: Record<ReportRecord["reason"], string> = {
  TYPO: "border-blue-500/30 bg-blue-500/10 text-blue-200",
  WRONG_ANSWER: "border-rose-500/30 bg-rose-500/10 text-rose-200",
  UNCLEAR: "border-amber-500/30 bg-amber-500/10 text-amber-200",
  OTHER: "border-white/15 bg-white/5 text-white/70",
};

function ReportsTab({
  examId,
  questions,
  pushToast,
}: {
  examId: string;
  questions: Question[];
  pushToast: (type: "success" | "error" | "info", message: string) => void;
}) {
  const [reports, setReports] = useState<ReportRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "open" | "resolved">("open");
  const [questionFilter, setQuestionFilter] = useState<string>("");

  async function load() {
    setLoading(true);
    try {
      const { data } = await api.get(`/questions/exam/${examId}/reports`);
      setReports(data.data || []);
    } catch (e: any) {
      pushToast("error", e.response?.data?.error?.message || "Failed to load reports");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [examId]);

  const visible = reports.filter((r) => {
    if (filter === "open" && r.resolved) return false;
    if (filter === "resolved" && !r.resolved) return false;
    if (questionFilter && r.questionId !== questionFilter) return false;
    return true;
  });

  const openCount = reports.filter((r) => !r.resolved).length;

  // Counts per question (open reports only) — to surface most-flagged questions
  const perQuestion = new Map<string, number>();
  reports.forEach((r) => {
    if (r.resolved) return;
    perQuestion.set(r.questionId, (perQuestion.get(r.questionId) || 0) + 1);
  });
  const topFlagged = [...perQuestion.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([qid, count]) => {
      const q = questions.find((qq) => qq.id === qid);
      return { qid, count, question: q };
    });

  async function setResolved(id: string, resolved: boolean) {
    // optimistic update
    const prev = reports;
    setReports((rs) => rs.map((r) => (r.id === id ? { ...r, resolved } : r)));
    try {
      // Endpoint not strictly needed (no UI uses resolved=true field yet on server),
      // but we expose toggle locally so examiners can mark as triaged. We also POST
      // an idempotent server toggle if available; otherwise fall back to local only.
      await api.patch(`/questions/reports/${id}`, { resolved }).catch(() => {});
    } catch {
      setReports(prev);
      pushToast("error", "Failed to update status");
    }
  }

  function exportCSV() {
    if (reports.length === 0) return;
    const headers = ["Created At", "Question #", "Question text", "Reason", "Status", "Student", "Email", "Student ID", "Message"];
    const rows = reports.map((r) => [
      new Date(r.createdAt).toLocaleString(),
      r.question?.order != null ? `Q${r.question.order + 1}` : "—",
      (r.question?.text || "").replace(/<[^>]+>/g, ""),
      REASON_LABEL[r.reason],
      r.resolved ? "Resolved" : "Open",
      r.student ? `${r.student.firstName} ${r.student.lastName}` : "—",
      r.student?.email || "",
      r.student?.studentId || "",
      r.message || "",
    ]);
    const esc = (v: string | number) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const csv = [headers, ...rows].map((row) => row.map(esc).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `question_reports_${examId}.csv`; a.click(); URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4">
      {/* Header / summary */}
      <GlowCard
        title="Student-flagged questions"
        description="Questions your students believe contain a mistake. Review each report and decide whether to fix or close it."
        action={
          <div className="flex items-center gap-2">
            <button onClick={load} className="rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-white/70 transition hover:bg-white/10">
              Refresh
            </button>
            <button onClick={exportCSV} disabled={reports.length === 0} className="rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-white/70 transition hover:bg-white/10 disabled:opacity-40">
              Download CSV
            </button>
          </div>
        }
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <SummaryStat
            label="Open reports"
            value={openCount}
            tone={openCount > 0 ? "rose" : "neutral"}
          />
          <SummaryStat
            label="Total reports"
            value={reports.length}
            tone="neutral"
          />
          <SummaryStat
            label="Questions flagged"
            value={perQuestion.size}
            tone={perQuestion.size > 0 ? "amber" : "neutral"}
          />
        </div>

        {topFlagged.length > 0 && (
          <div className="mt-5">
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-white/40">
              Most flagged
            </p>
            <ul className="space-y-1.5">
              {topFlagged.map(({ qid, count, question }) => (
                <li key={qid}>
                  <button
                    onClick={() => setQuestionFilter(qid)}
                    className={`flex w-full items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left text-xs transition hover:bg-white/5 ${
                      questionFilter === qid ? "border-indigo-400/50 bg-indigo-500/10" : "border-white/5 bg-white/[0.02]"
                    }`}
                  >
                    <span className="min-w-0 flex-1 truncate text-white/80">
                      <span className="font-mono text-white/40 mr-2">
                        Q{(question?.order ?? 0) + 1}
                      </span>
                      <span dangerouslySetInnerHTML={{ __html: (question?.text || "Deleted question").slice(0, 200) }} />
                    </span>
                    <span className="shrink-0 rounded-full border border-rose-500/30 bg-rose-500/15 px-2 py-0.5 text-[10px] font-bold text-rose-300">
                      {count} open
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </GlowCard>

      {/* Filters */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-white/5 bg-white/[0.02] p-3">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-white/40">
            Show
          </span>
          {(["open", "all", "resolved"] as const).map((f) => {
            const active = filter === f;
            return (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`rounded-md border px-3 py-1 text-xs font-medium transition ${
                  active ? "border-indigo-400/50 bg-indigo-500/15 text-indigo-200" : "border-white/10 bg-white/5 text-white/60 hover:bg-white/10"
                }`}
              >
                {f === "open" ? "Open only" : f === "all" ? "All" : "Resolved"}
              </button>
            );
          })}
        </div>
        {questionFilter && (
          <button
            onClick={() => setQuestionFilter("")}
            className="rounded-md border border-white/10 bg-white/5 px-3 py-1 text-xs text-white/60 hover:bg-white/10"
          >
            Clear question filter ×
          </button>
        )}
      </div>

      {/* List */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <svg className="h-8 w-8 animate-spin text-indigo-400" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25" />
            <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
          </svg>
        </div>
      ) : visible.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-white/10 py-20 text-center">
          <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-300 ring-1 ring-emerald-500/30">
            <Icon d="M9 12l2 2 4-4M21 12a9 9 0 11-18 0 9 9 0 0118 0z" size={28} />
          </div>
          <p className="text-sm text-white/60">
            {filter === "resolved"
              ? "No resolved reports yet."
              : filter === "all"
                ? "No reports submitted for this exam."
                : "No open reports — every flagged question has been addressed."}
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {visible.map((r) => (
            <li key={r.id} className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1 space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${REASON_TONE[r.reason]}`}>
                      {REASON_LABEL[r.reason]}
                    </span>
                    <span className="rounded-md border border-white/10 bg-white/5 px-1.5 py-0.5 font-mono text-[10px] text-white/60">
                      {r.question?.order != null ? `Q${r.question.order + 1}` : "—"}
                    </span>
                    {r.resolved && (
                      <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-300">
                        Resolved
                      </span>
                    )}
                    <span className="text-[10px] text-white/30">
                      {new Date(r.createdAt).toLocaleString()}
                    </span>
                  </div>

                  <div className="text-xs text-white/70">
                    <span className="text-white/40">From: </span>
                    <span className="font-semibold text-white">
                      {r.student ? `${r.student.firstName} ${r.student.lastName}` : "Unknown student"}
                    </span>
                    {r.student?.studentId && (
                      <span className="text-white/30"> · {r.student.studentId}</span>
                    )}
                    {r.student?.email && (
                      <span className="text-white/30"> · {r.student.email}</span>
                    )}
                  </div>

                  {r.question?.text && (
                    <div className="rounded-md border border-white/5 bg-slate-950/40 p-2.5">
                      <p className="mb-0.5 text-[9px] font-semibold uppercase tracking-wider text-white/30">
                        Question text
                      </p>
                      <div
                        className="qe-prose text-xs text-white/80"
                        dangerouslySetInnerHTML={{ __html: r.question.text }}
                      />
                    </div>
                  )}

                  {r.message && (
                    <div className="rounded-md border border-amber-500/20 bg-amber-500/5 p-2.5">
                      <p className="mb-0.5 text-[9px] font-semibold uppercase tracking-wider text-amber-300/80">
                        Student note
                      </p>
                      <p className="whitespace-pre-wrap text-xs text-amber-100/90">{r.message}</p>
                    </div>
                  )}
                </div>

                <div className="flex shrink-0 flex-col gap-2 sm:items-end">
                  <Link
                    href={`/examiner/exams/${examId}?tab=questions#q-${r.questionId}`}
                    className="inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-[11px] font-medium text-white/70 hover:bg-white/10"
                  >
                    <Icon d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" size={12} />
                    Edit question
                  </Link>
                  {r.resolved ? (
                    <button
                      onClick={() => setResolved(r.id, false)}
                      className="inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-[11px] font-medium text-white/70 hover:bg-white/10"
                    >
                      Reopen
                    </button>
                  ) : (
                    <button
                      onClick={() => setResolved(r.id, true)}
                      className="inline-flex items-center gap-1.5 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-[11px] font-semibold text-emerald-200 hover:bg-emerald-500/15"
                    >
                      <Icon d="M5 13l4 4L19 7" size={12} />
                      Mark resolved
                    </button>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SummaryStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "rose" | "amber" | "neutral";
}) {
  const t =
    tone === "rose"
      ? "border-rose-500/30 bg-rose-500/10 text-rose-200"
      : tone === "amber"
        ? "border-amber-500/30 bg-amber-500/10 text-amber-200"
        : "border-white/10 bg-white/[0.02] text-white";
  return (
    <div className={`rounded-xl border p-4 ${t}`}>
      <p className="text-[10px] font-semibold uppercase tracking-wider opacity-70">{label}</p>
      <p className="mt-1 text-2xl font-extrabold tabular-nums">{value}</p>
    </div>
  );
}

function PreviewTab({ exam, questions }: { exam: Exam; questions: Question[] }) {
  const examTypeLabel = exam.examType === "OTHER" && exam.examTypeOther
    ? exam.examTypeOther
    : (exam.examType === "END_OF_SEMESTER" ? "End of Semester" : (exam.examType || "Quiz").charAt(0).toUpperCase() + (exam.examType || "quiz").slice(1).toLowerCase());

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-indigo-400/20 bg-indigo-500/5 p-4 text-xs text-indigo-200">
        Student preview — this is what students see when taking the exam. Answers are not collected here.
      </div>

      <GlowCard>
        <div className="mb-5 border-b border-white/5 pb-4">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="font-mono text-indigo-300">{exam.courseCode} · {exam.courseName}</span>
            <span className="rounded-full border border-white/10 px-2 py-0.5 text-white/40">{examTypeLabel}</span>
          </div>
          <h2 className="mt-1 text-xl font-bold text-white">{exam.title}</h2>
          {exam.description && <p className="mt-2 text-sm text-white/60">{exam.description}</p>}

          {exam.instructions && (
            <div className="mt-3 rounded-lg border border-white/10 bg-white/[0.02] p-4">
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-white/40">Instructions</p>
              <div className="space-y-1.5">{renderInstructions(exam.instructions)}</div>
            </div>
          )}

          {exam.examPassword && (
            <div className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">
              This exam requires a password to begin.
            </div>
          )}

          <p className="mt-3 text-xs text-white/40">
            {exam.durationMinutes} minutes · {questions.length} questions · {exam.totalMarks} points
          </p>
        </div>

        {questions.length === 0 ? (
          <p className="py-12 text-center text-sm text-white/40">No questions to preview yet.</p>
        ) : (
          <div className="space-y-6">
            {questions.map((q, i) => {
              const fibType = (q as any).fillInBlankType;
              return (
                <div key={q.id} className="border-b border-white/5 pb-6 last:border-0 last:pb-0">
                  <div className="mb-2 flex items-center justify-between text-xs">
                    <span className="font-bold text-white">Question {i + 1}</span>
                    <span className="text-white/40">{q.marks} pt{q.marks !== 1 ? "s" : ""}</span>
                  </div>
                  {q.text && q.text !== "[block-based question]" && (
                    q.type === "MULTI_BLANK_EQUATION" ? (
                      <p className="mb-3 text-sm text-white">{q.text}</p>
                    ) : (
                      <div
                        className="qe-prose mb-3 text-sm text-white"
                        dangerouslySetInnerHTML={{ __html: q.text }}
                      />
                    )
                  )}

                  {Array.isArray(q.blocks) && q.blocks.length > 0 && (
                    <div className="mb-3 space-y-2">
                      <BlockList blocks={q.blocks} />
                    </div>
                  )}

                  {q.type === "MCQ" && Array.isArray(q.options) && (
                    <div className="space-y-2">
                      {(q.options as string[]).map((opt, idx) => (
                        <label key={idx} className="flex cursor-not-allowed items-center gap-2 rounded-md border border-white/5 bg-white/[0.02] p-2.5 text-sm text-white/70">
                          <input type="radio" disabled className="accent-indigo-500" />
                          <span>{opt}</span>
                        </label>
                      ))}
                    </div>
                  )}
                  {q.type === "TRUE_FALSE" && (
                    <div className="flex gap-2">
                      {["True", "False"].map((v) => (
                        <label key={v} className="flex flex-1 cursor-not-allowed items-center gap-2 rounded-md border border-white/5 bg-white/[0.02] p-2.5 text-sm text-white/70">
                          <input type="radio" disabled className="accent-indigo-500" />
                          <span>{v}</span>
                        </label>
                      ))}
                    </div>
                  )}
                  {q.type === "FILL_IN_BLANK" && (
                    fibType === "dropdown" && Array.isArray(q.options) ? (
                      <select disabled className="auth-input h-11 w-full rounded-lg px-3 text-sm opacity-60">
                        <option value="">Select an answer…</option>
                        {(q.options as string[]).map((opt, idx) => (
                          <option key={idx} value={opt}>{opt}</option>
                        ))}
                      </select>
                    ) : (
                      <input disabled placeholder="Your answer..." className="auth-input h-11 w-full rounded-lg px-3 text-sm" />
                    )
                  )}
                  {q.type === "MULTI_BLANK_EQUATION" && (
                    <div className="space-y-2">
                      <pre className="rounded-lg bg-white/[0.02] p-3 text-xs text-white/70">{q.text}</pre>
                      <p className="text-xs text-white/40">
                        Student fills in {Array.isArray(q.correctAnswer) ? (q.correctAnswer as string[]).length : 0} blank(s).
                      </p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </GlowCard>
    </div>
  );
}
