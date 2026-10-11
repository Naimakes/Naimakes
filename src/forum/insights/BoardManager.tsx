import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowUpRight, Award, Eye, FileText, LoaderCircle, Search, ShieldCheck, UserPlus } from "lucide-react";
import { ModalRegistration as Modal } from "../motion/OverlayHost";
import { LiquidButton } from "../motion/LiquidButton";
import { BoardConsolePanel } from "../boards/Boards";
import { api, countLabel, type Category, type InsightMetric, type ManagedBoard, type User } from "../api";
import { InsightPanel } from "./InsightPanel";
import "./insights.css";

type IconFor = (id: string) => typeof Eye;
const metrics: Exclude<InsightMetric, "comments">[] = ["views", "likes", "bookmarks", "followers"];

export default function BoardManager({
  focusId,
  categories,
  user,
  icons,
  iconFor,
  onClose,
  onChanged,
  onMessage,
  onOpenBoard,
}: {
  focusId?: string;
  categories: Category[];
  user: User | null;
  icons: string[];
  iconFor: IconFor;
  onClose: () => void;
  onChanged: (category: Category | null) => void;
  onMessage: (userId: string) => void;
  onOpenBoard: (id: string) => void;
}) {
  const [boards, setBoards] = useState<ManagedBoard[] | null>(null);
  const [selected, setSelected] = useState(focusId || "");
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const load = useCallback(
    () =>
      api<{ boards: ManagedBoard[] }>("/insights/boards")
        .then((r) => {
          setBoards(r.boards);
          setError("");
          setSelected((id) => (r.boards.some((b) => b.id === id) ? id : r.boards[0]?.id || ""));
        })
        .catch((e) => setError((e as Error).message)),
    [],
  );
  useEffect(() => {
    load();
    const timer = setInterval(() => document.visibilityState === "visible" && load(), 20000);
    return () => clearInterval(timer);
  }, [load]);
  const summary = boards?.find((b) => b.id === selected) || null;
  const board = categories.find((c) => c.id === selected) || null;
  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (boards || []).filter((b) => !needle || b.name.toLowerCase().includes(needle) || b.en.toLowerCase().includes(needle));
  }, [boards, query]);
  const Icon = iconFor(selected);
  return (
    <Modal title="NAIMAKES / MY BOARDS" wide onClose={onClose} className="insight-modal">
      <div className="admin-title">
        <div>
          <div className="eyebrow">TEND THE FIELD YOU OPENED</div>
          <h2>管理版块</h2>
          <p className="library-hint">按整个版块统计阅读、点赞、收藏与关注，成员、版主与版块资料也都在这里管理。</p>
        </div>
        {boards && <span className="role-pill">共 {boards.length} 个版块</span>}
      </div>
      {error && !boards ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : !boards ? (
        <div className="small-loading">
          <LoaderCircle className="spin" size={22} />
        </div>
      ) : !boards.length ? (
        <div className="empty-state compact">
          <ShieldCheck size={36} strokeWidth={1} />
          <h3>你还没有负责的版块。</h3>
          <p>成为版主或协管后，就能在这里查看版块数据并管理成员。</p>
        </div>
      ) : (
        <div className="insight-layout">
          <aside className="insight-list" aria-label="我管理的版块">
            {boards.length > 5 && (
              <div className="admin-search insight-search">
                <Search size={16} />
                <input aria-label="搜索版块" placeholder="按名称查找版块" value={query} maxLength={40} onChange={(e) => setQuery(e.target.value)} />
              </div>
            )}
            <div className="insight-list-items" role="listbox" aria-label="选择版块">
              {shown.map((b) => {
                const BoardIcon = iconFor(b.id);
                return (
                  <LiquidButton
                    key={b.id}
                    type="button"
                    role="option"
                    aria-selected={b.id === selected}
                    className={`insight-item ${b.id === selected ? "is-selected" : ""}`}
                    onClick={() => setSelected(b.id)}
                  >
                    <span className="insight-item-kicker">
                      <BoardIcon size={12} />
                      {b.en || "BOARD"}
                    </span>
                    <strong>{b.name}</strong>
                    <span className="insight-item-stats">
                      <span>
                        <Eye size={12} />
                        {countLabel(b.views)}
                      </span>
                      <span>
                        <FileText size={12} />
                        {countLabel(b.posts)}
                      </span>
                      <span>
                        <UserPlus size={12} />
                        {countLabel(b.followers)}
                      </span>
                    </span>
                  </LiquidButton>
                );
              })}
              {!shown.length && <p className="admin-empty">没有找到匹配的版块。</p>}
            </div>
          </aside>
          {summary && (
            <div className="insight-main">
              <header className="insight-head">
                <span className="insight-kicker">
                  <Icon size={13} />
                  {summary.en || "BOARD"}
                  <em>{summary.posts} 个讨论</em>
                </span>
                <div className="insight-head-row">
                  <h3>{summary.name}</h3>
                  <LiquidButton type="button" className="button secondary compact" onClick={() => onOpenBoard(summary.id)}>
                    进入版块
                    <ArrowUpRight size={14} />
                  </LiquidButton>
                </div>
                {board && (
                  <p className="insight-lead">
                    <Award size={13} />
                    {board.lead ? `版主 ${board.lead.name}` : `暂无版主，由站主${board.acting_owner ? " " + board.acting_owner.name + " " : ""}代管`}
                    {board.assistants.length > 0 && ` · ${board.assistants.length} 位协管`}
                    {` · ${board.members} 位成员`}
                  </p>
                )}
              </header>
              <InsightPanel
                endpoint={`/insights/boards/${encodeURIComponent(summary.id)}`}
                metrics={metrics}
                totalPrefix="总"
                onTotals={(totals) => {
                  const next = Object.fromEntries(metrics.map((m) => [m, totals[m] ?? 0]));
                  if (metrics.some((m) => next[m] !== summary[m]))
                    setBoards((list) => list && list.map((b) => (b.id === summary.id ? { ...b, ...next } : b)));
                }}
              />
              <section className="insight-actions" aria-label="版块管理">
                <h4>版块管理</h4>
                {board ? (
                  <BoardConsolePanel
                    key={board.id}
                    board={board}
                    user={user}
                    icons={icons}
                    onMessage={onMessage}
                    onChanged={(next) => {
                      onChanged(next);
                      load();
                    }}
                  />
                ) : (
                  <div className="small-loading">
                    <LoaderCircle className="spin" size={20} />
                  </div>
                )}
              </section>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
