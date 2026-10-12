import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, FileText, Globe2, ImageIcon, LibraryBig, LoaderCircle, MessageCircle, Upload, X } from "lucide-react";
import { api } from "../forum/api";
import { LiquidButton } from "../forum/motion/LiquidButton";
import FileSearch from "../forum/files/FileSearch";
import { inTimeRange, timeRanges, useFileMatches, type TimeRange } from "../forum/files/file-filters";
import "./assistant-details.css";
import "./assistant-picker.css";
import { kindOfFile, newId, type Attachment } from "./attachments";

type LibraryFile = { id: string; url: string; name: string; mime: string; size: number; source: string; pinned: boolean; hidden: boolean; deleted_at: number | null; created_at: number };
type SitePost = { id: string; title: string; board: string; excerpt: string };
type SiteFile = { attachment_id: string; name: string; mime: string; size: number; post_id: string; post_title: string };
export type PickerTab = "library" | "site";

const size = (bytes: number) => (bytes < 1024 ? bytes + " B" : bytes < 1048576 ? (bytes / 1024).toFixed(0) + " KB" : (bytes / 1048576).toFixed(1) + " MB");
const day = (time: number) => new Date(time).toLocaleDateString("zh-CN", { year: "numeric", month: "numeric", day: "numeric" });
const kindLabel = { image: "图片", pdf: "PDF", text: "文本" } as const;

export default function AssistantPicker({
  signedIn,
  initialTab,
  room,
  onBack,
  onClose,
  onUpload,
  onPick,
}: {
  signedIn: boolean;
  initialTab: PickerTab;
  room: number;
  onBack: () => void;
  onClose: () => void;
  onUpload: () => void;
  onPick: (files: Attachment[]) => void;
}) {
  const [tab, setTab] = useState<PickerTab>(initialTab);
  const [query, setQuery] = useState("");
  const [range, setRange] = useState<TimeRange>("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [files, setFiles] = useState<LibraryFile[] | null>(null);
  const [error, setError] = useState("");
  const [site, setSite] = useState<{ query: string; posts: SitePost[]; files: SiteFile[] } | null>(null);
  const [chosen, setChosen] = useState<Attachment[]>([]);
  const { matches, searching } = useFileMatches(query, signedIn && tab === "library");

  useEffect(() => {
    if (!signedIn) return;
    let active = true;
    api<{ files: LibraryFile[] }>("/library/files")
      .then((r) => active && setFiles(r.files.filter((f) => f.deleted_at === null)))
      .catch((e) => active && setError((e as Error).message));
    return () => {
      active = false;
    };
  }, [signedIn]);

  const q = query.trim();
  useEffect(() => {
    if (tab !== "site" || !q) {
      setSite(null);
      return;
    }
    let active = true;
    const timer = window.setTimeout(() => {
      api<{ posts: SitePost[]; files: SiteFile[] }>("/assistant/resources?q=" + encodeURIComponent(q))
        .then((r) => active && setSite({ query: q, ...r }))
        .catch(() => active && setSite({ query: q, posts: [], files: [] }));
    }, 250);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [tab, q]);

  const shown = useMemo(
    () =>
      (files ?? [])
        .filter((f) => inTimeRange(f.created_at, range, from, to))
        .filter((f) => !q || (matches ? matches.has(f.id) : f.name.toLowerCase().includes(q.toLowerCase()))),
    [files, range, from, to, q, matches],
  );

  const isChosen = (key: string) => chosen.some((a) => keyOf(a) === key);
  const keyOf = (a: Attachment) => a.ref?.library_id || (a.ref?.post_id || "") + ":" + (a.ref?.attachment_id || "");
  const full = chosen.length >= room;
  const toggle = (key: string, make: () => Attachment) =>
    setChosen((list) => (list.some((a) => keyOf(a) === key) ? list.filter((a) => keyOf(a) !== key) : list.length >= room ? list : [...list, make()]));

  const libraryRow = (file: LibraryFile) => {
    const kind = kindOfFile(file.name, file.mime);
    const picked = isChosen(file.id);
    const via = matches?.get(file.id);
    const disabled = !kind || (!picked && full);
    return (
      <li key={file.id}>
        <label className={"assistant-pick-row" + (picked ? " is-picked" : "") + (disabled ? " is-disabled" : "")}>
          <input
            type="checkbox"
            checked={picked}
            disabled={disabled}
            onChange={() => kind && toggle(file.id, () => ({ id: newId(), name: file.name, kind, mime: file.mime, data: "", preview: kind === "image" ? file.url : undefined, ref: { library_id: file.id } }))}
          />
          <span className="assistant-pick-thumb" aria-hidden="true">
            {kind === "image" ? <img src={file.url} alt="" loading="lazy" /> : kind ? <FileText size={18} /> : <X size={16} />}
          </span>
          <span className="assistant-pick-text">
            <strong title={file.name}>{file.name}</strong>
            <small>
              {kind ? kindLabel[kind] : "助手暂时无法阅读这种文件"} · {size(file.size)} · {day(file.created_at)}
              {file.hidden ? " · 已隐藏" : ""}
            </small>
            {via && (
              <small className="assistant-pick-via">
                <MessageCircle size={11} aria-hidden="true" />
                来自对话「{via.title}」
              </small>
            )}
          </span>
        </label>
      </li>
    );
  };

  const sitePost = (post: SitePost) => {
    const key = post.id + ":";
    const picked = isChosen(key);
    const disabled = !picked && full;
    return (
      <li key={"p" + post.id}>
        <label className={"assistant-pick-row" + (picked ? " is-picked" : "") + (disabled ? " is-disabled" : "")}>
          <input type="checkbox" checked={picked} disabled={disabled} onChange={() => toggle(key, () => ({ id: newId(), name: `文章：${post.title}.md`, kind: "text", mime: "text/markdown", data: "", ref: { post_id: post.id } }))} />
          <span className="assistant-pick-thumb" aria-hidden="true">
            <Globe2 size={18} />
          </span>
          <span className="assistant-pick-text">
            <strong title={post.title}>{post.title}</strong>
            <small>{["文章", post.board].filter(Boolean).join(" · ")}</small>
          </span>
        </label>
      </li>
    );
  };

  const siteFile = (file: SiteFile) => {
    const kind = kindOfFile(file.name, file.mime);
    const key = file.post_id + ":" + file.attachment_id;
    const picked = isChosen(key);
    const disabled = !kind || (!picked && full);
    return (
      <li key={"f" + file.attachment_id}>
        <label className={"assistant-pick-row" + (picked ? " is-picked" : "") + (disabled ? " is-disabled" : "")}>
          <input
            type="checkbox"
            checked={picked}
            disabled={disabled}
            onChange={() => kind && toggle(key, () => ({ id: newId(), name: file.name, kind, mime: file.mime, data: "", ref: { post_id: file.post_id, attachment_id: file.attachment_id } }))}
          />
          <span className="assistant-pick-thumb" aria-hidden="true">
            {kind === "image" ? <ImageIcon size={18} /> : kind ? <FileText size={18} /> : <X size={16} />}
          </span>
          <span className="assistant-pick-text">
            <strong title={file.name}>{file.name}</strong>
            <small>
              {kind ? kindLabel[kind] : "助手暂时无法阅读这种文件"} · {size(file.size)} · 来自「{file.post_title}」
            </small>
          </span>
        </label>
      </li>
    );
  };

  const siteReady = site?.query === q;

  return (
    <div className="assistant-view assistant-picker" role="region" aria-label="添加附件">
      <header className="assistant-bar">
        <LiquidButton type="button" className="icon-button assistant-icon" aria-label="返回对话" title="返回" onClick={onBack}>
          <ChevronLeft size={18} />
        </LiquidButton>
        <h3>添加附件</h3>
        <LiquidButton type="button" className="icon-button assistant-icon" aria-label="关闭" title="关闭" onClick={onClose}>
          <X size={16} />
        </LiquidButton>
      </header>

      <div className="assistant-scroll">
        <div className="assistant-pick-top">
          <div className="assistant-history-tabs" role="tablist" aria-label="附件来源">
            <button type="button" role="tab" aria-selected={tab === "library"} className={tab === "library" ? "active" : undefined} onClick={() => setTab("library")}>
              <LibraryBig size={13} aria-hidden="true" /> 图书馆
            </button>
            <button type="button" role="tab" aria-selected={tab === "site"} className={tab === "site" ? "active" : undefined} onClick={() => setTab("site")}>
              <Globe2 size={13} aria-hidden="true" /> 站内文章与资源
            </button>
          </div>
          <LiquidButton type="button" className="assistant-chip is-compact" onClick={onUpload}>
            <Upload size={13} />
            上传新文件
          </LiquidButton>
        </div>

        <FileSearch
          value={query}
          onChange={setQuery}
          busy={tab === "library" ? searching : !!q && !siteReady}
          label={tab === "library" ? "搜索图书馆" : "搜索站内文章和资源"}
          placeholder={tab === "library" ? "搜索文件名，或聊天记录里提到过的文件" : "搜索站内的文章，或讨论里的附件"}
        />

        {tab === "library" && signedIn && (
          <div className="assistant-pick-range" role="group" aria-label="按上传时间筛选">
            {timeRanges.map((r) => (
              <button key={r.id} type="button" aria-pressed={range === r.id} className={range === r.id ? "active" : undefined} onClick={() => setRange(r.id)}>
                {r.label}
              </button>
            ))}
            {range === "custom" && (
              <span className="assistant-pick-dates">
                <input type="date" aria-label="开始日期" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
                <span aria-hidden="true">至</span>
                <input type="date" aria-label="结束日期" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
              </span>
            )}
          </div>
        )}

        {tab === "library" ? (
          !signedIn ? (
            <p className="assistant-history-note">登录后，上传过的文件会收进图书馆，在这里可以直接选用。</p>
          ) : files === null ? (
            <p className="assistant-history-note">{error || <><LoaderCircle size={14} className="spin" /> 正在加载…</>}</p>
          ) : shown.length === 0 ? (
            <p className="assistant-history-note">{files.length === 0 ? "图书馆还是空的。上传过的文件会收进这里。" : "没有找到符合条件的文件。"}</p>
          ) : (
            <ul className="assistant-pick-list">{shown.map(libraryRow)}</ul>
          )
        ) : !q ? (
          <p className="assistant-history-note">输入关键词，搜索站内公开的文章，以及讨论里附带的文件，选中后会交给 Naimakes 阅读。</p>
        ) : !siteReady ? (
          <p className="assistant-history-note">
            <LoaderCircle size={14} className="spin" /> 正在搜索…
          </p>
        ) : site.posts.length + site.files.length === 0 ? (
          <p className="assistant-history-note">没有找到相关的文章或资源。</p>
        ) : (
          <>
            {site.posts.length > 0 && (
              <>
                <h4 className="assistant-pick-heading">文章</h4>
                <ul className="assistant-pick-list">{site.posts.map(sitePost)}</ul>
              </>
            )}
            {site.files.length > 0 && (
              <>
                <h4 className="assistant-pick-heading">附件资源</h4>
                <ul className="assistant-pick-list">{site.files.map(siteFile)}</ul>
              </>
            )}
          </>
        )}
      </div>

      <footer className="assistant-pick-footer">
        <span>
          已选 {chosen.length} / {room}
        </span>
        <LiquidButton type="button" className="assistant-chip is-compact is-primary" disabled={!chosen.length} onClick={() => onPick(chosen)}>
          添加
        </LiquidButton>
      </footer>
    </div>
  );
}
