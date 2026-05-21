"use client";

import { useState } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
  PieChart, Pie, Legend,
  ScatterChart, Scatter, ZAxis,
} from "recharts";
import { GlowCard } from "@/components/dashboard/DashboardShell";

interface Props {
  grades: Record<string, number>;
  total: number;
  scoreDistribution?: Record<string, number>;
}

const GRADE_COLORS: Record<string, string> = {
  A: "#34d399",
  B: "#60a5fa",
  C: "#fbbf24",
  D: "#fb923c",
  F: "#f87171",
};

const FALLBACK_COLORS = ["#818cf8", "#a78bfa", "#c084fc", "#e879f9", "#f472b6", "#fb7185", "#fbbf24"];

const TOOLTIP_STYLE = {
  backgroundColor: "rgba(15, 23, 42, 0.95)",
  border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: "8px",
  color: "white",
  boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
};

type ChartType = "bar" | "pie" | "scatter";

const CHART_ICONS: Record<ChartType, string> = {
  bar: "M3 3v18h18M7 18v-7m4 7v-4m4 4V9",
  pie: "M21.21 15.89A10 10 0 1 1 8 2.83M22 12A10 10 0 0 0 12 2v10z",
  scatter: "M12 5a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM5 18a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM19 10a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM8 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM16 17a1 1 0 1 0 0-2 1 1 0 0 0 0 2z",
};

const Svg = ({ d, size = 16 }: { d: string; size?: number }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
);

export function GradeBreakdownChart({ grades, total, scoreDistribution }: Props) {
  const [chartType, setChartType] = useState<ChartType>("bar");

  const gradeData = Object.entries(grades).map(([grade, count]) => ({
    grade,
    students: count,
    percentage: total > 0 ? Number(((count / total) * 100).toFixed(1)) : 0,
    fill: GRADE_COLORS[grade] || FALLBACK_COLORS[Object.keys(grades).indexOf(grade) % FALLBACK_COLORS.length],
  }));

  // Scatter data from scoreDistribution (histogram bins → points)
  const scatterData = scoreDistribution
    ? Object.entries(scoreDistribution).map(([range, count]) => {
        const parts = range.split("-").map(Number);
        const x = parts.length === 2 ? Math.round((parts[0] + parts[1]) / 2) : parts[0];
        return { x, y: count, range };
      })
    : gradeData.map((d, i) => ({ x: i * 20, y: d.students, range: d.grade }));

  return (
    <GlowCard title="Grade Breakdown" description={`Total students graded: ${total}`}>
      {/* Chart type selector */}
      <div className="mb-5 flex items-center gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-white/40">Chart Type</span>
        <div className="flex gap-1 rounded-lg border border-white/10 bg-white/[0.02] p-1">
          {(["bar", "pie", "scatter"] as ChartType[]).map((t) => (
            <button
              key={t}
              onClick={() => setChartType(t)}
              title={t.charAt(0).toUpperCase() + t.slice(1) + " Chart"}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition ${
                chartType === t
                  ? "bg-white/10 text-white"
                  : "text-white/40 hover:bg-white/5 hover:text-white"
              }`}
            >
              <Svg d={CHART_ICONS[t]} size={13} />
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Grade chips */}
      <div className="mb-5 flex flex-wrap gap-2">
        {gradeData.map((d) => (
          <div key={d.grade} className="flex items-center gap-2 rounded-lg border border-white/5 bg-white/[0.02] px-3 py-2">
            <span
              className="flex h-7 w-7 items-center justify-center rounded-md text-xs font-bold text-slate-950"
              style={{ backgroundColor: d.fill }}
            >
              {d.grade}
            </span>
            <div className="text-xs">
              <p className="font-semibold text-white">{d.students}</p>
              <p className="text-white/40">{d.percentage}%</p>
            </div>
          </div>
        ))}
      </div>

      <ResponsiveContainer width="100%" height={300}>
        {chartType === "bar" ? (
          <BarChart data={gradeData} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
            <XAxis dataKey="grade" tick={{ fontSize: 14, fontWeight: "bold", fill: "rgba(255,255,255,0.7)" }} axisLine={{ stroke: "rgba(255,255,255,0.1)" }} tickLine={false} />
            <YAxis tick={{ fontSize: 11, fill: "rgba(255,255,255,0.5)" }} axisLine={{ stroke: "rgba(255,255,255,0.1)" }} tickLine={false} />
            <Tooltip
              formatter={(value: number, _name: string, entry: any) => [`${value} students (${entry.payload.percentage}%)`, "Count"]}
              contentStyle={TOOLTIP_STYLE}
              cursor={{ fill: "rgba(255,255,255,0.03)" }}
            />
            <Bar dataKey="students" radius={[6, 6, 0, 0]}>
              {gradeData.map((entry) => (
                <Cell key={entry.grade} fill={entry.fill} />
              ))}
            </Bar>
          </BarChart>
        ) : chartType === "pie" ? (
          <PieChart>
            <Pie
              data={gradeData}
              dataKey="students"
              nameKey="grade"
              cx="50%"
              cy="50%"
              outerRadius={110}
              innerRadius={50}
              paddingAngle={3}
              label={({ grade, percentage }) => `${grade} ${percentage}%`}
              labelLine={{ stroke: "rgba(255,255,255,0.2)" }}
            >
              {gradeData.map((entry) => (
                <Cell key={entry.grade} fill={entry.fill} />
              ))}
            </Pie>
            <Tooltip
              formatter={(value: number, name: string, entry: any) => [`${value} students (${entry.payload.percentage}%)`, name]}
              contentStyle={TOOLTIP_STYLE}
            />
            <Legend
              formatter={(value) => <span style={{ color: "rgba(255,255,255,0.7)", fontSize: 12 }}>{value}</span>}
            />
          </PieChart>
        ) : (
          /* Scatter: score distribution, each point = a score bucket */
          <ScatterChart margin={{ top: 10, right: 20, left: 0, bottom: 10 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
            <XAxis
              dataKey="x"
              name="Score"
              type="number"
              domain={[0, 100]}
              tick={{ fontSize: 11, fill: "rgba(255,255,255,0.5)" }}
              axisLine={{ stroke: "rgba(255,255,255,0.1)" }}
              tickLine={false}
              label={{ value: "Score", position: "insideBottom", offset: -5, fill: "rgba(255,255,255,0.3)", fontSize: 11 }}
            />
            <YAxis
              dataKey="y"
              name="Students"
              type="number"
              tick={{ fontSize: 11, fill: "rgba(255,255,255,0.5)" }}
              axisLine={{ stroke: "rgba(255,255,255,0.1)" }}
              tickLine={false}
              label={{ value: "Students", angle: -90, position: "insideLeft", fill: "rgba(255,255,255,0.3)", fontSize: 11 }}
            />
            <ZAxis range={[60, 400]} />
            <Tooltip
              cursor={{ strokeDasharray: "3 3", stroke: "rgba(255,255,255,0.2)" }}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const d = payload[0]?.payload;
                return (
                  <div style={TOOLTIP_STYLE} className="px-3 py-2 text-sm">
                    <p className="font-semibold text-white">Score: {d?.x}</p>
                    <p className="text-white/60">{d?.y} student{d?.y !== 1 ? "s" : ""}</p>
                  </div>
                );
              }}
            />
            <Scatter
              data={scatterData}
              fill="#818cf8"
            >
              {scatterData.map((entry, i) => (
                <Cell key={i} fill={`hsl(${220 + i * 15}, 80%, 65%)`} />
              ))}
            </Scatter>
          </ScatterChart>
        )}
      </ResponsiveContainer>
    </GlowCard>
  );
}
