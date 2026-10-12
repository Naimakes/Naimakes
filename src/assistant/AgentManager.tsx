import { useEffect, useState } from "react";
import { Check, ChevronDown, Plus, Star, Trash2 } from "lucide-react";
import { LiquidButton } from "../forum/motion/LiquidButton";
import { AgentAvatar } from "./AgentAvatar";
import { MAX_INSTRUCTIONS, MAX_NAME, chooseMain, createAgent, removeAgent, saveAgent, useAgents, type Agent } from "./agents";
import { useChat } from "./chat";
import { ShapeThumb } from "./ShapeThumb";
import { colorIds, colorNames, shapes, swatchOf } from "./prefs";
import "./assistant-agents.css";

// 打开和这个智能体的新对话：它会先问用户想让自己做什么，再把了解到的写进自己的指令。
export const openOnboarding = (id: string) => window.dispatchEvent(new CustomEvent("nmk-assistant-onboard", { detail: { agent: id } }));

function Editor({ agent, onError }: { agent: Agent; onError: (message: string) => void }) {
  const [name, setName] = useState(agent.name);
  const [instructions, setInstructions] = useState(agent.instructions);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const dirty = name.trim() !== agent.name || instructions.trim() !== agent.instructions;

  useEffect(() => {
    setName(agent.name);
    setInstructions(agent.instructions);
  }, [agent.name, agent.instructions]);

  const look = async (patch: { shape?: string; color?: string }) => onError(await saveAgent(agent.id, patch));
  const save = async () => {
    setSaving(true);
    setSaved(false);
    const problem = await saveAgent(agent.id, { name: name.trim(), instructions: instructions.trim() });
    setSaving(false);
    onError(problem);
    if (!problem) setSaved(true);
  };

  return (
    <div className="agent-editor">
      <label className="agent-field">
        <span>名字</span>
        <input value={name} maxLength={MAX_NAME} onChange={(event) => { setName(event.target.value); setSaved(false); }} />
      </label>

      <fieldset className="agent-field">
        <legend>形状</legend>
        <div className="agent-shapes" role="radiogroup" aria-label={agent.name + " 的形状"}>
          {shapes.map((shape) => (
            <button key={shape.id} type="button" role="radio" aria-checked={agent.shape === shape.id} aria-label={shape.label} title={shape.label} className={"agent-shape" + (agent.shape === shape.id ? " is-active" : "")} onClick={() => look({ shape: shape.id })}>
              <ShapeThumb shape={shape.id} color={agent.color} size={30} />
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset className="agent-field">
        <legend>颜色</legend>
        <div className="assistant-swatches" role="radiogroup" aria-label={agent.name + " 的颜色"}>
          {colorIds.map((id) => (
            <button key={id} type="button" role="radio" aria-checked={agent.color === id} aria-label={colorNames[id] || id} title={colorNames[id] || id} className={"assistant-swatch" + (agent.color === id ? " is-active" : "")} style={{ background: swatchOf(id) }} onClick={() => look({ color: id })}>
              {agent.color === id && <Check size={14} strokeWidth={2.6} />}
            </button>
          ))}
        </div>
      </fieldset>

      <label className="agent-field">
        <span>
          指令 <small>它的角色和工作方式；和它聊天时它也会把了解到的写在这里，你随时可以改</small>
        </span>
        <textarea
          value={instructions}
          rows={6}
          maxLength={MAX_INSTRUCTIONS}
          placeholder="例如：你是我的学习教练，每天提醒我复习，语气温和但不放过拖延……留空的话，它会在第一次对话里问你想让它做什么。"
          onChange={(event) => { setInstructions(event.target.value); setSaved(false); }}
        />
        <em className="agent-count">{instructions.length} / {MAX_INSTRUCTIONS}</em>
      </label>

      <div className="agent-editor-foot">
        {saved && !dirty && <span className="agent-saved"><Check size={13} aria-hidden="true" /> 已保存</span>}
        <LiquidButton type="button" className="profile-reset" disabled={!dirty || saving || !name.trim()} onClick={save}>
          {saving ? "保存中…" : "保存名字和指令"}
        </LiquidButton>
      </div>
    </div>
  );
}

export default function AgentManager() {
  const { agents, mainId, loaded, error, full, limit } = useAgents();
  const { signedIn } = useChat();
  const [open, setOpen] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const [notice, setNotice] = useState("");

  const fail = (message: string) => {
    setProblem(message);
    if (message) setNotice("");
  };

  const create = async () => {
    const title = name.trim();
    if (!title || busy) return;
    setBusy(true);
    setProblem("");
    setNotice("");
    const result = await createAgent({ name: title });
    setBusy(false);
    if ("error" in result) return setProblem(result.error);
    setName("");
    setNotice(`已创建「${result.agent.name}」，正在打开和它的第一段对话——它会先问你想让它做什么。`);
    openOnboarding(result.agent.id);
  };

  const remove = async (agent: Agent) => {
    if (!confirm(`删除智能体「${agent.name}」？它的设定会一起删除，和它的历史对话仍会保留。`)) return;
    fail(await removeAgent(agent.id));
    if (open === agent.id) setOpen("");
  };

  return (
    <section className="profile-card agent-manager" id="settings-agents" aria-labelledby="agent-manager-title">
      <div className="profile-card-head">
        <h2 id="agent-manager-title">智能体</h2>
        <p className="profile-card-note">
          除了 Naimakes，你还可以创建不同分工的智能体，每个都有自己的名字、外观和指令。其中一个是「主智能体」，常驻在屏幕上；新建聊天时可以选一个单聊，或选 2–3 个建群聊。也可以直接对任何一个智能体说「帮我新建一个智能体」。
        </p>
      </div>

      {!signedIn ? (
        <p className="agent-note">登录后才能创建和管理智能体，现在只有内置的 Naimakes。</p>
      ) : (
        <>
          <form className="agent-create" onSubmit={(event) => { event.preventDefault(); void create(); }}>
            <input value={name} maxLength={MAX_NAME} placeholder={full ? `最多 ${limit} 个智能体，请先删除不用的` : "给新智能体起个名字，例如「自我提升」"} aria-label="新智能体的名字" disabled={full || busy} onChange={(event) => setName(event.target.value)} />
            <LiquidButton type="submit" className="profile-reset" disabled={!name.trim() || full || busy}>
              <Plus size={14} aria-hidden="true" />
              {busy ? "创建中…" : "创建并开始聊"}
            </LiquidButton>
          </form>
          {(problem || error) && <p className="agent-note is-error" role="alert">{problem || error}</p>}
          {notice && <p className="agent-note" role="status">{notice}</p>}

          {!loaded ? (
            <p className="agent-note">正在加载…</p>
          ) : (
            <ul className="agent-list">
              {agents.map((agent) => {
                const expanded = open === agent.id;
                return (
                  <li key={agent.id} className={expanded ? "is-open" : undefined}>
                    <div className="agent-row">
                      <AgentAvatar agent={agent} size={44} />
                      <span className="agent-row-text">
                        <strong>
                          {agent.name}
                          {agent.id === mainId && (
                            <em>
                              <Star size={10} aria-hidden="true" /> 主智能体
                            </em>
                          )}
                        </strong>
                        <small>{agent.builtin ? "内置 · 站内小助理" : agent.instructions.trim().replace(/\s+/g, " ").slice(0, 60) || "还没有设定指令"}</small>
                      </span>
                      <span className="agent-row-tools">
                        {agent.id !== mainId && (
                          <LiquidButton type="button" className="profile-reset" onClick={async () => fail(await chooseMain(agent.id))}>
                            设为主智能体
                          </LiquidButton>
                        )}
                        {!agent.builtin && (
                          <>
                            <LiquidButton type="button" className="icon-button" aria-label={`删除 ${agent.name}`} title="删除" onClick={() => remove(agent)}>
                              <Trash2 size={15} />
                            </LiquidButton>
                            <LiquidButton type="button" className={"icon-button agent-chevron" + (expanded ? " is-open" : "")} aria-expanded={expanded} aria-label={`${expanded ? "收起" : "编辑"} ${agent.name}`} title={expanded ? "收起" : "编辑"} onClick={() => setOpen(expanded ? "" : agent.id)}>
                              <ChevronDown size={16} />
                            </LiquidButton>
                          </>
                        )}
                      </span>
                    </div>
                    {expanded && !agent.builtin && <Editor agent={agent} onError={fail} />}
                  </li>
                );
              })}
            </ul>
          )}
          <p className="agent-note">Naimakes 的形状、颜色和思考模式在上面的「Naimakes」里设置；它是内置的，不能删除，也没有可编辑的指令。</p>
        </>
      )}
    </section>
  );
}
