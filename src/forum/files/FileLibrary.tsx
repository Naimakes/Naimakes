import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  ArchiveRestore,
  ArrowLeft,
  Download,
  Eye,
  EyeOff,
  LibraryBig,
  List,
  LoaderCircle,
  MoreHorizontal,
  Pin,
  PinOff,
  Star,
  Trash2,
  Upload,
} from "lucide-react";
import { api, uploadFile, type User } from "../api";
import { LiquidButton } from "../motion/LiquidButton";
import { LiquidPopover } from "../motion/LiquidPopover";
import { GlassSegments, longPressMenu } from "../ui/GlassSegments";
import ContextMenu, { useContextMenu } from "../ui/ContextMenu";
import Confirm from "../ui/Confirm";
import { UploadProgress, useUploadSession } from "../ui/UploadProgress";
import { GlassSelect } from "../ui/GlassSelect";
import GlassDateTime from "../ui/GlassDateTime";
import FileSearch from "./FileSearch";
import { inTimeRange, timeRanges, useFileMatches, type TimeRange } from "./file-filters";
import { AttachmentViewer, fileKind, fileSize, icons, labels, type Kind } from "../posts/Attachments";
import "./file-library.css";

export type LibraryFile = {
  id: string;
  url: string;
  name: string;
  mime: string;
  size: number;
  source: string;
  favorite: boolean;
  pinned: boolean;
  pinned_at: number | null;
  hidden: boolean;
  deleted_at: number | null;
  created_at: number;
};
type Action = "favorite" | "unfavorite" | "pin" | "unpin" | "hide" | "unhide" | "delete" | "restore" | "purge";
type View = "main" | "hidden" | "deleted";
type Tab = "all" | "favorite" | "image" | "pdf" | "doc" | "sheet" | "media" | "other";

const TRASH_DAYS = 30;
const DAY = 86400000;
const todayKey = () => {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
};

const tabs: { id: Tab; label: string }[] = [
  { id: "all", label: "全部" },
  { id: "favorite", label: "收藏" },
  { id: "image", label: "图片" },
  { id: "pdf", label: "PDF" },
  { id: "doc", label: "文稿" },
  { id: "sheet", label: "表格" },
  { id: "media", label: "音视频" },
  { id: "other", label: "其他" },
];
const groupOf: Record<Kind, Exclude<Tab, "all" | "favorite">> = {
  image: "image",
  pdf: "pdf",
  doc: "doc",
  text: "doc",
  slide: "doc",
  sheet: "sheet",
  audio: "media",
  video: "media",
  archive: "other",
  file: "other",
};
const sourceLabels: Record<string, string> = {
  upload: "直接上传",
  assistant: "助手对话",
  post: "讨论附件",
  comment: "评论附件",
  message: "私信附件",
};
const emptyText: Record<Tab, string> = {
  all: "图书馆还是空的。在讨论里添加附件、和助手聊天时附上文件，或点右上角的「上传」，文件都会收进这里。",
  favorite: "还没有收藏的文件。点文件卡片上的星标即可收藏。",
  image: "没有图片。",
  pdf: "没有 PDF 文件。",
  doc: "没有文稿。",
  sheet: "没有表格。",
  media: "没有音频或视频。",
  other: "没有其他类型的文件。",
};

const byOrder = (a: LibraryFile, b: LibraryFile) =>
  Number(b.pinned) - Number(a.pinned) || (b.pinned_at ?? 0) - (a.pinned_at ?? 0) || b.created_at - a.created_at;
const daysLeft = (file: LibraryFile) =>
  Math.max(0, Math.ceil(((file.deleted_at ?? 0) + TRASH_DAYS * DAY - Date.now()) / DAY));
const dateText = (time: number) => {
  const date = new Date(time);
  return date.toLocaleDateString("zh-CN", { year: date.getFullYear() === new Date().getFullYear() ? undefined : "numeric", month: "numeric", day: "numeric" });
};
const extensionOf = (name: string) => {
  const dot = name.lastIndexOf(".");
  return dot > 0 && dot < name.length - 1 ? name.slice(dot + 1, dot + 6).toUpperCase() : "";
};
function startDownload(file: LibraryFile) {
  const link = document.createElement("a");
  link.href = file.url;
  link.download = file.name;
  document.body.append(link);
  link.click();
  link.remove();
}

function Thumb({ file }: { file: LibraryFile }) {
  const kind = fileKind(file);
  const Icon = icons[kind];
  const [broken, setBroken] = useState(false);
  if (kind === "image" && !broken)
    return <img src={file.url} alt="" loading="lazy" draggable={false} onError={() => setBroken(true)} />;
  return (
    <span className={`file-glyph kind-${kind}`}>
      <Icon size={34} strokeWidth={1.2} />
      {extensionOf(file.name) && <b>{extensionOf(file.name)}</b>}
    </span>
  );
}

export default function FileLibrary({
  user,
  actionsSlot,
  onLogin,
  notify,
}: {
  user: User | null;
  actionsSlot: HTMLElement | null;
  onLogin: () => void;
  notify: (message: string, tone?: "info" | "success" | "error") => void;
}) {
  const [files, setFiles] = useState<LibraryFile[] | null>(null);
  const [error, setError] = useState("");
  const [view, setView] = useState<View>("main");
  const [tab, setTab] = useState<Tab>("all");
  const [search, setSearch] = useState("");
  const [range, setRange] = useState<TimeRange>("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [viewing, setViewing] = useState<LibraryFile | null>(null);
  const [confirm, setConfirm] = useState<{ ids: string[]; all?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [uploading, setUploading] = useState(0);
  const menuTrigger = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const session = useUploadSession();
  const itemMenu = useContextMenu<LibraryFile>();
  const userId = user?.id;
  const { matches, searching } = useFileMatches(search, !!user);

  const load = useCallback(async () => {
    try {
      const result = await api<{ files: LibraryFile[] }>("/library/files");
      setFiles(result.files);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    if (userId) void load();
  }, [userId, load]);
  useEffect(() => {
    setSelecting(false);
    setPicked([]);
  }, [view, tab]);

  const live = useMemo(() => (files ?? []).filter((f) => f.deleted_at === null), [files]);
  const shown = useMemo(() => {
    const query = search.trim().toLowerCase();
    return (files ?? [])
      .filter((f) => inTimeRange(f.created_at, range, from, to))
      .filter((f) => {
        if (view === "deleted") return f.deleted_at !== null;
        if (f.deleted_at !== null) return false;
        if (view === "hidden") return f.hidden;
        if (f.hidden) return false;
        if (tab === "favorite") return f.favorite;
        return tab === "all" || groupOf[fileKind(f)] === tab;
      })
      .filter((f) => !query || (matches ? matches.has(f.id) : f.name.toLowerCase().includes(query)))
      .sort(view === "deleted" ? (a, b) => (b.deleted_at ?? 0) - (a.deleted_at ?? 0) : byOrder);
  }, [files, view, tab, search, matches, range, from, to]);
  const counts = useMemo(
    () => ({
      hidden: live.filter((f) => f.hidden).length,
      deleted: (files ?? []).length - live.length,
      total: live.filter((f) => !f.hidden).length,
      favorite: live.filter((f) => f.favorite && !f.hidden).length,
      size: live.reduce((sum, f) => sum + f.size, 0),
    }),
    [files, live],
  );

  const apply = (ids: string[], action: Action) => {
    const set = new Set(ids);
    const now = Date.now();
    setFiles((list) => {
      if (!list) return list;
      if (action === "purge") return list.filter((f) => !set.has(f.id));
      return list.map((f) => {
        if (!set.has(f.id)) return f;
        switch (action) {
          case "favorite": return { ...f, favorite: true };
          case "unfavorite": return { ...f, favorite: false };
          case "pin": return { ...f, pinned: true, pinned_at: now };
          case "unpin": return { ...f, pinned: false, pinned_at: null };
          case "hide": return { ...f, hidden: true };
          case "unhide": return { ...f, hidden: false };
          case "delete": return { ...f, deleted_at: now };
          default: return { ...f, deleted_at: null };
        }
      });
    });
  };
  const notices: Record<Action, string> = {
    favorite: "已收藏",
    unfavorite: "已取消收藏",
    pin: "已置顶",
    unpin: "已取消置顶",
    hide: "已隐藏，可在右上角「⋯」的「已隐藏」里找到",
    unhide: "已取消隐藏",
    delete: `已移到「已删除」，${TRASH_DAYS} 天内可以恢复`,
    restore: "已恢复",
    purge: "已彻底删除",
  };
  const run = async (ids: string[], action: Action) => {
    if (!ids.length || busy) return;
    setBusy(true);
    try {
      await api("/library/files/action", { method: "POST", body: JSON.stringify({ ids, action }) });
      apply(ids, action);
      setPicked((current) => current.filter((id) => !ids.includes(id)));
      notify(notices[action], "success");
    } catch (e) {
      notify((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };
  const emptyTrash = async () => {
    setBusy(true);
    try {
      await api("/library/trash", { method: "DELETE" });
      setFiles((list) => list && list.filter((f) => f.deleted_at === null));
      setPicked([]);
      notify("已清空「已删除」", "success");
    } catch (e) {
      notify((e as Error).message, "error");
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  };

  async function upload(list: FileList | null) {
    const chosen = Array.from(list || []);
    if (!chosen.length) return;
    setUploading((n) => n + chosen.length);
    const trackers = session.begin(chosen);
    let added = 0;
    for (const [index, file] of chosen.entries()) {
      try {
        const uploaded = await uploadFile(file, trackers[index].progress);
        const result = await api<{ file: LibraryFile }>("/library/files", {
          method: "POST",
          body: JSON.stringify({ url: uploaded.url, name: uploaded.name }),
        });
        setFiles((current) => [result.file, ...(current ?? []).filter((f) => f.id !== result.file.id)]);
        added++;
      } catch (e) {
        notify(`${file.name}：${(e as Error).message}`, "error");
      } finally {
        trackers[index].done();
        setUploading((n) => n - 1);
      }
    }
    if (input.current) input.current.value = "";
    if (added) {
      notify(`已上传 ${added} 个文件`, "success");
      if (view !== "main") setView("main");
    }
  }

  const toggle = (id: string) => setPicked((current) => (current.includes(id) ? current.filter((x) => x !== id) : [...current, id]));
  const pickedFiles = shown.filter((f) => picked.includes(f.id));
  const allFavorite = pickedFiles.length > 0 && pickedFiles.every((f) => f.favorite);

  const actionsPortal =
    actionsSlot && user
      ? createPortal(
          <>
            <LiquidButton
              type="button"
              className="button secondary"
              disabled={uploading > 0}
              onClick={() => input.current?.click()}
            >
              {uploading > 0 ? <UploadProgress percent={session.percent} /> : <Upload size={16} />}
              {uploading > 0 ? `上传中 ${uploading}` : "上传"}
            </LiquidButton>
            <div className="file-more" data-popover-owner="file-more">
              <LiquidButton
                ref={menuTrigger}
                type="button"
                className="button secondary file-more-trigger"
                aria-label="更多"
                title="更多"
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                onClick={() => setMenuOpen((open) => !open)}
              >
                <MoreHorizontal size={18} />
              </LiquidButton>
              <LiquidPopover open={menuOpen} triggerRef={menuTrigger} className="board-more-menu file-more-menu glass" label="图书馆" onClose={() => setMenuOpen(false)}>
                <LiquidButton
                  onClick={() => {
                    setMenuOpen(false);
                    setView("hidden");
                  }}
                >
                  <EyeOff size={16} />
                  已隐藏
                  {counts.hidden > 0 && <em className="file-menu-count">{counts.hidden}</em>}
                </LiquidButton>
                <LiquidButton
                  onClick={() => {
                    setMenuOpen(false);
                    setView("deleted");
                  }}
                >
                  <Trash2 size={16} />
                  已删除
                  {counts.deleted > 0 && <em className="file-menu-count">{counts.deleted}</em>}
                </LiquidButton>
              </LiquidPopover>
            </div>
          </>,
          actionsSlot,
        )
      : null;

  if (!user)
    return (
      <div className="empty-state file-empty">
        <LibraryBig size={40} strokeWidth={1} />
        <h3>登录后查看图书馆</h3>
        <p>你上传过的文件、图片和 PDF 都会收纳在这里，换设备也能找回。</p>
        <LiquidButton className="button primary" onClick={onLogin}>登录社区</LiquidButton>
      </div>
    );

  const menuItems = (file: LibraryFile) => {
    const base = [
      { label: "查看", icon: <Eye size={14} />, onSelect: () => setViewing(file) },
      { label: "下载", icon: <Download size={14} />, onSelect: () => startDownload(file) },
    ];
    if (file.deleted_at !== null)
      return [
        ...base,
        { label: "恢复", icon: <ArchiveRestore size={14} />, onSelect: () => void run([file.id], "restore") },
        { label: "彻底删除", icon: <Trash2 size={14} />, danger: true, onSelect: () => setConfirm({ ids: [file.id] }) },
      ];
    return [
      ...base,
      { label: file.favorite ? "取消收藏" : "收藏", icon: <Star size={14} />, onSelect: () => void run([file.id], file.favorite ? "unfavorite" : "favorite") },
      { label: file.pinned ? "取消置顶" : "置顶", icon: file.pinned ? <PinOff size={14} /> : <Pin size={14} />, onSelect: () => void run([file.id], file.pinned ? "unpin" : "pin") },
      { label: file.hidden ? "取消隐藏" : "隐藏", icon: file.hidden ? <Eye size={14} /> : <EyeOff size={14} />, onSelect: () => void run([file.id], file.hidden ? "unhide" : "hide") },
      { label: "删除", icon: <Trash2 size={14} />, danger: true, onSelect: () => void run([file.id], "delete") },
    ];
  };

  const title = view === "hidden" ? "已隐藏" : view === "deleted" ? "已删除" : "";
  const note =
    view === "deleted"
      ? `已删除的文件保留 ${TRASH_DAYS} 天，到期后自动彻底删除；期间可以恢复、查看和下载。`
      : view === "hidden"
        ? "隐藏的文件不会出现在「全部」和各分类里，只在这里显示。"
        : "";
  const empty = search.trim() || range !== "all"
    ? "没有找到符合条件的文件。"
    : view === "deleted"
      ? "「已删除」是空的。"
      : view === "hidden"
        ? "没有被隐藏的文件。"
        : emptyText[tab];

  const card = (file: LibraryFile): ReactNode => {
    const kind = fileKind(file);
    const checked = picked.includes(file.id);
    const trashed = file.deleted_at !== null;
    return (
      <li
        key={file.id}
        className={"file-card" + (checked ? " checked" : "") + (file.pinned && !trashed ? " pinned" : "")}
        {...longPressMenu((event) => itemMenu.open(event, file))}
      >
        <button
          type="button"
          className="file-open"
          aria-label={(selecting ? (checked ? "取消选择：" : "选择：") : "查看：") + file.name}
          onClick={() => (selecting ? toggle(file.id) : setViewing(file))}
        >
          <span className="file-thumb">
            <Thumb file={file} />
          </span>
          <span className="file-info">
            <strong title={file.name}>{file.name}</strong>
            <small>
              {labels[kind]} · {fileSize(file.size)}
            </small>
            <small>
              {trashed ? `${daysLeft(file)} 天后彻底删除` : `${dateText(file.created_at)} · ${sourceLabels[file.source] || "上传"}`}
            </small>
            {matches?.get(file.id) && <small className="file-via" title={matches.get(file.id)!.title}>来自对话「{matches.get(file.id)!.title}」</small>}
          </span>
        </button>
        {selecting && (
          <label className="file-check">
            <input type="checkbox" checked={checked} onChange={() => toggle(file.id)} aria-label={"选择：" + file.name} />
          </label>
        )}
        {!trashed && (file.pinned || file.favorite) && (
          <span className="file-badges" aria-hidden="true">
            {file.pinned && <Pin size={12} />}
            {file.favorite && <Star size={12} />}
          </span>
        )}
        {!selecting && (
          <div className="file-actions">
            <a className="icon-button" href={file.url} download={file.name} aria-label={"下载：" + file.name} title="下载">
              <Download size={15} />
            </a>
            {trashed ? (
              <LiquidButton type="button" className="icon-button" aria-label={"恢复：" + file.name} title="恢复" disabled={busy} onClick={() => void run([file.id], "restore")}>
                <ArchiveRestore size={15} />
              </LiquidButton>
            ) : (
              <LiquidButton
                type="button"
                className={"icon-button" + (file.favorite ? " is-on" : "")}
                aria-pressed={file.favorite}
                aria-label={(file.favorite ? "取消收藏：" : "收藏：") + file.name}
                title={file.favorite ? "取消收藏" : "收藏"}
                disabled={busy}
                onClick={() => void run([file.id], file.favorite ? "unfavorite" : "favorite")}
              >
                <Star size={15} />
              </LiquidButton>
            )}
            <LiquidButton
              type="button"
              className="icon-button"
              aria-label={(trashed ? "彻底删除：" : "删除：") + file.name}
              title={trashed ? "彻底删除" : "删除"}
              disabled={busy}
              onClick={() => (trashed ? setConfirm({ ids: [file.id] }) : void run([file.id], "delete"))}
            >
              <Trash2 size={15} />
            </LiquidButton>
          </div>
        )}
      </li>
    );
  };

  return (
    <div className="file-library">
      {actionsPortal}
      <input hidden multiple ref={input} type="file" onChange={(e) => void upload(e.target.files)} />
      {view === "main" ? (
        <GlassSegments<Tab>
          className="file-tabs"
          label="文件分类"
          items={tabs}
          value={tab}
          onChange={setTab}
        />
      ) : (
        <div className="file-subhead">
          <LiquidButton type="button" className="button secondary compact" onClick={() => setView("main")}>
            <ArrowLeft size={16} />
            返回图书馆
          </LiquidButton>
          <h3>{title}</h3>
          {view === "deleted" && (
            <LiquidButton type="button" className="text-button danger-text" disabled={!shown.length || busy} onClick={() => setConfirm({ ids: [], all: true })}>
              <Trash2 size={14} />
              清空已删除
            </LiquidButton>
          )}
        </div>
      )}
      {note && <p className="file-note">{note}</p>}

      <FileSearch
        value={search}
        onChange={setSearch}
        busy={searching}
        shortcut
        label="搜索图书馆"
        placeholder="搜索文件名，或聊天记录里提到过的文件"
      />
      <div className="library-toolbar file-toolbar">
        <div className="file-range">
          <label className="sr-only" htmlFor="file-range">
            上传时间
          </label>
          <GlassSelect id="file-range" value={range} onChange={(e) => setRange(e.target.value as TimeRange)}>
            {timeRanges.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label}
              </option>
            ))}
          </GlassSelect>
        </div>
        {range === "custom" && (
          <div className="file-range-dates">
            <GlassDateTime label="开始日期" granularity="date" value={from} max={to || todayKey()} onChange={setFrom} />
            <span aria-hidden="true">至</span>
            <GlassDateTime label="结束日期" granularity="date" value={to} min={from || undefined} max={todayKey()} onChange={setTo} />
          </div>
        )}
        <span className="file-summary">
          {view === "main" && !search.trim() && range === "all"
            ? `${counts.total} 个文件 · ${fileSize(counts.size)}`
            : `${shown.length} 个文件`}
        </span>
        <LiquidButton
          className={`button secondary compact glass-btn ${selecting ? "selected" : ""}`}
          disabled={!shown.length}
          onClick={() => {
            setSelecting(!selecting);
            setPicked([]);
          }}
        >
          <List size={16} />
          {selecting ? "退出选择" : "选择"}
        </LiquidButton>
      </div>

      {selecting && (
        <div className="library-batch-bar file-batch">
          <label>
            <input
              type="checkbox"
              checked={shown.length > 0 && picked.length === shown.length}
              onChange={(e) => setPicked(e.target.checked ? shown.map((f) => f.id) : [])}
            />
            全选当前列表 <span>已选 {picked.length}</span>
          </label>
          {view === "deleted" ? (
            <>
              <LiquidButton className="text-button" disabled={!picked.length || busy} onClick={() => void run(picked, "restore")}>
                <ArchiveRestore size={14} />
                恢复
              </LiquidButton>
              <LiquidButton className="text-button danger-text" disabled={!picked.length || busy} onClick={() => setConfirm({ ids: picked })}>
                <Trash2 size={14} />
                彻底删除
              </LiquidButton>
            </>
          ) : (
            <>
              <LiquidButton className="text-button" disabled={!picked.length || busy} onClick={() => void run(picked, allFavorite ? "unfavorite" : "favorite")}>
                <Star size={14} />
                {allFavorite ? "取消收藏" : "收藏"}
              </LiquidButton>
              {view === "hidden" && (
                <LiquidButton className="text-button" disabled={!picked.length || busy} onClick={() => void run(picked, "unhide")}>
                  <Eye size={14} />
                  取消隐藏
                </LiquidButton>
              )}
              <LiquidButton className="text-button danger-text" disabled={!picked.length || busy} onClick={() => void run(picked, "delete")}>
                <Trash2 size={14} />
                删除
              </LiquidButton>
            </>
          )}
        </div>
      )}

      {files === null ? (
        error ? (
          <div className="empty-state file-empty" role="alert">
            <h3>{error}</h3>
            <LiquidButton className="button secondary" onClick={() => void load()}>重试</LiquidButton>
          </div>
        ) : (
          <div className="file-loading" role="status">
            <LoaderCircle className="spin" size={18} />
            正在加载…
          </div>
        )
      ) : shown.length === 0 ? (
        <div className="empty-state file-empty">
          <LibraryBig size={40} strokeWidth={1} />
          <p>{empty}</p>
        </div>
      ) : (
        <ul className="file-grid">{shown.map(card)}</ul>
      )}

      {itemMenu.menu && (
        <ContextMenu
          x={itemMenu.menu.x}
          y={itemMenu.menu.y}
          open={itemMenu.isOpen}
          onClose={itemMenu.close}
          onExited={itemMenu.finish}
          triggerRef={itemMenu.triggerRef}
          items={menuItems(itemMenu.menu.item)}
        />
      )}
      {viewing && <AttachmentViewer file={viewing} onClose={() => setViewing(null)} />}
      {confirm && (
        <Confirm
          title={confirm.all ? "清空已删除" : "彻底删除"}
          heading={confirm.all ? "清空「已删除」？" : confirm.ids.length > 1 ? `彻底删除这 ${confirm.ids.length} 个文件？` : "彻底删除这个文件？"}
          description="彻底删除后无法恢复。"
          confirmLabel={confirm.all ? "清空" : "彻底删除"}
          busy={busy}
          onClose={() => setConfirm(null)}
          onConfirm={() => {
            if (confirm.all) void emptyTrash();
            else void run(confirm.ids, "purge").then(() => setConfirm(null));
          }}
        />
      )}
    </div>
  );
}
