import { LiquidButton } from "../motion/LiquidButton";
import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import {
  Archive,
  ArrowDown,
  ArrowUp,
  Download,
  Eye,
  FileAudio,
  FileCode2,
  FileSpreadsheet,
  FileText,
  FileVideo,
  GripVertical,
  ImageIcon,
  Paperclip,
  Presentation,
  Trash2,
  X,
} from "lucide-react";
import { ModalRegistration as Modal } from "../motion/OverlayHost";
import { uploadFile, type Attachment } from "../api";
import { UploadProgress, useUploadSession } from "../ui/UploadProgress";

type Kind =
  | "image"
  | "video"
  | "audio"
  | "pdf"
  | "text"
  | "sheet"
  | "slide"
  | "doc"
  | "archive"
  | "file";

const extensions: Record<string, Kind> = {
  png: "image",
  jpg: "image",
  jpeg: "image",
  gif: "image",
  webp: "image",
  avif: "image",
  bmp: "image",
  svg: "image",
  heic: "image",
  mp4: "video",
  webm: "video",
  mov: "video",
  mkv: "video",
  avi: "video",
  mp3: "audio",
  wav: "audio",
  ogg: "audio",
  m4a: "audio",
  flac: "audio",
  pdf: "pdf",
  txt: "text",
  md: "text",
  csv: "sheet",
  json: "text",
  log: "text",
  xml: "text",
  yml: "text",
  yaml: "text",
  js: "text",
  ts: "text",
  py: "text",
  doc: "doc",
  docx: "doc",
  rtf: "doc",
  pages: "doc",
  xls: "sheet",
  xlsx: "sheet",
  numbers: "sheet",
  ppt: "slide",
  pptx: "slide",
  key: "slide",
  zip: "archive",
  rar: "archive",
  "7z": "archive",
  tar: "archive",
  gz: "archive",
};
const labels: Record<Kind, string> = {
  image: "图片",
  video: "视频",
  audio: "音频",
  pdf: "PDF 文档",
  text: "文本",
  sheet: "表格",
  slide: "演示文稿",
  doc: "文档",
  archive: "压缩包",
  file: "文件",
};
const icons: Record<Kind, typeof Paperclip> = {
  image: ImageIcon,
  video: FileVideo,
  audio: FileAudio,
  pdf: FileText,
  text: FileCode2,
  sheet: FileSpreadsheet,
  slide: Presentation,
  doc: FileText,
  archive: Archive,
  file: Paperclip,
};
function fileKind(file: Attachment): Kind {
  const mime = (file.mime || "").toLowerCase();
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  if (mime === "application/pdf") return "pdf";
  const extension = file.name.split(".").pop()?.toLowerCase() || "";
  if (extensions[extension]) return extensions[extension];
  if (mime.startsWith("text/") || mime === "application/json") return "text";
  return "file";
}
const fileTypeName = (file: Attachment) => labels[fileKind(file)];
const isImage = (file: Attachment) => fileKind(file) === "image";
function fileSize(bytes: number) {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + " KB";
  return (bytes / 1048576).toFixed(1) + " MB";
}
const FOLD_AFTER = 2;
const previewable = (kind: Kind) =>
  ["image", "video", "audio", "pdf", "text", "sheet"].includes(kind);

function AttachmentButton({
  file,
  onOpen,
  onRemove,
}: {
  file: Attachment;
  onOpen?: () => void;
  onRemove?: () => void;
}) {
  const Icon = icons[fileKind(file)];
  return (
    <span className="attachment-chip">
      <LiquidButton
        type="button"
        className="attachment-open"
        onClick={onOpen}
        title={file.name}
        aria-label={`打开${fileTypeName(file)}：${file.name}`}
      >
        <Icon size={15} />
        <span className="attachment-kind">{fileTypeName(file)}</span>
        <span className="attachment-name">{file.name}</span>
        <span className="attachment-size">{fileSize(file.size)}</span>
      </LiquidButton>
      {onRemove && (
        <LiquidButton
          type="button"
          className="attachment-remove"
          onClick={onRemove}
          aria-label={`移除附件 ${file.name}`}
        >
          <X size={13} />
        </LiquidButton>
      )}
    </span>
  );
}

function TextPreview({ file }: { file: Attachment }) {
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    fetch(file.url)
      .then((r) => r.text())
      .then((t) => active && setText(t.slice(0, 200000)))
      .catch(() => active && setError("无法读取这个文件，请下载后查看。"));
    return () => {
      active = false;
    };
  }, [file.url]);
  if (error) return <p className="attachment-note">{error}</p>;
  return <pre className="attachment-text">{text || "正在读取…"}</pre>;
}

function AttachmentViewer({
  file,
  onClose,
}: {
  file: Attachment;
  onClose: () => void;
}) {
  const kind = fileKind(file);
  const Icon = icons[kind];
  return (
    <Modal title={file.name} onClose={onClose} wide className="attachment-modal">
      <div className="attachment-preview">
        {kind === "image" && <img src={file.url} alt={file.name} />}
        {kind === "video" && <video src={file.url} controls playsInline />}
        {kind === "audio" && <audio src={file.url} controls />}
        {kind === "pdf" && (
          <iframe src={file.url} title={file.name} className="attachment-frame" />
        )}
        {(kind === "text" || kind === "sheet") && <TextPreview file={file} />}
        {!previewable(kind) && (
          <div className="attachment-placeholder">
            <Icon size={40} strokeWidth={1} />
            <h3>{fileTypeName(file)}</h3>
            <p>这个类型无法在线预览，下载后即可打开。</p>
          </div>
        )}
      </div>
      <div className="attachment-footer">
        <span>
          {fileTypeName(file)} · {fileSize(file.size)}
        </span>
        <a className="button primary" href={file.url} download={file.name}>
          下载附件
          <Download size={15} />
        </a>
      </div>
    </Modal>
  );
}

function AttachmentDetails({
  files,
  onClose,
}: {
  files: Attachment[];
  onClose: () => void;
}) {
  const [open, setOpen] = useState<Attachment | null>(null);
  return (
    <Modal title="附件详情" onClose={onClose} className="attachment-details-modal">
      <h2>共 {files.length} 个附件</h2>
      <div className="attachment-rows">
        {files.map((f) => {
          const Icon = icons[fileKind(f)];
          return (
            <div className="attachment-row" key={f.id || f.url}>
              <Icon size={18} />
              <span className="attachment-row-text">
                <strong>{f.name}</strong>
                <small>
                  {fileTypeName(f)} · {fileSize(f.size)}
                </small>
              </span>
              <LiquidButton
                type="button"
                className="icon-button"
                aria-label={`预览 ${f.name}`}
                title="预览"
                onClick={() => setOpen(f)}
              >
                <Eye size={16} />
              </LiquidButton>
              <a
                className="icon-button"
                href={f.url}
                download={f.name}
                aria-label={`下载 ${f.name}`}
                title="下载"
              >
                <Download size={16} />
              </a>
            </div>
          );
        })}
      </div>
      {open && <AttachmentViewer file={open} onClose={() => setOpen(null)} />}
    </Modal>
  );
}

export function AttachmentList({ files }: { files: Attachment[] }) {
  const [open, setOpen] = useState<Attachment | null>(null);
  const [details, setDetails] = useState(false);
  if (!files.length) return null;
  const shown = files.filter((f) => f.inline && isImage(f));
  const listed = files.filter((f) => !(f.inline && isImage(f)));
  return (
    <>
      {shown.length > 0 && (
        <div className="attachment-gallery">
          {shown.map((f) => (
            <LiquidButton
              type="button"
              key={f.id || f.url}
              className="attachment-inline"
              onClick={() => setOpen(f)}
              aria-label={`查看图片 ${f.name}`}
            >
              <img src={f.url} alt={f.name} loading="lazy" />
            </LiquidButton>
          ))}
        </div>
      )}
      {listed.length > 0 && (
        <div className="attachment-list">
          {listed.length > FOLD_AFTER ? (
            <LiquidButton
              type="button"
              className="attachment-chip attachment-folded"
              onClick={() => setDetails(true)}
            >
              <Paperclip size={15} />
              <span className="attachment-kind">附件</span>
              <span className="attachment-name">{listed.length} 个文件</span>
              <span className="attachment-size">查看详情</span>
            </LiquidButton>
          ) : (
            listed.map((f) => (
              <AttachmentButton
                key={f.id || f.url}
                file={f}
                onOpen={() => setOpen(f)}
              />
            ))
          )}
        </div>
      )}
      {details && (
        <AttachmentDetails files={listed} onClose={() => setDetails(false)} />
      )}
      {open && <AttachmentViewer file={open} onClose={() => setOpen(null)} />}
    </>
  );
}

function AttachmentManager({
  files,
  inline,
  onChange,
  onInline,
  onClose,
}: {
  files: Attachment[];
  inline: boolean;
  onChange: (files: Attachment[]) => void;
  onInline: (value: boolean) => void;
  onClose: () => void;
}) {
  const [open, setOpen] = useState<Attachment | null>(null);
  const [dragUrl, setDragUrl] = useState<string | null>(null);
  const filesRef = useRef(files);
  filesRef.current = files;
  const rows = useRef(new Map<string, HTMLDivElement>());
  const dragging = useRef<{ pointerId: number; url: string } | null>(null);
  const pending = useRef<{
    pointerId: number;
    url: string;
    x: number;
    y: number;
    timer: number;
  } | null>(null);

  const move = (index: number, step: number) => {
    const next = [...files];
    const target = index + step;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };

  const reorderTo = (url: string, clientY: number) => {
    const list = filesRef.current;
    const from = list.findIndex((f) => f.url === url);
    if (from === -1) return;
    let to = 0;
    list.forEach((f, i) => {
      const el = rows.current.get(f.url);
      if (!el) return;
      const rect = el.getBoundingClientRect();
      if (clientY > rect.top + rect.height / 2) to = i + 1;
    });
    to = Math.min(to, list.length - 1);
    if (to === from) return;
    const next = [...list];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    onChange(next);
  };

  const startDrag = (pointerId: number, url: string) => {
    dragging.current = { pointerId, url };
    setDragUrl(url);
  };
  const cancelPending = () => {
    if (pending.current) {
      window.clearTimeout(pending.current.timer);
      pending.current = null;
    }
  };
  const endDrag = (pointerId: number) => {
    if (pending.current?.pointerId === pointerId) cancelPending();
    if (dragging.current?.pointerId === pointerId) {
      dragging.current = null;
      setDragUrl(null);
    }
  };

  const onHandlePointerDown = (
    e: ReactPointerEvent<HTMLButtonElement>,
    url: string,
  ) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    if (e.pointerType === "touch" || e.pointerType === "pen") {
      pending.current = {
        pointerId: e.pointerId,
        url,
        x: e.clientX,
        y: e.clientY,
        timer: window.setTimeout(() => {
          pending.current = null;
          startDrag(e.pointerId, url);
        }, 200),
      };
    } else {
      startDrag(e.pointerId, url);
    }
  };
  const onHandlePointerMove = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (pending.current?.pointerId === e.pointerId) {
      const dx = Math.abs(e.clientX - pending.current.x);
      const dy = Math.abs(e.clientY - pending.current.y);
      if (dx > 8 || dy > 8) cancelPending();
      return;
    }
    if (dragging.current?.pointerId !== e.pointerId) return;
    reorderTo(dragging.current.url, e.clientY);
  };
  const onHandlePointerUp = (e: ReactPointerEvent<HTMLButtonElement>) => {
    endDrag(e.pointerId);
  };

  const hasImage = files.some(isImage);
  return (
    <Modal title="管理附件" onClose={onClose} className="attachment-details-modal">
      <h2>共 {files.length} 个附件</h2>
      <p className="modal-note">
        拖动手柄调整顺序（触屏长按后拖动），或移除文件、先看一眼内容。读者收到的就是这里的顺序。
      </p>
      <div className="attachment-rows">
        {files.map((f, i) => {
          const Icon = icons[fileKind(f)];
          return (
            <div
              className={`attachment-row ${dragUrl === f.url ? "dragging" : ""}`}
              key={f.url}
              ref={(el) => {
                if (el) rows.current.set(f.url, el);
                else rows.current.delete(f.url);
              }}
            >
              <LiquidButton
                type="button"
                className="icon-button attachment-drag-handle"
                aria-label={`拖动排序 ${f.name}`}
                title="按住拖动排序"
                onPointerDown={(e) => onHandlePointerDown(e, f.url)}
                onPointerMove={onHandlePointerMove}
                onPointerUp={onHandlePointerUp}
                onPointerCancel={onHandlePointerUp}
              >
                <GripVertical size={16} />
              </LiquidButton>
              <Icon size={18} />
              <span className="attachment-row-text">
                <strong>{f.name}</strong>
                <small>
                  {fileTypeName(f)} · {fileSize(f.size)}
                </small>
              </span>
              <LiquidButton
                type="button"
                className="icon-button"
                aria-label={`上移 ${f.name}`}
                title="上移"
                disabled={i === 0}
                onClick={() => move(i, -1)}
              >
                <ArrowUp size={15} />
              </LiquidButton>
              <LiquidButton
                type="button"
                className="icon-button"
                aria-label={`下移 ${f.name}`}
                title="下移"
                disabled={i === files.length - 1}
                onClick={() => move(i, 1)}
              >
                <ArrowDown size={15} />
              </LiquidButton>
              <LiquidButton
                type="button"
                className="icon-button"
                aria-label={`查看 ${f.name}`}
                title="查看详情"
                onClick={() => setOpen(f)}
              >
                <Eye size={16} />
              </LiquidButton>
              <LiquidButton
                type="button"
                className="icon-button danger-text"
                aria-label={`删除 ${f.name}`}
                title="删除"
                onClick={() => onChange(files.filter((x) => x.url !== f.url))}
              >
                <Trash2 size={16} />
              </LiquidButton>
            </div>
          );
        })}
      </div>
      <div className="attachment-manager-foot">
        {hasImage ? (
          <label className="inline-toggle">
            <input
              type="checkbox"
              checked={inline}
              onChange={(e) => onInline(e.target.checked)}
            />
            图片直接展示在内容中
          </label>
        ) : (
          <span className="muted">上传图片后，可以选择直接展示。</span>
        )}
        <LiquidButton type="button" className="button primary" onClick={onClose}>
          确认
        </LiquidButton>
      </div>
      {open && <AttachmentViewer file={open} onClose={() => setOpen(null)} />}
    </Modal>
  );
}

export function AttachmentPicker({
  files,
  onChange,
  onError,
  inline = false,
  onInline,
  compact = false,
  toolbarExtra,
  toolbarEnd,
}: {
  files: Attachment[];
  onChange: (files: Attachment[]) => void;
  onError?: (message: string) => void;
  inline?: boolean;
  onInline?: (value: boolean) => void;
  compact?: boolean;
  toolbarExtra?: ReactNode;
  toolbarEnd?: ReactNode;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(0);
  const session = useUploadSession();
  const [open, setOpen] = useState<Attachment | null>(null);
  const [managing, setManaging] = useState(false);
  const current = useRef(files);
  current.current = files;
  async function add(list: FileList | null) {
    const picked = Array.from(list || []);
    if (!picked.length) return;
    setBusy((n) => n + picked.length);
    const trackers = session.begin(picked);
    for (const [index, file] of picked.entries()) {
      try {
        const uploaded = await uploadFile(file, trackers[index].progress);
        onChange([...current.current, uploaded]);
      } catch (e) {
        onError?.(`${file.name}：${(e as Error).message}`);
      } finally {
        trackers[index].done();
        setBusy((n) => n - 1);
      }
    }
    if (input.current) input.current.value = "";
  }
  const folded = files.length > FOLD_AFTER;
  return (
    <div className={`attachment-picker ${compact ? "compact" : ""}`}>
      <div className="attachment-picker-row">
        <LiquidButton
          type="button"
          className="text-button"
          onClick={() => input.current?.click()}
          disabled={busy > 0}
          aria-label={busy > 0 ? `上传中 ${busy}` : "添加附件"}
        >
          {busy > 0 ? (
            <UploadProgress percent={session.percent} />
          ) : (
            <Paperclip size={16} />
          )}
          <span className="tool-label">{busy > 0 ? `上传中 ${busy}` : "添加附件"}</span>
        </LiquidButton>
        <input
          hidden
          multiple
          ref={input}
          type="file"
          onChange={(e) => add(e.target.files)}
        />
        {toolbarExtra}
        {toolbarEnd && <div className="attachment-picker-end">{toolbarEnd}</div>}
      </div>
      {files.length > 0 && (
        <div className="attachment-list">
          {folded ? (
            <LiquidButton
              type="button"
              className="attachment-chip attachment-folded"
              onClick={() => setManaging(true)}
            >
              <Paperclip size={15} />
              <span className="attachment-kind">附件</span>
              <span className="attachment-name">{files.length} 个文件</span>
              <span className="attachment-size">展开管理</span>
            </LiquidButton>
          ) : (
            <>
              {files.map((f) => (
                <AttachmentButton
                  key={f.url}
                  file={f}
                  onOpen={() => setOpen(f)}
                  onRemove={() =>
                    onChange(files.filter((x) => x.url !== f.url))
                  }
                />
              ))}
              <LiquidButton
                type="button"
                className="text-button attachment-manage"
                onClick={() => setManaging(true)}
              >
                管理
              </LiquidButton>
            </>
          )}
        </div>
      )}
      {managing && (
        <AttachmentManager
          files={files}
          inline={inline}
          onChange={onChange}
          onInline={(value) => onInline?.(value)}
          onClose={() => setManaging(false)}
        />
      )}
      {open && <AttachmentViewer file={open} onClose={() => setOpen(null)} />}
    </div>
  );
}
