import { useEffect, useRef, type RefObject } from "react";

// Preview-only scroll memory. Saves and restores .mdv-preview scrollTop per tab.
// suppressRef is shared with useSyncScroll to block syncing during the restore window.
export function useScrollMemory(
  activePath: string | null,
  suppressRef: RefObject<boolean>,
): void {
  const memory = useRef(new Map<string, number>());

  // Save preview scroll position (gated by suppressRef)
  useEffect(() => {
    if (!activePath) return;
    const path = activePath;
    suppressRef.current = true;

    const preview = document.querySelector<HTMLElement>(".mdv-preview");
    if (!preview) return;

    const save = () => {
      if (suppressRef.current) return;
      memory.current.set(path, preview.scrollTop);
    };

    preview.addEventListener("scroll", save, { passive: true });
    return () => preview.removeEventListener("scroll", save);
  }, [activePath, suppressRef]);

  // Restore preview scroll after tab switch
  useEffect(() => {
    if (!activePath) return;

    const target = memory.current.get(activePath) ?? 0;
    let done = false;
    let mo: MutationObserver | null = null;
    let timeoutId: ReturnType<typeof setTimeout>;
    let releaseId: ReturnType<typeof setTimeout>;

    const restoreScroll = () => {
      if (done) return;
      done = true;
      mo?.disconnect();
      mo = null;
      clearTimeout(timeoutId);

      const preview = document.querySelector<HTMLElement>(".mdv-preview");
      if (!preview) {
        suppressRef.current = false;
        return;
      }

      requestAnimationFrame(() => {
        preview.scrollTop = target;
        // Keep useSyncScroll suppressed for 300ms to absorb any CodeMirror
        // scroll events that follow the programmatic scrollTop write.
        releaseId = setTimeout(() => {
          suppressRef.current = false;
        }, 300);
      });
    };
    const prose = document.querySelector<HTMLElement>(".mdv-prose");
    if (prose) {
      mo = new MutationObserver(restoreScroll);
      mo.observe(prose, { childList: true });
    }
    // Fallback for same-content revisits (React bails out, no DOM mutation)
    timeoutId = setTimeout(restoreScroll, 150);

    return () => {
      clearTimeout(timeoutId);
      clearTimeout(releaseId);
      mo?.disconnect();
      mo = null;
      suppressRef.current = false;
    };
  }, [activePath, suppressRef]);
}
