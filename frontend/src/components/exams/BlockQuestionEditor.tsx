"use client";

import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
} from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import api from "@/lib/api";

// ----------- TYPES -----------

export type BlockType = "text" | "latex" | "image" | "code" | "table" | "audio";

export interface Block {
  id: string;
  type: BlockType;
  content?: string;
  url?: string;
  data?: string[][];
  language?: string;
}

export interface BlockQuestion {
  id?: string;
  localId: string;
  type: string;
  marks: number;
  correctAnswer?: string;
  blocks: Block[];
  order?: number;
  dirty?: boolean;
}

interface BlockQuestionEditorProps {
  examId: string;
  onCountChange?: (n: number) => void;
}

// ----------- HELPERS -----------

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

function defaultBlock(type: BlockType): Block {
  switch (type) {
    case "text":    return { id: uid(), type: "text", content: "" };
    case "latex":   return { id: uid(), type: "latex", content: "x^2 + y^2 = z^2" };
    case "image":   return { id: uid(), type: "image", url: "" };
    case "code":    return { id: uid(), type: "code", content: "", language: "javascript" };
    case "table":   return { id: uid(), type: "table", data: [["Header 1", "Header 2"], ["", ""]] };
    case "audio":   return { id: uid(), type: "audio", url: "" };
  }
}

// ----------- LATEX BLOCK -----------

function LatexBlock({ block, onChange }: { block: Block; onChange: (b: Block) => void }) {
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
      <textarea
        className="w-full border border-gray-300 rounded p-2 font-mono text-sm min-h-[60px] focus:outline-none focus:ring-2 focus:ring-blue-400"
        placeholder="Enter LaTeX…  e.g. \\frac{a}{b}"
        value={block.content || ""}
        onChange={(e) => onChange({ ...block, content: e.target.value })}
      />
      {err ? (
        <p className="text-xs text-red-500">{err}</p>
      ) : rendered ? (
        <div
          className="border border-dashed border-gray-300 rounded p-3 bg-gray-50 overflow-x-auto"
          dangerouslySetInnerHTML={{ __html: rendered }}
        />
      ) : null}
      <link
        rel="stylesheet"
        href="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css"
      />
    </div>
  );
}

// ----------- IMAGE BLOCK -----------

function ImageBlock({ block, onChange }: { block: Block; onChange: (b: Block) => void }) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    setError("");
    if (!["image/jpeg", "image/png"].includes(file.type)) {
      setError("Only JPG or PNG allowed"); return;
    }
    if (file.size > 1024 * 1024) {
      setError("Max size is 1 MB"); return;
    }
    try {
      setUploading(true);
      const { default: compress } = await import("browser-image-compression");
      const compressed = await compress(file, {
        maxSizeMB: 0.9,
        maxWidthOrHeight: 1024,
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

  return (
    <div className="space-y-2">
      {block.url ? (
        <div className="relative inline-block">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={block.url}
            alt="block"
            loading="lazy"
            className="max-h-48 rounded border border-gray-200"
          />
          <button
            type="button"
            onClick={() => onChange({ ...block, url: "" })}
            className="absolute top-1 right-1 bg-red-500 text-white rounded-full w-5 h-5 text-xs leading-5 text-center"
          >×</button>
        </div>
      ) : (
        <div
          className="border-2 border-dashed border-gray-300 rounded p-6 text-center cursor-pointer hover:border-blue-400 transition-colors"
          onClick={() => inputRef.current?.click()}
        >
          {uploading ? (
            <span className="text-sm text-gray-500">Uploading…</span>
          ) : (
            <>
              <p className="text-sm text-gray-500">Click to upload image</p>
              <p className="text-xs text-gray-400">JPG/PNG · max 1 MB · max 1024×1024</p>
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
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}

// ----------- AUDIO BLOCK -----------

function AudioBlock({ block, onChange }: { block: Block; onChange: (b: Block) => void }) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    setError("");
    if (file.type !== "audio/mpeg") { setError("Only MP3 allowed"); return; }
    if (file.size > 3 * 1024 * 1024) { setError("Max size is 3 MB"); return; }
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

  return (
    <div className="space-y-2">
      {block.url ? (
        <div className="flex items-center gap-3">
          <audio controls preload="none" className="flex-1 h-10">
            <source src={block.url} type="audio/mpeg" />
          </audio>
          <button
            type="button"
            onClick={() => onChange({ ...block, url: "" })}
            className="text-red-500 text-xs hover:underline"
          >Remove</button>
        </div>
      ) : (
        <div
          className="border-2 border-dashed border-gray-300 rounded p-6 text-center cursor-pointer hover:border-blue-400 transition-colors"
          onClick={() => inputRef.current?.click()}
        >
          {uploading ? (
            <span className="text-sm text-gray-500">Uploading…</span>
          ) : (
            <>
              <p className="text-sm text-gray-500">Click to upload audio</p>
              <p className="text-xs text-gray-400">MP3 · max 3 MB · max 90 s</p>
            </>
          )}
        </div>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="audio/mpeg"
        className="hidden"
        onChange={(e) => { if (e.target.files?.[0]) handleFile(e.target.files[0]); }}
      />
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}

// ----------- CODE BLOCK -----------

function CodeBlock({ block, onChange }: { block: Block; onChange: (b: Block) => void }) {
  const [highlighted, setHighlighted] = useState("");
  const LANGUAGES = ["javascript", "python", "java", "c", "cpp", "sql", "bash", "json", "html", "css"];

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
        const lang = Prism.languages[block.language || "javascript"] || Prism.languages.javascript;
        const html = Prism.highlight(block.content || "", lang, block.language || "javascript");
        setHighlighted(html);
      } catch {
        setHighlighted(block.content || "");
      }
    })();
  }, [block.content, block.language]);

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <select
          value={block.language || "javascript"}
          onChange={(e) => onChange({ ...block, language: e.target.value })}
          className="text-xs border border-gray-300 rounded px-2 py-1 focus:outline-none"
        >
          {LANGUAGES.map((l) => <option key={l} value={l}>{l}</option>)}
        </select>
      </div>
      <div className="relative">
        <textarea
          className="w-full font-mono text-sm border border-gray-300 rounded p-3 min-h-[100px] focus:outline-none focus:ring-2 focus:ring-blue-400 bg-transparent relative z-10 resize-y"
          spellCheck={false}
          value={block.content || ""}
          onChange={(e) => onChange({ ...block, content: e.target.value })}
          placeholder="// Enter code here…"
          style={{ caretColor: "#1e293b" }}
        />
        {highlighted && (
          <pre
            className="absolute inset-0 pointer-events-none p-3 font-mono text-sm rounded overflow-hidden"
            aria-hidden
            dangerouslySetInnerHTML={{ __html: highlighted }}
          />
        )}
      </div>
      <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/prismjs@1.29.0/themes/prism-tomorrow.min.css" />
    </div>
  );
}

// ----------- TABLE BLOCK -----------

function TableBlock({ block, onChange }: { block: Block; onChange: (b: Block) => void }) {
  const data: string[][] = (block.data as string[][]) || [["Header 1", "Header 2"]];

  function updateCell(r: number, c: number, val: string) {
    const next = data.map((row) => [...row]);
    next[r][c] = val;
    onChange({ ...block, data: next });
  }

  function addRow() {
    onChange({ ...block, data: [...data, Array(data[0]?.length || 2).fill("")] });
  }

  function addCol() {
    onChange({ ...block, data: data.map((row) => [...row, ""]) });
  }

  function removeRow(r: number) {
    if (data.length <= 1) return;
    onChange({ ...block, data: data.filter((_, i) => i !== r) });
  }

  function removeCol(c: number) {
    if ((data[0]?.length || 0) <= 1) return;
    onChange({ ...block, data: data.map((row) => row.filter((_, i) => i !== c)) });
  }

  return (
    <div className="space-y-2 overflow-x-auto">
      <table className="border-collapse text-sm">
        <tbody>
          {data.map((row, r) => (
            <tr key={r}>
              {row.map((cell, c) => (
                <td key={c} className="border border-gray-300 p-0">
                  <input
                    className={`px-2 py-1 w-28 focus:outline-none focus:bg-blue-50 ${r === 0 ? "font-semibold bg-gray-100" : ""}`}
                    value={cell}
                    onChange={(e) => updateCell(r, c, e.target.value)}
                  />
                </td>
              ))}
              <td className="pl-1">
                <button type="button" onClick={() => removeRow(r)} className="text-red-400 text-xs hover:text-red-600">−row</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex gap-2">
        <button type="button" onClick={addRow} className="text-xs text-blue-600 hover:underline">+ Add row</button>
        <button type="button" onClick={addCol} className="text-xs text-blue-600 hover:underline">+ Add column</button>
        {(data[0]?.length || 0) > 1 && (
          <button type="button" onClick={() => removeCol((data[0]?.length || 1) - 1)} className="text-xs text-red-400 hover:underline">− Remove last col</button>
        )}
      </div>
    </div>
  );
}

// ----------- TEXT BLOCK (TipTap) -----------

function TextBlock({ block, onChange }: { block: Block; onChange: (b: Block) => void }) {
  const editor = useEditor({
    extensions: [StarterKit],
    content: block.content || "",
    onUpdate({ editor }) {
      onChange({ ...block, content: editor.getHTML() });
    },
    editorProps: {
      attributes: { class: "prose prose-sm max-w-none focus:outline-none min-h-[60px] p-2" },
    },
  });

  if (!editor) return null;

  const btn = (action: () => boolean, label: string, active: boolean) => (
    <button
      key={label}
      type="button"
      onMouseDown={(e) => { e.preventDefault(); action(); }}
      className={`px-2 py-0.5 text-xs rounded border ${active ? "bg-blue-600 text-white border-blue-600" : "border-gray-300 hover:bg-gray-100"}`}
    >{label}</button>
  );

  return (
    <div className="border border-gray-300 rounded overflow-hidden">
      <div className="flex flex-wrap gap-1 p-1 bg-gray-50 border-b border-gray-200">
        {btn(() => editor.chain().focus().toggleBold().run(), "B", editor.isActive("bold"))}
        {btn(() => editor.chain().focus().toggleItalic().run(), "I", editor.isActive("italic"))}
        {btn(() => editor.chain().focus().toggleHeading({ level: 2 }).run(), "H2", editor.isActive("heading", { level: 2 }))}
        {btn(() => editor.chain().focus().toggleHeading({ level: 3 }).run(), "H3", editor.isActive("heading", { level: 3 }))}
        {btn(() => editor.chain().focus().toggleBulletList().run(), "• List", editor.isActive("bulletList"))}
        {btn(() => editor.chain().focus().toggleOrderedList().run(), "1. List", editor.isActive("orderedList"))}
        {btn(() => editor.chain().focus().toggleBlockquote().run(), "Quote", editor.isActive("blockquote"))}
      </div>
      <EditorContent editor={editor} />
    </div>
  );
}

// ----------- BLOCK RENDERER -----------

function BlockEditor({ block, onChange }: { block: Block; onChange: (b: Block) => void }) {
  const LABELS: Record<BlockType, string> = {
    text: "📝 Text",
    latex: "∑ LaTeX",
    image: "🖼 Image",
    code: "💻 Code",
    table: "📊 Table",
    audio: "🎵 Audio",
  };

  return (
    <div>
      <p className="text-xs font-semibold text-gray-400 uppercase mb-1">{LABELS[block.type]}</p>
      {block.type === "text"  && <TextBlock  block={block} onChange={onChange} />}
      {block.type === "latex" && <LatexBlock block={block} onChange={onChange} />}
      {block.type === "image" && <ImageBlock block={block} onChange={onChange} />}
      {block.type === "code"  && <CodeBlock  block={block} onChange={onChange} />}
      {block.type === "table" && <TableBlock block={block} onChange={onChange} />}
      {block.type === "audio" && <AudioBlock block={block} onChange={onChange} />}
    </div>
  );
}

// ----------- SORTABLE BLOCK ROW -----------

function SortableBlock({
  block,
  onChange,
  onDelete,
}: {
  block: Block;
  onChange: (b: Block) => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: block.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="group relative border border-gray-200 rounded-lg p-3 bg-white shadow-sm"
    >
      <div className="flex items-start gap-2">
        <div
          {...attributes}
          {...listeners}
          className="mt-1 cursor-grab text-gray-300 hover:text-gray-500 flex-shrink-0"
          title="Drag to reorder"
        >
          ⠿
        </div>
        <div className="flex-1 min-w-0">
          <BlockEditor block={block} onChange={onChange} />
        </div>
        <button
          type="button"
          onClick={onDelete}
          className="flex-shrink-0 mt-1 text-red-400 hover:text-red-600 text-sm"
          title="Remove block"
        >✕</button>
      </div>
    </div>
  );
}

// ----------- SINGLE QUESTION EDITOR -----------

const QUESTION_TYPES = [
  { value: "MCQ", label: "Multiple Choice" },
  { value: "TRUE_FALSE", label: "True / False" },
  { value: "FILL_IN_BLANK", label: "Fill in the Blank" },
  { value: "MULTI_BLANK_EQUATION", label: "Multi-Blank" },
];

function QuestionCard({
  q,
  index,
  onChange,
  onDelete,
  onSave,
  saving,
}: {
  q: BlockQuestion;
  index: number;
  onChange: (updated: BlockQuestion) => void;
  onDelete: () => void;
  onSave: () => Promise<void>;
  saving: boolean;
}) {
  const [open, setOpen] = useState(true);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const BLOCK_TYPES: BlockType[] = ["text", "latex", "image", "code", "table", "audio"];

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const oldIdx = q.blocks.findIndex((b) => b.id === active.id);
      const newIdx = q.blocks.findIndex((b) => b.id === over.id);
      onChange({ ...q, blocks: arrayMove(q.blocks, oldIdx, newIdx), dirty: true });
    }
  }

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setAddMenuOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div className={`border rounded-xl overflow-hidden ${q.dirty ? "border-yellow-400" : "border-gray-200"} bg-white shadow-sm`}>
      {/* Header */}
      <div
        className="flex items-center gap-3 px-4 py-3 bg-gray-50 cursor-pointer select-none"
        onClick={() => setOpen((o) => !o)}
      >
        <span className="w-7 h-7 rounded-full bg-blue-600 text-white text-xs font-bold flex items-center justify-center flex-shrink-0">
          {index + 1}
        </span>
        <span className="flex-1 text-sm font-medium text-gray-700 truncate">
          {q.blocks.find((b) => b.type === "text")
            ? "Text question"
            : q.blocks[0]
            ? `${q.blocks[0].type} block question`
            : "Empty question"}
        </span>
        {q.dirty && <span className="text-xs text-yellow-600 font-medium">unsaved</span>}
        <span className="text-gray-400 text-xs">{open ? "▲" : "▼"}</span>
      </div>

      {open && (
        <div className="p-4 space-y-4">
          {/* Question meta */}
          <div className="flex flex-wrap gap-3 items-end">
            <div>
              <label className="block text-xs text-gray-500 mb-0.5">Question type</label>
              <select
                value={q.type}
                onChange={(e) => onChange({ ...q, type: e.target.value, dirty: true })}
                className="border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
              >
                {QUESTION_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-0.5">Marks</label>
              <input
                type="number"
                value={q.marks}
                onChange={(e) => onChange({ ...q, marks: parseFloat(e.target.value) || 1, dirty: true })}
                className="border border-gray-300 rounded px-2 py-1 text-sm w-20 focus:outline-none focus:ring-2 focus:ring-blue-400"
                min={0.5}
                step={0.5}
              />
            </div>
            <div className="flex-1 min-w-[160px]">
              <label className="block text-xs text-gray-500 mb-0.5">Correct answer / key</label>
              <input
                type="text"
                value={q.correctAnswer || ""}
                onChange={(e) => onChange({ ...q, correctAnswer: e.target.value, dirty: true })}
                placeholder="e.g. A, True, Paris…"
                className="border border-gray-300 rounded px-2 py-1 text-sm w-full focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
            </div>
          </div>

          {/* Block list */}
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={q.blocks.map((b) => b.id)} strategy={verticalListSortingStrategy}>
              <div className="space-y-3">
                {q.blocks.map((block) => (
                  <SortableBlock
                    key={block.id}
                    block={block}
                    onChange={(updated) =>
                      onChange({
                        ...q,
                        blocks: q.blocks.map((b) => (b.id === block.id ? updated : b)),
                        dirty: true,
                      })
                    }
                    onDelete={() =>
                      onChange({ ...q, blocks: q.blocks.filter((b) => b.id !== block.id), dirty: true })
                    }
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>

          {q.blocks.length === 0 && (
            <div className="border-2 border-dashed border-gray-200 rounded-lg p-8 text-center text-gray-400 text-sm">
              No blocks yet. Click "Add Block" to start building your question.
            </div>
          )}

          {/* Add block menu */}
          <div className="flex items-center gap-3">
            <div className="relative" ref={menuRef}>
              <button
                type="button"
                onClick={() => setAddMenuOpen((o) => !o)}
                className="flex items-center gap-1 px-3 py-1.5 text-sm text-blue-700 border border-blue-300 rounded-lg hover:bg-blue-50 transition-colors"
              >
                <span>+</span> Add Block
              </button>
              {addMenuOpen && (
                <div className="absolute top-full left-0 mt-1 z-20 bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden w-44">
                  {BLOCK_TYPES.map((type) => {
                    const icons: Record<BlockType, string> = { text: "📝", latex: "∑", image: "🖼", code: "💻", table: "📊", audio: "🎵" };
                    return (
                      <button
                        key={type}
                        type="button"
                        onClick={() => {
                          onChange({ ...q, blocks: [...q.blocks, defaultBlock(type)], dirty: true });
                          setAddMenuOpen(false);
                        }}
                        className="w-full px-3 py-2 text-left text-sm hover:bg-gray-50 flex items-center gap-2 capitalize"
                      >
                        <span>{icons[type]}</span> {type}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="flex-1" />

            <button
              type="button"
              onClick={onDelete}
              className="text-xs text-red-500 hover:text-red-700 hover:underline"
            >Delete question</button>

            <button
              type="button"
              onClick={onSave}
              disabled={saving || !q.dirty}
              className="px-4 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {saving ? "Saving…" : q.dirty ? "Save" : "Saved ✓"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ----------- MAIN EDITOR -----------

const PAGE_SIZE = 8;

export default function BlockQuestionEditor({ examId, onCountChange }: BlockQuestionEditorProps) {
  const [questions, setQuestions] = useState<BlockQuestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [error, setError] = useState("");
  const debounceTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  // Fetch block-based questions on mount
  useEffect(() => {
    (async () => {
      try {
        const { data } = await api.get(`/questions/exam/${examId}`);
        const blockQs: BlockQuestion[] = (data.data || [])
          .filter((q: Record<string, unknown>) => Array.isArray(q.blocks) && (q.blocks as unknown[]).length > 0)
          .map((q: Record<string, unknown>) => ({
            id: q.id as string,
            localId: q.id as string,
            type: q.type as string,
            marks: q.marks as number,
            correctAnswer: q.correctAnswer as string | undefined,
            blocks: q.blocks as Block[],
            order: q.order as number,
            dirty: false,
          }));
        setQuestions(blockQs);
        onCountChange?.(blockQs.length);
      } catch {
        setError("Failed to load questions.");
      } finally {
        setLoading(false);
      }
    })();
  }, [examId, onCountChange]);

  function handleChange(updated: BlockQuestion) {
    setQuestions((prev) => prev.map((q) => (q.localId === updated.localId ? updated : q)));
    // Debounced autosave (4 s)
    const key = updated.localId;
    clearTimeout(debounceTimers.current[key]);
    debounceTimers.current[key] = setTimeout(() => {
      saveQuestion(updated);
    }, 4000);
  }

  const saveQuestion = useCallback(async (q: BlockQuestion) => {
    if (!q.dirty) return;
    setSavingId(q.localId);
    try {
      const payload = {
        type: q.type,
        text: "[block-based question]",
        correctAnswer: q.correctAnswer || "",
        marks: q.marks,
        blocks: q.blocks,
      };
      if (q.id) {
        await api.put(`/questions/${q.id}`, payload);
      } else {
        const { data } = await api.post(`/questions/exam/${examId}`, payload);
        setQuestions((prev) =>
          prev.map((pq) =>
            pq.localId === q.localId ? { ...pq, id: data.data.id, dirty: false } : pq
          )
        );
        setSavingId(null);
        return;
      }
      setQuestions((prev) =>
        prev.map((pq) => (pq.localId === q.localId ? { ...pq, dirty: false } : pq))
      );
    } catch {
      setError("Save failed. Please try again.");
    } finally {
      setSavingId(null);
    }
  }, [examId]);

  async function handleSave(q: BlockQuestion) {
    clearTimeout(debounceTimers.current[q.localId]);
    await saveQuestion(q);
  }

  async function handleDelete(q: BlockQuestion) {
    if (!confirm("Delete this question?")) return;
    clearTimeout(debounceTimers.current[q.localId]);
    if (q.id) {
      await api.delete(`/questions/${q.id}`);
    }
    setQuestions((prev) => {
      const next = prev.filter((pq) => pq.localId !== q.localId);
      onCountChange?.(next.length);
      return next;
    });
  }

  function addQuestion() {
    const newQ: BlockQuestion = {
      localId: uid(),
      type: "MCQ",
      marks: 1,
      correctAnswer: "",
      blocks: [defaultBlock("text")],
      dirty: true,
    };
    setQuestions((prev) => {
      const next = [...prev, newQ];
      onCountChange?.(next.length);
      return next;
    });
    // Jump to the last page
    setPage(Math.floor((questions.length) / PAGE_SIZE));
  }

  const totalPages = useMemo(() => Math.max(1, Math.ceil(questions.length / PAGE_SIZE)), [questions.length]);
  const pageQs = useMemo(
    () => questions.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE),
    [questions, page]
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-gray-400 text-sm">
        Loading block questions…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header bar */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-gray-800">Block-Based Question Editor</h3>
          <p className="text-sm text-gray-500">
            {questions.length} question{questions.length !== 1 ? "s" : ""} · Build rich questions with text, LaTeX, images, code, tables, and audio
          </p>
        </div>
        <button
          type="button"
          onClick={addQuestion}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors shadow-sm"
        >
          + Add Question
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3 flex items-center justify-between">
          {error}
          <button type="button" onClick={() => setError("")} className="text-red-400 hover:text-red-600">✕</button>
        </div>
      )}

      {/* Block type legend */}
      <div className="flex flex-wrap gap-2 text-xs text-gray-500">
        {[
          { icon: "📝", label: "Text (rich text with formatting)" },
          { icon: "∑",  label: "LaTeX (math expressions)" },
          { icon: "🖼",  label: "Image (JPG/PNG, max 1 MB)" },
          { icon: "💻",  label: "Code (syntax highlighted)" },
          { icon: "📊",  label: "Table (editable grid)" },
          { icon: "🎵",  label: "Audio (MP3, max 3 MB)" },
        ].map(({ icon, label }) => (
          <span key={label} className="flex items-center gap-1 bg-gray-100 rounded-full px-2 py-0.5">
            {icon} {label}
          </span>
        ))}
      </div>

      {/* Question list */}
      {questions.length === 0 ? (
        <div className="border-2 border-dashed border-gray-200 rounded-xl p-16 text-center">
          <p className="text-4xl mb-3">📝</p>
          <p className="text-gray-600 font-medium">No block questions yet</p>
          <p className="text-sm text-gray-400 mt-1 mb-4">
            Create rich questions with formatted text, math, images, code, tables, and audio.
          </p>
          <button
            type="button"
            onClick={addQuestion}
            className="px-5 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 transition-colors"
          >
            + Add Your First Question
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {pageQs.map((q, i) => (
            <QuestionCard
              key={q.localId}
              q={q}
              index={page * PAGE_SIZE + i}
              onChange={handleChange}
              onDelete={() => handleDelete(q)}
              onSave={() => handleSave(q)}
              saving={savingId === q.localId}
            />
          ))}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 pt-2">
          <button
            type="button"
            disabled={page === 0}
            onClick={() => setPage((p) => p - 1)}
            className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg disabled:opacity-40 hover:bg-gray-50"
          >← Prev</button>
          <span className="text-sm text-gray-500">
            Page {page + 1} of {totalPages}
          </span>
          <button
            type="button"
            disabled={page >= totalPages - 1}
            onClick={() => setPage((p) => p + 1)}
            className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg disabled:opacity-40 hover:bg-gray-50"
          >Next →</button>
        </div>
      )}
    </div>
  );
}
