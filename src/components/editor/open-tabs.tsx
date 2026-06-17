import { useEffect, useRef, useState, type WheelEvent, type MouseEvent as ReactMouseEvent } from "react";
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

export function OpenTabs({ tabs, activeTabId, onSelect, onClose, onReorder, onContextMenu }: OpenTabsProps) {
  const { t } = useI18n();
  const listRef = useRef<HTMLDivElement | null>(null);
  const dragIndexRef = useRef<number | null>(null);
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

  return (
    <div
      ref={listRef}
      className="mdv-tabs"
      role="tablist"
      aria-label={t("tabs.openFiles")}
      onWheel={handleWheel}
    >
      {tabs.map((tab, tabIndex) => {
        const active = tab.id === activeTabId;
        const dirty = tab.source !== tab.savedContent;
        const isDragOver = overIndex === tabIndex && dragIndexRef.current !== tabIndex;
        return (
          <div
            key={tab.id}
            role="tab"
            aria-selected={active}
            className={`mdv-tab${active ? " is-active" : ""}${dirty ? " is-dirty" : ""}${isDragOver ? " is-drag-over" : ""}`}
            title={tab.path ?? tab.title}
            draggable={!!onReorder}
            onDragStart={(e) => {
              dragIndexRef.current = tabIndex;
              e.dataTransfer.effectAllowed = "move";
              // required by some runtimes to initiate drag
              e.dataTransfer.setData("text/plain", String(tabIndex));
            }}
            onDragOver={(e) => {
              if (dragIndexRef.current === null || dragIndexRef.current === tabIndex || !onReorder) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
              if (overIndex !== tabIndex) setOverIndex(tabIndex);
            }}
            onDragLeave={(e) => {
              // only clear when actually leaving this element, not entering a child
              if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
                setOverIndex(null);
              }
            }}
            onDrop={(e) => {
              e.preventDefault();
              const from = dragIndexRef.current;
              if (from !== null && from !== tabIndex && onReorder) {
                onReorder(from, tabIndex);
              }
              dragIndexRef.current = null;
              setOverIndex(null);
            }}
            onDragEnd={() => {
              dragIndexRef.current = null;
              setOverIndex(null);
            }}
            onContextMenu={tab.path && onContextMenu ? (e: ReactMouseEvent) => {
              e.preventDefault();
              onContextMenu(e, tab.path!);
            } : undefined}
          >
            <button
              type="button"
              className="mdv-tab__select"
              draggable={false}
              onClick={() => onSelect(tab.id)}
            >
              <span className="mdv-tab__dot" aria-hidden="true" />
              <span className="mdv-tab__label">{tab.title}</span>
            </button>
            <button
              type="button"
              className="mdv-tab__close"
              draggable={false}
              aria-label={t("tabs.close", { name: tab.title })}
              data-tooltip={t("tabs.close", { name: tab.title })}
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
