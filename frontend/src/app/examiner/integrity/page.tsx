"use client";

import { useEffect, useState } from "react";
import api from "@/lib/api";
import { DashboardShell, GlowButton, GlowCard } from "@/components/dashboard/DashboardShell";
import { AnnouncementBadge } from "@/components/dashboard/AnnouncementBadge";
import { GradientHeading } from "@/components/dashboard/GradientHeading";
import { StatCard } from "@/components/dashboard/StatCard";
import { ModelComparisonChart } from "@/components/integrity/ModelComparisonChart";
import { ConfusionMatrixDisplay } from "@/components/integrity/ConfusionMatrixDisplay";
import type { BenchmarkResult } from "@/types";

const Svg = ({ d }: { d: string }) => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
);

const Icon = ({ d }: { d: string }) => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
);

const MODEL_GRADIENTS: Record<string, string> = {
  vanilla_gcn: "from-blue-500/30 via-cyan-500/20 to-transparent",
  h2gcn: "from-purple-500/30 via-fuchsia-500/20 to-transparent",
  fagcn: "from-emerald-500/30 via-teal-500/20 to-transparent",
  graphsage: "from-amber-500/30 via-orange-500/20 to-transparent",
};

const MODEL_DESCRIPTIONS: Record<string, string> = {
  vanilla_gcn: "Baseline 2-layer graph convolution",
  h2gcn: "Heterophily-aware aggregation",
  fagcn: "Frequency-adaptive convolution",
  graphsage: "Inductive sampling & aggregation",
};

interface ImportedDataset {
  id: string;
  name: string;
  num_students: number;
  has_labels: boolean;
  created_at?: string;
}

interface DatasetPrediction {
  dataset_id: string;
  dataset_name?: string;
  model_used: string;
  num_students: number;
  num_flagged: number;
  num_clean: number;
  predictions: Array<{
    student_id: string;
    prediction: string;
    flagged_prob: number;
    clean_prob: number;
  }>;
}

export default function IntegrityDashboard() {
  const [benchmark, setBenchmark] = useState<BenchmarkResult | null>(null);
  const [activeModel, setActiveModel] = useState<string>("");
  const [isRunning, setIsRunning] = useState(false);
  const [venueSize, setVenueSize] = useState(80);
  const [cheatRatio, setCheatRatio] = useState(0.2);
  const [error, setError] = useState("");

  const [datasets, setDatasets] = useState<ImportedDataset[]>([]);
  const [selectedDatasetId, setSelectedDatasetId] = useState("");
  const [importing, setImporting] = useState(false);
  const [predicting, setPredicting] = useState(false);
  const [training, setTraining] = useState(false);
  const [datasetResult, setDatasetResult] = useState<DatasetPrediction | null>(null);
  const [datasetMsg, setDatasetMsg] = useState("");

  useEffect(() => {
    fetchModels();
    fetchDatasets();
  }, []);

  async function fetchDatasets() {
    try {
      const { data } = await api.get("/integrity/datasets");
      setDatasets(data.data?.datasets || []);
    } catch {
      setDatasets([]);
    }
  }

  async function handleImportCsv(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    setDatasetMsg("");
    setDatasetResult(null);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("name", file.name.replace(/\.csv$/i, ""));
      await api.post("/integrity/datasets/import", form, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      setDatasetMsg(`Imported ${file.name} successfully.`);
      await fetchDatasets();
    } catch (err: any) {
      setDatasetMsg(err.response?.data?.error?.message || "Import failed");
    } finally {
      setImporting(false);
      e.target.value = "";
    }
  }

  async function runDatasetPredict() {
    if (!selectedDatasetId) return;
    setPredicting(true);
    setDatasetMsg("");
    try {
      const { data } = await api.post(`/integrity/datasets/${selectedDatasetId}/predict`);
      setDatasetResult(data.data);
      setDatasetMsg(`Predictions complete — ${data.data.num_flagged} flagged, ${data.data.num_clean} clean.`);
    } catch (err: any) {
      setDatasetMsg(err.response?.data?.error?.message || "Prediction failed");
      setDatasetResult(null);
    } finally {
      setPredicting(false);
    }
  }

  async function runDatasetTrain() {
    if (!selectedDatasetId) return;
    setTraining(true);
    setDatasetMsg("");
    try {
      const { data } = await api.post(`/integrity/datasets/${selectedDatasetId}/train`, { epochs: 100 });
      setDatasetMsg(data.data?.message || "Training complete.");
    } catch (err: any) {
      setDatasetMsg(err.response?.data?.error?.message || "Training failed");
    } finally {
      setTraining(false);
    }
  }

  async function fetchModels() {
    try {
      const { data } = await api.get("/integrity/models");
      setActiveModel(data.data.active);
    } catch {}
  }

  async function runBenchmark() {
    setIsRunning(true);
    setError("");
    try {
      const { data } = await api.get("/integrity/evaluate/all", {
        params: { num_students: venueSize, cheat_ratio: cheatRatio },
      });
      setBenchmark(data.data);
      await fetchModels();
    } catch (err: any) {
      setError(err.response?.data?.error?.message || "Benchmark failed");
    } finally {
      setIsRunning(false);
    }
  }

  async function switchModel(model: string) {
    try {
      await api.post("/integrity/models/switch", { model });
      setActiveModel(model);
    } catch {}
  }

  const bestModel = benchmark?.results.reduce<typeof benchmark.results[0] | null>(
    (best, r) => (best === null || r.f1_macro > best.f1_macro ? r : best),
    null,
  );

  return (
    <DashboardShell>
      <header className="mb-10 space-y-5">
        <AnnouncementBadge
          tag={activeModel ? "Active" : "Info"}
          message={
            activeModel
              ? `Production model: ${activeModel.replace(/_/g, " ").toUpperCase()}`
              : "No active model selected yet"
          }
          tone={activeModel ? "success" : "default"}
        />

        <GradientHeading
          highlight="AI Integrity"
          highlightAtEnd
          title="Command Center."
          subtitle="Compare four GNN architectures on the same synthetic graph. Switch the production model with one click — instant impact across every live exam."
        />
      </header>

      <GlowCard
        className="mb-8"
        title="Import Dataset & Predict"
        description="Upload a CSV with student behavior features — run GNN predictions on that exact dataset"
      >
        <p className="mb-4 text-xs text-white/45">
          Required column: <code className="text-indigo-300">student_id</code>. Optional:{" "}
          <code className="text-white/60">tab_switch_count</code>, <code className="text-white/60">paste_event_count</code>,{" "}
          <code className="text-white/60">seat_x</code>, <code className="text-white/60">seat_y</code>,{" "}
          <code className="text-white/60">label</code> (0/1 for training).
        </p>
        <div className="flex flex-wrap items-end gap-4">
          <label className="inline-flex h-11 cursor-pointer items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-4 text-sm font-medium text-white/80 transition hover:bg-white/10">
            <Svg d="M12 10v6m0 0l-3-3m3 3l3-3M3 17V7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
            {importing ? "Importing…" : "Upload CSV"}
            <input type="file" accept=".csv" className="hidden" onChange={handleImportCsv} disabled={importing} />
          </label>
          <div className="min-w-[220px] flex-1 space-y-1.5">
            <label className="text-[10px] font-semibold uppercase tracking-wider text-white/50">Imported dataset</label>
            <select
              className="auth-input flex h-11 w-full rounded-lg px-3 text-sm"
              value={selectedDatasetId}
              onChange={(e) => { setSelectedDatasetId(e.target.value); setDatasetResult(null); }}
            >
              <option value="" className="bg-slate-900">Select dataset…</option>
              {datasets.map((d) => (
                <option key={d.id} value={d.id} className="bg-slate-900">
                  {d.name} ({d.num_students} students{d.has_labels ? ", labeled" : ""})
                </option>
              ))}
            </select>
          </div>
          <GlowButton onClick={runDatasetPredict} disabled={!selectedDatasetId || predicting} variant="gradient">
            {predicting ? "Predicting…" : "Run Predictions"}
          </GlowButton>
          {datasets.find((d) => d.id === selectedDatasetId)?.has_labels && (
            <GlowButton onClick={runDatasetTrain} disabled={!selectedDatasetId || training} variant="ghost">
              {training ? "Training…" : "Train on Dataset"}
            </GlowButton>
          )}
        </div>
        {datasetMsg && (
          <div className="mt-4 rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2 text-xs text-white/70">{datasetMsg}</div>
        )}
        {datasetResult && (
          <div className="mt-4 max-h-64 overflow-y-auto rounded-lg border border-white/10">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-slate-950/90">
                <tr>
                  {["Student", "Prediction", "Flagged %", "Clean %"].map((h) => (
                    <th key={h} className="border-b border-white/10 p-2 text-left font-semibold uppercase tracking-wider text-white/40">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {datasetResult.predictions.map((p) => (
                  <tr key={p.student_id} className="border-b border-white/5">
                    <td className="p-2 text-white/80">{p.student_id}</td>
                    <td className={`p-2 font-semibold ${p.prediction === "flagged" ? "text-rose-400" : "text-emerald-400"}`}>{p.prediction}</td>
                    <td className="p-2 text-white/50">{(p.flagged_prob * 100).toFixed(1)}%</td>
                    <td className="p-2 text-white/50">{(p.clean_prob * 100).toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </GlowCard>

      <GlowCard
        className="mb-8"
        title="Benchmark Configuration"
        description="Configure mock venue parameters and run a benchmark across all 4 GNN models"
      >
        <div className="flex flex-wrap items-end gap-5">
          <div className="space-y-2">
            <label className="text-xs font-medium uppercase tracking-wider text-white/50">Venue Size</label>
            <input
              type="number"
              className="auth-input h-11 w-32 rounded-lg px-3 text-sm font-medium"
              value={venueSize}
              onChange={(e) => setVenueSize(parseInt(e.target.value) || 80)}
              min={10}
              max={500}
            />
            <p className="text-[10px] text-white/40">10 — 500 students</p>
          </div>
          <div className="space-y-2">
            <label className="text-xs font-medium uppercase tracking-wider text-white/50">Cheat Ratio</label>
            <input
              type="number"
              className="auth-input h-11 w-32 rounded-lg px-3 text-sm font-medium"
              value={cheatRatio}
              onChange={(e) => setCheatRatio(parseFloat(e.target.value) || 0.2)}
              min={0.05}
              max={0.5}
              step={0.05}
            />
            <p className="text-[10px] text-white/40">0.05 — 0.50</p>
          </div>
          <GlowButton onClick={runBenchmark} disabled={isRunning} variant="gradient" size="lg">
            {isRunning ? (
              <span className="flex items-center gap-2">
                <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25" />
                  <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                </svg>
                Running…
              </span>
            ) : (
              <>
                Run Benchmark
                <span className="rounded-md bg-slate-900/10 px-1.5 py-0.5 text-[10px] font-bold">×4</span>
              </>
            )}
          </GlowButton>
        </div>

        {error && (
          <div className="mt-4 rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-200">
            {error}
          </div>
        )}
      </GlowCard>

      {!benchmark && (
        <GlowCard className="text-center">
          <div className="py-12">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500/20 to-purple-500/20 ring-1 ring-white/10">
              <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-indigo-300">
                <circle cx="12" cy="12" r="3" />
                <circle cx="4" cy="6" r="2" />
                <circle cx="20" cy="6" r="2" />
                <circle cx="4" cy="18" r="2" />
                <circle cx="20" cy="18" r="2" />
                <path d="M6 7l4 4M18 7l-4 4M6 17l4-4M18 17l-4-4" />
              </svg>
            </div>
            <p className="text-lg font-medium text-white">Ready to benchmark</p>
            <p className="mt-2 text-sm text-white/50">
              Configure parameters above and run a benchmark to compare all 4 GNN models
            </p>
            <div className="mt-4 flex justify-center gap-2">
              {["Vanilla GCN", "H2GCN", "FAGCN", "GraphSAGE"].map((m) => (
                <span key={m} className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] font-medium text-white/60">
                  {m}
                </span>
              ))}
            </div>
          </div>
        </GlowCard>
      )}

      {benchmark && (
        <>
          <section className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              label="Students"
              value={benchmark.dataset_info.num_nodes}
              accent="indigo"
              icon={<Icon d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zM23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" />}
            />
            <StatCard
              label="Edges"
              value={benchmark.dataset_info.num_edges}
              accent="blue"
              icon={<Icon d="M3 12h18M3 6h18M3 18h18" />}
            />
            <StatCard
              label="Clean"
              value={benchmark.dataset_info.num_clean}
              accent="emerald"
              icon={<Icon d="M9 12l2 2 4-4M12 2a10 10 0 100 20 10 10 0 000-20z" />}
            />
            <StatCard
              label="Cheaters"
              value={benchmark.dataset_info.num_cheaters}
              accent="rose"
              icon={<Icon d="M12 9v4M12 17.01V17M4.93 19.07A10 10 0 1 1 19.07 4.93 10 10 0 0 1 4.93 19.07z" />}
            />
          </section>

          {bestModel && (
            <GlowCard
              className="mb-8"
              title={
                <span className="flex items-center gap-3">
                  Best Performer
                  <span className="rounded-full bg-gradient-to-r from-amber-400 to-orange-500 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-950">
                    Recommended
                  </span>
                </span>
              }
              description={`${bestModel.model.replace(/_/g, " ").toUpperCase()} achieved the highest F1 score on the synthetic benchmark`}
              action={
                <GlowButton
                  variant={activeModel === bestModel.model ? "outline" : "gradient"}
                  onClick={() => switchModel(bestModel.model)}
                  disabled={activeModel === bestModel.model}
                >
                  {activeModel === bestModel.model ? "Currently Active" : "Use This Model"}
                </GlowButton>
              }
            >
              <div className="grid grid-cols-3 gap-4">
                {[
                  { label: "F1 Score", val: bestModel.f1_macro, color: "text-purple-300" },
                  { label: "Precision", val: bestModel.precision_macro, color: "text-blue-300" },
                  { label: "Recall", val: bestModel.recall_macro, color: "text-emerald-300" },
                ].map((m) => (
                  <div key={m.label} className="rounded-lg border border-white/10 bg-white/[0.02] p-4 text-center">
                    <p className={`text-3xl font-bold ${m.color}`}>{(m.val * 100).toFixed(1)}%</p>
                    <p className="mt-1 text-xs font-medium uppercase tracking-wider text-white/40">{m.label}</p>
                  </div>
                ))}
              </div>
            </GlowCard>
          )}

          <div className="mb-8">
            <ModelComparisonChart results={benchmark.results} />
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            {benchmark.results.map((r) => {
              const isActive = activeModel === r.model;
              return (
                <GlowCard key={r.model} className="relative overflow-hidden">
                  <div className={`pointer-events-none absolute -right-12 -top-12 h-40 w-40 rounded-full bg-gradient-to-br opacity-60 blur-3xl ${MODEL_GRADIENTS[r.model] || MODEL_GRADIENTS.vanilla_gcn}`} />

                  <div className="relative mb-5 flex items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="text-lg font-bold text-white">{r.model.replace(/_/g, " ").toUpperCase()}</h3>
                        {isActive && (
                          <span className="flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-300">
                            <span className="live-dot h-1.5 w-1.5 rounded-full bg-emerald-400 text-emerald-400" />
                            Active
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 text-xs text-white/40">
                        {MODEL_DESCRIPTIONS[r.model] || ""} · Train acc {(r.train_acc * 100).toFixed(1)}%
                      </p>
                    </div>
                    <GlowButton
                      size="sm"
                      variant={isActive ? "outline" : "ghost"}
                      onClick={() => switchModel(r.model)}
                      disabled={isActive}
                    >
                      {isActive ? "Selected" : "Use"}
                    </GlowButton>
                  </div>

                  <div className="relative mb-5 grid grid-cols-3 gap-2">
                    {[
                      { label: "Precision", val: r.precision_macro, color: "from-blue-500/15 to-blue-500/5", text: "text-blue-300" },
                      { label: "Recall", val: r.recall_macro, color: "from-emerald-500/15 to-emerald-500/5", text: "text-emerald-300" },
                      { label: "F1", val: r.f1_macro, color: "from-purple-500/15 to-purple-500/5", text: "text-purple-300" },
                    ].map((m) => (
                      <div key={m.label} className={`rounded-lg border border-white/5 bg-gradient-to-b p-3 text-center ${m.color}`}>
                        <p className={`text-2xl font-bold ${m.text}`}>{(m.val * 100).toFixed(1)}%</p>
                        <p className="text-[10px] font-medium uppercase tracking-wider text-white/40">{m.label}</p>
                      </div>
                    ))}
                  </div>

                  <div className="relative">
                    <ConfusionMatrixDisplay matrix={r.confusion_matrix} modelName={r.model} />
                  </div>
                </GlowCard>
              );
            })}
          </div>
        </>
      )}
    </DashboardShell>
  );
}
