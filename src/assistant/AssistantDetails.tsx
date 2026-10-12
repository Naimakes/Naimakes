import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowUpRight, Brain, CalendarClock, Check, ChevronLeft, ChevronRight, MessageSquarePlus, Pencil, RotateCcw, X } from "lucide-react";
import { useMotionPreferences } from "../forum/motion/motion-preferences";
import { LiquidSwitch } from "../forum/ui/LiquidSwitch";
import { LiquidButton } from "../forum/motion/LiquidButton";
import { BotFigure, type BotHandle } from "./BotFigure";
import { ShapeThumb } from "./ShapeThumb";
import "./assistant-details.css";
import { colorIds, colorNames, resetPrefs, setNotify, shapes, swatchOf, updatePrefs, useNotify, usePrefs } from "./prefs";

export default function AssistantDetails({
  state,
  status,
  messageCount,
  onBack,
  onClose,
  onNewChat,
  onSettings,
  onMemory,
  onTasks,
}: {
  state: string;
  status: string;
  messageCount: number;
  onBack: () => void;
  onClose: () => void;
  onNewChat: () => void;
  onSettings: () => void;
  onMemory: () => void;
  onTasks: () => void;
}) {
  const prefs = usePrefs();
  const notify = useNotify();
  const look = useMemo(() => ({ shape: prefs.shape, color: prefs.color }), [prefs.shape, prefs.color]);
  const { reduced } = useMotionPreferences();
  const [editing, setEditing] = useState(false);
  const [cheer, setCheer] = useState(false);
  const bot = useRef<BotHandle>(null);
  const cheerTimer = useRef(0);
  useEffect(() => () => clearTimeout(cheerTimer.current), []);

  const celebrate = () => {
    clearTimeout(cheerTimer.current);
    setCheer(true);
    cheerTimer.current = window.setTimeout(() => setCheer(false), 1000);
    bot.current?.poke("spin");
  };
  const choose = (patch: Partial<typeof prefs>) => {
    updatePrefs(patch);
    celebrate();
  };

  return (
    <div className="assistant-view assistant-details" role="region" aria-label="Naimakes 详情">
      <header className="assistant-bar">
        <LiquidButton type="button" className="icon-button assistant-icon" aria-label="返回对话" title="返回" onClick={onBack}>
          <ChevronLeft size={18} />
        </LiquidButton>
        <h3>详情</h3>
        <LiquidButton type="button" className="icon-button assistant-icon" aria-label="关闭" title="关闭" onClick={onClose}>
          <X size={16} />
        </LiquidButton>
      </header>

      <div className="assistant-scroll">
        <section className="assistant-hero" aria-label="形象">
          <button
            type="button"
            className="assistant-hero-avatar"
            aria-label="编辑 Naimakes 的形象"
            aria-expanded={editing}
            onClick={() => setEditing((value) => !value)}
          >
            <BotFigure ref={bot} look={look} state={cheer ? "happy" : state} idle="alive" className="assistant-hero-bot" />
            <span className="assistant-hero-edit" aria-hidden="true">
              <Pencil size={14} />
            </span>
          </button>
          <div className="assistant-hero-text">
            <strong>Naimakes</strong>
            <span className="assistant-hero-status">
              <i aria-hidden="true" />
              {status}
            </span>
          </div>
        </section>

        <AnimatePresence initial={false}>
          {editing && (
            <motion.div
              key="editor"
              className="assistant-editor"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={reduced ? { duration: 0.01 } : { type: "spring", stiffness: 380, damping: 38 }}
            >
              <div className="assistant-card assistant-editor-body">
                <div className="assistant-shape-grid" role="radiogroup" aria-label="Naimakes 形状">
                  {shapes.map((shape) => (
                    <LiquidButton
                      key={shape.id}
                      type="button"
                      role="radio"
                      aria-checked={prefs.shape === shape.id}
                      aria-label={shape.label}
                      title={shape.label}
                      className={"assistant-shape-pick" + (prefs.shape === shape.id ? " is-active" : "")}
                      onClick={() => choose({ shape: shape.id })}
                    >
                      <ShapeThumb shape={shape.id} color={prefs.color} size={34} />
                    </LiquidButton>
                  ))}
                </div>
                <div className="assistant-color-row" role="radiogroup" aria-label="Naimakes 颜色">
                  {colorIds.map((id) => (
                    <button
                      key={id}
                      type="button"
                      role="radio"
                      aria-checked={prefs.color === id}
                      aria-label={colorNames[id] || id}
                      title={colorNames[id] || id}
                      className={"assistant-dot" + (prefs.color === id ? " is-active" : "")}
                      style={{ background: swatchOf(id) }}
                      onClick={() => choose({ color: id })}
                    >
                      {prefs.color === id && <Check size={13} strokeWidth={2.8} />}
                    </button>
                  ))}
                </div>
                <LiquidButton type="button" className="assistant-chip" onClick={() => { resetPrefs(); celebrate(); }}>
                  <RotateCcw size={13} />
                  恢复默认形象
                </LiquidButton>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <section className="assistant-card assistant-row">
          <span className="assistant-row-text">
            <strong>回复提醒</strong>
            <small>面板收起时，回答完成后让小球提醒你</small>
          </span>
          <LiquidSwitch checked={notify} label="回复提醒" onChange={() => setNotify(!notify)} />
        </section>

        <section className="assistant-card assistant-row">
          <span className="assistant-row-text">
            <strong>当前对话</strong>
            <small>{messageCount ? `${messageCount} 条消息` : "还没有消息"}</small>
          </span>
          <LiquidButton type="button" className="assistant-chip" disabled={!messageCount} onClick={onNewChat}>
            <MessageSquarePlus size={14} />
            新对话
          </LiquidButton>
        </section>

        <LiquidButton type="button" className="assistant-card assistant-link-row" onClick={onMemory}>
          <span className="assistant-row-text">
            <strong>
              <Brain size={14} aria-hidden="true" /> 记忆
            </strong>
            <small>我记住的写作风格、操作习惯、回答要求，以及你让我记的事</small>
          </span>
          <ChevronRight size={16} aria-hidden="true" />
        </LiquidButton>

        <LiquidButton type="button" className="assistant-card assistant-link-row" onClick={onTasks}>
          <span className="assistant-row-text">
            <strong>
              <CalendarClock size={14} aria-hidden="true" /> 定时任务
            </strong>
            <small>到固定的时间，我会自动执行你交代的事</small>
          </span>
          <ChevronRight size={16} aria-hidden="true" />
        </LiquidButton>

        <LiquidButton type="button" className="assistant-card assistant-link-row" onClick={onSettings}>
          <span className="assistant-row-text">
            <strong>更多设置</strong>
            <small>在设置页里查看完整的 Naimakes 选项</small>
          </span>
          <ArrowUpRight size={16} aria-hidden="true" />
        </LiquidButton>
      </div>
    </div>
  );
}
