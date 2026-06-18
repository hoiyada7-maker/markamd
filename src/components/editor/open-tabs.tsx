import {
  useEffect,
  useRef,
  useState,
  type WheelEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { X } from "lucide-react";
import { Icon } from "@/components/primitives";
import type { FileTab } from "@/hooks/use-file-session";
import { useI18n } from "@/lib";

type OpenTabsProps = {
  tabs: FileTab[];
  activeTabId: string;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onReorder?: (from: number, to: number) => void;
  onContextMenu?: (e: React.MouseEvent, path: string) => void;
};

// px the pointer must travel before a press becomes a reorder drag
const DRAG_THRESHOLD = 4;

export function OpenTabs({ tabs, activeTabId, onSelect, onClose, onReorder, onContextMenu }: OpenTabsProps) {
  const { t } = useI18n();
  const listRef = useRef<HTMLDivElement | null>(null);
  // active drag gesture; null when idle. Pointer-event based (not HTML5 DnD)
  // because Tauri's dragDropEnabled intercepts native drag on WebView2.
  const dragRef = useRef<{ fromIndex: number; startX: number; pointerId: number; moved: boolean } | null>(null);
  // when a drag just ended, swallow the synthetic click so it doesn't select
  const suppressClickRef = useRef(false);
  const [fromIndex, setFromIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);

  useEffect(() => {
    const active = listRef.current?.querySelector<HTMLElement>(".mdv-tab.is-active");
    active?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeTabId, tabs.length]);

  const handleWheel = (event: WheelEvent<HTMLDivElement>) => {
    const el = listRef.current;
    if (!el) return;
    if (Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return;
    if (el.scrollWidth <= el.clientWidth) return;
    event.preventDefault();
    el.scrollLeft += event.deltaY;
  };

  // which tab index the pointer X currently sits over (by element midpoints)
  const indexAtX = (clientX: number): number | null => {
    const el = listRef.current;
    if (!el) return null;
    const tabEls = Array.from(el.querySelectorAll<HTMLElement>(".mdv-tab"));
    if (tabEls.length === 0) return null;
    for (let i = 0; i < tabEls.length; i++) {
      const rect = tabEls[i].getBoundingClientRect();
      if (clientX < rect.left + rect.width / 2) return i;
    }
    return tabEls.length - 1;
  };

  const onTabPointerDown = (e: ReactPointerEvent<HTMLDivElement>, index: number) => {
    if (!onReorder || e.button !== 0) return;
    suppressClickRef.current = false;
    dragRef.current = { fromIndex: index, startX: e.clientX, pointerId: e.pointerId, moved: false };
  };

  const onListPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    if (!drag.moved) {
      if (Math.abs(e.clientX - drag.startX) < DRAG_THRESHOLD) return;
      drag.moved = true;
      setFromIndex(drag.fromIndex);
      try {
        listRef.current?.setPointerCapture(drag.pointerId);
      } catch {
        // capture unavailable — drag still tracks via move events
      }
    }
    setOverIndex(indexAtX(e.clientX));
  };

  const endDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    if (drag.moved) {
      suppressClickRef.current = true;
      const target = indexAtX(e.clientX);
      if (onReorder && target !== null && target !== drag.fromIndex) {
        onReorder(drag.fromIndex, target);
      }
    }
    try {
      listRef.current?.releasePointerCapture(drag.pointerId);
    } catch {
      // already released
    }
    dragRef.current = null;
    setFromIndex(null);
    setOverIndex(null);
  };

  return (
    <div
      ref={listRef}
      className={`mdv-tabs${fromIndex !== null ? " is-reordering" : ""}`}
      role="tablist"
      aria-label={t("tabs.openFiles")}
      onWheel={handleWheel}
      onPointerMove={onListPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      {tabs.map((tab, tabIndex) => {
        const active = tab.id === activeTabId;
        const dirty = tab.source !== tab.savedContent;
        const dragging = fromIndex === tabIndex;
        const isDragOver = overIndex === tabIndex && fromIndex !== null && fromIndex !== tabIndex;
        return (
          <div
            key={tab.id}
            role="tab"
            aria-selected={active}
            className={`mdv-tab${active ? " is-active" : ""}${dirty ? " is-dirty" : ""}${dragging ? " is-dragging" : ""}${isDragOver ? " is-drag-over" : ""}`}
            title={tab.path ?? tab.title}
            onPointerDown={(e) => onTabPointerDown(e, tabIndex)}
            onContextMenu={tab.path && onContextMenu ? (e: ReactMouseEvent) => {
              e.preventDefault();
              onContextMenu(e, tab.path!);
            } : undefined}
          >
            <button
              type="button"
              className="mdv-tab__select"
              onClick={() => {
                if (suppressClickRef.current) {
                  suppressClickRef.current = false;
                  return;
                }
                onSelect(tab.id);
              }}
            >
              <span className="mdv-tab__dot" aria-hidden="true" />
              <span className="mdv-tab__label">{tab.title}</span>
            </button>
            <button
              type="button"
              className="mdv-tab__close"
              aria-label={t("tabs.close", { name: tab.title })}
              data-tooltip={t("tabs.close", { name: tab.title })}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => onClose(tab.id)}
            >
              <Icon icon={X} size={13} strokeWidth={1.8} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
