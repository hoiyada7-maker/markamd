import { useEffect, useRef, type RefObject } from "react";
import type { EditorView } from "@codemirror/view";

type ScrollPos = { editor: number; preview: number };

export function useScrollMemory(
  activePath: string | null,
  viewRef: RefObject<EditorView | null>,
): void {
  const memory = useRef(new Map<string, ScrollPos>());
  const prevPathRef = useRef<string | null>(null);

  // Capture raw scrollTop when LEAVING a tab.
  // Runs synchronously during React's effect phase — before CM6's rAF DOM update,
  // so view.scrollDOM.scrollTop still holds the outgoing tab's scroll position.
  // We do NOT convert to a document position here: CM6's height map has already
  // been rebuilt for the INCOMING document (dispatch is synchronous), so
  // lineBlockAtHeight would give a position in the wrong document.
  useEffect(() => {
    const prev = prevPathRef.current;
    prevPathRef.current = activePath;
    if (!prev || prev === activePath) return;

    const view = viewRef.current;
    const preview = document.querySelector<HTMLElement>(".mdv-preview");
    memory.current.set(prev, {
      editor: view?.scrollDOM.scrollTop ?? 0,
      preview: preview?.scrollTop ?? 0,
    });
  }, [activePath, viewRef]);

  // Track preview scroll continuously (safe: no CM6 involvement in preview DOM).
  useEffect(() => {
    const path = activePath;
    if (!path) return;

    const preview = document.querySelector<HTMLElement>(".mdv-preview");
    if (!preview) return;

    const onPreviewScroll = () => {
      const existing = memory.current.get(path) ?? { editor: 0, preview: 0 };
      memory.current.set(path, { ...existing, preview: preview.scrollTop });
    };

    preview.addEventListener("scroll", onPreviewScroll, { passive: true });
    return () => preview.removeEventListener("scroll", onPreviewScroll);
  }, [activePath]);

  // Restore scroll after content settles.
  // Double rAF: first rAF lets CM6's own rAF (scheduled by the dispatch in
  // Editor's effect) complete its DOM update; second rAF then sets scrollTop
  // after CM6 is done. CM6 does not auto-scroll to cursor for programmatic
  // dispatches that omit scrollIntoView:true, so the value sticks.
  useEffect(() => {
    const saved = activePath ? memory.current.get(activePath) : null;
    if (!saved) return;

    let id1: number;
    let id2: number;
    id1 = requestAnimationFrame(() => {
      id2 = requestAnimationFrame(() => {
        const view = viewRef.current;
        const preview = document.querySelector<HTMLElement>(".mdv-preview");
        if (view) view.scrollDOM.scrollTop = saved.editor;
        if (preview) preview.scrollTop = saved.preview;
      });
    });

    return () => {
      cancelAnimationFrame(id1);
      cancelAnimationFrame(id2);
    };
  }, [activePath, viewRef]);
}
