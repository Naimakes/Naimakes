import { ZoomImage } from "../motion/ZoomImage";
import { type ReactNode } from "react";

const IMAGE = /!\[([^\]]*)\]\((\S+?)\)/g;

const safeUrl = (url: string) => /^(https?:\/\/|\/(?!\/))/i.test(url);

export function stripImages(text: string) {
  return text
    .replace(IMAGE, (match, alt, url) =>
      safeUrl(url) ? `［${alt || "图片"}］` : match,
    )
    .trim();
}

export function RichText({ text }: { text: string }) {
  if (!text) return null;
  const parts: ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(IMAGE)) {
    if (!safeUrl(match[2])) continue;
    const at = match.index ?? 0;
    const before = text.slice(last, at);
    if (before.trim()) parts.push(<p key={"t" + at}>{before.trim()}</p>);
    parts.push(
      <ZoomImage key={"i" + at} src={match[2]} alt={match[1] || "图片"} loading="lazy" />,
    );
    last = at + match[0].length;
  }
  const rest = text.slice(last);
  if (rest.trim()) parts.push(<p key="tail">{rest.trim()}</p>);
  return <div className="rich-text">{parts}</div>;
}
