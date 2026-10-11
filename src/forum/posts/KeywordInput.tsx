import { useId, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Hash, X } from "lucide-react";
import { transitions } from "../motion/motion-tokens";
import { useMotionPreferences } from "../motion/motion-preferences";
import "./keyword-input.css";

const keywordLimit = 5;
const keywordLength = 20;

export const parseKeywords = (value: string) => {
  const seen = new Set<string>();
  return value
    .split(/[,，、\n]/)
    .map((k) => k.trim().replace(/^#+/, "").trim())
    .filter((k) => {
      const key = k.toLowerCase();
      if (!k || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
};

export function KeywordInput({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const { reduced } = useMotionPreferences();
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState("");
  const [hint, setHint] = useState("");
  const keywords = parseKeywords(value);
  const full = keywords.length >= keywordLimit;
  const commit = (raw = pending) => {
    const incoming = parseKeywords(raw);
    if (!incoming.length) return setPending("");
    const next = [...keywords];
    for (const word of incoming) {
      if (Array.from(word).length > keywordLength) {
        setHint(`单个关键词最多 ${keywordLength} 个字`);
        return;
      }
      if (next.length >= keywordLimit) {
        setHint(`最多添加 ${keywordLimit} 个关键词`);
        break;
      }
      if (!next.some((k) => k.toLowerCase() === word.toLowerCase())) next.push(word);
    }
    onChange(next.join(", "));
    setPending("");
    if (next.length < keywordLimit) setHint("");
  };
  const remove = (word: string) => {
    onChange(keywords.filter((k) => k !== word).join(", "));
    setHint("");
    input.current?.focus();
  };
  return (
    <div className="keyword-input">
      <label htmlFor={id}>
        关键词 <span className="muted">由你自己定义，按回车或逗号添加，最多 {keywordLimit} 个；读者点击后能找到同类讨论</span>
      </label>
      <div className="keyword-field" onClick={() => input.current?.focus()}>
        <AnimatePresence initial={false} mode="popLayout">
          {keywords.map((word) => (
            <motion.span
              key={word}
              layout
              className="keyword-chip"
              initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.8 }}
              transition={transitions.tactile}
            >
              <Hash size={12} aria-hidden="true" />
              {word}
              <button type="button" aria-label={`移除关键词 ${word}`} onClick={() => remove(word)}>
                <X size={12} />
              </button>
            </motion.span>
          ))}
        </AnimatePresence>
        <input
          id={id}
          ref={input}
          value={pending}
          disabled={full}
          maxLength={keywordLength + 2}
          placeholder={full ? "已达到上限" : keywords.length ? "继续添加…" : "例如：世界模型"}
          aria-describedby={hint ? id + "-hint" : undefined}
          onChange={(e) => {
            const text = e.target.value;
            if (/[,，、]/.test(text)) commit(text);
            else setPending(text);
          }}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing || e.keyCode === 229) return;
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            } else if (e.key === "Backspace" && !pending && keywords.length) {
              remove(keywords[keywords.length - 1]);
            }
          }}
          onBlur={() => commit()}
        />
      </div>
      {hint && (
        <p className="keyword-hint" id={id + "-hint"} role="status">
          {hint}
        </p>
      )}
    </div>
  );
}
