"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import api from "@/lib/api";
import { connectSocket, disconnectSocket } from "@/lib/socket";
import { useAntiCheat } from "@/hooks/useAntiCheat";
import type { Question } from "@/types";

const Icon = ({ d, size = 16 }: { d: string; size?: number }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
);

/* ─── Phase machine ────────────────────────────── */
type Phase = "loading-exam" | "password" | "ready" | "session-starting" | "taking" | "submitted";

export default function ExamTakingPage() {
  const params = useParams();
  const router = useRouter();
  const examId = params.examId as string;

  /* ── data ─── */
  const [phase, setPhase] = useState<Phase>("loading-exam");
  const [exam, setExam] = useState<any>(null);
  const [session, setSession] = useState<any>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [attemptInfo, setAttemptInfo] = useState<{ attemptNumber: number; attemptsUsed: number; maxAttempts: number } | null>(null);

  /* ── UI state ─── */
  const [currentIndex, setCurrentIndex] = useState(0);
  const [timeLeft, setTimeLeft] = useState(0);
  const [showTimer, setShowTimer] = useState(true);
  const [showMap, setShowMap] = useState(true);
  const [password, setPassword] = useState("");
  const [pwError, setPwError] = useState("");
  const [startError, setStartError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showSubmitModal, setShowSubmitModal] = useState(false);
  const [result, setResult] = useState<{ score: number; maxScore: number; percentage: number } | null>(null);

  /* ── fullscreen ─── */
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [fsWarning, setFsWarning] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  /* ── autosave ─── */
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const answersRef = useRef(answers);
  useEffect(() => { answersRef.current = answers; }, [answers]);

  const sessionId = session?.id || "";
  const allowBacktrack = exam?.allowBacktrack !== false;
  const timeCritical = timeLeft > 0 && timeLeft <= 60;
  const timeWarning = timeLeft > 0 && timeLeft <= 300 && !timeCritical;

  useAntiCheat({ sessionId, enabled: phase === "taking" });

  /* ─── Phase 1: load exam info ─────────────────── */
  useEffect(() => {
    let cancelled = false;
    api.get(`/exams/${examId}`)
      .then(({ data }) => {
        if (cancelled) return;
        setExam(data.data);
        setQuestions(data.data.questions || []);
        setPhase(data.data.examPassword ? "password" : "ready");
      })
      .catch(() => { router.replace("/student"); });
    return () => { cancelled = true; };
  }, [examId, router]);

  /* ─── Phase 2: start session ──────────────────── */
  async function handleStartExam() {
    setStartError("");
    setPhase("session-starting");
    try {
      const { data } = await api.post("/sessions/start", {
        examId,
        password: exam?.examPassword ? password : undefined,
      });
      setSession(data.data.session);
      setAttemptInfo({
        attemptNumber: data.data.attemptNumber,
        attemptsUsed: data.data.attemptsUsed,
        maxAttempts: data.data.maxAttempts,
      });
      if (data.data.recoveredAnswers) setAnswers(data.data.recoveredAnswers);
      setTimeLeft(exam.durationMinutes * 60);

      const socket = connectSocket();
      socket.emit("join:exam", { sessionId: data.data.session.id, examId });

      // Auto-save via socket
      socket.on("answer:saved", ({ success }: { success: boolean }) => {
        setIsSaving(false);
        if (success) setLastSaved(new Date());
      });

      setPhase("taking");
      enterFullscreen();
    } catch (err: any) {
      const msg = err.response?.data?.error?.message || "Failed to start exam";
      setStartError(msg);
      setPhase(exam?.examPassword ? "password" : "ready");
    }
  }

  /* ─── Password submit ─────────────────────────── */
  function handlePasswordSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!password.trim()) { setPwError("Please enter the exam password"); return; }
    setPwError("");
    handleStartExam();
  }

  /* ─── Fullscreen ──────────────────────────────── */
  function enterFullscreen() {
    const el = containerRef.current || document.documentElement;
    el.requestFullscreen?.().catch(() => {});
  }

  useEffect(() => {
    function onChange() {
      const fs = !!document.fullscreenElement;
      setIsFullscreen(fs);
      if (!fs && phase === "taking") setFsWarning(true);
    }
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, [phase]);

  /* ─── Timer ───────────────────────────────────── */
  useEffect(() => {
    if (phase !== "taking" || timeLeft <= 0 || !session) return;
    const t = setInterval(() => {
      setTimeLeft((s) => {
        if (s <= 1) { handleSubmit(true); return 0; }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(t);
  });

  // Auto-show timer when critical
  useEffect(() => {
    if (timeCritical) setShowTimer(true);
  }, [timeCritical]);

  /* ─── Periodic autosave ───────────────────────── */
  useEffect(() => {
    if (phase !== "taking" || !sessionId) return;
    const socket = connectSocket();
    const t = setInterval(() => {
      setIsSaving(true);
      socket.emit("answer:save", { sessionId, answers: answersRef.current });
    }, 15000);
    return () => clearInterval(t);
  }, [phase, sessionId]);

  /* ─── Immediate save helper ───────────────────── */
  async function saveNow() {
    if (!sessionId) return;
    try {
      setIsSaving(true);
      await api.post(`/sessions/${sessionId}/autosave`, { answers: answersRef.current });
      setLastSaved(new Date());
    } catch {} finally { setIsSaving(false); }
  }

  /* ─── Submit ──────────────────────────────────── */
  const handleSubmit = useCallback(async (auto = false) => {
    if (isSubmitting || !sessionId) return;
    setIsSubmitting(true);
    try {
      const answerList = Object.entries(answersRef.current).map(([questionId, answer]) => ({ questionId, answer }));
      const { data } = await api.post(`/sessions/${sessionId}/submit`, { answers: answerList });
      connectSocket().emit("exam:submit", { sessionId });
      setShowSubmitModal(false);
      setResult({ score: data.data.score, maxScore: data.data.maxScore, percentage: data.data.percentage });
      setPhase("submitted");
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      if (auto) setTimeout(() => router.push("/student"), 4000);
    } catch (err: any) {
      alert(err.response?.data?.error?.message || "Submission failed");
    } finally {
      setIsSubmitting(false);
    }
  }, [isSubmitting, sessionId, router]);

  /* ─── Answer + navigation ─────────────────────── */
  function setAnswer(questionId: string, value: unknown) {
    setAnswers((prev) => ({ ...prev, [questionId]: value }));
  }

  async function handleNext() {
    await saveNow();
    setCurrentIndex((i) => Math.min(questions.length - 1, i + 1));
  }

  function handlePrev() {
    setCurrentIndex((i) => Math.max(0, i - 1));
  }

  /* ─── Derived ─────────────────────────────────── */
  const q = questions[currentIndex];
  const answered = useMemo(() =>
    questions.filter((qq) => answers[qq.id] !== undefined && answers[qq.id] !== "").length,
    [questions, answers]);
  const unanswered = questions.length - answered;

  function formatTime(s: number) {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    const p = (n: number) => n.toString().padStart(2, "0");
    return h > 0 ? `${p(h)}:${p(m)}:${p(sec)}` : `${p(m)}:${p(sec)}`;
  }

  /* ═══════════════════════════════════════════════ */
  /* RENDER PHASES                                   */
  /* ═══════════════════════════════════════════════ */

  /* Loading */
  if (phase === "loading-exam") {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-950">
        <div className="space-y-4 text-center">
          <div className="mx-auto h-10 w-10 animate-spin rounded-full border-2 border-indigo-400 border-t-transparent" />
          <p className="text-sm text-white/60">Loading exam…</p>
        </div>
      </div>
    );
  }

  /* Password screen */
  if (phase === "password" || (phase === "session-starting" && exam?.examPassword)) {
    return (
      <div className="flex h-screen items-center justify-center bg-gradient-to-br from-slate-950 via-slate-950 to-indigo-950/20 p-4">
        <div className="w-full max-w-sm">
          <div className="rounded-2xl border border-white/10 bg-slate-900/80 p-8 backdrop-blur-xl shadow-2xl">
            <div className="mb-6 flex h-14 w-14 items-center justify-center rounded-full bg-indigo-500/15 ring-1 ring-indigo-500/30">
              <Icon d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" size={26} />
            </div>
            <h2 className="text-xl font-bold text-white">{exam?.title}</h2>
            <p className="mt-1 text-sm text-white/50">{exam?.courseCode} · {exam?.durationMinutes} min</p>
            <p className="mt-4 text-xs text-white/40">This exam is password-protected. Enter the password provided by your examiner to begin.</p>
            <form onSubmit={handlePasswordSubmit} className="mt-5 space-y-3">
              <input
                type="password"
                className="auth-input h-12 w-full rounded-xl px-4 text-sm tracking-widest"
                placeholder="Exam password…"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoFocus
              />
              {(pwError || startError) && (
                <p className="text-xs text-rose-400">{pwError || startError}</p>
              )}
              <button
                type="submit"
                disabled={phase === "session-starting"}
                className="w-full rounded-xl bg-gradient-to-r from-indigo-500 to-purple-500 py-3 text-sm font-semibold text-white transition hover:shadow-lg hover:shadow-purple-500/30 disabled:opacity-60"
              >
                {phase === "session-starting" ? "Starting…" : "Start Exam"}
              </button>
            </form>
          </div>
        </div>
      </div>
    );
  }

  /* Ready (no password) */
  if (phase === "ready" || (phase === "session-starting" && !exam?.examPassword)) {
    return (
      <div className="flex h-screen items-center justify-center bg-gradient-to-br from-slate-950 via-slate-950 to-indigo-950/20 p-4">
        <div className="w-full max-w-sm text-center">
          <div className="rounded-2xl border border-white/10 bg-slate-900/80 p-8 backdrop-blur-xl shadow-2xl space-y-4">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-indigo-500/15 ring-1 ring-indigo-500/30">
              <Icon d="M9 12h6M9 16h6M9 8h6M5 3h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2z" size={26} />
            </div>
            <div>
              <h2 className="text-xl font-bold text-white">{exam?.title}</h2>
              <p className="mt-1 text-sm text-white/50">{exam?.courseCode}</p>
            </div>
            <div className="rounded-xl border border-white/5 bg-white/[0.02] p-4 text-left space-y-2 text-xs">
              <InfoRow label="Duration" value={`${exam?.durationMinutes} minutes`} />
              <InfoRow label="Questions" value={questions.length} />
              <InfoRow label="Total Marks" value={exam?.totalMarks} />
              <InfoRow label="Max Attempts" value={exam?.maxAttempts ?? 1} />
              {exam?.instructions && <InfoRow label="Instructions" value={exam.instructions} />}
            </div>
            {startError && <p className="text-xs text-rose-400">{startError}</p>}
            <button
              onClick={handleStartExam}
              disabled={phase === "session-starting"}
              className="w-full rounded-xl bg-gradient-to-r from-indigo-500 to-purple-500 py-3 text-sm font-semibold text-white transition hover:shadow-lg hover:shadow-purple-500/30 disabled:opacity-60"
            >
              {phase === "session-starting" ? "Starting exam…" : "Start Exam →"}
            </button>
            <p className="text-[10px] text-white/25">The exam will open in full-screen mode. You cannot pause once started.</p>
          </div>
        </div>
      </div>
    );
  }

  /* Result screen */
  if (phase === "submitted" && result) {
    const pct = Number(result.percentage);
    const pass = pct >= 50;
    const canRetake = attemptInfo && attemptInfo.attemptsUsed < attemptInfo.maxAttempts - 1;
    return (
      <div className="flex h-screen items-center justify-center bg-slate-950 p-4">
        <div className="w-full max-w-md rounded-2xl border border-white/10 bg-slate-900/95 p-8 text-center shadow-2xl space-y-5">
          <div className={`mx-auto flex h-16 w-16 items-center justify-center rounded-full ${pass ? "bg-emerald-500/15 text-emerald-300" : "bg-amber-500/15 text-amber-300"}`}>
            <Icon d={pass ? "M9 12l2 2 4-4M21 12a9 9 0 11-18 0 9 9 0 0118 0z" : "M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"} size={32} />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-white">Exam Submitted</h2>
            {attemptInfo && (
              <p className="mt-1 text-xs text-white/40">
                Attempt {attemptInfo.attemptNumber} of {attemptInfo.maxAttempts}
              </p>
            )}
          </div>
          {exam?.showScoreToStudents !== false ? (
            <div className="rounded-xl border border-white/10 bg-white/[0.02] p-5">
              <p className="text-xs uppercase tracking-wider text-white/40">Your score</p>
              <p className="mt-1 text-4xl font-extrabold text-white">
                {result.score}<span className="text-xl text-white/40"> / {result.maxScore}</span>
              </p>
              <p className={`mt-1 text-sm font-semibold ${pass ? "text-emerald-300" : "text-amber-300"}`}>{pct}%</p>
            </div>
          ) : (
            <div className="rounded-xl border border-white/10 bg-white/[0.02] p-5 text-sm text-white/50">
              Your examiner has not enabled score visibility.
            </div>
          )}
          <div className="flex gap-3">
            <button onClick={() => router.push("/student")} className="flex-1 rounded-xl border border-white/10 bg-white/5 py-2.5 text-sm text-white/70 transition hover:bg-white/10">
              Dashboard
            </button>
            {canRetake && (
              <button
                onClick={() => {
                  setPhase(exam?.examPassword ? "password" : "ready");
                  setResult(null);
                  setSession(null);
                  setAnswers({});
                  setCurrentIndex(0);
                  disconnectSocket();
                }}
                className="flex-1 rounded-xl bg-gradient-to-r from-indigo-500 to-purple-500 py-2.5 text-sm font-semibold text-white transition hover:shadow-lg"
              >
                Retake Exam
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  /* ═══════════════════════════════════════════════ */
  /* EXAM TAKING                                     */
  /* ═══════════════════════════════════════════════ */
  return (
    <div ref={containerRef} className="flex h-screen flex-col bg-gradient-to-br from-slate-950 via-slate-950 to-indigo-950/20 overflow-hidden">

      {/* ── Fullscreen warning overlay ────────────── */}
      {fsWarning && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/95 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl border border-rose-500/30 bg-slate-900 p-8 text-center shadow-2xl space-y-4">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-rose-500/15 ring-1 ring-rose-500/30">
              <Icon d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" size={28} />
            </div>
            <h2 className="text-lg font-bold text-rose-300">Fullscreen Exited</h2>
            <p className="text-sm text-white/60">
              Your exit was recorded. Return to fullscreen to continue your exam.
            </p>
            <button
              onClick={() => { enterFullscreen(); setFsWarning(false); }}
              className="w-full rounded-xl bg-rose-600 py-3 text-sm font-bold text-white transition hover:bg-rose-500"
            >
              Return to Fullscreen
            </button>
          </div>
        </div>
      )}

      {/* ── Header ───────────────────────────────── */}
      <header className="shrink-0 border-b border-white/10 bg-slate-950/80 backdrop-blur-xl">
        <div className="flex items-center gap-3 px-4 py-2.5">
          {/* Exam info */}
          <div className="min-w-0 flex-1">
            <p className="font-mono text-[10px] text-indigo-300">{exam?.courseCode}</p>
            <h1 className="truncate text-sm font-semibold text-white leading-tight">{exam?.title}</h1>
          </div>

          {/* Attempt badge */}
          {attemptInfo && (
            <span className="hidden shrink-0 rounded border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] text-white/40 sm:block">
              Attempt {attemptInfo.attemptNumber}/{attemptInfo.maxAttempts}
            </span>
          )}

          {/* Timer (visible when showTimer or critical) */}
          {(showTimer || timeCritical) && (
            <div className={`flex items-center gap-2 rounded-xl border px-3 py-1.5 transition-all ${
              timeCritical
                ? "border-rose-500/60 bg-rose-500/20 text-rose-200 shadow-lg shadow-rose-500/20"
                : timeWarning
                  ? "border-amber-500/50 bg-amber-500/15 text-amber-200"
                  : "border-white/15 bg-white/5 text-white"
            }`}>
              {(timeCritical || timeWarning) && (
                <span className={`h-2 w-2 rounded-full ${timeCritical ? "bg-rose-400 animate-ping" : "bg-amber-400"}`} />
              )}
              <span className={`font-mono text-base font-bold tabular-nums ${timeCritical ? "animate-pulse" : ""}`}>
                {formatTime(timeLeft)}
              </span>
            </div>
          )}

          {/* Toggle buttons */}
          <button
            onClick={() => setShowTimer((v) => !v)}
            title={showTimer ? "Hide timer" : "Show timer"}
            className={`flex h-8 w-8 items-center justify-center rounded-lg border transition ${showTimer ? "border-indigo-400/40 bg-indigo-500/15 text-indigo-300" : "border-white/10 bg-white/5 text-white/40 hover:bg-white/10"}`}
          >
            <Icon d="M12 6v6l4 2M12 2a10 10 0 100 20 10 10 0 000-20z" size={13} />
          </button>
          <button
            onClick={() => setShowMap((v) => !v)}
            title={showMap ? "Hide question map" : "Show question map"}
            className={`flex h-8 w-8 items-center justify-center rounded-lg border transition ${showMap ? "border-indigo-400/40 bg-indigo-500/15 text-indigo-300" : "border-white/10 bg-white/5 text-white/40 hover:bg-white/10"}`}
          >
            <Icon d="M4 6h16M4 10h16M4 14h8" size={13} />
          </button>

          {/* Save indicator */}
          <div className="hidden items-center gap-1.5 text-[10px] sm:flex">
            {isSaving
              ? <><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-400" /><span className="text-amber-300">Saving…</span></>
              : lastSaved
                ? <><span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /><span className="text-white/40">Saved</span></>
                : null}
          </div>

          <button
            onClick={() => setShowSubmitModal(true)}
            disabled={isSubmitting}
            className="shrink-0 inline-flex h-9 items-center gap-1.5 rounded-lg bg-gradient-to-r from-rose-500 to-orange-500 px-3 text-xs font-semibold text-white shadow-lg shadow-rose-500/20 transition hover:shadow-xl disabled:opacity-50"
          >
            {isSubmitting ? "Submitting…" : "Submit Exam"}
          </button>
        </div>

        {/* Progress bar */}
        <div className="h-0.5 w-full bg-white/5">
          <div className="h-full bg-gradient-to-r from-indigo-400 via-purple-400 to-pink-400 transition-all duration-500"
            style={{ width: `${questions.length ? (answered / questions.length) * 100 : 0}%` }} />
        </div>
      </header>

      {/* ── Body ─────────────────────────────────── */}
      <div className="flex min-h-0 flex-1 gap-4 overflow-hidden p-4">

        {/* Question panel (left/main) */}
        <main className="flex min-w-0 flex-1 flex-col gap-4 overflow-y-auto">
          {/* Question counter */}
          <div className="flex items-center justify-between text-xs text-white/50">
            <span>Question <span className="font-bold text-white">{currentIndex + 1}</span> of {questions.length}</span>
            <span>
              <span className="text-emerald-300 font-semibold">{answered}</span> answered
              {unanswered > 0 && <span className="text-white/35"> · {unanswered} remaining</span>}
            </span>
          </div>

          {/* Question card */}
          {q && (
            <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-5 sm:p-7 shadow-2xl backdrop-blur-sm flex-1">
              <div className="mb-4 flex items-center justify-between">
                <span className="inline-flex items-center gap-1.5 rounded-full border border-indigo-400/30 bg-indigo-500/15 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-indigo-200">
                  Question {currentIndex + 1}
                </span>
                <span className="text-xs font-medium text-white/50">{q.marks} {q.marks === 1 ? "mark" : "marks"}</span>
              </div>

              <p className="mb-6 text-lg leading-relaxed text-white sm:text-xl">{q.text}</p>

              {/* MCQ */}
              {q.type === "MCQ" && Array.isArray(q.options) && (
                <div className="space-y-2.5">
                  {(q.options as string[]).map((opt, i) => {
                    const selected = answers[q.id] === opt;
                    return (
                      <label key={i} className={`group flex cursor-pointer items-center gap-3 rounded-xl border p-4 transition-all ${selected ? "border-indigo-400/50 bg-indigo-500/15 shadow-lg shadow-indigo-500/10" : "border-white/10 bg-white/[0.02] hover:border-white/25 hover:bg-white/5"}`}>
                        <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 transition ${selected ? "border-indigo-400 bg-indigo-500" : "border-white/20 group-hover:border-white/40"}`}>
                          {selected && <span className="h-2 w-2 rounded-full bg-white" />}
                        </span>
                        <span className="font-mono text-xs font-bold text-white/40">{String.fromCharCode(65 + i)}.</span>
                        <span className={`flex-1 text-sm ${selected ? "text-white" : "text-white/80"}`}>{opt}</span>
                        <input type="radio" name={q.id} checked={selected} onChange={() => setAnswer(q.id, opt)} className="sr-only" />
                      </label>
                    );
                  })}
                </div>
              )}

              {/* True/False */}
              {q.type === "TRUE_FALSE" && (
                <div className="grid grid-cols-2 gap-3">
                  {["true", "false"].map((val) => {
                    const selected = answers[q.id] === val;
                    return (
                      <label key={val} className={`group flex cursor-pointer items-center justify-center gap-3 rounded-xl border p-5 text-sm font-semibold capitalize transition-all ${selected ? "border-indigo-400/50 bg-indigo-500/15 text-white shadow-lg shadow-indigo-500/10" : "border-white/10 bg-white/[0.02] text-white/80 hover:border-white/25 hover:bg-white/5"}`}>
                        <span className={`flex h-6 w-6 items-center justify-center rounded-full border-2 transition ${selected ? "border-indigo-400 bg-indigo-500" : "border-white/20 group-hover:border-white/40"}`}>
                          {selected && <span className="h-2 w-2 rounded-full bg-white" />}
                        </span>
                        {val}
                        <input type="radio" name={q.id} checked={selected} onChange={() => setAnswer(q.id, val)} className="sr-only" />
                      </label>
                    );
                  })}
                </div>
              )}

              {/* Fill in blank */}
              {q.type === "FILL_IN_BLANK" && (
                <input type="text" className="auth-input h-12 w-full rounded-xl px-4 text-base"
                  value={(answers[q.id] as string) || ""}
                  onChange={(e) => setAnswer(q.id, e.target.value)}
                  placeholder="Type your answer…" />
              )}

              {/* Multi blank */}
              {q.type === "MULTI_BLANK_EQUATION" && (() => {
                const parts = q.text.split(/(___)/g);
                const blankCount = parts.filter((p) => p === "___").length;
                const cur = Array.isArray(answers[q.id]) ? (answers[q.id] as string[]) : new Array(blankCount).fill("");
                let bi = 0;
                return (
                  <div className="rounded-xl border border-white/10 bg-slate-950/40 p-5">
                    <div className="flex flex-wrap items-center gap-2 text-lg leading-loose text-white">
                      {parts.map((part, i) => {
                        if (part !== "___") return <span key={i}>{part}</span>;
                        const idx = bi++;
                        return (
                          <input key={i} type="text"
                            className="auth-input inline-block h-10 w-32 rounded-lg border-2 border-purple-400/40 bg-purple-500/5 px-2 text-center font-mono text-base text-purple-200 focus:border-purple-400"
                            value={cur[idx] || ""}
                            onChange={(e) => { const n = [...cur]; n[idx] = e.target.value; setAnswer(q.id, n); }}
                            placeholder={`#${idx + 1}`} />
                        );
                      })}
                    </div>
                  </div>
                );
              })()}
            </div>
          )}

          {/* Navigation */}
          <div className="flex items-center justify-between gap-3 pb-2">
            <button onClick={handlePrev}
              disabled={currentIndex === 0 || !allowBacktrack}
              className="inline-flex h-10 items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-4 text-sm font-medium text-white transition hover:bg-white/10 disabled:opacity-30"
              title={!allowBacktrack ? "Backtracking disabled" : ""}>
              <Icon d="M15 19l-7-7 7-7" /> Previous
            </button>
            <button onClick={handleNext}
              disabled={currentIndex === questions.length - 1}
              className="inline-flex h-10 items-center gap-2 rounded-lg bg-gradient-to-r from-indigo-500 to-purple-500 px-4 text-sm font-semibold text-white shadow-lg shadow-indigo-500/20 transition hover:shadow-xl disabled:opacity-30">
              Next <Icon d="M9 5l7 7-7 7" />
            </button>
          </div>
        </main>

        {/* ── Right sidebar: Question Map ───────────── */}
        {showMap && (
          <aside className="flex w-64 shrink-0 flex-col gap-3 overflow-y-auto">
            {/* Large timer display in sidebar */}
            {showTimer && (
              <div className={`rounded-xl border p-3 text-center ${
                timeCritical ? "border-rose-500/50 bg-rose-500/10" : timeWarning ? "border-amber-500/30 bg-amber-500/10" : "border-white/10 bg-white/[0.02]"
              }`}>
                <p className="text-[9px] uppercase tracking-widest text-white/30 mb-1">Time Remaining</p>
                <p className={`font-mono text-3xl font-extrabold tabular-nums ${timeCritical ? "text-rose-300 animate-pulse" : timeWarning ? "text-amber-300" : "text-white"}`}>
                  {formatTime(timeLeft)}
                </p>
              </div>
            )}

            {/* Question map */}
            <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
              <div className="mb-2.5 flex items-center justify-between">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-white/40">Question Map</span>
                <span className="text-[10px] text-white/25">{answered}/{questions.length}</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {questions.map((qq, i) => {
                  const isCur = i === currentIndex;
                  const hasAns = answers[qq.id] !== undefined && answers[qq.id] !== "";
                  const canJump = allowBacktrack || i >= currentIndex;
                  return (
                    <button key={i} onClick={() => canJump && setCurrentIndex(i)} disabled={!canJump}
                      className={`h-8 w-8 rounded-md text-xs font-bold transition ${
                        isCur ? "bg-gradient-to-br from-indigo-500 to-purple-500 text-white shadow-lg shadow-indigo-500/30 ring-2 ring-indigo-400/50"
                          : hasAns ? "bg-emerald-500/15 text-emerald-200 ring-1 ring-emerald-500/30 hover:bg-emerald-500/25"
                            : "bg-white/5 text-white/55 hover:bg-white/10"
                      } ${!canJump ? "cursor-not-allowed opacity-40" : ""}`}
                      title={`Q${i + 1}${hasAns ? " · answered" : ""}`}>
                      {i + 1}
                    </button>
                  );
                })}
              </div>
              {/* Legend */}
              <div className="mt-3 space-y-1 border-t border-white/5 pt-2">
                {[
                  { color: "bg-gradient-to-br from-indigo-500 to-purple-500", label: "Current" },
                  { color: "bg-emerald-500/30 ring-1 ring-emerald-500/40", label: "Answered" },
                  { color: "bg-white/10", label: "Unanswered" },
                ].map((x) => (
                  <div key={x.label} className="flex items-center gap-2 text-[10px] text-white/30">
                    <span className={`h-2.5 w-2.5 rounded-sm ${x.color}`} />
                    {x.label}
                  </div>
                ))}
              </div>
            </div>

            {/* Exam info */}
            <div className="rounded-xl border border-white/5 bg-white/[0.01] p-3 space-y-1.5 text-[10px] text-white/30">
              <div className="flex justify-between"><span>Total marks</span><span className="text-white/50">{exam?.totalMarks}</span></div>
              {attemptInfo && <div className="flex justify-between"><span>Attempt</span><span className="text-white/50">{attemptInfo.attemptNumber}/{attemptInfo.maxAttempts}</span></div>}
              {!allowBacktrack && <p className="text-amber-400/60 border-t border-white/5 pt-1.5">⚠ Backtracking disabled</p>}
            </div>
          </aside>
        )}
      </div>

      {/* ── Submit confirmation modal ─────────────── */}
      {showSubmitModal && !result && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
          onClick={() => !isSubmitting && setShowSubmitModal(false)}>
          <div onClick={(e) => e.stopPropagation()} className="w-full max-w-sm rounded-2xl border border-white/10 bg-slate-900/95 p-6 shadow-2xl">
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-rose-500/15 text-rose-300">
              <Icon d="M12 9v2m0 4h.01M5 19h14a2 2 0 001.84-2.75L13.74 4a2 2 0 00-3.48 0L3.16 16.25A2 2 0 005 19z" size={24} />
            </div>
            <h2 className="text-lg font-bold text-white">Submit your exam?</h2>
            <p className="mt-1 text-sm text-white/60">You won't be able to change answers after submission.</p>
            {unanswered > 0 && (
              <div className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">
                <span className="font-bold">{unanswered}</span> question{unanswered !== 1 ? "s" : ""} unanswered.
              </div>
            )}
            <div className="mt-5 flex items-center justify-end gap-2">
              <button onClick={() => setShowSubmitModal(false)} disabled={isSubmitting}
                className="rounded-md border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/70 hover:bg-white/10">
                Keep working
              </button>
              <button onClick={() => handleSubmit(false)} disabled={isSubmitting}
                className="inline-flex items-center gap-2 rounded-md bg-gradient-to-r from-rose-500 to-orange-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
                {isSubmitting ? "Submitting…" : "Submit Now"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Small helpers ──────────────────────────────── */
function InfoRow({ label, value }: { label: string; value: string | number | undefined | null }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-white/40">{label}</span>
      <span className="text-right text-white/70">{value ?? "—"}</span>
    </div>
  );
}
