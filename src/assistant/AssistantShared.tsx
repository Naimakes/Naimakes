import { useEffect, useState, type ComponentType } from "react";
import { ChevronLeft, X } from "lucide-react";
import { LiquidButton } from "../forum/motion/LiquidButton";
import "./assistant-details.css";
import { fetchShared, saveShared, useChat, type ChatMessage, type SharedChat } from "./chat";

type MessageView = ComponentType<{ message: ChatMessage; last: boolean; onLink: (href: string) => void; onRetry: () => void; who?: { name: string; shape: string; color: string } | null }>;

export default function AssistantShared({
  token,
  Message,
  onLink,
  onBack,
  onClose,
  onSaved,
}: {
  token: string;
  Message: MessageView;
  onLink: (href: string) => void;
  onBack: () => void;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { signedIn } = useChat();
  const [data, setData] = useState<SharedChat | string | null>(null);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!signedIn) return;
    let live = true;
    setData(null);
    void fetchShared(token).then((result) => live && setData(result));
    return () => {
      live = false;
    };
  }, [token, signedIn]);

  const save = async () => {
    setSaving(true);
    setFailed(false);
    if (await saveShared(token)) onSaved();
    else setFailed(true);
    setSaving(false);
  };

  return (
    <div className="assistant-view assistant-shared" role="region" aria-label="分享的对话">
      <header className="assistant-bar">
        <LiquidButton type="button" className="icon-button assistant-icon" aria-label="返回对话" title="返回" onClick={onBack}>
          <ChevronLeft size={18} />
        </LiquidButton>
        <h3>分享的对话</h3>
        <LiquidButton type="button" className="icon-button assistant-icon" aria-label="关闭" title="关闭" onClick={onClose}>
          <X size={16} />
        </LiquidButton>
      </header>

      {!signedIn ? (
        <div className="assistant-scroll">
          <p className="assistant-history-note">登录后才能查看别人分享的对话。</p>
        </div>
      ) : data === null ? (
        <div className="assistant-scroll">
          <p className="assistant-history-note">正在加载…</p>
        </div>
      ) : typeof data === "string" ? (
        <div className="assistant-scroll">
          <p className="assistant-history-note" role="alert">{data}</p>
        </div>
      ) : (
        <>
          <div className="assistant-shared-meta">
            <strong>{data.title || "未命名对话"}</strong>
            <small>
              {data.mine ? "这是你自己分享的对话" : `来自 ${data.author}`} · {new Date(data.shared_at).toLocaleDateString("zh-CN")}
            </small>
          </div>
          <div className="assistant-body">
            {data.messages.map((message, index) => {
              // 分享的对话里出现的智能体：群聊或非内置智能体的回答前标出是谁说的。
              const agent = message.role === "assistant" && message.agent ? data.agents?.find((a) => a.id === message.agent) : undefined;
              const named = agent && ((data.agents?.length ?? 0) > 1 || agent.id !== "naimakes");
              return <Message key={message.id} message={message} last={index === data.messages.length - 1} onLink={onLink} onRetry={() => {}} who={named ? agent : null} />;
            })}
          </div>
          <div className="assistant-shared-foot">
            {failed && <p role="alert">保存失败，请稍后再试。</p>}
            <button type="button" disabled={saving} onClick={save}>
              {data.mine ? "回到这段对话" : saving ? "正在保存…" : "保存到我的历史并继续聊"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
