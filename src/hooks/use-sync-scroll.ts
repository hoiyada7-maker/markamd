import { useEffect, type RefObject } from "react";
import type { EditorView } from "@codemirror/view";

type Options = {
  viewRef?: RefObject<EditorView | null>;
  editorSelector?: string;
  previewSelector?: string;
  /** when this changes, re-bind in case DOM was replaced */
  rebindKey?: unknown;
  /** while true, all sync is suppressed (used by useScrollMemory during restore) */
  suppressRef?: RefObject<boolean>;
};

type SlineBlock = {
  sline: number;
  eline: number;
  top: number;    // px from top of preview scroll content
  bottom: number;
};

/**
 * Line-anchor bidirectional scroll sync.
 *
 * Uses markdown-it's data-sline/data-eline attributes (stamped at render time)
 * to map editor source lines ↔ preview DOM blocks, eliminating the cumulative
 * drift of proportional sync on long documents with uneven content density.
 *
 * Falls back to proportional sync when no data-sline blocks are present (e.g.
 * plain-text files) or when viewRef is not provided.
 *
 * Echo prevention: counter-based (one count per programmatic write). No time
 * locks → snappy sync without feedback loops.
 */
export function useSyncScroll({
  viewRef,
  editorSelector = ".mdv-editor .cm-scroller",
  previewSelector = ".mdv-preview",
  rebindKey,
  suppressRef,
}: Options = {}): void {
  useEffect(() => {
    let editor: HTMLElement | null = null;
    let preview: HTMLElement | null = null;
    let rafId: number | undefined;
    const echo = { editor: 0, preview: 0 };

    // Collect data-sline blocks, measuring positions relative to the preview's
    // scrollable content (not the visible area) so we can compare with scrollTop.
    const getSlineBlocks = (): SlineBlock[] => {
      if (!preview) return [];
      const previewTop = preview.getBoundingClientRect().top;
      const base = preview.scrollTop;
      return Array.from(preview.querySelectorAll<HTMLElement>("[data-sline]"))
        .map((el) => {
          const r = el.getBoundingClientRect();
          const top = base + r.top - previewTop;
          return {
            sline: Number(el.dataset.sline),
            eline: Number(el.dataset.eline ?? Number(el.dataset.sline) + 1),
            top,
            bottom: top + r.height,
          };
        })
        .sort((a, b) => a.top - b.top);
    };

    const proportional = (
      src: HTMLElement,
      dst: HTMLElement,
      dstKey: "editor" | "preview",
    ) => {
      const srcRange = src.scrollHeight - src.clientHeight;
      const dstRange = dst.scrollHeight - dst.clientHeight;
      if (srcRange <= 0 || dstRange <= 0) return;
      const target = (src.scrollTop / srcRange) * dstRange;
      if (Math.abs(dst.scrollTop - target) < 1) return;
      echo[dstKey] += 1;
      dst.scrollTop = target;
    };

    const syncEditorToPreview = () => {
      if (!editor || !preview) return;
      const view = viewRef?.current;
      const scrollTop = editor.scrollTop;
      const editorRange = editor.scrollHeight - editor.clientHeight;
      const previewRange = preview.scrollHeight - preview.clientHeight;
      if (previewRange <= 0) return;

      // Endpoints snap exactly to avoid drifting at extremes
      if (scrollTop <= 0) {
        echo.preview += 1;
        preview.scrollTop = 0;
        return;
      }
      if (scrollTop >= editorRange) {
        echo.preview += 1;
        preview.scrollTop = previewRange;
        return;
      }

      if (!view) {
        proportional(editor, preview, "preview");
        return;
      }

      // Resolve which source line is at the viewport top and how far into it
      const block = view.lineBlockAtHeight(scrollTop);
      const lineNum = view.state.doc.lineAt(block.from).number - 1; // 0-based
      const intraFrac =
        block.height > 0
          ? Math.max(0, Math.min(1, (scrollTop - block.top) / block.height))
          : 0;

      const blocks = getSlineBlocks();
      if (blocks.length === 0) {
        proportional(editor, preview, "preview");
        return;
      }

      // Find the preview block that covers this source line
      let matched = blocks.find((b) => lineNum >= b.sline && lineNum < b.eline);
      if (!matched) {
        // nearest block when the line falls in a gap (e.g. blank lines between blocks)
        matched = blocks.reduce((best, b) => {
          const d = Math.min(
            Math.abs(b.sline - lineNum),
            Math.abs(b.eline - 1 - lineNum),
          );
          const bd = Math.min(
            Math.abs(best.sline - lineNum),
            Math.abs(best.eline - 1 - lineNum),
          );
          return d < bd ? b : best;
        });
      }

      const blockH = matched.bottom - matched.top;
      const target = Math.max(
        0,
        Math.min(matched.top + intraFrac * blockH, previewRange),
      );
      if (Math.abs(preview.scrollTop - target) < 1) return;
      echo.preview += 1;
      preview.scrollTop = target;
    };

    const syncPreviewToEditor = () => {
      if (!editor || !preview) return;
      const view = viewRef?.current;
      const scrollTop = preview.scrollTop;
      const editorRange = editor.scrollHeight - editor.clientHeight;
      const previewRange = preview.scrollHeight - preview.clientHeight;
      if (editorRange <= 0) return;

      if (scrollTop <= 0) {
        echo.editor += 1;
        editor.scrollTop = 0;
        return;
      }
      if (scrollTop >= previewRange) {
        echo.editor += 1;
        editor.scrollTop = editorRange;
        return;
      }

      if (!view) {
        proportional(preview, editor, "editor");
        return;
      }

      const blocks = getSlineBlocks();
      if (blocks.length === 0) {
        proportional(preview, editor, "editor");
        return;
      }

      // Find the preview block spanning the viewport top
      let matched = blocks.find((b) => b.top <= scrollTop && b.bottom > scrollTop);
      if (!matched) {
        matched = blocks.reduce((best, b) => {
          const mid = (b.top + b.bottom) / 2;
          const bMid = (best.top + best.bottom) / 2;
          return Math.abs(mid - scrollTop) < Math.abs(bMid - scrollTop) ? b : best;
        });
      }

      const blockH = matched.bottom - matched.top;
      const intraFrac =
        blockH > 0
          ? Math.max(0, Math.min(1, (scrollTop - matched.top) / blockH))
          : 0;

      // Map source line + intra-fraction → editor scroll position.
      // intraFrac is the fraction within the preview block (which may span many
      // source lines), so we derive a fractional source line then split it into
      // a line index and an intra-line fraction for the editor.
      const doc = view.state.doc;
      const targetLine = matched.sline + intraFrac * (matched.eline - matched.sline);
      const lineIdx = Math.max(1, Math.min(doc.lines, Math.floor(targetLine) + 1));
      const lineIntraFrac = targetLine - Math.floor(targetLine);
      const lineFrom = doc.line(lineIdx).from;
      const lineBlock = view.lineBlockAt(lineFrom);
      const target = Math.max(
        0,
        Math.min(lineBlock.top + lineIntraFrac * lineBlock.height, editorRange),
      );
      if (Math.abs(editor.scrollTop - target) < 1) return;
      echo.editor += 1;
      editor.scrollTop = target;
    };

    const makeHandler = (
      syncFn: () => void,
      srcKey: "editor" | "preview",
    ) => {
      let pending = false;
      return () => {
        if (suppressRef?.current) return;
        if (echo[srcKey] > 0) {
          echo[srcKey] -= 1;
          return;
        }
        if (pending) return;
        pending = true;
        requestAnimationFrame(() => {
          pending = false;
          if (suppressRef?.current) return;
          syncFn();
        });
      };
    };

    let onEditor: (() => void) | undefined;
    let onPreview: (() => void) | undefined;

    const tryAttach = () => {
      editor = document.querySelector<HTMLElement>(editorSelector);
      preview = document.querySelector<HTMLElement>(previewSelector);
      if (!editor || !preview) {
        rafId = requestAnimationFrame(tryAttach);
        return;
      }
      onEditor = makeHandler(syncEditorToPreview, "editor");
      onPreview = makeHandler(syncPreviewToEditor, "preview");
      editor.addEventListener("scroll", onEditor, { passive: true });
      preview.addEventListener("scroll", onPreview, { passive: true });
    };

    tryAttach();

    return () => {
      if (rafId != null) cancelAnimationFrame(rafId);
      if (editor && onEditor) editor.removeEventListener("scroll", onEditor);
      if (preview && onPreview) preview.removeEventListener("scroll", onPreview);
    };
  }, [viewRef, editorSelector, previewSelector, rebindKey]);
}
