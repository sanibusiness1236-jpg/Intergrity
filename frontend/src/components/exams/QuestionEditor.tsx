"use client";

import { useEffect, useState } from "react";
import type { Question, QuestionType } from "@/types";

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
  text: string;
  options: string[];
  correctAnswerStr: string;
  blanks: string[];
  marks: number;
  fillInBlankType: "text" | "dropdown";
  dropdownOptions: string[];
}

export function questionToForm(q: Partial<Question>): QuestionFormValue {
  const fibType = (q as any).fillInBlankType === "dropdown" ? "dropdown" : "text";
  const existingDropdown =
    fibType === "dropdown" && Array.isArray(q.options) ? [...(q.options as string[])] : ["", "", ""];

  return {
    type: (q.type as QuestionType) || "MCQ",
    text: q.text || "",
    options: q.type === "MCQ" && Array.isArray(q.options) ? [...(q.options as string[])] : ["", "", "", ""],
    correctAnswerStr:
      q.type === "MCQ" || q.type === "TRUE_FALSE" || q.type === "FILL_IN_BLANK"
        ? String(q.correctAnswer ?? "")
        : "",
    blanks:
      q.type === "MULTI_BLANK_EQUATION" && Array.isArray(q.correctAnswer)
        ? [...(q.correctAnswer as string[])]
        : ["", ""],
    marks: q.marks ?? 1,
    fillInBlankType: fibType,
    dropdownOptions: existingDropdown,
  };
}

export function formToPayload(form: QuestionFormValue): {
  payload: Partial<Question> | null;
  error: string | null;
} {
  if (!form.text.trim()) return { payload: null, error: "Question text is required" };
  if (form.marks <= 0) return { payload: null, error: "Marks must be greater than 0" };

  if (form.type === "MCQ") {
    const opts = form.options.map((o) => o.trim()).filter(Boolean);
    if (opts.length < 2) return { payload: null, error: "MCQ needs at least 2 options" };
    if (!opts.includes(form.correctAnswerStr)) {
      return { payload: null, error: "Select which option is correct" };
    }
    return {
      payload: { type: "MCQ", text: form.text, options: opts, correctAnswer: form.correctAnswerStr, marks: form.marks },
      error: null,
    };
  }

  if (form.type === "TRUE_FALSE") {
    if (form.correctAnswerStr !== "true" && form.correctAnswerStr !== "false") {
      return { payload: null, error: "Pick True or False" };
    }
    return {
      payload: { type: "TRUE_FALSE", text: form.text, correctAnswer: form.correctAnswerStr, marks: form.marks },
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
        } as any,
        error: null,
      };
    }
    if (!form.correctAnswerStr.trim()) return { payload: null, error: "Provide the expected answer" };
    return {
      payload: {
        type: "FILL_IN_BLANK",
        text: form.text,
        correctAnswer: form.correctAnswerStr.trim(),
        marks: form.marks,
        fillInBlankType: "text",
      } as any,
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
      payload: { type: "MULTI_BLANK_EQUATION", text: form.text, correctAnswer: blanks, marks: form.marks },
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
    } catch (e: any) {
      setError(e.response?.data?.error?.message || "Save failed");
    } finally {
      setIsSaving(false);
    }
  }

  function changeType(t: QuestionType) {
    setForm({ ...form, type: t, correctAnswerStr: "", fillInBlankType: "text" });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 rounded-xl border border-white/10 bg-slate-950/40 p-4">
      {/* Type + Points row */}
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
            min={0.25}
            step={0.25}
            className="auth-input h-11 w-full rounded-lg px-3 text-sm"
            value={form.marks}
            onChange={(e) => setForm({ ...form, marks: parseFloat(e.target.value) || 0.25 })}
            required
          />
          <p className="text-[10px] text-white/30">Decimals allowed (e.g. 0.5, 1.5)</p>
        </div>
      </div>

      {/* Question text */}
      <div className="space-y-1.5">
        <label className="text-[10px] font-semibold uppercase tracking-wider text-white/50">
          Question Text
          {form.type === "MULTI_BLANK_EQUATION" && (
            <span className="ml-2 normal-case text-white/40">
              — use <code className="rounded bg-white/10 px-1">___</code> for each blank
            </span>
          )}
        </label>
        <textarea
          className="auth-input min-h-[90px] w-full rounded-lg px-3 py-2 text-sm"
          value={form.text}
          onChange={(e) => setForm({ ...form, text: e.target.value })}
          placeholder={
            form.type === "MULTI_BLANK_EQUATION"
              ? 'e.g. "SELECT ___ FROM users WHERE id = ___"'
              : "Enter the question..."
          }
          required
        />
      </div>

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
          {/* Input type toggle */}
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

          {/* Dropdown options + correct answer */}
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
                      className="shrink-0 rounded-md border border-white/10 bg-white/5 p-1.5 text-white/40 hover:bg-rose-500/15 hover:text-rosese-300"
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
            <div className="space-y-1.5">
              <label className="text-[10px] font-semibold uppercase tracking-wider text-white/50">Expected Answer</label>
              <input
                className="auth-input h-11 w-full rounded-lg px-3 text-sm"
                value={form.correctAnswerStr}
                onChange={(e) => setForm({ ...form, correctAnswerStr: e.target.value })}
                placeholder="What's the correct answer?"
                required
              />
              <p className="text-xs text-white/40">Matching is case-insensitive.</p>
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
