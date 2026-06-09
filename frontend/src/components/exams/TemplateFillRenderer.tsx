"use client";

/**
 * TemplateFillRenderer — renders a TEMPLATE_FILL question for the student.
 *
 * For each blank (BLANK_1, BLANK_2 …) the student sees an input field.
 * The answer state is a Record<blankId, string> stored in `answers[q.id]`.
 */

import { useEffect, useState } from "react";
import type { TemplateConfig } from "./TemplateFillCreator";

type Answers = Record<string, string>;

interface Props {
  config: TemplateConfig;
  value: Answers;
  onChange: (next: Answers) => void;
  readonly?: boolean;
}

// ─── Shared: small inline input ──────────────────────────────────────────────

function BlankInput({
  blankId,
  value,
  onChange,
  readonly,
  width = 120,
}: {
  blankId: string;
  value: string;
  onChange: (v: string) => void;
  readonly?: boolean;
  width?: number;
}) {
  const num = blankId.replace("BLANK_", "");
  return (
    <span className="inline-flex items-center align-middle">
      {readonly ? (
        <span className="inline-flex h-8 min-w-[4rem] items-center justify-center rounded border border-purple-400/40 bg-purple-500/10 px-2 font-mono text-sm text-purple-200">
          {value || <span className="text-white/25">({blankId})</span>}
        </span>
      ) : (
        <input
          type="text"
          aria-label={blankId}
          placeholder={`[${num}]`}
          value={value}
          style={{ width }}
          onChange={(e) => onChange(e.target.value)}
          className="inline-block h-9 min-w-[3rem] rounded-lg border-2 border-purple-400/40 bg-purple-500/5 px-2 text-center font-mono text-sm text-purple-200 focus:border-purple-400 focus:outline-none"
        />
      )}
    </span>
  );
}

// ─── Text renderer ───────────────────────────────────────────────────────────

function TextRenderer({ config, value, onChange, readonly }: Props) {
  const content = config.content || "";
  // Split on BLANK_N tokens
  const parts = content.split(/(BLANK_\d+)/g);

  return (
    <div className="text-base leading-loose text-white">
      {parts.map((part, i) => {
        if (/^BLANK_\d+$/.test(part)) {
          return (
            <BlankInput
              key={i}
              blankId={part}
              value={value[part] || ""}
              onChange={(v) => onChange({ ...value, [part]: v })}
              readonly={readonly}
            />
          );
        }
        return <span key={i}>{part}</span>;
      })}
    </div>
  );
}

// ─── Math renderer ───────────────────────────────────────────────────────────

function MathRenderer({ config, value, onChange, readonly }: Props) {
  const [rendered, setRendered] = useState("");
  const content = config.content || "";
  const blanks = config.blankOrder;

  useEffect(() => {
    (async () => {
      try {
        const katex = (await import("katex")).default;
        let display = content;
        blanks.forEach((id, idx) => {
          display = display.replaceAll(id, `\\boxed{${idx + 1}}`);
        });
        const html = katex.renderToString(display, { throwOnError: false, displayMode: true });
        setRendered(html);
      } catch { /* ignore */ }
    })();
  }, [content, blanks]);

  return (
    <div className="space-y-4">
      {/* KaTeX preview with numbered boxes for blanks */}
      {rendered && (
        <div className="min-w-0 w-full rounded-xl border border-white/10 bg-white/[0.02] p-4 text-white"
          dangerouslySetInnerHTML={{ __html: rendered }} />
      )}
      {/* Labeled inputs for each blank */}
      <div className="grid gap-3 sm:grid-cols-2">
        {blanks.map((id, idx) => (
          <div key={id} className="flex items-center gap-2">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-purple-500/20 text-xs font-bold text-purple-300">
              {idx + 1}
            </span>
            {readonly ? (
              <span className="rounded border border-purple-400/40 bg-purple-500/10 px-3 py-1 font-mono text-sm text-purple-200">
                {value[id] || <span className="text-white/30">—</span>}
              </span>
            ) : (
              <input
                type="text"
                placeholder={`Blank ${idx + 1}…`}
                value={value[id] || ""}
                onChange={(e) => onChange({ ...value, [id]: e.target.value })}
                className="auth-input h-9 flex-1 rounded-lg px-3 text-sm font-mono"
              />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Matrix renderer ─────────────────────────────────────────────────────────

function MatrixRenderer({ config, value, onChange, readonly }: Props) {
  const m = config.matrix;
  if (!m) return <p className="text-white/30 text-sm">No matrix defined.</p>;

  return (
    <div className="overflow-x-auto">
      <div className="inline-flex items-center gap-0">
        {/* Left bracket */}
        <span className="select-none text-5xl font-thin text-white/60" style={{ marginRight: 2 }}>[</span>
        <table className="border-collapse">
          <tbody>
            {m.cells.map((row, r) => (
              <tr key={r}>
                {row.map((cell, c) => (
                  <td key={c} className="px-2 py-1 text-center">
                    {/^BLANK_\d+$/.test(cell) ? (
                      <BlankInput
                        blankId={cell}
                        value={value[cell] || ""}
                        onChange={(v) => onChange({ ...value, [cell]: v })}
                        readonly={readonly}
                        width={80}
                      />
                    ) : (
                      <span className="text-base text-white">{cell}</span>
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {/* Right bracket */}
        <span className="select-none text-5xl font-thin text-white/60" style={{ marginLeft: 2 }}>]</span>
      </div>
    </div>
  );
}

// ─── Table renderer ───────────────────────────────────────────────────────────

function TableRenderer({ config, value, onChange, readonly }: Props) {
  const td = config.tableData;
  if (!td) return <p className="text-white/30 text-sm">No table defined.</p>;

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr>
            {td.headers.map((h, i) => (
              <th key={i} className="border border-white/15 bg-white/[0.05] px-3 py-2 text-left text-xs font-semibold text-indigo-200">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {td.rows.map((row, r) => (
            <tr key={r} className="even:bg-white/[0.02]">
              {row.map((cell, c) => (
                <td key={c} className="border border-white/10 px-3 py-1.5 text-center">
                  {/^BLANK_\d+$/.test(cell) ? (
                    <BlankInput
                      blankId={cell}
                      value={value[cell] || ""}
                      onChange={(v) => onChange({ ...value, [cell]: v })}
                      readonly={readonly}
                      width={100}
                    />
                  ) : (
                    <span className="text-white/80">{cell}</span>
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Diagram renderer ────────────────────────────────────────────────────────

function DiagramRenderer({ config, value, onChange, readonly }: Props) {
  const diag = config.diagram;
  if (!diag?.imageUrl) return <p className="text-white/30 text-sm">No diagram uploaded.</p>;

  return (
    <div className="relative inline-block max-w-full w-full">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={diag.imageUrl} alt="diagram" loading="lazy"
        className="w-full rounded-lg border border-white/10 object-contain" />
      {Object.entries(diag.blanks).map(([id, pos]) => (
        <div
          key={id}
          style={{
            position: "absolute",
            left: `${pos.x}%`,
            top: `${pos.y}%`,
            transform: "translate(-50%, -50%)",
            width: `${pos.width}%`,
            minWidth: 64,
          }}
        >
          {readonly ? (
            <span className="flex h-9 w-full items-center justify-center rounded border border-purple-400/60 bg-slate-950/85 font-mono text-xs text-purple-200">
              {value[id] || "—"}
            </span>
          ) : (
            <input
              type="text"
              placeholder={id.replace("BLANK_", "?")}
              value={value[id] || ""}
              onChange={(e) => onChange({ ...value, [id]: e.target.value })}
              className="h-9 w-full rounded border-2 border-purple-400/60 bg-slate-950/85 px-2 text-center font-mono text-xs text-purple-200 focus:border-purple-400 focus:outline-none"
            />
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function TemplateFillRenderer({ config, value, onChange, readonly }: Props) {
  return (
    <div className="space-y-4">
      {config.stem && (
        <p className="text-sm text-white/70 leading-relaxed">{config.stem}</p>
      )}
      <div className="rounded-xl border border-white/10 bg-slate-950/40 p-4 sm:p-5">
        {config.templateType === "text"    && <TextRenderer    config={config} value={value} onChange={onChange} readonly={readonly} />}
        {config.templateType === "math"    && <MathRenderer    config={config} value={value} onChange={onChange} readonly={readonly} />}
        {config.templateType === "matrix"  && <MatrixRenderer  config={config} value={value} onChange={onChange} readonly={readonly} />}
        {config.templateType === "table"   && <TableRenderer   config={config} value={value} onChange={onChange} readonly={readonly} />}
        {config.templateType === "diagram" && <DiagramRenderer config={config} value={value} onChange={onChange} readonly={readonly} />}
      </div>
    </div>
  );
}
