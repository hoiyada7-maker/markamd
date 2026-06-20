import { useEffect, useRef, type RefObject } from "react";
import type { EditorView } from "@codemirror/view";

type ScrollPos = { editor: number; preview: number };

export function useScrollMemory(
  activePath: string | null,
  viewRef: RefObject<EditorView | null>,
): void {
  const memory = useRef(new Map<string, ScrollPos>());
  // true while a tab-switch restore is in progress — suppresses spurious saves
  // from scroll events fired while content is being replaced or scroll is being
  // programmatically set.
  const restoringRef = useRef(false);

  // Continuous scroll tracking. Saves are gated by restoringRef so that:
  // 1. The browser's automatic scrollTop reset when innerHTML changes (old
  //    content height no longer accommodates the stored position) cannot
  //    corrupt the saved value.
  // 2. The scroll event emitted by the programmatic restore write itself
  //    does not overwrite the target value.
  useEffect(() => {
    const path = activePath;
    if (!path) return;

    restoringRef.current = true;

    const editorDOM = viewRef.current?.scrollDOM ?? null;
    const preview = document.querySelector<HTMLElement>(".mdv-preview");

    const save = () => {
      if (restoringRef.current) return;
      const prev = memory.current.get(path);
      memory.current.set(path, {
        editor: editorDOM?.scrollTop ?? prev?.editor ?? 0,
        preview: preview?.scrollTop ?? prev?.preview ?? 0,
      });
    };

    editorDOM?.addEventListener("scroll", save, { passive: true });
    preview?.addEventListener("scroll", save, { passive: true });
    return () => {
      editorDOM?.removeEventListener("scroll", save);
      preview?.removeEventListener("scroll", save);
    };
  }, [activePath, viewRef]);

  // Restore scroll after a tab switch.
  //
  // WHY preview-only restore:
  // Restoring both editor.scrollTop AND preview.scrollTop in the same frame
  // causes useSyncScroll to fire syncEditorToPreview, which re-maps the
  // editor position back to a line-anchor preview position (±15px drift).
  // By restoring ONLY the preview, useSyncScroll reacts by syncing the editor
  // to match — exactly the right behaviour. In editor-only mode (no preview)
  // we still restore the editor directly.
  //
  // WHY MutationObserver + timeout instead of double-rAF:
  // The Preview component renders markdown asynchronously (shiki + 50 ms
  // debounce). A simple double-rAF fires before the new content lands in the
  // DOM, so the preview still shows the PREVIOUS tab's HTML at restore time.
  // If that content is shorter, scrollTop gets clamped to a wrong value.
  // We watch .mdv-prose for a childList mutation (innerHTML = newHtml) and
  // restore THEN. The 150 ms fallback handles the common case where the same
  // file is revisited (same html string → React bail-out → no DOM mutation).
  useEffect(() => {
    if (!activePath) return;

    const saved = memory.current.get(activePath);
    const targetPreview = saved?.preview ?? 0;
    const targetEditor = saved?.editor ?? 0;

    let previewRaf: number | undefined;
    let mo: MutationObserver | null = null;
    let timeoutId: ReturnType<typeof setTimeout>;
    let done = false;

    const restoreScroll = () => {
      if (done) return;
      done = true;
      mo?.disconnect();
      mo = null;
      clearTimeout(timeoutId);

      const preview = document.querySelector<HTMLElement>(".mdv-preview");

      if (!preview) {
        // Editor-only mode: restore editor directly (no preview, no useSyncScroll).
        const view = viewRef.current;
        requestAnimationFrame(() => {
          if (view) view.scrollDOM.scrollTop = targetEditor;
          restoringRef.current = false;
        });
        return;
      }

      // Preview present: restore preview only.
      // useSyncScroll will sync the editor to match after the scroll event fires.
      // We keep restoringRef=true for 2 rAFs so useSyncScroll's cascade (which
      // runs in the rAF immediately after our write) is suppressed from saving.
      previewRaf = requestAnimationFrame(() => {
        preview.scrollTop = targetPreview;
        requestAnimationFrame(() => {
          restoringRef.current = false;
        });
      });
    };

    // Watch .mdv-prose for innerHTML changes (async markdown render completes).
    const prose = document.querySelector<HTMLElement>(".mdv-prose");
    if (prose) {
      mo = new MutationObserver(restoreScroll);
      mo.observe(prose, { childList: true });
    }

    // Fallback: previously-visited tabs produce the same html string →
    // React bails out → no DOM mutation → MO never fires.
    // 150 ms > 50 ms debounce + typical renderMarkdown time.
    timeoutId = setTimeout(restoreScroll, 150);

    return () => {
      clearTimeout(timeoutId);
      mo?.disconnect();
      mo = null;
      if (previewRaf !== undefined) cancelAnimationFrame(previewRaf);
      restoringRef.current = false;
    };
  }, [activePath, viewRef]);
}
