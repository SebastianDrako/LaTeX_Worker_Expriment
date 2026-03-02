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
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate } from "y-protocols/awareness";
import { fetchYjsSnapshot, wsUrl } from "../../api/client";
import { RobustWebSocket } from "../../api/websocket";

// ── Custom LaTeX StreamLanguage ───────────────────────────────────────────────

const latexLanguage = StreamLanguage.define<{ inMath: boolean }>({
  startState: () => ({ inMath: false }),

  token(stream, state) {
    if (stream.match(/%/)) { stream.skipToEnd(); return "comment"; }
    if (stream.match(/\$\$/)) { state.inMath = !state.inMath; return "string"; }
    if (stream.match(/\$/)) { state.inMath = !state.inMath; return "string"; }

    if (state.inMath) {
      if (stream.match(/\\[a-zA-Z]+/)) return "keyword";
      stream.next();
      return "string";
    }

    if (stream.match(/\\[a-zA-Z]+\*?/)) return "keyword";
    if (stream.match(/\\/)) { stream.next(); return "keyword"; }
    if (stream.match(/[{}]/)) return "bracket";
    if (stream.match(/\[[^\]]*\]/)) return "atom";
    if (stream.match(/\{[^}]*\}/)) return "atom";
    if (stream.match(/\d+/)) return "number";

    stream.next();
    return null;
  },
});

// ── Helpers ───────────────────────────────────────────────────────────────────

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
  onUsersChange: ((users: CollabUser[]) => void) | undefined,
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

  // ── Outgoing ──────────────────────────────────────────────────────────────

  ws.onopen = () => {
    // Sync full doc state to the room on (re)connect.
    ws.send(Y.encodeStateAsUpdate(ydoc) as unknown as ArrayBuffer);
    // Announce our presence via JSON (DO relays text to all clients).
    const awarenessBytes = encodeAwarenessUpdate(awareness, [ydoc.clientID]);
    ws.send(JSON.stringify({ type: "awareness", data: Array.from(awarenessBytes) }));
  };

  // Doc changes → binary relay through DO (same-file clients only).
  ydoc.on("update", (update: Uint8Array, origin: unknown) => {
    if (origin !== "remote") {
      ws.send(update as unknown as ArrayBuffer);
    }
  });

  // Cursor/presence changes → JSON relay through DO (all clients).
  awareness.on("update", (
    { added, updated, removed }: { added: number[]; updated: number[]; removed: number[] },
    origin: unknown,
  ) => {
    if (origin === "remote") return; // don't re-broadcast what we received
    const ids = [...added, ...updated, ...removed];
    const awarenessBytes = encodeAwarenessUpdate(awareness, ids);
    ws.send(JSON.stringify({ type: "awareness", data: Array.from(awarenessBytes) }));
  });

  // ── Incoming ──────────────────────────────────────────────────────────────

  ws.onmessage = (event) => {
    if (event.data instanceof ArrayBuffer) {
      // Binary = Yjs doc update from another editor on the same file.
      Y.applyUpdate(ydoc, new Uint8Array(event.data), "remote");
    } else if (typeof event.data === "string") {
      try {
        const msg = JSON.parse(event.data) as { type?: string; data?: number[] };
        if (msg.type === "awareness" && Array.isArray(msg.data)) {
          applyAwarenessUpdate(awareness, new Uint8Array(msg.data), "remote");
        }
        // pdf_updated / files_updated are handled by usePdfReload — ignore here.
      } catch {
        // ignore malformed messages
      }
    }
  };

  // ── Presence updates for toolbar ─────────────────────────────────────────

  if (onUsersChange) {
    awareness.on("change", () => {
      const users: CollabUser[] = [];
      awareness.getStates().forEach((state, clientId) => {
        if (clientId !== ydoc.clientID && state.user) {
          users.push(state.user as CollabUser);
        }
      });
      onUsersChange(users);
    });
  }

  const cleanup = () => {
    awareness.destroy();
    ydoc.destroy();
    ws.close();
  };

  return { ytext, awareness, cleanup };
}

// ── Component ─────────────────────────────────────────────────────────────────

export interface CollabUser {
  name: string;
  color: string;
}

interface Props {
  projectId: string;
  fileName: string;
  initialContent: string;
  userName: string;
  onChange?: (content: string) => void;
  onUsersChange?: (users: CollabUser[]) => void;
}

export function CodeEditor({ projectId, fileName, initialContent, userName, onChange, onUsersChange }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const onUsersChangeRef = useRef(onUsersChange);
  onUsersChangeRef.current = onUsersChange;

  useEffect(() => {
    if (!containerRef.current) return;

    viewRef.current?.destroy();
    viewRef.current = null;
    cleanupRef.current?.();
    cleanupRef.current = null;

    const container = containerRef.current;
    const capturedContent = initialContent;
    let cancelled = false;

    async function init() {
      const snapshot = await fetchYjsSnapshot(projectId, fileName).catch(() => null);
      if (cancelled || !container) return;

      const { ytext, awareness, cleanup } = createYjsExtensions(
        projectId,
        fileName,
        snapshot,
        capturedContent,
        userName,
        onUsersChangeRef.current,
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
          keymap.of([indentWithTab, ...defaultKeymap, ...historyKeymap, ...searchKeymap]),
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
