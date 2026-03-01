import { useEffect, useState } from "react";
import { createProject, deleteProject, listProjects } from "../../api/client";
import type { Project } from "../../types";

interface Props {
  onOpen: (project: Project) => void;
}

export function ProjectList({ onOpen }: Props) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    listProjects()
      .then(setProjects)
      .finally(() => setLoading(false));
  }, []);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const p = await createProject(newName.trim());
      setProjects((prev) => [p, ...prev]);
      setShowModal(false);
      setNewName("");
      onOpen(p);
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (e: React.MouseEvent, project: Project) => {
    e.stopPropagation();
    if (!confirm(`Delete "${project.name}"? This cannot be undone.`)) return;
    await deleteProject(project.id);
    setProjects((prev) => prev.filter((p) => p.id !== project.id));
  };

  return (
    <div className="project-list-page">
      <h1>LaTeX Worker</h1>
      <p className="subtitle">Your projects</p>

      {loading ? (
        <p style={{ color: "var(--text-muted)" }}>Loading…</p>
      ) : (
        <div className="project-grid">
          {projects.map((p) => (
            <div
              key={p.id}
              className="project-card"
              onClick={() => onOpen(p)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => e.key === "Enter" && onOpen(p)}
            >
              <h3>{p.name}</h3>
              <p className="meta">
                Updated {new Date(p.updated_at).toLocaleDateString()}
              </p>
              <button
                className="btn-ghost"
                style={{ marginTop: 12, fontSize: 11, padding: "3px 8px", color: "var(--error)" }}
                onClick={(e) => void handleDelete(e, p)}
              >
                Delete
              </button>
            </div>
          ))}

          <div
            className="project-card project-card-new"
            onClick={() => setShowModal(true)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === "Enter" && setShowModal(true)}
          >
            <span className="plus">＋</span>
            <span>New project</span>
          </div>
        </div>
      )}

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>New project</h2>
            <input
              type="text"
              placeholder="Project name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void handleCreate()}
              autoFocus
            />
            <div className="modal-actions">
              <button className="btn-ghost" onClick={() => setShowModal(false)}>
                Cancel
              </button>
              <button
                className="btn-primary"
                onClick={() => void handleCreate()}
                disabled={!newName.trim() || creating}
              >
                {creating ? "Creating…" : "Create"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
