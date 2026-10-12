import { useEffect, useRef } from "react";
import { LoaderCircle, Search, X } from "lucide-react";
import "./file-search.css";

/** 图书馆与附件选择器共用的搜索框，样式与站内搜索、导航栏的搜索一致。 */
export default function FileSearch({
  value,
  onChange,
  placeholder,
  label = "搜索",
  busy = false,
  shortcut = false,
  autoFocus = false,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  label?: string;
  busy?: boolean;
  shortcut?: boolean;
  autoFocus?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!shortcut) return;
    const key = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
      if (target?.closest("input, textarea, select, [contenteditable='true']")) return;
      event.preventDefault();
      input.current?.focus();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [shortcut]);
  return (
    <form className="search-input-wrap library-search file-search" role="search" onSubmit={(event) => event.preventDefault()}>
      <Search size={18} aria-hidden="true" />
      <input
        ref={input}
        type="search"
        autoFocus={autoFocus}
        value={value}
        maxLength={100}
        placeholder={placeholder}
        aria-label={label}
        enterKeyHint="search"
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape" && value) {
            event.stopPropagation();
            onChange("");
          }
        }}
      />
      {busy && <LoaderCircle className="spin file-search-busy" size={16} aria-hidden="true" />}
      {value ? (
        <button type="button" className="file-search-clear" aria-label="清除搜索" onClick={() => { onChange(""); input.current?.focus(); }}>
          <X size={14} />
        </button>
      ) : (
        shortcut && <kbd aria-hidden="true">/</kbd>
      )}
    </form>
  );
}
