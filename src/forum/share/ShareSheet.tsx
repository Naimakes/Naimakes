import { LiquidButton } from "../motion/LiquidButton";
import { useEffect, useState } from "react";
import { ArrowLeft, Check, Copy, Link2, LoaderCircle, LockKeyhole, LogIn, Search, Send, Share, X } from "lucide-react";
import { ModalRegistration as Modal } from "../motion/OverlayHost";
import Avatar from "../ui/Avatar";
import { RecentsPanel, useRecents } from "../search/Recents";
import { api, post as requestPost, type Member, type User } from "../api";
import { SharePreview } from "./ShareCard";
import { shareBlocked, shareLabels, sharePayload, shareUrl, type ShareTarget } from "./share-api";

const headings: Record<ShareTarget["type"], string> = {
  post: "把这篇，递给合适的人。",
  collection: "把这个收藏夹，递给合适的人。",
  board: "邀请合适的人，来这个版块看看。",
  message: "把这段话，转给合适的人。",
  notice: "把这条通知，转给合适的人。",
  assistant: "把这段对话，递给合适的人。",
};
const reasons: Record<ShareTarget["type"], string> = {
  post: "说说你为什么想让 TA 看到这篇。",
  collection: "说说这个收藏夹里有什么值得看。",
  board: "说说你为什么想邀请 TA 来这里。",
  message: "补充一句前因后果（可留空）。",
  notice: "补充一句说明（可留空）。",
  assistant: "说说你为什么想让 TA 看看这段对话。",
};
const verb = (target: ShareTarget) => (target.type === "message" || target.type === "notice" ? "转发" : "分享");

function shareText(target: ShareTarget) {
  if (target.type === "post") return target.post.title + "\n" + shareUrl(target);
  if (target.type === "collection") return `收藏夹「${target.collection.name}」\n` + shareUrl(target);
  if (target.type === "board") return `版块「${target.board.name}」\n` + shareUrl(target);
  if (target.type === "assistant") return `Naimakes 对话「${target.chat.title || "未命名对话"}」`;
  if (target.type === "message") return target.message.content;
  return target.notice.text + (target.notice.preview ? "\n" + target.notice.preview : "");
}

export default function ShareSheet({
  target,
  user,
  categoryName,
  onClose,
  onOpenChat,
  onLogin,
  notify,
}: {
  target: ShareTarget;
  user: User | null;
  categoryName: (id: string) => string;
  onClose: () => void;
  onOpenChat: (peerId: string) => void;
  onLogin: () => void;
  notify: (message: string, tone?: "success" | "error" | "info") => void;
}) {
  const [query, setQuery] = useState(""),
    [members, setMembers] = useState<Member[]>([]),
    [loading, setLoading] = useState(false),
    [person, setPerson] = useState<Member | null>(null),
    [note, setNote] = useState(""),
    [busy, setBusy] = useState(false),
    [done, setDone] = useState(false);
  const recents = useRecents("share", !!user);
  const blocked = shareBlocked(target);
  const url = shareUrl(target);
  const label = shareLabels[target.type];
  const muted = !!user?.muted;
  const canSend = !!user && !blocked;
  useEffect(() => {
    if (!canSend) return;
    let live = true;
    setLoading(true);
    const timer = setTimeout(() => {
      api("/members?" + new URLSearchParams({ q: query }))
        .then((r) => live && setMembers(r.members))
        .catch((e) => live && notify((e as Error).message, "error"))
        .finally(() => live && setLoading(false));
    }, 200);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [query, canSend]);
  async function copy() {
    const text = url || shareText(target);
    try {
      await navigator.clipboard.writeText(text);
      notify(url ? `${label}链接已复制` : "内容已复制", "success");
    } catch {
      notify((url ? `${label}链接：` : "") + text);
    }
  }
  async function systemShare() {
    try {
      await navigator.share({ title: shareText(target).split("\n")[0], url: url || undefined, text: url ? undefined : shareText(target) });
    } catch (e) {
      if ((e as Error).name !== "AbortError") copy();
    }
  }
  async function send() {
    if (!person) return;
    setBusy(true);
    try {
      await api("/messages/" + encodeURIComponent(person.id), requestPost({ content: note.trim(), ...sharePayload(target) }));
      recents.reload();
      setDone(true);
    } catch (e) {
      notify((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }
  const outside = target.type === "assistant" ? null : (
    <section className="share-section" aria-label="分享到站外">
      <h3>{url ? "复制链接，分享给站外的人" : "复制文字，发到站外"}</h3>
      <div className="share-link">
        {url ? <Link2 size={16} /> : <Copy size={16} />}
        <span className="share-link-url" title={url || undefined}>
          {url ? url.replace(/^https?:\/\//, "") : "只复制这段文字，不附带任何链接或身份"}
        </span>
        <LiquidButton type="button" className="button primary compact share-link-copy" onClick={copy}>
          <Copy size={14} />
          {url ? "复制链接" : "复制文字"}
        </LiquidButton>
      </div>
      {typeof navigator.share === "function" && (
        <LiquidButton type="button" className="button secondary share-copy-link" onClick={systemShare}>
          <Share size={15} />
          用系统分享发送
        </LiquidButton>
      )}
    </section>
  );
  if (done && person)
    return (
      <Modal title={`${verb(target)}成功`} onClose={onClose} className="share-modal">
        <div className="share-done">
          <span className="confirm-icon">
            <Check size={22} strokeWidth={1.8} />
          </span>
          <h2>已{verb(target)}给 {person.name}。</h2>
          <p>这{target.type === "post" ? "篇讨论" : `个${label}`}已经躺在你们的私信里，随时可以接着聊。</p>
        </div>
        <div className="confirm-actions">
          <LiquidButton type="button" className="button secondary" onClick={onClose}>
            继续浏览
          </LiquidButton>
          <LiquidButton type="button" className="button primary" onClick={() => onOpenChat(person.id)}>
            前往私信
            <Send size={15} />
          </LiquidButton>
        </div>
      </Modal>
    );
  if (person)
    return (
      <Modal title={`确认${verb(target)}`} onClose={onClose} className="share-modal">
        <LiquidButton type="button" className="button secondary share-back" onClick={() => setPerson(null)}>
          <ArrowLeft size={15} />
          换一个人
        </LiquidButton>
        <h2>发送给</h2>
        <div className="share-target">
          <Avatar name={person.name} initials={person.initials} avatar={person.avatar} />
          <span>
            <strong>{person.name}</strong>
            <small>{person.bio || "保持好奇，继续探索。"}</small>
          </span>
        </div>
        <SharePreview target={target} categoryName={categoryName} />
        <label className="share-note">
          附加信息（可留空）
          <textarea
            autoFocus
            rows={3}
            maxLength={500}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={reasons[target.type]}
          />
        </label>
        {muted && <p className="form-error">您已被禁言，暂时无法发送私信。</p>}
        <div className="confirm-actions">
          <LiquidButton type="button" className="button secondary" onClick={onClose}>
            取消
          </LiquidButton>
          <LiquidButton type="button" className="button primary" disabled={busy || muted} onClick={send}>
            {busy ? <LoaderCircle size={15} className="spin" /> : <Send size={15} />}
            发送
          </LiquidButton>
        </div>
      </Modal>
    );
  return (
    <Modal title={`${verb(target)}${label}`} onClose={onClose} className="share-modal">
      <h2>{headings[target.type]}</h2>
      <div className="share-preview">
        <SharePreview target={target} categoryName={categoryName} />
      </div>
      {target.type === "assistant" && (
        <p className="share-privacy">
          <LockKeyhole size={13} />
          对方会收到这段对话在此刻的快照，只有登录用户能打开，你随时可以在「历史对话」里取消分享。
        </p>
      )}
      {(target.type === "message" || target.type === "notice") && (
        <p className="share-privacy">
          <LockKeyhole size={13} />
          只转发这段文字，不附带原对话、对方身份或任何访问权限。
        </p>
      )}
      {blocked ? (
        <p className="share-blocked" role="status">
          <LockKeyhole size={15} />
          <span>{blocked}</span>
        </p>
      ) : !user ? (
        <>
          {outside}
          <section className="share-section" aria-label="发给站内成员">
            <h3>发给站内成员</h3>
            <div className="share-guest">
              <p>登录后可以把它直接发给站内的成员，对方会在私信里收到一张简介卡片。</p>
              <LiquidButton type="button" className="button secondary" onClick={onLogin}>
                <LogIn size={15} />
                登录后{verb(target)}
              </LiquidButton>
            </div>
          </section>
        </>
      ) : (
        <>
          {outside}
          <h3 className="share-section-title">发给站内成员</h3>
          <form className="search-input-wrap" role="search" onSubmit={(e) => e.preventDefault()}>
            <Search size={20} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索成员昵称或 ID…"
              aria-label={`搜索要${verb(target)}给的成员`}
              maxLength={60}
            />
            {query && (
              <LiquidButton type="button" className="icon-button" aria-label="清空搜索" onClick={() => setQuery("")}>
                <X size={15} />
              </LiquidButton>
            )}
          </form>
          <RecentsPanel
            scope="share"
            title="最近分享的人"
            items={recents.items}
            onItems={recents.setItems}
            onError={(message) => notify(message, "error")}
            onPick={(item) => item.user && setPerson(item.user)}
            renderItem={(item) => (
              <>
                <Avatar name={item.user?.name || item.label} initials={item.user?.initials || ""} avatar={item.user?.avatar || ""} />
                <span>{item.user?.name || item.label}</span>
              </>
            )}
          />
          <div className="share-results">
            {loading && !members.length ? (
              <div className="small-loading">
                <LoaderCircle className="spin" size={20} />
              </div>
            ) : !members.length ? (
              <p className="search-empty">没有找到这位成员，换个名字试试。</p>
            ) : (
              members.map((m) => (
                <LiquidButton key={m.id} type="button" className="share-result" onClick={() => setPerson(m)}>
                  <Avatar name={m.name} initials={m.initials} avatar={m.avatar} />
                  <span>
                    <strong>{m.name}</strong>
                    <small>{m.bio || "保持好奇，继续探索。"}</small>
                  </span>
                  <Send size={15} />
                </LiquidButton>
              ))
            )}
          </div>
        </>
      )}
    </Modal>
  );
}
