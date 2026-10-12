import { LiquidButton } from "../motion/LiquidButton";
import { LiquidPopover } from "../motion/LiquidPopover";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
type MenuItem = { label: string; icon?: ReactNode; danger?: boolean; disabled?: boolean; title?: string; onSelect: () => void; };
const topDialog = () => Array.from(document.querySelectorAll<HTMLDialogElement>('dialog[open]:not([data-state="closing"])')).at(-1) || null;
export default function ContextMenu({ x, y, items, onClose, open = true, onExited, triggerRef }: {
  x: number; y: number; items: MenuItem[]; onClose: () => void; open?: boolean; onExited?: () => void; triggerRef?: RefObject<HTMLElement | null>;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const parentDialog = useRef<HTMLDialogElement | null>(null);
  const [spot, setSpot] = useState({ left: x, top: y });
  useLayoutEffect(() => { if (open) parentDialog.current = topDialog(); }, [open]);
  useLayoutEffect(() => {
    const box = ref.current;
    if (!box) return;
    setSpot({ left: Math.max(8, Math.min(x, innerWidth - box.offsetWidth - 8)), top: Math.max(8, Math.min(y, innerHeight - box.offsetHeight - 8)) });
  }, [x, y, open]);
  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => {
      const dialog = topDialog();
      if (dialog && dialog !== parentDialog.current) return;
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const close = () => onClose();
    document.addEventListener("pointerdown", outside, true);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => { document.removeEventListener("pointerdown", outside, true); window.removeEventListener("resize", close); window.removeEventListener("scroll", close, true); };
  }, [open, onClose]);
  return <LiquidPopover open={open} onClose={onClose} onExited={onExited} panelRef={ref} triggerRef={triggerRef} native className="context-menu glass" label="内容操作" point={{ x, y }} style={spot}>
    {items.map((item) => <LiquidButton key={item.label} type="button" role="menuitem" className={item.danger ? "danger-text" : ""} disabled={item.disabled} title={item.title} onClick={() => {
      const previous = topDialog();
      item.onSelect();
      requestAnimationFrame(() => {
        const dialog = topDialog();
        if (!dialog || dialog === previous) onClose();
      });
    }}>{item.icon}{item.label}</LiquidButton>)}
  </LiquidPopover>;
}
export function useContextMenu<T>() {
  const [menu, setMenu] = useState<{ x: number; y: number; item: T } | null>(null);
  const [isOpen, setOpen] = useState(false), currentOpen = useRef(false), triggerRef = useRef<HTMLElement | null>(null);
  const open = useCallback((event: { preventDefault: () => void; clientX: number; clientY: number; currentTarget?: EventTarget | null }, item: T) => {
    event.preventDefault();
    const trigger = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
    triggerRef.current = trigger;
    const bounds = event.clientX === 0 && event.clientY === 0 ? trigger?.getBoundingClientRect() : null;
    currentOpen.current = true;
    setMenu({ x: bounds ? bounds.left + bounds.width / 2 : event.clientX, y: bounds ? bounds.bottom : event.clientY, item });
    setOpen(true);
  }, []);
  const close = useCallback(() => { currentOpen.current = false; setOpen(false); }, []);
  const finish = useCallback(() => { if (!currentOpen.current) setMenu(null); }, []);
  return { menu, open, close, isOpen, finish, triggerRef };
}
