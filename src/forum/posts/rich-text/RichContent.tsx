import { createElement, Fragment, useMemo, type CSSProperties, type ReactNode } from "react";
import { Download, ExternalLink, FileText } from "lucide-react";
import { ZoomImage } from "../../motion/ZoomImage";
import "./rich-text.css";

const tags: Record<string, string> = {
  p: "p", br: "br", h1: "h1", h2: "h2", h3: "h3", h4: "h4", h5: "h4", h6: "h4",
  strong: "strong", b: "strong", em: "em", i: "em", u: "u", s: "s", del: "s", strike: "s",
  sub: "sub", sup: "sup", span: "span", mark: "mark", code: "code", pre: "pre",
  blockquote: "blockquote", hr: "hr", ul: "ul", ol: "ol", li: "li", a: "a",
  table: "table", thead: "thead", tbody: "tbody", tfoot: "tbody", tr: "tr", th: "th", td: "td",
  div: "div", label: "span", figure: "figure", figcaption: "figcaption",
};
const voids = new Set(["br", "hr"]);

const colorValue = /^(#[0-9a-f]{3,8}|rgba?\(\s*[\d.]+%?\s*,\s*[\d.]+%?\s*,\s*[\d.]+%?\s*(,\s*[\d.]+%?\s*)?\)|[a-z]{3,20})$/i;
const lengthValue = (max: number, units: string[]) => (value: string) => {
  const match = value.match(/^(\d{1,3}(?:\.\d{1,3})?)(px|em|rem|%)$/);
  if (!match || !units.includes(match[2])) return false;
  const n = parseFloat(match[1]);
  const inPx = match[2] === "px" ? n : match[2] === "%" ? (n / 100) * 16 : n * 16;
  return inPx <= max;
};
const styleRules: Record<string, (value: string) => boolean> = {
  color: (v) => colorValue.test(v) || v === "inherit",
  "background-color": (v) => colorValue.test(v) || v === "transparent",
  "font-size": (v) => lengthValue(96, ["px", "em", "rem", "%"])(v) && parseFloat(v) > 0,
  "line-height": (v) => /^(normal|[0-3](\.\d{1,2})?|4)$/.test(v),
  "text-align": (v) => ["left", "center", "right", "justify", "start", "end"].includes(v),
  "margin-top": lengthValue(64, ["px", "em", "rem"]),
  "margin-bottom": lengthValue(64, ["px", "em", "rem"]),
  "margin-left": lengthValue(256, ["px", "em", "rem"]),
  "padding-left": lengthValue(256, ["px", "em", "rem"]),
};
const camel = (name: string) => name.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
function cleanStyle(raw: string | null): CSSProperties | undefined {
  if (!raw) return undefined;
  const style: Record<string, string> = {};
  for (const part of raw.split(";")) {
    const at = part.indexOf(":");
    if (at < 0) continue;
    const name = part.slice(0, at).trim().toLowerCase();
    const value = part.slice(at + 1).trim().toLowerCase().replace(/\s*!important$/, "");
    if (styleRules[name]?.(value)) style[camel(name)] = value;
  }
  return Object.keys(style).length ? (style as CSSProperties) : undefined;
}
export function safeHref(value: string | null) {
  const v = (value || "").trim();
  if (/^(https?:\/\/|mailto:)/i.test(v)) return v;
  if (/^\/(?!\/)/.test(v) || v.startsWith("#")) return v;
  return "";
}
export function safeMediaSrc(value: string | null) {
  const v = (value || "").trim();
  if (/^https:\/\//i.test(v) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//i.test(v)) return v;
  if (/^\/(uploads|assets)\//.test(v)) return v;
  return "";
}
const span = (value: string | null, max: number) => {
  const n = parseInt(value || "", 10);
  return Number.isFinite(n) && n > 1 ? Math.min(n, max) : undefined;
};
const size = (bytes: number) =>
  bytes > 1048576 ? (bytes / 1048576).toFixed(1) + " MB" : bytes > 1024 ? Math.round(bytes / 1024) + " KB" : bytes + " B";

function build(node: Node, key: string): ReactNode {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent;
  if (node.nodeType !== Node.ELEMENT_NODE) return null;
  const el = node as Element;
  const name = el.tagName.toLowerCase();
  const structural = /^(table|thead|tbody|tfoot|tr|ul|ol|colgroup)$/.test(name);
  const kids = () =>
    Array.from(el.childNodes)
      .filter((child) => !(structural && child.nodeType === Node.TEXT_NODE && !child.textContent?.trim()))
      .map((child, i) => build(child, key + "." + i));
  const style = cleanStyle(el.getAttribute("style"));
  if (name === "img") {
    const src = safeMediaSrc(el.getAttribute("src"));
    return src ? <ZoomImage key={key} src={src} alt={el.getAttribute("alt") || "讨论图片"} title={el.getAttribute("title") || undefined} /> : null;
  }
  if (name === "video") {
    const src = safeMediaSrc(el.getAttribute("src") || el.querySelector("source")?.getAttribute("src") || "");
    return src ? <video key={key} className="rt-video" src={src} controls preload="metadata" playsInline /> : null;
  }
  if (name === "input") {
    if (el.getAttribute("type") !== "checkbox") return null;
    return <input key={key} type="checkbox" checked={el.hasAttribute("checked")} disabled readOnly aria-label="待办事项" />;
  }
  if (name === "div" && el.getAttribute("data-type") === "file") {
    const href = safeMediaSrc(el.getAttribute("data-href"));
    const label = el.getAttribute("data-name") || "附件";
    const bytes = parseInt(el.getAttribute("data-size") || "0", 10) || 0;
    if (!href) return null;
    return (
      <a key={key} className="rt-file" href={href} download={label} target="_blank" rel="noreferrer noopener">
        <span className="rt-file-icon"><FileText size={18} /></span>
        <span className="rt-file-copy"><strong>{label}</strong>{bytes > 0 && <small>{size(bytes)}</small>}</span>
        <Download size={16} />
      </a>
    );
  }
  if (name === "a") {
    const href = safeHref(el.getAttribute("href"));
    if (!href) return <Fragment key={key}>{kids()}</Fragment>;
    const external = !href.startsWith("/") && !href.startsWith("#");
    return (
      <a key={key} href={href} style={style} target={external ? "_blank" : undefined} rel={external ? "noreferrer noopener" : undefined}>
        {kids()}
        {external && <ExternalLink size={12} />}
      </a>
    );
  }
  const tag = tags[name];
  if (!tag) return name === "script" || name === "style" || name === "template" ? null : <Fragment key={key}>{kids()}</Fragment>;
  const props: Record<string, unknown> = { key, style };
  const type = el.getAttribute("data-type");
  if (tag === "ul" && type === "taskList") props.className = "rt-task-list";
  if (tag === "li" && type === "taskItem") {
    props.className = "rt-task";
    props["data-checked"] = el.getAttribute("data-checked") === "true" ? "true" : "false";
  }
  if (tag === "mark") props.className = "rt-mark";
  if (tag === "ol") {
    const start = parseInt(el.getAttribute("start") || "", 10);
    if (Number.isFinite(start) && start > 1 && start < 100000) props.start = start;
  }
  if (tag === "th" || tag === "td") {
    props.colSpan = span(el.getAttribute("colspan"), 20);
    props.rowSpan = span(el.getAttribute("rowspan"), 50);
  }
  if (tag === "table")
    return (
      <div key={key} className="rt-table-wrap">
        <table>{kids()}</table>
      </div>
    );
  if (voids.has(tag)) return createElement(tag, props);
  return createElement(tag, props, ...kids());
}

export function RichContent({ html, className = "" }: { html: string; className?: string }) {
  const tree = useMemo(() => {
    const doc = new DOMParser().parseFromString(html || "", "text/html");
    return Array.from(doc.body.childNodes).map((node, i) => build(node, String(i)));
  }, [html]);
  return <div className={`markdown post-content rich-content ${className}`}>{tree}</div>;
}
