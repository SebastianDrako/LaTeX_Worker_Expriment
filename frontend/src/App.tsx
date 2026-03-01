import { useState } from "react";
import { ProjectList } from "./components/ProjectList";
import { EditorView } from "./components/Editor";
import { useAuth } from "./hooks/useAuth";
import type { Project } from "./types";

export function App() {
  const auth = useAuth();
  const [openProject, setOpenProject] = useState<Project | null>(null);

  if (auth.status === "loading") {
    return (
      <div
        style={{
          height: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--text-muted)",
        }}
      >
        Loading…
      </div>
    );
  }

  if (auth.status === "error") {
    return (
      <div
        style={{
          height: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 12,
          color: "var(--error)",
        }}
      >
        <strong>Authentication error</strong>
        <span style={{ color: "var(--text-muted)", fontSize: 12 }}>
          {auth.message}
        </span>
      </div>
    );
  }

  if (openProject) {
    return (
      <EditorView
        project={openProject}
        onBack={() => setOpenProject(null)}
      />
    );
  }

  return <ProjectList onOpen={setOpenProject} />;
}
