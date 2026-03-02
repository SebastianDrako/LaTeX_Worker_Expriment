import { useRef, useState } from "react";
import type { CompileStatus } from "../../types";
import type { CollabUser } from "./CodeEditor";

interface Props {
  projectName: string;
  status: CompileStatus;
  isOwner: boolean;
  activeUsers: CollabUser[];
  onCompile: () => void;
  onBack: () => void;
  onShare: () => void;
  onRenameProject: (newName: string) => Promise<void>;
}

const STATUS_LABEL: Record<CompileStatus, string> = {
  idle: "",
  compiling: "Compiling…",
  success: "✓ Compiled",
  error: "✗ Error",
};

export function Toolbar({
  projectName,
  status,
  isOwner,
  activeUsers,
  onCompile,
  onBack,
  onShare,
  onRenameProject,
}: Props) {
  const isCompiling = status === "compiling";
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(projectName);
  const inputRef = useRef<HTMLInputElement>(null);

  const startRename = () => {
    if (!isOwner) return;
    setRenameValue(projectName);
    setRenaming(true);
    setTimeout(() => inputRef.current?.select(), 0);
  };

  const commitRename = async () => {
    setRenaming(false);
    const trimmed = renameValue.trim();
    if (!trimmed || trimmed === projectName) return;
    await onRenameProject(trimmed);
  };

  return (
    <div className="toolbar">
      <span
        className="toolbar-brand"
        onClick={onBack}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === "Enter" && onBack()}
        title="Back to projects"
      >
        LaTeX Worker
      </span>

      <span className="toolbar-project-name">
        {"/\u00a0"}
        {renaming ? (
          <input
            ref={inputRef}
            className="toolbar-rename-input"
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onBlur={() => void commitRename()}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); void commitRename(); }
              if (e.key === "Escape") setRenaming(false);
            }}
          />
        ) : (
          <span
            title={isOwner ? `${projectName} — double-click to rename` : projectName}
            onDoubleClick={isOwner ? startRename : undefined}
            style={{ cursor: isOwner ? "text" : "default" }}
          >
            {projectName}
          </span>
        )}
      </span>

      <span className="toolbar-spacer" />

      {/* Active collaborators */}
      {activeUsers.length > 0 && (
        <div className="presence-avatars" aria-label="Active collaborators">
          {activeUsers.map((u) => (
            <span
              key={u.name}
              className="presence-avatar"
              title={u.name}
              style={{ background: u.color }}
            >
              {u.name.charAt(0).toUpperCase()}
            </span>
          ))}
        </div>
      )}

      <span className={`toolbar-status ${status}`}>{STATUS_LABEL[status]}</span>

      {isOwner && (
        <button className="btn-ghost btn-share" onClick={onShare} title="Manage collaborators">
          Share
        </button>
      )}

      <button
        className="btn-compile"
        onClick={onCompile}
        disabled={isCompiling}
        title="Compile LaTeX (Ctrl+Enter)"
      >
        {isCompiling ? <span className="spinner" /> : "▶"}
        {isCompiling ? "Compiling" : "Compile"}
      </button>
    </div>
  );
}
