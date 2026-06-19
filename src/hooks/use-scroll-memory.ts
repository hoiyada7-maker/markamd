import { EditorView } from "@codemirror/view";
import { useEffect, useRef, type RefObject } from "react";

type ScrollMemory = { editorPos: number; preview: number };

export function useScrollMemory(
  activePath: string | null,
  viewRef: RefObject<EditorView | null>,
): void {
  const memory = useRef(new Map<string, ScrollMemory>());
  const prevPathRef = useRef<string | null>(null);

  // Save editor scroll when leaving a tab (synchronous, before CM6 rAF DOM update)
  useEffect(() => {
    const prev = prevPathRef.current;
    prevPathRef.current = activePath;
    if (!prev || prev === activePath) return;

    const view = viewRef.current;
    if (view) {
      const scrollTop = view.scrollDOM.scrollTop;
      const editorPos = view.lineBlockAtHeight(scrollTop).from;
      const existing = memory.current.get(prev) ?? { editorPos: 0, preview: 0 };
      memory.current.set(prev, { ...existing, editorPos });
    }
  }, [activePath, viewRef]);

  // Track preview scroll continuously
  useEffect(() => {
    const path = activePath;
    if (!path) return;

    const preview = document.querySelector<HTMLElement>(".mdv-preview");
    if (!preview) return;

    const onPreviewScroll = () => {
      const existing = memory.current.get(path) ?? { editorPos: 0, preview: 0 };
      memory.current.set(path, { ...existing, preview: preview.scrollTop });
    };

    preview.addEventListener("scroll", onPreviewScroll, { passive: true });
    return () => preview.removeEventListener("scroll", onPreviewScroll);
  }, [activePath]);

  // Restore scroll after content settles — double rAF lets CM6 finish its DOM update
  useEffect(() => {
    const saved = activePath ? memory.current.get(activePath) : null;
    if (!saved) return;

    let id1: number;
    let id2: number;
    id1 = requestAnimationFrame(() => {
      id2 = requestAnimationFrame(() => {
        const view = viewRef.current;
        if (view && saved.editorPos > 0) {
          const pos = Math.min(saved.editorPos, view.state.doc.length);
          view.dispatch({
            effects: EditorView.scrollIntoView(pos, { y: "start", yMargin: 0 }),
          });
        }
        const preview = document.querySelector<HTMLElement>(".mdv-preview");
        if (preview) preview.scrollTop = saved.preview;
      });
    });

    return () => {
      cancelAnimationFrame(id1);
      cancelAnimationFrame(id2);
    };
  }, [activePath, viewRef]);
}
