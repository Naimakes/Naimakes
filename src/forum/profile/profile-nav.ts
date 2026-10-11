type Navigate = (id: string) => void;
let handler: Navigate | null = null;
export function setProfileNav(next: Navigate | null) {
  handler = next;
}
export function openProfile(id: string) {
  if (!id) return;
  if (handler) handler(id);
  else location.assign(profileUrl(id));
}
export const profileUrl = (id: string) => "/u/" + encodeURIComponent(id);
export const profileIdFromPath = (path = location.pathname) => {
  const match = path.match(/^\/u\/([^/]+)$/);
  return match ? decodeURIComponent(match[1]) : "";
};
