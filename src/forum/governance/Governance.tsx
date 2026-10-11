import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type TextareaHTMLAttributes } from "react";
import {
  AlertTriangle,
  ArrowUpRight,
  Ban,
  CalendarClock,
  Check,
  ChevronDown,
  Clock3,
  Flag,
  Gavel,
  Infinity as Forever,
  LoaderCircle,
  Mic,
  MicOff,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  Undo2,
  UserRound,
} from "lucide-react";
import { ModalRegistration as Modal } from "../motion/OverlayHost";
import Avatar from "../ui/Avatar";
import GlassDateTime from "../ui/GlassDateTime";
import { GlassSegments } from "../ui/GlassSegments";
import { boardIcon } from "../boards/Boards";
import { LiquidButton } from "../motion/LiquidButton";
import { api, post as requestPost, timeAgo, type ApiError } from "../api";
import {
  caseActionLabel,
  caseStatusLabel,
  complaintCategories,
  dateText,
  dateTimeText,
  muteLabel,
  roleNames,
  setGovernanceNav,
  targetNouns,
  type AppealDetail,
  type CaseDetail,
  type GovernanceRef,
  type PenaltyInfo,
  type PersonCard,
  type RequestDetail,
  type Snapshot,
  type TargetType,
} from "./governance-api";

function AutoTextarea({
  value,
  onValue,
  minRows = 3,
  className = "",
  ...props
}: Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "onChange" | "value" | "rows"> & {
  value: string;
  onValue: (value: string) => void;
  minRows?: number;
}) {
  const box = useRef<HTMLTextAreaElement>(null);
  const manual = useRef(0);
  const fitted = useRef(0);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = "auto";
    const edge = el.offsetHeight - el.clientHeight;
    const next = Math.max(el.scrollHeight + edge, manual.current);
    fitted.current = next;
    el.style.height = next + "px";
  }, [value]);
  return (
    <textarea
      {...props}
      ref={box}
      rows={minRows}
      value={value}
      className={`auto-textarea ${className}`.trim()}
      onChange={(event) => onValue(event.target.value)}
      onPointerUp={() => {
        const el = box.current;
        if (el && Math.abs(el.offsetHeight - fitted.current) > 2) manual.current = el.offsetHeight;
      }}
    />
  );
}

function FoldText({ text, lines = 4 }: { text: string; lines?: number }) {
  const [open, setOpen] = useState(false),
    [clipped, setClipped] = useState(false);
  const box = useRef<HTMLParagraphElement>(null);
  useLayoutEffect(() => {
    const el = box.current;
    if (el && !open) setClipped(el.scrollHeight > el.clientHeight + 1);
  }, [text, open]);
  if (!text) return null;
  return (
    <div className="fold-text">
      <p ref={box} className={open ? "is-open" : ""} style={{ ["--fold-lines" as string]: lines }}>
        {text}
      </p>
      {(clipped || open) && (
        <LiquidButton type="button" className="admin-action fold-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? "收起" : "展开全文"}
          <ChevronDown size={13} className={open ? "flipped" : ""} />
        </LiquidButton>
      )}
    </div>
  );
}

const Chip = ({ children, tone = "", icon }: { children: ReactNode; tone?: "" | "danger" | "ok" | "wait"; icon?: ReactNode }) => (
  <span className={`gov-chip ${tone ? "is-" + tone : ""}`}>
    {icon}
    {children}
  </span>
);
const Lines = ({ rows }: { rows: [string, ReactNode][] }) => (
  <dl className="gov-lines">
    {rows
      .filter(([, value]) => value !== null && value !== undefined && value !== "")
      .map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
  </dl>
);
const Field = ({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) => (
  <label className="confirm-field gov-field">
    <span className="gov-field-label">
      {label}
      {hint && <small>{hint}</small>}
    </span>
    {children}
  </label>
);
const Loading = () => (
  <div className="gov-loading">
    <LoaderCircle size={22} className="spin" />
  </div>
);
function Actions({ children, busy, onCancel, cancel = "取消" }: { children?: ReactNode; busy?: boolean; onCancel: () => void; cancel?: string }) {
  return (
    <div className="confirm-actions gov-actions-row">
      <LiquidButton type="button" className="button secondary admin-action" disabled={busy} onClick={onCancel}>
        {cancel}
      </LiquidButton>
      {children}
    </div>
  );
}
function Submit({ busy, danger, disabled, onClick, children }: { busy: boolean; danger?: boolean; disabled?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <LiquidButton
      type="button"
      className={"button admin-action " + (danger ? "admin-action-danger" : "admin-action-primary")}
      disabled={busy || disabled}
      onClick={onClick}
    >
      {busy && <LoaderCircle size={15} className="spin" />}
      {children}
    </LiquidButton>
  );
}
const Identity = ({ person, size = 48, extra, center = false }: { person: PersonCard | null; size?: number; extra?: ReactNode; center?: boolean }) =>
  person ? (
    <div className={`moderation-person gov-identity ${center ? "is-centered" : ""}`}>
      <Avatar name={person.name} initials={person.initials} avatar={person.avatar} size={size} userId={person.id} />
      <div>
        <strong>{person.name}</strong>
        <small>ID · {person.name}</small>
        {extra}
      </div>
    </div>
  ) : (
    <div className="moderation-person gov-identity">
      <span className="gov-glyph">
        <UserRound size={20} />
      </span>
      <div>
        <strong>已注销用户</strong>
      </div>
    </div>
  );
const BoardIdentity = ({ name, icon, lead, center = false }: { name: string; icon?: string; lead?: PersonCard | null; center?: boolean }) => {
  const Icon = boardIcon(icon);
  return (
    <div className={`moderation-person gov-identity ${center ? "is-centered" : ""}`}>
      <span className="gov-glyph is-board">
        <Icon size={24} strokeWidth={1.5} />
      </span>
      <div>
        <strong>{name}</strong>
        {lead ? (
          <span className="gov-lead">
            <Avatar name={lead.name} initials={lead.initials} avatar={lead.avatar} size={22} userId={lead.id} />
            版主 {lead.name}
            <small>ID · {lead.name}</small>
          </span>
        ) : (
          <small>暂无版主，由站主代管</small>
        )}
      </div>
    </div>
  );
};

export function DangerConfirm({
  title,
  heading,
  description,
  confirmLabel,
  busy = false,
  onConfirm,
  onClose,
}: {
  title: string;
  heading: string;
  description: ReactNode;
  confirmLabel: string;
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Modal title={title} className="confirm-modal admin-confirm-modal moderation-modal gov-modal gov-danger-modal" onClose={() => !busy && onClose()}>
      <div className="confirm-body">
        <span className="confirm-icon is-danger">
          <AlertTriangle size={22} strokeWidth={1.6} />
        </span>
        <h2>{heading}</h2>
        <p>{description}</p>
      </div>
      <Actions busy={busy} onCancel={onClose}>
        <Submit busy={busy} danger onClick={onConfirm}>
          {confirmLabel}
        </Submit>
      </Actions>
    </Modal>
  );
}

type Duration = { mode: "days"; days: number } | { mode: "until"; until: number } | { mode: "permanent" };
const presets: { id: string; label: string; value: Duration }[] = [
  { id: "1", label: "1 天", value: { mode: "days", days: 1 } },
  { id: "3", label: "3 天", value: { mode: "days", days: 3 } },
  { id: "7", label: "7 天", value: { mode: "days", days: 7 } },
  { id: "30", label: "30 天", value: { mode: "days", days: 30 } },
  { id: "permanent", label: "永久", value: { mode: "permanent" } },
];
const localValue = (time: number) => {
  const d = new Date(time);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const presetOf = (value: Duration) =>
  value.mode === "permanent" ? "permanent" : value.mode === "until" ? "custom" : String(value.days);
type Strategy = "extend" | "replace";
function DurationPicker({
  value,
  onChange,
  existing,
  strategy,
  onStrategy,
}: {
  value: Duration;
  onChange: (next: Duration) => void;
  existing?: PenaltyInfo | null;
  strategy?: Strategy;
  onStrategy?: (next: Strategy) => void;
}) {
  const [floor] = useState(() => localValue(Date.now() + 5 * 60000));
  const [ceiling] = useState(() => localValue(Date.now() + 3650 * 86400000 - 60000));
  const active = presetOf(value);
  const days = value.mode === "days";
  return (
    <div className="gov-duration">
      {existing && days && onStrategy && (
        <GlassSegments<Strategy>
          label="在当前禁言基础上"
          value={strategy ?? null}
          onChange={onStrategy}
          items={[
            { id: "extend", label: existing.until ? "在原截止时间上延长" : "当前为永久禁言", disabled: !existing.until },
            { id: "replace", label: "从现在重新计算" },
          ]}
        />
      )}
      <div className="gov-duration-row">
        <GlassSegments
          label="禁言期限"
          value={active === "custom" ? null : active}
          onChange={(id) => onChange(presets.find((p) => p.id === id)!.value)}
          items={presets.map((p) => ({
            id: p.id,
            label: p.label,
            danger: p.id === "permanent",
            icon: p.id === "permanent" ? <Forever size={14} /> : undefined,
          }))}
        />
        <LiquidButton
          type="button"
          aria-pressed={active === "custom"}
          className={"admin-action gov-custom" + (active === "custom" ? " is-selected" : "")}
          onClick={() => onChange({ mode: "until", until: value.mode === "until" ? value.until : 0 })}
        >
          <CalendarClock size={15} />
          自定义
        </LiquidButton>
      </div>
      {value.mode === "until" && (
        <div className="gov-duration-custom">
          <GlassDateTime
            label="截止时间"
            value={value.until ? localValue(value.until) : ""}
            min={floor}
            max={ceiling}
            fallbackTime="23:59"
            onChange={(next) => onChange({ mode: "until", until: next ? new Date(next).getTime() : 0 })}
          />
        </div>
      )}
    </div>
  );
}
const durationReady = (d: Duration) => d.mode !== "until" || d.until > Date.now();
const previewEnd = (d: Duration, existing?: PenaltyInfo | null, strategy: Strategy = "extend") => {
  if (d.mode === "permanent") return null;
  if (d.mode === "until") return d.until || null;
  const base = existing && strategy === "extend" && existing.until ? existing.until : Date.now();
  return base + d.days * 86400000;
};

function ComplaintDialog({
  type,
  id,
  label,
  excerpt = "",
  onClose,
  onDone,
}: {
  type: TargetType;
  id: string;
  label: string;
  excerpt?: string;
  onClose: () => void;
  onDone: (message: string, tone?: "success" | "error") => void;
}) {
  const [category, setCategory] = useState(""),
    [detail, setDetail] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const length = Array.from(detail.trim()).length;
  const needsText = category === "other";
  const ready = !!category && (!needsText || length >= 2);
  async function send() {
    setBusy(true);
    setError("");
    try {
      await api("/complaints", requestPost({ target_type: type, target_id: id, category, detail }));
      onDone("投诉已提交，我们会尽快处理。", "success");
    } catch (e) {
      const err = e as ApiError;
      if (err.code === "complaint_pending") return onDone(err.message);
      setError(err.message);
      setBusy(false);
    }
  }
  return (
    <Modal title={"投诉" + targetNouns[type]} motionKey={`complaint-${type}-${id}`} className="confirm-modal admin-confirm-modal moderation-modal gov-modal" onClose={() => !busy && onClose()}>
      <header className="gov-head">
        <span className="confirm-icon is-danger">
          <Flag size={20} strokeWidth={1.7} />
        </span>
        <div>
          <h2>投诉{type === "comment" ? "评论" : targetNouns[type]}</h2>
          <p className="gov-head-target">{label}</p>
        </div>
      </header>
      {excerpt && type !== "user" && <blockquote className="gov-quote" title={excerpt}><span>{excerpt}</span></blockquote>}
      <div className="gov-section-title">投诉类型</div>
      <GlassSegments<string>
        className="gov-category-segs"
        label="投诉类型"
        value={category}
        onChange={setCategory}
        columns={5}
        items={complaintCategories.map((c) => ({ id: c.id, label: c.label }))}
      />
      <Field label={needsText ? "具体原因" : "补充说明"} hint={<>{length} / 1000</>}>
        <AutoTextarea
          value={detail}
          onValue={setDetail}
          maxLength={1000}
          minRows={3}
          placeholder={needsText ? "请写明具体原因" : "可选"}
        />
      </Field>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <Actions busy={busy} onCancel={onClose}>
        <Submit busy={busy} danger disabled={!ready} onClick={send}>
          提交投诉
        </Submit>
      </Actions>
    </Modal>
  );
}

type MuteView = {
  until: number | null;
  starts_at?: number | null;
  reason?: string;
  appeal_pending?: boolean;
  cooldown_until?: number | null;
};
export function MuteBadge({
  kind,
  targetId,
  label,
  mute,
  canAppeal,
  onAppealed,
}: {
  kind: "user" | "board";
  targetId: string;
  label: string;
  mute: MuteView;
  canAppeal: boolean;
  onAppealed: () => void;
}) {
  const [open, setOpen] = useState(false);
  const body = (
    <>
      <MicOff size={12} />
      {mute.until ? (
        <>
          <span>禁言至</span>
          <span>{dateText(mute.until)}</span>
        </>
      ) : (
        <span>{muteLabel(null)}</span>
      )}
      {canAppeal && mute.appeal_pending && <em>申诉中</em>}
    </>
  );
  if (!canAppeal) return <span className="mute-chip is-static">{body}</span>;
  return (
    <>
      <LiquidButton type="button" className="mute-chip" aria-haspopup="dialog" title="查看禁言并申诉" onClick={() => setOpen(true)}>
        {body}
      </LiquidButton>
      {open && (
        <AppealDialog
          kind={kind}
          targetId={targetId}
          label={label}
          mute={mute}
          onClose={() => setOpen(false)}
          onSent={() => {
            setOpen(false);
            onAppealed();
          }}
        />
      )}
    </>
  );
}
function AppealDialog({
  kind,
  targetId,
  label,
  mute,
  onClose,
  onSent,
}: {
  kind: "user" | "board";
  targetId: string;
  label: string;
  mute: MuteView;
  onClose: () => void;
  onSent: () => void;
}) {
  const [reason, setReason] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [pending, setPending] = useState(!!mute.appeal_pending),
    [cooldown, setCooldown] = useState(mute.cooldown_until && mute.cooldown_until > Date.now() ? mute.cooldown_until : null);
  const length = Array.from(reason.trim()).length;
  async function send() {
    setBusy(true);
    setError("");
    try {
      await api("/appeals", requestPost({ target_type: kind, target_id: targetId, reason }));
      onSent();
    } catch (e) {
      const err = e as ApiError;
      if (err.code === "appeal_pending") setPending(true);
      else if (err.code === "appeal_cooldown") setCooldown(err.data?.cooldown_until ?? null);
      else setError(err.message);
      setBusy(false);
    }
  }
  return (
    <Modal title="禁言申诉" motionKey={`appeal-${kind}-${targetId}`} className="confirm-modal admin-confirm-modal moderation-modal gov-modal" onClose={() => !busy && onClose()}>
      <header className="gov-head">
        <span className="confirm-icon is-danger">
          <MicOff size={20} strokeWidth={1.7} />
        </span>
        <div>
          <h2>禁言申诉</h2>
          <p className="gov-head-target">{kind === "user" ? "我的账号" : `「${label}」版块`}</p>
        </div>
      </header>
      <section className="moderation-sheet gov-sheet">
        <Lines
          rows={[
            ["处罚", <Chip tone="danger">{muteLabel(mute.until)}</Chip>],
            ["原因", mute.reason || "未填写"],
            ["开始时间", mute.starts_at ? dateTimeText(mute.starts_at) : ""],
            ["结束时间", mute.until ? dateTimeText(mute.until) : "永久"],
          ]}
        />
      </section>
      {pending ? (
        <>
          <p className="gov-state">
            <Clock3 size={15} />
            申诉正在处理中
          </p>
          <div className="confirm-actions gov-actions-row is-single">
            <LiquidButton type="button" className="button admin-action admin-action-primary" onClick={onClose}>
              知道了
            </LiquidButton>
          </div>
        </>
      ) : cooldown ? (
        <>
          <p className="gov-state is-danger">
            <Clock3 size={15} />
            上次申诉已被驳回，{dateTimeText(cooldown)} 之后可以再次申诉
          </p>
          <div className="confirm-actions gov-actions-row is-single">
            <LiquidButton type="button" className="button admin-action admin-action-primary" onClick={onClose}>
              知道了
            </LiquidButton>
          </div>
        </>
      ) : (
        <>
          <Field label="申诉理由" hint={<>{length} / 2000</>}>
            <AutoTextarea autoFocus value={reason} onValue={setReason} maxLength={2000} minRows={5} placeholder="说明理由，站主会逐字阅读" />
          </Field>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <Actions busy={busy} onCancel={onClose}>
            <Submit busy={busy} disabled={length < 2} onClick={send}>
              提交申诉
            </Submit>
          </Actions>
        </>
      )}
    </Modal>
  );
}

export function MuteDialog({
  kind,
  id,
  name,
  person,
  icon,
  lead,
  penalty,
  canUnmute,
  onClose,
  onDone,
}: {
  kind: "user" | "board";
  id: string;
  name: string;
  person?: PersonCard | null;
  icon?: string;
  lead?: PersonCard | null;
  penalty: PenaltyInfo | null;
  canUnmute: boolean;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [duration, setDuration] = useState<Duration>({ mode: "days", days: 7 }),
    [strategy, setStrategy] = useState<Strategy>(penalty?.until ? "extend" : "replace"),
    [reason, setReason] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [confirm, setConfirm] = useState<"" | "mute" | "unmute">("");
  const path = `/admin/${kind === "user" ? "users" : "boards"}/${encodeURIComponent(id)}/mute`;
  const end = previewEnd(duration, penalty, strategy);
  async function run(action: "mute" | "unmute") {
    setBusy(true);
    setError("");
    try {
      if (action === "mute") await api(path, requestPost({ duration, reason, strategy }));
      else await api(path, { method: "DELETE", body: JSON.stringify({ reason }) });
      onDone(action === "mute" ? (penalty ? "禁言已调整，对方已收到通知。" : "已禁言，对方已收到通知。") : "禁言已解除，对方已收到通知。");
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
      setConfirm("");
    }
  }
  const noun = kind === "user" ? "用户" : "版块";
  return (
    <Modal title={(penalty ? "调整禁言 · " : "禁言 · ") + name} motionKey={`mute-${kind}-${id}`} className="confirm-modal admin-confirm-modal moderation-modal gov-modal" onClose={() => !busy && onClose()}>
      {kind === "user" ? <Identity person={person || null} size={52} /> : <BoardIdentity name={name} icon={icon} lead={lead} />}
      {penalty && (
        <section className="moderation-sheet gov-sheet">
          <Lines
            rows={[
              ["当前处罚", <Chip tone="danger">{muteLabel(penalty.until)}</Chip>],
              ["开始时间", dateTimeText(penalty.starts_at)],
              ["结束时间", penalty.until ? dateTimeText(penalty.until) : "永久"],
              ["原因", penalty.reason],
            ]}
          />
        </section>
      )}
      <div className="gov-section-title">{penalty ? "新的期限" : "禁言期限"}</div>
      <DurationPicker value={duration} onChange={setDuration} existing={penalty} strategy={strategy} onStrategy={setStrategy} />
      <Field label={penalty ? "调整原因" : "禁言原因"}>
        <AutoTextarea value={reason} onValue={setReason} maxLength={200} minRows={1} placeholder="随通知发送给对方" />
      </Field>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className={`confirm-actions gov-actions-row ${penalty && canUnmute ? "is-three" : ""}`}>
        <LiquidButton type="button" className="button secondary admin-action" disabled={busy} onClick={onClose}>
          取消
        </LiquidButton>
        {penalty && canUnmute && (
          <LiquidButton type="button" className="button admin-action" disabled={busy} onClick={() => setConfirm("unmute")}>
            <Mic size={14} />
            解除禁言
          </LiquidButton>
        )}
        <Submit busy={busy && confirm === ""} danger disabled={!durationReady(duration)} onClick={() => setConfirm("mute")}>
          <MicOff size={14} />
          {penalty ? "确认调整" : "确认禁言"}
        </Submit>
      </div>
      {confirm && (
        <DangerConfirm
          title={confirm === "mute" ? "确认禁言" : "解除禁言"}
          heading={confirm === "mute" ? `${penalty ? "调整" : "禁言"}${noun}「${name}」？` : `解除「${name}」的禁言？`}
          description={
            confirm === "mute"
              ? `${end ? "截止 " + dateTimeText(end) : "永久禁言"}。${kind === "user" ? "期间无法发帖、评论、回复或私信。" : "期间版块内无法发布新内容。"}`
              : "解除后立即恢复正常，并通知对方。"
          }
          confirmLabel={confirm === "mute" ? "确认" : "解除禁言"}
          busy={busy}
          onConfirm={() => run(confirm)}
          onClose={() => setConfirm("")}
        />
      )}
    </Modal>
  );
}

export function PostLockDialog({
  id,
  title,
  author,
  board,
  locked,
  lockReason,
  canUnlock,
  onClose,
  onDone,
}: {
  id: string;
  title: string;
  author: PersonCard | null;
  board: { id: string; name: string; icon: string } | null;
  locked: boolean;
  lockReason: string;
  canUnlock: boolean;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [reason, setReason] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [confirm, setConfirm] = useState<"" | "lock" | "unlock">("");
  async function run(action: "lock" | "unlock") {
    setBusy(true);
    setError("");
    try {
      await api(`/admin/posts/${encodeURIComponent(id)}/lock`, {
        method: "PATCH",
        body: JSON.stringify({ locked: action === "lock", reason }),
      });
      onDone(action === "lock" ? "帖子已禁言，作者已收到通知。" : "禁言已解除，作者已收到通知。");
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
      setConfirm("");
    }
  }
  const Icon = boardIcon(board?.icon);
  return (
    <Modal
      title={(locked ? "解除帖子禁言 · " : "禁言帖子 · ") + title}
      motionKey={`lock-post-${id}`}
      className="confirm-modal admin-confirm-modal moderation-modal gov-modal"
      onClose={() => !busy && onClose()}
    >
      <div className="moderation-person gov-identity">
        <span className="gov-glyph is-board">
          <Icon size={24} strokeWidth={1.5} />
        </span>
        <div>
          <strong>{title}</strong>
          {author ? (
            <span className="gov-lead">
              <Avatar name={author.name} initials={author.initials} avatar={author.avatar} size={22} userId={author.id} />
              {author.name}
              {board && <small>{board.name}</small>}
            </span>
          ) : (
            <small>{board ? board.name : "已注销作者"}</small>
          )}
        </div>
      </div>
      {locked && (
        <section className="moderation-sheet gov-sheet">
          <Lines
            rows={[
              ["当前状态", <Chip tone="danger">已禁言</Chip>],
              ["原因", lockReason],
            ]}
          />
        </section>
      )}
      <Field label={locked ? "解除原因" : "禁言原因"} hint="随通知发送给作者">
        <AutoTextarea value={reason} onValue={setReason} maxLength={200} minRows={1} placeholder="最多 200 字" />
      </Field>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="confirm-actions gov-actions-row">
        <LiquidButton type="button" className="button secondary admin-action" disabled={busy} onClick={onClose}>
          取消
        </LiquidButton>
        {locked ? (
          <Submit busy={busy} disabled={!canUnlock} onClick={() => setConfirm("unlock")}>
            <Mic size={14} />
            解除禁言
          </Submit>
        ) : (
          <Submit busy={busy} danger onClick={() => setConfirm("lock")}>
            <MicOff size={14} />
            确认禁言
          </Submit>
        )}
      </div>
      {confirm && (
        <DangerConfirm
          title={confirm === "lock" ? "确认禁言" : "解除禁言"}
          heading={confirm === "lock" ? `禁言帖子「${title}」？` : `解除「${title}」的禁言？`}
          description={
            confirm === "lock"
              ? "这篇讨论暂停接收新评论，已有内容保持不变；作者在其他讨论下的发言不受影响。"
              : "解除后可以继续评论，并通知作者。"
          }
          confirmLabel={confirm === "lock" ? "确认禁言" : "解除禁言"}
          busy={busy}
          onConfirm={() => run(confirm)}
          onClose={() => setConfirm("")}
        />
      )}
    </Modal>
  );
}

function DeleteRequestDialog({
  type,
  id,
  label,
  caseId,
  onClose,
  onDone,
}: {
  type: TargetType;
  id: string;
  label: string;
  caseId?: string;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [reason, setReason] = useState(""),
    [detail, setDetail] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [pending, setPending] = useState(false);
  async function send() {
    setBusy(true);
    setError("");
    try {
      await api("/admin/delete-requests", requestPost({ target_type: type, target_id: id, reason, detail, case_id: caseId }));
      onDone("删除申请已提交，站主处理后会通知你。");
    } catch (e) {
      const err = e as ApiError;
      if (err.code === "request_pending") setPending(true);
      else setError(err.message);
      setBusy(false);
    }
  }
  return (
    <Modal title="申请删除" motionKey={`delete-request-${type}-${id}`} className="confirm-modal admin-confirm-modal moderation-modal gov-modal" onClose={() => !busy && onClose()}>
      <div className="confirm-body">
        <span className="confirm-icon is-danger">
          <ShieldAlert size={22} strokeWidth={1.6} />
        </span>
        <h2>无此权限，请向站主申请</h2>
        <p>
          申请删除{targetNouns[type]}：<strong>{label}</strong>
        </p>
      </div>
      {pending ? (
        <>
          <p className="gov-state">
            <Clock3 size={15} />
            删除申请正在处理中
          </p>
          <div className="confirm-actions gov-actions-row is-single">
            <LiquidButton type="button" className="button admin-action admin-action-primary" onClick={onClose}>
              知道了
            </LiquidButton>
          </div>
        </>
      ) : (
        <>
          <Field label="申请理由" hint={<>{Array.from(reason.trim()).length} / 200</>}>
            <AutoTextarea value={reason} onValue={setReason} maxLength={200} minRows={1} placeholder="必填" />
          </Field>
          <Field label="补充说明">
            <AutoTextarea value={detail} onValue={setDetail} maxLength={2000} minRows={3} placeholder="可选" />
          </Field>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <Actions busy={busy} onCancel={onClose}>
            <Submit busy={busy} danger disabled={Array.from(reason.trim()).length < 2} onClick={send}>
              提交申请
            </Submit>
          </Actions>
        </>
      )}
    </Modal>
  );
}

const choiceIcon: Record<string, typeof Ban> = { mute: MicOff, mute_board: MicOff, delete: Trash2, dismiss: Undo2 };
const SnapshotView = ({ type, snap, state }: { type: TargetType; snap: Snapshot | null; state?: string }) => {
  if (!snap)
    return (
      <p className="gov-state is-danger">
        <Trash2 size={15} />
        {state || "原内容已删除"}
      </p>
    );
  if (type === "user")
    return (
      <Lines
        rows={[
          ["昵称", snap.name],
          ["用户 ID", snap.name],
          ["签名", snap.bio],
        ]}
      />
    );
  if (type === "board")
    return (
      <>
        <Lines
          rows={[
            ["版块名称", snap.name],
            ["版主", snap.lead ? `${snap.lead.name}（ID ${snap.lead.name}）` : "站主代管"],
          ]}
        />
        <FoldText text={snap.description || ""} lines={3} />
      </>
    );
  return (
    <>
      {type === "post" && <h3 className="gov-snap-title">{snap.title}</h3>}
      <Lines
        rows={[
          ["作者", snap.author ? `${snap.author.name}（ID ${snap.author.name}）` : ""],
          ["版块", snap.board?.name],
          ["所在帖子", type === "comment" ? snap.post?.title : ""],
          ["回复对象", snap.reply_to?.name],
        ]}
      />
      <FoldText text={snap.content || ""} lines={5} />
    </>
  );
};
function CaseDialog({
  caseId,
  preset,
  isOwner,
  onClose,
  onDone,
  onInspect,
}: {
  caseId: string;
  preset?: string;
  isOwner: boolean;
  onClose: () => void;
  onDone: (message: string) => void;
  onInspect?: (postId: string) => void;
}) {
  const [data, setData] = useState<CaseDetail | null>(null),
    [error, setError] = useState(""),
    [view, setView] = useState<"snapshot" | "current">("snapshot"),
    [choice, setChoice] = useState(""),
    [duration, setDuration] = useState<Duration>({ mode: "days", days: 7 }),
    [strategy, setStrategy] = useState<Strategy>("extend"),
    [note, setNote] = useState(""),
    [reason, setReason] = useState(""),
    [detail, setDetail] = useState(""),
    [busy, setBusy] = useState(false),
    [confirm, setConfirm] = useState(false),
    [handledBy, setHandledBy] = useState("");
  const load = () =>
    api<{ case: CaseDetail }>("/admin/complaints/" + encodeURIComponent(caseId))
      .then((r) => {
        setData(r.case);
        const ids = r.case.actions.map((a) => a.id);
        setChoice((current) => (ids.includes(current) ? current : preset && ids.includes(preset) ? preset : ids[0] || ""));
        if (!r.case.penalty?.until) setStrategy("replace");
      })
      .catch((e) => setError((e as Error).message));
  useEffect(() => {
    load();
  }, [caseId]);
  const action = data?.actions.find((a) => a.id === choice);
  const muting = choice === "mute" || choice === "mute_board";
  const requesting = action?.mode === "request";
  const danger = choice !== "dismiss";
  const ready = !!action && (!muting || durationReady(duration)) && (!requesting || Array.from(reason.trim()).length >= 2);
  async function submit() {
    if (!data || !action) return;
    setBusy(true);
    setError("");
    try {
      const r = await api(
        `/admin/complaints/${encodeURIComponent(data.id)}/resolve`,
        requestPost({ action: action.id, note, duration: muting ? duration : undefined, strategy, reason, detail }),
      );
      onDone(
        r.requested
          ? "删除申请已提交，站主处理后会通知你。"
          : {
              dismiss: "投诉已驳回，投诉人会收到结果。",
              mute: "已禁言，被投诉者与投诉人都已收到通知。",
              mute_board: "版块已禁言，版主与投诉人都已收到通知。",
              delete: "内容已删除，作者与投诉人都已收到通知。",
            }[action.id] || "已处理。",
      );
    } catch (e) {
      const err = e as ApiError;
      setConfirm(false);
      setBusy(false);
      if (err.code === "already_handled" && err.data?.case) {
        setData(err.data.case);
        setHandledBy(err.message);
      } else setError(err.message);
    }
  }
  const title = data ? `投诉处理 · ${targetNouns[data.target_type]}` : "投诉处理";
  const pendingRequest = data?.request && data.request.status === "pending" ? data.request : null;
  return (
    <Modal title={title} motionKey={"case-" + caseId} wide className="confirm-modal admin-confirm-modal moderation-modal gov-modal gov-case-modal" onClose={() => !busy && onClose()}>
      {!data ? (
        error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : (
          <Loading />
        )
      ) : (
        <>
          <div className="gov-case-head">
            {data.target_type === "board" ? (
              <BoardIdentity name={data.title} icon={data.icon} lead={data.subject} />
            ) : data.target_type === "user" ? (
              <Identity
                person={data.subject}
                size={52}
                extra={data.penalty && <span className="mute-chip is-static"><MicOff size={11} />{muteLabel(data.penalty.until)}</span>}
              />
            ) : (
              <div className="gov-case-target">
                <span className="gov-kicker">{data.target_type === "post" ? "帖子" : data.reply ? "回复" : "评论"}</span>
                <LiquidButton
                  type="button"
                  className="admin-post-main gov-target-link"
                  disabled={data.deleted || !data.post_id || !onInspect}
                  onClick={() => data.post_id && onInspect?.(data.post_id)}
                >
                  <strong>{data.target_type === "post" ? data.title : `「${data.title}」下的${data.reply ? "回复" : "评论"}`}</strong>
                  {!data.deleted && <ArrowUpRight size={14} />}
                </LiquidButton>
                <Identity
                  person={data.subject}
                  size={30}
                  extra={data.penalty && <span className="mute-chip is-static"><MicOff size={11} />{muteLabel(data.penalty.until)}</span>}
                />
              </div>
            )}
            <div className="gov-chips">
              <Chip tone={data.status === "pending" ? "wait" : data.status === "dismissed" ? "" : "ok"}>{caseStatusLabel[data.status]}</Chip>
              <Chip>{data.count} 条投诉</Chip>
              {data.deleted && <Chip tone="danger">原内容已删除</Chip>}
              {pendingRequest && <Chip tone="wait">待站主审批删除</Chip>}
            </div>
          </div>

          <section className="moderation-sheet gov-sheet">
            <header>
              <GlassSegments
                className="is-compact"
                label="查看内容"
                value={view}
                onChange={setView}
                items={[
                  { id: "snapshot", label: "投诉时内容" },
                  { id: "current", label: "当前内容" },
                ]}
              />
              <small>{view === "snapshot" ? dateTimeText(data.snapshot.captured_at || data.opened_at) : data.current_state}</small>
            </header>
            <SnapshotView
              type={data.target_type}
              snap={view === "snapshot" ? data.snapshot : data.current}
              state={data.current_state}
            />
          </section>

          <div className="gov-section-title">投诉记录</div>
          <ul className="gov-complaints">
            {data.complaints.map((c) => (
              <li key={c.id}>
                <div className="gov-complaint-head">
                  <Chip tone="danger">{c.label}</Chip>
                  {c.reporter ? (
                    <span className="gov-reporter">
                      <Avatar name={c.reporter.name} initials={c.reporter.initials} avatar={c.reporter.avatar} size={22} userId={c.reporter.id || undefined} />
                      {c.reporter.name}
                    </span>
                  ) : (
                    <span className="gov-reporter is-hidden">投诉人已保密</span>
                  )}
                  <time>{timeAgo(c.created_at)}</time>
                </div>
                <FoldText text={c.detail} lines={2} />
              </li>
            ))}
          </ul>

          {data.status !== "pending" ? (
            <section className="moderation-sheet gov-sheet gov-result">
              {handledBy && (
                <p className="gov-state is-danger">
                  <ShieldCheck size={15} />
                  {handledBy}
                </p>
              )}
              <Lines
                rows={[
                  ["结果", <Chip tone={data.status === "dismissed" ? "" : "ok"}>{caseActionLabel[data.action] || caseStatusLabel[data.status]}</Chip>],
                  ["处理人", data.resolver ? `${data.resolver.name}（${roleNames[data.resolver.role || ""] || "管理员"}）` : ""],
                  ["处理时间", data.resolved_at ? dateTimeText(data.resolved_at) : ""],
                  ["说明", data.note],
                ]}
              />
            </section>
          ) : pendingRequest && !isOwner ? (
            <p className="gov-state">
              <Clock3 size={15} />
              删除申请正在处理中
            </p>
          ) : !data.can_handle ? (
            <p className="gov-state is-danger">
              <ShieldAlert size={15} />
              {data.conflict || "你无权处理这条投诉"}
            </p>
          ) : (
            <>
              <div className="gov-section-title">处理方式</div>
              <GlassSegments<string>
                className="gov-choice-segs"
                label="处理方式"
                value={choice}
                onChange={setChoice}
                items={data.actions.map((a) => {
                  const Icon = choiceIcon[a.id] || Gavel;
                  return {
                    id: a.id,
                    label: a.label,
                    icon: <Icon size={16} />,
                    danger: a.danger,
                    extra: a.mode === "request" ? <small>需站主审批</small> : undefined,
                  };
                })}
              />
              {muting && (
                <>
                  <div className="gov-section-title">禁言期限</div>
                  <DurationPicker
                    value={duration}
                    onChange={setDuration}
                    existing={data.penalty}
                    strategy={strategy}
                    onStrategy={setStrategy}
                  />
                </>
              )}
              {requesting ? (
                <>
                  <p className="gov-state is-danger">
                    <ShieldAlert size={15} />
                    无此权限，请向站主申请
                  </p>
                  <Field label="申请理由" hint={<>{Array.from(reason.trim()).length} / 200</>}>
                    <AutoTextarea value={reason} onValue={setReason} maxLength={200} minRows={1} placeholder="必填" />
                  </Field>
                  <Field label="补充说明">
                    <AutoTextarea value={detail} onValue={setDetail} maxLength={2000} minRows={1} placeholder="可选" />
                  </Field>
                </>
              ) : (
                <Field label={choice === "dismiss" ? "驳回说明" : "处理原因"}>
                  <AutoTextarea value={note} onValue={setNote} maxLength={500} minRows={1} placeholder="随结果通知相关人员" />
                </Field>
              )}
              {error && (
                <p className="form-error" role="alert">
                  {error}
                </p>
              )}
              <Actions busy={busy} onCancel={onClose}>
                <Submit busy={busy && !confirm} danger={danger} disabled={!ready} onClick={() => (danger && !requesting ? setConfirm(true) : submit())}>
                  {requesting ? "提交删除申请" : "确认" + (action?.label || "")}
                </Submit>
              </Actions>
            </>
          )}
          {data.status !== "pending" || !data.can_handle || (pendingRequest && !isOwner) ? (
            <div className="confirm-actions gov-actions-row is-single">
              <LiquidButton type="button" className="button admin-action admin-action-primary" onClick={onClose}>
                关闭
              </LiquidButton>
            </div>
          ) : null}
          {confirm && action && (
            <DangerConfirm
              title={"确认" + action.label}
              heading={`${action.label}？`}
              description={
                muting
                  ? `${(() => {
                      const end = previewEnd(duration, data.penalty, strategy);
                      return end ? "截止 " + dateTimeText(end) : "永久禁言";
                    })()}。相关人员会立即收到通知。`
                  : "删除后前台不再显示，站主可以在回收站恢复。相关人员会立即收到通知。"
              }
              confirmLabel={action.label}
              busy={busy}
              onConfirm={submit}
              onClose={() => setConfirm(false)}
            />
          )}
        </>
      )}
    </Modal>
  );
}

function AppealReview({ appealId, onClose, onDone }: { appealId: string; onClose: () => void; onDone: (message: string) => void }) {
  const [data, setData] = useState<AppealDetail | null>(null),
    [error, setError] = useState(""),
    [note, setNote] = useState(""),
    [busy, setBusy] = useState(false),
    [confirm, setConfirm] = useState<"" | "approve" | "reject">("");
  useEffect(() => {
    api<{ appeal: AppealDetail }>("/admin/appeals/" + encodeURIComponent(appealId))
      .then((r) => setData(r.appeal))
      .catch((e) => setError((e as Error).message));
  }, [appealId]);
  async function decide(decision: "approve" | "reject") {
    if (!data) return;
    setBusy(true);
    setError("");
    try {
      await api("/admin/appeals/" + encodeURIComponent(data.id), requestPost({ decision, reason: note }));
      onDone(decision === "approve" ? "已同意申诉，禁言已解除，申请人已收到通知。" : "已驳回申诉，申请人已收到通知。");
    } catch (e) {
      const err = e as ApiError;
      setBusy(false);
      setConfirm("");
      if (err.code === "already_handled" && err.data?.appeal) setData(err.data.appeal);
      else setError(err.message);
    }
  }
  return (
    <Modal title="禁言申诉" motionKey={"appeal-review-" + appealId} className="confirm-modal admin-confirm-modal moderation-modal gov-modal" onClose={() => !busy && onClose()}>
      {!data ? (
        error ? <p className="form-error" role="alert">{error}</p> : <Loading />
      ) : (
        <>
          {data.target_type === "board" ? (
            <>
              <BoardIdentity name={data.target.label} icon={data.target.icon} lead={data.applicant} center />
            </>
          ) : (
            <Identity person={data.applicant} size={64} center />
          )}
          <div className="gov-chips is-centered">
            <Chip tone={data.status === "pending" ? "wait" : data.status === "approved" ? "ok" : ""}>{data.status_label}</Chip>
            <Chip>{data.target_type === "board" ? "版块禁言申诉" : "用户禁言申诉"}</Chip>
          </div>
          <section className="moderation-sheet gov-sheet">
            <Lines
              rows={[
                ["原处罚", data.penalty ? <Chip tone="danger">{muteLabel(data.penalty.until)}</Chip> : "已结束"],
                ["处罚原因", data.penalty?.reason || "未填写"],
                ["禁言期限", data.penalty ? `${dateTimeText(data.penalty.starts_at)} — ${data.penalty.until ? dateTimeText(data.penalty.until) : "永久"}` : ""],
                ["提交时间", dateTimeText(data.created_at)],
              ]}
            />
            <h3>申诉理由</h3>
            <FoldText text={data.reason} lines={4} />
          </section>
          {data.can_decide ? (
            <>
              <Field label="处理说明">
                <AutoTextarea value={note} onValue={setNote} maxLength={500} minRows={1} placeholder="驳回时会一并告知申请人" />
              </Field>
              {error && <p className="form-error" role="alert">{error}</p>}
              <div className="confirm-actions gov-actions-row">
                <LiquidButton type="button" className="button admin-action admin-action-danger" disabled={busy} onClick={() => setConfirm("reject")}>
                  驳回
                </LiquidButton>
                <LiquidButton type="button" className="button admin-action admin-action-primary" disabled={busy} onClick={() => setConfirm("approve")}>
                  <Check size={14} />
                  同意
                </LiquidButton>
              </div>
            </>
          ) : (
            <>
              <section className="moderation-sheet gov-sheet gov-result">
                <p className="gov-state">
                  <ShieldCheck size={15} />
                  {data.status === "pending" ? "等待站主处理" : "该申请已处理"}
                </p>
                <Lines
                  rows={[
                    ["结果", data.status_label],
                    ["处理人", data.resolver?.name],
                    ["处理时间", data.resolved_at ? dateTimeText(data.resolved_at) : ""],
                    ["说明", data.resolve_note],
                  ]}
                />
              </section>
              <div className="confirm-actions gov-actions-row is-single">
                <LiquidButton type="button" className="button admin-action admin-action-primary" onClick={onClose}>
                  关闭
                </LiquidButton>
              </div>
            </>
          )}
          {confirm && (
            <DangerConfirm
              title={confirm === "approve" ? "同意申诉" : "驳回申诉"}
              heading={confirm === "approve" ? "同意并解除禁言？" : "驳回这份申诉？"}
              description={confirm === "approve" ? "禁言立即解除，申请人会收到通知。" : "原处罚保持不变，申请人 24 小时后可再次申诉。"}
              confirmLabel={confirm === "approve" ? "同意" : "驳回"}
              busy={busy}
              onConfirm={() => decide(confirm)}
              onClose={() => setConfirm("")}
            />
          )}
        </>
      )}
    </Modal>
  );
}

function RequestReview({ requestId, onClose, onDone }: { requestId: string; onClose: () => void; onDone: (message: string) => void }) {
  const [data, setData] = useState<RequestDetail | null>(null),
    [error, setError] = useState(""),
    [note, setNote] = useState(""),
    [busy, setBusy] = useState(false),
    [confirm, setConfirm] = useState<"" | "approve" | "reject">("");
  useEffect(() => {
    api<{ request: RequestDetail }>("/admin/delete-requests/" + encodeURIComponent(requestId))
      .then((r) => setData(r.request))
      .catch((e) => setError((e as Error).message));
  }, [requestId]);
  async function decide(decision: "approve" | "reject") {
    if (!data) return;
    setBusy(true);
    setError("");
    try {
      await api("/admin/delete-requests/" + encodeURIComponent(data.id), requestPost({ decision, reason: note }));
      onDone(decision === "approve" ? "已批准，并只删除了这一个对象；管理员与内容所有者都已收到通知。" : "已驳回删除申请，管理员已收到通知。");
    } catch (e) {
      const err = e as ApiError;
      setBusy(false);
      setConfirm("");
      if (err.code === "already_handled" && err.data?.request) setData(err.data.request);
      else setError(err.message);
    }
  }
  const snapType = data?.target_type || "post";
  return (
    <Modal title="删除申请" motionKey={"request-review-" + requestId} className="confirm-modal admin-confirm-modal moderation-modal gov-modal" onClose={() => !busy && onClose()}>
      {!data ? (
        error ? <p className="form-error" role="alert">{error}</p> : <Loading />
      ) : (
        <>
          <Identity person={data.requester} size={64} center extra={<span className="gov-chip">管理员</span>} />
          <div className="gov-chips is-centered">
            <Chip tone={data.status === "pending" ? "wait" : data.status === "approved" ? "ok" : ""}>{data.status_label}</Chip>
            <Chip tone={data.target_state === "正常" ? "" : "danger"}>对象{data.target_state}</Chip>
          </div>
          <section className="moderation-sheet gov-sheet">
            <Lines
              rows={[
                ["申请删除", `${targetNouns[data.target_type]} · ${data.target_label}`],
                ["提交时间", dateTimeText(data.created_at)],
                ["来自投诉", data.case_id ? "是" : ""],
              ]}
            />
            <h3>申请理由</h3>
            <FoldText text={data.reason} lines={3} />
            {data.detail && (
              <>
                <h3>补充说明</h3>
                <FoldText text={data.detail} lines={3} />
              </>
            )}
          </section>
          <section className="moderation-sheet gov-sheet">
            <header>
              <span className="role-pill">申请时内容</span>
              {data.snapshot.captured_at && <small>{dateTimeText(data.snapshot.captured_at)}</small>}
            </header>
            <SnapshotView type={snapType} snap={data.snapshot} />
          </section>
          {data.can_decide ? (
            <>
              <Field label="审批说明">
                <AutoTextarea value={note} onValue={setNote} maxLength={500} minRows={1} placeholder="随结果通知管理员" />
              </Field>
              {error && <p className="form-error" role="alert">{error}</p>}
              <div className="confirm-actions gov-actions-row">
                <LiquidButton type="button" className="button admin-action" disabled={busy} onClick={() => setConfirm("reject")}>
                  <Undo2 size={14} />
                  驳回
                </LiquidButton>
                <LiquidButton type="button" className="button admin-action admin-action-danger" disabled={busy} onClick={() => setConfirm("approve")}>
                  <Trash2 size={14} />
                  同意并删除
                </LiquidButton>
              </div>
            </>
          ) : (
            <>
              <section className="moderation-sheet gov-sheet gov-result">
                <p className="gov-state">
                  <ShieldCheck size={15} />
                  该申请已处理
                </p>
                <Lines
                  rows={[
                    ["结果", data.status_label],
                    ["处理人", data.resolver?.name],
                    ["处理时间", data.resolved_at ? dateTimeText(data.resolved_at) : ""],
                    ["说明", data.resolve_note],
                  ]}
                />
              </section>
              <div className="confirm-actions gov-actions-row is-single">
                <LiquidButton type="button" className="button admin-action admin-action-primary" onClick={onClose}>
                  关闭
                </LiquidButton>
              </div>
            </>
          )}
          {confirm && (
            <DangerConfirm
              title={confirm === "approve" ? "同意删除" : "驳回申请"}
              heading={confirm === "approve" ? `删除${targetNouns[data.target_type]}「${data.target_label}」？` : "驳回这份删除申请？"}
              description={confirm === "approve" ? "只执行这一次删除，不会给管理员增加权限；内容可在回收站恢复。" : "对象保持不变，管理员会收到通知。"}
              confirmLabel={confirm === "approve" ? "同意并删除" : "驳回"}
              busy={busy}
              onConfirm={() => decide(confirm)}
              onClose={() => setConfirm("")}
            />
          )}
        </>
      )}
    </Modal>
  );
}

type Entry = { key: number; ref: GovernanceRef };
export function GovernanceHost({
  isOwner,
  notify,
  onChanged,
  onInspect,
}: {
  isOwner: boolean;
  notify: (message: string, tone?: "success" | "error") => void;
  onChanged: () => void;
  onInspect: (postId: string) => void;
}) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const counter = useRef(0);
  useEffect(() => {
    setGovernanceNav((ref) => setEntries((list) => [...list, { key: ++counter.current, ref }]));
    return () => setGovernanceNav(null);
  }, []);
  const close = (key: number) => setEntries((list) => list.filter((e) => e.key !== key));
  const done = (key: number, after?: () => void) => (message: string, tone: "success" | "error" = "success") => {
    close(key);
    notify(message, tone);
    onChanged();
    after?.();
  };
  return (
    <>
      {entries.map(({ key, ref }) => {
        switch (ref.kind) {
          case "case":
            return (
              <CaseDialog
                key={key}
                caseId={ref.id}
                preset={ref.preset}
                isOwner={isOwner}
                onClose={() => close(key)}
                onDone={done(key)}
                onInspect={(id) => {
                  close(key);
                  onInspect(id);
                }}
              />
            );
          case "appeal":
            return <AppealReview key={key} appealId={ref.id} onClose={() => close(key)} onDone={done(key)} />;
          case "request":
            return <RequestReview key={key} requestId={ref.id} onClose={() => close(key)} onDone={done(key)} />;
          case "report":
            return (
              <ComplaintDialog
                key={key}
                type={ref.type}
                id={ref.id}
                label={ref.label}
                excerpt={ref.excerpt}
                onClose={() => close(key)}
                onDone={(message, tone) => {
                  close(key);
                  notify(message, tone);
                }}
              />
            );
          case "request-delete":
            return (
              <DeleteRequestDialog
                key={key}
                type={ref.type}
                id={ref.id}
                label={ref.label}
                caseId={ref.caseId}
                onClose={() => close(key)}
                onDone={done(key, ref.onDone)}
              />
            );
        }
      })}
    </>
  );
}
