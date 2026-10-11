import { LiquidButton } from "../motion/LiquidButton";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Check, ListChecks, Star, StarOff, Trash2, X } from "lucide-react";
import Confirm from "../ui/Confirm";
import ContextMenu, { useContextMenu } from "../ui/ContextMenu";
import { api, post as requestPost, type Recent } from "../api";

export function useRecents(scope: string, enabled = true) {
  const [items, setItems] = useState<Recent[]>([]);
  const reload = useCallback(() => {
    if (!enabled) return setItems([]);
    api("/recents/" + scope)
      .then((r) => setItems(r.items))
      .catch(() => {});
  }, [scope, enabled]);
  useEffect(reload, [reload]);
  const remember = useCallback(
    (value: string, label = "") => {
      if (!enabled || !value.trim()) return;
      api("/recents/" + scope, requestPost({ value: value.trim(), label }))
        .then((r) => setItems(r.items))
        .catch(() => {});
    },
    [scope, enabled],
  );
  const pin = useCallback(
    async (values: string[], pinned: boolean) => {
      const r = await api("/recents/" + scope, {
        method: "PATCH",
        body: JSON.stringify({ values, pinned }),
      });
      setItems(r.items);
      return r.items as Recent[];
    },
    [scope],
  );
  return { items, setItems, reload, remember, pin };
}

export function RecentsPanel({
  scope,
  title,
  items,
  onItems,
  onPick,
  onError,
  renderItem,
  emptyHint,
  pinnable = false,
  pinnedTitle = "收藏的关键词",
}: {
  scope: string;
  title: string;
  items: Recent[];
  onItems: (items: Recent[]) => void;
  onPick: (item: Recent) => void;
  onError?: (message: string) => void;
  renderItem?: (item: Recent) => ReactNode;
  emptyHint?: string;
  pinnable?: boolean;
  pinnedTitle?: string;
}) {
  const [managing, setManaging] = useState(false),
    [selected, setSelected] = useState<string[]>([]),
    [busy, setBusy] = useState(false);
  const menu = useContextMenu<Recent>();
  const [confirm, setConfirm] = useState<{ values?: string[]; all?: boolean } | null>(null);
  useEffect(() => {
    if (!items.length) {
      setManaging(false);
      setSelected([]);
    }
  }, [items.length]);
  async function pin(values: string[], pinned: boolean) {
    setBusy(true);
    try {
      const r = await api("/recents/" + scope, {
        method: "PATCH",
        body: JSON.stringify({ values, pinned }),
      });
      onItems(r.items);
      setSelected([]);
    } catch (e) {
      onError?.((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function remove(body: { values?: string[]; all?: boolean }) {
    setBusy(true);
    try {
      const r = await api("/recents/" + scope, {
        method: "DELETE",
        body: JSON.stringify(body),
      });
      onItems(r.items);
      setSelected([]);
      if (body.all || !r.items.length) setManaging(false);
    } catch (e) {
      onError?.((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (!items.length)
    return emptyHint ? <p className="recents-empty">{emptyHint}</p> : null;
  const allSelected = selected.length === items.length;
  const history = pinnable ? items.filter((i) => !i.pinned) : items;
  const groups = pinnable
    ? [
        { key: "pinned", title: pinnedTitle, items: items.filter((i) => i.pinned) },
        { key: "history", title, items: history },
      ].filter((g) => g.items.length)
    : [{ key: "all", title, items }];
  const chosen = items.filter((i) => selected.includes(i.value));
  const chip = (item: Recent) => {
    const checked = selected.includes(item.value);
    return (
      <LiquidButton
        key={item.value}
        type="button"
        className={`recent-item ${checked ? "checked" : ""} ${item.pinned ? "pinned" : ""}`}
        aria-pressed={managing ? checked : undefined}
        title={managing ? "选择这条记录" : item.label || item.value}
        onContextMenu={(e) => menu.open(e, item)}
        onClick={() =>
          managing
            ? setSelected((prev) =>
                prev.includes(item.value)
                  ? prev.filter((v) => v !== item.value)
                  : [...prev, item.value],
              )
            : onPick(item)
        }
      >
        {managing && checked && <Check className="recent-tick" size={13} aria-hidden="true" />}
        {pinnable && item.pinned && !managing && (
          <Star className="recent-star" size={12} aria-label="已收藏" />
        )}
        {renderItem ? renderItem(item) : <span>{item.label || item.value}</span>}
      </LiquidButton>
    );
  };
  return (
    <div className={`recents ${managing ? "is-managing" : ""}`}>
      {groups.map((group, index) => (
        <div className={`recents-group recents-${group.key}`} key={group.key}>
          <div className="recents-head">
            <span>
              {group.key === "pinned" && <Star size={11} />}
              {group.title}
            </span>
            {index === 0 && (
              <LiquidButton
                type="button"
                className="text-button recents-manage"
                aria-pressed={managing}
                onClick={() => {
                  setManaging(!managing);
                  setSelected([]);
                }}
              >
                {managing ? <X size={13} /> : <ListChecks size={13} />}
                {managing ? "退出管理" : "管理"}
              </LiquidButton>
            )}
            {group.key !== "pinned" && (
              <LiquidButton
                type="button"
                className="text-button danger-text"
                disabled={busy}
                onClick={() => setConfirm({ all: true })}
              >
                <Trash2 size={13} />
                一键清空
              </LiquidButton>
            )}
          </div>
          <div className="recents-items">{group.items.map(chip)}</div>
        </div>
      ))}
      {managing && (
        <div className="recents-bar">
          <LiquidButton
            type="button"
            className="text-button recents-action"
            onClick={() =>
              setSelected(allSelected ? [] : items.map((i) => i.value))
            }
          >
            {allSelected ? "取消全选" : "全选"}
          </LiquidButton>
          <span>已选 {selected.length}</span>
          {pinnable && (
            <LiquidButton
              type="button"
              className="text-button recents-action"
              disabled={!chosen.some((i) => !i.pinned) || busy}
              onClick={() =>
                pin(chosen.filter((i) => !i.pinned).map((i) => i.value), true)
              }
            >
              <Star size={13} />
              收藏所选
            </LiquidButton>
          )}
          {pinnable && (
            <LiquidButton
              type="button"
              className="text-button recents-action"
              disabled={!chosen.some((i) => i.pinned) || busy}
              onClick={() =>
                pin(chosen.filter((i) => i.pinned).map((i) => i.value), false)
              }
            >
              <StarOff size={13} />
              取消收藏
            </LiquidButton>
          )}
          <LiquidButton
            type="button"
            className="text-button danger-text recents-action"
            disabled={!selected.length || busy}
            onClick={() => setConfirm({ values: selected })}
          >
            <Trash2 size={13} />
            删除所选
          </LiquidButton>
        </div>
      )}
      {confirm && <Confirm title="删除记录" heading={confirm.all ? "清空全部记录？" : `删除选中的 ${confirm.values?.length || 0} 条记录？`} description={confirm.all && pinnable && items.some((i) => i.pinned) ? "只清空最近记录，收藏的关键词会保留。" : "只会清除这里的最近使用记录，不影响原内容。"} confirmLabel="删除记录" busy={busy} onClose={() => setConfirm(null)} onConfirm={async () => { await remove(confirm); setConfirm(null); }} />}
      {menu.menu && (
        <ContextMenu
          x={menu.menu.x}
          y={menu.menu.y}
          onClose={menu.close} open={menu.isOpen} onExited={menu.finish} triggerRef={menu.triggerRef}
          items={[
            ...(pinnable
              ? [
                  menu.menu.item.pinned
                    ? { label: "取消收藏", icon: <StarOff size={14} />, onSelect: () => pin([menu.menu!.item.value], false) }
                    : { label: "收藏这个关键词", icon: <Star size={14} />, onSelect: () => pin([menu.menu!.item.value], true) },
                ]
              : []),
            { label: "选择这条记录", icon: <Check size={14} />, onSelect: () => { setManaging(true); setSelected([menu.menu!.item.value]); } },
            {
              label: "删除这条记录",
              icon: <Trash2 size={14} />,
              danger: true,
              onSelect: () => setConfirm({ values: [menu.menu!.item.value] }),
            },
            ...(history.length ? [{
              label: "清空全部记录",
              icon: <Trash2 size={14} />,
              danger: true,
              onSelect: () => setConfirm({ all: true }),
            }] : []),
          ]}
        />
      )}
    </div>
  );
}
