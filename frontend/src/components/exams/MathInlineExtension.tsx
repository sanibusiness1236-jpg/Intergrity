"use client";

/**
 * TipTap custom inline Node for rendered math.
 * Stored as: <span data-latex="formula" class="math-inline"></span>
 * Displayed in the editor via a React NodeView that renders KaTeX live.
 */

import { Node, mergeAttributes } from "@tiptap/core";
import { NodeViewWrapper, ReactNodeViewRenderer } from "@tiptap/react";
import type { ReactNodeViewProps } from "@tiptap/react";
import { useEffect, useState } from "react";

// ─── NodeView (editor preview) ───────────────────────────────────────────────

function MathNodeView({ node }: ReactNodeViewProps) {
  const latex = (node.attrs as { latex?: string }).latex ?? "";
  const [html, setHtml] = useState("");
  const [err, setErr] = useState("");

  useEffect(() => {
    (async () => {
      if (!latex) return;
      try {
        const katex = (await import("katex")).default;
        setHtml(katex.renderToString(latex, { throwOnError: false, displayMode: false }));
        setErr("");
      } catch (e) {
        setErr(String(e));
      }
    })();
  }, [latex]);

  return (
    <NodeViewWrapper as="span" className="math-inline" contentEditable={false} style={{ display: "inline" }}>
      {err ? (
        <span className="rounded bg-rose-500/20 px-1 py-0.5 font-mono text-xs text-rose-300">{latex}</span>
      ) : html ? (
        <span dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <span className="rounded bg-purple-500/15 px-1 font-mono text-xs text-purple-300">{latex}</span>
      )}
    </NodeViewWrapper>
  );
}

// ─── TipTap Node extension ────────────────────────────────────────────────────

export const MathInline = Node.create({
  name: "mathInline",
  group: "inline",
  inline: true,
  atom: true,  // non-editable; treated as a single unit

  addAttributes() {
    return {
      latex: {
        default: "",
        parseHTML: (el) => el.getAttribute("data-latex") ?? "",
        renderHTML: (attrs) => ({ "data-latex": attrs.latex }),
      },
    };
  },

  parseHTML() {
    return [{ tag: "span[data-latex]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["span", mergeAttributes(HTMLAttributes, { class: "math-inline" })];
  },

  addNodeView() {
    return ReactNodeViewRenderer(MathNodeView);
  },
});
