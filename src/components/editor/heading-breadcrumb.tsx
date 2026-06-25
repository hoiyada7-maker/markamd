import { useState, useMemo, useRef, useEffect, type RefObject } from "react";
import { ChevronRight, ChevronDown } from "lucide-react";
import { EditorView } from "@codemirror/view";

interface Heading {
  level: number;
  text: string;
  line: number;
}

interface HeadingNode {
  heading: Heading;
  children: HeadingNode[];
}

function parseHeadings(source: string): Heading[] {
  const lines = source.split("\n");
  const result: Heading[] = [];
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^```/.test(line)) { inFence = !inFence; continue; }
    if (inFence) continue;
    const m = line.match(/^(#{1,6})\s+(.+)/);
    if (m) result.push({ level: m[1].length, text: m[2].trim(), line: i + 1 });
  }
  return result;
}

function buildTree(headings: Heading[]): HeadingNode[] {
  const roots: HeadingNode[] = [];
  const stack: HeadingNode[] = [];
  for (const h of headings) {
    const node: HeadingNode = { heading: h, children: [] };
    while (stack.length > 0 && stack[stack.length - 1].heading.level >= h.level) {
      stack.pop();
    }
    if (stack.length === 0) {
      roots.push(node);
    } else {
      stack[stack.length - 1].children.push(node);
    }
    stack.push(node);
  }
  return roots;
}

function getCurrentPath(headings: Heading[], cursorLine: number): Heading[] {
  const path: Heading[] = [];
  for (const h of headings) {
    if (h.line > cursorLine) break;
    while (path.length > 0 && path[path.length - 1].level >= h.level) path.pop();
    path.push(h);
  }
  return path;
}

function trunc(text: string, max = 15): string {
  return text.length > max ? text.slice(0, max) + "…" : text;
}

type TocNodeProps = {
  node: HeadingNode;
  activeLine: number;
  ancestorLines: Set<number>;
  collapsed: Set<number>;
  onToggleCollapse: (line: number) => void;
  onJump: (line: number) => void;
  activeRef: RefObject<HTMLButtonElement | null>;
};

function TocNode({ node, activeLine, ancestorLines, collapsed, onToggleCollapse, onJump, activeRef }: TocNodeProps) {
  const { heading, children } = node;
  const isActive = heading.line === activeLine;
  const isAncestor = ancestorLines.has(heading.line);
  const hasChildren = children.length > 0;
  const isCollapsed = collapsed.has(heading.line);

  return (
    <li className="mdv-hbar__toc-node">
      <div
        className={`mdv-hbar__toc-row${isActive ? " is-active" : ""}${isAncestor ? " is-ancestor" : ""}`}
        style={{ paddingLeft: `${(heading.level - 1) * 14 + 4}px` }}
      >
        <button
          type="button"
          className="mdv-hbar__toc-fold"
          onClick={() => hasChildren && onToggleCollapse(heading.line)}
          aria-label={isCollapsed ? "펼치기" : "접기"}
          tabIndex={hasChildren ? 0 : -1}
        >
          {hasChildren ? (
            isCollapsed
              ? <ChevronRight size={11} strokeWidth={2} />
              : <ChevronDown size={11} strokeWidth={2} />
          ) : (
            <span className="mdv-hbar__toc-leaf-dot" />
          )}
        </button>
        <button
          ref={isActive ? activeRef : undefined}
          type="button"
          className="mdv-hbar__toc-label"
          onClick={() => onJump(heading.line)}
        >
          <span className="mdv-hbar__toc-marker">{"#".repeat(heading.level)}</span>
          <span className="mdv-hbar__toc-text">{heading.text}</span>
        </button>
      </div>
      {hasChildren && !isCollapsed && (
        <ul className="mdv-hbar__toc-children">
          {children.map((child) => (
            <TocNode
              key={child.heading.line}
              node={child}
              activeLine={activeLine}
              ancestorLines={ancestorLines}
              collapsed={collapsed}
              onToggleCollapse={onToggleCollapse}
              onJump={onJump}
              activeRef={activeRef}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

type Props = {
  source: string;
  cursorLine: number;
  viewRef: RefObject<EditorView | null>;
};

export function HeadingBreadcrumb({ source, cursorLine, viewRef }: Props) {
  const [tocOpen, setTocOpen] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  const rootRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLButtonElement | null>(null);

  const headings = useMemo(() => parseHeadings(source), [source]);
  const tree = useMemo(() => buildTree(headings), [headings]);
  const path = useMemo(() => getCurrentPath(headings, cursorLine), [headings, cursorLine]);
  const ancestorLines = useMemo(() => new Set(path.map((h) => h.line)), [path]);

  // scroll active item into view when TOC opens
  useEffect(() => {
    if (tocOpen && activeRef.current) {
      activeRef.current.scrollIntoView({ block: "nearest" });
    }
  }, [tocOpen]);

  // close on outside click
  useEffect(() => {
    if (!tocOpen) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setTocOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [tocOpen]);

  if (headings.length === 0) return null;

  const jumpTo = (line: number) => {
    const view = viewRef.current;
    if (!view) return;
    const lineObj = view.state.doc.line(Math.min(line, view.state.doc.lines));
    view.dispatch({
      selection: { anchor: lineObj.from },
      effects: EditorView.scrollIntoView(lineObj.from, { y: "start", yMargin: 40 }),
    });
    view.focus();
    setTocOpen(false);
  };

  const toggleCollapse = (line: number) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(line)) next.delete(line);
      else next.add(line);
      return next;
    });
  };

  const activeLine = path.length > 0 ? path[path.length - 1].line : -1;

  return (
    <div className="mdv-hbar" ref={rootRef}>
      <button
        type="button"
        className={`mdv-hbar__trigger${tocOpen ? " is-open" : ""}`}
        onClick={() => setTocOpen((v) => !v)}
        title="목차 보기"
      >
        {path.length === 0 ? (
          <span className="mdv-hbar__empty">—</span>
        ) : (
          path.map((h, i) => (
            <span key={h.line} className="mdv-hbar__crumb-row">
              {i > 0 && (
                <span className="mdv-hbar__chevron" aria-hidden>
                  <ChevronRight size={10} strokeWidth={2} />
                </span>
              )}
              <span className="mdv-hbar__crumb">{trunc(h.text)}</span>
            </span>
          ))
        )}
      </button>

      {tocOpen && (
        <div className="mdv-hbar__toc" role="tree">
          <ul className="mdv-hbar__toc-list">
            {tree.map((node) => (
              <TocNode
                key={node.heading.line}
                node={node}
                activeLine={activeLine}
                ancestorLines={ancestorLines}
                collapsed={collapsed}
                onToggleCollapse={toggleCollapse}
                onJump={jumpTo}
                activeRef={activeRef}
              />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
