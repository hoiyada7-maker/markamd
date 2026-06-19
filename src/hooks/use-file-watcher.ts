import { useEffect } from "react";
import { stat } from "@tauri-apps/plugin-fs";
import { getCurrentWindow } from "@tauri-apps/api/window";

/**
 * Polls mtime every 2s. Pauses on native window blur, resumes on focus.
 * Uses Tauri's onFocusChanged (native OS event) instead of DOM focus/blur,
 * which is unreliable in WebKit2GTK on Linux.
 */
export function useFileWatcher(path: string | null, onChange: () => void): void {
  useEffect(() => {
    if (!path) return;
    let lastMtime: number | null = null;
    let active = true;
    let intervalId: number | null = null;
    let unlistenFocus: (() => void) | null = null;

    const check = async () => {
      if (!active) return;
      try {
        const meta = await stat(path);
        const m = meta.mtime ? new Date(meta.mtime).getTime() : null;
        if (lastMtime !== null && m !== null && m !== lastMtime) {
          onChange();
        }
        lastMtime = m;
      } catch {
        active = false;
        if (intervalId !== null) {
          window.clearInterval(intervalId);
          intervalId = null;
        }
      }
    };

    const startInterval = () => {
      if (intervalId === null) {
        intervalId = window.setInterval(check, 2000);
      }
    };
    const stopInterval = () => {
      if (intervalId !== null) {
        window.clearInterval(intervalId);
        intervalId = null;
      }
    };

    void check();
    startInterval();

    void getCurrentWindow().onFocusChanged(({ payload: focused }) => {
      if (!active) return;
      if (focused) {
        startInterval();
        void check();
      } else {
        stopInterval();
      }
    }).then((unlisten) => {
      unlistenFocus = unlisten;
    });

    return () => {
      active = false;
      stopInterval();
      unlistenFocus?.();
    };
  }, [path, onChange]);
}
