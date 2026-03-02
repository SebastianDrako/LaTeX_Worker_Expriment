import { useCallback, useEffect, useRef, useState } from "react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { getFileContent, uploadFile } from "../../api/client";
import { useAuth } from "../../hooks/useAuth";
import { useCompile } from "../../hooks/useCompile";
import { usePdfReload } from "../../hooks/usePdfReload";
import { useProject, useSelectedFile } from "../../hooks/useProject";
import type { Project } from "../../types";
import { CodeEditor, type CollabUser } from "./CodeEditor";
import { FileTree } from "./FileTree";
import { PdfViewer } from "./PdfViewer";
import { ShareModal } from "./ShareModal";
import { Toolbar } from "./Toolbar";

interface Props {
  project: Project;
  onBack: () => void;
}

export function EditorView({ project, onBack }: Props) {
  const auth = useAuth();
  const userName = auth.status === "authenticated" ? auth.user.name : "Anonymous";

  const { project: detail, uploadFile: doUpload, createFile, deleteFile, renameFile, renameProjectName, reload } = useProject(project.id);
  const { selectedFile, setSelectedFile } = useSelectedFile(detail?.files ?? []);

  const [fileContent, setFileContent] = useState<string | null>(null);
  const [pdfReload, setPdfReload] = useState(0);
  const [showShare, setShowShare] = useState(false);
  const [activeUsers, setActiveUsers] = useState<CollabUser[]>([]);

  const { status, errorLog, compile } = useCompile(project.id);
  const canWrite = detail?.role === "owner" || detail?.role === "editor";

  // Auto-save: debounce content changes and write back to R2
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleContentChange = useCallback(
    (content: string) => {
      if (!selectedFile || !canWrite) return;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        void uploadFile(
          project.id,
          selectedFile.name,
          content,
          "text/plain",
        );
      }, 1500);
    },
    [selectedFile, canWrite, project.id],
  );

  // Load file content when selection changes
  useEffect(() => {
    if (!selectedFile) return;
    if (selectedFile.type === "image" || selectedFile.type === "pdf") {
      setFileContent("");
      return;
    }
    setFileContent(null); // reset while loading so CodeEditor remounts with real content
    getFileContent(project.id, selectedFile.name)
      .then(setFileContent)
      .catch(() => setFileContent(""));
  }, [project.id, selectedFile]);

  // PDF auto-reload + file tree sync via WebSocket
  usePdfReload(
    project.id,
    () => setPdfReload((n) => n + 1),
    () => void reload(),
  );

  // Keyboard shortcut: Ctrl+Enter to compile
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        void compile();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [compile]);

  const isEditable =
    selectedFile &&
    selectedFile.type !== "image" &&
    selectedFile.type !== "pdf";

  return (
    <div className="editor-layout">
      <Toolbar
        projectName={detail?.name ?? project.name}
        status={status}
        isOwner={detail?.role === "owner"}
        activeUsers={activeUsers}
        onCompile={() => void compile()}
        onBack={onBack}
        onShare={() => setShowShare(true)}
        onRenameProject={renameProjectName}
      />

      <div className="main-area">
        <PanelGroup direction="horizontal" style={{ flex: 1 }}>
          {/* File tree */}
          <Panel defaultSize={18} minSize={10} maxSize={35}>
            <FileTree
              files={detail?.files ?? []}
              selectedFile={selectedFile}
              canWrite={canWrite}
              onSelect={setSelectedFile}
              onUpload={doUpload}
              onCreate={createFile}
              onDelete={deleteFile}
              onRename={renameFile}
            />
          </Panel>

          <PanelResizeHandle style={{ width: 4 }} />

          {/* Editor */}
          <Panel defaultSize={41} minSize={20}>
            {isEditable && fileContent !== null ? (
              <CodeEditor
                projectId={project.id}
                fileName={selectedFile.name}
                initialContent={fileContent}
                userName={userName}
                onChange={handleContentChange}
                onUsersChange={setActiveUsers}
              />
            ) : (
              <div
                className="editor-panel"
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "var(--text-muted)",
                  fontSize: 13,
                }}
              >
                {selectedFile
                  ? `${selectedFile.name} — binary file, cannot edit`
                  : "Select a file to edit"}
              </div>
            )}
          </Panel>

          <PanelResizeHandle style={{ width: 4 }} />

          {/* PDF viewer */}
          <Panel defaultSize={41} minSize={20}>
            <PdfViewer projectId={project.id} projectName={project.name} reloadSignal={pdfReload} />
          </Panel>
        </PanelGroup>
      </div>

      {/* Error log panel */}
      {status === "error" && errorLog && (
        <div className="error-log-panel">{errorLog}</div>
      )}

      {/* Share modal */}
      {showShare && (
        <ShareModal
          projectId={project.id}
          projectName={project.name}
          onClose={() => setShowShare(false)}
        />
      )}
    </div>
  );
}
