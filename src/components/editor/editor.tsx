import { useEffect, useRef, type RefObject } from "react";
import { Compartment, EditorState } from "@codemirror/state";
import { EditorView, keymap, lineNumbers, highlightActiveLine, drawSelection } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { HighlightStyle, syntaxHighlighting, bracketMatching, foldGutter, foldKeymap, foldService } from "@codemirror/language";
import { search, searchKeymap } from "@codemirror/search";
import { markdown } from "@codemirror/lang-markdown";
import { tags as t } from "@lezer/highlight";

const mdHighlight = HighlightStyle.define([
  { tag: t.heading1, fontSize: "1.35em", fontWeight: "600", color: "var(--fg)" },
  { tag: t.heading2, fontSize: "1.18em", fontWeight: "600", color: "var(--fg)" },
  { tag: t.heading3, fontSize: "1.08em", fontWeight: "600", color: "var(--fg)" },
  { tag: [t.heading4, t.heading5, t.heading6], fontWeight: "600", color: "var(--fg)" },
  { tag: t.strong, fontWeight: "600", color: "var(--fg)" },
  { tag: t.emphasis, fontStyle: "italic", color: "var(--fg)" },
  { tag: t.strikethrough, textDecoration: "line-through", color: "var(--muted)" },
  { tag: t.link, color: "var(--accent)", textDecoration: "none" },
  { tag: t.url, color: "var(--accent)" },
  { tag: t.quote, color: "var(--muted)", fontStyle: "italic" },
  { tag: t.monospace, color: "var(--accent)" },
  { tag: t.list, color: "var(--accent)" },
  { tag: t.contentSeparator, color: "var(--muted)" },
  { tag: t.meta, color: "var(--muted)" },
  { tag: t.processingInstruction, color: "var(--muted)" },
]);

type EditorProps = {
  value: string;
  onChange: (next: string) => void;
  /** opt-in vim keybindings (lazy-loaded on first true) */
  vimOn?: boolean;
  /** fired when vim mode changes; null when vim is off (#23) */
  onVimMode?: (mode: "normal" | "insert" | "visual" | "replace" | null) => void;
  /** shared ref populated with the EditorView once it mounts */
  viewRef?: RefObject<EditorView | null>;
};

// Folds the content under an ATX heading (# ## ###) down to the line
// before the next heading of equal or higher level.
const markdownHeadingFold = foldService.of((state, from) => {
  const line = state.doc.lineAt(from);
  const m = line.text.match(/^(#{1,6})\s/);
  if (!m) return null;
  const level = m[1].length;
  let end = line.to;
  for (let i = line.number + 1; i <= state.doc.lines; i++) {
    const next = state.doc.line(i);
    const nm = next.text.match(/^(#{1,6})\s/);
    if (nm && nm[1].length <= level) {
      end = state.doc.line(i - 1).to;
      break;
    }
    end = next.to;
  }
  return end > line.to ? { from: line.to, to: end } : null;
});

function buildTheme() {
  return EditorView.theme(
    {
      "&": {
        height: "100%",
        backgroundColor: "transparent",
        color: "var(--fg)",
        fontFamily: "var(--font-mono)",
        fontSize: "var(--mdv-writing-font-size)",
      },
      ".cm-scroller": {
        fontFamily: "var(--font-mono)",
        lineHeight: "var(--mdv-writing-line-height)",
        padding: "20px 28px 80px",
      },
      ".cm-content": {
        caretColor: "var(--accent)",
      },
      ".cm-cursor, .cm-dropCursor": {
        borderLeftColor: "var(--accent)",
        borderLeftWidth: "1.5px",
      },
      ".cm-gutters": {
        backgroundColor: "transparent",
        color: "var(--muted)",
        border: "none",
        fontFamily: "var(--font-mono)",
        fontSize: "11px",
        paddingRight: "8px",
      },
      ".cm-activeLine": {
        backgroundColor: "transparent",
      },
      ".cm-activeLineGutter": {
        backgroundColor: "transparent",
        color: "var(--fg)",
      },
      "&.cm-focused": {
        outline: "none",
      },
      "&.cm-focused .cm-selectionBackground, ::selection, .cm-selectionBackground": {
        backgroundColor: "color-mix(in srgb, var(--accent) 22%, transparent)",
      },
      ".cm-line": {
        padding: "0",
      },
      ".cm-foldGutter": {
        width: "12px",
        paddingRight: "2px",
      },
      ".cm-foldGutter .cm-gutterElement": {
        cursor: "pointer",
        color: "var(--muted)",
        fontSize: "11px",
        opacity: "0.5",
        transition: "opacity 0.1s, color 0.1s",
      },
      ".cm-foldGutter .cm-gutterElement:hover": {
        color: "var(--fg)",
        opacity: "1",
      },
      ".cm-foldPlaceholder": {
        backgroundColor: "color-mix(in srgb, var(--accent) 14%, transparent)",
        border: "1px solid color-mix(in srgb, var(--accent) 30%, transparent)",
        borderRadius: "3px",
        color: "var(--accent)",
        padding: "0 4px",
        margin: "0 2px",
        cursor: "pointer",
      },
    },
    { dark: false },
  );
}

export function Editor({ value, onChange, vimOn = false, onVimMode, viewRef: externalViewRef }: EditorProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  // Compartment lets us swap the vim extension at runtime without rebuilding
  // the EditorState (preserves doc, history, selection, undo stack).
  const vimCompartment = useRef(new Compartment());

  useEffect(() => {
    if (!hostRef.current) return;

    const state = EditorState.create({
      doc: value,
      extensions: [
        lineNumbers(),
        foldGutter(),
        markdownHeadingFold,
        history(),
        drawSelection(),
        highlightActiveLine(),
        bracketMatching(),
        syntaxHighlighting(mdHighlight, { fallback: true }),
        markdown(),
        EditorView.lineWrapping,
        search({ top: true }),
        // vim slot — empty until user toggles vimOn (#23)
        vimCompartment.current.of([]),
        keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, ...foldKeymap, indentWithTab]),
        buildTheme(),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            onChangeRef.current(update.state.doc.toString());
          }
        }),
      ],
    });

    const view = new EditorView({ state, parent: hostRef.current });
    viewRef.current = view;
    if (externalViewRef) externalViewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
      if (externalViewRef) externalViewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current !== value) {
      view.dispatch({
        changes: { from: 0, to: current.length, insert: value },
      });
    }
  }, [value]);

  // vim mode toggle (#23). Lazy-loads @replit/codemirror-vim on first enable
  // so non-vim users don't pay the ~200KB cost. Persists across re-renders via
  // the Compartment.reconfigure effect — doc + history are preserved.
  // Wires `vim-mode-change` signal from the legacy CM adapter through onVimMode.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const compartment = vimCompartment.current;
    let cancelled = false;
    let detach: (() => void) | undefined;
    if (vimOn) {
      void import("@replit/codemirror-vim")
        .then(({ vim, getCM }) => {
          if (cancelled) return;
          view.dispatch({ effects: compartment.reconfigure(vim()) });
          // attach mode-change listener via legacy CodeMirror adapter
          const cm = getCM(view);
          if (cm && onVimMode) {
            onVimMode("normal"); // vim starts in normal mode
            const handler = (e: { mode: string }) => {
              const m = e.mode as "normal" | "insert" | "visual" | "replace";
              onVimMode(m);
            };
            cm.on("vim-mode-change", handler);
            detach = () => cm.off("vim-mode-change", handler);
          }
        })
        .catch((err) => {
          if (cancelled) return;
          console.error("marka.md: failed to load vim mode", err);
        });
    } else {
      view.dispatch({ effects: compartment.reconfigure([]) });
      onVimMode?.(null);
    }
    return () => {
      cancelled = true;
      detach?.();
    };
  }, [vimOn, onVimMode]);

  return <div ref={hostRef} className="mdv-editor" />;
}
