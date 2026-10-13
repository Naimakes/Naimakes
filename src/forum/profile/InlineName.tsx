import { useRef, useState } from "react";
import { api, type User } from "../api";
import { NameTakenDialog, isNameTaken, refocusField, useNameAvailability } from "./NameField";
import "./inline-name.css";

export default function InlineName({ user, onUser, notify }: {
  user: User;
  onUser: (next: User) => void;
  notify: (text: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(user.name);
  const [saving, setSaving] = useState(false);
  const [taken, setTaken] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const availability = useNameAvailability(draft, { enabled: editing, own: user.name });

  const cancel = () => { setEditing(false); setDraft(user.name); };
  async function commit() {
    const next = draft.trim();
    if (saving || taken !== null) return;
    if (next === user.name || next.length < 2) return cancel();
    if (availability.state === "taken") return setTaken(next);
    setSaving(true);
    try {
      const r = await api<{ user: User }>("/me", {
        method: "PATCH",
        body: JSON.stringify({ name: next, email: user.email, bio: user.bio, avatar: user.avatar }),
      });
      onUser(r.user);
      setEditing(false);
      notify("昵称已更新");
    } catch (e) {
      if (isNameTaken(e)) {
        availability.markTaken(next);
        setTaken(next);
      } else {
        notify((e as Error).message);
        cancel();
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      {editing ? (
        <input
          ref={input}
          className="inline-name-input"
          aria-label="昵称"
          value={draft}
          autoFocus
          minLength={2}
          maxLength={24}
          disabled={saving}
          aria-invalid={availability.state === "taken" || undefined}
          size={Math.max(4, Array.from(draft).length + 1)}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => void commit()}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;
            if (event.key === "Enter") { event.preventDefault(); void commit(); }
            if (event.key === "Escape") { event.preventDefault(); cancel(); }
          }}
        />
      ) : (
        <button type="button" className="inline-name-button" title="点击修改昵称" onClick={() => { setDraft(user.name); setEditing(true); }}>
          {user.name}
        </button>
      )}
      {taken !== null && (
        <NameTakenDialog
          name={taken}
          context="profile"
          onClose={() => { setTaken(null); refocusField(input.current); }}
        />
      )}
    </>
  );
}
