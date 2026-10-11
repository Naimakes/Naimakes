import { LiquidButton } from "../motion/LiquidButton";
import { FluidTabs } from "../motion/FluidTabs";
import { LineField } from "../ui/LineField";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  Atom,
  Award,
  BookOpen,
  Box,
  BrainCircuit,
  Camera,
  Check,
  Code2,
  Compass,
  Cpu,
  Dna,
  Film,
  Fingerprint,
  Flag,
  FlaskConical,
  Gamepad2,
  Globe,
  Hash,
  Leaf,
  Lightbulb,
  LoaderCircle,
  Microscope,
  Mountain,
  Music,
  Orbit,
  Palette,
  Rocket,
  Search,
  Send,
  ShieldCheck,
  UserMinus,
  Users,
  Sprout,
  Telescope,
  Trash2,
  UserPlus,
  Waves,
  Wrench,
  Zap,
} from "lucide-react";
import { ModalRegistration as Modal } from "../motion/OverlayHost";
import Avatar from "../ui/Avatar";
import { DangerConfirm } from "../governance/Governance";
import { openGovernance, type CaseSummary } from "../governance/governance-api";
import {
  api,
  post,
  timeAgo,
  type BoardMember,
  type BoardModerator,
  type Category,
  type User,
} from "../api";

const iconComponents: Record<string, typeof Orbit> = {
  BrainCircuit,
  Orbit,
  Dna,
  Zap,
  Fingerprint,
  Box,
  Atom,
  Compass,
  Cpu,
  Globe,
  Leaf,
  Lightbulb,
  Microscope,
  Music,
  Palette,
  Rocket,
  Telescope,
  Waves,
  Wrench,
  BookOpen,
  Camera,
  Code2,
  FlaskConical,
  Gamepad2,
  Film,
  Sprout,
  Mountain,
  Hash,
};
export const boardIcon = (name?: string) => iconComponents[name || ""] || Orbit;

type Draft = { name: string; en: string; description: string; icon: string };
type Candidate = BoardMember;
type BoardReport = CaseSummary;

function BoardFields({
  draft,
  icons,
  onChange,
}: {
  draft: Draft;
  icons: string[];
  onChange: (patch: Partial<Draft>) => void;
}) {
  return (
    <>
      <div className="form-row">
        <label>
          版块名称
          <LineField
            value={draft.name}
            onValue={(v) => onChange({ name: v })}
            maxLength={40}
            placeholder="例如：材料科学"
            required
          />
        </label>
        <label>
          英文名（可留空）
          <LineField
            value={draft.en}
            onValue={(v) => onChange({ en: v })}
            maxLength={40}
            placeholder="Materials Science"
          />
        </label>
      </div>
      <label className="board-field">
        一句话简介
        <LineField
          value={draft.description}
          onValue={(v) => onChange({ description: v })}
          maxLength={300}
          placeholder="这个版块想聚集怎样的讨论？"
          required
        />
      </label>
      <fieldset className="board-icons">
        <legend>版块图标</legend>
        <div>
          {icons.map((name) => {
            const Icon = boardIcon(name);
            return (
              <LiquidButton
                type="button"
                key={name}
                className={draft.icon === name ? "selected" : ""}
                aria-label={"使用图标 " + name}
                aria-pressed={draft.icon === name}
                onClick={() => onChange({ icon: name })}
              >
                <Icon size={19} strokeWidth={1.4} />
              </LiquidButton>
            );
          })}
        </div>
      </fieldset>
    </>
  );
}

export function BoardForm({
  icons,
  onClose,
  onCreated,
}: {
  icons: string[];
  onClose: () => void;
  onCreated: (category: Category) => void;
}) {
  const [draft, setDraft] = useState<Draft>({
    name: "",
    en: "",
    description: "",
    icon: icons[0] || "Orbit",
  });
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const r = await api("/categories", post(draft));
      onCreated(r.category);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="创建版块" onClose={onClose} className="board-modal">
      <div className="composer-heading">
        <div className="eyebrow">OPEN A NEW FIELD</div>
        <h2>开一片新的讨论场地。</h2>
      </div>
      <form onSubmit={submit}>
        <BoardFields
          draft={draft}
          icons={icons}
          onChange={(patch) => setDraft({ ...draft, ...patch })}
        />
        <p className="library-hint">版块的创建者即为版主</p>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="library-form-actions">
          <LiquidButton type="button" className="button secondary" onClick={onClose}>
            取消
          </LiquidButton>
          <LiquidButton
            className="button primary"
            disabled={busy || !draft.name.trim() || !draft.description.trim()}
          >
            {busy && <LoaderCircle className="spin" size={16} />}创建版块
          </LiquidButton>
        </div>
      </form>
    </Modal>
  );
}

function ModeratorRow({
  person,
  board,
  user,
  busy,
  onRemove,
}: {
  person: BoardModerator;
  board: Category;
  user: User | null;
  busy: boolean;
  onRemove: (person: BoardModerator) => void;
}) {
  const lead = person.role === "lead";
  const self = person.id === user?.id;
  const removable = lead
    ? user?.role === "owner" || self
    : board.can_lead || ["owner", "admin"].includes(user?.role || "") || self;
  return (
    <div className="board-person glass-pill-row">
      <Avatar
        name={person.name}
        initials={person.initials}
        avatar={person.avatar}
        userId={person.id}
      />
      <div>
        <strong>
          {person.name}
          <span className={"role-pill " + (lead ? "role-owner" : "")}>
            {lead ? <Award size={12} /> : <ShieldCheck size={12} />}
            {lead ? "版主" : "协管"}
          </span>
        </strong>
      </div>
      {removable && (
        <LiquidButton
          type="button"
          className="text-button"
          disabled={busy}
          onClick={() => onRemove(person)}
        >
          <Trash2 size={14} />
          {self ? "辞任" : lead ? "撤销版主" : "解除协管"}
        </LiquidButton>
      )}
    </div>
  );
}

export function BoardConsolePanel({
  board,
  user,
  icons,
  onChanged,
  onMessage,
}: {
  board: Category;
  user: User | null;
  icons: string[];
  onMessage: (userId: string) => void;
  onChanged: (category: Category | null) => void;
}) {
  const [tab, setTab] = useState("team"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [query, setQuery] = useState(""),
    [candidates, setCandidates] = useState<Candidate[]>([]),
    [searching, setSearching] = useState(false),
    [reports, setReports] = useState<BoardReport[]>([]),
    [members, setMembers] = useState<BoardMember[]>([]),
    [draft, setDraft] = useState<Draft>({
      name: board.name,
      en: board.en,
      description: board.description,
      icon: board.icon,
    });
  const canLead = board.can_lead;
  const run = useCallback(
    async (work: () => Promise<any>, done: string) => {
      setBusy(true);
      setError("");
      try {
        const r = await work();
        setNotice(done);
        onChanged(r?.category ?? null);
        return r;
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [onChanged],
  );
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const again = () => setRevision((n) => n + 1);
    window.addEventListener("nmk-governance-changed", again);
    return () => window.removeEventListener("nmk-governance-changed", again);
  }, []);
  useEffect(() => {
    if (tab !== "reports") return;
    let active = true;
    Promise.all(
      ["post", "comment"].map((type) =>
        api(`/admin/complaints?type=${type}&board=${encodeURIComponent(board.id)}`),
      ),
    )
      .then((pages) => {
        if (active)
          setReports(
            pages
              .flatMap((r) => r.cases as BoardReport[])
              .sort((a, b) => b.updated_at - a.updated_at),
          );
      })
      .catch((e) => active && setError((e as Error).message));
    return () => {
      active = false;
    };
  }, [tab, board.id, notice, revision]);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [removing, setRemoving] = useState<BoardMember | null>(null);
  const [appointing, setAppointing] = useState<Candidate | null>(null);
  useEffect(() => {
    if (tab !== "team") return;
    let active = true;
    api(`/categories/${board.id}/members`)
      .then((r) => active && setMembers(r.members))
      .catch(() => active && setMembers([]));
    return () => {
      active = false;
    };
  }, [tab, board.id, notice]);
  useEffect(() => {
    if (tab !== "team" || !canLead) return;
    let active = true;
    setSearching(true);
    const timer = setTimeout(() => {
      api(
        "/moderation/candidates?" +
          new URLSearchParams({ q: query, board: board.id }),
      )
        .then((r) => active && setCandidates(r.users))
        .catch(() => active && setCandidates([]))
        .finally(() => active && setSearching(false));
    }, 220);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [tab, query, canLead, board.id, notice]);
  const team = [
    ...(board.lead ? [board.lead] : []),
    ...board.assistants,
  ];
  const taken = new Set(team.map((m) => m.id));
  return (
    <div className="board-console board-console-panel">
      <div className="admin-toolbar">
        <FluidTabs className="segmented board-console-tabs" active={tab} label="版块管理导航">
          {[
            ["team", "管理成员", ShieldCheck],
            ["info", "版块资料", Compass],
            ["reports", "待处理投诉", Flag],
          ].map(([id, label, Icon]: any) => (
            <LiquidButton
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              tabIndex={tab === id ? 0 : -1}
              onClick={() => {
                setTab(id);
                setNotice("");
                setError("");
              }}
            >
              <Icon size={14} />
              {label}
            </LiquidButton>
          ))}
        </FluidTabs>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <div className="admin-notice" role="status">
          <Check size={15} />
          {notice}
        </div>
      )}
      {tab === "team" ? (
        <div className="board-team">
          <section className="board-card">
            <h4>
              <UserPlus size={22} />
              {canLead ? "任命版主" : "管理团队"}
            </h4>
            {canLead && (
              <div className="admin-search">
                <Search size={16} />
                <input
                  aria-label="搜索成员"
                  placeholder="按昵称或账号查找成员"
                  value={query}
                  maxLength={40}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
            )}
            {team.map((person) => (
              <ModeratorRow
                key={person.id}
                person={person}
                board={board}
                user={user}
                busy={busy}
                onRemove={(p) =>
                  run(
                    () =>
                      api(`/categories/${board.id}/moderators/${p.id}`, {
                        method: "DELETE",
                      }),
                    p.role === "lead"
                      ? "版主权限已撤销，版块暂由站主代管。"
                      : "已解除该管理员。",
                  )
                }
              />
            ))}
            {canLead &&
              (searching && candidates.length === 0 ? (
                <div className="small-loading">
                  <LoaderCircle className="spin" size={20} />
                </div>
              ) : (
                <div className="board-candidates">
                  {candidates
                    .filter((c) => !taken.has(c.id))
                    .map((c) => (
                      <div className="board-person glass-pill-row" key={c.id}>
                        <Avatar name={c.name} initials={c.initials} avatar={c.avatar} userId={c.id} />
                        <div>
                          <strong>{c.name}</strong>
                        </div>
                        <LiquidButton
                          type="button"
                          className="text-button"
                          disabled={busy}
                          onClick={() => setAppointing(c)}
                        >
                          <Award size={14} />
                          任命为版主
                        </LiquidButton>
                      </div>
                    ))}
                  {!candidates.filter((c) => !taken.has(c.id)).length && (
                    <p className="admin-empty">没有找到可任命的成员。</p>
                  )}
                </div>
              ))}
          </section>
          <section className="board-card board-members">
            <h4>
              <Users size={22} />
              版块成员
              <span>{members.length}</span>
            </h4>
            {members.map((m) => (
              <div className="board-person glass-pill-row" key={m.id}>
                <Avatar name={m.name} initials={m.initials} avatar={m.avatar} userId={m.id} />
                <div>
                  <strong>{m.name}</strong>
                </div>
                {canLead && m.id !== board.lead?.id && m.id !== user?.id && (
                  <LiquidButton
                    type="button"
                    className="text-button member-remove"
                    disabled={busy}
                    onClick={() => setRemoving(m)}
                  >
                    <UserMinus size={14} />
                    踢出版块
                  </LiquidButton>
                )}
                {user && m.id !== user.id && (
                  <LiquidButton
                    type="button"
                    className="text-button"
                    onClick={() => onMessage(m.id)}
                  >
                    <Send size={14} />
                    私信
                  </LiquidButton>
                )}
              </div>
            ))}
            {!members.length && (
              <p className="admin-empty">这个版块还没有成员。</p>
            )}
          </section>
        </div>
      ) : tab === "info" ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            run(
              () => api("/categories/" + board.id, { method: "PATCH", body: JSON.stringify(draft) }),
              "版块资料已更新。",
            );
          }}
        >
          <BoardFields
            draft={draft}
            icons={icons}
            onChange={(patch) => setDraft({ ...draft, ...patch })}
          />
          <p className="library-hint">
            版块地址 /topics/{board.id} 创建后固定不变，改名不会影响已有链接。
          </p>
          <div className="library-form-actions">
            {user?.role === "owner" && (
              <LiquidButton
                type="button"
                className="button danger"
                disabled={busy}
                onClick={() => setConfirmDelete(true)}
              >
                <Trash2 size={15} />
                删除版块
              </LiquidButton>
            )}
            <LiquidButton className="button primary" disabled={busy}>
              {busy && <LoaderCircle className="spin" size={16} />}保存资料
            </LiquidButton>
          </div>
        </form>
      ) : (
        <div className="gov-list">
          {reports.map((r) => (
            <article className="gov-card" key={r.id}>
              <button type="button" className="gov-card-main is-link" onClick={() => openGovernance({ kind: "case", id: r.id })}>
                <span className="gov-card-content">
                  <span className="gov-kicker">{r.target_type === "post" ? "帖子" : r.reply ? "回复" : "评论"}</span>
                  <strong className="gov-ellipsis">
                    {r.target_type === "post" ? r.title : `「${r.title}」下的${r.reply ? "回复" : "评论"}`}
                  </strong>
                  {r.excerpt && <small className="gov-clamp">{r.excerpt}</small>}
                </span>
              </button>
              <div className="gov-card-status">
                <span className="gov-chip is-wait">待处理</span>
                <span className="gov-reasons">
                  {r.categories.slice(0, 2).map((c) => (
                    <span key={c.id} className="gov-chip is-danger">
                      {c.label}
                    </span>
                  ))}
                </span>
                {r.deleted && <span className="gov-chip is-danger">原内容已删除</span>}
                <small>
                  {r.count} 条 · {timeAgo(r.updated_at)}
                </small>
              </div>
              <div className="gov-card-actions">
                <span className="gov-slot" aria-hidden="true" />
                <LiquidButton
                  type="button"
                  className="admin-action gov-slot-button"
                  disabled={!r.can_handle}
                  title={r.conflict || undefined}
                  onClick={() => openGovernance({ kind: "case", id: r.id })}
                >
                  <Flag size={14} />
                  处理投诉
                </LiquidButton>
              </div>
            </article>
          ))}
          {!reports.length && (
            <div className="empty-state compact">
              <ShieldCheck size={38} strokeWidth={1} />
              <h3>本版块安好。</h3>
              <p>暂无待处理的投诉。</p>
            </div>
          )}
        </div>
      )}
      {appointing && (
        <DangerConfirm
          title="任命版主"
          heading={`任命 ${appointing.name} 为「${board.name}」的版主？`}
          description={
            board.lead?.id === user?.id
              ? "每个版块只有一位版主，任命后你将不再是这个版块的版主。对方会收到任命通知。"
              : board.lead
              ? `每个版块只有一位版主，${board.lead.name} 将被解除任命。双方都会收到通知。`
              : "每个版块只有一位版主。对方会收到任命通知。"
          }
          confirmLabel="任命"
          busy={busy}
          onClose={() => setAppointing(null)}
          onConfirm={() =>
            run(async () => {
              const r = await api(`/categories/${board.id}/transfer`, post({ user_id: appointing.id }));
              setAppointing(null);
              return r;
            }, `已任命 ${appointing.name} 为版主，并已通知相关成员。`)
          }
        />
      )}
      {removing && (
        <DangerConfirm
          title="踢出成员"
          heading={`将 ${removing.name} 踢出「${board.name}」？`}
          description="对方会收到提醒，之后仍可以自己重新加入这个版块。"
          confirmLabel="踢出版块"
          busy={busy}
          onClose={() => setRemoving(null)}
          onConfirm={() =>
            run(async () => {
              const r = await api(`/categories/${board.id}/members/${removing.id}`, { method: "DELETE" });
              setRemoving(null);
              return r;
            }, `已将 ${removing.name} 踢出本版块，并已提醒本人。`)
          }
        />
      )}
      {confirmDelete && (
        <DangerConfirm
          title="删除版块"
          heading={`删除「${board.name}」版块？`}
          description={`版块入口立即失效，${board.posts} 篇讨论不再公开显示；站主可以在回收站恢复。`}
          confirmLabel="删除版块"
          busy={busy}
          onClose={() => setConfirmDelete(false)}
          onConfirm={() =>
            run(async () => {
              await api("/categories/" + board.id, { method: "DELETE", body: JSON.stringify({}) });
              setConfirmDelete(false);
              return null;
            }, "版块已删除。")
          }
        />
      )}
    </div>
  );
}
