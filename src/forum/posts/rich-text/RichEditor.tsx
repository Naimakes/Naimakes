import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { TextStyle, Color, FontSize } from "@tiptap/extension-text-style";
import TextAlign from "@tiptap/extension-text-align";
import Subscript from "@tiptap/extension-subscript";
import Superscript from "@tiptap/extension-superscript";
import Image from "@tiptap/extension-image";
import Highlight from "@tiptap/extension-highlight";
import { TableKit } from "@tiptap/extension-table";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { CharacterCount, Placeholder } from "@tiptap/extensions";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Baseline,
  Bold,
  ChevronDown,
  ClipboardPaste,
  Code,
  Copy,
  FileUp,
  Film,
  Heading1,
  Heading2,
  Heading3,
  Highlighter,
  ImagePlus,
  IndentDecrease,
  IndentIncrease,
  Italic,
  Link2,
  List,
  ListChecks,
  ListOrdered,
  Minus,
  MoreHorizontal,
  Pilcrow,
  Plus,
  Quote,
  Redo2,
  RemoveFormatting,
  Scissors,
  Smile,
  SquareCode,
  Strikethrough,
  Subscript as SubscriptIcon,
  Superscript as SuperscriptIcon,
  Table2,
  TextSelect,
  Trash2,
  Underline as UnderlineIcon,
  Undo2,
  Unlink,
  X,
} from "lucide-react";
import { LiquidButton } from "../../motion/LiquidButton";
import { useCompactScreen } from "../../motion/OverlayHost";
import { useMotionPreferences } from "../../motion/motion-preferences";
import { transitions } from "../../motion/motion-tokens";
import { uploadFile } from "../../api";
import { UploadProgress, useUploadSession } from "../../ui/UploadProgress";
import { FileBlock, ParagraphFormat, Video, indentBlocks, setBlockFormat } from "./rich-text-extensions";
import { safeHref, safeMediaSrc } from "./RichContent";

function markdownToHtml(markdown: string) {
  if (!markdown.trim()) return "";
  const host = document.createElement("div");
  const root = createRoot(host);
  flushSync(() => root.render(<ReactMarkdown remarkPlugins={[remarkGfm]}>{markdown}</ReactMarkdown>));
  const html = host.innerHTML;
  root.unmount();
  return html;
}

const isMac = /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent);
const mod = isMac ? "⌘" : "Ctrl+";
const sizes = [12, 13, 14, 15, 16, 18, 20, 22, 24, 28, 32, 36, 40, 48];
const colors = ["#1f1f1f", "#6b6b6b", "#c0392b", "#d35400", "#b07a12", "#2e7d32", "#00838f", "#1565c0", "#3949ab", "#6a1b9a", "#ad1457"];
const highlights = ["#fff3a0", "#ffe0b2", "#ffcdd2", "#fce4ec", "#d7f5dd", "#c8f1f4", "#d6e8ff", "#e6dcff", "#ececec"];
const lineHeights = [["1", "单倍"], ["1.15", "1.15 倍"], ["1.5", "1.5 倍"], ["1.75", "1.75 倍"], ["2", "双倍"], ["2.5", "2.5 倍"]];
const spacings = [["0", "无"], ["0.5em", "小"], ["1em", "中"], ["1.5em", "大"], ["2em", "特大"]];
const emoji = Array.from("😀😃😄😁😆😅😂🤣😊😇🙂😉😍🥰😘😎🤓🧐🤔🤨😐😮😲🥳😴😭😤😡👍👎👏🙌🙏💪👀🎉🔥✨💡📌✅❌⚡🚀🌍🌙⭐💯📚🧪🤖🎯🧭🛠️");

type MenuId = "style" | "size" | "color" | "highlight" | "align" | "link" | "more" | "emoji" | "video";

function Tool({ label, keys, active, disabled, onRun, children, className = "" }: {
  label: string;
  keys?: string;
  active?: boolean;
  disabled?: boolean;
  onRun: () => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <LiquidButton
      type="button"
      className={`rt-tool ${active ? "is-active" : ""} ${className}`}
      aria-label={label}
      title={keys ? `${label}（${keys}）` : label}
      aria-pressed={active === undefined ? undefined : active}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onRun}
    >
      {children}
    </LiquidButton>
  );
}

function Tile({ label, icon, active, disabled, onRun }: { label: string; icon: ReactNode; active?: boolean; disabled?: boolean; onRun: () => void }) {
  return (
    <LiquidButton
      type="button"
      className={`rt-tile ${active ? "is-active" : ""}`}
      aria-pressed={active === undefined ? undefined : active}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onRun}
    >
      {icon}
      <span>{label}</span>
    </LiquidButton>
  );
}

function useToolbarState(editor: Editor) {
  return useEditorState({
    editor,
    selector: ({ editor: e }) => {
      const block = e.isActive("heading", { level: 1 }) ? "h1" : e.isActive("heading", { level: 2 }) ? "h2" : e.isActive("heading", { level: 3 }) ? "h3" : "p";
      const blockAttrs = e.getAttributes(block === "p" ? "paragraph" : "heading");
      return {
        block,
        bold: e.isActive("bold"),
        italic: e.isActive("italic"),
        underline: e.isActive("underline"),
        strike: e.isActive("strike"),
        sup: e.isActive("superscript"),
        sub: e.isActive("subscript"),
        code: e.isActive("code"),
        bullet: e.isActive("bulletList"),
        ordered: e.isActive("orderedList"),
        task: e.isActive("taskList"),
        quote: e.isActive("blockquote"),
        codeBlock: e.isActive("codeBlock"),
        link: e.isActive("link"),
        href: (e.getAttributes("link").href as string) || "",
        table: e.isActive("table"),
        align: (["center", "right", "justify"].find((a) => e.isActive({ textAlign: a })) || "left") as string,
        fontSize: (e.getAttributes("textStyle").fontSize as string) || "",
        color: (e.getAttributes("textStyle").color as string) || "",
        highlight: (e.getAttributes("highlight").color as string) || (e.isActive("highlight") ? "#fff3a0" : ""),
        lineHeight: (blockAttrs.lineHeight as string) || "",
        spaceBefore: (blockAttrs.spaceBefore as string) || "",
        spaceAfter: (blockAttrs.spaceAfter as string) || "",
        canUndo: e.can().undo(),
        canRedo: e.can().redo(),
      };
    },
  });
}

export default function RichEditor({
  value,
  initialFormat = "html",
  onChange,
  placeholder = "写下你的想法…",
  label = "正文",
  onError,
}: {
  value: string;
  initialFormat?: "html" | "markdown";
  onChange: (html: string, empty: boolean) => void;
  placeholder?: string;
  label?: string;
  onError: (message: string) => void;
}) {
  const [uploading, setUploading] = useState(0);
  const session = useUploadSession();
  const handlers = useRef({ onChange, onError });
  handlers.current = { onChange, onError };
  const uploadInto = async (editor: Editor, files: File[], kind: "image" | "video" | "file", at?: number) => {
    setUploading((n) => n + files.length);
    const trackers = session.begin(files);
    for (const [index, file] of files.entries()) {
      try {
        const saved = await uploadFile(file, trackers[index].progress);
        const chain = editor.chain().focus(at ?? undefined);
        if (kind === "image") chain.setImage({ src: saved.url, alt: saved.name }).run();
        else if (kind === "video") chain.insertContent({ type: "video", attrs: { src: saved.url } }).run();
        else chain.insertContent({ type: "fileBlock", attrs: { href: saved.url, name: saved.name, size: saved.size } }).run();
      } catch (e) {
        handlers.current.onError((e as Error).message);
      } finally {
        trackers[index].done();
        setUploading((n) => n - 1);
      }
    }
  };
  const editorRef = useRef<Editor | null>(null);
  const kindOf = (file: File) => (file.type.startsWith("image/") ? "image" : file.type.startsWith("video/") ? "video" : "file");
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        link: { openOnClick: false, autolink: true, defaultProtocol: "https", protocols: ["https", "http", "mailto"], HTMLAttributes: { rel: "noopener noreferrer nofollow", target: "_blank" } },
      }),
      TextStyle,
      Color,
      FontSize,
      Highlight.configure({ multicolor: true }),
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      Subscript,
      Superscript,
      Image.configure({ allowBase64: false, inline: false }),
      TableKit.configure({ table: { resizable: false } }),
      TaskList,
      TaskItem.configure({ nested: true }),
      ParagraphFormat,
      Video,
      FileBlock,
      CharacterCount,
      Placeholder.configure({ placeholder }),
    ],
    content: initialFormat === "markdown" ? markdownToHtml(value) : value,
    onCreate: ({ editor: e }) => {
      if (initialFormat === "markdown") handlers.current.onChange(e.isEmpty ? "" : e.getHTML(), e.isEmpty);
    },
    editorProps: {
      attributes: { class: "rt-surface markdown post-content", "aria-label": label, "aria-multiline": "true", role: "textbox", spellcheck: "true" },
      handlePaste: (_view, event) => {
        const files = Array.from(event.clipboardData?.files || []);
        if (!files.length || !editorRef.current) return false;
        event.preventDefault();
        files.forEach((file) => uploadInto(editorRef.current!, [file], kindOf(file)));
        return true;
      },
      handleDrop: (view, event) => {
        const files = Array.from((event as DragEvent).dataTransfer?.files || []);
        if (!files.length || !editorRef.current) return false;
        event.preventDefault();
        const at = view.posAtCoords({ left: (event as DragEvent).clientX, top: (event as DragEvent).clientY })?.pos;
        files.forEach((file) => uploadInto(editorRef.current!, [file], kindOf(file), at));
        return true;
      },
    },
    onUpdate: ({ editor: e }) => handlers.current.onChange(e.isEmpty ? "" : e.getHTML(), e.isEmpty),
  });
  editorRef.current = editor;
  const [bodyHeight, setBodyHeight] = useState<number | null>(null);
  if (!editor) return null;
  return (
    <div
      className={`rt-shell ${uploading ? "is-uploading" : ""} ${bodyHeight ? "is-sized" : ""}`}
      style={bodyHeight ? ({ "--rt-body-h": `${bodyHeight}px` } as CSSProperties) : undefined}
    >
      <Toolbar editor={editor} upload={(files, kind) => uploadInto(editor, files, kind)} onError={onError} />
      <EditorContent editor={editor} className="rt-body" />
      <StatusBar editor={editor} uploading={uploading} percent={session.percent} />
      <BodyGrip onHeight={setBodyHeight} />
    </div>
  );
}

const MIN_BODY = 140;
const MAX_BODY = 2400;

function BodyGrip({ onHeight }: { onHeight: (height: number | null) => void }) {
  const body = (grip: HTMLElement) => grip.closest(".rt-shell")!.querySelector<HTMLElement>(".rt-body")!;
  const clamp = (n: number) => Math.round(Math.min(MAX_BODY, Math.max(MIN_BODY, n)));
  const start = (event: ReactPointerEvent<HTMLSpanElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const grip = event.currentTarget;
    const from = event.clientY, base = body(grip).offsetHeight;
    grip.setPointerCapture(event.pointerId);
    const move = (e: PointerEvent) => onHeight(clamp(base + e.clientY - from));
    const end = () => {
      grip.removeEventListener("pointermove", move);
      grip.removeEventListener("pointerup", end);
      grip.removeEventListener("pointercancel", end);
    };
    grip.addEventListener("pointermove", move);
    grip.addEventListener("pointerup", end);
    grip.addEventListener("pointercancel", end);
  };
  const nudge = (event: ReactKeyboardEvent<HTMLSpanElement>) => {
    const step = event.key === "ArrowDown" ? 32 : event.key === "ArrowUp" ? -32 : 0;
    if (!step) return;
    event.preventDefault();
    onHeight(clamp(body(event.currentTarget).offsetHeight + step));
  };
  return (
    <span
      className="rt-grip"
      role="separator"
      aria-orientation="horizontal"
      aria-label="拖动调整编辑区高度"
      tabIndex={0}
      onPointerDown={start}
      onDoubleClick={() => onHeight(null)}
      onKeyDown={nudge}
    />
  );
}

function StatusBar({ editor, uploading, percent }: { editor: Editor; uploading: number; percent: number }) {
  const count = useEditorState({ editor, selector: ({ editor: e }) => e.storage.characterCount?.characters?.() ?? 0 });
  return (
    <div className="rt-status" aria-live="polite">
      {uploading > 0 && <span><UploadProgress percent={percent} size={13} /> 正在上传 {uploading} 个文件…</span>}
      <span>{count} 字</span>
    </div>
  );
}

function Toolbar({ editor, upload, onError }: { editor: Editor; upload: (files: File[], kind: "image" | "video" | "file") => void; onError: (message: string) => void }) {
  const s = useToolbarState(editor);
  const compact = useCompactScreen();
  const { reduced } = useMotionPreferences();
  const [menu, setMenu] = useState<MenuId | null>(null);
  const [anchor, setAnchor] = useState(0);
  const [link, setLink] = useState("");
  const [videoUrl, setVideoUrl] = useState("");
  const wrap = useRef<HTMLDivElement>(null), panel = useRef<HTMLDivElement>(null);
  const imageInput = useRef<HTMLInputElement>(null), videoInput = useRef<HTMLInputElement>(null), fileInput = useRef<HTMLInputElement>(null);
  const chain = () => editor.chain().focus();
  const toggle = (id: MenuId) => (event: React.MouseEvent<HTMLElement>) => {
    const box = wrap.current?.getBoundingClientRect();
    setAnchor(box ? event.currentTarget.getBoundingClientRect().left - box.left : 0);
    if (id === "link") setLink(s.href);
    setMenu((open) => (open === id ? null : id));
  };
  useLayoutEffect(() => {
    const el = panel.current, box = wrap.current;
    if (!el || !box || compact) return;
    const max = box.clientWidth - el.offsetWidth - 4;
    el.style.left = Math.max(4, Math.min(anchor, max)) + "px";
  }, [menu, anchor, compact]);
  useEffect(() => {
    const dom = wrap.current?.parentElement;
    if (!dom) return;
    const key = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        e.stopPropagation();
        setLink((editor.getAttributes("link").href as string) || "");
        setAnchor(0);
        setMenu("link");
      }
    };
    dom.addEventListener("keydown", key);
    return () => dom.removeEventListener("keydown", key);
  }, [editor]);
  useEffect(() => {
    if (!menu) return;
    const away = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setMenu(null);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setMenu(null);
        editor.commands.focus();
      }
    };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", key, true);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", key, true);
    };
  }, [menu, editor]);
  const run = (fn: () => void) => () => {
    fn();
    setMenu(null);
  };
  const size = parseFloat(s.fontSize) || (s.block === "h1" ? 28 : s.block === "h2" ? 23 : s.block === "h3" ? 19 : 16);
  const stepSize = (direction: 1 | -1) => {
    const next = direction > 0 ? sizes.find((n) => n > size) : [...sizes].reverse().find((n) => n < size);
    if (next) chain().setFontSize(next + "px").run();
  };
  const applyLink = () => {
    const raw = link.trim();
    if (!raw) return run(() => chain().extendMarkRange("link").unsetLink().run())();
    const href = safeHref(/^[a-z][a-z0-9+.-]*:|^\/|^#/i.test(raw) ? raw : "https://" + raw);
    if (!href) return onError("链接只能是网页地址、邮箱或站内路径。");
    if (editor.state.selection.empty && !s.link) chain().insertContent({ type: "text", text: raw, marks: [{ type: "link", attrs: { href } }] }).run();
    else chain().extendMarkRange("link").setLink({ href }).run();
    setMenu(null);
  };
  const insertVideoUrl = () => {
    const src = safeMediaSrc(videoUrl.trim());
    if (!src) return onError("视频地址需要以 https:// 开头，或先上传视频文件。");
    chain().insertContent({ type: "video", attrs: { src } }).run();
    setVideoUrl("");
    setMenu(null);
  };
  const clipboard = async (action: "copy" | "cut" | "paste") => {
    editor.commands.focus();
    if (action !== "paste") {
      if (editor.state.selection.empty) return onError(`请先选中要${action === "copy" ? "复制" : "剪切"}的内容。`);
      if (!document.execCommand(action)) onError(`浏览器没有允许${action === "copy" ? "复制" : "剪切"}，请使用 ${mod}${action === "copy" ? "C" : "X"}。`);
      return;
    }
    try {
      const items = await navigator.clipboard.read();
      const rich = items.find((item) => item.types.includes("text/html"));
      if (rich) {
        const html = await (await rich.getType("text/html")).text();
        (editor.view as unknown as { pasteHTML: (html: string) => void }).pasteHTML(html);
        return;
      }
      const text = await navigator.clipboard.readText();
      (editor.view as unknown as { pasteText: (text: string) => void }).pasteText(text);
    } catch {
      onError(`浏览器没有允许读取剪贴板，请使用 ${mod}V 粘贴。`);
    }
  };
  const clearFormatting = () => {
    chain().unsetAllMarks().clearNodes().unsetTextAlign().run();
    setBlockFormat(editor, "lineHeight", null);
    setBlockFormat(editor, "spaceBefore", null);
    setBlockFormat(editor, "spaceAfter", null);
    editor.chain().focus().updateAttributes("paragraph", { indent: 0 }).run();
  };
  const blockLabel = { p: "正文", h1: "标题 1", h2: "标题 2", h3: "标题 3" }[s.block];
  const AlignIcon = { left: AlignLeft, center: AlignCenter, right: AlignRight, justify: AlignJustify }[s.align] || AlignLeft;
  const pick = (input: React.RefObject<HTMLInputElement | null>) => () => {
    setMenu(null);
    input.current?.click();
  };
  const tableTools = s.table && (
    <div className="rt-context" role="group" aria-label="表格工具">
      <span>表格</span>
      <Tool label="上方插入行" onRun={() => chain().addRowBefore().run()}>行 ↑</Tool>
      <Tool label="下方插入行" onRun={() => chain().addRowAfter().run()}>行 ↓</Tool>
      <Tool label="左侧插入列" onRun={() => chain().addColumnBefore().run()}>列 ←</Tool>
      <Tool label="右侧插入列" onRun={() => chain().addColumnAfter().run()}>列 →</Tool>
      <Tool label="删除行" onRun={() => chain().deleteRow().run()}>删行</Tool>
      <Tool label="删除列" onRun={() => chain().deleteColumn().run()}>删列</Tool>
      <Tool label="切换表头" onRun={() => chain().toggleHeaderRow().run()}>表头</Tool>
      <Tool label="删除表格" onRun={() => chain().deleteTable().run()}><Trash2 size={15} /></Tool>
    </div>
  );
  return (
    <div className={`rt-toolbar-wrap ${menu ? "has-menu" : ""}`} ref={wrap}>
      <div className="rt-toolbar" role="toolbar" aria-label="格式工具栏">
        <div className="rt-toolbar-scroll">
        <div className="rt-group">
          <Tool label="撤销" keys={mod + "Z"} disabled={!s.canUndo} onRun={() => chain().undo().run()}><Undo2 size={16} /></Tool>
          <Tool label="重做" keys={isMac ? "⇧⌘Z" : "Ctrl+Y"} disabled={!s.canRedo} onRun={() => chain().redo().run()}><Redo2 size={16} /></Tool>
        </div>
        <div className="rt-group">
          <LiquidButton type="button" className={`rt-tool rt-select ${menu === "style" ? "is-open" : ""}`} aria-haspopup="menu" aria-expanded={menu === "style"} title="段落样式" onMouseDown={(e) => e.preventDefault()} onClick={toggle("style")}>
            <span>{blockLabel}</span>
            <ChevronDown size={13} />
          </LiquidButton>
        </div>
        <div className="rt-group rt-size" role="group" aria-label="字号">
          <Tool label="缩小字号" disabled={size <= sizes[0]} onRun={() => stepSize(-1)}><Minus size={14} /></Tool>
          <LiquidButton type="button" className={`rt-tool rt-size-value ${menu === "size" ? "is-open" : ""}`} aria-haspopup="menu" aria-expanded={menu === "size"} title="选择字号" onMouseDown={(e) => e.preventDefault()} onClick={toggle("size")}>
            {Math.round(size)}
          </LiquidButton>
          <Tool label="放大字号" disabled={size >= sizes[sizes.length - 1]} onRun={() => stepSize(1)}><Plus size={14} /></Tool>
        </div>
        <div className="rt-group">
          <Tool label="粗体" keys={mod + "B"} active={s.bold} onRun={() => chain().toggleBold().run()}><Bold size={16} /></Tool>
          <Tool label="斜体" keys={mod + "I"} active={s.italic} onRun={() => chain().toggleItalic().run()}><Italic size={16} /></Tool>
          <Tool label="下划线" keys={mod + "U"} active={s.underline} onRun={() => chain().toggleUnderline().run()}><UnderlineIcon size={16} /></Tool>
          <Tool label="删除线" keys={isMac ? "⇧⌘S" : "Ctrl+Shift+S"} active={s.strike} onRun={() => chain().toggleStrike().run()}><Strikethrough size={16} /></Tool>
        </div>
        <div className="rt-group">
          <LiquidButton type="button" className={`rt-tool ${menu === "color" ? "is-open" : ""}`} aria-label="字体颜色" title="字体颜色" aria-haspopup="menu" aria-expanded={menu === "color"} onMouseDown={(e) => e.preventDefault()} onClick={toggle("color")}>
            <Baseline size={16} />
            <i className="rt-swatch-bar" style={{ background: s.color || "currentColor" }} />
          </LiquidButton>
          <LiquidButton type="button" className={`rt-tool ${menu === "highlight" ? "is-open" : ""}`} aria-label="文字背景色" title="文字背景色 / 高亮" aria-haspopup="menu" aria-expanded={menu === "highlight"} onMouseDown={(e) => e.preventDefault()} onClick={toggle("highlight")}>
            <Highlighter size={16} />
            <i className="rt-swatch-bar" style={{ background: s.highlight || "transparent" }} />
          </LiquidButton>
        </div>
        <div className="rt-group">
          <LiquidButton type="button" className={`rt-tool rt-wide ${menu === "align" ? "is-open" : ""}`} aria-label="对齐方式" title="对齐方式" aria-haspopup="menu" aria-expanded={menu === "align"} onMouseDown={(e) => e.preventDefault()} onClick={toggle("align")}>
            <AlignIcon size={16} />
            <ChevronDown size={12} />
          </LiquidButton>
          <Tool label="无序列表" keys={isMac ? "⇧⌘8" : "Ctrl+Shift+8"} active={s.bullet} onRun={() => chain().toggleBulletList().run()}><List size={16} /></Tool>
          <Tool label="有序列表" keys={isMac ? "⇧⌘7" : "Ctrl+Shift+7"} active={s.ordered} onRun={() => chain().toggleOrderedList().run()}><ListOrdered size={16} /></Tool>
          <Tool label="待办列表" keys={isMac ? "⇧⌘9" : "Ctrl+Shift+9"} active={s.task} onRun={() => chain().toggleTaskList().run()}><ListChecks size={16} /></Tool>
        </div>
        <div className="rt-group">
          <LiquidButton type="button" className={`rt-tool ${s.link ? "is-active" : ""} ${menu === "link" ? "is-open" : ""}`} aria-label="超链接" title={`超链接（${mod}K）`} aria-haspopup="dialog" aria-expanded={menu === "link"} onMouseDown={(e) => e.preventDefault()} onClick={toggle("link")}>
            <Link2 size={16} />
          </LiquidButton>
          <Tool label="插入图片" onRun={pick(imageInput)}><ImagePlus size={16} /></Tool>
        </div>
        </div>
        <div className="rt-group rt-group-more">
          <LiquidButton type="button" className={`rt-tool rt-more ${menu === "more" ? "is-open" : ""}`} aria-haspopup="menu" aria-expanded={menu === "more"} title="更多格式与插入" onMouseDown={(e) => e.preventDefault()} onClick={toggle("more")}>
            <MoreHorizontal size={16} />
            <span>更多</span>
          </LiquidButton>
        </div>
      </div>
      {tableTools}
      <AnimatePresence initial={false}>
      {menu && (
        <motion.div
          key={menu}
          className={`rt-panel rt-panel-${menu}`}
          ref={panel}
          role={menu === "link" || menu === "video" ? "dialog" : "menu"}
          aria-label="格式选项"
          initial={reduced ? { opacity: 0 } : { opacity: 0, y: -10, scale: 0.94, filter: "blur(6px)" }}
          animate={reduced ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
          exit={reduced ? { opacity: 0 } : { opacity: 0, y: -8, scale: 0.96, filter: "blur(4px)" }}
          transition={reduced ? { duration: 0 } : transitions.responsive}
        >
          {compact && (
            <div className="rt-panel-head">
              <strong>{{ style: "段落样式", size: "字号", color: "字体颜色", highlight: "背景色", align: "对齐", link: "超链接", more: "更多", emoji: "表情", video: "插入视频" }[menu]}</strong>
              <LiquidButton type="button" className="icon-button" aria-label="收起" onMouseDown={(e) => e.preventDefault()} onClick={() => setMenu(null)}><X size={15} /></LiquidButton>
            </div>
          )}
          {menu === "style" && (
            <div className="rt-list">
              {[
                ["p", "正文", <Pilcrow size={16} key="p" />, () => chain().setParagraph().run()],
                ["h1", "标题 1", <Heading1 size={16} key="h1" />, () => chain().toggleHeading({ level: 1 }).run()],
                ["h2", "标题 2", <Heading2 size={16} key="h2" />, () => chain().toggleHeading({ level: 2 }).run()],
                ["h3", "标题 3", <Heading3 size={16} key="h3" />, () => chain().toggleHeading({ level: 3 }).run()],
              ].map(([id, text, icon, fn]) => (
                <Tile key={id as string} label={text as string} icon={icon as ReactNode} active={s.block === id} onRun={run(fn as () => void)} />
              ))}
            </div>
          )}
          {menu === "size" && (
            <div className="rt-grid rt-grid-sizes">
              <Tile label="默认" icon={<span className="rt-size-sample">Aa</span>} active={!s.fontSize} onRun={run(() => chain().unsetFontSize().run())} />
              {sizes.map((n) => (
                <Tile key={n} label={n + " px"} icon={<span className="rt-size-sample" style={{ fontSize: Math.min(22, Math.max(11, n * 0.7)) }}>A</span>} active={Math.round(parseFloat(s.fontSize)) === n} onRun={run(() => chain().setFontSize(n + "px").run())} />
              ))}
            </div>
          )}
          {menu === "color" && (
            <div className="rt-swatches" role="group" aria-label="字体颜色">
              <LiquidButton type="button" className={`rt-swatch is-default ${!s.color ? "is-active" : ""}`} aria-label="默认颜色" onMouseDown={(e) => e.preventDefault()} onClick={run(() => chain().unsetColor().run())}>A</LiquidButton>
              {colors.map((c) => (
                <LiquidButton key={c} type="button" className={`rt-swatch ${s.color === c ? "is-active" : ""}`} aria-label={"颜色 " + c} style={{ color: c }} onMouseDown={(e) => e.preventDefault()} onClick={run(() => chain().setColor(c).run())}>
                  <i style={{ background: c }} />
                </LiquidButton>
              ))}
            </div>
          )}
          {menu === "highlight" && (
            <div className="rt-swatches is-five" role="group" aria-label="文字背景色">
              <LiquidButton type="button" className={`rt-swatch is-default ${!s.highlight ? "is-active" : ""}`} aria-label="无背景色" onMouseDown={(e) => e.preventDefault()} onClick={run(() => chain().unsetHighlight().run())}><X size={14} /></LiquidButton>
              {highlights.map((c) => (
                <LiquidButton key={c} type="button" className={`rt-swatch ${s.highlight === c ? "is-active" : ""}`} aria-label={"背景色 " + c} onMouseDown={(e) => e.preventDefault()} onClick={run(() => chain().setHighlight({ color: c }).run())}>
                  <i style={{ background: c }} />
                </LiquidButton>
              ))}
            </div>
          )}
          {menu === "align" && (
            <div className="rt-list">
              {[
                ["left", "左对齐", AlignLeft, isMac ? "⇧⌘L" : "Ctrl+Shift+L"],
                ["center", "居中", AlignCenter, isMac ? "⇧⌘E" : "Ctrl+Shift+E"],
                ["right", "右对齐", AlignRight, isMac ? "⇧⌘R" : "Ctrl+Shift+R"],
                ["justify", "两端对齐", AlignJustify, isMac ? "⇧⌘J" : "Ctrl+Shift+J"],
              ].map(([id, text, Icon, keys]: any) => (
                <Tile key={id} label={text + "  " + keys} icon={<Icon size={16} />} active={s.align === id} onRun={run(() => chain().setTextAlign(id).run())} />
              ))}
            </div>
          )}
          {menu === "link" && (
            <form className="rt-form" onSubmit={(e) => { e.preventDefault(); applyLink(); }}>
              <label>
                链接地址
                <input autoFocus value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://" inputMode="url" maxLength={2000} />
              </label>
              <div className="rt-form-actions">
                {s.link && (
                  <LiquidButton type="button" className="button secondary compact" onClick={run(() => chain().extendMarkRange("link").unsetLink().run())}>
                    <Unlink size={14} />
                    移除链接
                  </LiquidButton>
                )}
                <LiquidButton type="submit" className="button primary compact">
                  <Link2 size={14} />
                  {s.link ? "更新链接" : "插入链接"}
                </LiquidButton>
              </div>
            </form>
          )}
          {menu === "video" && (
            <form className="rt-form" onSubmit={(e) => { e.preventDefault(); insertVideoUrl(); }}>
              <label>
                视频地址
                <input autoFocus value={videoUrl} onChange={(e) => setVideoUrl(e.target.value)} placeholder="https://…/video.mp4" inputMode="url" maxLength={2000} />
              </label>
              <div className="rt-form-actions">
                <LiquidButton type="button" className="button secondary compact" onClick={pick(videoInput)}>
                  <FileUp size={14} />
                  上传视频文件
                </LiquidButton>
                <LiquidButton type="submit" className="button primary compact">
                  <Film size={14} />
                  插入视频
                </LiquidButton>
              </div>
            </form>
          )}
          {menu === "emoji" && (
            <div className="rt-emoji" role="group" aria-label="表情">
              {emoji.map((e, i) => (
                <LiquidButton key={i} type="button" className="rt-emoji-item" aria-label={"插入 " + e} onMouseDown={(ev) => ev.preventDefault()} onClick={() => chain().insertContent(e).run()}>
                  {e}
                </LiquidButton>
              ))}
            </div>
          )}
          {menu === "more" && (
            <div className="rt-more-panel">
              <section>
                <h4>文字</h4>
                <div className="rt-grid">
                  <Tile label="上标" icon={<SuperscriptIcon size={16} />} active={s.sup} onRun={run(() => chain().toggleSuperscript().run())} />
                  <Tile label="下标" icon={<SubscriptIcon size={16} />} active={s.sub} onRun={run(() => chain().toggleSubscript().run())} />
                  <Tile label="行内代码" icon={<Code size={16} />} active={s.code} onRun={run(() => chain().toggleCode().run())} />
                  <Tile label="清除格式" icon={<RemoveFormatting size={16} />} onRun={run(clearFormatting)} />
                </div>
              </section>
              <section>
                <h4>段落</h4>
                <div className="rt-grid">
                  <Tile label="增加缩进" icon={<IndentIncrease size={16} />} onRun={run(() => indentBlocks(editor, 1))} />
                  <Tile label="减少缩进" icon={<IndentDecrease size={16} />} onRun={run(() => indentBlocks(editor, -1))} />
                  <Tile label="引用" icon={<Quote size={16} />} active={s.quote} onRun={run(() => chain().toggleBlockquote().run())} />
                  <Tile label="代码块" icon={<SquareCode size={16} />} active={s.codeBlock} onRun={run(() => chain().toggleCodeBlock().run())} />
                </div>
                <div className="rt-option-row" role="group" aria-label="行距">
                  <span>行距</span>
                  <div className="rt-option-chips is-six">
                    {lineHeights.map(([v, text]) => (
                      <LiquidButton key={v} type="button" className={`rt-chip ${s.lineHeight === v ? "is-active" : ""}`} onMouseDown={(e) => e.preventDefault()} onClick={() => setBlockFormat(editor, "lineHeight", s.lineHeight === v ? null : v)}>{text}</LiquidButton>
                    ))}
                  </div>
                </div>
                <div className="rt-option-row" role="group" aria-label="段前间距">
                  <span>段前</span>
                  <div className="rt-option-chips is-five">
                    {spacings.map(([v, text]) => (
                      <LiquidButton key={v} type="button" className={`rt-chip ${s.spaceBefore === v ? "is-active" : ""}`} onMouseDown={(e) => e.preventDefault()} onClick={() => setBlockFormat(editor, "spaceBefore", s.spaceBefore === v ? null : v)}>{text}</LiquidButton>
                    ))}
                  </div>
                </div>
                <div className="rt-option-row" role="group" aria-label="段后间距">
                  <span>段后</span>
                  <div className="rt-option-chips is-five">
                    {spacings.map(([v, text]) => (
                      <LiquidButton key={v} type="button" className={`rt-chip ${s.spaceAfter === v ? "is-active" : ""}`} onMouseDown={(e) => e.preventDefault()} onClick={() => setBlockFormat(editor, "spaceAfter", s.spaceAfter === v ? null : v)}>{text}</LiquidButton>
                    ))}
                  </div>
                </div>
              </section>
              <section>
                <h4>插入</h4>
                <div className="rt-grid">
                  <Tile label="图片" icon={<ImagePlus size={16} />} onRun={pick(imageInput)} />
                  <Tile label="视频" icon={<Film size={16} />} onRun={() => setMenu("video")} />
                  <Tile label="文件" icon={<FileUp size={16} />} onRun={pick(fileInput)} />
                  <Tile label="链接" icon={<Link2 size={16} />} onRun={() => { setLink(s.href); setMenu("link"); }} />
                  <Tile label="表格" icon={<Table2 size={16} />} onRun={run(() => chain().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run())} />
                  <Tile label="分割线" icon={<Minus size={16} />} onRun={run(() => chain().setHorizontalRule().run())} />
                  <Tile label="待办列表" icon={<ListChecks size={16} />} active={s.task} onRun={run(() => chain().toggleTaskList().run())} />
                  <Tile label="表情" icon={<Smile size={16} />} onRun={() => setMenu("emoji")} />
                </div>
              </section>
              <section>
                <h4>编辑</h4>
                <div className="rt-grid">
                  <Tile label="复制" icon={<Copy size={16} />} onRun={run(() => clipboard("copy"))} />
                  <Tile label="剪切" icon={<Scissors size={16} />} onRun={run(() => clipboard("cut"))} />
                  <Tile label="粘贴" icon={<ClipboardPaste size={16} />} onRun={run(() => clipboard("paste"))} />
                  <Tile label="全选" icon={<TextSelect size={16} />} onRun={run(() => chain().selectAll().run())} />
                </div>
              </section>
            </div>
          )}
        </motion.div>
      )}
      </AnimatePresence>
      <input ref={imageInput} type="file" accept="image/*" multiple hidden onChange={(e) => { const files = Array.from(e.target.files || []); e.target.value = ""; if (files.length) upload(files, "image"); }} />
      <input ref={videoInput} type="file" accept="video/*" hidden onChange={(e) => { const files = Array.from(e.target.files || []); e.target.value = ""; if (files.length) upload(files, "video"); }} />
      <input ref={fileInput} type="file" multiple hidden onChange={(e) => { const files = Array.from(e.target.files || []); e.target.value = ""; if (files.length) upload(files, "file"); }} />
    </div>
  );
}
