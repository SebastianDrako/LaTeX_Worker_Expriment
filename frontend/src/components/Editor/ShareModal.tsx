import { useEffect, useRef, useState } from "react";
import { addMember, getMembers, removeMember, updateMemberRole } from "../../api/client";
import type { Member } from "../../types";

interface Props {
  projectId: string;
  projectName: string;
  onClose: () => void;
}

const ROLE_LABEL: Record<Member["role"], string> = {
  owner: "Owner",
  editor: "Editor",
  viewer: "Viewer",
};

export function ShareModal({ projectId, projectName, onClose }: Props) {
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"editor" | "viewer">("editor");
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const emailRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    getMembers(projectId)
      .then(setMembers)
      .finally(() => setLoading(false));
  }, [projectId]);

  useEffect(() => {
    emailRef.current?.focus();
  }, []);

  const handleInvite = async () => {
    if (!inviteEmail.trim()) return;
    setInviting(true);
    setInviteError(null);
    try {
      await addMember(projectId, inviteEmail.trim(), inviteRole);
      const updated = await getMembers(projectId);
      setMembers(updated);
      setInviteEmail("");
    } catch (e) {
      setInviteError(e instanceof Error ? e.message : "Failed to invite");
    } finally {
      setInviting(false);
    }
  };

  const handleRoleChange = async (userId: string, newRole: "editor" | "viewer") => {
    await updateMemberRole(projectId, userId, newRole);
    setMembers((prev) =>
      prev.map((m) => (m.user_id === userId ? { ...m, role: newRole } : m)),
    );
  };

  const handleRemove = async (userId: string) => {
    await removeMember(projectId, userId);
    setMembers((prev) => prev.filter((m) => m.user_id !== userId));
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal share-modal" onClick={(e) => e.stopPropagation()}>
        <h2>Share "{projectName}"</h2>

        {/* Member list */}
        <div className="share-member-list">
          {loading && <p className="share-empty">Loading…</p>}
          {!loading && members.length === 0 && (
            <p className="share-empty">No members yet.</p>
          )}
          {members.map((m) => (
            <div key={m.user_id} className="share-member-row">
              <div className="share-member-info">
                <span className="share-member-name">{m.name}</span>
                <span className="share-member-email">{m.email}</span>
              </div>

              {m.role === "owner" ? (
                <span className="share-role-badge owner">Owner</span>
              ) : (
                <>
                  <select
                    className="share-role-select"
                    value={m.role}
                    onChange={(e) =>
                      void handleRoleChange(m.user_id, e.target.value as "editor" | "viewer")
                    }
                  >
                    <option value="editor">{ROLE_LABEL.editor}</option>
                    <option value="viewer">{ROLE_LABEL.viewer}</option>
                  </select>
                  <button
                    className="share-remove-btn"
                    onClick={() => void handleRemove(m.user_id)}
                    title="Remove member"
                  >
                    ✕
                  </button>
                </>
              )}
            </div>
          ))}
        </div>

        {/* Invite row */}
        <div className="share-invite-row">
          <input
            ref={emailRef}
            type="email"
            placeholder="email@example.com"
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void handleInvite()}
            className="share-invite-input"
          />
          <select
            className="share-role-select"
            value={inviteRole}
            onChange={(e) => setInviteRole(e.target.value as "editor" | "viewer")}
          >
            <option value="editor">Editor</option>
            <option value="viewer">Viewer</option>
          </select>
          <button
            className="btn-primary"
            onClick={() => void handleInvite()}
            disabled={inviting || !inviteEmail.trim()}
          >
            {inviting ? "…" : "Invite"}
          </button>
        </div>

        {inviteError && <p className="share-error">{inviteError}</p>}

        <div className="modal-actions" style={{ marginTop: 16 }}>
          <button className="btn-ghost" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
