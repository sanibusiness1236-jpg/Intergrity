"use client";

export const dynamic = "force-dynamic";

import { useCallback, useEffect, useState } from "react";
import {
  AreaChart, Area, BarChart, Bar, LineChart, Line,
  PieChart, Pie, ScatterChart, Scatter, ZAxis,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, Legend,
} from "recharts";
import api from "@/lib/api";
import { DashboardShell, GlowButton, GlowCard } from "@/components/dashboard/DashboardShell";
import { GradientHeading } from "@/components/dashboard/GradientHeading";
import { StatCard } from "@/components/dashboard/StatCard";
import type { Exam } from "@/types";

/* ── Types ─────────────────────────────────────────────────── */

interface ExamStats {
  totalSubmissions: number; maxPossibleScore: number; averageScore: number;
  highestScore: number; lowestScore: number; medianScore: number;
  standardDeviation: number; passRate: string | null;
  scoreDistribution: Record<string, number>;
  byGender: Record<string, { count: number; averageScore: number }>;
  byProgram: Record<string, { count: number; averageScore: number }>;
}
interface GradeData { boundaries: Record<string, number>; grades: Record<string, number>; totalStudents: number; }
interface StudentScore {
  rank: number; sessionId: string;
  student: { id: string; firstName: string; lastName: string; studentId?: string; program?: string; gender?: string };
  score: number; maxScore: number; percentage: number; durationMinutes: number | null; submittedAt: string | null;
}
interface QuestionStat {
  questionId: string; questionNumber: number; text: string; type: string; marks: number;
  totalAnswered: number; correct: number; incorrect: number; skipped: number;
  correctRate: number; difficulty: "Easy" | "Medium" | "Hard";
}
interface TimingRow { sessionId: string; student: { firstName: string; lastName: string; studentId?: string }; durationMinutes: number; score: number; }
interface TimeData {
  avgDurationMinutes: number; fastestMinutes: number; slowestMinutes: number;
  allowedMinutes: number | null; suspiciousThresholdMinutes: number;
  sessions: TimingRow[]; fastest: TimingRow[]; suspicious: TimingRow[];
}
interface LeaderboardEntry { rank: number; student: { firstName: string; lastName: string; studentId?: string; program?: string }; score: number; maxScore: number; percentage: number; }
interface ScaledRow { sessionId: string; student: { firstName: string; lastName: string; studentId?: string }; rawScore: number; scaledScore: number; }
interface ScaledData { method: string; targetMax: number; rawMax: number; scaled: ScaledRow[]; summary: { rawMean: number; scaledMean: number; scaledMin: number; scaledMax: number }; }
interface CourseEntry { examId: string; courseCode: string; courseName: string; title: string; submissions: number; averageScore: number; }

/* ── Constants ─────────────────────────────────────────────── */

const COLORS = ["#818cf8", "#34d399", "#fbbf24", "#fb923c", "#f87171", "#60a5fa", "#a78bfa", "#f472b6"];
const GRADE_COLORS: Record<string, string> = { A: "#34d399", B: "#60a5fa", C: "#fbbf24", D: "#fb923c", F: "#f87171" };
const TOOLTIP_STYLE = { backgroundColor: "rgba(15,23,42,0.95)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "8px", color: "white" };
const DIFF_COLOR = { Hard: "text-rose-400 bg-rose-500/10 border-rose-500/20", Medium: "text-amber-400 bg-amber-500/10 border-amber-500/20", Easy: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20" };

const SCALING_METHODS = [
  { value: "linear", label: "Linear", desc: "Raw % of target" },
  { value: "minmax", label: "Min-Max", desc: "Stretch to target" },
  { value: "zscore", label: "Z-Score", desc: "Mean 65 · σ 15" },
  { value: "sqrt", label: "√ Root", desc: "Boost low scores" },
];

type NavItem = { id: string; label: string };
type NavSection = { id: string; label: string; icon: string; items: NavItem[] };

const NAV_TREE: NavSection[] = [
  { id: "overview", label: "Overview", icon: "M3 3v18h18M7 14l4-4 4 4 5-5",
    items: [{ id: "overview.performance", label: "Exam Performance" }, { id: "overview.pass_fail", label: "Pass & Fail Rates" }, { id: "overview.summary", label: "Score Summary" }] },
  { id: "students", label: "Student Analytics", icon: "M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z",
    items: [{ id: "students.scores", label: "Student Scores" }, { id: "students.distribution", label: "Score Distribution" }, { id: "students.trends", label: "Performance Trends" }, { id: "students.completion", label: "Completion Time" }] },
  { id: "questions", label: "Question Analytics", icon: "M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z",
    items: [{ id: "questions.performance", label: "Question Performance" }, { id: "questions.hardest", label: "Hardest Questions" }, { id: "questions.easiest", label: "Easiest Questions" }, { id: "questions.failed", label: "Most Failed" }, { id: "questions.skipped", label: "Most Skipped" }] },
  { id: "classdept", label: "Class & Department", icon: "M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4",
    items: [{ id: "classdept.class", label: "Class Comparison" }, { id: "classdept.dept", label: "Department Comparison" }, { id: "classdept.course", label: "Course Analytics" }, { id: "classdept.sessions", label: "Session Analytics" }] },
  { id: "time", label: "Time Analytics", icon: "M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0",
    items: [{ id: "time.avg", label: "Avg Completion Time" }, { id: "time.fastest", label: "Fastest Submissions" }, { id: "time.suspicious", label: "Suspicious Attempts" }, { id: "time.perq", label: "Time Per Question" }] },
  { id: "leaderboard", label: "Leaderboards", icon: "M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z",
    items: [{ id: "leaderboard.top", label: "Top Students" }, { id: "leaderboard.classes", label: "Top Classes" }, { id: "leaderboard.scaling", label: "Scale Results" }] },
  { id: "export", label: "Reports & Export", icon: "M12 10v6m0 0l-3-3m3 3l3-3M3 17V7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z",
    items: [{ id: "export.csv", label: "Export CSV" }, { id: "export.pdf", label: "Export PDF" }, { id: "export.report", label: "Full Report" }] },
  { id: "settings", label: "Settings", icon: "M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z",
    items: [{ id: "settings.prefs", label: "Analytics Preferences" }, { id: "settings.thresholds", label: "Score Thresholds" }] },
];

/* ── Small helpers ─────────────────────────────────────────── */

const Svg = ({ d, size = 16 }: { d: string; size?: number }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
);

const Spinner = () => (
  <div className="flex items-center justify-center py-20">
    <svg className="h-8 w-8 animate-spin text-indigo-400" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25" />
      <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  </div>
);

const Empty = ({ msg }: { msg: string }) => (
  <div className="flex flex-col items-center justify-center py-20 text-center">
    <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-white/5 ring-1 ring-white/10">
      <Svg d="M9 12h6M9 16h6M9 8h6M5 3h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2z" size={22} />
    </div>
    <p className="text-sm text-white/50">{msg}</p>
  </div>
);

function downloadCSV(filename: string, headers: string[], rows: (string | number | null)[][]) {
  const escape = (v: string | number | null) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const csv = [headers, ...rows].map((r) => r.map(escape).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

/* ── Main page ─────────────────────────────────────────────── */

export default function AnalyticsPage() {
  const [exams, setExams] = useState<Exam[]>([]);
  const [selectedExamId, setSelectedExamId] = useState("");
  const [activeItem, setActiveItem] = useState("overview.performance");
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(["overview"]));

  // data
  const [stats, setStats] = useState<ExamStats | null>(null);
  const [grades, setGrades] = useState<GradeData | null>(null);
  const [studentScores, setStudentScores] = useState<StudentScore[] | null>(null);
  const [questionStats, setQuestionStats] = useState<QuestionStat[] | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[] | null>(null);
  const [timeData, setTimeData] = useState<TimeData | null>(null);
  const [courseAnalytics, setCourseAnalytics] = useState<CourseEntry[] | null>(null);
  const [sessionSummary, setSessionSummary] = useState<Record<string, number> | null>(null);
  const [scaled, setScaled] = useState<ScaledData | null>(null);

  // loading
  const [mainLoading, setMainLoading] = useState(false);
  const [sectionLoading, setSectionLoading] = useState(false);

  // settings / config
  const [scaleMethod, setScaleMethod] = useState("linear");
  const [scaleTarget, setScaleTarget] = useState<number | "">(100);
  const [passThreshold, setPassThreshold] = useState(50);
  const [sortStudents, setSortStudents] = useState<"rank" | "name" | "time">("rank");
  const [studentSearch, setStudentSearch] = useState("");

  const selectedExam = exams.find((e) => e.id === selectedExamId);

  useEffect(() => {
    api.get("/exams").then(({ data }) => setExams(data.data || [])).catch(() => {});
  }, []);

  async function loadMain() {
    if (!selectedExamId) return;
    setMainLoading(true);
    setStats(null); setGrades(null); setStudentScores(null); setQuestionStats(null);
    setLeaderboard(null); setTimeData(null); setScaled(null); setSessionSummary(null);
    try {
      const [statsRes, gradesRes] = await Promise.all([
        api.get(`/analytics/exam/${selectedExamId}`),
        api.get(`/analytics/exam/${selectedExamId}/grades`),
      ]);
      setStats(statsRes.data.data.stats || statsRes.data.data);
      setGrades(gradesRes.data.data);
      setActiveItem("overview.performance");
      setExpandedSections(new Set(["overview"]));
    } catch {
      setStats(null);
    } finally {
      setMainLoading(false);
    }
  }

  const loadSectionData = useCallback(async (section: string) => {
    if (!selectedExamId) return;
    setSectionLoading(true);
    try {
      if (section === "students" && !studentScores) {
        const { data } = await api.get(`/analytics/exam/${selectedExamId}/students`);
        setStudentScores(data.data);
      }
      if (section === "questions" && !questionStats) {
        const { data } = await api.get(`/analytics/exam/${selectedExamId}/questions`);
        setQuestionStats(data.data);
      }
      if ((section === "leaderboard") && !leaderboard) {
        const { data } = await api.get(`/analytics/exam/${selectedExamId}/leaderboard`);
        setLeaderboard(data.data);
      }
      if (section === "time" && !timeData) {
        const { data } = await api.get(`/analytics/exam/${selectedExamId}/time`);
        setTimeData(data.data);
      }
      if (section === "classdept") {
        if (!sessionSummary) {
          const { data } = await api.get(`/analytics/exam/${selectedExamId}/sessions`);
          setSessionSummary(data.data);
        }
        if (!courseAnalytics && selectedExam?.institutionId) {
          const { data } = await api.get(`/analytics/institution/${selectedExam.institutionId}`);
          setCourseAnalytics(data.data);
        }
      }
    } finally {
      setSectionLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedExamId, studentScores, questionStats, leaderboard, timeData, sessionSummary, courseAnalytics, selectedExam]);

  function handleNav(itemId: string) {
    setActiveItem(itemId);
    loadSectionData(itemId.split(".")[0]);
  }

  function toggleSection(sectionId: string) {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(sectionId)) next.delete(sectionId);
      else next.add(sectionId);
      return next;
    });
  }

  async function applyScaling() {
    if (!selectedExamId) return;
    const target = Number(scaleTarget) || 100;
    const { data } = await api.get(`/analytics/exam/${selectedExamId}/scaled`, {
      params: { method: scaleMethod, targetMax: target },
    });
    setScaled(data.data);
  }

  // ── pass rate derived from settings threshold
  const passRate = (() => {
    if (!studentScores || studentScores.length === 0) {
      if (!stats) return null;
      return stats.passRate;
    }
    const passed = studentScores.filter((s) => s.percentage >= passThreshold).length;
    return ((passed / studentScores.length) * 100).toFixed(1);
  })();

  // ── sorted / filtered students
  const displayedStudents = (() => {
    if (!studentScores) return [];
    let list = [...studentScores];
    if (studentSearch.trim()) {
      const q = studentSearch.toLowerCase();
      list = list.filter((s) => `${s.student.firstName} ${s.student.lastName}`.toLowerCase().includes(q) || (s.student.studentId || "").toLowerCase().includes(q));
    }
    if (sortStudents === "name") list.sort((a, b) => a.student.lastName.localeCompare(b.student.lastName));
    else if (sortStudents === "time") list.sort((a, b) => (a.durationMinutes ?? 999) - (b.durationMinutes ?? 999));
    else list.sort((a, b) => a.rank - b.rank);
    return list;
  })();

  /* ── Content renderer ──────────────────────────────────── */

  function renderContent() {
    if (!stats) return null;
    const [section, sub] = activeItem.split(".");

    if (section === "overview") return <OverviewSection stats={stats} grades={grades} passRate={passRate} sub={sub} />;
    if (section === "students") return <StudentsSection stats={stats} scores={displayedStudents} allScores={studentScores} loading={sectionLoading} sub={sub} studentSearch={studentSearch} setStudentSearch={setStudentSearch} sortStudents={sortStudents} setSortStudents={setSortStudents} passThreshold={passThreshold} />;
    if (section === "questions") return <QuestionsSection data={questionStats} loading={sectionLoading} sub={sub} />;
    if (section === "classdept") return <ClassDeptSection stats={stats} sessionSummary={sessionSummary} courseAnalytics={courseAnalytics} loading={sectionLoading} sub={sub} />;
    if (section === "time") return <TimeSection data={timeData} loading={sectionLoading} sub={sub} selectedExam={selectedExam} />;
    if (section === "leaderboard") return <LeaderboardSection leaderboard={leaderboard} loading={sectionLoading} sub={sub} scaled={scaled} scaleMethod={scaleMethod} setScaleMethod={setScaleMethod} scaleTarget={scaleTarget} setScaleTarget={setScaleTarget} applyScaling={applyScaling} />;
    if (section === "export") return <ExportSection stats={stats} grades={grades} studentScores={studentScores} questionStats={questionStats} selectedExam={selectedExam} sub={sub} />;
    if (section === "settings") return <SettingsSection passThreshold={passThreshold} setPassThreshold={setPassThreshold} scaleMethod={scaleMethod} setScaleMethod={setScaleMethod} scaleTarget={scaleTarget} setScaleTarget={setScaleTarget} sub={sub} />;
    return null;
  }

  /* ── Render ────────────────────────────────────────────── */

  return (
    <DashboardShell>
      <header className="mb-8">
        <GradientHeading
          highlight="Scores"
          title="& Analytics."
          subtitle="Deep-dive into exam performance — student scores, grade distributions, question difficulty, time analysis, and class comparisons."
        />
      </header>

      {/* Exam selector */}
      <GlowCard className="mb-6" title="Select Exam" description="Choose an exam to analyse">
        <div className="flex flex-wrap items-end gap-4">
          <div className="min-w-[260px] flex-1 space-y-1.5">
            <label className="text-[10px] font-semibold uppercase tracking-wider text-white/50">Exam</label>
            <select
              className="auth-input flex h-11 w-full rounded-lg px-3 text-sm"
              value={selectedExamId}
              onChange={(e) => setSelectedExamId(e.target.value)}
            >
              <option value="" className="bg-slate-900">Choose an exam…</option>
              {exams.map((e) => (
                <option key={e.id} value={e.id} className="bg-slate-900">{e.title} ({e.courseCode})</option>
              ))}
            </select>
          </div>
          <GlowButton onClick={loadMain} disabled={!selectedExamId || mainLoading} variant="gradient" size="lg">
            {mainLoading ? (
              <span className="flex items-center gap-2">
                <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25" />
                  <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                </svg>
                Loading…
              </span>
            ) : "Load Analytics"}
          </GlowButton>
        </div>
        {selectedExam && (
          <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-white/5 bg-white/[0.02] p-3 text-xs">
            <span className="font-semibold text-white">{selectedExam.title}</span>
            <span className="text-white/30">·</span>
            <span className="rounded bg-indigo-500/15 px-2 py-0.5 text-indigo-300">{selectedExam.courseCode}</span>
            <span className="text-white/30">·</span>
            <span className="text-white/40">{selectedExam.status}</span>
            {stats && <><span className="text-white/30">·</span><span className="text-white/40">{stats.totalSubmissions} submission{stats.totalSubmissions !== 1 ? "s" : ""}</span></>}
          </div>
        )}
      </GlowCard>

      {!stats && !mainLoading && (
        <GlowCard className="text-center">
          <div className="py-16">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500/20 to-purple-500/20 ring-1 ring-white/10">
              <Svg d="M3 3v18h18M7 14l4-4 4 4 5-5" size={28} />
            </div>
            <p className="text-lg font-medium text-white">Select an exam and click Load Analytics</p>
          </div>
        </GlowCard>
      )}

      {stats && (
        <div className="flex flex-col gap-4 lg:flex-row lg:gap-5">
          {/* ── Left sidebar nav ── */}
          <aside className="w-full lg:w-56 lg:shrink-0">
            <div className="lg:sticky lg:top-6 space-y-1 rounded-xl border border-white/5 bg-slate-950/60 p-2 backdrop-blur-xl">
              {NAV_TREE.map((sec) => {
                const isExpanded = expandedSections.has(sec.id);
                const isActive = activeItem.startsWith(sec.id + ".");
                return (
                  <div key={sec.id}>
                    <button
                      onClick={() => { toggleSection(sec.id); if (!isExpanded) handleNav(`${sec.id}.${sec.items[0].id.split(".")[1]}`); }}
                      className={`flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-xs font-semibold transition ${isActive ? "bg-indigo-500/15 text-indigo-300" : "text-white/60 hover:bg-white/5 hover:text-white"}`}
                    >
                      <Svg d={sec.icon} size={14} />
                      <span className="flex-1 truncate">{sec.label}</span>
                      <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5" className={`shrink-0 transition-transform ${isExpanded ? "rotate-180" : ""}`}><path d="M6 9l6 6 6-6" strokeLinecap="round" /></svg>
                    </button>
                    {isExpanded && (
                      <div className="ml-2 mt-0.5 space-y-0.5 border-l border-white/5 pl-3">
                        {sec.items.map((item) => (
                          <button
                            key={item.id}
                            onClick={() => handleNav(item.id)}
                            className={`block w-full rounded-md px-2.5 py-1.5 text-left text-[11px] transition ${activeItem === item.id ? "bg-white/10 font-medium text-white" : "text-white/40 hover:bg-white/5 hover:text-white"}`}
                          >
                            {item.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </aside>

          {/* ── Main content ── */}
          <div className="min-w-0 flex-1">
            {renderContent()}
          </div>
        </div>
      )}
    </DashboardShell>
  );
}

/* ════════════════════════════════════════════════════════════ */
/*  Section components                                         */
/* ════════════════════════════════════════════════════════════ */

/* ── Overview ───────────────────────────────────────────────── */

function OverviewSection({ stats, grades, passRate, sub }: { stats: ExamStats; grades: GradeData | null; passRate: string | null; sub: string }) {
  const gradeData = grades ? Object.entries(grades.grades).map(([g, c]) => ({
    grade: g, students: c,
    percentage: grades.totalStudents > 0 ? Number(((c / grades.totalStudents) * 100).toFixed(1)) : 0,
    fill: GRADE_COLORS[g] || "#818cf8",
  })) : [];

  const distData = stats.scoreDistribution ? Object.entries(stats.scoreDistribution).map(([range, count]) => ({ range, count })) : [];

  if (sub === "pass_fail") return (
    <div className="space-y-6">
      <SectionHeader title="Pass & Fail Rates" desc="Distribution of students above and below the pass threshold" />
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard label="Total Students" value={stats.totalSubmissions} accent="indigo" icon={<Svg d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />} />
        <StatCard label="Pass Rate" value={passRate ? `${passRate}%` : "—"} accent="emerald" icon={<Svg d="M5 13l4 4L19 7" />} />
        <StatCard label="Fail Rate" value={passRate ? `${(100 - Number(passRate)).toFixed(1)}%` : "—"} accent="rose" icon={<Svg d="M6 18L18 6M6 6l12 12" />} />
        <StatCard label="Highest Score" value={stats.highestScore ?? "—"} accent="purple" icon={<Svg d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />} />
      </div>
      {grades && (
        <GlowCard title="Grade Distribution">
          <ResponsiveContainer width="100%" height={280}>
            <PieChart>
              <Pie data={gradeData} dataKey="students" nameKey="grade" cx="50%" cy="50%" outerRadius={100} innerRadius={50} paddingAngle={3} label={({ grade, percentage }) => `${grade} ${percentage}%`} labelLine={{ stroke: "rgba(255,255,255,0.2)" }}>
                {gradeData.map((d) => <Cell key={d.grade} fill={d.fill} />)}
              </Pie>
              <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number, name: string, entry: any) => [`${v} (${entry.payload.percentage}%)`, name]} />
              <Legend formatter={(v) => <span style={{ color: "rgba(255,255,255,0.7)", fontSize: 12 }}>{v}</span>} />
            </PieChart>
          </ResponsiveContainer>
        </GlowCard>
      )}
    </div>
  );

  if (sub === "summary") return (
    <div className="space-y-6">
      <SectionHeader title="Score Summary" desc="Descriptive statistics for this exam" />
      <GlowCard>
        <ul className="divide-y divide-white/5">
          {[
            { label: "Total Submissions", value: stats.totalSubmissions },
            { label: "Max Possible Score", value: stats.maxPossibleScore },
            { label: "Average Score", value: stats.averageScore?.toFixed(2) },
            { label: "Median Score", value: stats.medianScore?.toFixed(2) },
            { label: "Highest Score", value: stats.highestScore },
            { label: "Lowest Score", value: stats.lowestScore },
            { label: "Standard Deviation", value: stats.standardDeviation?.toFixed(3) },
            { label: "Pass Rate", value: passRate ? `${passRate}%` : "—" },
          ].map((r) => (
            <li key={r.label} className="flex items-center justify-between py-3 text-sm">
              <span className="text-white/50">{r.label}</span>
              <span className="font-semibold text-white">{r.value}</span>
            </li>
          ))}
        </ul>
      </GlowCard>
    </div>
  );

  // default: performance
  return (
    <div className="space-y-6">
      <SectionHeader title="Exam Performance" desc="High-level performance overview for all submissions" />
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard label="Submissions" value={stats.totalSubmissions} accent="indigo" icon={<Svg d="M9 12h6M9 16h6M9 8h6M5 3h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2z" />} />
        <StatCard label="Average Score" value={stats.averageScore?.toFixed(1) ?? "—"} accent="blue" icon={<Svg d="M3 3v18h18M7 14l4-4 4 4 5-5" />} />
        <StatCard label="Highest Score" value={stats.highestScore ?? "—"} accent="emerald" icon={<Svg d="M5 13l4 4L19 7" />} />
        <StatCard label="Pass Rate" value={passRate ? `${passRate}%` : "—"} accent="purple" icon={<Svg d="M9 12l2 2 4-4M12 2a10 10 0 100 20 10 10 0 000-20z" />} />
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {distData.length > 0 && (
          <GlowCard title="Score Distribution" description="Number of students per score band">
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={distData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                <XAxis dataKey="range" tick={{ fontSize: 10, fill: "rgba(255,255,255,0.5)" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: "rgba(255,255,255,0.5)" }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={TOOLTIP_STYLE} />
                <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                  {distData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </GlowCard>
        )}
        {grades && gradeData.length > 0 && (
          <GlowCard title="Grade Breakdown" description={`${grades.totalStudents} students graded`}>
            <div className="mb-3 flex flex-wrap gap-2">
              {gradeData.map((d) => (
                <div key={d.grade} className="flex items-center gap-1.5 rounded-lg border border-white/5 bg-white/[0.02] px-2.5 py-1.5">
                  <span className="flex h-6 w-6 items-center justify-center rounded text-[10px] font-bold text-slate-950" style={{ backgroundColor: d.fill }}>{d.grade}</span>
                  <span className="text-xs font-medium text-white">{d.students}</span>
                  <span className="text-[10px] text-white/40">{d.percentage}%</span>
                </div>
              ))}
            </div>
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={gradeData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                <XAxis dataKey="grade" tick={{ fontSize: 12, fontWeight: "bold", fill: "rgba(255,255,255,0.7)" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: "rgba(255,255,255,0.5)" }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number, _n: string, e: any) => [`${v} (${e.payload.percentage}%)`, "Students"]} />
                <Bar dataKey="students" radius={[4, 4, 0, 0]}>{gradeData.map((d) => <Cell key={d.grade} fill={d.fill} />)}</Bar>
              </BarChart>
            </ResponsiveContainer>
          </GlowCard>
        )}
      </div>
    </div>
  );
}

/* ── Students ───────────────────────────────────────────────── */

function StudentsSection({ stats, scores, allScores, loading, sub, studentSearch, setStudentSearch, sortStudents, setSortStudents, passThreshold }: {
  stats: ExamStats; scores: StudentScore[]; allScores: StudentScore[] | null;
  loading: boolean; sub: string; studentSearch: string; setStudentSearch: (v: string) => void;
  sortStudents: "rank" | "name" | "time"; setSortStudents: (v: "rank" | "name" | "time") => void;
  passThreshold: number;
}) {
  if (loading && !allScores) return <Spinner />;

  if (sub === "distribution") {
    const distData = stats.scoreDistribution ? Object.entries(stats.scoreDistribution).map(([range, count]) => ({ range, count })) : [];
    const scatterData = allScores?.map((s, i) => ({ x: s.percentage, y: i + 1, student: `${s.student.firstName} ${s.student.lastName}` })) ?? [];
    return (
      <div className="space-y-6">
        <SectionHeader title="Score Distribution" desc="Visual breakdown of how scores are spread across students" />
        <div className="grid gap-6 lg:grid-cols-2">
          <GlowCard title="Distribution Histogram" description="Students per score band">
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={distData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                <XAxis dataKey="range" tick={{ fontSize: 10, fill: "rgba(255,255,255,0.5)" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: "rgba(255,255,255,0.5)" }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={TOOLTIP_STYLE} />
                <Bar dataKey="count" fill="#818cf8" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </GlowCard>
          {scatterData.length > 0 && (
            <GlowCard title="Score Scatter" description="Each dot = one student (X = score %, Y = rank)">
              <ResponsiveContainer width="100%" height={260}>
                <ScatterChart margin={{ top: 8, right: 20, left: 0, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                  <XAxis dataKey="x" name="Score %" type="number" domain={[0, 100]} tick={{ fontSize: 10, fill: "rgba(255,255,255,0.5)" }} axisLine={false} tickLine={false} label={{ value: "Score %", position: "insideBottom", offset: -4, fill: "rgba(255,255,255,0.3)", fontSize: 10 }} />
                  <YAxis dataKey="y" name="Student #" tick={{ fontSize: 10, fill: "rgba(255,255,255,0.5)" }} axisLine={false} tickLine={false} />
                  <ZAxis range={[40, 40]} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} content={({ active, payload }) => active && payload?.length ? <div style={TOOLTIP_STYLE} className="px-3 py-2 text-xs"><p className="font-semibold text-white">{payload[0]?.payload?.student}</p><p className="text-white/50">Score: {payload[0]?.payload?.x}%</p></div> : null} />
                  <Scatter data={scatterData} fill="#818cf8" />
                </ScatterChart>
              </ResponsiveContainer>
            </GlowCard>
          )}
        </div>
      </div>
    );
  }

  if (sub === "trends") {
    const trendData = allScores ? [...allScores].sort((a, b) => a.rank - b.rank).map((s, i) => ({ index: i + 1, score: s.score, pct: s.percentage })) : [];
    return (
      <div className="space-y-6">
        <SectionHeader title="Performance Trends" desc="Score trajectory across all submissions (ranked order)" />
        <GlowCard title="Score Trend" description="Scores plotted by rank — shows overall class performance curve">
          <ResponsiveContainer width="100%" height={300}>
            <AreaChart data={trendData} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="sg" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#818cf8" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#818cf8" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
              <XAxis dataKey="index" tick={{ fontSize: 10, fill: "rgba(255,255,255,0.4)" }} axisLine={false} tickLine={false} label={{ value: "Student (by rank)", position: "insideBottom", offset: -4, fill: "rgba(255,255,255,0.3)", fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10, fill: "rgba(255,255,255,0.4)" }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number) => [`${v}%`, "Score %"]} />
              <Area type="monotone" dataKey="pct" stroke="#818cf8" strokeWidth={2} fill="url(#sg)" dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </GlowCard>
      </div>
    );
  }

  if (sub === "completion") {
    const completionData = allScores?.filter((s) => s.durationMinutes != null).map((s) => ({
      name: `${s.student.firstName} ${s.student.lastName}`.substring(0, 16),
      minutes: s.durationMinutes,
      score: s.percentage,
    })) ?? [];
    return (
      <div className="space-y-6">
        <SectionHeader title="Completion Time" desc="How long each student took to complete the exam" />
        {completionData.length === 0 ? <Empty msg="No completion time data available" /> : (
          <GlowCard title="Completion Time per Student" description="Minutes taken (sorted by time)">
            <ResponsiveContainer width="100%" height={340}>
              <BarChart data={[...completionData].sort((a, b) => (a.minutes ?? 0) - (b.minutes ?? 0))} layout="vertical" margin={{ top: 4, right: 20, left: 80, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 10, fill: "rgba(255,255,255,0.4)" }} axisLine={false} tickLine={false} />
                <YAxis dataKey="name" type="category" tick={{ fontSize: 10, fill: "rgba(255,255,255,0.5)" }} axisLine={false} tickLine={false} width={76} />
                <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number) => [`${v} min`, "Time"]} />
                <Bar dataKey="minutes" fill="#60a5fa" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </GlowCard>
        )}
      </div>
    );
  }

  // default: student scores table
  return (
    <div className="space-y-4">
      <SectionHeader title="Student Scores" desc="Individual scores for all students who submitted" />
      <div className="flex flex-wrap items-center gap-3">
        <input
          className="auth-input h-9 w-52 rounded-lg px-3 text-sm"
          placeholder="Search by name or ID…"
          value={studentSearch}
          onChange={(e) => setStudentSearch(e.target.value)}
        />
        <div className="flex gap-1 rounded-lg border border-white/10 bg-white/[0.02] p-1 text-xs">
          {(["rank", "name", "time"] as const).map((s) => (
            <button key={s} onClick={() => setSortStudents(s)} className={`rounded-md px-3 py-1.5 font-medium capitalize transition ${sortStudents === s ? "bg-white/10 text-white" : "text-white/40 hover:text-white"}`}>{s}</button>
          ))}
        </div>
        <span className="ml-auto text-xs text-white/30">{scores.length} student{scores.length !== 1 ? "s" : ""}</span>
      </div>
      {scores.length === 0 ? <Empty msg="No student data loaded yet" /> : (
        <div className="overflow-x-auto rounded-xl border border-white/10">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10 bg-slate-950/80 backdrop-blur">
              <tr>
                {["#", "Student", "ID", "Program", "Score", "%", "Grade", "Time (min)"].map((h) => (
                  <th key={h} className="border-b border-white/10 p-3 text-left text-[10px] font-semibold uppercase tracking-wider text-white/40">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {scores.map((s) => {
                const isPassed = s.percentage >= passThreshold;
                return (
                  <tr key={s.sessionId} className="border-b border-white/5 transition hover:bg-white/[0.03]">
                    <td className="p-3 font-bold text-white/40">{s.rank}</td>
                    <td className="p-3 font-medium text-white">{s.student.firstName} {s.student.lastName}</td>
                    <td className="p-3 text-white/50">{s.student.studentId || "—"}</td>
                    <td className="p-3 text-white/40">{s.student.program || "—"}</td>
                    <td className="p-3 font-semibold text-white">{s.score} / {s.maxScore}</td>
                    <td className={`p-3 font-bold ${isPassed ? "text-emerald-400" : "text-rose-400"}`}>{s.percentage}%</td>
                    <td className="p-3">
                      <span className={`rounded px-2 py-0.5 text-[10px] font-bold ${isPassed ? "bg-emerald-500/15 text-emerald-300" : "bg-rose-500/15 text-rose-300"}`}>{isPassed ? "PASS" : "FAIL"}</span>
                    </td>
                    <td className="p-3 text-white/50">{s.durationMinutes ?? "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ── Questions ──────────────────────────────────────────────── */

function QuestionsSection({ data, loading, sub }: { data: QuestionStat[] | null; loading: boolean; sub: string }) {
  if (loading && !data) return <Spinner />;
  if (!data) return <Empty msg="No question data loaded" />;

  const sorted = [...data];
  if (sub === "hardest") sorted.sort((a, b) => a.correctRate - b.correctRate);
  else if (sub === "easiest") sorted.sort((a, b) => b.correctRate - a.correctRate);
  else if (sub === "failed") sorted.sort((a, b) => b.incorrect - a.incorrect);
  else if (sub === "skipped") sorted.sort((a, b) => b.skipped - a.skipped);

  const titles: Record<string, string> = {
    performance: "Question Performance", hardest: "Hardest Questions", easiest: "Easiest Questions",
    failed: "Most Failed Questions", skipped: "Most Skipped Questions",
  };
  const descs: Record<string, string> = {
    performance: "Correct answer rate and difficulty for each question",
    hardest: "Questions with the lowest correct-answer rate",
    easiest: "Questions with the highest correct-answer rate",
    failed: "Questions with the most incorrect answers",
    skipped: "Questions most often left unanswered",
  };

  const chartData = sorted.slice(0, 15).map((q) => ({
    label: `Q${q.questionNumber}`,
    correct: q.correct,
    incorrect: q.incorrect,
    skipped: q.skipped,
    rate: q.correctRate,
  }));

  return (
    <div className="space-y-6">
      <SectionHeader title={titles[sub] || "Question Performance"} desc={descs[sub] || ""} />
      <GlowCard title="Correct Rate by Question" description="Green = correct · Red = incorrect · Grey = skipped">
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: "rgba(255,255,255,0.5)" }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 10, fill: "rgba(255,255,255,0.4)" }} axisLine={false} tickLine={false} />
            <Tooltip contentStyle={TOOLTIP_STYLE} />
            <Bar dataKey="correct" stackId="a" fill="#34d399" radius={[0, 0, 0, 0]} name="Correct" />
            <Bar dataKey="incorrect" stackId="a" fill="#f87171" name="Incorrect" />
            <Bar dataKey="skipped" stackId="a" fill="#475569" radius={[4, 4, 0, 0]} name="Skipped" />
            <Legend formatter={(v) => <span style={{ color: "rgba(255,255,255,0.6)", fontSize: 11 }}>{v}</span>} />
          </BarChart>
        </ResponsiveContainer>
      </GlowCard>
      <div className="overflow-x-auto rounded-xl border border-white/10">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-slate-950/80 backdrop-blur">
            <tr>
              {["#", "Question", "Type", "Pts", "Answered", "Correct", "Wrong", "Skipped", "Rate", "Difficulty"].map((h) => (
                <th key={h} className="border-b border-white/10 p-3 text-left text-[10px] font-semibold uppercase tracking-wider text-white/40">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((q) => (
              <tr key={q.questionId} className="border-b border-white/5 hover:bg-white/[0.03]">
                <td className="p-3 font-bold text-white/40">{q.questionNumber}</td>
                <td className="max-w-[200px] truncate p-3 text-white/80" title={q.text}>{q.text}</td>
                <td className="p-3 text-[10px] text-white/40">{q.type}</td>
                <td className="p-3 text-white/60">{q.marks}</td>
                <td className="p-3 text-white/60">{q.totalAnswered}</td>
                <td className="p-3 font-semibold text-emerald-400">{q.correct}</td>
                <td className="p-3 font-semibold text-rose-400">{q.incorrect}</td>
                <td className="p-3 text-white/40">{q.skipped}</td>
                <td className="p-3 font-bold text-white">{q.correctRate}%</td>
                <td className="p-3">
                  <span className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold ${DIFF_COLOR[q.difficulty]}`}>{q.difficulty}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ── Class & Dept ───────────────────────────────────────────── */

function ClassDeptSection({ stats, sessionSummary, courseAnalytics, loading, sub }: {
  stats: ExamStats; sessionSummary: Record<string, number> | null;
  courseAnalytics: CourseEntry[] | null; loading: boolean; sub: string;
}) {
  if (loading && !sessionSummary) return <Spinner />;

  if (sub === "sessions") {
    const sessionData = sessionSummary ? Object.entries(sessionSummary).map(([status, count]) => ({ status, count })) : [];
    return (
      <div className="space-y-6">
        <SectionHeader title="Session Analytics" desc="Breakdown of exam session statuses" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {sessionData.map((d, i) => (
            <div key={d.status} className="rounded-xl border border-white/5 bg-white/[0.02] p-4">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-white/40">{d.status}</p>
              <p className="mt-1 text-2xl font-bold" style={{ color: COLORS[i % COLORS.length] }}>{d.count}</p>
            </div>
          ))}
        </div>
        {sessionData.length > 0 && (
          <GlowCard title="Session Status Chart">
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie data={sessionData} dataKey="count" nameKey="status" cx="50%" cy="50%" outerRadius={90} innerRadius={40} paddingAngle={3} label={({ status, percent }) => `${status} ${(percent * 100).toFixed(0)}%`} labelLine={{ stroke: "rgba(255,255,255,0.2)" }}>
                  {sessionData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie>
                <Tooltip contentStyle={TOOLTIP_STYLE} />
              </PieChart>
            </ResponsiveContainer>
          </GlowCard>
        )}
      </div>
    );
  }

  if (sub === "course") {
    return (
      <div className="space-y-6">
        <SectionHeader title="Course Analytics" desc="Performance across all exams in your institution" />
        {!courseAnalytics ? <Empty msg="No course analytics data" /> : (
          <div className="overflow-x-auto rounded-xl border border-white/10">
            <table className="w-full text-sm">
              <thead className="bg-slate-950/80">
                <tr>{["Course Code", "Course Name", "Title", "Submissions", "Average Score"].map((h) => <th key={h} className="border-b border-white/10 p-3 text-left text-[10px] font-semibold uppercase tracking-wider text-white/40">{h}</th>)}</tr>
              </thead>
              <tbody>
                {courseAnalytics.map((c) => (
                  <tr key={c.examId} className="border-b border-white/5 hover:bg-white/[0.03]">
                    <td className="p-3 font-medium text-indigo-300">{c.courseCode}</td>
                    <td className="p-3 text-white/70">{c.courseName}</td>
                    <td className="p-3 text-white/60">{c.title}</td>
                    <td className="p-3 text-white/60">{c.submissions}</td>
                    <td className="p-3 font-semibold text-white">{c.averageScore.toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  }

  // class / dept
  const byProgram = stats.byProgram ? Object.entries(stats.byProgram) : [];
  const byGender = stats.byGender ? Object.entries(stats.byGender) : [];
  const title = sub === "dept" ? "Department Comparison" : "Class Comparison";
  const data = sub === "dept" ? byProgram : byGender;
  const label = sub === "dept" ? "Program" : "Class / Gender";
  const chartData = data.map(([key, d]) => ({ name: key, average: Number(d.averageScore.toFixed(1)), count: d.count }));

  return (
    <div className="space-y-6">
      <SectionHeader title={title} desc={`Average score and student count by ${label.toLowerCase()}`} />
      {chartData.length === 0 ? <Empty msg={`No ${label.toLowerCase()} data available`} /> : (
        <>
          <GlowCard title={`Average Score by ${label}`}>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                <XAxis dataKey="name" tick={{ fontSize: 11, fill: "rgba(255,255,255,0.6)" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: "rgba(255,255,255,0.4)" }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={TOOLTIP_STYLE} />
                <Bar dataKey="average" fill="#818cf8" radius={[4, 4, 0, 0]} name="Avg Score" />
              </BarChart>
            </ResponsiveContainer>
          </GlowCard>
          <div className="grid gap-3 sm:grid-cols-2">
            {data.map(([key, d]) => (
              <div key={key} className="flex items-center justify-between rounded-xl border border-white/5 bg-white/[0.02] p-4">
                <div><p className="font-medium text-white">{key}</p><p className="text-xs text-white/40">{d.count} student{d.count !== 1 ? "s" : ""}</p></div>
                <p className="text-2xl font-bold text-white">{d.averageScore.toFixed(1)}<span className="ml-1 text-sm font-normal text-white/30">avg</span></p>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/* ── Time ───────────────────────────────────────────────────── */

function TimeSection({ data, loading, sub, selectedExam }: { data: TimeData | null; loading: boolean; sub: string; selectedExam: Exam | undefined }) {
  if (loading && !data) return <Spinner />;
  if (!data) return <Empty msg="No timing data loaded" />;

  const sessions = data.sessions ?? [];

  if (sub === "fastest") {
    return (
      <div className="space-y-6">
        <SectionHeader title="Fastest Submissions" desc="Top 10 students who completed the exam the quickest" />
        {data.fastest.length === 0 ? <Empty msg="No timing data" /> : (
          <div className="overflow-x-auto rounded-xl border border-white/10">
            <table className="w-full text-sm">
              <thead className="bg-slate-950/80 backdrop-blur"><tr>{["#", "Student", "ID", "Time (min)", "Score"].map((h) => <th key={h} className="border-b border-white/10 p-3 text-left text-[10px] font-semibold uppercase tracking-wider text-white/40">{h}</th>)}</tr></thead>
              <tbody>
                {data.fastest.map((s, i) => (
                  <tr key={s.sessionId} className="border-b border-white/5 hover:bg-white/[0.03]">
                    <td className="p-3 font-bold text-amber-400">#{i + 1}</td>
                    <td className="p-3 text-white">{s.student.firstName} {s.student.lastName}</td>
                    <td className="p-3 text-white/40">{s.student.studentId || "—"}</td>
                    <td className="p-3 font-bold text-emerald-400">{s.durationMinutes} min</td>
                    <td className="p-3 text-white/70">{s.score}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  }

  if (sub === "suspicious") {
    return (
      <div className="space-y-6">
        <SectionHeader title="Suspiciously Fast Attempts" desc={`Students who submitted in under ${data.suspiciousThresholdMinutes} minutes (< 15% of exam duration)`} />
        {data.suspicious.length === 0 ? (
          <GlowCard><div className="flex flex-col items-center py-12 text-center"><div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/10 ring-1 ring-emerald-500/20"><Svg d="M5 13l4 4L19 7" size={20} /></div><p className="font-medium text-emerald-400">No suspicious attempts detected</p><p className="mt-1 text-xs text-white/30">All students took a reasonable amount of time</p></div></GlowCard>
        ) : (
          <div className="space-y-2">
            <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-xs text-amber-300">
              ⚠ {data.suspicious.length} student{data.suspicious.length !== 1 ? "s" : ""} submitted in under {data.suspiciousThresholdMinutes} minutes. This may indicate guessing, copying, or prior knowledge of the exam.
            </div>
            <div className="overflow-x-auto rounded-xl border border-white/10">
              <table className="w-full text-sm">
                <thead className="bg-slate-950/80"><tr>{["Student", "ID", "Time (min)", "Threshold", "Score"].map((h) => <th key={h} className="border-b border-white/10 p-3 text-left text-[10px] font-semibold uppercase tracking-wider text-white/40">{h}</th>)}</tr></thead>
                <tbody>
                  {data.suspicious.map((s) => (
                    <tr key={s.sessionId} className="border-b border-white/5 bg-amber-500/[0.02] hover:bg-amber-500/5">
                      <td className="p-3 text-white">{s.student.firstName} {s.student.lastName}</td>
                      <td className="p-3 text-white/40">{s.student.studentId || "—"}</td>
                      <td className="p-3 font-bold text-amber-400">{s.durationMinutes} min</td>
                      <td className="p-3 text-white/30">{data.suspiciousThresholdMinutes} min</td>
                      <td className="p-3 text-white/70">{s.score}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    );
  }

  if (sub === "perq") {
    const avgPerQ = selectedExam && sessions.length > 0
      ? (data.avgDurationMinutes / (selectedExam as any).questions?.length || 1).toFixed(2)
      : "—";
    return (
      <div className="space-y-6">
        <SectionHeader title="Time Per Question" desc="Estimated average time per question based on submission times" />
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <div className="rounded-xl border border-white/5 bg-white/[0.02] p-4"><p className="text-[10px] uppercase tracking-wider text-white/40">Avg Total Time</p><p className="mt-1 text-2xl font-bold text-indigo-300">{data.avgDurationMinutes} min</p></div>
          <div className="rounded-xl border border-white/5 bg-white/[0.02] p-4"><p className="text-[10px] uppercase tracking-wider text-white/40">Fastest</p><p className="mt-1 text-2xl font-bold text-emerald-300">{data.fastestMinutes} min</p></div>
          <div className="rounded-xl border border-white/5 bg-white/[0.02] p-4"><p className="text-[10px] uppercase tracking-wider text-white/40">Slowest</p><p className="mt-1 text-2xl font-bold text-rose-300">{data.slowestMinutes} min</p></div>
        </div>
      </div>
    );
  }

  // avg
  const timeChartData = sessions.slice(0, 30).map((s, i) => ({ i: i + 1, min: s.durationMinutes, score: s.score }));
  return (
    <div className="space-y-6">
      <SectionHeader title="Average Completion Time" desc="How long students are taking to complete the exam" />
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard label="Avg Time" value={`${data.avgDurationMinutes} min`} accent="blue" icon={<Svg d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0" />} />
        <StatCard label="Fastest" value={`${data.fastestMinutes} min`} accent="emerald" icon={<Svg d="M13 10V3L4 14h7v7l9-11h-7z" />} />
        <StatCard label="Slowest" value={`${data.slowestMinutes} min`} accent="rose" icon={<Svg d="M12 8v4l3 3" />} />
        <StatCard label="Suspicious" value={data.suspicious.length} accent="amber" icon={<Svg d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />} />
      </div>
      {timeChartData.length > 0 && (
        <GlowCard title="Completion Time Distribution">
          <ResponsiveContainer width="100%" height={260}>
            <ScatterChart margin={{ top: 8, right: 20, left: 0, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
              <XAxis dataKey="i" name="Student #" tick={{ fontSize: 10, fill: "rgba(255,255,255,0.4)" }} axisLine={false} tickLine={false} />
              <YAxis dataKey="min" name="Minutes" tick={{ fontSize: 10, fill: "rgba(255,255,255,0.4)" }} axisLine={false} tickLine={false} label={{ value: "min", angle: -90, position: "insideLeft", fill: "rgba(255,255,255,0.3)", fontSize: 10 }} />
              <ZAxis range={[50, 50]} />
              <Tooltip contentStyle={TOOLTIP_STYLE} content={({ active, payload }) => active && payload?.length ? <div style={TOOLTIP_STYLE} className="px-3 py-2 text-xs"><p className="font-semibold text-white">{payload[0]?.payload?.min} minutes</p><p className="text-white/50">Score: {payload[0]?.payload?.score}</p></div> : null} />
              <Scatter data={timeChartData} fill="#60a5fa" />
            </ScatterChart>
          </ResponsiveContainer>
        </GlowCard>
      )}
    </div>
  );
}

/* ── Leaderboard ────────────────────────────────────────────── */

function LeaderboardSection({ leaderboard, loading, sub, scaled, scaleMethod, setScaleMethod, scaleTarget, setScaleTarget, applyScaling }: {
  leaderboard: LeaderboardEntry[] | null; loading: boolean; sub: string;
  scaled: ScaledData | null; scaleMethod: string; setScaleMethod: (v: string) => void;
  scaleTarget: number | ""; setScaleTarget: (v: number | "") => void; applyScaling: () => void;
}) {
  if (sub === "scaling") {
    return (
      <div className="space-y-6">
        <SectionHeader title="Scale Results" desc="Rescale raw scores to any target maximum (e.g. out of 5, 50, 100)" />
        <GlowCard title="Scale Configuration">
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              {SCALING_METHODS.map((m) => (
                <button key={m.value} type="button" onClick={() => setScaleMethod(m.value)} className={`rounded-lg border p-3 text-left transition ${scaleMethod === m.value ? "border-indigo-400/40 bg-indigo-500/10" : "border-white/10 bg-white/[0.02] hover:bg-white/5"}`}>
                  <p className={`text-sm font-semibold ${scaleMethod === m.value ? "text-white" : "text-white/70"}`}>{m.label}</p>
                  <p className="mt-0.5 text-[10px] text-white/40">{m.desc}</p>
                </button>
              ))}
            </div>
            <div className="flex items-end gap-4">
              <div className="space-y-1.5">
                <label className="text-[10px] font-semibold uppercase tracking-wider text-white/50">Scale Target (max value)</label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={1}
                    className="auth-input h-11 w-32 rounded-lg px-3 text-sm font-semibold"
                    value={scaleTarget}
                    placeholder="100"
                    onChange={(e) => setScaleTarget(e.target.value === "" ? "" : Number(e.target.value))}
                  />
                  <span className="text-xs text-white/30">e.g. 5, 20, 50, 100</span>
                </div>
              </div>
              <GlowButton onClick={applyScaling} variant="gradient">
                Apply Scaling
                <Svg d="M5 12h14M13 6l6 6-6 6" />
              </GlowButton>
            </div>
          </div>
        </GlowCard>
        {scaled && (
          <GlowCard title={`Scaled Scores — out of ${scaled.targetMax}`}>
            <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                { label: "Raw Mean", value: scaled.summary.rawMean.toFixed(1), color: "text-slate-200" },
                { label: "Scaled Mean", value: scaled.summary.scaledMean.toFixed(1), color: "text-indigo-200" },
                { label: "Scaled Min", value: scaled.summary.scaledMin.toFixed(1), color: "text-rose-200" },
                { label: "Scaled Max", value: scaled.summary.scaledMax.toFixed(1), color: "text-emerald-200" },
              ].map((m) => (
                <div key={m.label} className="rounded-lg border border-white/5 bg-white/[0.02] p-3">
                  <p className="text-[10px] uppercase tracking-wider text-white/40">{m.label}</p>
                  <p className={`mt-1 text-xl font-bold ${m.color}`}>{m.value}</p>
                </div>
              ))}
            </div>
            <div className="max-h-80 overflow-y-auto rounded-lg border border-white/10">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-slate-950/80 backdrop-blur">
                  <tr>{["Student", `Raw (/${scaled.rawMax})`, `Scaled (/${scaled.targetMax})`, "Δ"].map((h) => <th key={h} className="border-b border-white/10 p-3 text-left text-[10px] font-semibold uppercase tracking-wider text-white/40">{h}</th>)}</tr>
                </thead>
                <tbody>
                  {scaled.scaled.map((row) => {
                    const rawPct = (row.rawScore / scaled.rawMax) * 100;
                    const delta = row.scaledScore - rawPct;
                    return (
                      <tr key={row.sessionId} className="border-b border-white/5 hover:bg-white/[0.03]">
                        <td className="p-3 text-white/80">{row.student.firstName} {row.student.lastName}</td>
                        <td className="p-3 text-white/50">{row.rawScore}</td>
                        <td className="p-3 font-bold text-white">{row.scaledScore.toFixed(2)}</td>
                        <td className={`p-3 font-semibold ${delta > 0 ? "text-emerald-400" : delta < 0 ? "text-rose-400" : "text-white/40"}`}>{delta > 0 ? "+" : ""}{delta.toFixed(1)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </GlowCard>
        )}
      </div>
    );
  }

  if (loading && !leaderboard) return <Spinner />;

  const isClasses = sub === "classes";
  const title = sub === "top" ? "Top Students" : isClasses ? "Top Classes / Programs" : "Top Departments";

  if (isClasses) {
    const programMap = new Map<string, { totalScore: number; count: number }>();
    (leaderboard || []).forEach((e) => {
      const prog = e.student.program || "Unknown";
      const prev = programMap.get(prog) || { totalScore: 0, count: 0 };
      programMap.set(prog, { totalScore: prev.totalScore + e.percentage, count: prev.count + 1 });
    });
    const programData = [...programMap.entries()].map(([prog, d]) => ({ program: prog, avg: Number((d.totalScore / d.count).toFixed(1)), count: d.count })).sort((a, b) => b.avg - a.avg);
    return (
      <div className="space-y-6">
        <SectionHeader title={title} desc="Average score per program / class" />
        {programData.length === 0 ? <Empty msg="No program data available" /> : (
          <>
            <GlowCard title="Average Score by Program">
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={programData} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                  <XAxis dataKey="program" tick={{ fontSize: 10, fill: "rgba(255,255,255,0.5)" }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: "rgba(255,255,255,0.4)" }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} />
                  <Bar dataKey="avg" fill="#a78bfa" radius={[4, 4, 0, 0]} name="Avg %" />
                </BarChart>
              </ResponsiveContainer>
            </GlowCard>
            <div className="grid gap-3 sm:grid-cols-2">{programData.map((d, i) => <div key={d.program} className="flex items-center gap-3 rounded-xl border border-white/5 bg-white/[0.02] p-4"><span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 text-xs font-bold text-white">#{i + 1}</span><div className="flex-1"><p className="font-medium text-white">{d.program}</p><p className="text-xs text-white/40">{d.count} students</p></div><p className="text-xl font-bold text-white">{d.avg}%</p></div>)}</div>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <SectionHeader title={title} desc="Top students ranked by score percentage" />
      {!leaderboard || leaderboard.length === 0 ? <Empty msg="No leaderboard data" /> : (
        <div className="space-y-2">
          {leaderboard.map((e) => {
            const medal = e.rank === 1 ? "🥇" : e.rank === 2 ? "🥈" : e.rank === 3 ? "🥉" : null;
            return (
              <div key={e.rank} className={`flex items-center gap-4 rounded-xl border p-4 transition ${e.rank <= 3 ? "border-amber-500/20 bg-amber-500/5" : "border-white/5 bg-white/[0.02] hover:bg-white/[0.04]"}`}>
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500/30 to-purple-600/30 text-sm font-bold text-white">
                  {medal || `#${e.rank}`}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-white">{e.student.firstName} {e.student.lastName}</p>
                  <p className="text-xs text-white/40">{e.student.studentId || ""} {e.student.program ? `· ${e.student.program}` : ""}</p>
                </div>
                <div className="text-right">
                  <p className="text-xl font-bold text-white">{e.percentage}%</p>
                  <p className="text-xs text-white/40">{e.score} / {e.maxScore}</p>
                </div>
                <div className="w-20">
                  <div className="h-2 overflow-hidden rounded-full bg-white/10">
                    <div className="h-2 rounded-full bg-gradient-to-r from-indigo-500 to-purple-500" style={{ width: `${e.percentage}%` }} />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ── Export ─────────────────────────────────────────────────── */

function ExportSection({ stats, grades, studentScores, questionStats, selectedExam, sub }: {
  stats: ExamStats; grades: GradeData | null; studentScores: StudentScore[] | null;
  questionStats: QuestionStat[] | null; selectedExam: Exam | undefined; sub: string;
}) {
  const examName = selectedExam?.title?.replace(/[^a-z0-9]/gi, "_") || "exam";

  function exportStudentCSV() {
    if (!studentScores) return;
    downloadCSV(`${examName}_students.csv`,
      ["Rank", "First Name", "Last Name", "Student ID", "Program", "Score", "Max Score", "Percentage", "Duration (min)", "Submitted At"],
      studentScores.map((s) => [s.rank, s.student.firstName, s.student.lastName, s.student.studentId ?? "", s.student.program ?? "", s.score, s.maxScore, s.percentage, s.durationMinutes ?? "", s.submittedAt ? new Date(s.submittedAt).toLocaleString() : ""]));
  }

  function exportQuestionsCSV() {
    if (!questionStats) return;
    downloadCSV(`${examName}_questions.csv`,
      ["Q#", "Question Text", "Type", "Marks", "Answered", "Correct", "Incorrect", "Skipped", "Correct Rate %", "Difficulty"],
      questionStats.map((q) => [q.questionNumber, q.text, q.type, q.marks, q.totalAnswered, q.correct, q.incorrect, q.skipped, q.correctRate, q.difficulty]));
  }

  function exportFullReport() {
    if (!stats) return;
    const rows: (string | number | null)[][] = [
      ["Exam", selectedExam?.title ?? ""], ["Course", selectedExam?.courseCode ?? ""],
      ["Total Submissions", stats.totalSubmissions], ["Average Score", stats.averageScore.toFixed(2)],
      ["Highest", stats.highestScore], ["Lowest", stats.lowestScore],
      ["Median", stats.medianScore?.toFixed(2) ?? ""], ["Std Dev", stats.standardDeviation?.toFixed(3) ?? ""],
      [], ["Grade", "Students"],
      ...(grades ? Object.entries(grades.grades).map(([g, c]) => [g, c]) : []),
    ];
    downloadCSV(`${examName}_report.csv`, ["Field", "Value"], rows);
  }

  return (
    <div className="space-y-6">
      <SectionHeader title="Reports & Export" desc="Download exam data in various formats" />
      <div className="grid gap-4 sm:grid-cols-3">
        <ExportCard icon="M9 12h6M9 16h6M9 8h6M5 3h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2z" title="Student Scores CSV" desc={`${studentScores?.length ?? 0} students`} action={exportStudentCSV} disabled={!studentScores} />
        <ExportCard icon="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01" title="Question Analytics CSV" desc={`${questionStats?.length ?? 0} questions`} action={exportQuestionsCSV} disabled={!questionStats} />
        <ExportCard icon="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" title="Full Summary Report" desc="Stats + grade breakdown" action={exportFullReport} />
      </div>
      <GlowCard title="Export PDF" description="Print the current analytics view as a PDF">
        <button
          onClick={() => window.print()}
          className="flex items-center gap-2 rounded-lg border border-indigo-500/20 bg-indigo-500/10 px-4 py-2.5 text-sm font-medium text-indigo-300 transition hover:bg-indigo-500/20"
        >
          <Svg d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
          Print / Save as PDF
        </button>
        <p className="mt-2 text-xs text-white/30">Use your browser's print dialog — choose "Save as PDF" as the destination.</p>
      </GlowCard>
    </div>
  );
}

/* ── Settings ───────────────────────────────────────────────── */

function SettingsSection({ passThreshold, setPassThreshold, scaleMethod, setScaleMethod, scaleTarget, setScaleTarget, sub }: {
  passThreshold: number; setPassThreshold: (v: number) => void;
  scaleMethod: string; setScaleMethod: (v: string) => void;
  scaleTarget: number | ""; setScaleTarget: (v: number | "") => void;
  sub: string;
}) {
  return (
    <div className="space-y-6">
      <SectionHeader title={sub === "thresholds" ? "Score Thresholds" : "Analytics Preferences"} desc="Configure how analytics are calculated and displayed" />
      <GlowCard title="Pass Threshold">
        <div className="space-y-3">
          <p className="text-xs text-white/50">Students scoring at or above this percentage are considered to have passed.</p>
          <div className="flex items-center gap-4">
            <input type="range" min={1} max={100} value={passThreshold} onChange={(e) => setPassThreshold(Number(e.target.value))} className="w-full accent-indigo-500" />
            <div className="flex h-11 w-20 shrink-0 items-center justify-center rounded-lg border border-indigo-500/20 bg-indigo-500/10 text-lg font-bold text-indigo-300">{passThreshold}%</div>
          </div>
        </div>
      </GlowCard>
      <GlowCard title="Default Scale Method">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {SCALING_METHODS.map((m) => (
            <button key={m.value} onClick={() => setScaleMethod(m.value)} className={`rounded-lg border p-3 text-left transition ${scaleMethod === m.value ? "border-indigo-400/40 bg-indigo-500/10" : "border-white/10 bg-white/[0.02] hover:bg-white/5"}`}>
              <p className={`text-sm font-semibold ${scaleMethod === m.value ? "text-white" : "text-white/70"}`}>{m.label}</p>
              <p className="mt-0.5 text-[10px] text-white/40">{m.desc}</p>
            </button>
          ))}
        </div>
      </GlowCard>
      <GlowCard title="Default Scale Target">
        <div className="flex items-center gap-4">
          <input type="number" min={1} className="auth-input h-11 w-32 rounded-lg px-3 text-sm" value={scaleTarget} placeholder="100" onChange={(e) => setScaleTarget(e.target.value === "" ? "" : Number(e.target.value))} />
          <p className="text-xs text-white/40">Default target max when scaling scores (e.g. 5, 10, 50, 100)</p>
        </div>
      </GlowCard>
    </div>
  );
}

/* ── Shared primitives ──────────────────────────────────────── */

function SectionHeader({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="mb-2">
      <h2 className="text-xl font-bold text-white">{title}</h2>
      {desc && <p className="mt-0.5 text-sm text-white/40">{desc}</p>}
    </div>
  );
}

function ExportCard({ icon, title, desc, action, disabled }: { icon: string; title: string; desc: string; action: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={action}
      disabled={disabled}
      className="flex flex-col items-start gap-3 rounded-xl border border-white/5 bg-white/[0.02] p-4 text-left transition hover:border-white/10 hover:bg-white/5 disabled:opacity-40"
    >
      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-white/5"><Svg d={icon} /></div>
      <div>
        <p className="font-medium text-white">{title}</p>
        <p className="text-xs text-white/40">{desc}</p>
      </div>
      <span className="mt-auto rounded bg-white/5 px-2.5 py-1 text-xs font-medium text-white/60">Download CSV</span>
    </button>
  );
}
