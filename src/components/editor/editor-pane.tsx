import { useState, type RefObject } from "react";
import { EditorView } from "@codemirror/view";
import { Editor } from "./editor";
import { HeadingBreadcrumb } from "./heading-breadcrumb";

type EditorPaneProps = {
  value: string;
  onChange: (next: string) => void;
  vimOn?: boolean;
  onVimMode?: (mode: "normal" | "insert" | "visual" | "replace" | null) => void;
  viewRef: RefObject<EditorView | null>;
};

export function EditorPane({ value, onChange, vimOn, onVimMode, viewRef }: EditorPaneProps) {
  const [cursorLine, setCursorLine] = useState(1);

  return (
    <div className="mdv-editor-pane">
      <HeadingBreadcrumb source={value} cursorLine={cursorLine} viewRef={viewRef} />
      <Editor
        value={value}
        onChange={onChange}
        vimOn={vimOn}
        onVimMode={onVimMode}
        viewRef={viewRef}
        onCursorLine={setCursorLine}
      />
    </div>
  );
}
