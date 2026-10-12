// 附件有三种来源：直接上传（data 是内容）、图书馆里的文件（ref.library_id），以及站内文章或文章里的附件（ref.post_id）。
export type AttachmentRef = { library_id?: string; post_id?: string; attachment_id?: string };
export type Attachment = {
  id: string;
  name: string;
  kind: "image" | "pdf" | "text";
  mime: string;
  data: string;
  preview?: string;
  ref?: AttachmentRef;
};
export type FileInfo = { name: string; kind: "image" | "pdf" | "text"; preview?: string; id?: string; post?: { post_id: string; attachment_id?: string } };

export const MAX_FILES = 3;
const PREVIEW_EDGE = 96;
const textExtensions = /\.(txt|md|markdown|csv|tsv|json|log|xml|yaml|yml|html|css|js|ts|tsx|jsx|py|java|c|cpp|h|go|rs|sql|sh)$/i;

export const accept = "image/png,image/jpeg,image/gif,image/webp,application/pdf,.pdf,text/*,.md,.csv,.json,.log,.yaml,.yml,.py,.js,.ts,.tsx,.sql";

const uid = () => Math.random().toString(36).slice(2, 10);

function thumbnail(bitmap: ImageBitmap) {
  const scale = Math.min(1, PREVIEW_EDGE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext("2d");
  if (!context) return undefined;
  context.fillStyle = "#fff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.7);
}

function dataOf(file: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result);
      resolve(url.slice(url.indexOf(",") + 1));
    };
    reader.onerror = () => reject(new Error("无法读取文件。"));
    reader.readAsDataURL(file);
  });
}

export async function readAttachment(file: File): Promise<Attachment> {
  if (file.type.startsWith("image/")) {
    if (!["image/png", "image/jpeg", "image/gif", "image/webp"].includes(file.type)) throw new Error("暂时只支持 PNG、JPG、GIF、WebP 图片。");
    let preview: string | undefined;
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      preview = thumbnail(bitmap);
      bitmap.close();
    } catch {
      throw new Error(`「${file.name}」无法读取，请换一张图片。`);
    }
    return { id: uid(), name: file.name || "图片", kind: "image", mime: file.type, data: await dataOf(file), preview };
  }
  if (file.type === "application/pdf" || /\.pdf$/i.test(file.name)) {
    return { id: uid(), name: file.name || "文档.pdf", kind: "pdf", mime: "application/pdf", data: await dataOf(file) };
  }
  if (file.type.startsWith("text/") || file.type === "application/json" || textExtensions.test(file.name)) {
    return { id: uid(), name: file.name || "文本", kind: "text", mime: "text/plain", data: await file.text() };
  }
  throw new Error(`暂不支持「${file.name}」，可以附上图片、PDF 或文本文件。`);
}

export const info = (files: Attachment[]): FileInfo[] =>
  files.map(({ name, kind, preview, ref }) => ({
    name,
    kind,
    preview,
    ...(ref?.library_id ? { id: ref.library_id } : {}),
    ...(ref?.post_id ? { post: { post_id: ref.post_id, ...(ref.attachment_id ? { attachment_id: ref.attachment_id } : {}) } } : {}),
  }));

/** 发给服务端的附件：引用的文件只传引用，不传内容。 */
export const wire = ({ name, kind, mime, data, ref }: Attachment) => (ref ? ref : { name, kind, mime, data });

export const imageMimes = ["image/png", "image/jpeg", "image/gif", "image/webp"];
/** 助手能阅读的文件类型；其他类型（Word、压缩包、音视频等）返回 null。 */
export function kindOfFile(name: string, mime: string): Attachment["kind"] | null {
  if (imageMimes.includes(mime)) return "image";
  if (mime === "application/pdf" || /\.pdf$/i.test(name)) return "pdf";
  if (mime.startsWith("text/") || mime === "application/json" || textExtensions.test(name)) return "text";
  return null;
}
export const newId = uid;
