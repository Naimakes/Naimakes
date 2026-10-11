import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { AlertTriangle, LoaderCircle, RotateCcw, Trash2 } from "lucide-react";
import { LiquidButton } from "../motion/LiquidButton";
import { api } from "../api";
import { ModalRegistration as Modal } from "../motion/OverlayHost";
import "./account-deletion.css";

type Account = { id: string; name: string };
type DeletionPreview = {
  account: Account;
  counts: {
    posts: number;
    comments: number;
    attachments: number;
    messages: number;
    collections: number;
    boards: number;
    boards_created: number;
  };
};

export default function AccountDeletion({ mode, target, onClose, onDeleted }: {
  mode: "self" | "admin";
  target: Account;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [preview, setPreview] = useState<DeletionPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [previewError, setPreviewError] = useState("");
  const [error, setError] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const submitting = useRef(false);
  const self = mode === "self";
  const endpoint = self ? "/me/account" : `/admin/users/${encodeURIComponent(target.id)}`;

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setLoading(true);
    setPreview(null);
    setPreviewError("");
    const timeout = setTimeout(() => controller.abort(), 20000);
    api<DeletionPreview>(`${endpoint}/deletion-preview`, { signal: controller.signal })
      .then((result) => {
        if (!active) return;
        const keys = ["posts", "comments", "attachments", "messages", "collections", "boards", "boards_created"] as const;
        if (result.account?.id !== target.id || !result.counts || !keys.every((key) => Number.isFinite(result.counts[key]) && result.counts[key] >= 0)) {
          throw new Error("账户内容核对失败，请重新加载。");
        }
        setPreview(result);
      })
      .catch((reason) => { if (active) setPreviewError((reason as Error).message); })
      .finally(() => { clearTimeout(timeout); if (active) setLoading(false); });
    return () => { active = false; clearTimeout(timeout); controller.abort(); };
  }, [endpoint, target.id, revision]);

  const close = useCallback(() => {
    if (!submitting.current) onClose();
  }, [onClose]);
  const ready = !!preview && !loading && (self ? password.length > 0 : confirmation.trim() === target.name);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current || !ready) return;
    submitting.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await api<{ ok: boolean }>(endpoint, {
        method: "DELETE",
        body: JSON.stringify(self ? { password, confirmation: "删除账号" } : { confirmation: confirmation.trim() }),
      });
      if (!result.ok) throw new Error("删除未完成，请重试。");
    } catch (reason) {
      setError((reason as Error).message);
      return;
    } finally {
      submitting.current = false;
      setBusy(false);
    }
    setPassword("");
    onDeleted();
  }

  const countRows = preview ? [
    ["帖子", preview.counts.posts],
    ["回复", preview.counts.comments],
    ["附件", preview.counts.attachments],
    ["私信", preview.counts.messages],
    ["收藏夹", preview.counts.collections],
    ["账户", 1],
  ] as const : [];

  return <Modal title={self ? "删除账户" : "删除用户"} onClose={close}
    motionKey={`delete-account-${target.id}`} className={`account-deletion-modal${busy ? " is-deleting" : ""}`}>
    <div className="account-deletion-heading">
      <span className="account-deletion-icon" aria-hidden="true"><AlertTriangle size={23} strokeWidth={1.6} /></span>
      <h2>{self ? "确认删除你的账户？" : "永久删除后将无法恢复，是否继续？"}</h2>
      <div className="account-deletion-target"><strong>{preview?.account.name || target.name}</strong><code>ID · {target.name}</code></div>
      <p>以下内容将被永久删除，无法恢复。</p>
    </div>

    {loading ? <p className="account-deletion-loading" role="status"><LoaderCircle className="spin" size={17} />正在核对账户内容…</p>
      : previewError ? <div className="account-deletion-preview-error">
        <p className="form-error" role="alert">{previewError}</p>
        <LiquidButton type="button" className="button secondary" onClick={() => setRevision((value) => value + 1)}><RotateCcw size={15} />重新加载</LiquidButton>
      </div> : preview && <>
        <dl className="account-deletion-counts" aria-label="将删除的内容">
          {countRows.map(([label, count]) => <div key={label}><dt>{label}</dt><dd>{count.toLocaleString("zh-CN")}</dd></div>)}
        </dl>
        <ul className="account-deletion-scope">
          <li>个人资料、登录会话和个人设置会一并清除。</li>
          <li>本人帖子下的关联内容也会删除；其他人的帖子保留。</li>
          <li>仍被其他内容引用的附件文件会保留。</li>
        </ul>
        <p className="account-deletion-preserved">创建的 {preview.counts.boards_created} 个版块会保留；担任版主的 {preview.counts.boards} 个版块将由站主代管。</p>
      </>}

    <form onSubmit={submit} className="account-deletion-form" aria-busy={busy}>
      {self ? <label>当前密码<input name="password" type="password" autoComplete="current-password" required
        maxLength={128} value={password} disabled={busy || loading || !preview} onChange={(event) => setPassword(event.target.value)}
        placeholder="输入当前密码" /></label>
        : <label>输入用户 ID 确认<input name="confirmation" type="text" autoComplete="off" autoCapitalize="none" spellCheck={false}
          required maxLength={128} value={confirmation} disabled={busy || loading || !preview} onChange={(event) => setConfirmation(event.target.value)}
          placeholder={target.name} /></label>}
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="account-deletion-actions">
        <LiquidButton type="button" className="button secondary" disabled={busy} onClick={close}>取消</LiquidButton>
        <LiquidButton type="submit" className="button danger account-delete-confirm" disabled={busy || !ready}>
          {busy ? <LoaderCircle size={16} className="spin" /> : <Trash2 size={16} />}
          {busy ? "正在删除…" : self ? "永久删除账户" : "永久删除用户"}
        </LiquidButton>
      </div>
    </form>
  </Modal>;
}
