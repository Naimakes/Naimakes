import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowDownToLine,
  Check,
  FileText,
  ListChecks,
  LoaderCircle,
  Paperclip,
  Quote as QuoteIcon,
  Trash2,
  X,
} from "lucide-react";
import { LiquidButton } from "../motion/LiquidButton";
import { LiquidPopover } from "../motion/LiquidPopover";
import Confirm from "../ui/Confirm";
import { api, timeAgo, type Category, type Draft } from "../api";
import "./drafts.css";

export async function saveDraft(body: Record<string, unknown>, id?: string) {
  const r = await api<{ draft: Draft }>("/drafts" + (id ? "/" + id : ""), {
    method: id ? "PATCH" : "POST",
    body: JSON.stringify(body),
  });
  return r.draft;
}

function DraftCard({
  draft,
  boardName,
  managing,
  checked,
  busy,
  onImport,
  onToggle,
}: {
  draft: Draft;
  boardName: string;
  managing: boolean;
  checked: boolean;
  busy: boolean;
  onImport: () => void;
  onToggle: () => void;
}) {
  const extras = draft.attachments.length + draft.quotes.length;
  return (
    <div className={`draft-card ${checked ? "is-checked" : ""}`}>
      <LiquidButton
        type="button"
        className="draft-card-open"
        aria-pressed={managing ? checked : undefined}
        disabled={busy}
        onClick={managing ? onToggle : onImport}
      >
        <span className="draft-card-top">
          {managing && (
            <span className="draft-check" aria-hidden="true">
              {checked && <Check size={12} strokeWidth={3} />}
            </span>
          )}
          <span className="draft-card-time">{timeAgo(draft.updated_at)}更新</span>
          {draft.kind === "project" && <span className="draft-card-kind">共创</span>}
          <span className="draft-card-board">{boardName}</span>
        </span>
        <strong className="draft-card-title">{draft.title || "未命名草稿"}</strong>
        {draft.excerpt && <span className="draft-card-excerpt">{draft.excerpt}</span>}
        <span className="draft-card-foot">
          {draft.tags.slice(0, 3).map((tag) => (
            <span className="draft-tag" key={tag}>
              {tag}
            </span>
          ))}
          {draft.attachments.length > 0 && (
            <span className="draft-card-extra">
              <Paperclip size={12} />
              {draft.attachments.length}
            </span>
          )}
          {draft.quotes.length > 0 && (
            <span className="draft-card-extra">
              <QuoteIcon size={12} />
              {draft.quotes.length}
            </span>
          )}
          {!draft.tags.length && !extras && (
            <span className="draft-card-extra">{draft.visibility === "private" ? "仅自己可见" : "公开"}</span>
          )}
        </span>
      </LiquidButton>
      {!managing && (
        <LiquidButton
          type="button"
          className="button secondary draft-import"
          disabled={busy}
          onClick={onImport}
        >
          <ArrowDownToLine size={14} />
          导入
        </LiquidButton>
      )}
    </div>
  );
}

export function MyDrafts({
  categories,
  onImport,
  onError,
  disabled = false,
  version = 0,
}: {
  categories: Category[];
  onImport: (draft: Draft) => void;
  onError?: (message: string) => void;
  disabled?: boolean;
  version?: number;
}) {
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false),
    [drafts, setDrafts] = useState<Draft[]>([]),
    [loading, setLoading] = useState(false),
    [busy, setBusy] = useState(false),
    [managing, setManaging] = useState(false),
    [selected, setSelected] = useState<string[]>([]),
    [confirm, setConfirm] = useState<{ ids?: string[]; all?: boolean } | null>(null);
  const boardName = (id: string) =>
    id === "announcement" ? "站点公告" : categories.find((c) => c.id === id)?.name || "未选版块";
  const reload = useCallback(() => {
    setLoading(true);
    api<{ drafts: Draft[] }>("/drafts")
      .then((r) => setDrafts(r.drafts))
      .catch((e) => onError?.((e as Error).message))
      .finally(() => setLoading(false));
  }, [onError]);
  useEffect(() => {
    if (open) reload();
  }, [open, version]);
  useEffect(() => {
    if (!open || confirm) return;
    const dialog = document.querySelector("dialog[open]:last-of-type");
    const outside = (event: PointerEvent) => {
      if (document.querySelector("dialog[open]:last-of-type") !== dialog) return;
      const target = event.target as Node;
      if (panel.current?.contains(target) || trigger.current?.contains(target)) return;
      setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (document.querySelector("dialog[open]:last-of-type") !== dialog) return;
      event.stopPropagation();
      setOpen(false);
      trigger.current?.focus();
    };
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("keydown", escape, true);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("keydown", escape, true);
    };
  }, [open, confirm]);
  useEffect(() => {
    if (!drafts.length) {
      setManaging(false);
      setSelected([]);
    }
  }, [drafts.length]);
  async function remove(body: { ids?: string[]; all?: boolean }) {
    setBusy(true);
    try {
      const r = await api<{ drafts: Draft[] }>("/drafts", {
        method: "DELETE",
        body: JSON.stringify(body),
      });
      setDrafts(r.drafts);
      setSelected([]);
      if (body.all || !r.drafts.length) setManaging(false);
    } catch (e) {
      onError?.((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const allSelected = drafts.length > 0 && selected.length === drafts.length;
  return (
    <div className="drafts-wrap" data-popover-owner="drafts">
      <LiquidButton
        ref={trigger}
        type="button"
        className="button secondary composer-drafts-button"
        aria-expanded={open}
        aria-haspopup="dialog"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
      >
        <FileText size={16} />
        我的草稿
      </LiquidButton>
      <LiquidPopover
        open={open}
        native
        role="region"
        triggerRef={trigger}
        panelRef={panel}
        className="drafts-menu glass"
        label="我的草稿"
        avoidAnchor
        onClose={() => setOpen(false)}
      >
        <div className="drafts-head">
          <div className="drafts-head-text">
            <strong>我的草稿</strong>
            <span>保存在你的账号里，发布之前只有你看得见。</span>
          </div>
          {drafts.length > 0 && (
            <LiquidButton
              type="button"
              className="button secondary drafts-manage"
              aria-pressed={managing}
              onClick={() => {
                setManaging((v) => !v);
                setSelected([]);
              }}
            >
              {managing ? <X size={14} /> : <ListChecks size={14} />}
              {managing ? "退出管理" : "管理"}
            </LiquidButton>
          )}
        </div>
        <div className="drafts-list">
          {loading && !drafts.length ? (
            <p className="drafts-empty">
              <LoaderCircle size={18} className="spin" />
              正在取回草稿…
            </p>
          ) : !drafts.length ? (
            <p className="drafts-empty">还没有草稿。写到一半时按「保存草稿」，它就会出现在这里。</p>
          ) : (
            drafts.map((d) => (
              <DraftCard
                key={d.id}
                draft={d}
                boardName={boardName(d.category)}
                managing={managing}
                busy={busy}
                checked={selected.includes(d.id)}
                onImport={() => {
                  onImport(d);
                  setOpen(false);
                }}
                onToggle={() =>
                  setSelected((prev) =>
                    prev.includes(d.id) ? prev.filter((id) => id !== d.id) : [...prev, d.id],
                  )
                }
              />
            ))
          )}
        </div>
        {drafts.length > 0 && (
          <div className="drafts-bar">
            {managing ? (
              <>
                <span className="drafts-count">已选 {selected.length} / {drafts.length}</span>
                <LiquidButton
                  type="button"
                  className="button secondary"
                  disabled={busy}
                  onClick={() => setSelected(allSelected ? [] : drafts.map((d) => d.id))}
                >
                  {allSelected ? "取消全选" : "全选"}
                </LiquidButton>
                <LiquidButton
                  type="button"
                  className="button secondary danger-text"
                  disabled={!selected.length || busy}
                  onClick={() => setConfirm({ ids: selected })}
                >
                  <Trash2 size={14} />
                  删除所选
                </LiquidButton>
              </>
            ) : (
              <>
                <span className="drafts-count">共 {drafts.length} 篇草稿</span>
                <LiquidButton
                  type="button"
                  className="button secondary danger-text"
                  disabled={busy}
                  onClick={() => setConfirm({ all: true })}
                >
                  <Trash2 size={14} />
                  一键清空
                </LiquidButton>
              </>
            )}
          </div>
        )}
      </LiquidPopover>
      {confirm && (
        <Confirm
          title="删除草稿"
          heading={confirm.all ? "清空全部草稿？" : `删除选中的 ${confirm.ids?.length || 0} 篇草稿？`}
          description={
            confirm.all
              ? "这些草稿会从你的账号里移除，已经发布的讨论不受影响。"
              : "被选中的草稿会从你的账号里移除，已经发布的讨论不受影响。"
          }
          confirmLabel="删除草稿"
          busy={busy}
          onClose={() => setConfirm(null)}
          onConfirm={async () => {
            await remove(confirm);
            setConfirm(null);
          }}
        />
      )}
    </div>
  );
}
