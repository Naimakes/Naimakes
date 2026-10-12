import { useEffect, useState } from "react";
import { Brain, ChevronLeft, Pencil, Plus, Trash2, X } from "lucide-react";
import { api } from "../forum/api";
import { LiquidButton } from "../forum/motion/LiquidButton";
import { LiquidSwitch } from "../forum/ui/LiquidSwitch";
import "./assistant-details.css";
import "./assistant-manage.css";

type Memory = { id: string; kind: Kind; content: string; source: "auto" | "user"; enabled: boolean; updated_at: number };
type Kind = "style" | "action" | "answer" | "fact";
const kinds: { id: Kind; label: string }[] = [
  { id: "style", label: "写作风格" },
  { id: "action", label: "执行操作" },
  { id: "answer", label: "回答要求" },
  { id: "fact", label: "个人信息" },
];

export default function AssistantMemory({ signedIn, onBack, onClose }: { signedIn: boolean; onBack: () => void; onClose: () => void }) {
  const [memories, setMemories] = useState<Memory[] | null>(null);
  const [auto, setAuto] = useState(true);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState("");
  const [kind, setKind] = useState<Kind>("fact");
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [max, setMax] = useState(60);

  useEffect(() => {
    if (!signedIn) return;
    let active = true;
    api<{ memories: Memory[]; auto: boolean; max: number }>("/assistant/memories")
      .then((r) => {
        if (!active) return;
        setMemories(r.memories);
        setAuto(r.auto);
        setMax(r.max);
      })
      .catch((e) => active && setError((e as Error).message));
    return () => {
      active = false;
    };
  }, [signedIn]);

  const fail = (e: unknown) => setError((e as Error).message);
  const add = async () => {
    if (draft.trim().length < 2) return;
    setError("");
    try {
      const r = await api<{ memories: Memory[] }>("/assistant/memories", { method: "POST", body: JSON.stringify({ content: draft, kind }) });
      setMemories(r.memories);
      setDraft("");
    } catch (e) {
      fail(e);
    }
  };
  const patch = async (id: string, body: Partial<Pick<Memory, "content" | "enabled">>) => {
    setError("");
    try {
      const r = await api<{ memory: Memory }>("/assistant/memories/" + id, { method: "PATCH", body: JSON.stringify(body) });
      setMemories((list) => list && list.map((m) => (m.id === id ? r.memory : m)));
    } catch (e) {
      fail(e);
    }
  };
  const remove = async (id: string) => {
    setError("");
    try {
      await api("/assistant/memories/" + id, { method: "DELETE" });
      setMemories((list) => list && list.filter((m) => m.id !== id));
    } catch (e) {
      fail(e);
    }
  };
  const clear = async () => {
    if (!confirm("清空全部记忆？清空后无法恢复。")) return;
    try {
      await api("/assistant/memories", { method: "DELETE" });
      setMemories([]);
    } catch (e) {
      fail(e);
    }
  };
  const setAutoLearn = async (next: boolean) => {
    setAuto(next);
    try {
      await api("/assistant/memory-auto", { method: "PUT", body: JSON.stringify({ auto: next }) });
    } catch (e) {
      setAuto(!next);
      fail(e);
    }
  };

  return (
    <div className="assistant-view assistant-manage" role="region" aria-label="记忆">
      <header className="assistant-bar">
        <LiquidButton type="button" className="icon-button assistant-icon" aria-label="返回" title="返回" onClick={onBack}>
          <ChevronLeft size={18} />
        </LiquidButton>
        <h3>记忆</h3>
        <LiquidButton type="button" className="icon-button assistant-icon" aria-label="关闭" title="关闭" onClick={onClose}>
          <X size={16} />
        </LiquidButton>
      </header>
      <div className="assistant-scroll">
        {!signedIn ? (
          <p className="assistant-history-note">登录后，我会记住你对写作风格、操作习惯和回答方式的要求，也可以直接对我说「请记住……」。</p>
        ) : (
          <>
            <p className="assistant-manage-intro">
              <Brain size={14} aria-hidden="true" /> 这里是我记住的内容，回答和执行操作时会参考。你可以对我说「请记住……」，也可以在下面直接添加。
            </p>
            <section className="assistant-card assistant-row">
              <span className="assistant-row-text">
                <strong>自动整理</strong>
                <small>从你的对话里整理写作风格、操作习惯和回答要求（只看你说的话，不看附件）</small>
              </span>
              <LiquidSwitch checked={auto} label="自动整理对话里的长期要求" onChange={() => void setAutoLearn(!auto)} />
            </section>

            <form
              className="assistant-manage-add"
              onSubmit={(event) => {
                event.preventDefault();
                void add();
              }}
            >
              <input value={draft} maxLength={200} placeholder="添加一条，比如：写文章时用第一人称" aria-label="要记住的内容" onChange={(e) => setDraft(e.target.value)} />
              <select value={kind} aria-label="类型" onChange={(e) => setKind(e.target.value as Kind)}>
                {kinds.map((k) => (
                  <option key={k.id} value={k.id}>
                    {k.label}
                  </option>
                ))}
              </select>
              <LiquidButton type="submit" className="icon-button assistant-icon" aria-label="添加记忆" title="添加" disabled={draft.trim().length < 2}>
                <Plus size={16} />
              </LiquidButton>
            </form>

            {error && (
              <p className="assistant-history-note" role="alert">
                {error}
              </p>
            )}
            {memories === null ? (
              !error && <p className="assistant-history-note">正在加载…</p>
            ) : memories.length === 0 ? (
              <p className="assistant-history-note">还没有记忆。对我提出长期的要求，或让我记住一些事，它们会出现在这里。</p>
            ) : (
              <>
                {kinds.map((group) => {
                  const list = memories.filter((m) => m.kind === group.id);
                  if (!list.length) return null;
                  return (
                    <section key={group.id} className="assistant-manage-group" aria-label={group.label}>
                      <h4>{group.label}</h4>
                      <ul>
                        {list.map((m) => (
                          <li key={m.id} className={m.enabled ? undefined : "is-off"}>
                            {editing?.id === m.id ? (
                              <form
                                className="assistant-manage-edit"
                                onSubmit={(event) => {
                                  event.preventDefault();
                                  void patch(m.id, { content: editing.text }).then(() => setEditing(null));
                                }}
                              >
                                <input autoFocus value={editing.text} maxLength={200} aria-label="修改记忆" onChange={(e) => setEditing({ id: m.id, text: e.target.value })} onKeyDown={(e) => e.key === "Escape" && setEditing(null)} />
                                <LiquidButton type="submit" className="assistant-chip is-compact is-primary" disabled={editing.text.trim().length < 2}>
                                  保存
                                </LiquidButton>
                              </form>
                            ) : (
                              <>
                                <span className="assistant-manage-text">
                                  <span>{m.content}</span>
                                  <small>{m.source === "user" ? "你要求的" : "自动整理"}</small>
                                </span>
                                <span className="assistant-manage-tools">
                                  <LiquidSwitch checked={m.enabled} label={(m.enabled ? "停用：" : "启用：") + m.content} onChange={() => void patch(m.id, { enabled: !m.enabled })} />
                                  <LiquidButton type="button" className="icon-button assistant-icon" aria-label={"修改：" + m.content} title="修改" onClick={() => setEditing({ id: m.id, text: m.content })}>
                                    <Pencil size={14} />
                                  </LiquidButton>
                                  <LiquidButton type="button" className="icon-button assistant-icon" aria-label={"删除：" + m.content} title="删除" onClick={() => void remove(m.id)}>
                                    <Trash2 size={14} />
                                  </LiquidButton>
                                </span>
                              </>
                            )}
                          </li>
                        ))}
                      </ul>
                    </section>
                  );
                })}
                <div className="assistant-manage-foot">
                  <small>
                    {memories.length} / {max} 条
                  </small>
                  <LiquidButton type="button" className="text-button" onClick={() => void clear()}>
                    <Trash2 size={13} /> 清空全部
                  </LiquidButton>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
