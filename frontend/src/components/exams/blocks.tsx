"use client";

import React, { useEffect, useRef, useState } from "react";
import api from "@/lib/api";

// =========================================================
//  TYPES
// =========================================================

export type BlockType = "latex" | "image" | "code" | "table" | "audio";

export interface Block {
  id: string;
  type: BlockType;
  content?: string;
  url?: string;
  data?: string[][];
  language?: string;
}

export function uid() {
  return Math.random().toString(36).slice(2, 10);
}

export function defaultBlock(type: BlockType): Block {
  switch (type) {
    case "latex":   return { id: uid(), type: "latex", content: "x^2 + y^2 = z^2" };
    case "image":   return { id: uid(), type: "image", url: "" };
    case "code":    return { id: uid(), type: "code", content: "", language: "javascript" };
    case "table":   return { id: uid(), type: "table", data: [["Header 1", "Header 2"], ["", ""]] };
    case "audio":   return { id: uid(), type: "audio", url: "" };
  }
}

export const BLOCK_LABEL: Record<BlockType, string> = {
  latex: "LaTeX",
  image: "Image",
  code:  "Code",
  table: "Table",
  audio: "Audio",
};

// =========================================================
//  LATEX BLOCK
// =========================================================

export function LatexBlock({
  block, onChange, readOnly,
}: { block: Block; onChange?: (b: Block) => void; readOnly?: boolean }) {
  const [rendered, setRendered] = useState<string>("");
  const [err, setErr] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const katex = (await import("katex")).default;
        const html = katex.renderToString(block.content || "", {
          throwOnError: false,
          displayMode: true,
        });
        setRendered(html);
        setErr("");
      } catch (e: unknown) {
        setErr(String(e));
      }
    })();
  }, [block.content]);

  return (
    <div className="space-y-2">
      {!readOnly && onChange && (
        <textarea
          className="w-full rounded-lg border border-white/10 bg-slate-950/40 p-2 font-mono text-sm text-white min-h-[60px] focus:outline-none focus:ring-2 focus:ring-indigo-400"
          placeholder="Enter LaTeX… e.g. \frac{a}{b}"
          value={block.content || ""}
          onChange={(e) => onChange({ ...block, content: e.target.value })}
        />
      )}
      {err ? (
        <p className="text-xs text-rose-300">{err}</p>
      ) : rendered ? (
        <div
          className="min-w-0 w-full rounded-lg border border-dashed border-white/10 bg-white/[0.03] p-3 text-white"
          dangerouslySetInnerHTML={{ __html: rendered }}
        />
      ) : null}
    </div>
  );
}

// =========================================================
//  IMAGE BLOCK
// =========================================================

export function ImageBlock({
  block, onChange, readOnly,
}: { block: Block; onChange?: (b: Block) => void; readOnly?: boolean }) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    if (!onChange) return;
    setError("");
    if (!["image/jpeg", "image/png"].includes(file.type)) {
      setError("Only JPG or PNG allowed"); return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError("Max size is 5 MB"); return;
    }
    try {
      setUploading(true);
      const { default: compress } = await import("browser-image-compression");
      const compressed = await compress(file, {
        maxSizeMB: 4.5,
        maxWidthOrHeight: 2048,
        useWebWorker: true,
      });
      const form = new FormData();
      form.append("file", compressed, file.name);
      const { data } = await api.post("/questions/upload-media", form, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      onChange({ ...block, url: data.url });
    } catch {
      setError("Upload failed. Please try again.");
    } finally {
      setUploading(false);
    }
  }

  if (readOnly) {
    return block.url ? (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={block.url} alt="" loading="lazy" className="max-h-72 rounded-lg border border-white/10" />
    ) : null;
  }

  return (
    <div className="space-y-2">
      {block.url ? (
        <div className="relative inline-block">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={block.url} alt="" loading="lazy" className="max-h-48 rounded-lg border border-white/10" />
          <button
            type="button"
            onClick={() => onChange && onChange({ ...block, url: "" })}
            className="absolute top-1 right-1 h-5 w-5 rounded-full bg-rose-500 text-xs leading-5 text-white"
            title="Remove image"
          >×</button>
        </div>
      ) : (
        <div
          className="cursor-pointer rounded-lg border-2 border-dashed border-white/15 bg-white/[0.02] p-6 text-center transition hover:border-indigo-400/60"
          onClick={() => inputRef.current?.click()}
        >
          {uploading ? (
            <span className="text-sm text-white/60">Uploading…</span>
          ) : (
            <>
              <p className="text-sm text-white/70">Click to upload image</p>
              <p className="text-xs text-white/40">JPG/PNG · max 5 MB · auto-compressed</p>
            </>
          )}
        </div>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png"
        className="hidden"
        onChange={(e) => { if (e.target.files?.[0]) handleFile(e.target.files[0]); }}
      />
      {error && <p className="text-xs text-rose-300">{error}</p>}
    </div>
  );
}

// =========================================================
//  AUDIO BLOCK
// =========================================================

export function AudioBlock({
  block, onChange, readOnly,
}: { block: Block; onChange?: (b: Block) => void; readOnly?: boolean }) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    if (!onChange) return;
    setError("");
    const allowedAudio = ["audio/mpeg", "audio/mp4", "audio/aac", "audio/wav", "audio/x-wav", "audio/x-m4a"];
    if (!allowedAudio.includes(file.type)) { setError("Only MP3, M4A, AAC, or WAV allowed"); return; }
    if (file.size > 10 * 1024 * 1024) { setError("Max size is 10 MB"); return; }
    try {
      setUploading(true);
      const form = new FormData();
      form.append("file", file);
      const { data } = await api.post("/questions/upload-media", form, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      onChange({ ...block, url: data.url });
    } catch {
      setError("Upload failed. Please try again.");
    } finally {
      setUploading(false);
    }
  }

  if (readOnly) {
    return block.url ? (
      <audio controls preload="none" className="w-full max-w-md">
        <source src={block.url} type="audio/mpeg" />
      </audio>
    ) : null;
  }

  return (
    <div className="space-y-2">
      {block.url ? (
        <div className="flex items-center gap-3">
          <audio controls preload="none" className="h-10 flex-1">
            <source src={block.url} type="audio/mpeg" />
          </audio>
          <button
            type="button"
            onClick={() => onChange && onChange({ ...block, url: "" })}
            className="text-xs text-rose-300 hover:underline"
          >Remove</button>
        </div>
      ) : (
        <div
          className="cursor-pointer rounded-lg border-2 border-dashed border-white/15 bg-white/[0.02] p-6 text-center transition hover:border-indigo-400/60"
          onClick={() => inputRef.current?.click()}
        >
          {uploading ? (
            <span className="text-sm text-white/60">Uploading…</span>
          ) : (
            <>
              <p className="text-sm text-white/70">Click to upload audio</p>
              <p className="text-xs text-white/40">MP3, M4A, AAC, WAV · max 10 MB</p>
            </>
          )}
        </div>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="audio/mpeg,audio/mp4,audio/aac,audio/wav,audio/x-wav,audio/x-m4a,.mp3,.m4a,.aac,.wav"
        className="hidden"
        onChange={(e) => { if (e.target.files?.[0]) handleFile(e.target.files[0]); }}
      />
      {error && <p className="text-xs text-rose-300">{error}</p>}
    </div>
  );
}

// =========================================================
//  CODE BLOCK
// =========================================================

const LANGUAGES = ["javascript", "python", "java", "c", "cpp", "sql", "bash", "json", "html", "css"];

export function CodeBlock({
  block, onChange, readOnly,
}: { block: Block; onChange?: (b: Block) => void; readOnly?: boolean }) {
  const [highlighted, setHighlighted] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const Prism = (await import("prismjs")).default;
        await import("prismjs/components/prism-python");
        await import("prismjs/components/prism-java");
        await import("prismjs/components/prism-c");
        await import("prismjs/components/prism-cpp");
        await import("prismjs/components/prism-sql");
        await import("prismjs/components/prism-bash");
        await import("prismjs/components/prism-json");
        const langKey = block.language || "javascript";
        const lang = Prism.languages[langKey] || Prism.languages.javascript;
        const html = Prism.highlight(block.content || "", lang, langKey);
        setHighlighted(html);
      } catch {
        setHighlighted(block.content || "");
      }
    })();
  }, [block.content, block.language]);

  if (readOnly) {
    return (
      <pre className="overflow-x-auto rounded-lg border border-white/10 bg-slate-900 p-3 text-sm">
        <code dangerouslySetInnerHTML={{ __html: highlighted || (block.content || "") }} />
      </pre>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <label className="text-[10px] uppercase tracking-wider text-white/40">Language</label>
        <select
          value={block.language || "javascript"}
          onChange={(e) => onChange && onChange({ ...block, language: e.target.value })}
          className="rounded border border-white/10 bg-slate-950/60 px-2 py-1 text-xs text-white focus:outline-none"
        >
          {LANGUAGES.map((l) => <option key={l} value={l} className="bg-slate-900">{l}</option>)}
        </select>
      </div>
      <div className="relative rounded-lg border border-white/10 bg-slate-900">
        <textarea
          className="relative z-10 min-h-[100px] w-full resize-y bg-transparent p-3 font-mono text-sm text-transparent caret-white focus:outline-none"
          spellCheck={false}
          value={block.content || ""}
          onChange={(e) => onChange && onChange({ ...block, content: e.target.value })}
          placeholder="// Enter code here…"
        />
        <pre
          className="pointer-events-none absolute inset-0 overflow-hidden p-3 font-mono text-sm"
          aria-hidden
          dangerouslySetInnerHTML={{ __html: highlighted || "<span class='text-white/30'>// Enter code here…</span>" }}
        />
      </div>
    </div>
  );
}

// =========================================================
//  TABLE BLOCK
// =========================================================

export function TableBlock({
  block, onChange, readOnly,
}: { block: Block; onChange?: (b: Block) => void; readOnly?: boolean }) {
  const data: string[][] = (block.data as string[][]) || [["Header 1", "Header 2"]];

  function updateCell(r: number, c: number, val: string) {
    if (!onChange) return;
    const next = data.map((row) => [...row]);
    next[r][c] = val;
    onChange({ ...block, data: next });
  }

  function addRow() {
    if (!onChange) return;
    onChange({ ...block, data: [...data, Array(data[0]?.length || 2).fill("")] });
  }

  function addCol() {
    if (!onChange) return;
    onChange({ ...block, data: data.map((row) => [...row, ""]) });
  }

  function removeRow(r: number) {
    if (!onChange || data.length <= 1) return;
    onChange({ ...block, data: data.filter((_, i) => i !== r) });
  }

  function removeCol(c: number) {
    if (!onChange || (data[0]?.length || 0) <= 1) return;
    onChange({ ...block, data: data.map((row) => row.filter((_, i) => i !== c)) });
  }

  if (readOnly) {
    return (
      <div className="overflow-x-auto">
        <table className="border-collapse text-sm">
          <tbody>
            {data.map((row, r) => (
              <tr key={r}>
                {row.map((cell, c) => (
                  <td
                    key={c}
                    className={`border border-white/15 px-3 py-1.5 ${r === 0 ? "bg-white/[0.05] font-semibold text-white" : "text-white/80"}`}
                  >{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div className="space-y-2 overflow-x-auto">
      <table className="border-collapse text-sm">
        <tbody>
          {data.map((row, r) => (
            <tr key={r}>
              {row.map((cell, c) => (
                <td key={c} className="border border-white/15 p-0">
                  <input
                    className={`w-28 bg-transparent px-2 py-1 text-white focus:bg-indigo-500/10 focus:outline-none ${r === 0 ? "font-semibold" : ""}`}
                    value={cell}
                    onChange={(e) => updateCell(r, c, e.target.value)}
                  />
                </td>
              ))}
              <td className="pl-1">
                <button type="button" onClick={() => removeRow(r)} className="text-xs text-rose-300/70 hover:text-rose-300">−row</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex gap-3 text-xs">
        <button type="button" onClick={addRow} className="text-indigo-300 hover:underline">+ Add row</button>
        <button type="button" onClick={addCol} className="text-indigo-300 hover:underline">+ Add column</button>
        {(data[0]?.length || 0) > 1 && (
          <button type="button" onClick={() => removeCol((data[0]?.length || 1) - 1)} className="text-rose-300/70 hover:underline">− Remove last column</button>
        )}
      </div>
    </div>
  );
}

// =========================================================
//  GENERIC BLOCK RENDERER (read-only display)
// =========================================================

export function BlockView({ block }: { block: Block }) {
  if (block.type === "latex") return <LatexBlock block={block} readOnly />;
  if (block.type === "image") return <ImageBlock block={block} readOnly />;
  if (block.type === "audio") return <AudioBlock block={block} readOnly />;
  if (block.type === "code")  return <CodeBlock  block={block} readOnly />;
  if (block.type === "table") return <TableBlock block={block} readOnly />;
  return null;
}

export function BlockList({ blocks }: { blocks: Block[] | undefined | null }) {
  if (!blocks || !Array.isArray(blocks) || blocks.length === 0) return null;
  return (
    <div className="space-y-3">
      {blocks.map((b) => <BlockView key={b.id} block={b} />)}
    </div>
  );
}
