"use client";

import { useEffect, useMemo, useState } from "react";
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
import type { Exam, ExamType, Question, QuestionType } from "@/types";

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

  const { updateExam, publishExam, deleteExam } = useExamStore();

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

/* ============================================================ */
/* Questions Tab                                                */
/* ============================================================ */

interface QuestionsTabProps {
  examId: string;
  examStatus: string;
  questions: Question[];
  onChange: () => Promise<void>;
  pushToast: (type: Toast["type"], message: string) => void;
}

function QuestionsTab({ examId, examStatus, questions, onChange, pushToast }: QuestionsTabProps) {
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
      await addQuestion(examId, payload);
      setNewQuestionType(null);
      pushToast("success", "Question added");
      await onChange();
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
      await updateQuestion(qid, payload);
      setEditingId(null);
      pushToast("success", "Question updated");
      await onChange();
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
      pushToast("success", "Question deleted");
      await onChange();
    } catch (e: any) {
      pushToast("error", e.response?.data?.error?.message || "Delete failed");
    } finally {
      setBusy(false);
    }
  }

  async function handleDuplicate(q: Question) {
    setBusy(true);
    try {
      await addQuestion(examId, {
        type: q.type,
        text: q.text + " (copy)",
        options: q.options,
        correctAnswer: q.correctAnswer,
        marks: q.marks,
      });
      pushToast("success", "Question duplicated");
      await onChange();
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
          <p className="text-sm text-white">{question.text}</p>

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
    });
    setSaving(false);
  }

  return (
    <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <GlowCard title="Timing & Scheduling" description="When and for how long the exam runs. You can change these at any time.">
        <div className="space-y-4">
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
        <div className="mt-5 flex items-center justify-end gap-2 border-t border-white/5 pt-4">
          <GlowButton type="submit" size="sm" disabled={saving}>
            {saving ? "Saving..." : "Save settings"}
          </GlowButton>
        </div>
      </GlowCard>
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
                  <p className="mb-3 text-sm text-white">{q.text}</p>

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
