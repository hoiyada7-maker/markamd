import { useState } from "react";
import { ChevronRight, FileText, Star, Table2 } from "lucide-react";
import { Icon } from "@/components/primitives";
import { basename, isCsvPath, type FileEntry } from "@/lib";

type FavoritesProps = {
  favorites: readonly string[];
  activePath: string | null;
  title: string;
  emptyLabel: string;
  removeLabel: string;
  onSelect: (path: string) => void;
  onToggleFavorite: (path: string) => void;
  onReorder: (from: number, to: number) => void;
  onContextMenu?: (e: React.MouseEvent, entry: FileEntry) => void;
};

export function Favorites({
  favorites,
  activePath,
  title,
  emptyLabel,
  removeLabel,
  onSelect,
  onToggleFavorite,
  onReorder,
  onContextMenu,
}: FavoritesProps) {
  const [open, setOpen] = useState(true);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);

  return (
    <section className="mdv-rootfolder mdv-favorites">
      <div className="mdv-rootfolder__header">
        <button
          type="button"
          className="mdv-rootfolder__toggle"
          onClick={() => setOpen((v) => !v)}
        >
          <span className={`mdv-tree__chevron${open ? " is-open" : ""}`}>
            <Icon icon={ChevronRight} size={12} strokeWidth={2} />
          </span>
          <span className="mdv-tree__icon mdv-favorites__star">
            <Icon icon={Star} size={13} strokeWidth={1.5} />
          </span>
          <span className="mdv-rootfolder__name">{title}</span>
        </button>
      </div>
      {open ? (
        favorites.length === 0 ? (
          <p className="mdv-favorites__empty">{emptyLabel}</p>
        ) : (
          <ul className="mdv-tree">
            {favorites.map((path, i) => (
              <li
                key={path}
                className={`mdv-tree__item${overIndex === i && dragIndex !== null && dragIndex !== i ? " is-fav-over" : ""}`}
              >
                <button
                  type="button"
                  draggable
                  className={`mdv-tree__row mdv-tree__row--file has-fav${activePath === path ? " is-active" : ""}`}
                  style={{ paddingLeft: "12px" }}
                  onClick={() => onSelect(path)}
                  onContextMenu={(e) => {
                    if (!onContextMenu) return;
                    e.preventDefault();
                    onContextMenu(e, { path, name: basename(path), isDir: false });
                  }}
                  title={path}
                  onDragStart={(e) => {
                    setDragIndex(i);
                    e.dataTransfer.effectAllowed = "move";
                    // some browsers require data to be set for drag to start
                    e.dataTransfer.setData("text/plain", path);
                  }}
                  onDragOver={(e) => {
                    if (dragIndex === null) return;
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "move";
                    if (overIndex !== i) setOverIndex(i);
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (dragIndex !== null && dragIndex !== i) onReorder(dragIndex, i);
                    setDragIndex(null);
                    setOverIndex(null);
                  }}
                  onDragEnd={() => {
                    setDragIndex(null);
                    setOverIndex(null);
                  }}
                >
                  <span className="mdv-tree__icon">
                    <Icon icon={isCsvPath(path) ? Table2 : FileText} size={13} strokeWidth={1.5} />
                  </span>
                  <span className="mdv-tree__name">{basename(path)}</span>
                </button>
                <button
                  type="button"
                  className="mdv-tree__fav is-fav"
                  data-tooltip={removeLabel}
                  aria-label={`${removeLabel} ${basename(path)}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleFavorite(path);
                  }}
                >
                  <Icon icon={Star} size={11} strokeWidth={1.8} />
                </button>
              </li>
            ))}
          </ul>
        )
      ) : null}
    </section>
  );
}
