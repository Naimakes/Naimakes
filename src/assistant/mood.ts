import type { ChatMessage } from "./chat";

type Weighted = Record<string, number>;

const byHour: [number, number, Weighted][] = [
  [5, 9, { excited: 3, happy: 3, curious: 2, playful: 1 }],
  [9, 12, { curious: 3, proud: 2, happy: 2, listening: 2 }],
  [12, 14, { shy: 2, bored: 2, drowsy: 1, happy: 2, curious: 1 }],
  [14, 18, { proud: 3, curious: 3, listening: 2, happy: 1 }],
  [18, 22, { happy: 3, playful: 3, laughing: 2, excited: 1 }],
  [22, 29, { bored: 3, drowsy: 3, shy: 2, listening: 1 }],
];

const easy: Weighted = { happy: 3, playful: 3, laughing: 2, excited: 2, proud: 1 };
const middling: Weighted = { curious: 3, listening: 2, proud: 2, shy: 1 };
const hard: Weighted = { suspicious: 3, confused: 3, curious: 2, listening: 1, sad: 1 };

const clamp = (value: number) => Math.min(1, Math.max(0, value));

/** 0 (a quick, easy question) to 1 (long, unanswered or failing). */
export function taskDifficulty(messages: ChatMessage[]) {
  const question = [...messages].reverse().find((m) => m.role === "user");
  const reply = [...messages].reverse().find((m) => m.role === "assistant");
  if (!question) return 0;
  let level = clamp(question.content.length / 140) * 0.45;
  level += clamp(messages.length / 24) * 0.2;
  if (reply) {
    if (reply.error && reply.error !== "已停止回答。") level += 0.4;
    else if (!reply.sources?.length && reply.content) level += 0.15;
    level += clamp(reply.content.length / 900) * 0.15;
  }
  return clamp(level);
}

export function pickMood(now: Date, difficulty: number) {
  const hour = now.getHours();
  const time = (byHour.find(([from, to]) => hour >= from && hour < to) || byHour.find(([from, to]) => hour + 24 >= from && hour + 24 < to))![2];
  const task = difficulty >= 0.6 ? hard : difficulty >= 0.3 ? middling : easy;
  const pool: Weighted = {};
  for (const [name, weight] of Object.entries(time)) pool[name] = (pool[name] || 0) + weight;
  for (const [name, weight] of Object.entries(task)) pool[name] = (pool[name] || 0) + weight * (difficulty >= 0.3 ? 2 : 1);
  const entries = Object.entries(pool);
  let roll = Math.random() * entries.reduce((sum, [, weight]) => sum + weight, 0);
  for (const [name, weight] of entries) {
    roll -= weight;
    if (roll <= 0) return name;
  }
  return entries[0][0];
}

const postWords = /(发帖|发布|发表|写(一|个|篇|份)*(帖|讨论|文章|稿)|起草|草稿|帮我写|润色|拟一|撰写)/;
export const isPostRequest = (text: string) => postWords.test(text);
