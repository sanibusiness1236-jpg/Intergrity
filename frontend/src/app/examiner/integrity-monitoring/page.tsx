"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";
import api from "@/lib/api";
import { DashboardShell, GlowButton, GlowCard } from "@/components/dashboard/DashboardShell";
import { GradientHeading } from "@/components/dashboard/GradientHeading";
import { StatCard } from "@/components/dashboard/StatCard";
import type { Exam } from "@/types";

/* ── Types ─────────────────────────────────────────────────── */
interface Overview { totalCourses: number; activeSessions: number; totalSubmissions: number; totalPredictions: number; flaggedPredictions: number; cleanPredictions: number; }
interface ActivityRow { student_id: string; student_username: string; student_name: string; tab_switch_flag: number; tab_switch_count: number; time_away_exam_site: number; answer_paste_flag: number; paste_event_count: number; usb_device_detection_count: number; window_minimize_flag: number; window_blur_count: number; multi_device_login_flag: number; avg_answer_similarity: number; time_per_question_std: number; response_time_pattern: number; ip_similarity_score: number; suspicion_label: string; }
interface PredResult { student_id: string; student_name: string; student_username: string; prediction: "cheater" | "honest"; label: "Cheater" | "Honest"; risk: "high" | "medium" | "low"; flagged_prob: number; clean_prob: number; features: { tab_switch_flag: boolean; tab_switch_count: number; answer_paste_flag: boolean; paste_event_count: number; window_blur_count: number; usb_detected: boolean; multi_device_login: boolean; time_per_question_std: number; }; }
interface PredResponse { exam: { title: string; courseCode: string }; examId: string; model_used: string; total: number; cheaters: number; honest: number; high_risk: number; medium_risk: number; low_risk: number; results: PredResult[]; }
interface BenchmarkResult { results: Array<{ model: string; f1_macro: number; precision_macro: number; recall_macro: number; accuracy: number; train_acc: number; confusion_matrix: number[][]; }>; dataset_info: { num_nodes: number; num_cheaters: number; num_clean: number; }; }
type Layout = "circular" | "shell" | "spring" | "spectral" | "spiral" | "random" | "kamada_kawai";

/* ── Nav tree ───────────────────────────────────────────────── */
type NavSection = { id: string; label: string; icon: string; items: { id: string; label: string }[] };
const NAV_TREE: NavSection[] = [
  { id: "overview", label: "Overview", icon: "M3 3v18h18M7 14l4-4 4 4 5-5", items: [{ id: "overview.courses", label: "Total Courses" }, { id: "overview.sessions", label: "Active Sessions" }, { id: "overview.submissions", label: "Total Submissions" }, { id: "overview.summary", label: "Integrity Summary" }] },
  { id: "course_sessions", label: "Course Prediction Sessions", icon: "M9 12h6M9 16h6M9 8h6M5 3h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2z", items: [{ id: "course_sessions.select", label: "Select Course" }, { id: "course_sessions.count", label: "Submission Count" }, { id: "course_sessions.logs", label: "Student Activity Logs" }, { id: "course_sessions.history", label: "Monitoring History" }] },
  { id: "submit_scores", label: "Submit Scores to Check", icon: "M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12", items: [{ id: "submit_scores.generate", label: "Generate Activity CSV" }, { id: "submit_scores.model", label: "Select Model" }, { id: "submit_scores.upload", label: "Upload Dataset" }, { id: "submit_scores.predict", label: "Run Prediction" }, { id: "submit_scores.queue", label: "Prediction Queue" }] },
  { id: "results", label: "Prediction Results", icon: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2", items: [{ id: "results.all", label: "All Predictions" }, { id: "results.low", label: "Low Risk — Honest" }, { id: "results.medium", label: "Medium Risk" }, { id: "results.high", label: "High Risk — Cheater" }, { id: "results.scores", label: "Integrity Scores" }, { id: "results.logs", label: "Prediction Logs" }] },
  { id: "graph", label: "GNN Graph Visualization", icon: "M7 20l4-16m2 16l4-16M6 9h14M4 15h14", items: [{ id: "graph.layout", label: "Select Layout" }, { id: "graph.interactive", label: "Network View" }, { id: "graph.analysis", label: "Node Analysis" }, { id: "graph.download", label: "Download Graph" }] },
  { id: "analyze", label: "Analyze Model", icon: "M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z", items: [{ id: "analyze.metrics", label: "F1 / Precision / Recall" }, { id: "analyze.confusion", label: "Confusion Matrix" }, { id: "analyze.classification", label: "Classification Report" }, { id: "analyze.fp", label: "False Positive Analysis" }, { id: "analyze.fn", label: "False Negative Analysis" }] },
  { id: "reports", label: "Reports & Downloads", icon: "M12 10v6m0 0l-3-3m3 3l3-3M3 17V7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z", items: [{ id: "reports.predictions", label: "Download Predictions" }, { id: "reports.csv", label: "Download CSV Dataset" }, { id: "reports.metrics", label: "Download Model Metrics" }, { id: "reports.pdf", label: "Export PDF Report" }] },
  { id: "queue", label: "Model Queue & Processing", icon: "M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15", items: [{ id: "queue.active", label: "Active Queue" }, { id: "queue.reset", label: "Reset Session" }, { id: "queue.await", label: "Await New Dataset" }] },
  { id: "settings", label: "Settings", icon: "M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z", items: [{ id: "settings.thresholds", label: "Threshold Config" }, { id: "settings.risk", label: "Risk Classification" }, { id: "settings.model", label: "Model Preferences" }, { id: "settings.graph", label: "Graph Settings" }] },
];

const MODELS = ["vanilla_gcn", "h2gcn", "fagcn", "graphsage"] as const;
const LAYOUTS: { id: Layout; label: string }[] = [
  { id: "spring", label: "Spring Layout" }, { id: "shell", label: "Shell Layout" },
  { id: "spectral", label: "Spectral Layout" }, { id: "spiral", label: "Spiral Layout" },
  { id: "kamada_kawai", label: "Kamada-Kawai" }, { id: "random", label: "Random Layout" },
  { id: "circular", label: "Circular Layout" },
];
const TOOLTIP_STYLE = { backgroundColor: "rgba(15,23,42,0.96)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "8px", color: "white" };

/* ── Helpers ───────────────────────────────────────────────── */
const Svg = ({ d, size = 16 }: { d: string; size?: number }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>
);
const Spinner = () => <div className="flex items-center justify-center py-20"><svg className="h-8 w-8 animate-spin text-indigo-400" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25" /><path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="3" strokeLinecap="round" /></svg></div>;
const Empty = ({ msg }: { msg: string }) => <div className="flex flex-col items-center justify-center py-20 text-center"><div className="mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-white/5 ring-1 ring-white/10"><Svg d="M9 12h6M9 16h6M9 8h6M5 3h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2z" size={22} /></div><p className="text-sm text-white/40">{msg}</p></div>;
const SectionHeader = ({ title, desc }: { title: string; desc?: string }) => <div className="mb-4"><h2 className="text-xl font-bold text-white">{title}</h2>{desc && <p className="mt-0.5 text-sm text-white/40">{desc}</p>}</div>;
const boolFeature = (v: boolean) => v ? <span className="rounded bg-rose-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-rose-300">Yes</span> : <span className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] font-semibold text-white/30">No</span>;
const riskBadge = (r: string) => r === "high" ? <span className="rounded bg-rose-500/15 px-2 py-0.5 text-[10px] font-bold text-rose-300">High</span> : r === "medium" ? <span className="rounded bg-amber-500/15 px-2 py-0.5 text-[10px] font-bold text-amber-300">Medium</span> : <span className="rounded bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold text-emerald-300">Low</span>;

function downloadCSV(filename: string, headers: string[], rows: (string | number | boolean | null)[][]) {
  const esc = (v: string | number | boolean | null) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const csv = [headers, ...rows].map((r) => r.map(esc).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = filename; a.click(); URL.revokeObjectURL(url);
}

/* ── Graph layout algorithms ─────────────────────────────────── */
function computeLayout(nodes: PredResult[], edges: [number, number][], layout: Layout, W: number, H: number): { x: number; y: number }[] {
  const n = nodes.length;
  if (n === 0) return [];
  const cx = W / 2, cy = H / 2, r = Math.min(W, H) * 0.4;

  if (layout === "circular") return nodes.map((_, i) => ({ x: cx + r * Math.cos((2 * Math.PI * i) / n - Math.PI / 2), y: cy + r * Math.sin((2 * Math.PI * i) / n - Math.PI / 2) }));

  if (layout === "shell") {
    const cheaters = nodes.map((nd, i) => ({ nd, i })).filter((x) => x.nd.prediction === "cheater");
    const honest = nodes.map((nd, i) => ({ nd, i })).filter((x) => x.nd.prediction !== "cheater");
    const pos = new Array(n) as { x: number; y: number }[];
    const r1 = r * 0.45, r2 = r;
    cheaters.forEach(({ i }, k) => { pos[i] = { x: cx + r1 * Math.cos((2 * Math.PI * k) / (cheaters.length || 1) - Math.PI / 2), y: cy + r1 * Math.sin((2 * Math.PI * k) / (cheaters.length || 1) - Math.PI / 2) }; });
    honest.forEach(({ i }, k) => { pos[i] = { x: cx + r2 * Math.cos((2 * Math.PI * k) / (honest.length || 1) - Math.PI / 2), y: cy + r2 * Math.sin((2 * Math.PI * k) / (honest.length || 1) - Math.PI / 2) }; });
    return pos;
  }

  if (layout === "random") return nodes.map((_, i) => ({ x: 40 + ((i * 1237 + 31) % (W - 80)), y: 40 + ((i * 983 + 17) % (H - 80)) }));

  if (layout === "spectral") {
    const sorted = [...nodes.map((nd, i) => ({ nd, i }))].sort((a, b) => a.nd.flagged_prob - b.nd.flagged_prob);
    const pos = new Array(n) as { x: number; y: number }[];
    sorted.forEach(({ nd, i }, k) => { pos[i] = { x: 40 + (k / (n - 1 || 1)) * (W - 80), y: nd.prediction === "cheater" ? H * 0.3 + (k % 3) * 20 : H * 0.7 - (k % 3) * 20 }; });
    return pos;
  }

  if (layout === "spiral") {
    const b = Math.min(W, H) * 0.06;
    return nodes.map((_, i) => {
      const theta = (i / n) * 4 * Math.PI;
      const rr = b * theta;
      return { x: Math.max(20, Math.min(W - 20, cx + rr * Math.cos(theta))), y: Math.max(20, Math.min(H - 20, cy + rr * Math.sin(theta))) };
    });
  }

  // spring / kamada_kawai — force-directed
  const pos = nodes.map((_, i) => ({
    x: cx + r * 0.6 * Math.cos((2 * Math.PI * i) / n) + (Math.random() - 0.5) * 30,
    y: cy + r * 0.6 * Math.sin((2 * Math.PI * i) / n) + (Math.random() - 0.5) * 30,
  }));
  const k = Math.sqrt((W * H) / n) * 0.8;
  const iters = layout === "kamada_kawai" ? 180 : 100;
  let temp = r * 0.5;
  for (let it = 0; it < iters; it++) {
    const fx = new Array(n).fill(0), fy = new Array(n).fill(0);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { if (i === j) continue; const dx = pos[i].x - pos[j].x, dy = pos[i].y - pos[j].y, d = Math.sqrt(dx * dx + dy * dy) + 0.01, f = (k * k) / d; fx[i] += (dx / d) * f; fy[i] += (dy / d) * f; }
    for (const [s, t] of edges) { if (s >= n || t >= n) continue; const dx = pos[t].x - pos[s].x, dy = pos[t].y - pos[s].y, d = Math.sqrt(dx * dx + dy * dy) + 0.01, f = (d * d) / k; fx[s] += (dx / d) * f; fy[s] += (dy / d) * f; fx[t] -= (dx / d) * f; fy[t] -= (dy / d) * f; }
    for (let i = 0; i < n; i++) { const mag = Math.sqrt(fx[i] * fx[i] + fy[i] * fy[i]) + 0.01, clamp = Math.min(mag, temp); pos[i].x = Math.max(30, Math.min(W - 30, pos[i].x + (fx[i] / mag) * clamp)); pos[i].y = Math.max(30, Math.min(H - 30, pos[i].y + (fy[i] / mag) * clamp)); }
    temp *= 0.93;
  }
  return pos;
}

/* ── Main page ─────────────────────────────────────────────── */
export default function IntegrityMonitoringPage() {
  const [exams, setExams] = useState<Exam[]>([]);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [selectedExamId, setSelectedExamId] = useState("");
  const [activeItem, setActiveItem] = useState("overview.courses");
  const [expanded, setExpanded] = useState(new Set(["overview"]));

  // Submit / predict flow
  const [selectedModel, setSelectedModel] = useState("vanilla_gcn");
  const [activityRows, setActivityRows] = useState<ActivityRow[] | null>(null);
  const [activityExam, setActivityExam] = useState<{ title: string; courseCode: string } | null>(null);
  const [loadingActivity, setLoadingActivity] = useState(false);
  const [predicting, setPredicting] = useState(false);
  const [predResult, setPredResult] = useState<PredResponse | null>(null);
  const [predMsg, setPredMsg] = useState("");

  // CSV upload flow
  const [uploading, setUploading] = useState(false);
  const [uploadedDatasetId, setUploadedDatasetId] = useState<string | null>(null);
  const [uploadName, setUploadName] = useState("");

  // Graph
  const [graphLayout, setGraphLayout] = useState<Layout>("spring");
  const [selectedNodeIdx, setSelectedNodeIdx] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const GW = 680, GH = 520;

  // Analyze
  const [benchmark, setBenchmark] = useState<BenchmarkResult | null>(null);
  const [benchLoading, setBenchLoading] = useState(false);

  // Settings
  const [highThreshold, setHighThreshold] = useState(0.7);
  const [medThreshold, setMedThreshold] = useState(0.3);

  useEffect(() => {
    api.get("/integrity/overview").then(({ data }) => setOverview(data.data)).catch(() => {});
    api.get("/exams").then(({ data }) => setExams(data.data || [])).catch(() => {});
  }, []);

  function nav(id: string) {
    setActiveItem(id);
    setExpanded((prev) => { const s = new Set(prev); s.add(id.split(".")[0]); return s; });
  }

  function toggleSection(id: string) {
    setExpanded((prev) => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });
  }

  async function loadActivity() {
    if (!selectedExamId) return;
    setLoadingActivity(true);
    setPredMsg("");
    try {
      const { data } = await api.get(`/integrity/exam/${selectedExamId}/activity`);
      setActivityRows(data.data.rows);
      setActivityExam(data.data.exam);
    } catch (e: any) {
      setPredMsg(e.response?.data?.error?.message || "Failed to load activity data");
    } finally { setLoadingActivity(false); }
  }

  async function runPrediction() {
    if (!selectedExamId) return;
    setPredicting(true); setPredMsg("");
    try {
      const { data } = await api.post(`/integrity/exam/${selectedExamId}/predict`, { model: selectedModel });
      setPredResult(data.data);
      nav("results.all");
      setPredMsg(`Prediction complete — ${data.data.cheaters} cheater(s) detected.`);
    } catch (e: any) {
      setPredMsg(e.response?.data?.error?.message || "Prediction failed");
    } finally { setPredicting(false); }
  }

  async function runUploadedPredict() {
    if (!uploadedDatasetId) return;
    setPredicting(true); setPredMsg("");
    try {
      if (selectedModel) { try { await api.post("/integrity/models/switch", { model: selectedModel }); } catch {} }
      const { data } = await api.post(`/integrity/datasets/${uploadedDatasetId}/predict`);
      const fake = data.data;
      const mapped: PredResponse = {
        exam: { title: uploadName || "Uploaded Dataset", courseCode: "" },
        examId: uploadedDatasetId,
        model_used: fake.model_used,
        total: fake.num_students,
        cheaters: fake.num_flagged,
        honest: fake.num_clean,
        high_risk: fake.predictions?.filter((p: any) => p.flagged_prob >= highThreshold).length ?? 0,
        medium_risk: fake.predictions?.filter((p: any) => p.flagged_prob >= medThreshold && p.flagged_prob < highThreshold).length ?? 0,
        low_risk: fake.predictions?.filter((p: any) => p.flagged_prob < medThreshold).length ?? 0,
        results: (fake.predictions || []).map((p: any) => ({
          student_id: p.student_id, student_name: p.student_id, student_username: p.student_id,
          prediction: p.prediction === "flagged" ? "cheater" : "honest" as const,
          label: p.prediction === "flagged" ? "Cheater" : "Honest" as const,
          risk: (p.flagged_prob >= highThreshold ? "high" : p.flagged_prob >= medThreshold ? "medium" : "low") as "high" | "medium" | "low",
          flagged_prob: p.flagged_prob, clean_prob: p.clean_prob,
          features: { tab_switch_flag: false, tab_switch_count: 0, answer_paste_flag: false, paste_event_count: 0, window_blur_count: 0, usb_detected: false, multi_device_login: false, time_per_question_std: 0 },
        })),
      };
      setPredResult(mapped); nav("results.all");
      setPredMsg(`Prediction complete — ${mapped.cheaters} cheater(s) detected.`);
    } catch (e: any) {
      setPredMsg(e.response?.data?.error?.message || "Prediction failed");
    } finally { setPredicting(false); }
  }

  async function handleCsvUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return;
    setUploading(true); setPredMsg("");
    try {
      const form = new FormData(); form.append("file", file); form.append("name", file.name.replace(/\.csv$/i, ""));
      const { data } = await api.post("/integrity/datasets/import", form, { headers: { "Content-Type": "multipart/form-data" } });
      setUploadedDatasetId(data.data.id); setUploadName(data.data.name);
      setPredMsg(`Uploaded "${data.data.name}" (${data.data.num_students} students). Ready to predict.`);
    } catch (e: any) { setPredMsg(e.response?.data?.error?.message || "Upload failed"); }
    finally { setUploading(false); e.target.value = ""; }
  }

  async function loadBenchmark() {
    setBenchLoading(true);
    try {
      const { data } = await api.get("/integrity/evaluate/all");
      setBenchmark(data.data);
    } catch {} finally { setBenchLoading(false); }
  }

  // Build graph edges from predictions
  const graphEdges = useMemo((): [number, number][] => {
    if (!predResult) return [];
    const edges: [number, number][] = [];
    const r = predResult.results;
    for (let i = 0; i < r.length; i++) for (let j = i + 1; j < r.length; j++) {
      const a = r[i], b = r[j];
      const sharedFlags = (Number(a.features.tab_switch_flag && b.features.tab_switch_flag) + Number(a.features.answer_paste_flag && b.features.answer_paste_flag) + Number(a.features.usb_detected && b.features.usb_detected) + Number(a.features.multi_device_login && b.features.multi_device_login));
      if (a.flagged_prob > medThreshold && b.flagged_prob > medThreshold && sharedFlags >= 1) edges.push([i, j]);
    }
    return edges;
  }, [predResult, medThreshold]);

  const graphPositions = useMemo(() => {
    if (!predResult?.results.length) return [];
    return computeLayout(predResult.results, graphEdges, graphLayout, GW, GH);
  }, [predResult, graphEdges, graphLayout]);

  function downloadSVG() {
    if (!svgRef.current) return;
    const blob = new Blob([new XMLSerializer().serializeToString(svgRef.current)], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = "gnn_graph.svg"; a.click(); URL.revokeObjectURL(url);
  }

  function renderContent() {
    const [sec, sub] = activeItem.split(".");
    if (sec === "overview") return <OverviewSection overview={overview} sub={sub} />;
    if (sec === "course_sessions") return <CourseSection exams={exams} selectedExamId={selectedExamId} setSelectedExamId={setSelectedExamId} activityRows={activityRows} activityExam={activityExam} loading={loadingActivity} onLoad={loadActivity} sub={sub} />;
    if (sec === "submit_scores") return <SubmitSection exams={exams} selectedExamId={selectedExamId} setSelectedExamId={setSelectedExamId} selectedModel={selectedModel} setSelectedModel={setSelectedModel} activityRows={activityRows} activityExam={activityExam} loadingActivity={loadingActivity} onLoadActivity={loadActivity} predicting={predicting} onRunPredict={runPrediction} onCsvUpload={handleCsvUpload} uploadedDatasetId={uploadedDatasetId} uploadName={uploadName} uploading={uploading} onRunUploaded={runUploadedPredict} msg={predMsg} sub={sub} />;
    if (sec === "results") return predResult ? <ResultsSection predResult={predResult} sub={sub} highThreshold={highThreshold} medThreshold={medThreshold} /> : <Empty msg="No prediction results yet. Run a prediction from Submit Scores." />;
    if (sec === "graph") return predResult ? <GraphSection nodes={predResult.results} edges={graphEdges} positions={graphPositions} layout={graphLayout} setLayout={setGraphLayout} svgRef={svgRef} selectedNodeIdx={selectedNodeIdx} setSelectedNodeIdx={setSelectedNodeIdx} onDownload={downloadSVG} sub={sub} GW={GW} GH={GH} /> : <Empty msg="No prediction data. Run a prediction first." />;
    if (sec === "analyze") return <AnalyzeSection benchmark={benchmark} loading={benchLoading} onLoad={loadBenchmark} sub={sub} />;
    if (sec === "reports") return <ReportsSection predResult={predResult} activityRows={activityRows} activityExam={activityExam} benchmark={benchmark} sub={sub} />;
    if (sec === "queue") return <QueueSection predicting={predicting} uploadedDatasetId={uploadedDatasetId} msg={predMsg} onReset={() => { setPredResult(null); setActivityRows(null); setUploadedDatasetId(null); setPredMsg("Session cleared."); }} sub={sub} />;
    if (sec === "settings") return <SettingsSection highThreshold={highThreshold} setHighThreshold={setHighThreshold} medThreshold={medThreshold} setMedThreshold={setMedThreshold} selectedModel={selectedModel} setSelectedModel={setSelectedModel} graphLayout={graphLayout} setGraphLayout={setGraphLayout} sub={sub} />;
    return null;
  }

  return (
    <DashboardShell>
      <header className="mb-8">
        <GradientHeading highlight="Integrity" title="Monitoring." subtitle="Run GNN predictions on exam sessions, analyze behavioral patterns, visualize academic dishonesty networks, and generate integrity reports." />
      </header>

      <div className="flex gap-5">
        {/* Sidebar */}
        <aside className="w-56 shrink-0">
          <div className="sticky top-6 space-y-0.5 rounded-xl border border-white/5 bg-slate-950/60 p-2 backdrop-blur-xl">
            {NAV_TREE.map((sec) => {
              const isExp = expanded.has(sec.id);
              const isActive = activeItem.startsWith(sec.id + ".");
              return (
                <div key={sec.id}>
                  <button onClick={() => { toggleSection(sec.id); if (!isExp) nav(`${sec.id}.${sec.items[0].id.split(".")[1]}`); }} className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[11px] font-semibold transition ${isActive ? "bg-indigo-500/15 text-indigo-300" : "text-white/55 hover:bg-white/5 hover:text-white"}`}>
                    <Svg d={sec.icon} size={13} />
                    <span className="flex-1 truncate">{sec.label}</span>
                    <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2.5" className={`shrink-0 transition-transform ${isExp ? "rotate-180" : ""}`}><path d="M6 9l6 6 6-6" strokeLinecap="round" /></svg>
                  </button>
                  {isExp && <div className="ml-2 mt-0.5 space-y-0.5 border-l border-white/5 pl-3">{sec.items.map((item) => <button key={item.id} onClick={() => nav(item.id)} className={`block w-full rounded-md px-2 py-1.5 text-left text-[10px] transition ${activeItem === item.id ? "bg-white/10 font-semibold text-white" : "text-white/35 hover:bg-white/5 hover:text-white"}`}>{item.label}</button>)}</div>}
                </div>
              );
            })}
          </div>
        </aside>

        {/* Main */}
        <div className="min-w-0 flex-1">{renderContent()}</div>
      </div>
    </DashboardShell>
  );
}

/* ════════════════════════════════════════════════════════════ */
/* Section Components                                           */
/* ════════════════════════════════════════════════════════════ */

function OverviewSection({ overview, sub }: { overview: Overview | null; sub: string }) {
  if (!overview) return <Spinner />;
  const items = [
    { label: "Total Courses", value: overview.totalCourses, accent: "indigo" as const, icon: "M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" },
    { label: "Active Sessions", value: overview.activeSessions, accent: "blue" as const, icon: "M15 10l4.553-2.069A1 1 0 0121 8.87v6.26a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" },
    { label: "Total Submissions", value: overview.totalSubmissions, accent: "emerald" as const, icon: "M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" },
    { label: "Total Predictions Run", value: overview.totalPredictions, accent: "purple" as const, icon: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" },
  ];
  return (
    <div className="space-y-6">
      <SectionHeader title={sub === "summary" ? "Integrity Summary" : sub === "sessions" ? "Active Monitoring Sessions" : sub === "submissions" ? "Total Submissions" : "Total Courses"} />
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {items.map((i) => <StatCard key={i.label} label={i.label} value={i.value} accent={i.accent} icon={<Svg d={i.icon} />} />)}
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        {[
          { label: "Cheating Detected", value: overview.flaggedPredictions, color: "text-rose-400", bg: "from-rose-500/10 to-rose-500/5" },
          { label: "Clean Predictions", value: overview.cleanPredictions, color: "text-emerald-400", bg: "from-emerald-500/10 to-emerald-500/5" },
          { label: "Detection Rate", value: overview.totalPredictions > 0 ? `${((overview.flaggedPredictions / overview.totalPredictions) * 100).toFixed(1)}%` : "—", color: "text-amber-400", bg: "from-amber-500/10 to-amber-500/5" },
        ].map((c) => (
          <div key={c.label} className={`rounded-xl border border-white/5 bg-gradient-to-b ${c.bg} p-5`}>
            <p className="text-xs font-semibold uppercase tracking-wider text-white/40">{c.label}</p>
            <p className={`mt-2 text-3xl font-bold ${c.color}`}>{c.value}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function CourseSection({ exams, selectedExamId, setSelectedExamId, activityRows, activityExam, loading, onLoad, sub }: { exams: Exam[]; selectedExamId: string; setSelectedExamId: (v: string) => void; activityRows: ActivityRow[] | null; activityExam: { title: string; courseCode: string } | null; loading: boolean; onLoad: () => void; sub: string; }) {
  const title = sub === "logs" ? "Student Activity Logs" : sub === "count" ? "Submission Count" : sub === "history" ? "Monitoring History" : "Select Course";
  return (
    <div className="space-y-6">
      <SectionHeader title={title} />
      <GlowCard title="Exam Selection" description="Choose an exam to view its session data and behavioral activity">
        <div className="flex flex-wrap items-end gap-4">
          <div className="min-w-[240px] flex-1 space-y-1.5">
            <label className="text-[10px] font-semibold uppercase tracking-wider text-white/50">Exam</label>
            <select className="auth-input flex h-11 w-full rounded-lg px-3 text-sm" value={selectedExamId} onChange={(e) => setSelectedExamId(e.target.value)}>
              <option value="" className="bg-slate-900">Select exam…</option>
              {exams.map((e) => <option key={e.id} value={e.id} className="bg-slate-900">{e.title} ({e.courseCode})</option>)}
            </select>
          </div>
          <GlowButton onClick={onLoad} disabled={!selectedExamId || loading} variant="gradient">
            {loading ? "Loading…" : "Load Activity Data"}
          </GlowButton>
        </div>
      </GlowCard>
      {loading && <Spinner />}
      {activityRows && !loading && (
        <GlowCard title={`Activity Logs — ${activityExam?.title}`} description={`${activityRows.length} student session(s) loaded`}>
          {activityRows.length === 0 ? <Empty msg="No sessions found for this exam." /> : (
            <div className="max-h-80 overflow-auto rounded-lg border border-white/10">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-slate-950/90">
                  <tr>{["Student", "Username", "Tab Switches", "Pastes", "Blurs", "USB", "Multi-Device", "TPQ Std"].map((h) => <th key={h} className="border-b border-white/10 p-2.5 text-left font-semibold uppercase tracking-wider text-white/40">{h}</th>)}</tr>
                </thead>
                <tbody>
                  {activityRows.map((r) => (
                    <tr key={r.student_id} className="border-b border-white/5 hover:bg-white/[0.03]">
                      <td className="p-2.5 font-medium text-white">{r.student_name}</td>
                      <td className="p-2.5 text-white/50">{r.student_username}</td>
                      <td className="p-2.5">{r.tab_switch_count > 0 ? <span className="text-amber-400 font-semibold">{r.tab_switch_count}</span> : <span className="text-white/30">0</span>}</td>
                      <td className="p-2.5">{r.paste_event_count > 0 ? <span className="text-rose-400 font-semibold">{r.paste_event_count}</span> : <span className="text-white/30">0</span>}</td>
                      <td className="p-2.5 text-white/50">{r.window_blur_count}</td>
                      <td className="p-2.5">{r.usb_device_detection_count > 0 ? <span className="text-rose-400 font-semibold">Yes</span> : <span className="text-white/30">No</span>}</td>
                      <td className="p-2.5">{r.multi_device_login_flag ? <span className="text-rose-400 font-semibold">Yes</span> : <span className="text-white/30">No</span>}</td>
                      <td className="p-2.5 text-white/50">{r.time_per_question_std}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </GlowCard>
      )}
    </div>
  );
}

function SubmitSection({ exams, selectedExamId, setSelectedExamId, selectedModel, setSelectedModel, activityRows, activityExam, loadingActivity, onLoadActivity, predicting, onRunPredict, onCsvUpload, uploadedDatasetId, uploadName, uploading, onRunUploaded, msg, sub }: { exams: Exam[]; selectedExamId: string; setSelectedExamId: (v: string) => void; selectedModel: string; setSelectedModel: (v: string) => void; activityRows: ActivityRow[] | null; activityExam: any; loadingActivity: boolean; onLoadActivity: () => void; predicting: boolean; onRunPredict: () => void; onCsvUpload: (e: React.ChangeEvent<HTMLInputElement>) => void; uploadedDatasetId: string | null; uploadName: string; uploading: boolean; onRunUploaded: () => void; msg: string; sub: string; }) {
  function downloadActivityCSV() {
    if (!activityRows) return;
    const headers = ["student_id", "student_username", "student_name", "tab_switch_flag", "tab_switch_count", "time_away_exam_site", "answer_paste_flag", "paste_event_count", "usb_device_detection_count", "window_minimize_flag", "window_blur_count", "multi_device_login_flag", "avg_answer_similarity", "time_per_question_std", "response_time_pattern", "ip_similarity_score", "suspicion_label"];
    downloadCSV(`${activityExam?.courseCode || "exam"}_activity.csv`, headers, activityRows.map((r) => headers.map((h) => (r as any)[h] ?? "")));
  }

  return (
    <div className="space-y-6">
      <SectionHeader title="Submit Scores to Check Integrity" desc="Generate behavioral data from exam sessions or upload your own CSV, then run GNN prediction" />
      {msg && <div className={`rounded-lg border px-3 py-2.5 text-xs ${msg.includes("failed") || msg.includes("Failed") ? "border-rose-500/30 bg-rose-500/10 text-rose-300" : "border-indigo-500/20 bg-indigo-500/10 text-indigo-300"}`}>{msg}</div>}

      {/* Step 1 – Generate CSV */}
      <GlowCard title="Step 1 — Generate Activity CSV" description="Pull behavioral signals from your exam sessions in the database">
        <div className="flex flex-wrap items-end gap-4 mb-4">
          <div className="min-w-[220px] flex-1 space-y-1.5">
            <label className="text-[10px] font-semibold uppercase tracking-wider text-white/50">Exam</label>
            <select className="auth-input flex h-11 w-full rounded-lg px-3 text-sm" value={selectedExamId} onChange={(e) => setSelectedExamId(e.target.value)}>
              <option value="" className="bg-slate-900">Select exam…</option>
              {exams.map((e) => <option key={e.id} value={e.id} className="bg-slate-900">{e.title} ({e.courseCode})</option>)}
            </select>
          </div>
          <GlowButton onClick={onLoadActivity} disabled={!selectedExamId || loadingActivity} variant="ghost">{loadingActivity ? "Loading…" : "Load Data"}</GlowButton>
          {activityRows && <GlowButton onClick={downloadActivityCSV} variant="ghost"><Svg d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" size={14} /> Download CSV</GlowButton>}
        </div>
        {activityRows && (
          <div className="rounded-lg border border-white/5 bg-white/[0.02] p-3 text-xs text-white/50">
            <span className="font-semibold text-white">{activityRows.length}</span> student records loaded for <span className="font-semibold text-indigo-300">{activityExam?.title}</span>. CSV columns: student_id, student_username, student_name, tab_switch_flag, tab_switch_count, time_away_exam_site, answer_paste_flag, paste_event_count, usb_device_detection_count, window_minimize_flag, window_blur_count, multi_device_login_flag, avg_answer_similarity, time_per_question_std, response_time_pattern, ip_similarity_score, suspicion_label.
          </div>
        )}
      </GlowCard>

      {/* Step 2 – Model */}
      <GlowCard title="Step 2 — Select Model" description="Choose the GNN architecture for prediction">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {MODELS.map((m) => (
            <button key={m} onClick={() => setSelectedModel(m)} className={`rounded-lg border p-3 text-left text-xs font-semibold transition ${selectedModel === m ? "border-indigo-400/40 bg-indigo-500/10 text-white" : "border-white/10 bg-white/[0.02] text-white/60 hover:bg-white/5"}`}>
              {m.replace(/_/g, " ").toUpperCase()}
            </button>
          ))}
        </div>
      </GlowCard>

      {/* Step 3a – Run on exam data */}
      <GlowCard title="Step 3a — Run Prediction on Exam Data" description="Use the activity data loaded above to run GNN prediction">
        <GlowButton onClick={onRunPredict} disabled={!selectedExamId || predicting || !activityRows} variant="gradient">
          {predicting ? <span className="flex items-center gap-2"><svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25" /><path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="3" strokeLinecap="round" /></svg>Running…</span> : "Run Prediction"}
        </GlowButton>
        {!activityRows && <p className="mt-2 text-xs text-white/30">Load activity data (Step 1) first.</p>}
      </GlowCard>

      {/* Step 3b – Upload CSV */}
      <GlowCard title="Step 3b — Upload Custom CSV Dataset" description="Upload your own CSV (student_id + behavioral columns)">
        <div className="flex flex-wrap items-center gap-4">
          <label className="inline-flex h-11 cursor-pointer items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-4 text-sm font-medium text-white/80 transition hover:bg-white/10">
            <Svg d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
            {uploading ? "Uploading…" : "Upload CSV"}
            <input type="file" accept=".csv" className="hidden" onChange={onCsvUpload} disabled={uploading} />
          </label>
          {uploadedDatasetId && (
            <div className="flex items-center gap-3">
              <span className="text-xs text-emerald-400">✓ "{uploadName}" ready</span>
              <GlowButton onClick={onRunUploaded} disabled={predicting} variant="gradient">
                {predicting ? "Predicting…" : "Run Prediction on Upload"}
              </GlowButton>
            </div>
          )}
        </div>
        <p className="mt-3 text-xs text-white/30">Required column: <code className="text-indigo-300">student_id</code>. Optional: tab_switch_count, paste_event_count, window_blur_count, usb_detected, multi_device_login, avg_answer_similarity, time_per_question_std, response_time_pattern, ip_similarity_score, seat_x, seat_y, label.</p>
      </GlowCard>
    </div>
  );
}

function ResultsSection({ predResult, sub, highThreshold, medThreshold }: { predResult: PredResponse; sub: string; highThreshold: number; medThreshold: number; }) {
  const all = predResult.results;
  const filtered = sub === "high" ? all.filter((r) => r.risk === "high") : sub === "medium" ? all.filter((r) => r.risk === "medium") : sub === "low" ? all.filter((r) => r.risk === "low") : sub === "scores" ? [...all].sort((a, b) => b.flagged_prob - a.flagged_prob) : all;
  const title = sub === "high" ? "High Risk — Cheater" : sub === "medium" ? "Medium Risk" : sub === "low" ? "Low Risk — Honest" : sub === "scores" ? "Integrity Scores" : sub === "logs" ? "Prediction Logs" : "All Predictions";

  const FEATURE_COLS: { key: keyof typeof all[0]["features"]; label: string; binary: boolean }[] = [
    { key: "tab_switch_flag", label: "Tab Switch", binary: true }, { key: "tab_switch_count", label: "Tab Count", binary: false },
    { key: "answer_paste_flag", label: "Paste", binary: true }, { key: "paste_event_count", label: "Paste Count", binary: false },
    { key: "window_blur_count", label: "Blurs", binary: false }, { key: "usb_detected", label: "USB", binary: true },
    { key: "multi_device_login", label: "Multi-Device", binary: true }, { key: "time_per_question_std", label: "TPQ Std", binary: false },
  ];

  if (sub === "logs") {
    const distData = [
      { name: "Cheater", count: predResult.cheaters, fill: "#f87171" },
      { name: "Honest", count: predResult.honest, fill: "#34d399" },
    ];
    return (
      <div className="space-y-6">
        <SectionHeader title="Prediction Logs" />
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <StatCard label="Total Analysed" value={predResult.total} accent="indigo" icon={<Svg d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />} />
          <StatCard label="Cheaters" value={predResult.cheaters} accent="rose" icon={<Svg d="M12 9v2m0 4h.01" />} />
          <StatCard label="Honest" value={predResult.honest} accent="emerald" icon={<Svg d="M9 12l2 2 4-4" />} />
          <StatCard label="Model Used" value={predResult.model_used.replace(/_/g, " ").toUpperCase()} accent="purple" icon={<Svg d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17H3a2 2 0 01-2-2V5a2 2 0 012-2h16a2 2 0 012 2v10a2 2 0 01-2 2h-2" />} />
        </div>
        <GlowCard title="Prediction Distribution">
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={distData} margin={{ top: 8, right: 8, left: 0, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
              <XAxis dataKey="name" tick={{ fontSize: 13, fontWeight: "bold", fill: "rgba(255,255,255,0.7)" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 10, fill: "rgba(255,255,255,0.4)" }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={TOOLTIP_STYLE} />
              <Bar dataKey="count" radius={[6, 6, 0, 0]}>{distData.map((d) => <Cell key={d.name} fill={d.fill} />)}</Bar>
            </BarChart>
          </ResponsiveContainer>
        </GlowCard>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <SectionHeader title={title} desc={`${filtered.length} student(s) • Exam: ${predResult.exam.title} • Model: ${predResult.model_used}`} />
      <div className="grid grid-cols-3 gap-3 sm:grid-cols-6 mb-2">
        {[{ l: "Total", v: predResult.total, c: "text-white" }, { l: "Cheaters", v: predResult.cheaters, c: "text-rose-400" }, { l: "Honest", v: predResult.honest, c: "text-emerald-400" }, { l: "High Risk", v: predResult.high_risk, c: "text-rose-300" }, { l: "Medium", v: predResult.medium_risk, c: "text-amber-300" }, { l: "Low", v: predResult.low_risk, c: "text-emerald-300" }].map((x) => (
          <div key={x.l} className="rounded-xl border border-white/5 bg-white/[0.02] p-3 text-center"><p className="text-[10px] uppercase tracking-wider text-white/30">{x.l}</p><p className={`mt-1 text-xl font-bold ${x.c}`}>{x.v}</p></div>
        ))}
      </div>
      {filtered.length === 0 ? <Empty msg={`No students in this category.`} /> : (
        <div className="overflow-x-auto rounded-xl border border-white/10">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-slate-950/90">
              <tr>
                {["Student Name", "Username", "Prediction", "Risk", "Confidence", ...FEATURE_COLS.map((f) => f.label)].map((h) => (
                  <th key={h} className="border-b border-white/10 p-2.5 text-left font-semibold uppercase tracking-wider text-white/35">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.student_id} className={`border-b border-white/5 transition hover:bg-white/[0.03] ${r.prediction === "cheater" ? "bg-rose-500/[0.02]" : ""}`}>
                  <td className="p-2.5 font-semibold text-white">{r.student_name}</td>
                  <td className="p-2.5 text-white/50">{r.student_username}</td>
                  <td className="p-2.5">
                    <span className={`rounded px-2 py-1 text-[11px] font-bold ${r.prediction === "cheater" ? "bg-rose-500/20 text-rose-300" : "bg-emerald-500/15 text-emerald-300"}`}>{r.label}</span>
                  </td>
                  <td className="p-2.5">{riskBadge(r.risk)}</td>
                  <td className="p-2.5">
                    <div className="flex items-center gap-1.5">
                      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-white/10">
                        <div className={`h-1.5 rounded-full ${r.prediction === "cheater" ? "bg-rose-400" : "bg-emerald-400"}`} style={{ width: `${r.flagged_prob * 100}%` }} />
                      </div>
                      <span className="font-mono text-white/60">{(r.flagged_prob * 100).toFixed(1)}%</span>
                    </div>
                  </td>
                  {FEATURE_COLS.map((fc) => (
                    <td key={fc.key} className="p-2.5">
                      {fc.binary ? boolFeature(r.features[fc.key] as boolean) : <span className="text-white/60">{String(r.features[fc.key])}</span>}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function GraphSection({ nodes, edges, positions, layout, setLayout, svgRef, selectedNodeIdx, setSelectedNodeIdx, onDownload, sub, GW, GH }: { nodes: PredResult[]; edges: [number, number][]; positions: { x: number; y: number }[]; layout: Layout; setLayout: (v: Layout) => void; svgRef: React.RefObject<SVGSVGElement>; selectedNodeIdx: number | null; setSelectedNodeIdx: (v: number | null) => void; onDownload: () => void; sub: string; GW: number; GH: number; }) {
  const [tooltip, setTooltip] = useState<{ x: number; y: number; node: PredResult } | null>(null);
  const selNode = selectedNodeIdx !== null ? nodes[selectedNodeIdx] : null;

  return (
    <div className="space-y-6">
      <SectionHeader title="GNN Graph Visualization" desc="Nodes = students | Red = Cheater | Green = Honest | Edges = shared risk indicators | Node size = confidence" />
      <GlowCard title="Layout" description="Select how nodes are arranged in the graph">
        <div className="flex flex-wrap gap-2">
          {LAYOUTS.map((l) => (
            <button key={l.id} onClick={() => setLayout(l.id)} className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition ${layout === l.id ? "border-indigo-400/40 bg-indigo-500/15 text-white" : "border-white/10 bg-white/[0.02] text-white/50 hover:bg-white/5 hover:text-white"}`}>{l.label}</button>
          ))}
        </div>
      </GlowCard>
      {nodes.length === 0 ? <Empty msg="No prediction data for graph. Run a prediction first." /> : (
        <GlowCard>
          <div className="relative overflow-hidden rounded-xl" onMouseLeave={() => setTooltip(null)}>
            <svg ref={svgRef} width={GW} height={GH} className="w-full max-h-[520px]" style={{ background: "rgba(255,255,255,0.01)" }}>
              <defs>
                <radialGradient id="cheat_node"><stop offset="0%" stopColor="#f87171" stopOpacity={0.9} /><stop offset="100%" stopColor="#dc2626" stopOpacity={0.6} /></radialGradient>
                <radialGradient id="honest_node"><stop offset="0%" stopColor="#34d399" stopOpacity={0.9} /><stop offset="100%" stopColor="#059669" stopOpacity={0.6} /></radialGradient>
              </defs>
              {edges.map(([s, t], i) => positions[s] && positions[t] && (
                <line key={i} x1={positions[s].x} y1={positions[s].y} x2={positions[t].x} y2={positions[t].y} stroke="rgba(255,200,100,0.25)" strokeWidth={1.5} strokeDasharray="4 3" />
              ))}
              {nodes.map((nd, i) => { if (!positions[i]) return null; const isCheat = nd.prediction === "cheater"; const r = 7 + nd.flagged_prob * 10; return (
                <g key={nd.student_id} transform={`translate(${positions[i].x},${positions[i].y})`} onClick={() => setSelectedNodeIdx(i === selectedNodeIdx ? null : i)} onMouseEnter={(e) => setTooltip({ x: e.clientX, y: e.clientY, node: nd })} className="cursor-pointer">
                  <circle r={r} fill={isCheat ? "url(#cheat_node)" : "url(#honest_node)"} stroke={selectedNodeIdx === i ? "white" : "rgba(0,0,0,0.4)"} strokeWidth={selectedNodeIdx === i ? 2.5 : 0.8} />
                  <text textAnchor="middle" dy={r + 12} fontSize={8} fill="rgba(255,255,255,0.45)" className="select-none pointer-events-none">{nd.student_name.split(" ")[0]}</text>
                </g>
              ); })}
            </svg>
            <div className="absolute bottom-3 left-3 flex items-center gap-3 rounded-lg border border-white/10 bg-slate-950/80 px-3 py-1.5 text-[10px]">
              <span className="flex items-center gap-1"><span className="h-3 w-3 rounded-full bg-rose-400" /> Cheater</span>
              <span className="flex items-center gap-1"><span className="h-3 w-3 rounded-full bg-emerald-400" /> Honest</span>
              <span className="text-white/30">Node size ∝ confidence</span>
            </div>
          </div>
          <div className="mt-3 flex items-center justify-between">
            <p className="text-xs text-white/30">{nodes.length} nodes · {edges.length} edges · Click node to inspect</p>
            <GlowButton onClick={onDownload} variant="ghost" size="sm"><Svg d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" size={13} /> Download SVG</GlowButton>
          </div>
        </GlowCard>
      )}
      {selNode && (
        <GlowCard title={`Node: ${selNode.student_name}`} description={`${selNode.label} · ${selNode.risk} risk`}>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[{ l: "Prediction", v: selNode.label, c: selNode.prediction === "cheater" ? "text-rose-300" : "text-emerald-300" }, { l: "Confidence", v: `${(selNode.flagged_prob * 100).toFixed(1)}%`, c: "text-white" }, { l: "Risk", v: selNode.risk.toUpperCase(), c: selNode.risk === "high" ? "text-rose-300" : selNode.risk === "medium" ? "text-amber-300" : "text-emerald-300" }, { l: "Clean Prob", v: `${(selNode.clean_prob * 100).toFixed(1)}%`, c: "text-white" }].map((x) => (
              <div key={x.l} className="rounded-lg border border-white/5 bg-white/[0.02] p-3"><p className="text-[10px] uppercase tracking-wider text-white/30">{x.l}</p><p className={`mt-1 text-sm font-bold ${x.c}`}>{x.v}</p></div>
            ))}
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
            {Object.entries(selNode.features).map(([k, v]) => (
              <div key={k} className="rounded-lg border border-white/5 bg-white/[0.02] p-2">
                <p className="text-[9px] uppercase tracking-wider text-white/30">{k.replace(/_/g, " ")}</p>
                <p className="mt-0.5 font-medium text-white">{typeof v === "boolean" ? (v ? "Yes" : "No") : String(v)}</p>
              </div>
            ))}
          </div>
        </GlowCard>
      )}
    </div>
  );
}

function AnalyzeSection({ benchmark, loading, onLoad, sub }: { benchmark: BenchmarkResult | null; loading: boolean; onLoad: () => void; sub: string; }) {
  const current = benchmark?.results[0];
  return (
    <div className="space-y-6">
      <SectionHeader title={sub === "confusion" ? "Confusion Matrix" : sub === "fp" ? "False Positive Analysis" : sub === "fn" ? "False Negative Analysis" : sub === "classification" ? "Classification Report" : "Model Metrics"} desc="Evaluated on synthetic benchmark data with known labels" />
      {!benchmark && !loading && (
        <GlowCard title="Run Model Benchmark">
          <GlowButton onClick={onLoad} variant="gradient">Run All Models Benchmark</GlowButton>
        </GlowCard>
      )}
      {loading && <Spinner />}
      {benchmark && (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            {benchmark.results.map((r) => {
              const cm = r.confusion_matrix;
              const TP = cm?.[1]?.[1] ?? 0, TN = cm?.[0]?.[0] ?? 0, FP = cm?.[0]?.[1] ?? 0, FN = cm?.[1]?.[0] ?? 0;
              return (
                <GlowCard key={r.model} title={r.model.replace(/_/g, " ").toUpperCase()}>
                  <div className="mb-4 grid grid-cols-3 gap-2 text-center">
                    {[{ l: "F1", v: (r.f1_macro * 100).toFixed(1) + "%", c: "text-purple-300" }, { l: "Precision", v: (r.precision_macro * 100).toFixed(1) + "%", c: "text-blue-300" }, { l: "Recall", v: (r.recall_macro * 100).toFixed(1) + "%", c: "text-emerald-300" }, { l: "Accuracy", v: (r.accuracy * 100).toFixed(1) + "%", c: "text-amber-300" }, { l: "Train Acc", v: (r.train_acc * 100).toFixed(1) + "%", c: "text-white" }, { l: "Nodes", v: benchmark.dataset_info.num_nodes, c: "text-white/60" }].map((x) => (
                      <div key={x.l} className="rounded-lg border border-white/5 bg-white/[0.02] p-2"><p className="text-[9px] uppercase tracking-wider text-white/30">{x.l}</p><p className={`mt-0.5 text-sm font-bold ${x.c}`}>{x.v}</p></div>
                    ))}
                  </div>
                  {cm && (
                    <div>
                      <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-white/30">Confusion Matrix</p>
                      <div className="grid grid-cols-2 gap-1 text-center text-xs">
                        {[{ l: "True Negative", v: TN, c: "text-emerald-400 bg-emerald-500/10" }, { l: "False Positive", v: FP, c: "text-amber-400 bg-amber-500/10" }, { l: "False Negative", v: FN, c: "text-rose-400 bg-rose-500/10" }, { l: "True Positive", v: TP, c: "text-blue-400 bg-blue-500/10" }].map((x) => (
                          <div key={x.l} className={`rounded p-2 ${x.c}`}><p className="text-[9px] text-white/40">{x.l}</p><p className="text-lg font-bold">{x.v}</p></div>
                        ))}
                      </div>
                      {sub === "fp" && FP > 0 && <p className="mt-3 text-xs text-amber-300 border border-amber-500/20 bg-amber-500/5 rounded p-2">⚠ {FP} honest student(s) incorrectly flagged as cheaters. Lower the detection threshold in Settings to reduce false positives.</p>}
                      {sub === "fn" && FN > 0 && <p className="mt-3 text-xs text-rose-300 border border-rose-500/20 bg-rose-500/5 rounded p-2">⚠ {FN} cheater(s) missed by the model. Raise the detection threshold or switch to a more sensitive model.</p>}
                    </div>
                  )}
                </GlowCard>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

function ReportsSection({ predResult, activityRows, activityExam, benchmark, sub }: { predResult: PredResponse | null; activityRows: ActivityRow[] | null; activityExam: any; benchmark: BenchmarkResult | null; sub: string; }) {
  function exportPredictions() {
    if (!predResult) return;
    downloadCSV(`${predResult.exam?.courseCode || "exam"}_predictions.csv`,
      ["student_id", "student_name", "student_username", "prediction", "risk", "flagged_prob", "clean_prob", "tab_switch_flag", "tab_switch_count", "answer_paste_flag", "paste_event_count", "window_blur_count", "usb_detected", "multi_device_login", "time_per_question_std"],
      predResult.results.map((r) => [r.student_id, r.student_name, r.student_username, r.label, r.risk, r.flagged_prob, r.clean_prob, r.features.tab_switch_flag ? "Yes" : "No", r.features.tab_switch_count, r.features.answer_paste_flag ? "Yes" : "No", r.features.paste_event_count, r.features.window_blur_count, r.features.usb_detected ? "Yes" : "No", r.features.multi_device_login ? "Yes" : "No", r.features.time_per_question_std]));
  }
  function exportActivity() {
    if (!activityRows) return;
    const h = ["student_id", "student_username", "student_name", "tab_switch_flag", "tab_switch_count", "time_away_exam_site", "answer_paste_flag", "paste_event_count", "usb_device_detection_count", "window_minimize_flag", "window_blur_count", "multi_device_login_flag", "avg_answer_similarity", "time_per_question_std", "response_time_pattern", "ip_similarity_score", "suspicion_label"];
    downloadCSV(`${activityExam?.courseCode || "exam"}_activity.csv`, h, activityRows.map((r) => h.map((k) => (r as any)[k] ?? "")));
  }
  function exportMetrics() {
    if (!benchmark) return;
    downloadCSV("model_metrics.csv",
      ["model", "f1_macro", "precision_macro", "recall_macro", "accuracy", "train_acc"],
      benchmark.results.map((r) => [r.model, r.f1_macro.toFixed(4), r.precision_macro.toFixed(4), r.recall_macro.toFixed(4), r.accuracy.toFixed(4), r.train_acc.toFixed(4)]));
  }
  const btns = [
    { label: "Download Prediction Results", desc: predResult ? `${predResult.total} students` : "No predictions yet", action: exportPredictions, disabled: !predResult, icon: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2" },
    { label: "Download CSV Dataset", desc: activityRows ? `${activityRows.length} rows` : "No activity data", action: exportActivity, disabled: !activityRows, icon: "M9 12h6M9 16h6M9 8h6M5 3h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2z" },
    { label: "Download Model Metrics", desc: benchmark ? `${benchmark.results.length} models` : "No benchmark data", action: exportMetrics, disabled: !benchmark, icon: "M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10" },
    { label: "Export PDF Report", desc: "Print current page", action: () => window.print(), disabled: false, icon: "M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" },
  ];
  return (
    <div className="space-y-6">
      <SectionHeader title="Reports & Downloads" />
      <div className="grid gap-4 sm:grid-cols-2">
        {btns.map((b) => (
          <button key={b.label} onClick={b.action} disabled={b.disabled} className="flex items-start gap-4 rounded-xl border border-white/5 bg-white/[0.02] p-5 text-left transition hover:border-white/10 hover:bg-white/5 disabled:opacity-40">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white/5"><Svg d={b.icon} /></div>
            <div><p className="font-semibold text-white">{b.label}</p><p className="mt-0.5 text-xs text-white/40">{b.desc}</p></div>
          </button>
        ))}
      </div>
    </div>
  );
}

function QueueSection({ predicting, uploadedDatasetId, msg, onReset, sub }: { predicting: boolean; uploadedDatasetId: string | null; msg: string; onReset: () => void; sub: string; }) {
  return (
    <div className="space-y-6">
      <SectionHeader title={sub === "reset" ? "Reset Session" : sub === "await" ? "Await New Dataset" : "Model Queue & Processing"} />
      <GlowCard title="Processing Status">
        <div className="space-y-3">
          <div className="flex items-center gap-3 rounded-lg border border-white/5 bg-white/[0.02] p-3">
            <div className={`h-2.5 w-2.5 rounded-full ${predicting ? "animate-pulse bg-amber-400" : "bg-white/20"}`} />
            <p className="text-sm text-white">{predicting ? "Prediction in progress…" : "No active prediction"}</p>
          </div>
          <div className="flex items-center gap-3 rounded-lg border border-white/5 bg-white/[0.02] p-3">
            <div className={`h-2.5 w-2.5 rounded-full ${uploadedDatasetId ? "bg-emerald-400" : "bg-white/20"}`} />
            <p className="text-sm text-white">{uploadedDatasetId ? `Dataset ready: ID ${uploadedDatasetId}` : "No dataset uploaded"}</p>
          </div>
        </div>
        {msg && <div className="mt-3 rounded border border-white/10 bg-white/[0.02] p-2 text-xs text-white/50">{msg}</div>}
      </GlowCard>
      <GlowCard title="Reset Session" description="Clear all prediction results and loaded data for a fresh start">
        <GlowButton onClick={onReset} variant="ghost">
          <Svg d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /> Reset Session
        </GlowButton>
        <p className="mt-2 text-xs text-white/30">Clears predictions, activity data, and uploaded dataset ID from this session.</p>
      </GlowCard>
    </div>
  );
}

function SettingsSection({ highThreshold, setHighThreshold, medThreshold, setMedThreshold, selectedModel, setSelectedModel, graphLayout, setGraphLayout, sub }: { highThreshold: number; setHighThreshold: (v: number) => void; medThreshold: number; setMedThreshold: (v: number) => void; selectedModel: string; setSelectedModel: (v: string) => void; graphLayout: Layout; setGraphLayout: (v: Layout) => void; sub: string; }) {
  return (
    <div className="space-y-6">
      <SectionHeader title={sub === "risk" ? "Risk Classification" : sub === "model" ? "Model Preferences" : sub === "graph" ? "Graph Settings" : "Threshold Configuration"} />
      <GlowCard title="Risk Classification Thresholds" description="Scores above high threshold = High Risk (Cheater). Between thresholds = Medium. Below = Low Risk (Honest).">
        <div className="grid gap-5 sm:grid-cols-2">
          <div className="space-y-2">
            <label className="text-[10px] font-semibold uppercase tracking-wider text-white/50">High Risk Threshold (flagged_prob ≥)</label>
            <div className="flex items-center gap-4"><input type="range" min={0.5} max={0.95} step={0.05} value={highThreshold} onChange={(e) => setHighThreshold(Number(e.target.value))} className="w-full accent-rose-500" /><div className="flex h-10 w-16 shrink-0 items-center justify-center rounded-lg border border-rose-500/20 bg-rose-500/10 text-sm font-bold text-rose-300">{highThreshold.toFixed(2)}</div></div>
          </div>
          <div className="space-y-2">
            <label className="text-[10px] font-semibold uppercase tracking-wider text-white/50">Medium Risk Threshold (flagged_prob ≥)</label>
            <div className="flex items-center gap-4"><input type="range" min={0.1} max={0.49} step={0.05} value={medThreshold} onChange={(e) => setMedThreshold(Number(e.target.value))} className="w-full accent-amber-500" /><div className="flex h-10 w-16 shrink-0 items-center justify-center rounded-lg border border-amber-500/20 bg-amber-500/10 text-sm font-bold text-amber-300">{medThreshold.toFixed(2)}</div></div>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2 text-xs">
          <span className="rounded border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1 text-emerald-300">Low (&lt;{medThreshold.toFixed(2)}) = Honest</span>
          <span className="rounded border border-amber-500/20 bg-amber-500/10 px-2.5 py-1 text-amber-300">Medium ({medThreshold.toFixed(2)}–{highThreshold.toFixed(2)}) = Medium</span>
          <span className="rounded border border-rose-500/20 bg-rose-500/10 px-2.5 py-1 text-rose-300">High (≥{highThreshold.toFixed(2)}) = Cheater</span>
        </div>
      </GlowCard>
      <GlowCard title="Default Model">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {MODELS.map((m) => <button key={m} onClick={() => setSelectedModel(m)} className={`rounded-lg border p-3 text-xs font-semibold transition ${selectedModel === m ? "border-indigo-400/40 bg-indigo-500/10 text-white" : "border-white/10 bg-white/[0.02] text-white/60 hover:bg-white/5"}`}>{m.replace(/_/g, " ").toUpperCase()}</button>)}
        </div>
      </GlowCard>
      <GlowCard title="Default Graph Layout">
        <div className="flex flex-wrap gap-2">
          {LAYOUTS.map((l) => <button key={l.id} onClick={() => setGraphLayout(l.id)} className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition ${graphLayout === l.id ? "border-indigo-400/40 bg-indigo-500/15 text-white" : "border-white/10 bg-white/[0.02] text-white/50 hover:bg-white/5"}`}>{l.label}</button>)}
        </div>
      </GlowCard>
    </div>
  );
}
