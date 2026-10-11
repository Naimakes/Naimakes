import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowUpRight,
  Eye,
  Globe,
  Heart,
  LoaderCircle,
  Lock,
  MessageCircle,
  MessageCircleOff,
  Megaphone,
  PenLine,
  Plus,
  Search,
  ShieldAlert,
  Trash2,
} from "lucide-react";
import { ModalRegistration as Modal } from "../motion/OverlayHost";
import { LiquidButton } from "../motion/LiquidButton";
import Confirm from "../ui/Confirm";
import { api, countLabel, timeAgo, type ManagedPost, type InsightMetric } from "../api";
import { InsightPanel } from "./InsightPanel";
import "./insights.css";

type Notify = (message: string, tone?: "success" | "error" | "info") => void;
type IconFor = (id: string) => typeof Eye;
const metrics: InsightMetric[] = ["views", "likes", "bookmarks", "comments", "followers"];

export default function PostManager({
  focusId,
  categoryName,
  iconFor,
  onClose,
  onOpenPost,
  onEditPost,
  onCompose,
  onChanged,
  notify,
}: {
  focusId?: string;
  categoryName: (id: string) => string;
  iconFor: IconFor;
  onClose: () => void;
  onOpenPost: (id: string) => void;
  onEditPost: (id: string) => void;
  onCompose: () => void;
  onChanged: () => void;
  notify: Notify;
}) {
  const [posts, setPosts] = useState<ManagedPost[] | null>(null);
  const [selected, setSelected] = useState(focusId || "");
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [locking, setLocking] = useState(false);
  const [lockReason, setLockReason] = useState("");
  const load = useCallback(
    () =>
      api<{ posts: ManagedPost[] }>("/insights/posts")
        .then((r) => {
          setPosts(r.posts);
          setError("");
          setSelected((id) => (r.posts.some((p) => p.id === id) ? id : r.posts[0]?.id || ""));
        })
        .catch((e) => setError((e as Error).message)),
    [],
  );
  useEffect(() => {
    load();
    const timer = setInterval(() => document.visibilityState === "visible" && load(), 20000);
    return () => clearInterval(timer);
  }, [load]);
  const current = posts?.find((p) => p.id === selected) || null;
  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (posts || []).filter((p) => !needle || p.title.toLowerCase().includes(needle) || categoryName(p.category).toLowerCase().includes(needle));
  }, [posts, query, categoryName]);
  const patchCurrent = (patch: Partial<ManagedPost>) =>
    setPosts((list) => list && list.map((p) => (p.id === selected ? { ...p, ...patch } : p)));
  async function run(key: string, work: () => Promise<unknown>, done: string) {
    setBusy(key);
    try {
      await work();
      notify(done, "success");
      onChanged();
      await load();
    } catch (e) {
      notify((e as Error).message, "error");
    } finally {
      setBusy("");
    }
  }
  const settings = (body: Record<string, unknown>, done: string) =>
    run("settings", () => api(`/posts/${current!.id}/settings`, { method: "PATCH", body: JSON.stringify(body) }), done);
  const lock = (locked: boolean, reason: string) =>
    run(
      "lock",
      async () => {
        await api(`/admin/posts/${current!.id}/lock`, { method: "PATCH", body: JSON.stringify({ locked, reason }) });
        setLocking(false);
      },
      locked ? "已禁言这篇帖子，新的评论与回复都会暂停" : "已解除这篇帖子的禁言",
    );
  const remove = () =>
    run(
      "delete",
      async () => {
        await api("/posts/" + current!.id, { method: "DELETE" });
        setConfirmDelete(false);
      },
      "讨论已删除",
    );
  const BoardIcon = current ? (current.kind === "announcement" ? Megaphone : iconFor(current.category)) : Eye;
  return (
    <Modal title="NAIMAKES / MY POSTS" wide onClose={onClose} className="insight-modal">
      <div className="admin-title">
        <div>
          <div className="eyebrow">EVERY IDEA LEAVES AN ECHO</div>
          <h2>管理帖子</h2>
          <p className="library-hint">查看每一篇讨论的阅读、点赞、收藏、评论与关注，也在这里编辑、关闭评论、禁言或删除。</p>
        </div>
        {posts && <span className="role-pill">共 {posts.length} 篇</span>}
      </div>
      {error && !posts ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : !posts ? (
        <div className="small-loading">
          <LoaderCircle className="spin" size={22} />
        </div>
      ) : !posts.length ? (
        <div className="empty-state compact">
          <PenLine size={36} strokeWidth={1} />
          <h3>还没有发布过讨论。</h3>
          <p>发布第一篇讨论后，就能在这里看到它的阅读与互动数据。</p>
          <LiquidButton className="button primary" onClick={onCompose}>
            <Plus size={16} />
            发起讨论
          </LiquidButton>
        </div>
      ) : (
        <div className="insight-layout">
          <aside className="insight-list" aria-label="我的讨论">
            <div className="admin-search insight-search">
              <Search size={16} />
              <input aria-label="搜索我的讨论" placeholder="按标题或版块查找" value={query} maxLength={60} onChange={(e) => setQuery(e.target.value)} />
            </div>
            <div className="insight-list-items" role="listbox" aria-label="选择讨论">
              {shown.map((p) => {
                const Icon = p.kind === "announcement" ? Megaphone : iconFor(p.category);
                return (
                  <LiquidButton
                    key={p.id}
                    type="button"
                    role="option"
                    aria-selected={p.id === selected}
                    className={`insight-item ${p.id === selected ? "is-selected" : ""}`}
                    onClick={() => setSelected(p.id)}
                  >
                    <span className="insight-item-kicker">
                      <Icon size={12} />
                      {p.kind === "announcement" ? "全站公告" : categoryName(p.category)}
                      <em>{timeAgo(p.created_at)}</em>
                    </span>
                    <strong>{p.title}</strong>
                    <span className="insight-item-stats">
                      <span>
                        <Eye size={12} />
                        {countLabel(p.views)}
                      </span>
                      <span>
                        <Heart size={12} />
                        {countLabel(p.likes)}
                      </span>
                      <span>
                        <MessageCircle size={12} />
                        {countLabel(p.comments)}
                      </span>
                    </span>
                  </LiquidButton>
                );
              })}
              {!shown.length && <p className="admin-empty">没有找到匹配的讨论。</p>}
            </div>
          </aside>
          {current && (
            <div className="insight-main">
              <header className="insight-head">
                <span className="insight-kicker">
                  <BoardIcon size={13} />
                  {current.kind === "announcement" ? "全站公告" : categoryName(current.category)}
                  <em>{timeAgo(current.created_at)}发布</em>
                  {current.visibility === "private" && (
                    <span className="private-label">
                      <Lock size={10} />
                      仅自己可见
                    </span>
                  )}
                  {current.comments_closed && (
                    <span className="private-label">
                      <MessageCircleOff size={10} />
                      评论已关闭
                    </span>
                  )}
                  {current.locked && (
                    <span className="private-label is-muted">
                      <ShieldAlert size={10} />
                      已禁言
                    </span>
                  )}
                </span>
                <h3>{current.title}</h3>
              </header>
              <InsightPanel
                endpoint={`/insights/posts/${encodeURIComponent(current.id)}`}
                metrics={metrics}
                onTotals={(totals) => {
                  const next = Object.fromEntries(metrics.map((m) => [m, totals[m] ?? 0]));
                  if (metrics.some((m) => next[m] !== current[m])) patchCurrent(next);
                }}
              />
              <section className="insight-actions" aria-label="帖子管理">
                <h4>帖子管理</h4>
                <div className="insight-action-grid">
                  <LiquidButton type="button" className="insight-action" onClick={() => onOpenPost(current.id)}>
                    <ArrowUpRight size={18} />
                    <span>
                      <strong>打开讨论</strong>
                      <small>回到正文与评论区</small>
                    </span>
                  </LiquidButton>
                  <LiquidButton type="button" className="insight-action" onClick={() => onEditPost(current.id)}>
                    <PenLine size={18} />
                    <span>
                      <strong>编辑讨论</strong>
                      <small>修改标题、正文与关键词</small>
                    </span>
                  </LiquidButton>
                  <LiquidButton
                    type="button"
                    className="insight-action"
                    disabled={busy === "settings"}
                    onClick={() =>
                      settings(
                        { comments_closed: !current.comments_closed },
                        current.comments_closed ? "评论区已重新开放" : "评论区已关闭，已有回复保持不变",
                      )
                    }
                  >
                    {current.comments_closed ? <MessageCircle size={18} /> : <MessageCircleOff size={18} />}
                    <span>
                      <strong>{current.comments_closed ? "开放评论" : "关闭评论"}</strong>
                      <small>{current.comments_closed ? "让大家继续回复" : "暂停接收新的评论"}</small>
                    </span>
                  </LiquidButton>
                  {current.kind !== "announcement" && (
                    <LiquidButton
                      type="button"
                      className="insight-action"
                      disabled={busy === "settings"}
                      onClick={() =>
                        settings(
                          { visibility: current.visibility === "private" ? "public" : "private" },
                          current.visibility === "private" ? "讨论已公开" : "讨论已设为仅自己可见",
                        )
                      }
                    >
                      {current.visibility === "private" ? <Globe size={18} /> : <Lock size={18} />}
                      <span>
                        <strong>{current.visibility === "private" ? "公开讨论" : "仅自己可见"}</strong>
                        <small>{current.visibility === "private" ? "所有人都能看到" : "暂时从社区隐藏"}</small>
                      </span>
                    </LiquidButton>
                  )}
                  {current.can_lock && (
                    <LiquidButton
                      type="button"
                      className={`insight-action ${current.locked ? "" : "is-caution"}`}
                      disabled={busy === "lock"}
                      onClick={() => {
                        if (current.locked) lock(false, "");
                        else {
                          setLockReason("");
                          setLocking(true);
                        }
                      }}
                    >
                      <ShieldAlert size={18} />
                      <span>
                        <strong>{current.locked ? "解除禁言" : "禁言此帖"}</strong>
                        <small>{current.locked ? "恢复评论与回复" : "所有人都不能再评论"}</small>
                      </span>
                    </LiquidButton>
                  )}
                  <LiquidButton type="button" className="insight-action is-danger" disabled={busy === "delete"} onClick={() => setConfirmDelete(true)}>
                    <Trash2 size={18} />
                    <span>
                      <strong>删除讨论</strong>
                      <small>连同全部回复一起移除</small>
                    </span>
                  </LiquidButton>
                </div>
              </section>
            </div>
          )}
        </div>
      )}
      {confirmDelete && current && (
        <Confirm
          title="删除讨论"
          heading="删除这篇讨论？"
          description={`「${current.title}」及其下全部回复将不再显示。`}
          confirmLabel="删除"
          cancelLabel="保留讨论"
          busy={busy === "delete"}
          onConfirm={remove}
          onClose={() => setConfirmDelete(false)}
        />
      )}
      {locking && current && (
        <Modal title="禁言这篇帖子" onClose={() => busy !== "lock" && setLocking(false)}>
          <h2>只停下这一篇的讨论。</h2>
          <p className="modal-note">
            禁言后，这篇帖子不再接收任何新的评论与回复——作者、其他成员，以及你自己都一样；已有内容保留，大家在别处发言不受影响。
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              lock(true, lockReason);
            }}
          >
            <label>
              处理说明（可留空）
              <textarea
                autoFocus
                value={lockReason}
                onChange={(e) => setLockReason(e.target.value)}
                maxLength={200}
                rows={3}
                placeholder="例如：讨论已偏离主题，暂时停止回复。"
              />
            </label>
            <LiquidButton className="button primary full-width" disabled={busy === "lock"}>
              禁言此帖
              <MessageCircleOff size={16} />
            </LiquidButton>
          </form>
        </Modal>
      )}
    </Modal>
  );
}
