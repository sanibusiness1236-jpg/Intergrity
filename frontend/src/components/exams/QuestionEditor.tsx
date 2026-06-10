"use client";

import { useEffect, useRef, useState } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import { MathInline } from "./MathInlineExtension";
import type { Question, QuestionType } from "@/types";
import {
  AudioBlock,
  type Block,
  type BlockType,
  CodeBlock,
  defaultBlock,
  ImageBlock,
  LatexBlock,
  TableBlock,
  uid,
} from "./blocks";
import {
  TemplateFillCreator,
  serializeTemplateFill,
  deserializeTemplateFill,
  type TemplateFillValue,
} from "./TemplateFillCreator";
import api from "@/lib/api";

export const QTYPE_LABEL: Record<QuestionType, string> = {
  MCQ: "Multiple Choice",
  TRUE_FALSE: "True / False",
  FILL_IN_BLANK: "Fill in the Blank",
  MULTI_BLANK_EQUATION: "Multi-Blank Equation",
  TEMPLATE_FILL: "Template Fill",
};

export const QTYPE_TONE: Record<QuestionType, string> = {
  MCQ: "bg-indigo-500/15 text-indigo-300 border-indigo-500/30",
  TRUE_FALSE: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  FILL_IN_BLANK: "bg-blue-500/15 text-blue-300 border-blue-500/30",
  MULTI_BLANK_EQUATION: "bg-purple-500/15 text-purple-300 border-purple-500/30",
  TEMPLATE_FILL: "bg-fuchsia-500/15 text-fuchsia-300 border-fuchsia-500/30",
};

export const QTYPE_ICON: Record<QuestionType, string> = {
  MCQ: "M9 11l3 3L22 4M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11",
  TRUE_FALSE: "M9 12l2 2 4-4M12 2a10 10 0 100 20 10 10 0 000-20z",
  FILL_IN_BLANK: "M3 6h18M3 12h18M3 18h12",
  MULTI_BLANK_EQUATION: "M7 8h10M7 12h4m0 4h6m-3-12v16",
  TEMPLATE_FILL: "M9 17H7m10 0h-4m4-4H7m10 0h-2M7 9h10M7 5h4m6 0h-2",
};

// ─── Rich MCQ option ─────────────────────────────────────────────────────────
export interface RichOption {
  id: string;
  displayType: "text" | "latex" | "image";
  value: string;   // plain-text label used for correctAnswer matching
  content: string; // for text: same as value; for latex: LaTeX source
  url: string;     // for image: uploaded URL
}

export function emptyRichOption(): RichOption {
  return { id: uid(), displayType: "text", value: "", content: "", url: "" };
}

function richOptToStorage(o: RichOption): unknown {
  if (o.displayType === "text") return o.value;
  // For LaTeX/image options store as object; value MUST be non-empty for grading
  return { displayType: o.displayType, value: o.value, content: o.content, url: o.url };
}

function storageToRichOpt(raw: unknown): RichOption {
  if (typeof raw === "string") {
    return { id: uid(), displayType: "text", value: raw, content: raw, url: "" };
  }
  if (raw !== null && typeof raw === "object") {
    const r = raw as Record<string, unknown>;
    const value  = typeof r.value   === "string" ? r.value   : "";
    const content = typeof r.content === "string" ? r.content : value;
    const url    = typeof r.url     === "string" ? r.url     : "";
    const dtype  = r.displayType === "latex" || r.displayType === "image" ? r.displayType : "text";
    return { id: uid(), displayType: dtype, value, content, url };
  }
  return emptyRichOption();
}

export interface QuestionFormValue {
  type: QuestionType;
  text: string;            // HTML (for most types) or plain text (multi-blank) or JSON (template_fill)
  options: string[];       // kept for backward compat (mirrors richOptions[].value)
  richOptions: RichOption[]; // MCQ options with optional LaTeX/image display
  correctAnswerStr: string;
  blanks: string[];
  marks: number;
  fillInBlankType: "text" | "dropdown";
  dropdownOptions: string[];
  acceptedAnswers: string[];   // FILL_IN_BLANK text-type: list of accepted answers
  caseSensitive: boolean;      // FILL_IN_BLANK text-type: case-sensitive matching
  blocks: Block[];
  templateFill: TemplateFillValue | null; // TEMPLATE_FILL config + answer key
}

export function questionToForm(q: Partial<Question>): QuestionFormValue {
  const fibType = (q as { fillInBlankType?: string }).fillInBlankType === "dropdown" ? "dropdown" : "text";
  const existingDropdown =
    fibType === "dropdown" && Array.isArray(q.options) ? [...(q.options as string[])] : ["", "", ""];

  const rawBlocks = (q as { blocks?: Block[] }).blocks;
  const blocks: Block[] = Array.isArray(rawBlocks)
    ? rawBlocks.map((b) => ({ ...b, id: b.id || uid() }))
    : [];

  // Parse FILL_IN_BLANK text-type accepted answers (new multi-answer format or legacy string)
  let acceptedAnswers: string[] = [""];
  let caseSensitive = false;
  if (q.type === "FILL_IN_BLANK" && fibType === "text") {
    const ca = q.correctAnswer as unknown;
    if (ca && typeof ca === "object" && !Array.isArray(ca) && Array.isArray((ca as { answers?: string[] }).answers)) {
      acceptedAnswers = [...(ca as { answers: string[]; caseSensitive?: boolean }).answers];
      caseSensitive = !!(ca as { caseSensitive?: boolean }).caseSensitive;
    } else if (typeof ca === "string" && ca) {
      acceptedAnswers = [ca];
    }
  }

  // For dropdown FIB, correctAnswerStr is the selected option
  // For text FIB, correctAnswerStr is unused (acceptedAnswers is used instead)
  const correctAnswerStr =
    q.type === "MCQ" || q.type === "TRUE_FALSE"
      ? String(q.correctAnswer ?? "")
      : q.type === "FILL_IN_BLANK" && fibType === "dropdown"
        ? String(q.correctAnswer ?? "")
        : "";

  // Rich MCQ options (backward-compat: string[] or RichOption[])
  const rawOptions = q.type === "MCQ" && Array.isArray(q.options) ? q.options : [];
  const richOptions: RichOption[] =
    rawOptions.length > 0
      ? (rawOptions as unknown[]).map(storageToRichOpt)
      : [emptyRichOption(), emptyRichOption(), emptyRichOption(), emptyRichOption()];

  // TEMPLATE_FILL — deserialize JSON stored in `text`
  let templateFill: TemplateFillValue | null = null;
  if (q.type === "TEMPLATE_FILL" && q.text) {
    templateFill = deserializeTemplateFill(q.text, q.correctAnswer);
  }

  return {
    type: (q.type as QuestionType) || "MCQ",
    text: q.type === "TEMPLATE_FILL" ? "" : (q.text || ""),
    options: richOptions.map((o) => o.value),
    richOptions,
    correctAnswerStr,
    blanks:
      q.type === "MULTI_BLANK_EQUATION" && Array.isArray(q.correctAnswer)
        ? [...(q.correctAnswer as string[])]
        : ["", ""],
    marks: q.marks ?? 1,
    fillInBlankType: fibType,
    dropdownOptions: existingDropdown,
    acceptedAnswers,
    caseSensitive,
    blocks,
    templateFill,
  };
}

// Helpers --------------------------------------------------

function htmlToPlainText(html: string): string {
  // crude server-safe HTML strip — only used for validation
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

function isHtmlEmpty(html: string): boolean {
  return htmlToPlainText(html).length === 0;
}

// ---------------------------------------------------------

export function formToPayload(form: QuestionFormValue): {
  payload: Partial<Question> | null;
  error: string | null;
} {
  const isMultiBlank = form.type === "MULTI_BLANK_EQUATION";
  const isTemplateFillType = form.type === "TEMPLATE_FILL";
  const blocks = form.blocks.length > 0 ? form.blocks : undefined;

  // For TEMPLATE_FILL the template itself IS the content — skip text requirement
  if (!isTemplateFillType) {
    const textEmpty = isMultiBlank ? !form.text.trim() : isHtmlEmpty(form.text);
    if (textEmpty && !blocks) return { payload: null, error: "Question text is required (or add at least one content block)" };
  }
  if (isNaN(form.marks)) return { payload: null, error: "Marks must be a number" };

  if (form.type === "MCQ") {
    const richOpts = form.richOptions.filter((o) => {
      if (o.displayType === "text") return o.value.trim() !== "";
      if (o.displayType === "latex") return o.content.trim() !== "";
      if (o.displayType === "image") return o.url.trim() !== "";
      return false;
    });
    if (richOpts.length < 2) return { payload: null, error: "MCQ needs at least 2 options" };
    const correctOpt = richOpts.find((o) => o.value === form.correctAnswerStr);
    if (!correctOpt) return { payload: null, error: "Select which option is correct" };
    const serialisedOpts = richOpts.map(richOptToStorage);
    return {
      payload: {
        type: "MCQ",
        text: form.text,
        options: serialisedOpts,
        correctAnswer: correctOpt.value,   // always a stable plain-text value
        marks: form.marks,
        blocks,
      } as Partial<Question>,
      error: null,
    };
  }

  if (form.type === "TRUE_FALSE") {
    if (form.correctAnswerStr !== "true" && form.correctAnswerStr !== "false") {
      return { payload: null, error: "Pick True or False" };
    }
    return {
      payload: { type: "TRUE_FALSE", text: form.text, correctAnswer: form.correctAnswerStr, marks: form.marks, blocks } as Partial<Question>,
      error: null,
    };
  }

  if (form.type === "FILL_IN_BLANK") {
    if (form.fillInBlankType === "dropdown") {
      const opts = form.dropdownOptions.map((o) => o.trim()).filter(Boolean);
      if (opts.length < 2) return { payload: null, error: "Dropdown needs at least 2 options" };
      if (!form.correctAnswerStr || !opts.includes(form.correctAnswerStr)) {
        return { payload: null, error: "Select which dropdown option is correct" };
      }
      return {
        payload: {
          type: "FILL_IN_BLANK",
          text: form.text,
          options: opts,
          correctAnswer: form.correctAnswerStr,
          marks: form.marks,
          fillInBlankType: "dropdown",
          blocks,
        } as Partial<Question>,
        error: null,
      };
    }
    // Text-type: require at least one accepted answer
    const answers = form.acceptedAnswers.map((a) => a.trim()).filter(Boolean);
    if (answers.length === 0) return { payload: null, error: "Provide at least one expected answer" };
    return {
      payload: {
        type: "FILL_IN_BLANK",
        text: form.text,
        correctAnswer: { answers, caseSensitive: form.caseSensitive },
        marks: form.marks,
        fillInBlankType: "text",
        blocks,
      } as Partial<Question>,
      error: null,
    };
  }

  if (form.type === "MULTI_BLANK_EQUATION") {
    const blanks = form.blanks.map((b) => b.trim()).filter(Boolean);
    if (blanks.length === 0) return { payload: null, error: "Provide at least one blank answer" };
    const blanksInText = (form.text.match(/___/g) || []).length;
    if (blanksInText !== blanks.length) {
      return {
        payload: null,
        error: `Text has ${blanksInText} "___" but ${blanks.length} answer(s) provided`,
      };
    }
    return {
      payload: { type: "MULTI_BLANK_EQUATION", text: form.text, correctAnswer: blanks, marks: form.marks, blocks } as Partial<Question>,
      error: null,
    };
  }

  if (form.type === "TEMPLATE_FILL") {
    if (!form.templateFill) return { payload: null, error: "Configure the template fill question" };
    const { config, answerKey } = form.templateFill;
    if (config.blankOrder.length === 0) return { payload: null, error: "Add at least one blank to the template" };
    for (const id of config.blankOrder) {
      const spec = answerKey[id];
      const hasAnswer = spec?.answers?.some((a) => a.trim() !== "");
      if (!hasAnswer) return { payload: null, error: `Provide at least one answer for ${id}` };
    }
    return {
      payload: {
        type: "TEMPLATE_FILL",
        text: serializeTemplateFill(form.templateFill),
        correctAnswer: answerKey,
        marks: form.marks,
        blocks,
      } as Partial<Question>,
      error: null,
    };
  }

  return { payload: null, error: "Unknown question type" };
}

interface QuestionEditorProps {
  initial: Partial<Question>;
  onSave: (payload: Partial<Question>) => Promise<void> | void;
  onCancel: () => void;
  saveLabel?: string;
  lockedType?: boolean;
}

const Svg = ({ d, size = 14 }: { d: string; size?: number }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
);

// ---------------------------------------------------------
//  Inline-math popover for TipTap
// ---------------------------------------------------------

function MathPopover({ onInsert, onClose }: { onInsert: (latex: string) => void; onClose: () => void }) {
  const [latex, setLatex] = useState("");
  const [preview, setPreview] = useState("");
  const [err, setErr] = useState("");

  useEffect(() => {
    (async () => {
      if (!latex.trim()) { setPreview(""); setErr(""); return; }
      try {
        const katex = (await import("katex")).default;
        setPreview(katex.renderToString(latex, { throwOnError: false, displayMode: false }));
        setErr("");
      } catch (e) {
        setErr(String(e));
      }
    })();
  }, [latex]);

  function insert() {
    if (!latex.trim()) return;
    onInsert(latex);
    onClose();
  }

  return (
    <div className="absolute left-0 top-full z-50 mt-1 w-80 rounded-xl border border-white/10 bg-slate-950 p-3 shadow-2xl space-y-2">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-white/40">Insert Inline Math (LaTeX)</p>
      <textarea
        autoFocus
        className="w-full rounded-lg border border-white/10 bg-white/5 px-2 py-1.5 font-mono text-xs text-white focus:outline-none focus:ring-1 focus:ring-purple-400"
        rows={3}
        placeholder="e.g. x^2 + y^2 = r^2"
        value={latex}
        onChange={(e) => setLatex(e.target.value)}
      />
      {err && <p className="text-xs text-rose-300">{err}</p>}
      {preview && !err && (
        <div className="rounded border border-white/10 bg-white/[0.03] px-3 py-2 text-white"
          dangerouslySetInnerHTML={{ __html: preview }} />
      )}
      <div className="flex gap-2">
        <button type="button" onClick={insert} disabled={!latex.trim()}
          className="flex-1 rounded-lg bg-gradient-to-r from-purple-600 to-indigo-600 py-1.5 text-xs font-semibold text-white disabled:opacity-40">
          Insert
        </button>
        <button type="button" onClick={onClose}
          className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-white/60 hover:bg-white/10">
          Cancel
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------
//  Rich-text editor for question text (TipTap)
// ---------------------------------------------------------

function RichQuestionText({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (html: string) => void;
  placeholder: string;
}) {
  const editor = useEditor({
    extensions: [StarterKit, Underline, MathInline],
    content: value || "",
    immediatelyRender: false,
    onUpdate({ editor }) {
      const html = editor.getHTML();
      onChange(html === "<p></p>" ? "" : html);
    },
    editorProps: {
      attributes: {
        class: "qe-prose min-h-[90px] w-full px-3 py-2 text-sm focus:outline-none",
        "data-placeholder": placeholder,
      },
    },
  });

  const [showMath, setShowMath] = useState(false);
  const mathBtnRef = useRef<HTMLButtonElement>(null);

  // Insert an inline math node into TipTap using the MathInline custom node
  function insertMath(latex: string) {
    if (!editor || !latex.trim()) return;
    editor.chain().focus().insertContent({
      type: "mathInline",
      attrs: { latex },
    }).run();
    onChange(editor.getHTML());
  }

  // Sync external value changes (e.g. when switching between editing different questions)
  useEffect(() => {
    if (editor && value !== undefined && editor.getHTML() !== value) {
      editor.commands.setContent(value || "", { emitUpdate: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, editor]);

  if (!editor) {
    return (
      <div className="auth-input min-h-[120px] w-full rounded-lg px-3 py-2 text-sm text-white/30">
        {placeholder}
      </div>
    );
  }

  const btn = (action: () => boolean, label: React.ReactNode, active: boolean, title: string) => (
    <button
      key={title}
      type="button"
      title={title}
      onMouseDown={(e) => { e.preventDefault(); action(); }}
      className={`flex h-7 min-w-[28px] items-center justify-center rounded px-1.5 text-xs font-semibold transition ${
        active
          ? "bg-indigo-500/30 text-indigo-100 ring-1 ring-indigo-400/40"
          : "text-white/60 hover:bg-white/10 hover:text-white"
      }`}
    >{label}</button>
  );

  return (
    <div className="qe-editor rounded-lg border border-white/10 bg-slate-950/40">
      <div className="flex flex-wrap items-center gap-1 border-b border-white/5 px-2 py-1">
        {btn(() => editor.chain().focus().toggleBold().run(),       <span className="font-bold">B</span>,        editor.isActive("bold"),      "Bold")}
        {btn(() => editor.chain().focus().toggleItalic().run(),     <span className="italic">I</span>,           editor.isActive("italic"),    "Italic")}
        {btn(() => editor.chain().focus().toggleUnderline().run(),  <span className="underline">U</span>,         editor.isActive("underline"), "Underline")}
        {btn(() => editor.chain().focus().toggleStrike().run(),     <span className="line-through">S</span>,      editor.isActive("strike"),    "Strikethrough")}
        <span className="mx-1 h-4 w-px bg-white/10" />
        {btn(() => editor.chain().focus().toggleHeading({ level: 2 }).run(), "H2", editor.isActive("heading", { level: 2 }), "Heading 2")}
        {btn(() => editor.chain().focus().toggleHeading({ level: 3 }).run(), "H3", editor.isActive("heading", { level: 3 }), "Heading 3")}
        <span className="mx-1 h-4 w-px bg-white/10" />
        {btn(() => editor.chain().focus().toggleBulletList().run(),  "• List",  editor.isActive("bulletList"),  "Bullet list")}
        {btn(() => editor.chain().focus().toggleOrderedList().run(), "1. List", editor.isActive("orderedList"), "Numbered list")}
        {btn(() => editor.chain().focus().toggleBlockquote().run(),  "❝",       editor.isActive("blockquote"),   "Quote")}
        {btn(() => editor.chain().focus().toggleCode().run(),         <span className="font-mono">{"<>"}</span>, editor.isActive("code"), "Inline code")}
        <span className="mx-1 h-4 w-px bg-white/10" />
        {/* ── Inline math button ── */}
        <div className="relative">
          <button
            ref={mathBtnRef}
            type="button"
            title="Insert inline math (LaTeX)"
            onMouseDown={(e) => { e.preventDefault(); setShowMath((v) => !v); }}
            className={`flex h-7 items-center gap-1 rounded px-2 text-xs font-bold transition ${
              showMath
                ? "bg-purple-500/30 text-purple-100 ring-1 ring-purple-400/40"
                : "text-purple-300 hover:bg-purple-500/15 hover:text-purple-200"
            }`}
          >
            ∑ Math
          </button>
          {showMath && (
            <MathPopover
              onInsert={(latex) => {
                insertMath(latex);
                setShowMath(false);
              }}
              onClose={() => setShowMath(false)}
            />
          )}
        </div>
      </div>
      <EditorContent editor={editor} />
    </div>
  );
}

// ---------------------------------------------------------
//  Per-block wrapper (with delete + move controls)
// ---------------------------------------------------------

const BLOCK_META: Record<BlockType, { label: string; pathD: string; tone: string }> = {
  image: { label: "Image", pathD: "M4 5a2 2 0 012-2h12a2 2 0 012 2v14a2 2 0 01-2 2H6a2 2 0 01-2-2V5zm12 4a2 2 0 11-4 0 2 2 0 014 0zm-1 7l-3-3-2 2-3-3-3 4h14l-3-2z", tone: "bg-pink-500/15 text-pink-300 border-pink-500/30" },
  audio: { label: "Audio", pathD: "M9 19V6l12-3v13M9 19a3 3 0 11-6 0 3 3 0 016 0zm12-3a3 3 0 11-6 0 3 3 0 016 0z", tone: "bg-amber-500/15 text-amber-300 border-amber-500/30" },
  code:  { label: "Code",  pathD: "M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4", tone: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30" },
  table: { label: "Table", pathD: "M3 10h18M3 14h18M3 6h18M3 18h18M7 3v18M17 3v18", tone: "bg-blue-500/15 text-blue-300 border-blue-500/30" },
  latex: { label: "LaTeX", pathD: "M4 6h16M6 6v12m12-12v12M9 12h6", tone: "bg-purple-500/15 text-purple-300 border-purple-500/30" },
};

function AttachedBlock({
  block,
  index,
  total,
  onChange,
  onDelete,
  onMove,
}: {
  block: Block;
  index: number;
  total: number;
  onChange: (b: Block) => void;
  onDelete: () => void;
  onMove: (delta: -1 | 1) => void;
}) {
  const meta = BLOCK_META[block.type as Exclude<BlockType, never>] || BLOCK_META.image;
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
      <div className="mb-2 flex items-center gap-2">
        <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${meta.tone}`}>
          <Svg d={meta.pathD} size={10} />
          {meta.label}
        </span>
        <span className="text-[10px] text-white/30">Block #{index + 1}</span>
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={() => onMove(-1)}
            disabled={index === 0}
            title="Move up"
            className="rounded-md border border-white/10 bg-white/5 px-1.5 py-0.5 text-xs text-white/60 transition hover:bg-white/10 disabled:opacity-30"
          >↑</button>
          <button
            type="button"
            onClick={() => onMove(1)}
            disabled={index === total - 1}
            title="Move down"
            className="rounded-md border border-white/10 bg-white/5 px-1.5 py-0.5 text-xs text-white/60 transition hover:bg-white/10 disabled:opacity-30"
          >↓</button>
          <button
            type="button"
            onClick={onDelete}
            title="Remove block"
            className="rounded-md border border-white/10 bg-white/5 px-2 py-0.5 text-xs text-rose-300 transition hover:bg-rose-500/15"
          >Remove</button>
        </div>
      </div>
      {block.type === "image" && <ImageBlock block={block} onChange={onChange} />}
      {block.type === "audio" && <AudioBlock block={block} onChange={onChange} />}
      {block.type === "code"  && <CodeBlock  block={block} onChange={onChange} />}
      {block.type === "table" && <TableBlock block={block} onChange={onChange} />}
      {block.type === "latex" && <LatexBlock block={block} onChange={onChange} />}
    </div>
  );
}

// ---------------------------------------------------------
//  Rich MCQ options (text / LaTeX / image per option)
// ---------------------------------------------------------

function RichOptionEditor({
  opt,
  index,
  isCorrect,
  onSelect,
  onChange,
  onRemove,
  canRemove,
}: {
  opt: RichOption;
  index: number;
  isCorrect: boolean;
  onSelect: () => void;
  onChange: (o: RichOption) => void;
  onRemove: () => void;
  canRemove: boolean;
}) {
  const label = String.fromCharCode(65 + index);
  const [uploading, setUploading] = useState(false);
  const [uploadErr, setUploadErr] = useState("");
  const [latexPreview, setLatexPreview] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (opt.displayType !== "latex" || !opt.content) { setLatexPreview(""); return; }
    (async () => {
      try {
        const katex = (await import("katex")).default;
        const html = katex.renderToString(opt.content, { throwOnError: false, displayMode: false });
        setLatexPreview(html);
      } catch { setLatexPreview(""); }
    })();
  }, [opt.content, opt.displayType]);

  async function handleFile(file: File) {
    setUploadErr("");
    if (!["image/jpeg", "image/png"].includes(file.type)) { setUploadErr("Only JPG/PNG"); return; }
    try {
      setUploading(true);
      const { default: compress } = await import("browser-image-compression");
      const compressed = await compress(file, { maxSizeMB: 4.5, maxWidthOrHeight: 1024, useWebWorker: true });
      const fd = new FormData();
      fd.append("file", compressed, file.name);
      const { data } = await api.post("/questions/upload-media", fd, { headers: { "Content-Type": "multipart/form-data" } });
      onChange({ ...opt, url: data.url, value: `Image option ${label}` });
    } catch { setUploadErr("Upload failed"); }
    finally { setUploading(false); }
  }

  return (
    <div className={`rounded-xl border p-3 transition ${isCorrect ? "border-emerald-400/40 bg-emerald-500/5" : "border-white/10 bg-white/[0.02]"}`}>
      <div className="mb-2 flex items-center gap-2">
        {/* Correct-answer radio */}
        <button
          type="button"
          onClick={onSelect}
          title="Mark as correct"
          className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition ${
            isCorrect ? "border-emerald-400 bg-emerald-400/20" : "border-white/20 hover:border-white/40"
          }`}
        >
          {isCorrect && <span className="h-2 w-2 rounded-full bg-emerald-400" />}
        </button>
        <span className="w-5 shrink-0 text-xs font-bold text-white/40">{label}</span>

        {/* Display-type selector */}
        <div className="flex flex-1 gap-1">
          {(["text", "latex", "image"] as const).map((dt) => (
            <button
              key={dt}
              type="button"
              onClick={() => onChange({ ...opt, displayType: dt, content: "", url: "", value: opt.value })}
              className={`rounded px-2 py-0.5 text-[10px] font-semibold transition ${
                opt.displayType === dt
                  ? "bg-indigo-500/25 text-indigo-200"
                  : "text-white/30 hover:bg-white/10 hover:text-white"
              }`}
            >{dt === "text" ? "Text" : dt === "latex" ? "LaTeX" : "Image"}</button>
          ))}
        </div>

        {canRemove && (
          <button type="button" onClick={onRemove}
            className="rounded p-1 text-white/25 hover:text-rose-300"
            title="Remove option">
            <Svg d="M18 6L6 18M6 6l12 12" />
          </button>
        )}
      </div>

      {opt.displayType === "text" && (
        <input
          className="auth-input h-10 w-full rounded-lg px-3 text-sm"
          placeholder={`Option ${label}`}
          value={opt.value}
          onChange={(e) => onChange({ ...opt, value: e.target.value, content: e.target.value })}
        />
      )}

      {opt.displayType === "latex" && (
        <div className="space-y-1.5">
          <div className="flex gap-2">
            <input
              className="auth-input h-9 flex-1 rounded-lg px-3 font-mono text-xs"
              placeholder={`Option ${label} value/label (used for grading)`}
              value={opt.value}
              onChange={(e) => onChange({ ...opt, value: e.target.value })}
            />
          </div>
          <textarea
            className="w-full rounded-lg border border-white/10 bg-slate-950/40 px-2 py-1.5 font-mono text-xs text-white focus:outline-none focus:ring-1 focus:ring-purple-400"
            rows={2}
            placeholder={`LaTeX for option ${label}, e.g. \\frac{a}{b}`}
            value={opt.content}
            onChange={(e) => onChange({ ...opt, content: e.target.value })}
          />
          {latexPreview && (
            <div className="rounded border border-white/10 bg-white/[0.03] px-3 py-1.5 text-sm text-white"
              dangerouslySetInnerHTML={{ __html: latexPreview }} />
          )}
        </div>
      )}

      {opt.displayType === "image" && (
        <div className="space-y-1.5">
          <input
            className="auth-input h-9 w-full rounded-lg px-3 text-xs"
            placeholder={`Option ${label} label/value (used for grading)`}
            value={opt.value}
            onChange={(e) => onChange({ ...opt, value: e.target.value })}
          />
          {opt.url ? (
            <div className="relative inline-block">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={opt.url} alt="" className="max-h-36 rounded border border-white/10" />
              <button
                type="button"
                onClick={() => onChange({ ...opt, url: "" })}
                className="absolute right-1 top-1 h-5 w-5 rounded-full bg-rose-500 text-xs text-white"
              >×</button>
            </div>
          ) : (
            <div className="cursor-pointer rounded-lg border-2 border-dashed border-white/15 bg-white/[0.02] p-4 text-center hover:border-indigo-400/60"
              onClick={() => inputRef.current?.click()}>
              {uploading ? <span className="text-xs text-white/60">Uploading…</span> : (
                <span className="text-xs text-white/50">Click to upload image for this option</span>
              )}
            </div>
          )}
          {uploadErr && <p className="text-xs text-rose-300">{uploadErr}</p>}
          <input ref={inputRef} type="file" accept="image/jpeg,image/png" className="hidden"
            onChange={(e) => { if (e.target.files?.[0]) handleFile(e.target.files[0]); }} />
        </div>
      )}
    </div>
  );
}

function RichMCQOptions({
  richOptions,
  correctId,
  onChangeOptions,
  onSelectCorrect,
}: {
  richOptions: RichOption[];
  correctId: string;
  onChangeOptions: (opts: RichOption[]) => void;
  onSelectCorrect: (valueOrId: string) => void;
}) {
  return (
    <div className="space-y-2">
      <label className="text-[10px] font-semibold uppercase tracking-wider text-white/50">Answer Choices</label>
      <p className="text-xs text-white/40">Click the radio to mark the correct answer. Each option can be text, LaTeX, or an image.</p>
      {richOptions.map((opt, i) => (
        <RichOptionEditor
          key={opt.id}
          opt={opt}
          index={i}
          isCorrect={!!(correctId && correctId === opt.value)}
          onSelect={() => onSelectCorrect(opt.value)}
          onChange={(updated) => {
            const next = [...richOptions];
            next[i] = updated;
            onChangeOptions(next);
          }}
          onRemove={() => onChangeOptions(richOptions.filter((_, idx) => idx !== i))}
          canRemove={richOptions.length > 2}
        />
      ))}
      {richOptions.length < 6 && (
        <button type="button" onClick={() => onChangeOptions([...richOptions, emptyRichOption()])}
          className="text-xs text-white/50 hover:text-white">+ Add another option</button>
      )}
    </div>
  );
}

// ---------------------------------------------------------
//  MAIN
// ---------------------------------------------------------

export function QuestionEditor({
  initial,
  onSave,
  onCancel,
  saveLabel = "Save",
  lockedType = false,
}: QuestionEditorProps) {
  const [form, setForm] = useState<QuestionFormValue>(() => questionToForm(initial));
  const [error, setError] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    setForm(questionToForm(initial));
    setError("");
  }, [initial]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const { payload, error: err } = formToPayload(form);
    if (err || !payload) {
      setError(err || "Invalid form");
      return;
    }
    setIsSaving(true);
    try {
      await onSave(payload);
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message;
      setError(msg || "Save failed");
    } finally {
      setIsSaving(false);
    }
  }

  function changeType(t: QuestionType) {
    setForm({
      ...form,
      type: t,
      correctAnswerStr: "",
      fillInBlankType: "text",
      acceptedAnswers: [""],
      caseSensitive: false,
      richOptions: [emptyRichOption(), emptyRichOption(), emptyRichOption(), emptyRichOption()],
      templateFill: null,
    });
  }

  function insertBlock(type: BlockType) {
    setForm({ ...form, blocks: [...form.blocks, defaultBlock(type)] });
  }

  function updateBlock(id: string, updated: Block) {
    setForm({ ...form, blocks: form.blocks.map((b) => (b.id === id ? updated : b)) });
  }

  function deleteBlock(id: string) {
    setForm({ ...form, blocks: form.blocks.filter((b) => b.id !== id) });
  }

  function moveBlock(id: string, delta: -1 | 1) {
    const idx = form.blocks.findIndex((b) => b.id === id);
    if (idx < 0) return;
    const target = idx + delta;
    if (target < 0 || target >= form.blocks.length) return;
    const next = [...form.blocks];
    [next[idx], next[target]] = [next[target], next[idx]];
    setForm({ ...form, blocks: next });
  }

  const insertButtons: { type: BlockType; label: string; pathD: string }[] = [
    { type: "image", label: "Image", pathD: BLOCK_META.image.pathD },
    { type: "audio", label: "Audio", pathD: BLOCK_META.audio.pathD },
    { type: "table", label: "Table", pathD: BLOCK_META.table.pathD },
    { type: "code",  label: "Code",  pathD: BLOCK_META.code.pathD  },
    { type: "latex", label: "LaTeX", pathD: BLOCK_META.latex.pathD },
  ];

  const isMultiBlank = form.type === "MULTI_BLANK_EQUATION";
  const isTemplateFill = form.type === "TEMPLATE_FILL";

  return (
    <form onSubmit={handleSubmit} className="space-y-4 rounded-xl border border-white/10 bg-slate-950/40 p-4">
      {/* Type + Points */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="space-y-1.5 md:col-span-2">
          <label className="text-[10px] font-semibold uppercase tracking-wider text-white/50">Type</label>
          {lockedType ? (
            <div className={`inline-flex h-10 items-center gap-2 rounded-lg border px-3 text-sm font-medium ${QTYPE_TONE[form.type]}`}>
              {QTYPE_LABEL[form.type]}
            </div>
          ) : (
            <select
              className="auth-input h-11 w-full rounded-lg px-3 text-sm"
              value={form.type}
              onChange={(e) => changeType(e.target.value as QuestionType)}
            >
              <option value="MCQ" className="bg-slate-900">Multiple Choice</option>
              <option value="TRUE_FALSE" className="bg-slate-900">True / False</option>
              <option value="FILL_IN_BLANK" className="bg-slate-900">Fill in the Blank</option>
              <option value="MULTI_BLANK_EQUATION" className="bg-slate-900">Multi-Blank Equation</option>
              <option value="TEMPLATE_FILL" className="bg-slate-900">Template Fill (text / math / matrix / table / diagram)</option>
            </select>
          )}
        </div>
        <div className="space-y-1.5">
          <label className="text-[10px] font-semibold uppercase tracking-wider text-white/50">Points</label>
          <input
            type="number"
            step="any"
            className="auth-input h-11 w-full rounded-lg px-3 text-sm"
            value={form.marks}
            onChange={(e) => setForm({ ...form, marks: parseFloat(e.target.value) || 0 })}
            required
          />
          <p className="text-[10px] text-white/30">Any value allowed (e.g. 0, 0.5, 5, 10)</p>
        </div>
      </div>

      {/* Question text — rich or plain (hidden for TEMPLATE_FILL which has its own editor) */}
      {!isTemplateFill && <div className="space-y-1.5">
        <label className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-white/50">
          <span>Question Text</span>
          {isMultiBlank && (
            <span className="ml-2 normal-case text-white/40">
              — use <code className="rounded bg-white/10 px-1">___</code> for each blank
            </span>
          )}
        </label>

        {isMultiBlank ? (
          <textarea
            className="auth-input min-h-[90px] w-full rounded-lg px-3 py-2 text-sm"
            value={form.text}
            onChange={(e) => setForm({ ...form, text: e.target.value })}
            placeholder='e.g. "SELECT ___ FROM users WHERE id = ___"'
            required
          />
        ) : (
          <RichQuestionText
            value={form.text}
            onChange={(html) => setForm({ ...form, text: html })}
            placeholder="Enter the question. You can format text using the toolbar above."
          />
        )}
      </div>}

      {/* Insert media toolbar */}
      <div className="rounded-lg border border-dashed border-white/10 bg-white/[0.02] p-3">
        <div className="mb-2 flex items-center gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-white/50">Insert into question</span>
          <span className="text-[10px] text-white/30">— attach rich media blocks</span>
        </div>
        <div className="flex flex-wrap gap-2">
          {insertButtons.map((b) => (
            <button
              key={b.type}
              type="button"
              onClick={() => insertBlock(b.type)}
              className="group flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-white/70 transition hover:border-indigo-400/40 hover:bg-indigo-500/15 hover:text-indigo-100"
            >
              <Svg d={b.pathD} size={13} />
              <span>{b.label}</span>
              <span className="text-white/30 group-hover:text-indigo-300">+</span>
            </button>
          ))}
        </div>
      </div>

      {/* Attached blocks list */}
      {form.blocks.length > 0 && (
        <div className="space-y-3">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-white/50">
            Attached Blocks ({form.blocks.length})
          </div>
          {form.blocks.map((b, i) => (
            <AttachedBlock
              key={b.id}
              block={b}
              index={i}
              total={form.blocks.length}
              onChange={(updated) => updateBlock(b.id, updated)}
              onDelete={() => deleteBlock(b.id)}
              onMove={(delta) => moveBlock(b.id, delta)}
            />
          ))}
        </div>
      )}

      {/* MCQ options — supports text, LaTeX, and image options */}
      {form.type === "MCQ" && (
        <RichMCQOptions
          richOptions={form.richOptions}
          correctId={form.correctAnswerStr}
          onChangeOptions={(richOptions) => setForm({ ...form, richOptions, options: richOptions.map((o) => o.value) })}
          onSelectCorrect={(id) => setForm({ ...form, correctAnswerStr: id })}
        />
      )}

      {/* True / False */}
      {form.type === "TRUE_FALSE" && (
        <div className="space-y-1.5">
          <label className="text-[10px] font-semibold uppercase tracking-wider text-white/50">Correct Answer</label>
          <div className="grid grid-cols-2 gap-2">
            {["true", "false"].map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setForm({ ...form, correctAnswerStr: v })}
                className={`h-12 rounded-lg border text-sm font-semibold capitalize transition ${
                  form.correctAnswerStr === v
                    ? "border-emerald-400/50 bg-emerald-500/15 text-emerald-200"
                    : "border-white/10 bg-white/[0.02] text-white/60 hover:bg-white/5"
                }`}
              >
                {v}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Fill in the Blank */}
      {form.type === "FILL_IN_BLANK" && (
        <div className="space-y-3">
          <div className="space-y-1.5">
            <label className="text-[10px] font-semibold uppercase tracking-wider text-white/50">Student Input Type</label>
            <div className="flex gap-2">
              {(["text", "dropdown"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setForm({ ...form, fillInBlankType: t, correctAnswerStr: "" })}
                  className={`flex flex-1 items-center justify-center gap-2 rounded-lg border py-2.5 text-xs font-semibold transition ${
                    form.fillInBlankType === t
                      ? "border-indigo-400/50 bg-indigo-500/15 text-indigo-200"
                      : "border-white/10 bg-white/[0.02] text-white/50 hover:bg-white/5"
                  }`}
                >
                  {t === "text" ? (
                    <>
                      <Svg d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5" />
                      Type in box
                    </>
                  ) : (
                    <>
                      <Svg d="M19 9l-7 7-7-7" />
                      Select from dropdown
                    </>
                  )}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-white/30">
              {form.fillInBlankType === "dropdown"
                ? "Students pick from a list of options you define."
                : "Students type their answer into a text box."}
            </p>
          </div>

          {form.fillInBlankType === "dropdown" ? (
            <div className="space-y-2">
              <label className="text-[10px] font-semibold uppercase tracking-wider text-white/50">Dropdown Options</label>
              <p className="text-xs text-white/40">Click the radio to mark the correct option.</p>
              {form.dropdownOptions.map((opt, i) => (
                <div key={i} className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => opt && setForm({ ...form, correctAnswerStr: opt })}
                    className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition ${
                      opt && form.correctAnswerStr === opt
                        ? "border-emerald-400 bg-emerald-400/20"
                        : "border-white/20 hover:border-white/40"
                    }`}
                  >
                    {opt && form.correctAnswerStr === opt && (
                      <span className="h-2 w-2 rounded-full bg-emerald-400" />
                    )}
                  </button>
                  <input
                    className="auth-input h-10 flex-1 rounded-lg px-3 text-sm"
                    placeholder={`Option ${i + 1}`}
                    value={opt}
                    onChange={(e) => {
                      const opts = [...form.dropdownOptions];
                      const old = opts[i];
                      opts[i] = e.target.value;
                      const nextCorrect = form.correctAnswerStr === old ? e.target.value : form.correctAnswerStr;
                      setForm({ ...form, dropdownOptions: opts, correctAnswerStr: nextCorrect });
                    }}
                  />
                  {form.dropdownOptions.length > 2 && (
                    <button
                      type="button"
                      onClick={() => {
                        const opts = form.dropdownOptions.filter((_, idx) => idx !== i);
                        const nextCorrect = form.correctAnswerStr === opt ? "" : form.correctAnswerStr;
                        setForm({ ...form, dropdownOptions: opts, correctAnswerStr: nextCorrect });
                      }}
                      className="shrink-0 rounded-md border border-white/10 bg-white/5 p-1.5 text-white/40 hover:bg-rose-500/15 hover:text-rose-300"
                    >
                      <Svg d="M18 6L6 18M6 6l12 12" />
                    </button>
                  )}
                </div>
              ))}
              {form.dropdownOptions.length < 8 && (
                <button
                  type="button"
                  onClick={() => setForm({ ...form, dropdownOptions: [...form.dropdownOptions, ""] })}
                  className="text-xs text-white/50 hover:text-white"
                >
                  + Add option
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-[10px] font-semibold uppercase tracking-wider text-white/50">
                    Accepted Answers
                  </label>
                  <span className="text-[10px] text-white/30">Any one of these will be marked correct</span>
                </div>
                {form.acceptedAnswers.map((ans, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-blue-500/15 text-[10px] font-bold text-blue-300">
                      {i + 1}
                    </span>
                    <input
                      className="auth-input h-10 flex-1 rounded-lg px-3 text-sm"
                      placeholder={i === 0 ? "Primary answer…" : `Alternative answer ${i + 1}…`}
                      value={ans}
                      onChange={(e) => {
                        const next = [...form.acceptedAnswers];
                        next[i] = e.target.value;
                        setForm({ ...form, acceptedAnswers: next });
                      }}
                    />
                    {form.acceptedAnswers.length > 1 && (
                      <button
                        type="button"
                        onClick={() => setForm({ ...form, acceptedAnswers: form.acceptedAnswers.filter((_, idx) => idx !== i) })}
                        className="shrink-0 rounded-md border border-white/10 bg-white/5 p-1.5 text-white/40 hover:bg-rose-500/15 hover:text-rose-300"
                        title="Remove this answer"
                      >
                        <Svg d="M18 6L6 18M6 6l12 12" />
                      </button>
                    )}
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => setForm({ ...form, acceptedAnswers: [...form.acceptedAnswers, ""] })}
                  className="text-xs text-white/50 hover:text-white transition"
                >
                  + Add alternative answer
                </button>
              </div>

              {/* Case sensitivity toggle */}
              <label className="flex cursor-pointer items-center justify-between rounded-lg border border-white/8 bg-white/[0.02] p-3 transition hover:bg-white/[0.04]">
                <div className="space-y-0.5">
                  <p className="text-xs font-medium text-white/70">Case sensitive matching</p>
                  <p className="text-[11px] text-white/35">
                    {form.caseSensitive
                      ? '"Paris" and "paris" would be marked differently'
                      : '"Paris" and "paris" are treated as the same answer'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setForm({ ...form, caseSensitive: !form.caseSensitive })}
                  className={`relative ml-4 h-6 w-10 shrink-0 rounded-full border transition-colors ${
                    form.caseSensitive ? "border-indigo-400/50 bg-indigo-500/30" : "border-white/15 bg-white/10"
                  }`}
                >
                  <span className={`absolute top-0.5 h-5 w-5 rounded-full shadow transition-transform ${
                    form.caseSensitive ? "translate-x-4 bg-indigo-400" : "translate-x-0.5 bg-white/40"
                  }`} />
                </button>
              </label>
            </div>
          )}
        </div>
      )}

      {/* Multi-blank equation */}
      {form.type === "MULTI_BLANK_EQUATION" && (
        <div className="space-y-2">
          <label className="text-[10px] font-semibold uppercase tracking-wider text-white/50">Blank Answers (in order)</label>
          {form.blanks.map((b, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-purple-500/15 text-xs font-bold text-purple-300">
                #{i + 1}
              </span>
              <input
                className="auth-input h-10 flex-1 rounded-lg px-3 text-sm"
                placeholder={`Answer for blank ${i + 1}`}
                value={b}
                onChange={(e) => {
                  const blanks = [...form.blanks];
                  blanks[i] = e.target.value;
                  setForm({ ...form, blanks });
                }}
                required
              />
              {form.blanks.length > 1 && (
                <button
                  type="button"
                  onClick={() => setForm({ ...form, blanks: form.blanks.filter((_, idx) => idx !== i) })}
                  className="shrink-0 rounded-md border border-white/10 bg-white/5 p-1.5 text-white/40 hover:bg-rose-500/15 hover:text-rose-300"
                >
                  <Svg d="M18 6L6 18M6 6l12 12" />
                </button>
              )}
            </div>
          ))}
          <button
            type="button"
            onClick={() => setForm({ ...form, blanks: [...form.blanks, ""] })}
            className="text-xs text-white/50 hover:text-white"
          >
            + Add blank
          </button>
        </div>
      )}

      {/* Template Fill */}
      {form.type === "TEMPLATE_FILL" && (
        <TemplateFillCreator
          value={form.templateFill}
          onChange={(v) => setForm({ ...form, templateFill: v })}
        />
      )}

      {error && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-200">{error}</div>
      )}

      <div className="flex items-center justify-end gap-2 border-t border-white/5 pt-3">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-white/10 bg-white/5 px-4 py-2 text-xs font-medium text-white/70 transition hover:bg-white/10"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={isSaving}
          className="rounded-md bg-gradient-to-r from-indigo-500 to-purple-500 px-4 py-2 text-xs font-semibold text-white transition hover:shadow-lg hover:shadow-purple-500/30 disabled:opacity-60"
        >
          {isSaving ? "Saving..." : saveLabel}
        </button>
      </div>
    </form>
  );
}
