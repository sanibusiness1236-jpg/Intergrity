"use client";

import { useEffect, useState } from "react";
import api from "@/lib/api";
import { DashboardShell, GlowButton, GlowCard } from "@/components/dashboard/DashboardShell";
import { AnnouncementBadge } from "@/components/dashboard/AnnouncementBadge";
import { GradientHeading } from "@/components/dashboard/GradientHeading";
import { StatCard } from "@/components/dashboard/StatCard";
import { ScoreDistributionChart } from "@/components/analytics/ScoreDistributionChart";
import { GradeBreakdownChart } from "@/components/analytics/GradeBreakdownChart";
import type { Exam } from "@/types";

interface ExamStats {
  totalSubmissions: number;
  maxPossibleScore: number;
  averageScore: number;
  highestScore: number;
  lowestScore: number;
  medianScore: number;
  standardDeviation: number;
  passRate: string | null;
  scoreDistribution: Record<string, number>;
  byGender: Record<string, { count: number; averageScore: number }>;
  byProgram: Record<string, { count: number; averageScore: number }>;
}

interface GradeData {
  boundaries: Record<string, number>;
  grades: Record<string, number>;
  totalStudents: number;
}

interface ScaledScores {
  method: string;
  targetMax: number;
  rawMax: number;
  scaled: Array<{
    sessionId: string;
    student: { firstName: string; lastName: string; studentId?: string };
    rawScore: number;
    scaledScore: number;
  }>;
  summary: { rawMean: number; scaledMean: number; scaledMin: number; scaledMax: number };
}

const Icon = ({ d }: { d: string }) => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
);

const SCALING_METHODS = [
  { value: "linear", label: "Linear", desc: "Raw % of max" },
  { value: "minmax", label: "Min-Max", desc: "Stretch 0–100" },
  { value: "zscore", label: "Z-Score", desc: "Mean 65 · σ 15" },
  { value: "sqrt", label: "Square Root", desc: "Boost lows" },
];

export default function AnalyticsPage() {
  const [exams, setExams] = useState<Exam[]>([]);
  const [selectedExamId, setSelectedExamId] = useState("");
  const [stats, setStats] = useState<ExamStats | null>(null);
  const [grades, setGrades] = useState<GradeData | null>(null);
  const [scaled, setScaled] = useState<ScaledScores | null>(null);
  const [scaleMethod, setScaleMethod] = useState("linear");
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    api.get("/exams").then(({ data }) => setExams(data.data || [])).catch(() => {});
  }, []);

  async function loadStats() {
    if (!selectedExamId) return;
    setIsLoading(true);
    try {
      const [statsRes, gradesRes] = await Promise.all([
        api.get(`/analytics/exam/${selectedExamId}`),
        api.get(`/analytics/exam/${selectedExamId}/grades`),
      ]);
      setStats(statsRes.data.data.stats || statsRes.data.data);
      setGrades(gradesRes.data.data);
      setScaled(null);
    } catch {
      setStats(null);
      setGrades(null);
    } finally {
      setIsLoading(false);
    }
  }

  async function applyScaling() {
    if (!selectedExamId) return;
    try {
      const { data } = await api.get(`/analytics/exam/${selectedExamId}/scaled`, {
        params: { method: scaleMethod, targetMax: 100 },
      });
      setScaled(data.data);
    } catch {
      setScaled(null);
    }
  }

  const selectedExam = exams.find((e) => e.id === selectedExamId);

  return (
    <DashboardShell>
      <header className="mb-10 space-y-5">
        <AnnouncementBadge
          tag="Tip"
          message="Compare scaling methods to find the fairest grade distribution"
        />

        <GradientHeading
          highlight="Analytics"
          highlightAtEnd
          title="& Reporting."
          subtitle="Deep-dive into exam performance — score distributions, grade boundaries, demographic breakdowns, and four scaling strategies."
        />
      </header>

      <GlowCard
        className="mb-8"
        title="Select Exam"
        description="Choose an exam to load its analytics and student-level data"
      >
        <div className="flex flex-wrap items-end gap-4">
          <div className="min-w-[280px] flex-1 space-y-2">
            <label className="text-xs font-medium uppercase tracking-wider text-white/50">Exam</label>
            <select
              className="auth-input flex h-11 w-full rounded-lg px-3 text-sm font-medium"
              value={selectedExamId}
              onChange={(e) => setSelectedExamId(e.target.value)}
            >
              <option value="" className="bg-slate-900">Choose an exam...</option>
              {exams.map((e) => (
                <option key={e.id} value={e.id} className="bg-slate-900">
                  {e.title} ({e.courseCode})
                </option>
              ))}
            </select>
          </div>
          <GlowButton onClick={loadStats} disabled={!selectedExamId || isLoading} variant="gradient" size="lg">
            {isLoading ? (
              <span className="flex items-center gap-2">
                <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25" />
                  <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                </svg>
                Loading…
              </span>
            ) : (
              "Load Analytics"
            )}
          </GlowButton>
        </div>

        {selectedExam && (
          <div className="mt-4 flex flex-wrap items-center gap-2 rounded-lg border border-white/5 bg-white/[0.02] p-3 text-xs">
            <span className="font-medium text-white">{selectedExam.title}</span>
            <span className="text-white/30">·</span>
            <span className="rounded-md bg-indigo-500/15 px-2 py-0.5 font-medium text-indigo-300">
              {selectedExam.courseCode}
            </span>
            <span className="text-white/30">·</span>
            <span className="text-white/50">{selectedExam.status}</span>
          </div>
        )}
      </GlowCard>

      {!stats && !isLoading && (
        <GlowCard className="text-center">
          <div className="py-16">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500/20 to-purple-500/20 ring-1 ring-white/10">
              <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-indigo-300">
                <path d="M3 3v18h18M7 14l4-4 4 4 5-5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <p className="text-lg font-medium text-white">Select an exam to view analytics</p>
            <p className="mt-2 text-sm text-white/50">
              Pick an exam from the dropdown above to load full statistics and grading data
            </p>
          </div>
        </GlowCard>
      )}

      {stats && (
        <>
          <section className="mb-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <StatCard
              label="Submissions"
              value={stats.totalSubmissions}
              accent="indigo"
              icon={<Icon d="M9 12h6M9 16h6M9 8h6M5 3h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2z" />}
            />
            <StatCard
              label="Average Score"
              value={stats.averageScore?.toFixed(1) ?? "—"}
              accent="blue"
              icon={<Icon d="M3 3v18h18M7 14l4-4 4 4 5-5" />}
            />
            <StatCard
              label="Highest Score"
              value={stats.highestScore ?? "—"}
              accent="emerald"
              icon={<Icon d="M5 13l4 4L19 7" />}
            />
            <StatCard
              label="Pass Rate"
              value={stats.passRate ? `${stats.passRate}%` : "—"}
              accent="purple"
              icon={<Icon d="M9 12l2 2 4-4M12 2a10 10 0 100 20 10 10 0 000-20z" />}
            />
          </section>

          <div className="mb-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
            <GlowCard title="Summary Statistics" description="Descriptive statistics for this exam">
              <ul className="divide-y divide-white/5">
                {[
                  { label: "Max Possible Score", value: stats.maxPossibleScore },
                  { label: "Median Score", value: stats.medianScore?.toFixed(1) },
                  { label: "Lowest Score", value: stats.lowestScore },
                  { label: "Standard Deviation", value: stats.standardDeviation?.toFixed(2) },
                ].map((row) => (
                  <li key={row.label} className="flex items-center justify-between py-3 text-sm">
                    <span className="text-white/50">{row.label}</span>
                    <span className="font-semibold text-white">{row.value}</span>
                  </li>
                ))}
              </ul>
            </GlowCard>

            {stats.scoreDistribution && (
              <ScoreDistributionChart distribution={stats.scoreDistribution} />
            )}
          </div>

          {(stats.byGender && Object.keys(stats.byGender).length > 0) ||
          (stats.byProgram && Object.keys(stats.byProgram).length > 0) ? (
            <div className="mb-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
              {stats.byGender && Object.keys(stats.byGender).length > 0 && (
                <GlowCard title="Performance by Gender" description="Average score split by gender">
                  <ul className="space-y-2">
                    {Object.entries(stats.byGender).map(([gender, data]) => (
                      <li
                        key={gender}
                        className="flex items-center justify-between rounded-lg border border-white/5 bg-white/[0.02] p-3"
                      >
                        <div>
                          <p className="text-sm font-medium text-white">{gender}</p>
                          <p className="text-xs text-white/40">{data.count} student{data.count !== 1 ? "s" : ""}</p>
                        </div>
                        <p className="text-lg font-bold text-white">{data.averageScore.toFixed(1)}<span className="text-xs font-medium text-white/40"> avg</span></p>
                      </li>
                    ))}
                  </ul>
                </GlowCard>
              )}

              {stats.byProgram && Object.keys(stats.byProgram).length > 0 && (
                <GlowCard title="Performance by Program" description="Breakdown by academic program">
                  <ul className="space-y-2">
                    {Object.entries(stats.byProgram).map(([program, data]) => (
                      <li
                        key={program}
                        className="flex items-center justify-between rounded-lg border border-white/5 bg-white/[0.02] p-3"
                      >
                        <div>
                          <p className="text-sm font-medium text-white">{program}</p>
                          <p className="text-xs text-white/40">{data.count} student{data.count !== 1 ? "s" : ""}</p>
                        </div>
                        <p className="text-lg font-bold text-white">{data.averageScore.toFixed(1)}<span className="text-xs font-medium text-white/40"> avg</span></p>
                      </li>
                    ))}
                  </ul>
                </GlowCard>
              )}
            </div>
          ) : null}

          {grades && (
            <div className="mb-8">
              <GradeBreakdownChart
                grades={grades.grades}
                total={grades.totalStudents}
                scoreDistribution={stats?.scoreDistribution}
              />
            </div>
          )}

          <GlowCard
            title="Score Scaling"
            description="Rescale raw scores using different normalization methods"
          >
            <div className="mb-5">
              <p className="mb-3 text-xs font-medium uppercase tracking-wider text-white/50">Scaling Method</p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {SCALING_METHODS.map((m) => (
                  <button
                    key={m.value}
                    type="button"
                    onClick={() => setScaleMethod(m.value)}
                    className={`rounded-lg border p-3 text-left transition ${
                      scaleMethod === m.value
                        ? "border-indigo-400/40 bg-indigo-500/10 shadow-lg shadow-indigo-500/10"
                        : "border-white/10 bg-white/[0.02] hover:border-white/20 hover:bg-white/5"
                    }`}
                  >
                    <p className={`text-sm font-semibold ${scaleMethod === m.value ? "text-white" : "text-white/80"}`}>
                      {m.label}
                    </p>
                    <p className="mt-0.5 text-[10px] text-white/40">{m.desc}</p>
                  </button>
                ))}
              </div>
            </div>

            <GlowButton onClick={applyScaling} variant="gradient">
              Apply Scaling
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M5 12h14M13 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </GlowButton>

            {scaled && (
              <div className="mt-6">
                <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {[
                    { label: "Raw Mean", value: scaled.summary.rawMean.toFixed(1), accent: "from-slate-500/15 to-slate-500/5", text: "text-slate-200" },
                    { label: "Scaled Mean", value: scaled.summary.scaledMean.toFixed(1), accent: "from-indigo-500/15 to-indigo-500/5", text: "text-indigo-200" },
                    { label: "Scaled Min", value: scaled.summary.scaledMin.toFixed(1), accent: "from-rose-500/15 to-rose-500/5", text: "text-rose-200" },
                    { label: "Scaled Max", value: scaled.summary.scaledMax.toFixed(1), accent: "from-emerald-500/15 to-emerald-500/5", text: "text-emerald-200" },
                  ].map((m) => (
                    <div
                      key={m.label}
                      className={`rounded-lg border border-white/5 bg-gradient-to-b ${m.accent} p-3`}
                    >
                      <p className="text-[10px] font-medium uppercase tracking-wider text-white/40">{m.label}</p>
                      <p className={`mt-1 text-xl font-bold ${m.text}`}>{m.value}</p>
                    </div>
                  ))}
                </div>

                <div className="max-h-96 overflow-y-auto rounded-lg border border-white/10 scrollbar-thin">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 z-10 bg-slate-950/80 backdrop-blur">
                      <tr>
                        <th className="border-b border-white/10 p-3 text-left text-xs font-semibold uppercase tracking-wider text-white/50">Student</th>
                        <th className="border-b border-white/10 p-3 text-right text-xs font-semibold uppercase tracking-wider text-white/50">Raw <span className="text-white/30">(/{scaled.rawMax})</span></th>
                        <th className="border-b border-white/10 p-3 text-right text-xs font-semibold uppercase tracking-wider text-white/50">Scaled <span className="text-white/30">(/{scaled.targetMax})</span></th>
                        <th className="border-b border-white/10 p-3 text-right text-xs font-semibold uppercase tracking-wider text-white/50">Δ</th>
                      </tr>
                    </thead>
                    <tbody>
                      {scaled.scaled.map((row) => {
                        const rawPct = (row.rawScore / scaled.rawMax) * 100;
                        const delta = row.scaledScore - rawPct;
                        return (
                          <tr key={row.sessionId} className="border-b border-white/5 transition hover:bg-white/[0.03]">
                            <td className="p-3 text-white/80">{row.student.firstName} {row.student.lastName}</td>
                            <td className="p-3 text-right font-medium text-white/60">{row.rawScore}</td>
                            <td className="p-3 text-right font-bold text-white">{row.scaledScore.toFixed(2)}</td>
                            <td className={`p-3 text-right text-sm font-semibold ${delta > 0 ? "text-emerald-400" : delta < 0 ? "text-rose-400" : "text-white/40"}`}>
                              {delta > 0 ? "+" : ""}{delta.toFixed(1)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </GlowCard>
        </>
      )}
    </DashboardShell>
  );
}
