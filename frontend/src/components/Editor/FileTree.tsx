import { useRef } from "react";
import type { ProjectFile } from "../../types";

const FILE_ICON: Record<string, string> = {
  tex: "📄",
  bib: "📚",
  image: "🖼",
  pdf: "📑",
};

interface Props {
  files: ProjectFile[];
  selectedFile: ProjectFile | null;
  canWrite: boolean;
  onSelect: (file: ProjectFile) => void;
  onUpload: (file: File) => Promise<void>;
  onDelete: (fileName: string) => Promise<void>;
}

export function FileTree({
  files,
  selectedFile,
  canWrite,
  onSelect,
  onUpload,
  onDelete,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFileInput = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files ?? []);
    for (const f of picked) {
      await onUpload(f);
    }
    if (inputRef.current) inputRef.current.value = "";
  };

  const handleDelete = async (e: React.MouseEvent, name: string) => {
    e.stopPropagation();
    if (!confirm(`Delete "${name}"?`)) return;
    await onDelete(name);
  };

  return (
    <div className="file-tree">
      <div className="file-tree-header">
        <span>Files</span>
        {canWrite && (
          <div className="file-tree-actions">
            <button
              className="icon-btn"
              title="Upload file"
              onClick={() => inputRef.current?.click()}
            >
              ↑
            </button>
            <input
              ref={inputRef}
              type="file"
              multiple
              style={{ display: "none" }}
              onChange={(e) => void handleFileInput(e)}
            />
          </div>
        )}
      </div>

      <div className="file-list">
        {files.length === 0 && (
          <p style={{ padding: "12px", color: "var(--text-muted)", fontSize: 11 }}>
            No files yet. Upload a .tex file to get started.
          </p>
        )}
        {files.map((file) => (
          <div
            key={file.id}
            className={`file-item ${selectedFile?.id === file.id ? "active" : ""}`}
            onClick={() => onSelect(file)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === "Enter" && onSelect(file)}
          >
            <span className="file-icon">{FILE_ICON[file.type] ?? "📄"}</span>
            <span className="file-name" title={file.name}>
              {file.name}
            </span>
            {canWrite && file.type !== "pdf" && (
              <button
                className="file-delete"
                title={`Delete ${file.name}`}
                onClick={(e) => void handleDelete(e, file.name)}
              >
                ✕
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
