type Navigator = (path: string) => void;
let handler: Navigator | null = null;

export function setAssistantNavigator(next: Navigator | null) {
  handler = next;
}

export function go(path: string) {
  if (handler) handler(path);
  else location.assign(path);
}

export type Viewed = { id: string; title: string; at: number };
let viewed: Viewed | null = null;

export function rememberViewed(post: { id: string; title: string } | null) {
  if (post) viewed = { id: post.id, title: post.title, at: Date.now() };
}

export function recentlyViewed(maxAge = 30 * 60000) {
  return viewed && Date.now() - viewed.at < maxAge ? viewed : null;
}
