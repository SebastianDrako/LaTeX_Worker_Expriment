import { useRef, useState } from "react";
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
  onCreate: (name: string) => Promise<void>;
  onDelete: (fileName: string) => Promise<void>;
  onRename: (oldName: string, newName: string) => Promise<void>;
}

export function FileTree({
  files,
  selectedFile,
  canWrite,
  onSelect,
  onUpload,
  onCreate,
  onDelete,
  onRename,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const renameInputRef = useRef<HTMLInputElement>(null);
  const [creatingFile, setCreatingFile] = useState(false);
  const [newFileName, setNewFileName] = useState("");
  const newFileInputRef = useRef<HTMLInputElement>(null);

  const handleFileInput = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files ?? []);
    for (const f of picked) {
      await onUpload(f);
    }
    if (inputRef.current) inputRef.current.value = "";
  };

  const startCreate = () => {
    setCreatingFile(true);
    setNewFileName("");
    setTimeout(() => newFileInputRef.current?.focus(), 0);
  };

  const commitCreate = async () => {
    const name = newFileName.trim();
    setCreatingFile(false);
    setNewFileName("");
    if (!name) return;
    await onCreate(name);
  };

  const handleDelete = async (e: React.MouseEvent, name: string) => {
    e.stopPropagation();
    if (!confirm(`Delete "${name}"?`)) return;
    await onDelete(name);
  };

  const startRename = (e: React.MouseEvent, file: ProjectFile) => {
    e.stopPropagation();
    setRenamingId(file.id);
    setRenameValue(file.name);
    // Focus the input on next tick after render
    setTimeout(() => renameInputRef.current?.select(), 0);
  };

  const commitRename = async (file: ProjectFile) => {
    const newName = renameValue.trim();
    setRenamingId(null);
    if (!newName || newName === file.name) return;
    await onRename(file.name, newName);
  };

  return (
    <div className="file-tree">
      <div className="file-tree-header">
        <span>Files</span>
        {canWrite && (
          <div className="file-tree-actions">
            <button
              className="icon-btn"
              title="New file"
              onClick={startCreate}
            >
              +
            </button>
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
        {creatingFile && (
          <div className="file-item">
            <span className="file-icon">📄</span>
            <input
              ref={newFileInputRef}
              className="file-rename-input"
              placeholder="filename.tex"
              value={newFileName}
              onChange={(e) => setNewFileName(e.target.value)}
              onBlur={() => void commitCreate()}
              onKeyDown={(e) => {
                if (e.key === "Enter") { e.preventDefault(); void commitCreate(); }
                if (e.key === "Escape") { setCreatingFile(false); setNewFileName(""); }
              }}
            />
          </div>
        )}
        {!creatingFile && files.length === 0 && (
          <p style={{ padding: "12px", color: "var(--text-muted)", fontSize: 11 }}>
            No files yet. Use + to create or ↑ to upload.
          </p>
        )}
        {files.map((file) => (
          <div
            key={file.id}
            className={`file-item ${selectedFile?.id === file.id ? "active" : ""}`}
            onClick={() => renamingId !== file.id && onSelect(file)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === "Enter" && renamingId !== file.id && onSelect(file)}
          >
            <span className="file-icon">{FILE_ICON[file.type] ?? "📄"}</span>

            {renamingId === file.id ? (
              <input
                ref={renameInputRef}
                className="file-rename-input"
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onBlur={() => void commitRename(file)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") { e.preventDefault(); void commitRename(file); }
                  if (e.key === "Escape") { setRenamingId(null); }
                }}
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <span
                className="file-name"
                title={canWrite ? `${file.name} — double-click to rename` : file.name}
                onDoubleClick={canWrite && file.type !== "pdf" ? (e) => startRename(e, file) : undefined}
              >
                {file.name}
              </span>
            )}

            {canWrite && file.type !== "pdf" && renamingId !== file.id && (
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
