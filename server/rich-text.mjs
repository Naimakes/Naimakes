const entities = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
const decode = (text) =>
  text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name) => {
    if (name[0] === "#") {
      const code = name[1].toLowerCase() === "x" ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : "";
    }
    return entities[name.toLowerCase()] ?? whole;
  });

function htmlToText(html) {
  return decode(
    String(html || "")
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<\/(p|div|h[1-6]|li|blockquote|pre|tr|table)>|<br\s*\/?>|<hr\s*\/?>/gi, "\n")
      .replace(/<\/(td|th)>/gi, " ")
      .replace(/<[^>]*>/g, ""),
  )
    .replace(/[ \t\f\v\r]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim();
}

const mediaPattern = /<(img|video|table|hr)\b|data-type="file"/i;
export const hasRichMedia = (html) => mediaPattern.test(String(html || ""));

export const postFormat = (value) => (value === "html" ? "html" : "markdown");

export function plainText(content, format = "markdown") {
  if (format === "html") return htmlToText(content).replace(/\s+/g, " ").trim();
  return String(content || "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/[#*`>\[\]]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
