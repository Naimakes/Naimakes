import type { Category, Collection, Message, Notification, PostVisibility, Quote } from "../api";

type SharePostData = Quote & { visibility?: PostVisibility; deleted?: boolean };
export type ShareTarget =
  | { type: "post"; post: SharePostData }
  | { type: "collection"; collection: Collection }
  | { type: "board"; board: Category }
  | { type: "message"; message: Message }
  | { type: "notice"; notice: Notification };

export const shareLabels: Record<ShareTarget["type"], string> = {
  post: "讨论",
  collection: "收藏夹",
  board: "版块",
  message: "私信",
  notice: "通知",
};

export function shareUrl(target: ShareTarget) {
  const origin = location.origin;
  if (target.type === "post") return origin + "/discussion/" + encodeURIComponent(target.post.id);
  if (target.type === "collection") return origin + "/collections/" + encodeURIComponent(target.collection.id);
  if (target.type === "board") return origin + "/topics/" + encodeURIComponent(target.board.id);
  return "";
}

export function sharePayload(target: ShareTarget) {
  if (target.type === "post") return { quotes: [target.post.id] };
  const id =
    target.type === "collection"
      ? target.collection.id
      : target.type === "board"
        ? target.board.id
        : target.type === "message"
          ? target.message.id
          : target.notice.id;
  return { share: { type: target.type, id } };
}

export function shareBlocked(target: ShareTarget) {
  if (target.type === "post") {
    if (target.post.deleted) return "这篇讨论已被删除。";
    if (target.post.visibility === "private") return "这篇讨论仅自己可见，改为公开后才能分享。";
  }
  if (target.type === "collection" && !target.collection.is_public)
    return "这个收藏夹是私密的，只有你自己能看到。\n在「编辑收藏夹」里设为公开后，就能分享给别人。";
  return "";
}

let handler: ((target: ShareTarget) => void) | null = null;
export const setShareHandler = (next: typeof handler) => {
  handler = next;
};
export const openShare = (target: ShareTarget) => handler?.(target);
