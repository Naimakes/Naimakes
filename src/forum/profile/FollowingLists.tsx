import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowUpRight, Hash, LoaderCircle, RotateCcw, UserRound, Users } from "lucide-react";
import { GlassSegments } from "../ui/GlassSegments";
import { LiquidButton } from "../motion/LiquidButton";
import { useMotionPreferences } from "../motion/motion-preferences";
import { transitions } from "../motion/motion-tokens";
import Avatar from "../ui/Avatar";
import { api } from "../api";
import "./following-lists.css";

type FollowedUser = { id: string; name: string; initials: string; avatar: string; bio: string; since: number };
type FollowedBoard = { id: string; name: string; en: string; description: string; icon: string; since: number; posts: number; followers: number };
type Scope = "users" | "boards";

const followedOn = (time: number) =>
  time
    ? new Date(time).toLocaleDateString("zh-CN", { year: "numeric", month: "long", day: "numeric" })
    : "";

export default function FollowingLists({
  version,
  onOpenProfile,
  onOpenBoard,
  onChange,
  notify,
}: {
  version: number;
  onOpenProfile: (id: string) => void;
  onOpenBoard: (id: string) => void;
  onChange: () => void;
  notify: (message: string) => void;
}) {
  const { reduced } = useMotionPreferences();
  const [scope, setScope] = useState<Scope>("users");
  const [users, setUsers] = useState<FollowedUser[]>([]);
  const [boards, setBoards] = useState<FollowedBoard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    setLoading(true);
    setError("");
    api<{ users: FollowedUser[]; boards: FollowedBoard[] }>("/me/following")
      .then((r) => {
        if (!live) return;
        setUsers(r.users || []);
        setBoards(r.boards || []);
      })
      .catch((e) => live && setError((e as Error).message))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [version, attempt]);

  const unfollow = async (kind: Scope, id: string, label: string) => {
    setBusy(id);
    try {
      await api(kind === "users" ? `/users/${id}/follow` : `/categories/${id}/follow`, { method: "POST" });
      if (kind === "users") setUsers((list) => list.filter((u) => u.id !== id));
      else setBoards((list) => list.filter((b) => b.id !== id));
      notify(`已取消关注${kind === "users" ? "" : "版块"} ${label}`);
      onChange();
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy("");
    }
  };

  const list = scope === "users" ? users : boards;
  const rise = reduced
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } }
    : {
        initial: { opacity: 0, y: 10, filter: "blur(4px)" },
        animate: { opacity: 1, y: 0, filter: "blur(0px)" },
        exit: { opacity: 0, y: -8, filter: "blur(4px)" },
      };

  return (
    <div className="following-page">
      <GlassSegments<Scope>
        className="following-segs"
        label="关注的对象"
        value={scope}
        onChange={setScope}
        items={[
          { id: "users", label: "用户", icon: <Users size={15} />, count: users.length },
          { id: "boards", label: "版块", icon: <Hash size={15} />, count: boards.length },
        ]}
      />
      {error ? (
        <div className="empty-state" role="alert">
          <h3>暂时打不开关注名单</h3>
          <p>{error}</p>
          <LiquidButton className="button secondary" onClick={() => setAttempt((n) => n + 1)}>
            <RotateCcw size={14} />
            重试
          </LiquidButton>
        </div>
      ) : loading ? (
        <div className="following-loading">
          <LoaderCircle className="spin" size={22} />
          正在读取关注名单
        </div>
      ) : (
        <AnimatePresence mode="wait" initial={false}>
          <motion.div key={scope} className="following-list" {...rise} transition={reduced ? { duration: 0 } : transitions.surface}>
            {!list.length ? (
              <div className="empty-state">
                <UserRound size={38} strokeWidth={1.1} />
                <h3>{scope === "users" ? "还没有关注任何人。" : "还没有关注任何版块。"}</h3>
                <p>
                  {scope === "users"
                    ? "在讨论里遇到聊得来的人，点进主页关注，他们的新讨论就会更容易找到。"
                    : "到话题广场关注感兴趣的版块，这里会记下你关注它们的先后。"}
                </p>
              </div>
            ) : scope === "users" ? (
              users.map((u) => (
                <article className="following-row" key={u.id}>
                  <Avatar name={u.name} initials={u.initials} avatar={u.avatar} userId={u.id} />
                  <LiquidButton type="button" className="following-main" onClick={() => onOpenProfile(u.id)}>
                    <strong>
                      {u.name}
                      <ArrowUpRight size={15} />
                    </strong>
                    <small>{u.bio || "这位成员还没有留下简介。"}</small>
                  </LiquidButton>
                  <span className="following-since">{followedOn(u.since) && `${followedOn(u.since)} 关注`}</span>
                  <LiquidButton
                    type="button"
                    className="button secondary following-undo"
                    disabled={busy === u.id}
                    onClick={() => unfollow("users", u.id, u.name)}
                  >
                    取消关注
                  </LiquidButton>
                </article>
              ))
            ) : (
              boards.map((b) => (
                <article className="following-row" key={b.id}>
                  <span className="following-hash" aria-hidden="true">
                    <Hash size={17} />
                  </span>
                  <LiquidButton type="button" className="following-main" onClick={() => onOpenBoard(b.id)}>
                    <strong>
                      {b.name}
                      <ArrowUpRight size={15} />
                    </strong>
                    <small>
                      {b.posts} 个讨论 · {b.followers} 人关注
                    </small>
                  </LiquidButton>
                  <span className="following-since">{followedOn(b.since) && `${followedOn(b.since)} 关注`}</span>
                  <LiquidButton
                    type="button"
                    className="button secondary following-undo"
                    disabled={busy === b.id}
                    onClick={() => unfollow("boards", b.id, b.name)}
                  >
                    取消关注
                  </LiquidButton>
                </article>
              ))
            )}
          </motion.div>
        </AnimatePresence>
      )}
    </div>
  );
}
