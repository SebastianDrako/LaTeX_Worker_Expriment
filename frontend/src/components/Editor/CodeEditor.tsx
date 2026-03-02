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
import { Awareness, encodeAwarenessUpdate } from "y-protocols/awareness"; // Import encodeAwarenessUpdate
import { fetchYjsSnapshot, wsUrl } from "../../api/client";
import { RobustWebSocket } from "../../api/websocket"; // Import RobustWebSocket

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

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Generates a deterministic HSL color from a string (used for cursor colours). */
function colorFromName(name: string): string {
  let hash = 0;
  for (const ch of name) hash = Math.imul(31, hash) + ch.charCodeAt(0);
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 70%, 60%)`;
}

// ── Yjs collaboration setup ───────────────────────────────────────────────────

function createYjsExtensions(
  projectId: string,
  docName: string,
  snapshot: Uint8Array | null,
  initialContent: string,
  userName: string,
) {
  const ydoc = new Y.Doc();

  if (snapshot) {
    Y.applyUpdate(ydoc, snapshot);
  }

  const ytext = ydoc.getText(docName);
  const awareness = new Awareness(ydoc);

  const color = colorFromName(userName);
  awareness.setLocalStateField("user", {
    name: userName,
    color,
    colorLight: color.replace("60%)", "80%)"),
  });

  if (ytext.length === 0 && initialContent) {
    ydoc.transact(() => {
      ytext.insert(0, initialContent);
    }, "remote");
  }

  const ws = new RobustWebSocket(wsUrl(projectId, docName));

  ws.onopen = () => {
    // On connect or reconnect, send our current state to sync with peers.
    const stateUpdate = Y.encodeStateAsUpdate(ydoc);
    ws.send(stateUpdate as unknown as ArrayBuffer); // Cast via unknown
    // Also broadcast our awareness state.
    const awarenessUpdate = encodeAwarenessUpdate(awareness, [ydoc.clientID]);
    ws.send(awarenessUpdate as unknown as ArrayBuffer); // Cast via unknown
  };

  ws.onmessage = (event) => {
    if (event.data instanceof ArrayBuffer) {
      Y.applyUpdate(ydoc, new Uint8Array(event.data), "remote");
    }
    // text (JSON) messages are for PDF notifications, not Yjs — ignore here
  };

  ydoc.on("update", (update: Uint8Array, origin: unknown) => {
    if (origin !== "remote") {
      ws.send(update as unknown as ArrayBuffer); // Cast via unknown
    }
  });

  awareness.on("update", (update: { added: number[], updated: number[], removed: number[] }) => {
    const awarenessUpdate = encodeAwarenessUpdate(awareness, Object.keys(update).flatMap(key => update[key as keyof typeof update]));
    ws.send(awarenessUpdate as unknown as ArrayBuffer); // Cast via unknown
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
  userName: string;
  onChange?: (content: string) => void;
}

export function CodeEditor({ projectId, fileName, initialContent, userName, onChange }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    // Destroy previous editor instance when switching files.
    viewRef.current?.destroy();
    viewRef.current = null;
    cleanupRef.current?.();
    cleanupRef.current = null;

    // Capture values for the async init closure.
    const container = containerRef.current;
    const capturedContent = initialContent;
    let cancelled = false;

    async function init() {
      // Fetch the persisted Yjs snapshot before opening the WebSocket.
      // On error (network down, etc.) fall back gracefully to plain text.
      const snapshot = await fetchYjsSnapshot(projectId, fileName).catch(() => null);
      if (cancelled || !container) return;

      const { ytext, awareness, cleanup } = createYjsExtensions(
        projectId,
        fileName,
        snapshot,
        capturedContent,
        userName,
      );
      cleanupRef.current = cleanup;

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

      const view = new EditorView({ state, parent: container });
      viewRef.current = view;
    }

    void init();

    return () => {
      cancelled = true;
      viewRef.current?.destroy();
      viewRef.current = null;
      cleanupRef.current?.();
      cleanupRef.current = null;
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
