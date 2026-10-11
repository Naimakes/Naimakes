import { forwardRef, useCallback, useEffect, useId, useImperativeHandle, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type SelectHTMLAttributes } from "react";
import { validationHandled, validationText } from "./ValidationHint";
import { Check, ChevronDown } from "lucide-react";
import { LiquidButton } from "../motion/LiquidButton";
import { LiquidPopover } from "../motion/LiquidPopover";
import "./glass-select.css";

type Option = { value: string; label: string; disabled: boolean; group: string };

export const GlassSelect = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function GlassSelect({
  children, className, style, onChange, onFocus, onBlur, onInvalid, ...props
}, forwardedRef) {
  const native = useRef<HTMLSelectElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const wrapper = useRef<HTMLSpanElement>(null);
  const list = useRef<HTMLDivElement>(null);
  useImperativeHandle(forwardedRef, () => native.current!, []);
  const generated = useId();
  const id = props.id || `glass-select-${generated}`;
  const listId = `${id}-options`;
  const fallback = props.multiple || (props.size !== undefined && props.size > 1);
  const [options, setOptions] = useState<Option[]>([]);
  const [selected, setSelected] = useState(-1);
  const [active, setActive] = useState(-1);
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [invalid, setInvalid] = useState("");
  const [placement, setPlacement] = useState<CSSProperties>({ left: 12, top: 12, width: 220, maxHeight: 280 });
  const search = useRef({ text: "", time: 0 });

  const sync = useCallback(() => {
    const select = native.current;
    if (!select) return;
    const next = Array.from(select.options).map((option) => ({ value: option.value, label: option.label,
      disabled: option.matches(":disabled"), group: option.parentElement?.tagName === "OPTGROUP" ? (option.parentElement as HTMLOptGroupElement).label : "" }));
    setOptions((previous) => JSON.stringify(previous) === JSON.stringify(next) ? previous : next);
    setSelected(select.selectedIndex);
    const names = Array.from(select.labels || []).map((element) => {
      const copy = element.cloneNode(true) as HTMLLabelElement;
      copy.querySelectorAll(".glass-select").forEach((child) => child.remove());
      return copy.textContent?.trim() || "";
    }).filter(Boolean);
    setLabel(names.join(" "));
  }, []);
  useLayoutEffect(sync, [sync, children, props.value, props.defaultValue, props.disabled]);
  useEffect(() => {
    const form = native.current?.form;
    const reset = (event: Event) => queueMicrotask(() => {
      if (event.defaultPrevented || !native.current) return;
      sync(); setInvalid(""); setOpen(false);
    });
    form?.addEventListener("reset", reset);
    return () => form?.removeEventListener("reset", reset);
  }, [props.form, sync]);
  useEffect(() => { if (props.disabled) setOpen(false); }, [props.disabled]);
  useEffect(() => { if (props.autoFocus && !fallback) trigger.current?.focus(); }, [props.autoFocus, fallback]);

  const close = (restore = false) => {
    setOpen(false); search.current.text = "";
    if (restore) trigger.current?.focus({ preventScroll: true });
  };
  const place = useCallback(() => {
    const rect = trigger.current?.getBoundingClientRect();
    if (!rect) return;
    const viewport = window.visualViewport;
    const leftEdge = (viewport?.offsetLeft || 0) + 12, topEdge = (viewport?.offsetTop || 0) + 12;
    const viewportWidth = (viewport?.width || innerWidth) - 24;
    const bottomEdge = (viewport?.offsetTop || 0) + (viewport?.height || innerHeight) - 12;
    const width = Math.min(Math.max(rect.width, 220), viewportWidth);
    const below = bottomEdge - rect.bottom - 8, above = rect.top - topEdge - 8;
    const bottom = below >= Math.min(240, Math.max(1, options.length) * 44 + 16) || below >= above;
    const maxHeight = Math.max(60, Math.min(300, bottom ? below : above));
    const groups = options.filter((option, index) => option.group && option.group !== options[index - 1]?.group).length;
    const height = Math.min(maxHeight, options.length * 44 + groups * 28 + 16);
    setPlacement({ left: Math.max(leftEdge, Math.min(rect.left, leftEdge + viewportWidth - width)),
      top: Math.max(topEdge, bottom ? rect.bottom + 8 : rect.top - 8 - height), width, maxHeight });
  }, [options]);
  const show = (end = false) => {
    if (native.current?.matches(":disabled") || !options.some((option) => !option.disabled)) return;
    place();
    const available = options.map((option, index) => option.disabled ? -1 : index).filter((index) => index >= 0);
    setActive(selected >= 0 && !options[selected]?.disabled ? selected : available[end ? available.length - 1 : 0]);
    setOpen(true);
  };
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (event.target instanceof Node && !wrapper.current?.contains(event.target) && !panel.current?.contains(event.target)) setOpen(false); };
    const scroll = (event: Event) => { if (!(event.target instanceof Node) || !panel.current?.contains(event.target)) setOpen(false); };
    const hidden = () => { if (document.hidden) setOpen(false); };
    const blur = () => setOpen(false);
    document.addEventListener("pointerdown", outside, true);
    window.addEventListener("scroll", scroll, { capture: true, passive: true });
    window.addEventListener("resize", place, { passive: true });
    window.addEventListener("blur", blur);
    window.visualViewport?.addEventListener("resize", place);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("scroll", scroll, true);
      window.removeEventListener("resize", place);
      window.removeEventListener("blur", blur);
      window.visualViewport?.removeEventListener("resize", place);
      document.removeEventListener("visibilitychange", hidden);
    };
  }, [open, place]);
  useLayoutEffect(() => {
    if (!open) return;
    const item = list.current?.querySelector<HTMLElement>(`[data-option-index="${active}"]`);
    const viewport = panel.current;
    if (!item || !viewport) return;
    const rect = item.getBoundingClientRect(), panelRect = viewport.getBoundingClientRect();
    if (rect.top < panelRect.top + 8) viewport.scrollTop -= panelRect.top + 8 - rect.top;
    else if (rect.bottom > panelRect.bottom - 8) viewport.scrollTop += rect.bottom - panelRect.bottom + 8;
  }, [active, open]);

  const choose = (index: number) => {
    const select = native.current, option = options[index];
    if (!select || select.matches(":disabled") || !option || option.disabled) return;
    if (select.selectedIndex !== index) {
      select.selectedIndex = index;
      select.dispatchEvent(new Event("input", { bubbles: true }));
      select.dispatchEvent(new Event("change", { bubbles: true }));
    }
    setInvalid(""); close(true);
    queueMicrotask(sync);
  };
  const keyboard = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Tab") { close(); return; }
    if (event.key === "Escape") {
      if (open) { event.preventDefault(); event.stopPropagation(); close(true); }
      return;
    }
    if (["ArrowDown", "ArrowUp", "Home", "End", "Enter", " "].includes(event.key)) {
      event.preventDefault(); event.stopPropagation();
      if (event.key === "Enter" || event.key === " ") { if (open) choose(active); else show(); return; }
      if (!open) { show(event.key === "End"); return; }
      const available = options.map((option, index) => option.disabled ? -1 : index).filter((index) => index >= 0);
      const current = available.indexOf(active);
      const next = event.key === "Home" ? 0 : event.key === "End" ? available.length - 1
        : Math.max(0, Math.min(available.length - 1, current + (event.key === "ArrowDown" ? 1 : -1)));
      setActive(available[next] ?? -1);
      return;
    }
    if (event.key.length !== 1 || event.ctrlKey || event.altKey || event.metaKey) return;
    const now = performance.now(), character = event.key.toLocaleLowerCase();
    search.current.text = now - search.current.time > 700 ? character : search.current.text + character;
    search.current.time = now;
    const query = Array.from(search.current.text).every((letter) => letter === character) ? character : search.current.text;
    const from = open ? active : selected;
    const match = Array.from({ length: options.length }, (_, index) => (from + index + 1) % options.length)
      .find((index) => !options[index].disabled && options[index].label.toLocaleLowerCase().startsWith(query));
    if (match !== undefined) {
      event.preventDefault(); event.stopPropagation();
      if (open) setActive(match); else choose(match);
    }
  };

  if (fallback) return <select {...props} ref={native} className={className} style={style} onChange={onChange} onFocus={onFocus} onBlur={onBlur} onInvalid={onInvalid}>{children}</select>;
  const accessibleLabel = props["aria-label"] || label || "选择选项";
  return <span className={["glass-select", className].filter(Boolean).join(" ")} style={style} ref={wrapper}>
    <select {...props} ref={native} id={id} className="glass-select-native" tabIndex={-1} aria-hidden="true"
      onChange={(event) => { sync(); onChange?.(event); queueMicrotask(sync); }}
      onFocus={(event) => { if (document.activeElement === event.currentTarget) { trigger.current?.focus({ preventScroll: true }); return; } onFocus?.(event); }}
      onBlur={(event) => { if (event.relatedTarget !== trigger.current) onBlur?.(event); }}
      onInvalid={(event) => {
        onInvalid?.(event);
        if (!event.defaultPrevented) { event.preventDefault(); validationHandled(event.currentTarget); setInvalid(validationText(event.currentTarget)); trigger.current?.focus({ preventScroll: true }); }
      }}>{children}</select>
    <LiquidButton ref={trigger} type="button" className="glass-select-trigger" role="combobox"
      id={`${id}-trigger`} disabled={props.disabled} tabIndex={props.tabIndex}
      aria-label={accessibleLabel} aria-labelledby={props["aria-labelledby"]} aria-describedby={invalid ? `${id}-error` : props["aria-describedby"]}
      aria-required={props.required} aria-invalid={invalid ? true : props["aria-invalid"]}
      aria-expanded={open} aria-haspopup="listbox" aria-controls={listId}
      aria-activedescendant={open && active >= 0 ? `${id}-option-${active}` : undefined}
      onClick={() => { if (open) close(); else show(); }} onKeyDown={keyboard}
      onFocus={(event) => native.current?.dispatchEvent(new FocusEvent("focusin", { bubbles: true, relatedTarget: event.relatedTarget }))}
      onBlur={(event) => {
        native.current?.dispatchEvent(new FocusEvent("focusout", { bubbles: true, relatedTarget: event.relatedTarget }));
        if (!panel.current?.contains(event.relatedTarget as Node)) close();
      }}>
      <span className="glass-select-value">{options[selected]?.label || "请选择"}</span><ChevronDown size={16} aria-hidden="true" />
    </LiquidButton>
    <LiquidPopover open={open} className="glass-select-popup glass-menu" native triggerRef={trigger} panelRef={panel}
      role="region" label={accessibleLabel} onClose={() => close()} style={placement}>
      <div ref={list} id={listId} role="listbox" aria-label={accessibleLabel} className="glass-select-list" onKeyDown={keyboard}>
        {options.map((option, index) => <div key={`${option.value}-${index}`} role="presentation">
          {option.group && option.group !== options[index - 1]?.group && <div className="glass-select-group" role="presentation">{option.group}</div>}
          <button type="button" role="option" id={`${id}-option-${index}`} data-option-index={index}
            className="glass-select-option" aria-selected={selected === index} disabled={option.disabled} tabIndex={-1}
            data-active={active === index} onPointerMove={() => { if (!option.disabled) setActive(index); }}
            onPointerDown={(event) => event.preventDefault()} onClick={() => choose(index)}>
            <span>{option.label}</span><Check size={16} aria-hidden="true" className="glass-select-check" />
          </button>
        </div>)}
      </div>
    </LiquidPopover>
    {invalid && <span id={`${id}-error`} className="glass-select-error" role="alert">{invalid}</span>}
  </span>;
});
