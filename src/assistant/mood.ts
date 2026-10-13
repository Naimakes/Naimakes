import { useEffect, useState } from "react";
import type { ChatMessage } from "./chat";

type Weighted = Record<string, number>;

const byHour: [number, number, Weighted][] = [
  [5, 9, { excited: 3, happy: 3, curious: 2, playful: 1 }],
  [9, 12, { curious: 3, proud: 2, happy: 2, listening: 2, surprised: 1 }],
  [12, 14, { shy: 2, bored: 2, drowsy: 1, happy: 2, curious: 1, humming: 1 }],
  [14, 18, { proud: 3, curious: 3, listening: 2, happy: 1, humming: 1, showcase: 0.5 }],
  [18, 22, { happy: 3, playful: 3, laughing: 2, excited: 1, humming: 2 }],
  [22, 29, { bored: 3, drowsy: 3, shy: 2, listening: 1, scared: 0.5 }],
];

const easy: Weighted = { happy: 3, playful: 3, laughing: 2, excited: 2, proud: 1, celebrate: 0.5, turntable: 0.5 };
const middling: Weighted = { curious: 3, listening: 2, proud: 2, shy: 1, surprised: 1 };
const hard: Weighted = { suspicious: 3, confused: 3, curious: 2, listening: 1, sad: 1, angry: 0.5 };

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

function draw(pool: Weighted) {
  const entries = Object.entries(pool);
  let roll = Math.random() * entries.reduce((sum, [, weight]) => sum + weight, 0);
  for (const [name, weight] of entries) {
    roll -= weight;
    if (roll <= 0) return name;
  }
  return entries[0][0];
}

export function pickMood(now: Date, difficulty: number) {
  const hour = now.getHours();
  const time = (byHour.find(([from, to]) => hour >= from && hour < to) || byHour.find(([from, to]) => hour + 24 >= from && hour + 24 < to))![2];
  const task = difficulty >= 0.6 ? hard : difficulty >= 0.3 ? middling : easy;
  const pool: Weighted = {};
  for (const [name, weight] of Object.entries(time)) pool[name] = (pool[name] || 0) + weight;
  for (const [name, weight] of Object.entries(task)) pool[name] = (pool[name] || 0) + weight * (difficulty >= 0.3 ? 2 : 1);
  return draw(pool);
}

/** 一轮回答结束时摆的姿势：答得越费劲，越可能庆祝一下。 */
export function pickOutcome(reply: ChatMessage | undefined, difficulty: number) {
  if (!reply) return "finished";
  if (reply.error) {
    if (/网络|连接/.test(reply.error)) return draw({ scared: 2, failed: 2, sad: 1 });
    return draw({ failed: 3, sad: 2, confused: 2 });
  }
  if (reply.offline) return "blocked";
  return draw({ finished: 3, approving: 2, happy: 2, celebrate: 0.5 + difficulty * 2, proud: 0.5 + difficulty, turntable: 0.3 });
}

/** 确认执行的操作有了结果时，闪一下的反应。 */
export const pickActionReaction = (ok: boolean) => (ok ? draw({ approving: 3, celebrate: 1, happy: 1 }) : draw({ sad: 3, failed: 2, angry: 0.5 }));

/**
 * 智能体在各种场景下可以摆的姿势。poses[0] 是这个场景的本色，其余的穿插着换，
 * 免得搜索、输出时一直一个样。同一个场景里的姿势身体大小要一致：要么都是整个身体，
 * 要么都是缩成小图标的（雷达、三个点、轨道），不在两者之间来回切，否则会忽大忽小。
 * 也不用「缩成一个点再弹回来」的 spawning、uploading、sending、receiving、progress、loading。
 */
const scenes = {
  thinking: { poses: ["thinking", "orbit"] },
  attachments: { poses: ["reading", "listening"] },
  coding: { poses: ["coding", "humming"] },
  searching: { poses: ["searching", "thinking", "orbit"] },
  browsing: { poses: ["reading", "curious", "listening"] },
  reading: { poses: ["reading", "curious", "suspicious"] },
  inbox: { poses: ["reading", "curious"] },
  managing: { poses: ["working", "listening", "humming"] },
  spawning: { poses: ["surprised", "approving"] },
  controlling: { poses: ["controlling", "listening"] },
  composing: { poses: ["writing"] },
  answering: { poses: ["streaming", "humming", "listening"] },
  running: { poses: ["working", "listening"] },
  waiting: { poses: ["listening", "shy"] },
  notifying: { poses: ["notifying"] },
  dictating: { poses: ["listening", "humming"] },
} satisfies Record<string, { poses: string[] }>;
export type Scene = keyof typeof scenes;

const toolScenes: [RegExp, Scene][] = [
  [/^create_agent$/, "spawning"],
  [/^(search_posts|find_users|web_search)$/, "searching"],
  [/^(list_notifications|list_conversations|read_conversation|mark_notifications_read)$/, "inbox"],
  [/^(get_post|get_user)$/, "reading"],
  [/(memor|agent|scheduled_task|^remember$|assistant_settings)/, "managing"],
  [/^(create_post|edit_post|save_draft|publish_draft|create_comment|send_message)$/, "composing"],
  [/^(list_|get_)/, "browsing"],
];

/** 正在调用的站内工具对应哪个场景；其余的写入操作都算在「操作网站」里。 */
export const sceneOfTool = (tool: string): Scene => toolScenes.find(([test]) => test.test(tool))?.[1] ?? "controlling";

const codeWords = /(代码|编程|程序|函数|报错|bug|debug|code|script|脚本|正则|sql|api|css|html|javascript|typescript|python|```)/i;
export const isCodeRequest = (text: string) => codeWords.test(text);

const between = (min: number, max: number) => min + Math.random() * (max - min);

/** 在一个场景里轮流换姿势：本色停得久一些，穿插的动作一下就回来。减弱动态时只用本色。 */
export function useScene(scene: Scene | null, reduced: boolean) {
  const [shown, setShown] = useState<{ scene: Scene | null; pose: string }>({ scene: null, pose: "" });
  useEffect(() => {
    if (!scene) return;
    const { poses } = scenes[scene] as { poses: string[] };
    const show = (pose: string) => setShown({ scene, pose });
    show(poses[0]);
    if (reduced || poses.length < 2) return;
    let timer = 0;
    let turn = 1;
    let last = "";
    const step = () => {
      const main = turn++ % 2 === 0;
      const others = poses.slice(1);
      const choices = others.length > 1 ? others.filter((pose) => pose !== last) : others;
      const pose = main ? poses[0] : choices[Math.floor(Math.random() * choices.length)];
      if (!main) last = pose;
      show(pose);
      timer = window.setTimeout(step, main ? between(12000, 20000) : between(3500, 4800));
    };
    timer = window.setTimeout(step, between(12000, 20000));
    return () => clearTimeout(timer);
  }, [scene, reduced]);
  if (!scene) return null;
  return shown.scene === scene ? shown.pose : scenes[scene].poses[0];
}

const postWords = /(发帖|发布|发表|写(一|个|篇|份)*(帖|讨论|文章|稿)|起草|草稿|帮我写|润色|拟一|撰写)/;
export const isPostRequest = (text: string) => postWords.test(text);
