import type { CompileStatus } from "../../types";

interface Props {
  projectName: string;
  status: CompileStatus;
  onCompile: () => void;
  onBack: () => void;
}

const STATUS_LABEL: Record<CompileStatus, string> = {
  idle: "",
  compiling: "Compiling…",
  success: "✓ Compiled",
  error: "✗ Error",
};

export function Toolbar({ projectName, status, onCompile, onBack }: Props) {
  const isCompiling = status === "compiling";

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

      <span className="toolbar-project-name" title={projectName}>
        / {projectName}
      </span>

      <span className="toolbar-spacer" />

      <span className={`toolbar-status ${status}`}>{STATUS_LABEL[status]}</span>

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
