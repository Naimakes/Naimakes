import { useEffect } from "react";
import { ChevronLeft, Trash2, X } from "lucide-react";
import { LiquidButton } from "../forum/motion/LiquidButton";
import "./assistant-details.css";
import { loadHistory, openChat, removeChat, useChat } from "./chat";

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

export default function AssistantHistory({ onBack, onClose, onOpened }: { onBack: () => void; onClose: () => void; onOpened: () => void }) {
  const { history, historyError, signedIn, id } = useChat();

  useEffect(() => {
    void loadHistory();
  }, [signedIn]);

  const open = async (target: string) => {
    if (await openChat(target)) onOpened();
  };

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
          <p className="assistant-history-note">登录后，对话会自动保存到你的账号，换设备也能在这里找回。</p>
        ) : history === null ? (
          <p className="assistant-history-note">{historyError || "正在加载…"}</p>
        ) : (
          <>
            {historyError && <p className="assistant-history-note" role="alert">{historyError}</p>}
            {history.length === 0 && !historyError && <p className="assistant-history-note">还没有历史对话。聊过之后，它们会出现在这里。</p>}
            <ul className="assistant-history-list">
              {history.map((item) => (
                <li key={item.id} className={item.id === id ? "current" : undefined}>
                  <button type="button" className="assistant-history-open" onClick={() => open(item.id)}>
                    <strong>{item.title || "未命名对话"}</strong>
                    <small>{when(item.updated_at)}</small>
                  </button>
                  <LiquidButton
                    type="button"
                    className="icon-button assistant-icon assistant-history-delete"
                    aria-label={`删除对话：${item.title || "未命名对话"}`}
                    title="删除"
                    onClick={() => {
                      if (confirm("删除这段对话？删除后无法恢复。")) void removeChat(item.id);
                    }}
                  >
                    <Trash2 size={15} />
                  </LiquidButton>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
