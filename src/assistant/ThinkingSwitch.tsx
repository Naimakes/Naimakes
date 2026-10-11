import { thinkingModes, updatePrefs, usePrefs } from "./prefs";

export function ThinkingSwitch({ compact = false, disabled = false }: { compact?: boolean; disabled?: boolean }) {
  const prefs = usePrefs();
  return (
    <div className={"assistant-thinking" + (compact ? " is-compact" : "")} role="radiogroup" aria-label="思考模式">
      {compact && <span className="assistant-thinking-label">思考</span>}
      {thinkingModes.map((mode) => (
        <button
          key={mode.id}
          type="button"
          role="radio"
          aria-checked={prefs.thinking === mode.id}
          title={mode.hint}
          disabled={disabled}
          className={"assistant-thinking-option" + (prefs.thinking === mode.id ? " is-active" : "")}
          onClick={() => updatePrefs({ thinking: mode.id })}
        >
          {mode.label}
        </button>
      ))}
    </div>
  );
}
