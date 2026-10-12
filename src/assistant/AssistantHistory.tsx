import { useEffect, useState } from "react";
import { ChevronLeft, Eye, EyeOff, Pin, Share2, Star, Trash2, X } from "lucide-react";
import { LiquidButton } from "../forum/motion/LiquidButton";
import "./assistant-details.css";
import { loadHistory, openChat, removeChat, shareChat, unshareChat, updateChat, useChat, type HistoryItem } from "./chat";

function when(at: number) {
  const date = new Date(at);
  const now = new Date();
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const gap = Math.round((day(now) - day(date)) / 86400000);
  const clock = date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
  if (gap <= 0) return "今天 " + clock;
  if (gap === 1) return "昨天 " + clock;
  if (gap < 7) return gap + " 天前";
  return date.toLocaleDateString("zh-CN", { year: date.getFullYear() === now.getFullYear() ? undefined : "numeric", month: "numeric", day: "numeric" });
}

type Tab = "all" | "favorite" | "hidden";
const tabs: { id: Tab; label: string }[] = [
  { id: "all", label: "全部" },
  { id: "favorite", label: "收藏" },
  { id: "hidden", label: "已隐藏" },
];
const visibleIn = (tab: Tab, item: HistoryItem) => (tab === "hidden" ? item.hidden : tab === "favorite" ? item.favorite && !item.hidden : !item.hidden);
const empty: Record<Tab, string> = {
  all: "还没有历史对话。聊过之后，它们会出现在这里。",
  favorite: "还没有收藏的对话。点对话下方的星标即可收藏。",
  hidden: "没有被隐藏的对话。",
};

export default function AssistantHistory({
  onBack,
  onClose,
  onOpened,
  onShare,
}: {
  onBack: () => void;
  onClose: () => void;
  onOpened: () => void;
  onShare: (chat: { id: string; title: string; count: number }) => void;
}) {
  const { history, historyError, signedIn, id } = useChat();
  const [tab, setTab] = useState<Tab>("all");
  const [panel, setPanel] = useState<{ id: string; note: string } | null>(null);

  useEffect(() => {
    void loadHistory();
  }, [signedIn]);

  const open = async (target: string) => {
    if (await openChat(target)) onOpened();
  };

  const copy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      return true;
    } catch {
      return false;
    }
  };
  const copyLink = async (item: HistoryItem) => {
    const url = await shareChat(item.id);
    if (!url) return;
    setPanel({ id: item.id, note: (await copy(url)) ? "链接已复制。" : url });
  };

  const list = history?.filter((item) => visibleIn(tab, item)) ?? [];

  return (
    <div className="assistant-view assistant-history" role="region" aria-label="历史对话">
      <header className="assistant-bar">
        <LiquidButton type="button" className="icon-button assistant-icon" aria-label="返回对话" title="返回" onClick={onBack}>
          <ChevronLeft size={18} />
        </LiquidButton>
        <h3>历史对话</h3>
        <LiquidButton type="button" className="icon-button assistant-icon" aria-label="关闭" title="关闭" onClick={onClose}>
          <X size={16} />
        </LiquidButton>
      </header>

      <div className="assistant-scroll">
        {!signedIn ? (
          <p className="assistant-history-note">登录后，对话会自动保存到你的账号，换设备也能在这里找回，还能分享给其他用户。</p>
        ) : history === null ? (
          <p className="assistant-history-note">{historyError || "正在加载…"}</p>
        ) : (
          <>
            <div className="assistant-history-tabs" role="tablist" aria-label="筛选">
              {tabs.map((t) => (
                <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={tab === t.id ? "active" : undefined} onClick={() => setTab(t.id)}>
                  {t.label}
                </button>
              ))}
            </div>
            {historyError && <p className="assistant-history-note" role="alert">{historyError}</p>}
            {list.length === 0 && !historyError && <p className="assistant-history-note">{empty[tab]}</p>}
            <ul className="assistant-history-list">
              {list.map((item) => {
                const name = item.title || "未命名对话";
                return (
                  <li key={item.id} className={item.id === id ? "current" : undefined}>
                    <button type="button" className="assistant-history-open" onClick={() => open(item.id)}>
                      <strong>
                        {item.pinned && <Pin size={12} aria-label="已置顶" />}
                        {item.favorite && <Star size={12} aria-label="已收藏" />}
                        {name}
                      </strong>
                      <small>
                        {when(item.updated_at)}
                        {item.shared ? " · 已分享" : ""}
                      </small>
                    </button>
                    <div className="assistant-history-actions">
                      <LiquidButton type="button" className={"icon-button assistant-icon" + (item.pinned ? " is-on" : "")} aria-pressed={item.pinned} aria-label={(item.pinned ? "取消置顶：" : "置顶：") + name} title={item.pinned ? "取消置顶" : "置顶"} onClick={() => updateChat(item.id, { pinned: !item.pinned })}>
                        <Pin size={15} />
                      </LiquidButton>
                      <LiquidButton type="button" className={"icon-button assistant-icon" + (item.favorite ? " is-on" : "")} aria-pressed={item.favorite} aria-label={(item.favorite ? "取消收藏：" : "收藏：") + name} title={item.favorite ? "取消收藏" : "收藏"} onClick={() => updateChat(item.id, { favorite: !item.favorite })}>
                        <Star size={15} />
                      </LiquidButton>
                      <LiquidButton type="button" className={"icon-button assistant-icon" + (item.shared ? " is-on" : "")} aria-label={"分享：" + name} title="分享给其他用户" onClick={() => setPanel(panel?.id === item.id ? null : { id: item.id, note: "" })}>
                        <Share2 size={15} />
                      </LiquidButton>
                      <LiquidButton type="button" className="icon-button assistant-icon" aria-label={(item.hidden ? "取消隐藏：" : "隐藏：") + name} title={item.hidden ? "取消隐藏" : "隐藏"} onClick={() => updateChat(item.id, { hidden: !item.hidden })}>
                        {item.hidden ? <Eye size={15} /> : <EyeOff size={15} />}
                      </LiquidButton>
                      <LiquidButton
                        type="button"
                        className="icon-button assistant-icon"
                        aria-label={"删除对话：" + name}
                        title="删除"
                        onClick={() => {
                          if (confirm("删除这段对话？删除后无法恢复，已分享的链接也会失效。")) void removeChat(item.id);
                        }}
                      >
                        <Trash2 size={15} />
                      </LiquidButton>
                    </div>
                    {panel?.id === item.id && (
                      <div className="assistant-history-share">
                        <p>{panel.note || "分享的是此刻这段对话的快照，之后的新消息不会同步；只有登录用户能打开。"}</p>
                        <div>
                          <button type="button" onClick={() => copyLink(item)}>复制分享链接</button>
                          <button type="button" onClick={() => onShare({ id: item.id, title: item.title, count: item.count })}>发给站内成员</button>
                          {item.shared && (
                            <button
                              type="button"
                              onClick={() => {
                                void unshareChat(item.id);
                                setPanel(null);
                              }}
                            >
                              取消分享
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
