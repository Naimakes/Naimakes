import { useMemo } from "react";
import { Check, RotateCcw } from "lucide-react";
import { LiquidButton } from "../forum/motion/LiquidButton";
import { StatusPill } from "../forum/motion/StatusPill";
import { BotFigure } from "./BotFigure";
import { ThinkingSwitch } from "./ThinkingSwitch";
import { ShapeThumb } from "./ShapeThumb";
import AgentManager from "./AgentManager";
import { colorIds, colorNames, resetPrefs, shapes, swatchOf, thinkingModes, updatePrefs, usePrefs, useSync } from "./prefs";
import "./assistant-settings.css";

export default function AssistantSettings() {
  const prefs = usePrefs();
  const sync = useSync();
  const look = useMemo(() => ({ shape: prefs.shape, color: prefs.color }), [prefs.shape, prefs.color]);

  return (
    <>
    <section className="profile-card assistant-settings" id="settings-assistant" aria-labelledby="assistant-settings-title">
      <div className="profile-card-head">
        <h2 id="assistant-settings-title">Naimakes</h2>
        <StatusPill status={sync} labels={{ busy: "保存中", done: "已自动保存", error: "没能同步到账户，已保存在此设备" }} />
        <LiquidButton type="button" className="profile-reset" onClick={resetPrefs}>
          <RotateCcw size={13} />
          恢复默认
        </LiquidButton>
        <p className="profile-card-note">这是内置的 Naimakes。选择它的形状和颜色，修改会立即同步到全站并自动保存。想要更多不同分工的助手，可以在下面的「智能体」里创建。它的表情和动作会跟随搜索、思考、回答等状态自动变化，不需要设置。</p>
      </div>

      <div className="assistant-settings-layout">
        <div className="assistant-preview">
          <div className="assistant-preview-stage">
            <BotFigure look={look} idle="alive" className="assistant-preview-bot" label="Naimakes 实时预览" />
          </div>
          <p className="assistant-preview-note">实时预览</p>
        </div>

        <div className="assistant-options">
          <fieldset className="assistant-field">
            <legend>形状</legend>
            <div className="assistant-shapes" role="radiogroup" aria-label="Naimakes 形状">
              {shapes.map((shape) => (
                <LiquidButton
                  key={shape.id}
                  type="button"
                  role="radio"
                  aria-checked={prefs.shape === shape.id}
                  className={"assistant-shape" + (prefs.shape === shape.id ? " is-active" : "")}
                  onClick={() => updatePrefs({ shape: shape.id })}
                >
                  <ShapeThumb shape={shape.id} color={prefs.color} size={38} />
                  <small>{shape.label}</small>
                </LiquidButton>
              ))}
            </div>
          </fieldset>

          <fieldset className="assistant-field">
            <legend>颜色</legend>
            <div className="assistant-swatches" role="radiogroup" aria-label="Naimakes 颜色">
              {colorIds.map((id) => (
                <button
                  key={id}
                  type="button"
                  role="radio"
                  aria-checked={prefs.color === id}
                  aria-label={colorNames[id] || id}
                  title={colorNames[id] || id}
                  className={"assistant-swatch" + (prefs.color === id ? " is-active" : "")}
                  style={{ background: swatchOf(id) }}
                  onClick={() => updatePrefs({ color: id })}
                >
                  {prefs.color === id && <Check size={14} strokeWidth={2.6} />}
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset className="assistant-field">
            <legend>思考模式</legend>
            <ThinkingSwitch />
            <p className="assistant-field-hint">{thinkingModes.find((m) => m.id === prefs.thinking)?.hint}。也可以随时在对话框里切换。</p>
          </fieldset>
        </div>
      </div>
    </section>
    <AgentManager />
    </>
  );
}
