"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import api from "@/lib/api";
import { connectSocket, disconnectSocket } from "@/lib/socket";
import { useAntiCheat } from "@/hooks/useAntiCheat";
import type { Question } from "@/types";
import { BlockList } from "@/components/exams/blocks";
import { TemplateFillRenderer } from "@/components/exams/TemplateFillRenderer";
import { deserializeTemplateFill } from "@/components/exams/TemplateFillCreator";
import {
  cacheQuestions,
  getCachedQuestions,
  cacheFullExam,
  getCachedExam,
  saveLocalAnswers,
  loadLocalAnswers,
  clearLocalAnswers,
  mergeAnswers,
  saveAnswerIDB,
  clearAnswersIDB,
  loadAnswersIDB,
  saveSessionState,
  loadSessionState,
  clearSessionState,
  queueIntegrityLog,
  enqueueSyncItem,
} from "@/lib/offlineDB";
import { initSyncQueue, destroySyncQueue, enqueueSyncOp, triggerSync } from "@/lib/syncQueue";
import { OfflineIndicator } from "@/components/exam/OfflineIndicator";
import { perfStart } from "@/lib/perf";

const Icon = ({ d, size = 16 }: { d: string; size?: number }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
);

/** Renders a LaTeX string inline using KaTeX (client-side, lazy) */
function RichLatexOption({ latex }: { latex: string }) {
  const [html, setHtml] = useState("");
  useEffect(() => {
    (async () => {
      try {
        const katex = (await import("katex")).default;
        setHtml(katex.renderToString(latex, { throwOnError: false, displayMode: false }));
      } catch { setHtml(latex); }
    })();
  }, [latex]);
  return html
    ? <span dangerouslySetInnerHTML={{ __html: html }} />
    : <span className="font-mono text-sm text-white/60">{latex}</span>;
}

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
  // Default map hidden on mobile so the question content fills the screen on first load
  const [showMap, setShowMap] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth >= 768 : true
  );
  const [password, setPassword] = useState("");
  const [pwError, setPwError] = useState("");
  const [startError, setStartError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showSubmitModal, setShowSubmitModal] = useState(false);
  const [result, setResult] = useState<{ score: number; maxScore: number; percentage: number } | null>(null);

  /* ── Instructions overlay ─── */
  const [showInstructions, setShowInstructions] = useState(false);

  /* ── Question reporting ─── */
  const [reportingQuestionId, setReportingQuestionId] = useState<string | null>(null);
  const [reportReason, setReportReason] = useState<"TYPO" | "WRONG_ANSWER" | "UNCLEAR" | "OTHER">("TYPO");
  const [reportMessage, setReportMessage] = useState("");
  const [reportSubmitting, setReportSubmitting] = useState(false);
  const [reportError, setReportError] = useState("");
  const [reportedQuestionIds, setReportedQuestionIds] = useState<Set<string>>(new Set());

  /* ── Venue selection ─── */
  const [selectedVenueId, setSelectedVenueId] = useState<string>("");

  /* ── USB advisory ─── */
  const [usbModalOpen, setUsbModalOpen] = useState(false);
  const [usbConfirmed, setUsbConfirmed] = useState(false);
  // Devices found at scan time that are not the obvious built-in default
  const [usbFoundDevices, setUsbFoundDevices] = useState<{ name: string; type: string }[]>([]);

  /* ── mobile detection ─── */
  const [isMobile, setIsMobile] = useState(false);
  const isMobileRef = useRef(false);
  useEffect(() => {
    const mobile =
      /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
      window.innerWidth <= 768;
    setIsMobile(mobile);
    isMobileRef.current = mobile;
  }, []);

  /* ── online / offline ─── */
  const [isOnline, setIsOnline] = useState(true);
  useEffect(() => {
    setIsOnline(navigator.onLine);
    const up   = () => { setIsOnline(true);  triggerSync(); };
    const down = () => setIsOnline(false);
    window.addEventListener("online",  up);
    window.addEventListener("offline", down);
    return () => {
      window.removeEventListener("online",  up);
      window.removeEventListener("offline", down);
    };
  }, []);

  /* ── sync queue bootstrap ─── */
  useEffect(() => {
    // getToken reads from whatever key the API client uses for auth
    const getToken = () =>
      localStorage.getItem("token") ||
      localStorage.getItem("accessToken") ||
      sessionStorage.getItem("token") ||
      null;
    initSyncQueue(getToken);
    return () => destroySyncQueue();
  }, []);

  /* ── fullscreen ─── */
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [fsWarning, setFsWarning] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  /* ── autosave ─── */
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const answersRef = useRef(answers);
  useEffect(() => { answersRef.current = answers; }, [answers]);

  /* ── geofence ─── */
  type GeoStatus = "idle" | "checking" | "allowed" | "outside" | "no_permission" | "disabled";
  const [geoStatus, setGeoStatus] = useState<GeoStatus>("idle");

  const sessionId = session?.id || "";
  const allowBacktrack = exam?.allowBacktrack !== false;
  const timeCritical = timeLeft > 0 && timeLeft <= 60;
  const timeWarning = timeLeft > 0 && timeLeft <= 300 && !timeCritical;

  useAntiCheat({
    sessionId,
    enabled: phase === "taking",
    // When offline, persist integrity flags to IDB; syncQueue will flush them later
    onOfflineFlag: useCallback(
      (flagType: string, metadata: Record<string, unknown>) => {
        if (sessionId) queueIntegrityLog(sessionId, flagType, metadata).catch(() => {});
      },
      [sessionId]
    ),
  });

  /* ─── Geofence polling (45 s, only while taking) ─ */
  useEffect(() => {
    if (phase !== "taking") return;
    if (!exam?.geofenceEnabled) { setGeoStatus("disabled"); return; }

    function checkLocation() {
      if (!navigator.geolocation) { setGeoStatus("no_permission"); return; }
      setGeoStatus("checking");
      navigator.geolocation.getCurrentPosition(
        async ({ coords }) => {
          try {
            const { data } = await api.post(`/exams/${examId}/geofence/validate`, {
              lat: coords.latitude,
              lng: coords.longitude,
            });
            setGeoStatus(data.allowed ? "allowed" : "outside");
          } catch {
            // network blip — keep last known status, don't block
          }
        },
        () => setGeoStatus("no_permission"),
        { timeout: 10000, maximumAge: 30000 }
      );
    }

    checkLocation(); // immediate first check
    const id = setInterval(checkLocation, 45_000);
    return () => clearInterval(id);
  }, [phase, exam?.geofenceEnabled, examId]);

  /* ─── USB advisory (always shown before exam starts) ──────── */
  // Browser labels are EMPTY without camera/mic permission, so we cannot
  // rely on filtering by label.  Instead we always show the advisory and
  // report how many media devices are currently detected as context.
  useEffect(() => {
    if (phase !== "ready" && phase !== "password") return;
    const scan = async () => {
      if (navigator.mediaDevices?.enumerateDevices) {
        try {
          const devs = await navigator.mediaDevices.enumerateDevices();
          // Group by kind for a readable summary — labels may be blank
          const grouped: Record<string, number> = {};
          for (const d of devs) grouped[d.kind] = (grouped[d.kind] ?? 0) + 1;
          const summary = Object.entries(grouped).map(([kind, n]) => ({
            name: `${n} × ${kind}`,
            type: kind,
          }));
          setUsbFoundDevices(summary);
        } catch {
          setUsbFoundDevices([]);
        }
      }
      // Always open the advisory so the student sees and acknowledges it
      setUsbModalOpen(true);
    };
    scan();
  }, [phase]);

  /* ─── Phase 1: load exam info (+ restore session on refresh) ─── */
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      // 1) Offline-first: show cached exam data immediately so the page renders
      //    even without a network connection.
      const cachedExam = await getCachedExam(examId);
      if (!cancelled && cachedExam) {
        if (cachedExam.meta && Object.keys(cachedExam.meta).length) {
          setExam(cachedExam.meta);
        }
        if (cachedExam.questions?.length) {
          setQuestions(cachedExam.questions as Question[]);
        }
      } else {
        // Fallback: question-only cache (from previous version)
        getCachedQuestions(examId).then((cached) => {
          if (!cancelled && cached && cached.length) {
            setQuestions((prev) => (prev.length ? prev : (cached as Question[])));
          }
        });
      }

      // 2) Try to fetch fresh data from the network
      try {
        const endFetch = perfStart("exam_fetch");
        const { data } = await api.get(`/exams/${examId}`);
        endFetch();
        if (cancelled) return;
        setExam(data.data);
        const freshQuestions: Question[] = data.data.questions || [];
        setQuestions(freshQuestions);

        // Persist full exam bundle to IndexedDB for offline use
        cacheFullExam({
          examId,
          meta:         data.data,
          questions:    freshQuestions,
          instructions: data.data.instructions ?? null,
          settings:     {
            durationMinutes: data.data.durationMinutes,
            allowBacktrack:  data.data.allowBacktrack,
            examPassword:    !!data.data.examPassword,
          },
        });

        // 3) Check if the student already has an active session (page refresh restore)
        try {
          const { data: activeData } = await api.get(`/sessions/my-active?examId=${examId}`);
          if (cancelled) return;
          if (activeData.data) {
            const { session: s, recoveredAnswers, remaining, alreadyExpired } = activeData.data;
            setSession(s);

            // Merge server-recovered answers + IDB answers + localStorage answers.
            // Priority: local (most recent keystroke) > server-recovered > nothing.
            const [idbAnswers, localAnswers] = await Promise.all([
              loadAnswersIDB(s.id),
              Promise.resolve(loadLocalAnswers(s.id)),
            ]);
            const merged = mergeAnswers(mergeAnswers(recoveredAnswers, idbAnswers), localAnswers);
            if (Object.keys(merged).length) {
              setAnswers(merged);
              saveLocalAnswers(s.id, merged);
            }
            setTimeLeft(Math.max(0, remaining));

            // Restore last visited question index from IDB
            const savedState = await loadSessionState(s.id);
            if (savedState && savedState.currentIndex > 0) {
              setCurrentIndex(savedState.currentIndex);
            }

            const socket = connectSocket();
            socket.emit("join:exam", { sessionId: s.id, examId });
            socket.on("answer:saved", ({ success }: { success: boolean }) => {
              setIsSaving(false);
              if (success) setLastSaved(new Date());
            });

            // Log page refresh — queue if offline
            if (navigator.onLine) {
              api.post(`/sessions/${s.id}/log-refresh`, {}).catch(() => {
                enqueueSyncOp("LOG_REFRESH", s.id, { source: "page_refresh" });
              });
            } else {
              enqueueSyncOp("LOG_REFRESH", s.id, { source: "page_refresh" });
            }

            setPhase("taking");
            if (!isMobileRef.current && !alreadyExpired) {
              setTimeout(() => enterFullscreen(), 150);
            }
            return;
          }
        } catch {
          // No active session on server; check if we have an IDB session state
          // (handles the case where the student is offline and the session API fails)
        }

        setPhase(data.data.examPassword ? "password" : "ready");
      } catch {
        // Network fully unavailable
        if (cancelled) return;
        if (cachedExam) {
          // We have the exam cached — show entry screen from cache
          setPhase(cachedExam.settings?.examPassword ? "password" : "ready");
        } else {
          router.replace("/student");
        }
      }
    };
    load();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [examId, router]);

  /* ─── Phase 2: start session ──────────────────── */
  async function handleStartExam() {
    setStartError("");

    // Pre-check geofence before starting session
    if (exam?.geofenceEnabled) {
      const geoOk = await new Promise<boolean>((resolve) => {
        if (!navigator.geolocation) { resolve(false); return; }
        navigator.geolocation.getCurrentPosition(
          async ({ coords }) => {
            try {
              const { data } = await api.post(`/exams/${examId}/geofence/validate`, {
                lat: coords.latitude, lng: coords.longitude,
              });
              resolve(data.allowed);
            } catch { resolve(true); } // network error → allow to prevent false block
          },
          () => resolve(false),
          { timeout: 10000, maximumAge: 30000 }
        );
      });
      if (!geoOk) {
        setStartError("You are outside the allowed exam location. Move to the exam venue and try again.");
        return;
      }
    }

    setPhase("session-starting");
    try {
      const { data } = await api.post("/sessions/start", {
        examId,
        password: exam?.examPassword ? password : undefined,
        venueId: selectedVenueId || undefined,
      });
      const newSession = data.data.session;
      setSession(newSession);
      setAttemptInfo({
        attemptNumber: data.data.attemptNumber,
        attemptsUsed: data.data.attemptsUsed,
        maxAttempts: data.data.maxAttempts,
      });
      // Merge any locally-persisted answers (e.g. resuming a session) with
      // what the server recovered — local non-empty values win.
      const local = loadLocalAnswers(newSession.id);
      const merged = mergeAnswers(data.data.recoveredAnswers, local);
      if (Object.keys(merged).length) {
        setAnswers(merged);
        saveLocalAnswers(newSession.id, merged);
      }
      setTimeLeft(exam.durationMinutes * 60);

      const socket = connectSocket();
      socket.emit("join:exam", { sessionId: data.data.session.id, examId });

      socket.on("answer:saved", ({ success }: { success: boolean }) => {
        setIsSaving(false);
        if (success) setLastSaved(new Date());
      });

      // Seed session state so we can restore currentIndex on reload
      saveSessionState({
        sessionId: newSession.id,
        currentIndex: 0,
        phase: "taking",
        startedAt: new Date().toISOString(),
      });

      // Ensure the full exam bundle is in IDB for offline use
      cacheFullExam({
        examId,
        meta:         exam,
        questions:    questions,
        instructions: exam.instructions ?? null,
        settings:     {
          durationMinutes: exam.durationMinutes,
          allowBacktrack:  exam.allowBacktrack,
          examPassword:    !!exam.examPassword,
        },
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
    if (isMobileRef.current) return; // Mobile devices use full-viewport CSS instead
    const el = containerRef.current || document.documentElement;
    el.requestFullscreen?.().catch(() => {});
  }

  useEffect(() => {
    function onChange() {
      const fs = !!document.fullscreenElement;
      setIsFullscreen(fs);
      // Only warn on desktop — mobile never enters fullscreen
      if (!fs && phase === "taking" && !isMobileRef.current) setFsWarning(true);
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

  /* ─── Periodic autosave (every 30 s) ─────────── */
  useEffect(() => {
    if (phase !== "taking" || !sessionId) return;
    const t = setInterval(() => {
      if (navigator.onLine) {
        const socket = connectSocket();
        setIsSaving(true);
        socket.emit("answer:save", { sessionId, answers: answersRef.current });
      } else {
        // Offline: enqueue a batched write; syncQueue will flush when back online
        enqueueSyncOp("AUTOSAVE", sessionId, { answers: answersRef.current }).catch(() => {});
      }
    }, 30_000);
    return () => clearInterval(t);
  }, [phase, sessionId]);

  /* ─── Immediate save helper ───────────────────── */
  async function saveNow() {
    if (!sessionId) return;
    if (!navigator.onLine) {
      // Persist locally and queue for later — don't show a spinner
      await enqueueSyncOp("AUTOSAVE", sessionId, { answers: answersRef.current });
      return;
    }
    try {
      setIsSaving(true);
      await api.post(`/sessions/${sessionId}/autosave`, { answers: answersRef.current });
      setLastSaved(new Date());
    } catch {
      // Network error mid-save — enqueue so it retries on reconnect
      await enqueueSyncOp("AUTOSAVE", sessionId, { answers: answersRef.current });
    } finally {
      setIsSaving(false);
    }
  }

  /* ─── Submit ──────────────────────────────────── */
  const handleSubmit = useCallback(async (auto = false) => {
    if (isSubmitting || !sessionId) return;
    setIsSubmitting(true);

    // Merge in-memory + localStorage + IDB answers so nothing is lost
    const idbAnswers   = await loadAnswersIDB(sessionId).catch(() => ({}));
    const localAnswers = loadLocalAnswers(sessionId);
    const finalAnswers = mergeAnswers(mergeAnswers(answersRef.current, idbAnswers), localAnswers);
    const answerList   = Object.entries(finalAnswers).map(([questionId, answer]) => ({ questionId, answer }));

    // If offline, queue the submission and notify the student
    if (!navigator.onLine) {
      await enqueueSyncOp("SUBMIT", sessionId, { sessionId, answers: finalAnswers });
      setIsSubmitting(false);
      alert(
        "You are currently offline. Your exam answers have been saved locally and will be submitted automatically when your connection is restored."
      );
      return;
    }

    try {
      const { data } = await api.post(`/sessions/${sessionId}/submit`, { answers: answerList });
      connectSocket().emit("exam:submit", { sessionId });

      // Clean up local stores on successful server-side submission
      clearLocalAnswers(sessionId);
      clearAnswersIDB(sessionId).catch(() => {});
      clearSessionState(sessionId).catch(() => {});

      setShowSubmitModal(false);
      setResult({ score: data.data.score, maxScore: data.data.maxScore, percentage: data.data.percentage });
      setPhase("submitted");
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      if (auto) setTimeout(() => router.push("/student"), 4000);
    } catch (err: any) {
      // Network error during submit — queue it and inform student
      if (!navigator.onLine || err?.code === "ERR_NETWORK") {
        await enqueueSyncOp("SUBMIT", sessionId, { sessionId, answers: finalAnswers });
        alert(
          "Connection lost during submission. Your answers are saved and will be submitted automatically when you reconnect."
        );
      } else {
        alert(err.response?.data?.error?.message || "Submission failed. Please try again.");
      }
    } finally {
      setIsSubmitting(false);
    }
  }, [isSubmitting, sessionId, router]);

  /* ─── Persist current question index to IDB on every navigation ─── */
  useEffect(() => {
    if (!sessionId || phase !== "taking") return;
    saveSessionState({ sessionId, currentIndex, phase: "taking" });
  }, [sessionId, currentIndex, phase]);

  /* ─── Auto-submit if session restored with zero time remaining ─── */
  const hasAutoSubmittedRef = useRef(false);
  useEffect(() => {
    if (phase === "taking" && timeLeft === 0 && session && !hasAutoSubmittedRef.current) {
      hasAutoSubmittedRef.current = true;
      handleSubmit(true);
    }
  }, [phase, timeLeft, session, handleSubmit]);

  /* ─── Answer + navigation ─────────────────────── */
  const answerSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function setAnswer(questionId: string, value: unknown) {
    // 1) Optimistic UI update — student keeps moving immediately.
    setAnswers((prev) => {
      const next = { ...prev, [questionId]: value };
      // 2a) Synchronous localStorage save — survives hard crashes/refreshes.
      if (sessionId) saveLocalAnswers(sessionId, next);
      return next;
    });

    // 2b) Async IDB save for richer offline restore (non-blocking).
    if (sessionId) saveAnswerIDB(sessionId, questionId, value).catch(() => {/* ignore */});

    // 3) Debounced server sync — via socket when online, queued when offline.
    if (answerSaveTimerRef.current) clearTimeout(answerSaveTimerRef.current);
    if (sessionId) {
      answerSaveTimerRef.current = setTimeout(() => {
        if (navigator.onLine) {
          const socket = connectSocket();
          setIsSaving(true);
          socket.emit("answer:save", { sessionId, answers: answersRef.current });
        } else {
          // Queue to be synced when connectivity returns
          enqueueSyncOp("AUTOSAVE", sessionId, { answers: answersRef.current });
        }
      }, 1500);
    }
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

  /* ─── Report (flag) a question ─────────────────── */
  function openReportModal(questionId: string) {
    setReportingQuestionId(questionId);
    setReportReason("TYPO");
    setReportMessage("");
    setReportError("");
  }

  async function submitReport() {
    if (!reportingQuestionId) return;
    setReportSubmitting(true);
    setReportError("");
    try {
      await api.post(`/questions/${reportingQuestionId}/report`, {
        sessionId,
        reason: reportReason,
        message: reportMessage.trim() || undefined,
      });
      setReportedQuestionIds((prev) => {
        const next = new Set(prev);
        next.add(reportingQuestionId);
        return next;
      });
      setReportingQuestionId(null);
    } catch (err: any) {
      setReportError(err.response?.data?.error?.message || "Failed to submit report");
    } finally {
      setReportSubmitting(false);
    }
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

            {/* Description & Instructions */}
            {(exam?.description || exam?.instructions) && (
              <div className="mt-4 rounded-xl border border-indigo-500/20 bg-indigo-500/[0.06] p-4 text-left space-y-2">
                {exam?.description && (
                  <p className="text-sm text-white/70 leading-relaxed">{exam.description}</p>
                )}
                {exam?.instructions && (
                  <div className="space-y-1">
                    {exam?.description && <div className="h-px w-full bg-white/8 my-2" />}
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-indigo-300/70">Instructions</p>
                    <p className="text-sm text-white/60 leading-relaxed whitespace-pre-wrap">{exam.instructions}</p>
                  </div>
                )}
              </div>
            )}

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
              {exam?.venues && exam.venues.length > 0 && (
                <div className="space-y-1">
                  <label className="text-[10px] font-semibold uppercase tracking-wider text-white/50">
                    Select Your Venue <span className="text-rose-400">*</span>
                  </label>
                  <select
                    value={selectedVenueId}
                    onChange={(e) => setSelectedVenueId(e.target.value)}
                    className="auth-input h-11 w-full rounded-xl px-3 text-sm"
                  >
                    <option value="">— Choose a venue —</option>
                    {exam.venues.map((v: { id: string; name: string; capacity: number }) => (
                      <option key={v.id} value={v.id} className="bg-slate-900">
                        {v.name}{v.capacity > 0 ? ` (capacity: ${v.capacity})` : ""}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              {(pwError || startError) && (
                <p className="text-xs text-rose-400">{pwError || startError}</p>
              )}
              <button
                type="submit"
                disabled={
                  phase === "session-starting" ||
                  (exam?.venues?.length > 0 && !selectedVenueId)
                }
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
        {/* ── USB Device Warning Modal ───────────────────────────── */}
        {usbModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
            <div className="w-full max-w-md rounded-2xl border border-amber-500/30 bg-slate-900 p-6 shadow-2xl space-y-4">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-500/15 ring-1 ring-amber-500/30">
                  <Icon d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" size={20} />
                </div>
                <div>
                  <h3 className="font-semibold text-amber-300">USB Device Check Required</h3>
                  <p className="mt-1 text-xs text-white/60">
                    Before starting the exam, please disconnect all USB storage devices, external drives, and unauthorised peripherals. USB devices connected <span className="text-amber-300 font-medium">during</span> the exam will be flagged automatically.
                  </p>
                </div>
              </div>
              {usbFoundDevices.length > 0 && (
                <div className="rounded-xl border border-white/5 bg-white/[0.03] p-3">
                  <p className="text-[10px] text-white/40 mb-2 uppercase tracking-wide">Devices currently detected on your system</p>
                  <ul className="space-y-1">
                    {usbFoundDevices.map((d, i) => (
                      <li key={i} className="flex items-center gap-2 text-xs">
                        <span className="h-1.5 w-1.5 rounded-full bg-amber-400 shrink-0" />
                        <span className="text-white/70">{d.name}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <p className="text-xs text-white/50">This is a routine check. Built-in microphones, speakers, and webcams are permitted. Please remove any USB flash drives or external hard drives before continuing.</p>
              <div className="flex gap-3 pt-1">
                <button
                  onClick={() => {
                    // Re-scan after student says they removed devices
                    navigator.mediaDevices?.enumerateDevices?.().then((devs) => {
                      const ext = devs.filter((d) => d.deviceId && d.deviceId !== "default" && d.label).map((d) => ({ name: d.label, type: d.kind }));
                      setUsbFoundDevices(ext);
                    }).catch(() => {});
                  }}
                  className="flex-1 rounded-xl border border-white/10 py-2.5 text-xs font-medium text-white/70 hover:bg-white/5 transition"
                >
                  Re-scan
                </button>
                <button
                  onClick={() => { setUsbModalOpen(false); setUsbConfirmed(true); }}
                  className="flex-1 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 py-2.5 text-xs font-semibold text-white transition hover:shadow-lg hover:shadow-amber-500/30"
                >
                  I understand, continue
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="w-full max-w-sm text-center">
          <div className="rounded-2xl border border-white/10 bg-slate-900/80 p-8 backdrop-blur-xl shadow-2xl space-y-4">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-indigo-500/15 ring-1 ring-indigo-500/30">
              <Icon d="M9 12h6M9 16h6M9 8h6M5 3h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2z" size={26} />
            </div>
            <div>
              <h2 className="text-xl font-bold text-white">{exam?.title}</h2>
              <p className="mt-1 text-sm text-white/50">{exam?.courseCode}</p>
            </div>

            {/* Description */}
            {exam?.description && (
              <div className="rounded-xl border border-indigo-500/20 bg-indigo-500/[0.06] p-4 text-left">
                <p className="text-sm text-white/70 leading-relaxed">{exam.description}</p>
              </div>
            )}

            <div className="rounded-xl border border-white/5 bg-white/[0.02] p-4 text-left space-y-2 text-xs">
              <InfoRow label="Duration" value={`${exam?.durationMinutes} minutes`} />
              <InfoRow label="Questions" value={questions.length} />
              <InfoRow label="Total Marks" value={exam?.totalMarks} />
              <InfoRow label="Max Attempts" value={exam?.maxAttempts ?? 1} />
            </div>

            {/* Instructions */}
            {exam?.instructions && (
              <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.05] p-4 text-left space-y-1">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-amber-300/70">Instructions</p>
                <p className="text-sm text-white/65 leading-relaxed whitespace-pre-wrap">{exam.instructions}</p>
              </div>
            )}
            {/* Venue selection */}
            {exam?.venues && exam.venues.length > 0 && (
              <div className="space-y-1.5">
                <label className="text-[10px] font-semibold uppercase tracking-wider text-white/50">
                  Select Your Exam Venue <span className="text-rose-400">*</span>
                </label>
                <select
                  value={selectedVenueId}
                  onChange={(e) => setSelectedVenueId(e.target.value)}
                  className="auth-input h-11 w-full rounded-xl px-3 text-sm"
                >
                  <option value="">— Choose a venue —</option>
                  {exam.venues.map((v: { id: string; name: string; capacity: number }) => (
                    <option key={v.id} value={v.id} className="bg-slate-900">
                      {v.name}{v.capacity > 0 ? ` (capacity: ${v.capacity})` : ""}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* USB confirmation checkbox */}
            <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-white/5 bg-white/[0.02] p-3 text-left hover:bg-white/[0.04] transition">
              <input
                type="checkbox"
                checked={usbConfirmed}
                onChange={(e) => setUsbConfirmed(e.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0 accent-indigo-400"
              />
              <span className="text-xs text-white/60 leading-relaxed">
                I confirm that no USB storage devices or unauthorised peripherals are connected to my device.
              </span>
            </label>
            {startError && <p className="text-xs text-rose-400">{startError}</p>}
            <button
              onClick={handleStartExam}
              disabled={
                phase === "session-starting" ||
                !usbConfirmed ||
                (exam?.venues?.length > 0 && !selectedVenueId)
              }
              className="w-full rounded-xl bg-gradient-to-r from-indigo-500 to-purple-500 py-3 text-sm font-semibold text-white transition hover:shadow-lg hover:shadow-purple-500/30 disabled:opacity-60 disabled:cursor-not-allowed"
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
    const pct = Number(result.percentage) || 0;
    const pass = pct >= 50;
    // attemptsUsed = count before this attempt; add 1 for current → retake if still under cap
    const canRetake = attemptInfo && (attemptInfo.attemptsUsed + 1) < attemptInfo.maxAttempts;

    // Range match coerces min/max to numbers — JSON stored from number inputs
    // can arrive as strings, which silently breaks >= / <= comparisons.
    const inRange = (min: unknown, max: unknown) =>
      pct >= Number(min) && pct <= Number(max);

    // Find the matching grade from gradingSystem (based on percentage)
    type GradeRow = { grade: string; min: number; max: number };
    const gradeRows = Array.isArray(exam?.gradingSystem) ? (exam.gradingSystem as GradeRow[]) : [];
    const matchedGrade = gradeRows.find((g) => inRange(g.min, g.max));

    // Find the matching remark from scoreRemarks (based on percentage)
    type RemarkRow = { min: number; max: number; remark: string };
    const remarkRows = Array.isArray(exam?.scoreRemarks) ? (exam.scoreRemarks as RemarkRow[]) : [];
    const matchedRemark = exam?.showRemarksToStudents
      ? remarkRows.find((r) => inRange(r.min, r.max))
      : null;

    return (
      <div className="flex h-screen items-center justify-center bg-slate-950 p-4 overflow-y-auto">
        <div className="w-full max-w-md rounded-2xl border border-white/10 bg-slate-900/95 p-8 text-center shadow-2xl space-y-5 my-4">
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
              {matchedGrade && (
                <p className="mt-2 text-lg font-bold text-indigo-300">Grade: {matchedGrade.grade}</p>
              )}
            </div>
          ) : (
            <div className="rounded-xl border border-white/10 bg-white/[0.02] p-5 text-sm text-white/50">
              Your examiner has not enabled score visibility.
            </div>
          )}

          {/* Remark — shown whenever showRemarksToStudents is on */}
          {matchedRemark && (
            <div className="rounded-xl border border-indigo-400/25 bg-indigo-500/[0.08] px-5 py-4 text-left space-y-1">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-indigo-300/70">Examiner&apos;s Remark</p>
              <p className="text-sm leading-relaxed text-white/75 italic">&ldquo;{matchedRemark.remark}&rdquo;</p>
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
    <div
      ref={containerRef}
      className={`relative flex flex-col overflow-hidden text-white ${
        isMobile ? "fixed inset-0 z-[9999]" : "h-screen"
      }`}
    >
      {/* Floating online/offline status indicator */}
      <OfflineIndicator />
      {/*
        Hidden file input — gives the anti-cheat hook a real DOM target for
        "Opening the file picker" detection.  It is visually invisible and
        positioned off-screen so students cannot accidentally interact with
        it, but the browser's native file-open dialog (Ctrl+O, right-click
        "Open file…", or DevTools injection) will still register a change
        event that the hook catches.
      */}
      <input
        id="__ac_file_trap__"
        type="file"
        multiple
        aria-hidden
        tabIndex={-1}
        style={{ position: "fixed", top: -9999, left: -9999, opacity: 0, pointerEvents: "none", width: 1, height: 1 }}
      />
      {/* Purple/indigo background — matches the rest of the portal */}
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-slate-950" />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            "radial-gradient(ellipse 80% 60% at 20% 0%, rgba(139, 92, 246, 0.22), transparent 60%)," +
            "radial-gradient(ellipse 70% 55% at 90% 20%, rgba(99, 102, 241, 0.18), transparent 60%)," +
            "radial-gradient(ellipse 90% 70% at 50% 100%, rgba(168, 85, 247, 0.18), transparent 70%)",
        }}
      />
      <div className="relative z-10 flex h-full flex-col">

      {/* ── Geofence block overlay ────────────────── */}
      {(geoStatus === "outside" || geoStatus === "no_permission") && phase === "taking" && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/95 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl border border-amber-500/30 bg-slate-900 p-8 text-center shadow-2xl space-y-4">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-amber-500/15 ring-1 ring-amber-500/30">
              <Icon d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0zM15 11a3 3 0 11-6 0 3 3 0 016 0z" size={28} />
            </div>
            <h2 className="text-lg font-bold text-amber-300">
              {geoStatus === "no_permission" ? "Location Access Required" : "Outside Exam Boundary"}
            </h2>
            <p className="text-sm text-white/60">
              {geoStatus === "no_permission"
                ? "This exam requires location access. Please allow location permission in your browser and try again."
                : "You are outside the allowed exam location. Please return to the designated exam venue to continue."}
            </p>
            <button
              onClick={() => setGeoStatus("checking")}
              className="w-full rounded-xl bg-amber-600 py-3 text-sm font-bold text-white transition hover:bg-amber-500"
            >
              Check My Location Again
            </button>
          </div>
        </div>
      )}

      {/* ── Instructions overlay ─────────────────── */}
      {showInstructions && (exam?.description || exam?.instructions) && (
        <div className="fixed inset-0 z-[90] flex items-end justify-center sm:items-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg rounded-2xl border border-white/10 bg-slate-900 shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between border-b border-white/8 px-5 py-4">
              <div className="flex items-center gap-2">
                <Icon d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" size={16} />
                <h3 className="font-bold text-white">Exam Instructions</h3>
              </div>
              <button
                onClick={() => setShowInstructions(false)}
                className="flex h-7 w-7 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-white/50 transition hover:bg-white/10 hover:text-white"
              >
                <Icon d="M18 6L6 18M6 6l12 12" size={14} />
              </button>
            </div>
            <div className="max-h-[60vh] overflow-y-auto p-5 space-y-4">
              {exam?.description && (
                <div className="space-y-1">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-white/40">Description</p>
                  <p className="text-sm text-white/75 leading-relaxed">{exam.description}</p>
                </div>
              )}
              {exam?.description && exam?.instructions && <div className="h-px bg-white/8" />}
              {exam?.instructions && (
                <div className="space-y-1">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-amber-300/70">Instructions</p>
                  <p className="text-sm text-white/70 leading-relaxed whitespace-pre-wrap">{exam.instructions}</p>
                </div>
              )}
            </div>
            <div className="border-t border-white/8 px-5 py-3">
              <button
                onClick={() => setShowInstructions(false)}
                className="w-full rounded-xl border border-white/10 bg-white/5 py-2 text-sm font-medium text-white/70 transition hover:bg-white/10"
              >
                Close &amp; Continue Exam
              </button>
            </div>
          </div>
        </div>
      )}

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

      {/* ── Instructions overlay ─────────────────── */}
      {showInstructions && (exam?.description || exam?.instructions) && (
        <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg rounded-2xl border border-white/10 bg-slate-900 shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between border-b border-white/8 px-5 py-4">
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-500/15 text-amber-300">
                  <Icon d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" size={15} />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">{exam?.title}</h3>
                  <p className="text-[10px] text-white/40">{exam?.courseCode}</p>
                </div>
              </div>
              <button
                onClick={() => setShowInstructions(false)}
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-white/50 transition hover:bg-white/10 hover:text-white"
              >
                <Icon d="M18 6L6 18M6 6l12 12" size={14} />
              </button>
            </div>
            <div className="max-h-[60vh] overflow-y-auto p-5 space-y-4">
              {exam?.description && (
                <div className="space-y-1.5">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-white/40">Description</p>
                  <p className="text-sm text-white/70 leading-relaxed">{exam.description}</p>
                </div>
              )}
              {exam?.description && exam?.instructions && <div className="h-px bg-white/8" />}
              {exam?.instructions && (
                <div className="space-y-1.5">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-amber-300/70">Instructions</p>
                  <p className="text-sm text-white/65 leading-relaxed whitespace-pre-wrap">{exam.instructions}</p>
                </div>
              )}
            </div>
            <div className="border-t border-white/8 px-5 py-3">
              <button
                onClick={() => setShowInstructions(false)}
                className="w-full rounded-xl bg-white/5 py-2.5 text-sm font-medium text-white/70 transition hover:bg-white/10"
              >
                Close &amp; return to exam
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Header ───────────────────────────────── */}
      <header className="shrink-0 border-b border-purple-400/10 bg-slate-950/70 backdrop-blur-xl">
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
          {(exam?.description || exam?.instructions) && (
            <button
              onClick={() => setShowInstructions((v) => !v)}
              title={showInstructions ? "Hide instructions" : "Show instructions"}
              className={`hidden sm:flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium transition ${showInstructions ? "border-amber-400/40 bg-amber-500/15 text-amber-300" : "border-white/10 bg-white/5 text-white/40 hover:bg-white/10 hover:text-white/70"}`}
            >
              <Icon d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" size={13} />
              Instructions
            </button>
          )}

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
      {/* On mobile: single column (question full-width, map below).
          On desktop: side-by-side (question | map). */}
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-3 gap-3 sm:p-4 sm:gap-4 md:flex-row md:overflow-hidden">

        {/* Question panel — full width on mobile, flex-1 on desktop */}
        <main className="flex min-w-0 flex-col gap-4 md:flex-1 md:overflow-y-auto">
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
            <div className="rounded-2xl border border-purple-400/10 bg-slate-950/55 p-5 sm:p-7 shadow-2xl shadow-purple-900/20 ring-1 ring-purple-500/5 backdrop-blur-md flex-1">
              <div className="mb-4 flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-full border border-indigo-400/30 bg-indigo-500/15 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-indigo-200">
                  Question {currentIndex + 1}
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => openReportModal(q.id)}
                    disabled={reportedQuestionIds.has(q.id)}
                    title={reportedQuestionIds.has(q.id) ? "You've reported this question" : "Report a problem with this question"}
                    className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition ${
                      reportedQuestionIds.has(q.id)
                        ? "border-amber-400/30 bg-amber-500/10 text-amber-300 cursor-default"
                        : "border-white/10 bg-white/5 text-white/60 hover:border-amber-400/40 hover:bg-amber-500/10 hover:text-amber-200"
                    }`}
                  >
                    <Icon d="M4 21V4m0 0l8 5 8-5v12l-8 5-8-5z" size={12} />
                    {reportedQuestionIds.has(q.id) ? "Reported" : "Flag"}
                  </button>
                  <span className="text-xs font-medium text-white/50">{q.marks} {q.marks === 1 ? "mark" : "marks"}</span>
                </div>
              </div>

              {/* Question text — hidden for pure block-based questions whose text is just a backend placeholder */}
              {q.text && q.text !== "[block-based question]" && (
                q.type === "MULTI_BLANK_EQUATION" ? (
                  <p className="mb-6 text-lg leading-relaxed text-white sm:text-xl">{q.text}</p>
                ) : (
                  <div
                    className="qe-prose mb-6 text-lg leading-relaxed text-white sm:text-xl"
                    dangerouslySetInnerHTML={{ __html: q.text }}
                  />
                )
              )}

              {Array.isArray(q.blocks) && q.blocks.length > 0 && (
                <div className="mb-6 space-y-3">
                  <BlockList blocks={q.blocks} />
                </div>
              )}

              {/* MCQ — supports plain-text, LaTeX, and image options */}
              {q.type === "MCQ" && Array.isArray(q.options) && (
                <div className="space-y-2.5">
                  {(q.options as (string | { displayType?: string; value?: string; content?: string; url?: string })[]).map((raw, i) => {
                    // Normalise: string or rich option object
                    const isRich = raw && typeof raw === "object";
                    const optValue = isRich ? ((raw as {value?: string}).value ?? String(i)) : (raw as string);
                    const displayType = isRich ? ((raw as {displayType?: string}).displayType ?? "text") : "text";
                    const content = isRich ? ((raw as {content?: string}).content ?? optValue) : (raw as string);
                    const imgUrl = isRich ? ((raw as {url?: string}).url ?? "") : "";
                    const selected = answers[q.id] === optValue;
                    return (
                      <label key={i} className={`group flex cursor-pointer items-start gap-3 rounded-xl border p-4 transition-all ${selected ? "border-indigo-400/50 bg-indigo-500/15 shadow-lg shadow-indigo-500/10" : "border-white/10 bg-white/[0.02] hover:border-white/25 hover:bg-white/5"}`}>
                        <span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 transition ${selected ? "border-indigo-400 bg-indigo-500" : "border-white/20 group-hover:border-white/40"}`}>
                          {selected && <span className="h-2 w-2 rounded-full bg-white" />}
                        </span>
                        <span className="font-mono text-xs font-bold text-white/40 mt-0.5">{String.fromCharCode(65 + i)}.</span>
                        <span className={`flex-1 ${selected ? "text-white" : "text-white/80"}`}>
                          {displayType === "image" && imgUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={imgUrl} alt={optValue} loading="lazy" className="max-h-48 rounded-lg border border-white/10" />
                          ) : displayType === "latex" && content ? (
                            <RichLatexOption latex={content} />
                          ) : (
                            <span className="text-sm">{optValue}</span>
                          )}
                        </span>
                        <input type="radio" name={q.id} checked={selected} onChange={() => setAnswer(q.id, optValue)} className="sr-only" />
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

          {/* Template Fill */}
          {q.type === "TEMPLATE_FILL" && (() => {
            const tfv = deserializeTemplateFill(q.text, q.correctAnswer);
            if (!tfv) return <p className="text-sm text-white/40">Template configuration missing.</p>;
            const cur = (answers[q.id] && typeof answers[q.id] === "object" && !Array.isArray(answers[q.id]))
              ? (answers[q.id] as Record<string, string>)
              : {};
            return (
              <TemplateFillRenderer
                config={tfv.config}
                value={cur}
                onChange={(next) => setAnswer(q.id, next)}
              />
            );
          })()}

          {/* Navigation */}
          <div className="flex items-center justify-between gap-3 pb-2">
            <button onClick={handlePrev}
              disabled={currentIndex === 0 || !allowBacktrack}
              className="inline-flex h-10 items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-4 text-sm font-medium text-white transition hover:bg-white/10 disabled:opacity-30"
              title={!allowBacktrack ? "Backtracking disabled" : ""}>
              <Icon d="M15 19l-7-7 7-7" /> Previous
            </button>
            {currentIndex === questions.length - 1 ? (
              <button
                onClick={() => setShowSubmitModal(true)}
                disabled={isSubmitting}
                className="inline-flex h-10 items-center gap-2 rounded-lg bg-gradient-to-r from-rose-500 to-orange-500 px-4 text-sm font-semibold text-white shadow-lg shadow-rose-500/20 transition hover:shadow-xl disabled:opacity-50">
                <Icon d="M5 13l4 4L19 7" size={14} />
                Submit Exam
              </button>
            ) : (
              <button onClick={handleNext}
                className="inline-flex h-10 items-center gap-2 rounded-lg bg-gradient-to-r from-indigo-500 to-purple-500 px-4 text-sm font-semibold text-white shadow-lg shadow-indigo-500/20 transition hover:shadow-xl">
                Next <Icon d="M9 5l7 7-7 7" />
              </button>
            )}
          </div>
        </main>

        {/* ── Question Map — full-width row on mobile, sidebar on desktop ── */}
        {showMap && (
          <aside className="flex shrink-0 flex-col gap-3 md:w-64 md:overflow-y-auto">
            {/* Question map */}
            <div className="rounded-xl border border-purple-400/10 bg-slate-950/55 p-3 backdrop-blur-md">
              <div className="mb-2.5 flex items-center justify-between">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-white/40">Question Map</span>
                <span className="text-[10px] text-white/25">{answered}/{questions.length}</span>
              </div>
              {/* On mobile: small buttons in a tighter grid; on desktop: standard size */}
              <div className="grid gap-1" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(2rem, 1fr))" }}>
                {questions.map((qq, i) => {
                  const isCur = i === currentIndex;
                  const hasAns = answers[qq.id] !== undefined && answers[qq.id] !== "";
                  const canJump = allowBacktrack || i >= currentIndex;
                  return (
                    <button key={i} onClick={() => canJump && setCurrentIndex(i)} disabled={!canJump}
                      className={`h-8 w-full rounded-md text-xs font-bold transition ${
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
            <div className="rounded-xl border border-purple-400/10 bg-slate-950/40 p-3 space-y-1.5 text-[10px] text-white/40 backdrop-blur-md">
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

      {/* ── Report (flag) question modal ─────────── */}
      {reportingQuestionId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
          onClick={() => !reportSubmitting && setReportingQuestionId(null)}>
          <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md rounded-2xl border border-amber-500/20 bg-slate-900/95 p-6 shadow-2xl space-y-4">
            <div className="flex items-start gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/30">
                <Icon d="M4 21V4m0 0l8 5 8-5v12l-8 5-8-5z" size={20} />
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="text-lg font-bold text-white">Report this question</h2>
                <p className="mt-0.5 text-xs text-white/50">Tell us what looks wrong so your examiner can review it.</p>
              </div>
              <button onClick={() => !reportSubmitting && setReportingQuestionId(null)} className="rounded-md p-1.5 text-white/40 hover:bg-white/5 hover:text-white">
                <Icon d="M18 6L6 18M6 6l12 12" size={16} />
              </button>
            </div>

            <div className="space-y-2">
              <label className="text-[10px] font-semibold uppercase tracking-wider text-white/50">Reason</label>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { v: "TYPO" as const,         l: "Typo / spelling" },
                  { v: "WRONG_ANSWER" as const, l: "Wrong correct answer" },
                  { v: "UNCLEAR" as const,      l: "Unclear wording" },
                  { v: "OTHER" as const,        l: "Other" },
                ].map((opt) => {
                  const active = reportReason === opt.v;
                  return (
                    <button key={opt.v} onClick={() => setReportReason(opt.v)} type="button"
                      className={`rounded-lg border px-3 py-2 text-xs font-medium transition ${active ? "border-amber-400/50 bg-amber-500/15 text-amber-200" : "border-white/10 bg-white/5 text-white/70 hover:bg-white/10"}`}>
                      {opt.l}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-[10px] font-semibold uppercase tracking-wider text-white/50">Optional details</label>
              <textarea
                rows={3}
                value={reportMessage}
                onChange={(e) => setReportMessage(e.target.value.slice(0, 1000))}
                placeholder="Describe what's wrong with this question…"
                className="auth-input w-full rounded-lg px-3 py-2 text-sm leading-relaxed"
              />
              <p className="text-right text-[10px] text-white/30">{reportMessage.length} / 1000</p>
            </div>

            {reportError && <p className="text-xs text-rose-400">{reportError}</p>}

            <div className="flex items-center justify-end gap-2">
              <button onClick={() => setReportingQuestionId(null)} disabled={reportSubmitting}
                className="rounded-md border border-white/10 bg-white/5 px-4 py-2 text-xs font-medium text-white/70 hover:bg-white/10">
                Cancel
              </button>
              <button onClick={submitReport} disabled={reportSubmitting}
                className="inline-flex items-center gap-2 rounded-md bg-gradient-to-r from-amber-500 to-orange-500 px-4 py-2 text-xs font-semibold text-white disabled:opacity-50">
                {reportSubmitting ? "Submitting…" : "Submit report"}
              </button>
            </div>
          </div>
        </div>
      )}
      </div>
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
