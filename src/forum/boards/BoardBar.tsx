import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentType } from "react";
import { AnimatePresence, motion, Reorder, useDragControls, type HTMLMotionProps } from "motion/react";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronDown, Eye, EyeOff, GripVertical, RotateCcw } from "lucide-react";
import { LiquidButton } from "../motion/LiquidButton";
import { LiquidPopover } from "../motion/LiquidPopover";
import { useMotionPreferences } from "../motion/motion-preferences";
import { transitions } from "../motion/motion-tokens";
import ContextMenu, { useContextMenu } from "../ui/ContextMenu";
import { ModalRegistration as Modal } from "../motion/OverlayHost";
import { GlassSegments, longPressMenu, type MenuPoint } from "../ui/GlassSegments";
import { byViews, type Category } from "../api";
import "./board-bar.css";

export type BoardLayout = { order: string[] | null; hidden: string[] };
export const defaultBoardLayout: BoardLayout = { order: null, hidden: [] };

type IconFor = (id: string) => ComponentType<{ size?: number; strokeWidth?: number }>;

function arrangeBoards(categories: Category[], layout: BoardLayout) {
  const byId = new Map(categories.map((c) => [c.id, c]));
  const fixed = (layout.order || []).map((id) => byId.get(id)).filter((c): c is Category => !!c);
  const placed = new Set(fixed.map((c) => c.id));
  const rest = categories.filter((c) => !placed.has(c.id));
  rest.sort(fixed.length ? (a, b) => a.created_at - b.created_at : byViews);
  return [...fixed, ...rest];
}

function useClipWhileMoving(startMoving = false) {
  const [moving, setMoving] = useState(startMoving);
  return {
    onAnimationStart: () => setMoving(true),
    onAnimationComplete: () => setMoving(false),
    style: { overflow: moving ? ("hidden" as const) : ("visible" as const) },
  };
}
const cellWidth = (width: number) => (width < 520 ? 92 : 124);
const gap = 4;
const maxColumns = 8;

export default function BoardBar({
  categories,
  value,
  onChange,
  layout,
  onLayoutChange,
  iconFor,
}: {
  categories: Category[];
  value: string;
  onChange: (id: string) => void;
  layout: BoardLayout;
  onLayoutChange: (next: BoardLayout, notice?: string) => void;
  iconFor: IconFor;
}) {
  const { reduced } = useMotionPreferences();
  const [expanded, setExpanded] = useState(false);
  const [picker, setPicker] = useState(false);
  const [arranging, setArranging] = useState(false);
  const [columns, setColumns] = useState(6);
  const measureRef = useRef<HTMLDivElement>(null);
  const pickerTrigger = useRef<HTMLButtonElement>(null);
  const menu = useContextMenu<{ id: string; hidden: boolean }>();
  const plateClip = useClipWhileMoving();
  const plateRef = useRef<HTMLDivElement>(null);
  const [plateHeight, setPlateHeight] = useState(0);
  useLayoutEffect(() => {
    const inner = plateRef.current;
    if (!inner) return;
    const update = () => setPlateHeight(inner.offsetHeight);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(inner);
    return () => observer.disconnect();
  }, []);

  const ordered = useMemo(() => arrangeBoards(categories, layout), [categories, layout]);
  const hiddenSet = useMemo(() => new Set(layout.hidden), [layout.hidden]);
  const visible = ordered.filter((c) => !hiddenSet.has(c.id));
  const hidden = ordered.filter((c) => hiddenSet.has(c.id));
  const peeking = hidden.find((c) => c.id === value);
  const all = [
    { id: "all", label: "全部" },
    ...visible.map((c) => ({ id: c.id, label: c.name })),
    ...(peeking ? [{ id: peeking.id, label: peeking.name, icon: <EyeOff size={13} aria-hidden="true" /> }] : []),
  ];

  useLayoutEffect(() => {
    const box = measureRef.current;
    if (!box) return;
    const update = () => {
      const width = box.clientWidth;
      const cell = cellWidth(window.innerWidth);
      setColumns(Math.max(2, Math.min(maxColumns, Math.floor((width + gap) / (cell + gap)))));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(box);
    return () => observer.disconnect();
  }, []);

  const overflow = all.length > columns;
  const foldable = all.length > 1;
  useEffect(() => {
    if (!foldable) setExpanded(false);
  }, [foldable]);
  let shown = all;
  if (!expanded && overflow) {
    shown = all.slice(0, columns);
    const picked = all.findIndex((item) => item.id === value);
    if (picked >= columns) shown = [...all.slice(0, columns - 1), all[picked]];
  }
  const cols = expanded || overflow ? columns : Math.max(all.length, 1);

  const setHidden = (id: string, hide: boolean) => {
    const name = categories.find((c) => c.id === id)?.name || "版块";
    const next = hide ? [...layout.hidden.filter((x) => x !== id), id] : layout.hidden.filter((x) => x !== id);
    onLayoutChange(
      { ...layout, hidden: next },
      hide ? `已隐藏「${name}」\n展开版块栏，在底部的「已隐藏」里可以恢复。` : `「${name}」已恢复显示`,
    );
  };
  const openMenu = (id: string, isHidden: boolean, event: MenuPoint) => {
    if (id === "all") return;
    menu.open(event, { id, hidden: isHidden });
  };

  return (
    <div className={`board-bar ${expanded ? "is-expanded" : ""}`} data-foldable={foldable || undefined}>
      <div className="board-bar-main" ref={measureRef}>
        <motion.div
          className="board-bar-plate"
          initial={false}
          animate={plateHeight ? { height: plateHeight } : undefined}
          transition={reduced ? { duration: 0 } : transitions.surface}
          {...plateClip}
        >
          <div ref={plateRef} className="board-bar-plate-inner">
          <GlassSegments<string>
            className="category-segs board-segs is-grid"
            label="筛选版块"
            value={value}
            onChange={(id) => {
              onChange(id);
            }}
            columns={cols}
            items={shown}
            onItemMenu={(id, event) => openMenu(id, !!peeking && id === peeking.id, event)}
          />
          </div>
        </motion.div>
        <AnimatePresence initial={false}>
          {expanded && (
            <ClipMotion
              className="board-bar-footer"
              initial={reduced ? { opacity: 0 } : { opacity: 0, height: 0 }}
              animate={reduced ? { opacity: 1 } : { opacity: 1, height: "auto" }}
              exit={reduced ? { opacity: 0 } : { opacity: 0, height: 0 }}
              transition={reduced ? { duration: 0.12 } : transitions.surface}
            >
              <div className="board-bar-footer-inner">
                {hidden.length > 0 ? (
                  <LiquidButton
                    ref={pickerTrigger}
                    type="button"
                    className={`board-bar-chip ${peeking ? "is-active" : ""}`}
                    aria-haspopup="menu"
                    aria-expanded={picker}
                    onClick={() => setPicker((open) => !open)}
                  >
                    <EyeOff size={14} aria-hidden="true" />
                    <span>已隐藏</span>
                    <em>{hidden.length}</em>
                    <ChevronDown size={14} aria-hidden="true" className="board-bar-chip-caret" />
                  </LiquidButton>
                ) : (
                  <span className="board-bar-hint">右键或长按版块，可以把它隐藏</span>
                )}
                <LiquidButton type="button" className="board-bar-chip" onClick={() => setArranging(true)}>
                  <ArrowUpDown size={14} aria-hidden="true" />
                  <span>自定义排列</span>
                </LiquidButton>
              </div>
            </ClipMotion>
          )}
        </AnimatePresence>
        <LiquidPopover
          open={picker && expanded && hidden.length > 0}
          className="context-menu glass board-hidden-menu"
          label="已隐藏的版块"
          triggerRef={pickerTrigger}
          onClose={() => setPicker(false)}
        >
          <p className="board-hidden-note">点击查看，右键或长按恢复显示</p>
          {hidden.map((c) => {
            const Icon = iconFor(c.id);
            return (
              <LiquidButton
                key={c.id}
                type="button"
                role="menuitem"
                className={c.id === value ? "is-current" : ""}
                onClick={() => {
                  onChange(c.id);
                  setPicker(false);
                }}
                {...longPressMenu((event) => openMenu(c.id, true, event))}
              >
                <Icon size={15} />
                <span>{c.name}</span>
              </LiquidButton>
            );
          })}
        </LiquidPopover>
      </div>
      {foldable && (
        <LiquidButton
          type="button"
          className="board-bar-toggle icon-button"
          aria-expanded={expanded}
          aria-label={expanded ? "收起版块" : "展开全部版块"}
          title={expanded ? "收起版块" : "展开全部版块"}
          onClick={() => {
            setExpanded((open) => !open);
            setPicker(false);
          }}
        >
          <ChevronDown size={18} aria-hidden="true" />
        </LiquidButton>
      )}
      {menu.menu && (
        <ContextMenu
          x={menu.menu.x}
          y={menu.menu.y}
          open={menu.isOpen}
          onClose={menu.close}
          onExited={menu.finish}
          triggerRef={menu.triggerRef}
          items={
            menu.menu.item.hidden
              ? [
                  { label: "查看这个版块", icon: <ArrowDown size={14} />, onSelect: () => { onChange(menu.menu!.item.id); setPicker(false); } },
                  { label: "恢复显示", icon: <Eye size={14} />, onSelect: () => setHidden(menu.menu!.item.id, false) },
                ]
              : [
                  { label: "隐藏这个版块", icon: <EyeOff size={14} />, onSelect: () => setHidden(menu.menu!.item.id, true) },
                  { label: "自定义排列", icon: <ArrowUpDown size={14} />, onSelect: () => setArranging(true) },
                ]
          }
        />
      )}
      {arranging && (
        <ArrangeDialog
          ordered={ordered}
          hidden={layout.hidden}
          defaults={categories}
          iconFor={iconFor}
          onClose={() => setArranging(false)}
          onSave={(next) => {
            setArranging(false);
            onLayoutChange(next, "版块排列已保存");
          }}
        />
      )}
    </div>
  );
}

export function ClipMotion(props: HTMLMotionProps<"div">) {
  const clip = useClipWhileMoving(true);
  return <motion.div {...props} {...clip} />;
}

function ArrangeDialog({
  ordered,
  hidden,
  defaults,
  iconFor,
  onClose,
  onSave,
}: {
  ordered: Category[];
  hidden: string[];
  defaults: Category[];
  iconFor: IconFor;
  onClose: () => void;
  onSave: (next: BoardLayout) => void;
}) {
  const [list, setList] = useState(() => ordered.map((c) => c.id));
  const [off, setOff] = useState(() => new Set(hidden));
  const byId = useMemo(() => new Map(ordered.map((c) => [c.id, c])), [ordered]);
  const move = (index: number, step: number) => {
    const target = index + step;
    if (target < 0 || target >= list.length) return;
    const next = [...list];
    [next[index], next[target]] = [next[target], next[index]];
    setList(next);
  };
  const toggle = (id: string) =>
    setOff((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const defaultIds = defaults.map((c) => c.id);
  const isDefault = list.length === defaultIds.length && list.every((id, i) => id === defaultIds[i]);
  return (
    <Modal title="自定义版块排列" onClose={onClose} className="board-arrange-modal">
      <p className="board-arrange-note">
        拖动或用箭头调整顺序；关掉眼睛的版块会收进「已隐藏」。
        <br />
        调整后顺序固定下来，之后新建的版块按创建时间排在最后。
      </p>
      <Reorder.Group axis="y" values={list} onReorder={setList} className="board-arrange-list" as="ol">
        {list.map((id, index) => {
          const board = byId.get(id);
          if (!board) return null;
          return (
            <ArrangeRow
              key={id}
              id={id}
              index={index}
              count={list.length}
              name={board.name}
              Icon={iconFor(id)}
              hidden={off.has(id)}
              onMove={(step) => move(index, step)}
              onToggle={() => toggle(id)}
            />
          );
        })}
      </Reorder.Group>
      <div className="board-arrange-actions">
        <LiquidButton
          type="button"
          className="button secondary"
          disabled={isDefault && off.size === 0}
          onClick={() => {
            setList(defaultIds);
            setOff(new Set());
          }}
        >
          <RotateCcw size={15} />
          恢复默认
        </LiquidButton>
        <LiquidButton type="button" className="button secondary" onClick={onClose}>
          取消
        </LiquidButton>
        <LiquidButton
          type="button"
          className="button primary"
          onClick={() => onSave({ order: isDefault ? null : list, hidden: list.filter((id) => off.has(id)) })}
        >
          保存
        </LiquidButton>
      </div>
    </Modal>
  );
}

function ArrangeRow({
  id,
  index,
  count,
  name,
  Icon,
  hidden,
  onMove,
  onToggle,
}: {
  id: string;
  index: number;
  count: number;
  name: string;
  Icon: ReturnType<IconFor>;
  hidden: boolean;
  onMove: (step: number) => void;
  onToggle: () => void;
}) {
  const controls = useDragControls();
  return (
    <Reorder.Item value={id} dragListener={false} dragControls={controls} className={`board-arrange-row ${hidden ? "is-off" : ""}`}>
      <span
        className="board-arrange-grip"
        aria-hidden="true"
        onPointerDown={(event) => {
          event.preventDefault();
          controls.start(event);
        }}
      >
        <GripVertical size={16} />
      </span>
      <span className="board-arrange-icon" aria-hidden="true">
        <Icon size={16} strokeWidth={1.6} />
      </span>
      <span className="board-arrange-name">{name}</span>
      <span className="board-arrange-tools">
        <LiquidButton type="button" className="icon-button" aria-label={`把「${name}」上移`} disabled={index === 0} onClick={() => onMove(-1)}>
          <ArrowUp size={15} />
        </LiquidButton>
        <LiquidButton type="button" className="icon-button" aria-label={`把「${name}」下移`} disabled={index === count - 1} onClick={() => onMove(1)}>
          <ArrowDown size={15} />
        </LiquidButton>
        <LiquidButton
          type="button"
          className={`icon-button ${hidden ? "is-off" : ""}`}
          aria-pressed={!hidden}
          aria-label={hidden ? `显示「${name}」` : `隐藏「${name}」`}
          title={hidden ? "已隐藏，点击恢复显示" : "点击隐藏"}
          onClick={onToggle}
        >
          {hidden ? <EyeOff size={15} /> : <Eye size={15} />}
        </LiquidButton>
      </span>
    </Reorder.Item>
  );
}
