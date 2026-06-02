import { useEffect, useState } from "react";
import { ChevronRight, Folder, FolderOpen, X } from "lucide-react";
import { Icon } from "@/components/primitives";
import { basename, type FileEntry } from "@/lib";
import { FileTree, type NewEntry } from "./file-tree";
import { DRAG_MIME } from "./folder-node";

type RootFolderProps = {
  path: string;
  activePath: string | null;
  onSelect: (path: string) => void;
  onMove?: (src: string, dstParent: string) => void;
  onContextMenu?: (e: React.MouseEvent, entry: FileEntry) => void;
  onClose: (path: string) => void;
  closeLabel: string;
  stagedPaths?: readonly string[];
  onToggleStage?: (path: string) => void;
  favoritePaths?: readonly string[];
  onToggleFavorite?: (path: string) => void;
  editingPath?: string | null;
  onSubmitRename?: (src: string, newName: string) => void;
  onCancelEdit?: () => void;
  newEntry?: NewEntry | null;
  onSubmitNew?: (parent: string, kind: "file" | "folder", name: string) => void;
  onCancelNew?: () => void;
  treeVersion?: number;
};

export function RootFolder({
  path,
  activePath,
  onSelect,
  onMove,
  onContextMenu,
  onClose,
  closeLabel,
  stagedPaths = [],
  onToggleStage,
  favoritePaths = [],
  onToggleFavorite,
  editingPath,
  onSubmitRename,
  onCancelEdit,
  newEntry,
  onSubmitNew,
  onCancelNew,
  treeVersion = 0,
}: RootFolderProps) {
  const [open, setOpen] = useState(true);
  const [isDropTarget, setIsDropTarget] = useState(false);
  const name = basename(path);

  // auto-open when a new entry is being created at this root
  useEffect(() => {
    if (newEntry && newEntry.parent === path && !open) setOpen(true);
  }, [newEntry, path, open]);

  const onDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    if (!onMove || !e.dataTransfer.types.includes(DRAG_MIME)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (!isDropTarget) setIsDropTarget(true);
  };

  const onDragLeave = () => {
    if (isDropTarget) setIsDropTarget(false);
  };

  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    setIsDropTarget(false);
    const src = e.dataTransfer.getData(DRAG_MIME);
    if (!src || !onMove) return;
    e.preventDefault();
    const sep = src.includes("\\") ? "\\" : "/";
    const srcParent = src.slice(0, src.lastIndexOf(sep));
    if (srcParent === path) return;
    onMove(src, path);
  };

  return (
    <section className="mdv-rootfolder">
      <div
        className={`mdv-rootfolder__header${isDropTarget ? " is-drop-target" : ""}`}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        <button
          type="button"
          className="mdv-rootfolder__toggle"
          onClick={() => setOpen((v) => !v)}
          title={path}
        >
          <span className={`mdv-tree__chevron${open ? " is-open" : ""}`}>
            <Icon icon={ChevronRight} size={12} strokeWidth={2} />
          </span>
          <span className="mdv-tree__icon">
            <Icon icon={open ? FolderOpen : Folder} size={13} strokeWidth={1.5} />
          </span>
          <span className="mdv-rootfolder__label">
            <span className="mdv-rootfolder__name">{name}</span>
            <span className="mdv-rootfolder__path">{path}</span>
          </span>
        </button>
        <button
          type="button"
          className="mdv-rootfolder__close"
          onClick={() => onClose(path)}
          data-tooltip={closeLabel}
          aria-label={closeLabel}
        >
          <Icon icon={X} size={12} strokeWidth={2} />
        </button>
      </div>
      {open ? (
        <FileTree
          rootPath={path}
          activePath={activePath}
          onSelect={onSelect}
          onMove={onMove}
          onContextMenu={onContextMenu}
          stagedPaths={stagedPaths}
          onToggleStage={onToggleStage}
          favoritePaths={favoritePaths}
          onToggleFavorite={onToggleFavorite}
          editingPath={editingPath}
          onSubmitRename={onSubmitRename}
          onCancelEdit={onCancelEdit}
          newEntry={newEntry}
          onSubmitNew={onSubmitNew}
          onCancelNew={onCancelNew}
          treeVersion={treeVersion}
          depth={1}
        />
      ) : null}
    </section>
  );
}
