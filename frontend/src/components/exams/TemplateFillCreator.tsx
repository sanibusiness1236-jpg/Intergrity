"use client";

/**
 * TemplateFillCreator — examiner editor for the TEMPLATE_FILL question type.
 *
 * Supports five sub-types:
 *   text     — a passage with BLANK_1, BLANK_2 … placeholders
 *   math     — a LaTeX expression with BLANK_1 … placeholders (shown as □₁)
 *   matrix   — an m×n grid where some cells are BLANK_N
 *   table    — a table (with headers) where some cells are BLANK_N
 *   diagram  — an image with absolutely-positioned blank fields
 *
 * Storage contract (JSON stored in the `text` field of the Question model):
 * {
 *   __tf: true,
 *   stem: string,           // optional question description shown above template
 *   templateType: TemplateType,
 *   content?: string,       // for text / math
 *   matrix?: { rows, cols, cells: string[][] },
 *   tableData?: { headers: string[], rows: string[][] },
 *   diagram?: { imageUrl: string, blanks: Record<blankId, DiagramBlankPos> },
 *   blankOrder: string[],   // ordered list of blank IDs (BLANK_1, BLANK_2…)
 * }
 *
 * correctAnswer shape:
 * { BLANK_1: { answers: string[], caseSensitive: boolean }, ... }
 */

import { useEffect, useRef, useState } from "react";
import api from "@/lib/api";

// ─── Types ───────────────────────────────────────────────────────────────────

export type TemplateType = "text" | "math" | "matrix" | "table" | "diagram";

export interface DiagramBlankPos {
  x: number;   // percentage (0-100) from left
  y: number;   // percentage (0-100) from top
  width: number; // percentage width
  label?: string;
}

export interface TemplateConfig {
  __tf: true;
  stem: string;
  templateType: TemplateType;
  content?: string;
  matrix?: { rows: number; cols: number; cells: string[][] };
  tableData?: { headers: string[]; rows: string[][] };
  diagram?: { imageUrl: string; blanks: Record<string, DiagramBlankPos> };
  blankOrder: string[];
}

export interface BlankSpec {
  answers: string[];
  caseSensitive: boolean;
}

export interface TemplateFillValue {
  config: TemplateConfig;
  answerKey: Record<string, BlankSpec>; // { BLANK_1: { answers, caseSensitive } }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const Svg = ({ d, size = 14 }: { d: string; size?: number }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
);

function extractBlanks(text: string): string[] {
  const matches = [...text.matchAll(/BLANK_(\d+)/g)];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of matches) {
    const id = `BLANK_${m[1]}`;
    if (!seen.has(id)) { seen.add(id); out.push(id); }
  }
  return out;
}

function blanksFromMatrix(cells: string[][]): string[] {
  return extractBlanks(cells.flat().join(" "));
}

function blanksFromTable(data: { headers: string[]; rows: string[][] }): string[] {
  return extractBlanks([...data.headers, ...data.rows.flat()].join(" "));
}

function blanksFromDiagram(blanks: Record<string, DiagramBlankPos>): string[] {
  return Object.keys(blanks);
}

export function makeDefaultConfig(type: TemplateType): TemplateConfig {
  switch (type) {
    case "text":
      return { __tf: true, stem: "", templateType: "text", content: "The capital of BLANK_1 is BLANK_2.", blankOrder: ["BLANK_1", "BLANK_2"] };
    case "math":
      return { __tf: true, stem: "", templateType: "math", content: "\\frac{BLANK_1}{BLANK_2} = BLANK_3", blankOrder: ["BLANK_1", "BLANK_2", "BLANK_3"] };
    case "matrix":
      return { __tf: true, stem: "", templateType: "matrix", matrix: { rows: 2, cols: 3, cells: [["1", "BLANK_1", "3"], ["BLANK_2", "5", "6"]] }, blankOrder: ["BLANK_1", "BLANK_2"] };
    case "table":
      return { __tf: true, stem: "", templateType: "table", tableData: { headers: ["Name", "Score", "Grade"], rows: [["Alice", "BLANK_1", "A"], ["Bob", "85", "BLANK_2"]] }, blankOrder: ["BLANK_1", "BLANK_2"] };
    case "diagram":
      return { __tf: true, stem: "", templateType: "diagram", diagram: { imageUrl: "", blanks: {} }, blankOrder: [] };
  }
}

function makeEmptySpec(): BlankSpec {
  return { answers: [""], caseSensitive: false };
}

export function syncAnswerKey(
  blankOrder: string[],
  existing: Record<string, BlankSpec>
): Record<string, BlankSpec> {
  const result: Record<string, BlankSpec> = {};
  for (const id of blankOrder) {
    result[id] = existing[id] ?? makeEmptySpec();
  }
  return result;
}

// ─── Sub-editor: blank answer panel ──────────────────────────────────────────

function BlankAnswerPanel({
  blankOrder,
  answerKey,
  onChange,
}: {
  blankOrder: string[];
  answerKey: Record<string, BlankSpec>;
  onChange: (key: Record<string, BlankSpec>) => void;
}) {
  if (blankOrder.length === 0) {
    return <p className="text-xs text-white/30">No blanks detected yet.</p>;
  }

  return (
    <div className="space-y-3">
      {blankOrder.map((blankId, bIdx) => {
        const spec = answerKey[blankId] ?? makeEmptySpec();
        const num = bIdx + 1;

        function update(patch: Partial<BlankSpec>) {
          onChange({ ...answerKey, [blankId]: { ...spec, ...patch } });
        }

        return (
          <div key={blankId} className="rounded-xl border border-white/10 bg-white/[0.02] p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2 text-xs font-bold text-purple-200">
                <span className="flex h-6 w-6 items-center justify-center rounded-md bg-purple-500/20 text-[11px]">{num}</span>
                {blankId}
              </span>
              {/* Case-sensitive toggle */}
              <label className="flex cursor-pointer items-center gap-2 text-[10px] text-white/40">
                Case sensitive
                <button
                  type="button"
                  onClick={() => update({ caseSensitive: !spec.caseSensitive })}
                  className={`relative h-5 w-9 shrink-0 rounded-full border transition-colors ${spec.caseSensitive ? "border-indigo-400/50 bg-indigo-500/30" : "border-white/15 bg-white/10"}`}
                >
                  <span className={`absolute top-0.5 h-4 w-4 rounded-full shadow transition-transform ${spec.caseSensitive ? "translate-x-4 bg-indigo-400" : "translate-x-0.5 bg-white/40"}`} />
                </button>
              </label>
            </div>

            {spec.answers.map((ans, aIdx) => (
              <div key={aIdx} className="flex items-center gap-2">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-white/5 text-[10px] text-white/40">{aIdx + 1}</span>
                <input
                  className="auth-input h-9 flex-1 rounded-lg px-3 text-xs"
                  placeholder={aIdx === 0 ? "Expected answer…" : `Alternative ${aIdx + 1}…`}
                  value={ans}
                  onChange={(e) => {
                    const next = [...spec.answers];
                    next[aIdx] = e.target.value;
                    update({ answers: next });
                  }}
                />
                {spec.answers.length > 1 && (
                  <button
                    type="button"
                    onClick={() => update({ answers: spec.answers.filter((_, i) => i !== aIdx) })}
                    className="rounded p-1 text-white/30 hover:text-rose-300"
                  ><Svg d="M18 6L6 18M6 6l12 12" /></button>
                )}
              </div>
            ))}
            <button
              type="button"
              onClick={() => update({ answers: [...spec.answers, ""] })}
              className="text-[10px] text-white/40 hover:text-white"
            >+ Add alternative answer</button>
          </div>
        );
      })}
    </div>
  );
}

// ─── Sub-editors for each template type ──────────────────────────────────────

function TextTemplateEditor({ config, onChange }: { config: TemplateConfig; onChange: (c: TemplateConfig) => void }) {
  const blanks = extractBlanks(config.content || "");
  useEffect(() => {
    onChange({ ...config, blankOrder: blanks });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.content]);

  return (
    <div className="space-y-2">
      <label className="text-[10px] font-semibold uppercase tracking-wider text-white/50">
        Template Text
        <span className="ml-2 normal-case text-white/35">— use BLANK_1, BLANK_2, … for blanks</span>
      </label>
      <textarea
        className="auth-input min-h-[100px] w-full rounded-lg px-3 py-2 text-sm font-mono"
        value={config.content || ""}
        onChange={(e) => onChange({ ...config, content: e.target.value })}
        placeholder='e.g. "The speed of light is BLANK_1 m/s, discovered by BLANK_2."'
      />
      {blanks.length > 0 && (
        <p className="text-[10px] text-indigo-300">{blanks.length} blank{blanks.length !== 1 ? "s" : ""} detected: {blanks.join(", ")}</p>
      )}
    </div>
  );
}

function MathTemplateEditor({ config, onChange }: { config: TemplateConfig; onChange: (c: TemplateConfig) => void }) {
  const [preview, setPreview] = useState("");
  const [previewErr, setPreviewErr] = useState("");

  const blanks = extractBlanks(config.content || "");

  useEffect(() => {
    onChange({ ...config, blankOrder: blanks });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.content]);

  useEffect(() => {
    (async () => {
      if (!config.content) return;
      try {
        const katex = (await import("katex")).default;
        let display = config.content;
        blanks.forEach((id, idx) => {
          display = display.replaceAll(id, `\\boxed{${idx + 1}}`);
        });
        const html = katex.renderToString(display, { throwOnError: false, displayMode: true });
        setPreview(html);
        setPreviewErr("");
      } catch (e) {
        setPreviewErr(String(e));
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.content]);

  return (
    <div className="space-y-2">
      <label className="text-[10px] font-semibold uppercase tracking-wider text-white/50">
        LaTeX Expression
        <span className="ml-2 normal-case text-white/35">— use BLANK_1, BLANK_2, … for blanks (shown as ☐₁ ☐₂)</span>
      </label>
      <textarea
        className="auth-input min-h-[80px] w-full rounded-lg px-3 py-2 font-mono text-sm"
        value={config.content || ""}
        onChange={(e) => onChange({ ...config, content: e.target.value })}
        placeholder="e.g. \frac{BLANK_1}{BLANK_2} = BLANK_3"
      />
      {previewErr ? (
        <p className="text-xs text-rose-300">{previewErr}</p>
      ) : preview ? (
        <div className="min-w-0 w-full rounded-lg border border-dashed border-white/10 bg-white/[0.03] p-3 text-white"
          dangerouslySetInnerHTML={{ __html: preview }} />
      ) : null}
      {blanks.length > 0 && (
        <p className="text-[10px] text-indigo-300">{blanks.length} blank{blanks.length !== 1 ? "s" : ""}: {blanks.join(", ")}</p>
      )}
    </div>
  );
}

function MatrixTemplateEditor({ config, onChange }: { config: TemplateConfig; onChange: (c: TemplateConfig) => void }) {
  const m = config.matrix ?? { rows: 2, cols: 2, cells: [["", ""], ["", ""]] };

  function resize(rows: number, cols: number) {
    const cells: string[][] = [];
    for (let r = 0; r < rows; r++) {
      cells.push([]);
      for (let c = 0; c < cols; c++) {
        cells[r][c] = m.cells[r]?.[c] ?? "";
      }
    }
    const blanks = blanksFromMatrix(cells);
    onChange({ ...config, matrix: { rows, cols, cells }, blankOrder: blanks });
  }

  function updateCell(r: number, c: number, val: string) {
    const cells = m.cells.map((row) => [...row]);
    cells[r][c] = val;
    const blanks = blanksFromMatrix(cells);
    onChange({ ...config, matrix: { ...m, cells }, blankOrder: blanks });
  }

  const blanks = blanksFromMatrix(m.cells);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 text-xs">
        <label className="text-[10px] font-semibold uppercase tracking-wider text-white/50">Rows</label>
        <input type="number" min={1} max={8} value={m.rows} onChange={(e) => resize(Math.max(1, Math.min(8, +e.target.value)), m.cols)}
          className="auth-input h-8 w-16 rounded-lg px-2 text-xs" />
        <label className="text-[10px] font-semibold uppercase tracking-wider text-white/50">Cols</label>
        <input type="number" min={1} max={8} value={m.cols} onChange={(e) => resize(m.rows, Math.max(1, Math.min(8, +e.target.value)))}
          className="auth-input h-8 w-16 rounded-lg px-2 text-xs" />
        <span className="text-[10px] text-white/30">Type BLANK_1, BLANK_2… in cells to create blanks</span>
      </div>
      <div className="overflow-x-auto">
        <table className="border-collapse text-sm">
          <tbody>
            {m.cells.map((row, r) => (
              <tr key={r}>
                {row.map((cell, c) => (
                  <td key={c} className="border border-white/10 p-0">
                    <input
                      value={cell}
                      onChange={(e) => updateCell(r, c, e.target.value)}
                      className={`h-10 w-28 bg-transparent px-2 text-center text-xs focus:outline-none focus:ring-1 focus:ring-indigo-400 ${
                        cell.startsWith("BLANK_") ? "text-purple-300 font-mono font-semibold" : "text-white"
                      }`}
                      placeholder="…"
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {blanks.length > 0 && (
        <p className="text-[10px] text-indigo-300">{blanks.length} blank{blanks.length !== 1 ? "s" : ""}: {blanks.join(", ")}</p>
      )}
    </div>
  );
}

function TableTemplateEditor({ config, onChange }: { config: TemplateConfig; onChange: (c: TemplateConfig) => void }) {
  const td = config.tableData ?? { headers: ["Column 1", "Column 2"], rows: [["BLANK_1", "value"]] };

  function updateHeader(i: number, val: string) {
    const headers = [...td.headers];
    headers[i] = val;
    const blanks = blanksFromTable({ ...td, headers });
    onChange({ ...config, tableData: { ...td, headers }, blankOrder: blanks });
  }

  function updateCell(r: number, c: number, val: string) {
    const rows = td.rows.map((row) => [...row]);
    rows[r][c] = val;
    const blanks = blanksFromTable({ ...td, rows });
    onChange({ ...config, tableData: { ...td, rows }, blankOrder: blanks });
  }

  function addRow() {
    const rows = [...td.rows, new Array(td.headers.length).fill("")];
    const blanks = blanksFromTable({ ...td, rows });
    onChange({ ...config, tableData: { ...td, rows }, blankOrder: blanks });
  }

  function addCol() {
    const headers = [...td.headers, `Column ${td.headers.length + 1}`];
    const rows = td.rows.map((r) => [...r, ""]);
    const blanks = blanksFromTable({ headers, rows });
    onChange({ ...config, tableData: { headers, rows }, blankOrder: blanks });
  }

  function removeRow(r: number) {
    const rows = td.rows.filter((_, i) => i !== r);
    const blanks = blanksFromTable({ ...td, rows });
    onChange({ ...config, tableData: { ...td, rows }, blankOrder: blanks });
  }

  const blanks = blanksFromTable(td);

  return (
    <div className="space-y-3">
      <p className="text-[10px] text-white/30">Type BLANK_1, BLANK_2… in any cell to mark it as a student-input blank</p>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr>
              {td.headers.map((h, i) => (
                <th key={i} className="border border-white/10 bg-white/[0.03] p-0">
                  <input value={h} onChange={(e) => updateHeader(i, e.target.value)}
                    className="h-9 w-full bg-transparent px-2 text-center font-bold text-indigo-200 focus:outline-none focus:ring-1 focus:ring-indigo-400"
                    placeholder={`Header ${i + 1}`} />
                </th>
              ))}
              <th className="border border-white/10 w-8 bg-white/[0.02]" />
            </tr>
          </thead>
          <tbody>
            {td.rows.map((row, r) => (
              <tr key={r}>
                {row.map((cell, c) => (
                  <td key={c} className="border border-white/10 p-0">
                    <input value={cell} onChange={(e) => updateCell(r, c, e.target.value)}
                      className={`h-9 w-full bg-transparent px-2 text-center focus:outline-none focus:ring-1 focus:ring-indigo-400 ${
                        cell.startsWith("BLANK_") ? "font-mono font-semibold text-purple-300" : "text-white"
                      }`}
                      placeholder="…" />
                  </td>
                ))}
                <td className="border border-white/10 p-0 text-center">
                  <button type="button" onClick={() => removeRow(r)} className="px-2 py-1 text-white/25 hover:text-rose-300">×</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex gap-2">
        <button type="button" onClick={addRow} className="text-[10px] text-white/40 hover:text-white">+ Row</button>
        <button type="button" onClick={addCol} className="text-[10px] text-white/40 hover:text-white">+ Column</button>
      </div>
      {blanks.length > 0 && (
        <p className="text-[10px] text-indigo-300">{blanks.length} blank{blanks.length !== 1 ? "s" : ""}: {blanks.join(", ")}</p>
      )}
    </div>
  );
}

function DiagramTemplateEditor({ config, onChange }: { config: TemplateConfig; onChange: (c: TemplateConfig) => void }) {
  const [uploading, setUploading] = useState(false);
  const [uploadErr, setUploadErr] = useState("");
  const [addingBlank, setAddingBlank] = useState(false);
  const [nextBlankNum, setNextBlankNum] = useState(1);
  const imgRef = useRef<HTMLImageElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const diagram = config.diagram ?? { imageUrl: "", blanks: {} };

  async function handleFile(file: File) {
    setUploadErr("");
    if (!["image/jpeg", "image/png"].includes(file.type)) { setUploadErr("Only JPG/PNG"); return; }
    if (file.size > 5 * 1024 * 1024) { setUploadErr("Max 5 MB"); return; }
    try {
      setUploading(true);
      const { default: compress } = await import("browser-image-compression");
      const compressed = await compress(file, { maxSizeMB: 4.5, maxWidthOrHeight: 2048, useWebWorker: true });
      const form = new FormData();
      form.append("file", compressed, file.name);
      const { data } = await api.post("/questions/upload-media", form, { headers: { "Content-Type": "multipart/form-data" } });
      onChange({ ...config, diagram: { ...diagram, imageUrl: data.url } });
    } catch { setUploadErr("Upload failed"); }
    finally { setUploading(false); }
  }

  function handleImageClick(e: React.MouseEvent<HTMLImageElement>) {
    if (!addingBlank) return;
    const rect = imgRef.current!.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    const blankId = `BLANK_${nextBlankNum}`;
    const newBlanks = { ...diagram.blanks, [blankId]: { x, y, width: 15, label: blankId } };
    const blankOrder = Object.keys(newBlanks);
    onChange({ ...config, diagram: { ...diagram, blanks: newBlanks }, blankOrder });
    setNextBlankNum((n) => n + 1);
    setAddingBlank(false);
  }

  function removeBlank(id: string) {
    const { [id]: _, ...rest } = diagram.blanks;
    onChange({ ...config, diagram: { ...diagram, blanks: rest }, blankOrder: Object.keys(rest) });
  }

  return (
    <div className="space-y-3">
      {!diagram.imageUrl ? (
        <div
          className="cursor-pointer rounded-lg border-2 border-dashed border-white/15 bg-white/[0.02] p-8 text-center transition hover:border-indigo-400/60"
          onClick={() => inputRef.current?.click()}
        >
          {uploading ? <span className="text-sm text-white/60">Uploading…</span> : (
            <>
              <p className="text-sm text-white/70">Click to upload diagram / flowchart image</p>
              <p className="text-xs text-white/40">JPG/PNG · max 5 MB</p>
            </>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setAddingBlank((v) => !v)}
              className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${addingBlank ? "border-purple-400/50 bg-purple-500/20 text-purple-200" : "border-white/10 bg-white/5 text-white/60 hover:bg-white/10"}`}
            >
              {addingBlank ? "🎯 Click image to place blank" : "+ Add Blank"}
            </button>
            <button
              type="button"
              onClick={() => { onChange({ ...config, diagram: { ...diagram, imageUrl: "" } }); setNextBlankNum(1); }}
              className="text-xs text-white/40 hover:text-rose-300"
            >Change image</button>
          </div>

          {/* Image with overlaid blank indicators */}
          <div className="relative inline-block max-w-full">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              ref={imgRef}
              src={diagram.imageUrl}
              alt="diagram"
              loading="lazy"
              className={`max-h-80 w-full rounded-lg border border-white/10 object-contain ${addingBlank ? "cursor-crosshair" : ""}`}
              onClick={handleImageClick}
            />
            {Object.entries(diagram.blanks).map(([id, pos]) => (
              <div
                key={id}
                style={{ position: "absolute", left: `${pos.x}%`, top: `${pos.y}%`, transform: "translate(-50%, -50%)", width: `${pos.width}%`, minWidth: 48 }}
                className="group flex items-center justify-between rounded border border-purple-400/60 bg-slate-950/80 px-1.5 py-0.5 text-[10px] text-purple-200"
              >
                <span className="font-mono font-bold truncate">{id}</span>
                <button type="button" onClick={() => removeBlank(id)} className="ml-1 shrink-0 text-white/30 hover:text-rose-300">×</button>
              </div>
            ))}
          </div>
          {Object.keys(diagram.blanks).length > 0 && (
            <p className="text-[10px] text-indigo-300">{Object.keys(diagram.blanks).length} blank{Object.keys(diagram.blanks).length !== 1 ? "s" : ""} placed</p>
          )}
        </div>
      )}
      {uploadErr && <p className="text-xs text-rose-300">{uploadErr}</p>}
      <input ref={inputRef} type="file" accept="image/jpeg,image/png" className="hidden"
        onChange={(e) => { if (e.target.files?.[0]) handleFile(e.target.files[0]); }} />
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

const TEMPLATE_TYPES: { value: TemplateType; label: string; icon: string; desc: string }[] = [
  { value: "text",    label: "Text Passage",  icon: "M4 6h16M4 10h16M4 14h8",                                          desc: "Paragraph with fill-in blanks" },
  { value: "math",    label: "Math / LaTeX",  icon: "M7 8h10M7 12h4m0 4h6m-3-12v16",                                   desc: "LaTeX equation with blank fields" },
  { value: "matrix",  label: "Matrix",        icon: "M3 10h18M3 14h18M3 6h18M7 3v18M17 3v18",                          desc: "Grid with some cells as blanks" },
  { value: "table",   label: "Table",         icon: "M3 10h18M3 14h18M3 6h18M3 18h18M7 3v18M17 3v18",                 desc: "Data table with blank cells" },
  { value: "diagram", label: "Diagram / Flowchart", icon: "M4 5a2 2 0 012-2h12a2 2 0 012 2v14a2 2 0 01-2 2H6a2 2 0 01-2-2V5zm12 4a2 2 0 11-4 0 2 2 0 014 0zm-1 7l-3-3-2 2-3-3-3 4h14l-3-2z", desc: "Image with positioned blank labels" },
];

export interface TemplateFillCreatorProps {
  value: TemplateFillValue | null;
  onChange: (v: TemplateFillValue) => void;
}

export function TemplateFillCreator({ value, onChange }: TemplateFillCreatorProps) {
  const [cfg, setCfg] = useState<TemplateConfig>(() =>
    value?.config ?? makeDefaultConfig("text")
  );
  const [answerKey, setAnswerKey] = useState<Record<string, BlankSpec>>(() =>
    value?.answerKey ?? syncAnswerKey(value?.config?.blankOrder ?? ["BLANK_1", "BLANK_2"], {})
  );

  // Fire initial value on mount so the parent form is never left with null templateFill
  useEffect(() => {
    if (!value) {
      const defaultCfg = makeDefaultConfig("text");
      const defaultKey = syncAnswerKey(defaultCfg.blankOrder, {});
      onChange({ config: defaultCfg, answerKey: defaultKey });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function setConfig(next: TemplateConfig) {
    const synced = syncAnswerKey(next.blankOrder, answerKey);
    setCfg(next);
    setAnswerKey(synced);
    onChange({ config: next, answerKey: synced });
  }

  function setKey(next: Record<string, BlankSpec>) {
    setAnswerKey(next);
    onChange({ config: cfg, answerKey: next });
  }

  function switchType(type: TemplateType) {
    const next = makeDefaultConfig(type);
    const synced = syncAnswerKey(next.blankOrder, {});
    setCfg(next);
    setAnswerKey(synced);
    onChange({ config: next, answerKey: synced });
  }

  return (
    <div className="space-y-4">
      {/* Sub-type selector */}
      <div className="space-y-1.5">
        <label className="text-[10px] font-semibold uppercase tracking-wider text-white/50">Template Style</label>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          {TEMPLATE_TYPES.map((t) => (
            <button
              key={t.value}
              type="button"
              onClick={() => switchType(t.value)}
              className={`flex flex-col items-start gap-1 rounded-xl border p-3 text-left transition ${
                cfg.templateType === t.value
                  ? "border-purple-400/50 bg-purple-500/15 text-purple-200"
                  : "border-white/10 bg-white/[0.02] text-white/50 hover:bg-white/5 hover:text-white"
              }`}
            >
              <svg viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d={t.icon} />
              </svg>
              <span className="text-xs font-semibold">{t.label}</span>
              <span className="text-[10px] leading-tight opacity-70">{t.desc}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Optional question stem */}
      <div className="space-y-1.5">
        <label className="text-[10px] font-semibold uppercase tracking-wider text-white/50">Question Description <span className="normal-case font-normal text-white/30">(optional — shown above the template)</span></label>
        <input
          className="auth-input h-10 w-full rounded-lg px-3 text-sm"
          placeholder="e.g. Fill in the blanks to complete the equation…"
          value={cfg.stem}
          onChange={(e) => setConfig({ ...cfg, stem: e.target.value })}
        />
      </div>

      {/* Template-type-specific editor */}
      <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
        {cfg.templateType === "text"    && <TextTemplateEditor   config={cfg} onChange={setConfig} />}
        {cfg.templateType === "math"    && <MathTemplateEditor   config={cfg} onChange={setConfig} />}
        {cfg.templateType === "matrix"  && <MatrixTemplateEditor config={cfg} onChange={setConfig} />}
        {cfg.templateType === "table"   && <TableTemplateEditor  config={cfg} onChange={setConfig} />}
        {cfg.templateType === "diagram" && <DiagramTemplateEditor config={cfg} onChange={setConfig} />}
      </div>

      {/* Answer key panel */}
      {cfg.blankOrder.length > 0 && (
        <div className="space-y-2">
          <label className="text-[10px] font-semibold uppercase tracking-wider text-white/50">Answer Key <span className="normal-case font-normal text-white/30">— set correct answers for each blank</span></label>
          <BlankAnswerPanel blankOrder={cfg.blankOrder} answerKey={answerKey} onChange={setKey} />
        </div>
      )}
    </div>
  );
}

/** Serialize a TemplateFillValue into the Question `text` field (JSON string) */
export function serializeTemplateFill(v: TemplateFillValue): string {
  return JSON.stringify(v.config);
}

/** Deserialize the Question `text` field back into a TemplateFillValue */
export function deserializeTemplateFill(text: string, correctAnswer: unknown): TemplateFillValue | null {
  try {
    const config = JSON.parse(text) as TemplateConfig;
    if (!config.__tf) return null;
    const answerKey = (correctAnswer as Record<string, BlankSpec>) ?? {};
    return { config, answerKey };
  } catch {
    return null;
  }
}
