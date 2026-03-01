import { autocompletion, closeBrackets } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import {
  StreamLanguage,
  bracketMatching,
  indentOnInput,
} from "@codemirror/language";
import { search, searchKeymap } from "@codemirror/search";
import { EditorState } from "@codemirror/state";
import { oneDark } from "@codemirror/theme-one-dark";
import {
  EditorView,
  drawSelection,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
} from "@codemirror/view";
import { useEffect, useRef } from "react";
import * as Y from "yjs";
import { yCollab } from "y-codemirror.next";
import { Awareness } from "y-protocols/awareness";
import { wsUrl } from "../../api/client";

// ── Custom LaTeX StreamLanguage ───────────────────────────────────────────────
// Provides syntax highlighting without an external grammar package.

const latexLanguage = StreamLanguage.define<{ inMath: boolean }>({
  startState: () => ({ inMath: false }),

  token(stream, state) {
    // Line comment
    if (stream.match(/%/)) {
      stream.skipToEnd();
      return "comment";
    }

    // Math toggle: $$ or $
    if (stream.match(/\$\$/)) {
      state.inMath = !state.inMath;
      return "string";
    }
    if (stream.match(/\$/)) {
      state.inMath = !state.inMath;
      return "string";
    }

    if (state.inMath) {
      if (stream.match(/\\[a-zA-Z]+/)) return "keyword";
      stream.next();
      return "string";
    }

    // Commands: \word or \symbol
    if (stream.match(/\\[a-zA-Z]+\*?/)) return "keyword";
    if (stream.match(/\\/)) { stream.next(); return "keyword"; }

    // Braces
    if (stream.match(/[{}]/)) return "bracket";

    // Optional args
    if (stream.match(/\[[^\]]*\]/)) return "atom";

    // Environment name after \begin or \end
    if (stream.match(/\{[^}]*\}/)) return "atom";

    // Numbers
    if (stream.match(/\d+/)) return "number";

    stream.next();
    return null;
  },
});

// ── Yjs collaboration setup ───────────────────────────────────────────────────

function createYjsExtensions(projectId: string, docName: string) {
  const ydoc = new Y.Doc();
  const ytext = ydoc.getText(docName);
  const awareness = new Awareness(ydoc);

  const ws = new WebSocket(wsUrl(projectId));
  ws.binaryType = "arraybuffer";

  ws.onopen = () => {
    // Send our initial state so other peers can sync
    const stateUpdate = Y.encodeStateAsUpdate(ydoc);
    ws.send(stateUpdate);
  };

  ws.onmessage = (event) => {
    if (event.data instanceof ArrayBuffer) {
      Y.applyUpdate(ydoc, new Uint8Array(event.data));
    }
    // text (JSON) messages are for PDF notifications, not Yjs — ignore here
  };

  ydoc.on("update", (update: Uint8Array, origin: unknown) => {
    if (origin === "remote") return;
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(update);
    }
  });

  const cleanup = () => {
    awareness.destroy();
    ydoc.destroy();
    ws.close();
  };

  return { ytext, awareness, cleanup, ydoc };
}

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  projectId: string;
  fileName: string;
  initialContent: string;
  onChange?: (content: string) => void;
}

export function CodeEditor({ projectId, fileName, initialContent, onChange }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    // Destroy previous editor if switching files
    viewRef.current?.destroy();
    cleanupRef.current?.();

    const { ytext, awareness, cleanup, ydoc } = createYjsExtensions(projectId, fileName);
    cleanupRef.current = cleanup;

    // Bootstrap the Yjs text with the initial content from R2 (only if the
    // document is empty — prevents overwriting changes from other peers).
    ydoc.transact(() => {
      if (ytext.length === 0 && initialContent) {
        ytext.insert(0, initialContent);
      }
    }, "remote"); // mark as remote so we don't broadcast back

    const updateListener = EditorView.updateListener.of((update) => {
      if (update.docChanged && onChange) {
        onChange(update.state.doc.toString());
      }
    });

    const state = EditorState.create({
      doc: ytext.toString(),
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightActiveLine(),
        history(),
        drawSelection(),
        indentOnInput(),
        bracketMatching(),
        closeBrackets(),
        autocompletion(),
        search({ top: true }),
        latexLanguage,
        oneDark,
        keymap.of([
          indentWithTab,
          ...defaultKeymap,
          ...historyKeymap,
          ...searchKeymap,
        ]),
        yCollab(ytext, awareness),
        updateListener,
        EditorView.theme({
          "&": { height: "100%" },
          ".cm-scroller": { fontFamily: "var(--font-mono)", overflow: "auto" },
        }),
      ],
    });

    const view = new EditorView({ state, parent: containerRef.current });
    viewRef.current = view;

    return () => {
      view.destroy();
      cleanup();
    };
  // Re-create the editor when the project or file changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, fileName]);

  return (
    <div
      ref={containerRef}
      className="editor-panel"
      style={{ height: "100%", overflow: "hidden" }}
    />
  );
}
