import { useState } from "react";
import { Check, ChevronLeft, Settings2, Star, UserRound, UsersRound, X } from "lucide-react";
import { LiquidButton } from "../forum/motion/LiquidButton";
import { AgentAvatar } from "./AgentAvatar";
import { MAX_GROUP, useAgents, type Agent } from "./agents";
import "./assistant-details.css";
import "./assistant-agents.css";

type Mode = "single" | "group";

const blurb = (agent: Agent) => (agent.builtin ? "站内小助理，了解本站内容和功能" : agent.instructions.trim().replace(/\s+/g, " ").slice(0, 40) || "还没有设定指令");

// 新建聊天：先选和谁聊——一个智能体单聊，或者挑两三个一起建群聊。
export default function AssistantNewChat({
  onBack,
  onClose,
  onStart,
  onManage,
}: {
  onBack: () => void;
  onClose: () => void;
  onStart: (agents: string[]) => void;
  onManage: () => void;
}) {
  const { agents, mainId } = useAgents();
  const [mode, setMode] = useState<Mode>("single");
  const [picked, setPicked] = useState<string[]>([]);

  const toggle = (id: string) => setPicked((list) => (list.includes(id) ? list.filter((x) => x !== id) : list.length >= MAX_GROUP ? list : [...list, id]));
  const ready = picked.length >= 2;

  return (
    <div className="assistant-view assistant-newchat" role="region" aria-label="新建聊天">
      <header className="assistant-bar">
        <LiquidButton type="button" className="icon-button assistant-icon" aria-label="返回对话" title="返回" onClick={onBack}>
          <ChevronLeft size={18} />
        </LiquidButton>
        <h3>新建聊天</h3>
        <LiquidButton type="button" className="icon-button assistant-icon" aria-label="关闭" title="关闭" onClick={onClose}>
          <X size={16} />
        </LiquidButton>
      </header>

      <div className="assistant-scroll">
        <div className="assistant-history-tabs" role="tablist" aria-label="聊天类型">
          <button type="button" role="tab" aria-selected={mode === "single"} className={mode === "single" ? "active" : undefined} onClick={() => setMode("single")}>
            <UserRound size={13} aria-hidden="true" /> 单聊
          </button>
          <button type="button" role="tab" aria-selected={mode === "group"} className={mode === "group" ? "active" : undefined} onClick={() => setMode("group")}>
            <UsersRound size={13} aria-hidden="true" /> 群聊
          </button>
        </div>
        <p className="assistant-manage-intro">
          {mode === "single" ? "选一个智能体，开始一段新的对话。" : `选 ${2}–${MAX_GROUP} 个智能体拉成群聊，它们会轮流回答；在群聊里用 @名字 可以只让某个智能体回答。`}
        </p>

        <ul className="agent-pick-list">
          {agents.map((agent) => {
            const on = picked.includes(agent.id);
            const full = mode === "group" && !on && picked.length >= MAX_GROUP;
            return (
              <li key={agent.id}>
                <button
                  type="button"
                  className={"agent-pick" + (on ? " is-on" : "")}
                  disabled={full}
                  aria-pressed={mode === "group" ? on : undefined}
                  onClick={() => (mode === "single" ? onStart([agent.id]) : toggle(agent.id))}
                >
                  <AgentAvatar agent={agent} size={42} />
                  <span className="agent-pick-text">
                    <strong>
                      {agent.name}
                      {agent.id === mainId && (
                        <em>
                          <Star size={10} aria-hidden="true" /> 主智能体
                        </em>
                      )}
                    </strong>
                    <small>{blurb(agent)}</small>
                  </span>
                  {mode === "group" && (
                    <span className="agent-pick-check" aria-hidden="true">
                      {on && <Check size={13} strokeWidth={3} />}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>

        {mode === "group" && agents.length < 2 && <p className="assistant-history-note">至少需要两个智能体才能建群聊，先去新建一个吧。</p>}

        {mode === "group" && (
          <LiquidButton type="button" className="assistant-chip is-primary agent-start" disabled={!ready} onClick={() => onStart(picked)}>
            {ready ? `开始群聊（${picked.length} 个智能体）` : `再选 ${Math.max(0, 2 - picked.length)} 个以上，才能建群聊`}
          </LiquidButton>
        )}

        <LiquidButton type="button" className="assistant-chip agent-manage-link" onClick={onManage}>
          <Settings2 size={14} aria-hidden="true" />
          新建或管理智能体
        </LiquidButton>
      </div>
    </div>
  );
}
