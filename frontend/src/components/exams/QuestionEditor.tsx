"use client";

import { useEffect, useState } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
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

export const QTYPE_LABEL: Record<QuestionType, string> = {
  MCQ: "Multiple Choice",
  TRUE_FALSE: "True / False",
  FILL_IN_BLANK: "Fill in the Blank",
  MULTI_BLANK_EQUATION: "Multi-Blank Equation",
};

export const QTYPE_TONE: Record<QuestionType, string> = {
  MCQ: "bg-indigo-500/15 text-indigo-300 border-indigo-500/30",
  TRUE_FALSE: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  FILL_IN_BLANK: "bg-blue-500/15 text-blue-300 border-blue-500/30",
  MULTI_BLANK_EQUATION: "bg-purple-500/15 text-purple-300 border-purple-500/30",
};

export const QTYPE_ICON: Record<QuestionType, string> = {
  MCQ: "M9 11l3 3L22 4M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11",
  TRUE_FALSE: "M9 12l2 2 4-4M12 2a10 10 0 100 20 10 10 0 000-20z",
  FILL_IN_BLANK: "M3 6h18M3 12h18M3 18h12",
  MULTI_BLANK_EQUATION: "M7 8h10M7 12h4m0 4h6m-3-12v16",
};

export interface QuestionFormValue {
  type: QuestionType;
  text: string;            // HTML (for non-multi-blank) or plain text (for multi-blank)
  options: string[];
  correctAnswerStr: string;
  blanks: string[];
  marks: number;
  fillInBlankType: "text" | "dropdown";
  dropdownOptions: string[];
  acceptedAnswers: string[];   // FILL_IN_BLANK text-type: list of accepted answers
  caseSensitive: boolean;      // FILL_IN_BLANK text-type: case-sensitive matching
  blocks: Block[];
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

  return {
    type: (q.type as QuestionType) || "MCQ",
    text: q.text || "",
    options: q.type === "MCQ" && Array.isArray(q.options) ? [...(q.options as string[])] : ["", "", "", ""],
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
  const blocks = form.blocks.length > 0 ? form.blocks : undefined;

  // Text is only required when there are no blocks to carry the question content
  const textEmpty = isMultiBlank ? !form.text.trim() : isHtmlEmpty(form.text);
  if (textEmpty && !blocks) return { payload: null, error: "Question text is required (or add at least one content block)" };
  if (isNaN(form.marks)) return { payload: null, error: "Marks must be a number" };

  if (form.type === "MCQ") {
    const opts = form.options.map((o) => o.trim()).filter(Boolean);
    if (opts.length < 2) return { payload: null, error: "MCQ needs at least 2 options" };
    if (!opts.includes(form.correctAnswerStr)) {
      return { payload: null, error: "Select which option is correct" };
    }
    return {
      payload: { type: "MCQ", text: form.text, options: opts, correctAnswer: form.correctAnswerStr, marks: form.marks, blocks } as Partial<Question>,
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
    extensions: [StarterKit, Underline],
    content: value || "",
    immediatelyRender: false,
    onUpdate({ editor }) {
      const html = editor.getHTML();
      // tiptap returns "<p></p>" for an empty editor — normalize to empty
      onChange(html === "<p></p>" ? "" : html);
    },
    editorProps: {
      attributes: {
        class: "qe-prose min-h-[90px] w-full px-3 py-2 text-sm focus:outline-none",
        "data-placeholder": placeholder,
      },
    },
  });

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
    setForm({ ...form, type: t, correctAnswerStr: "", fillInBlankType: "text", acceptedAnswers: [""], caseSensitive: false });
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

      {/* Question text — rich or plain */}
      <div className="space-y-1.5">
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
      </div>

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

      {/* MCQ options */}
      {form.type === "MCQ" && (
        <div className="space-y-2">
          <label className="text-[10px] font-semibold uppercase tracking-wider text-white/50">Answer Choices</label>
          <p className="text-xs text-white/40">Click the radio button next to the correct answer.</p>
          {form.options.map((opt, i) => (
            <div key={i} className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => opt && setForm({ ...form, correctAnswerStr: opt })}
                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition ${
                  opt && form.correctAnswerStr === opt
                    ? "border-emerald-400 bg-emerald-400/20"
                    : "border-white/20 hover:border-white/40"
                }`}
                title={opt ? "Mark as correct" : "Type an option first"}
              >
                {opt && form.correctAnswerStr === opt && (
                  <span className="h-2 w-2 rounded-full bg-emerald-400" />
                )}
              </button>
              <span className="w-5 shrink-0 text-xs font-bold text-white/40">{String.fromCharCode(65 + i)}</span>
              <input
                className="auth-input h-10 flex-1 rounded-lg px-3 text-sm"
                placeholder={`Option ${String.fromCharCode(65 + i)}`}
                value={opt}
                onChange={(e) => {
                  const opts = [...form.options];
                  const old = opts[i];
                  opts[i] = e.target.value;
                  const nextCorrect = form.correctAnswerStr === old ? e.target.value : form.correctAnswerStr;
                  setForm({ ...form, options: opts, correctAnswerStr: nextCorrect });
                }}
              />
              {form.options.length > 2 && (
                <button
                  type="button"
                  onClick={() => {
                    const opts = form.options.filter((_, idx) => idx !== i);
                    const nextCorrect = form.correctAnswerStr === opt ? "" : form.correctAnswerStr;
                    setForm({ ...form, options: opts, correctAnswerStr: nextCorrect });
                  }}
                  className="shrink-0 rounded-md border border-white/10 bg-white/5 p-1.5 text-white/40 hover:bg-rose-500/15 hover:text-rose-300"
                  title="Remove option"
                >
                  <Svg d="M18 6L6 18M6 6l12 12" />
                </button>
              )}
            </div>
          ))}
          {form.options.length < 6 && (
            <button
              type="button"
              onClick={() => setForm({ ...form, options: [...form.options, ""] })}
              className="text-xs text-white/50 hover:text-white"
            >
              + Add another option
            </button>
          )}
        </div>
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
