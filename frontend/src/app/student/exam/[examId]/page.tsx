"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import api from "@/lib/api";
import { connectSocket, disconnectSocket } from "@/lib/socket";
import { useAntiCheat } from "@/hooks/useAntiCheat";
import { useAutoSave } from "@/hooks/useAutoSave";
import type { Question } from "@/types";

const Icon = ({ d, size = 16 }: { d: string; size?: number }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
);

export default function ExamTakingPage() {
  const params = useParams();
  const router = useRouter();
  const examId = params.examId as string;

  const [session, setSession] = useState<any>(null);
  const [exam, setExam] = useState<any>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [currentIndex, setCurrentIndex] = useState(0);
  const [timeLeft, setTimeLeft] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showSubmitModal, setShowSubmitModal] = useState(false);
  const [showResultModal, setShowResultModal] = useState<null | { score: number; maxScore: number; percentage: number }>(null);

  const sessionId = session?.id || "";

  useAntiCheat({ sessionId, enabled: !!sessionId });
  const { lastSaved, isSaving } = useAutoSave({ sessionId, answers, enabled: !!sessionId });

  useEffect(() => {
    let mounted = true;
    async function init() {
      try {
        const { data: sessionData } = await api.post("/sessions/start", { examId });
        if (!mounted) return;
        setSession(sessionData.data.session);

        if (sessionData.data.recoveredAnswers) {
          setAnswers(sessionData.data.recoveredAnswers);
        }

        const { data: examData } = await api.get(`/exams/${examId}`);
        if (!mounted) return;
        setExam(examData.data);
        setQuestions(examData.data.questions || []);
        setTimeLeft(examData.data.durationMinutes * 60);

        const socket = connectSocket();
        socket.emit("join:exam", { sessionId: sessionData.data.session.id, examId });
      } catch (err: any) {
        alert(err.response?.data?.error?.message || "Failed to start exam");
        router.push("/student");
      }
    }
    init();
    return () => { mounted = false; disconnectSocket(); };
  }, [examId, router]);

  const handleSubmit = useCallback(async (auto = false) => {
    if (isSubmitting || !sessionId) return;
    setIsSubmitting(true);
    try {
      const answerList = Object.entries(answers).map(([questionId, answer]) => ({ questionId, answer }));
      const { data } = await api.post(`/sessions/${sessionId}/submit`, { answers: answerList });

      const socket = connectSocket();
      socket.emit("exam:submit", { sessionId });

      setShowSubmitModal(false);
      setShowResultModal({
        score: data.data.score,
        maxScore: data.data.maxScore,
        percentage: data.data.percentage,
      });

      if (auto) {
        setTimeout(() => router.push("/student"), 4000);
      }
    } catch (err: any) {
      alert(err.response?.data?.error?.message || "Submission failed");
    } finally {
      setIsSubmitting(false);
    }
  }, [isSubmitting, sessionId, answers, router]);

  useEffect(() => {
    if (timeLeft <= 0 || !session) return;
    const timer = setInterval(() => {
      setTimeLeft((t) => {
        if (t <= 1) {
          handleSubmit(true);
          return 0;
        }
        return t - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [timeLeft, session, handleSubmit]);

  function formatTime(seconds: number) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    const pad = (n: number) => n.toString().padStart(2, "0");
    return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
  }

  function setAnswer(questionId: string, value: unknown) {
    setAnswers((prev) => ({ ...prev, [questionId]: value }));
  }

  const q = questions[currentIndex];
  const answered = useMemo(() => questions.filter((qq) => answers[qq.id] !== undefined && answers[qq.id] !== "").length, [answers, questions]);
  const unansweredCount = questions.length - answered;
  const timeWarning = timeLeft > 0 && timeLeft < 300;
  const timeCritical = timeLeft > 0 && timeLeft < 60;
  const allowBacktrack = exam?.allowBacktrack !== false;

  if (!session || !exam) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-950">
        <div className="space-y-4 text-center">
          <div className="mx-auto h-10 w-10 animate-spin rounded-full border-2 border-indigo-400 border-t-transparent" />
          <p className="text-sm text-white/60">Preparing exam session...</p>
          <p className="text-xs text-white/40">Anti-cheat sensors initializing</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-950 to-indigo-950/30">
      {/* Top bar */}
      <header className="sticky top-0 z-30 border-b border-white/10 bg-slate-950/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="font-mono text-[11px] text-indigo-300">{exam.courseCode}</p>
            <h1 className="truncate text-sm font-semibold text-white">{exam.title}</h1>
          </div>

          {/* Timer */}
          <div className={`flex items-center gap-2 rounded-xl border px-4 py-2 transition-colors ${
            timeCritical ? "border-rose-500/50 bg-rose-500/15 text-rose-200" :
            timeWarning ? "border-amber-500/50 bg-amber-500/15 text-amber-200" :
            "border-white/15 bg-white/5 text-white"
          }`}>
            <span className={`relative flex h-2.5 w-2.5 ${timeCritical ? "" : ""}`}>
              {(timeCritical || timeWarning) && (
                <span className={`absolute inset-0 animate-ping rounded-full ${timeCritical ? "bg-rose-400" : "bg-amber-400"}`} />
              )}
              <span className={`relative h-2.5 w-2.5 rounded-full ${
                timeCritical ? "bg-rose-400" : timeWarning ? "bg-amber-400" : "bg-emerald-400"
              }`} />
            </span>
            <span className="font-mono text-lg font-bold tabular-nums">{formatTime(timeLeft)}</span>
          </div>

          {/* Save indicator */}
          <div className="hidden items-center gap-1.5 text-[11px] sm:flex">
            {isSaving ? (
              <>
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-400" />
                <span className="text-amber-300">Saving...</span>
              </>
            ) : lastSaved ? (
              <>
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                <span className="text-white/50">Saved {lastSaved.toLocaleTimeString()}</span>
              </>
            ) : (
              <>
                <span className="h-1.5 w-1.5 rounded-full bg-white/30" />
                <span className="text-white/40">Not yet saved</span>
              </>
            )}
          </div>

          <button
            onClick={() => setShowSubmitModal(true)}
            disabled={isSubmitting}
            className="inline-flex h-10 items-center gap-2 rounded-lg bg-gradient-to-r from-rose-500 to-orange-500 px-4 text-sm font-semibold text-white shadow-lg shadow-rose-500/20 transition hover:shadow-xl hover:shadow-rose-500/30 disabled:opacity-50"
          >
            {isSubmitting ? "Submitting..." : "Submit Exam"}
          </button>
        </div>

        {/* Progress bar */}
        <div className="h-1 w-full bg-white/5">
          <div
            className="h-full bg-gradient-to-r from-indigo-400 via-purple-400 to-pink-400 transition-all duration-500"
            style={{ width: `${questions.length ? (answered / questions.length) * 100 : 0}%` }}
          />
        </div>
      </header>

      {/* Main content */}
      <main className="mx-auto max-w-3xl px-4 py-8">
        <div className="mb-4 flex items-center justify-between text-xs">
          <div className="text-white/50">
            Question <span className="font-bold text-white">{currentIndex + 1}</span> of {questions.length}
          </div>
          <div className="flex items-center gap-3 text-white/50">
            <span>
              <span className="text-emerald-300">{answered}</span> answered
              {unansweredCount > 0 && (
                <>
                  {" · "}
                  <span className="text-white/40">{unansweredCount} remaining</span>
                </>
              )}
            </span>
          </div>
        </div>

        {q && (
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 shadow-2xl backdrop-blur-sm sm:p-8">
            <div className="mb-5 flex items-center justify-between">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-indigo-400/30 bg-indigo-500/15 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-indigo-200">
                Question {currentIndex + 1}
              </span>
              <span className="text-xs font-medium text-white/60">
                {q.marks} {q.marks === 1 ? "mark" : "marks"}
              </span>
            </div>

            <p className="mb-6 text-lg leading-relaxed text-white sm:text-xl">{q.text}</p>

            {/* MCQ */}
            {q.type === "MCQ" && Array.isArray(q.options) && (
              <div className="space-y-2.5">
                {(q.options as string[]).map((opt, i) => {
                  const selected = answers[q.id] === opt;
                  return (
                    <label
                      key={i}
                      className={`group flex cursor-pointer items-center gap-3 rounded-xl border p-4 transition-all ${
                        selected
                          ? "border-indigo-400/50 bg-indigo-500/15 shadow-lg shadow-indigo-500/10"
                          : "border-white/10 bg-white/[0.02] hover:border-white/25 hover:bg-white/5"
                      }`}
                    >
                      <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 transition ${
                        selected ? "border-indigo-400 bg-indigo-500" : "border-white/20 group-hover:border-white/40"
                      }`}>
                        {selected && <span className="h-2 w-2 rounded-full bg-white" />}
                      </span>
                      <span className="font-mono text-xs font-bold text-white/40">{String.fromCharCode(65 + i)}.</span>
                      <span className={`flex-1 text-sm transition ${selected ? "text-white" : "text-white/80"}`}>{opt}</span>
                      <input
                        type="radio"
                        name={q.id}
                        checked={selected}
                        onChange={() => setAnswer(q.id, opt)}
                        className="sr-only"
                      />
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
                    <label
                      key={val}
                      className={`group flex cursor-pointer items-center justify-center gap-3 rounded-xl border p-5 text-sm font-semibold capitalize transition-all ${
                        selected
                          ? "border-indigo-400/50 bg-indigo-500/15 text-white shadow-lg shadow-indigo-500/10"
                          : "border-white/10 bg-white/[0.02] text-white/80 hover:border-white/25 hover:bg-white/5"
                      }`}
                    >
                      <span className={`flex h-6 w-6 items-center justify-center rounded-full border-2 transition ${
                        selected ? "border-indigo-400 bg-indigo-500" : "border-white/20 group-hover:border-white/40"
                      }`}>
                        {selected && <span className="h-2 w-2 rounded-full bg-white" />}
                      </span>
                      {val}
                      <input
                        type="radio"
                        name={q.id}
                        checked={selected}
                        onChange={() => setAnswer(q.id, val)}
                        className="sr-only"
                      />
                    </label>
                  );
                })}
              </div>
            )}

            {/* Fill in blank */}
            {q.type === "FILL_IN_BLANK" && (
              <input
                type="text"
                className="auth-input h-12 w-full rounded-xl px-4 text-base"
                value={(answers[q.id] as string) || ""}
                onChange={(e) => setAnswer(q.id, e.target.value)}
                placeholder="Type your answer..."
              />
            )}

            {/* Multi blank equation */}
            {q.type === "MULTI_BLANK_EQUATION" && (() => {
              const parts = q.text.split(/(___)/g);
              const blankCount = parts.filter((p) => p === "___").length;
              const current = Array.isArray(answers[q.id]) ? (answers[q.id] as string[]) : new Array(blankCount).fill("");
              let blankIdx = 0;
              return (
                <div className="rounded-xl border border-white/10 bg-slate-950/40 p-5">
                  <div className="flex flex-wrap items-center gap-2 text-lg leading-loose text-white">
                    {parts.map((part, i) => {
                      if (part === "___") {
                        const idx = blankIdx++;
                        return (
                          <input
                            key={i}
                            type="text"
                            className="auth-input inline-block h-10 w-32 rounded-lg border-2 border-purple-400/40 bg-purple-500/5 px-2 text-center font-mono text-base text-purple-200 focus:border-purple-400"
                            value={current[idx] || ""}
                            onChange={(e) => {
                              const next = [...current];
                              next[idx] = e.target.value;
                              setAnswer(q.id, next);
                            }}
                            placeholder={`#${idx + 1}`}
                          />
                        );
                      }
                      return <span key={i}>{part}</span>;
                    })}
                  </div>
                </div>
              );
            })()}
          </div>
        )}

        {/* Navigation */}
        <div className="mt-6 flex items-center justify-between gap-4">
          <button
            onClick={() => setCurrentIndex((i) => Math.max(0, i - 1))}
            disabled={currentIndex === 0 || !allowBacktrack}
            className="inline-flex h-10 items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-4 text-sm font-medium text-white transition hover:bg-white/10 disabled:opacity-30"
            title={!allowBacktrack ? "Backtracking is disabled for this exam" : ""}
          >
            <Icon d="M15 19l-7-7 7-7" /> Previous
          </button>

          <button
            onClick={() => setCurrentIndex((i) => Math.min(questions.length - 1, i + 1))}
            disabled={currentIndex === questions.length - 1}
            className="inline-flex h-10 items-center gap-2 rounded-lg bg-gradient-to-r from-indigo-500 to-purple-500 px-4 text-sm font-semibold text-white shadow-lg shadow-indigo-500/20 transition hover:shadow-xl hover:shadow-purple-500/30 disabled:opacity-30 disabled:hover:shadow-none"
          >
            Next <Icon d="M9 5l7 7-7 7" />
          </button>
        </div>

        {/* Question palette */}
        <div className="mt-8 rounded-2xl border border-white/10 bg-white/[0.02] p-4">
          <div className="mb-3 flex items-center justify-between text-[11px]">
            <span className="font-semibold uppercase tracking-wider text-white/50">Question Map</span>
            <div className="flex items-center gap-3 text-white/40">
              <span className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-md bg-emerald-500/40 ring-1 ring-emerald-400/50" /> Answered
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-md bg-indigo-500" /> Current
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-md bg-white/10" /> Unanswered
              </span>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {questions.map((qq, i) => {
              const isCurrent = i === currentIndex;
              const hasAnswer = answers[qq.id] !== undefined && answers[qq.id] !== "";
              const canJump = allowBacktrack || i >= currentIndex;
              return (
                <button
                  key={i}
                  onClick={() => canJump && setCurrentIndex(i)}
                  disabled={!canJump}
                  className={`relative h-9 w-9 rounded-lg text-xs font-bold transition ${
                    isCurrent
                      ? "bg-gradient-to-br from-indigo-500 to-purple-500 text-white shadow-lg shadow-indigo-500/30 ring-2 ring-indigo-400/50"
                      : hasAnswer
                        ? "bg-emerald-500/15 text-emerald-200 ring-1 ring-emerald-500/30 hover:bg-emerald-500/25"
                        : "bg-white/5 text-white/60 hover:bg-white/10"
                  } ${!canJump ? "cursor-not-allowed opacity-40" : ""}`}
                  title={`Question ${i + 1}${hasAnswer ? " · answered" : ""}`}
                >
                  {i + 1}
                </button>
              );
            })}
          </div>
        </div>
      </main>

      {/* Submit confirmation modal */}
      {showSubmitModal && !showResultModal && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" onClick={() => !isSubmitting && setShowSubmitModal(false)}>
          <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md rounded-2xl border border-white/10 bg-slate-900/95 p-6 shadow-2xl">
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-rose-500/15 text-rose-300">
              <Icon d="M12 9v2m0 4h.01M5 19h14a2 2 0 001.84-2.75L13.74 4a2 2 0 00-3.48 0L3.16 16.25A2 2 0 005 19z" size={24} />
            </div>
            <h2 className="text-lg font-bold text-white">Submit your exam?</h2>
            <p className="mt-1 text-sm text-white/60">
              You won't be able to make changes after submission.
            </p>
            {unansweredCount > 0 && (
              <div className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">
                You still have <span className="font-bold">{unansweredCount}</span> unanswered question{unansweredCount !== 1 ? "s" : ""}.
              </div>
            )}
            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                onClick={() => setShowSubmitModal(false)}
                disabled={isSubmitting}
                className="rounded-md border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-white/70 transition hover:bg-white/10"
              >
                Keep working
              </button>
              <button
                onClick={() => handleSubmit(false)}
                disabled={isSubmitting}
                className="inline-flex items-center gap-2 rounded-md bg-gradient-to-r from-rose-500 to-orange-500 px-4 py-2 text-sm font-semibold text-white transition hover:shadow-lg hover:shadow-rose-500/30 disabled:opacity-50"
              >
                {isSubmitting ? "Submitting..." : "Submit Now"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Result modal */}
      {showResultModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-white/10 bg-slate-900/95 p-8 text-center shadow-2xl">
            <div className={`mx-auto flex h-16 w-16 items-center justify-center rounded-full ${
              showResultModal.percentage >= 50
                ? "bg-emerald-500/15 text-emerald-300"
                : "bg-amber-500/15 text-amber-300"
            }`}>
              <Icon d={showResultModal.percentage >= 50 ? "M9 12l2 2 4-4M21 12a9 9 0 11-18 0 9 9 0 0118 0z" : "M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"} size={32} />
            </div>
            <h2 className="mt-4 text-2xl font-bold text-white">Exam submitted</h2>
            <p className="mt-1 text-sm text-white/60">Your answers have been recorded.</p>
            <div className="mt-6 rounded-xl border border-white/10 bg-white/[0.02] p-5">
              <p className="text-xs uppercase tracking-wider text-white/40">Your score</p>
              <p className="mt-1 text-4xl font-extrabold text-white">
                {showResultModal.score}
                <span className="text-xl text-white/40"> / {showResultModal.maxScore}</span>
              </p>
              <p className={`mt-1 text-sm font-semibold ${
                showResultModal.percentage >= 50 ? "text-emerald-300" : "text-amber-300"
              }`}>
                {showResultModal.percentage}%
              </p>
            </div>
            <button
              onClick={() => router.push("/student")}
              className="mt-6 inline-flex h-10 w-full items-center justify-center rounded-lg bg-gradient-to-r from-indigo-500 to-purple-500 text-sm font-semibold text-white transition hover:shadow-lg hover:shadow-purple-500/30"
            >
              Back to dashboard
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
