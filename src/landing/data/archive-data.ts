import type { ArchivePayload, ArchiveRecord, BoardInfo } from "./load-forum-posts";

export type { ArchiveRecord, BoardInfo };

const placeholderBoards: BoardInfo[] = [
  { id: "ai", name: "人工智能", en: "ARTIFICIAL INTELLIGENCE", description: "从机器学习到通用智能，探索思想的边界。", icon: "BrainCircuit", posts: 0, members: 0, followers: 0, views: 0, lead: "Naimakes" },
  { id: "space", name: "太空探索", en: "SPACE EXPLORATION", description: "越过地平线，寻找人类的下一站。", icon: "Orbit", posts: 0, members: 0, followers: 0, views: 0, lead: "Naimakes" },
  { id: "life", name: "生命科学", en: "LIFE SCIENCES", description: "从一个细胞开始，理解生命如何组织自己。", icon: "Dna", posts: 0, members: 0, followers: 0, views: 0, lead: "Naimakes" },
];

function waiting(index: number, board: BoardInfo): ArchiveRecord {
  return {
    id: `N-${String(index + 1).padStart(3, "0")}`,
    title: "等待第一篇帖子",
    en: "Naimakes",
    department: board.name,
    category: board.name,
    date: "尚未发布",
    lead: "Naimakes",
    clearance: board.en,
    abstract: "这个板块还没有讨论。进入社区发出第一篇帖子，它就会出现在这道阵列的最前面。",
    findings: ["阵列的每一道纵列是一个板块。", "列里的每一格是一篇帖子，最新的排在最前。"],
    source: "/discover",
    postId: "",
    boardId: board.id,
    authorAvatar: "",
    authorInitials: "NM",
    authorBio: "Naimakes 论坛",
    likes: 0,
    comments: 0,
    views: 0,
    readingMinutes: 1,
    tags: [],
    body: ["这个板块还没有讨论。进入社区发出第一篇帖子，它就会出现在这道阵列的最前面。"],
    createdAt: 0,
    announcement: false,
    pinned: false,
  };
}

const placeholder: ArchivePayload = {
  columns: placeholderBoards.map((board) => board.name),
  records: placeholderBoards.map((board, index) => waiting(index, board)),
  boards: placeholderBoards,
};

const content: ArchivePayload =
  typeof window !== "undefined" && window.__NAIMAKES_ARCHIVE__?.records?.length
    ? window.__NAIMAKES_ARCHIVE__
    : placeholder;

export const records: ArchiveRecord[] = content.records;
export const archiveColumns = content.columns;
export const boards: BoardInfo[] = content.boards?.length ? content.boards : placeholderBoards;

export function boardOf(record: ArchiveRecord): BoardInfo {
  return (
    boards.find((board) => board.id === record.boardId) ??
    boards.find((board) => board.name === record.category) ?? {
      id: record.boardId,
      name: record.category,
      en: record.clearance,
      description: "",
      icon: "Hash",
      posts: 0,
      members: 0,
      followers: 0,
      views: 0,
      lead: record.lead,
    }
  );
}

export function columnFiles(lane: number) {
  return records
    .map((record, index) => ({ record, index }))
    .filter(({ record }) => record.category === archiveColumns[lane])
    .map(({ index }) => index);
}
export function fileLocation(index: number) {
  const lane = archiveColumns.indexOf(records[index].category);
  const row = 12 + columnFiles(lane).indexOf(index);
  return { lane, row, slot: lane * 32 + row };
}
export function fileAtSlot(slot: number) {
  const files = columnFiles(Math.floor(slot / 32));
  return files[Math.max(0, Math.min(files.length - 1, (slot % 32) - 12))];
}
