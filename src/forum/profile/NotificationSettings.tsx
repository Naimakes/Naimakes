import { useEffect, useState } from "react";
import { Lock } from "lucide-react";
import { LiquidSwitch } from "../ui/LiquidSwitch";
import { SubscribeBell } from "../boards/SubscribeBell";
import Avatar from "../ui/Avatar";
import { boardIcon } from "../boards/Boards";
import { api, type NotificationOption, type Subscriptions } from "../api";
import "./profile.css";

function AuthorGlyph() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" focusable="false">
      <circle cx="10" cy="6" r="3.6" />
      <path d="M10 11.1c-3.5 0-6.3 2-6.3 4.7 0 .9.7 1.4 1.7 1.4h9.2c1 0 1.7-.5 1.7-1.4 0-2.7-2.8-4.7-6.3-4.7Z" />
    </svg>
  );
}

function BoardGlyph() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" focusable="false">
      <rect x="2.4" y="2.4" width="6.4" height="6.4" rx="1.9" />
      <rect x="11.2" y="2.4" width="6.4" height="6.4" rx="1.9" />
      <rect x="2.4" y="11.2" width="6.4" height="6.4" rx="1.9" />
      <rect x="11.2" y="11.2" width="6.4" height="6.4" rx="1.9" />
    </svg>
  );
}

type SubscribedPerson = { id: string; name: string; initials: string; avatar: string; bio: string };
type SubscribedBoard = { id: string; name: string; en: string; icon: string };

export default function NotificationSettings({
  subscriptions,
  onSubscribe,
  onOpenBoard,
  notify,
}: {
  subscriptions: Subscriptions;
  onSubscribe: (kind: "author" | "board", id: string) => void;
  onOpenBoard: (id: string) => void;
  notify: (message: string, tone?: "success" | "error" | "info") => void;
}) {
  const [options, setOptions] = useState<NotificationOption[]>([]),
    [settings, setSettings] = useState<Record<string, boolean>>({}),
    [saving, setSaving] = useState(""),
    [people, setPeople] = useState<SubscribedPerson[]>([]),
    [boards, setBoards] = useState<SubscribedBoard[]>([]);
  useEffect(() => {
    let active = true;
    api("/me/notification-settings")
      .then((r) => {
        if (!active) return;
        setOptions(r.options);
        setSettings(r.settings);
      })
      .catch((e) => active && notify((e as Error).message, "error"));
    api("/subscriptions")
      .then((r) => {
        if (!active) return;
        setPeople(r.people);
        setBoards(r.categories);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  async function toggle(option: NotificationOption) {
    if (option.locked) return;
    const previous = settings;
    const next = !settings[option.id];
    setSettings({ ...settings, [option.id]: next });
    setSaving(option.id);
    try {
      const r = await api("/me/notification-settings", {
        method: "PATCH",
        body: JSON.stringify({ settings: { [option.id]: next } }),
      });
      setSettings(r.settings);
    } catch (e) {
      setSettings(previous);
      notify((e as Error).message, "error");
    } finally {
      setSaving("");
    }
  }

  return (
    <>
      <section className="profile-card">
        <div className="profile-card-head">
          <h2>通知设置</h2>
          <p className="profile-card-note">
            弹窗只是即时提醒，所有正式通知都会保存在消息中心。
          </p>
        </div>
        <div className="profile-grid" data-liquid-switch-group="notifications">
          {options.map((option) => (
            <div className={`profile-setting ${option.locked ? "is-locked" : ""}`} key={option.id}>
              <span>
                <strong>
                  {option.label}
                  {option.locked && (
                    <span className="notify-lock">
                      <Lock size={11} />
                      无法关闭
                    </span>
                  )}
                </strong>
                <small>{option.hint}</small>
              </span>
              <LiquidSwitch
                checked={option.locked ? true : settings[option.id] !== false}
                label={option.label}
                disabled={option.locked || saving === option.id}
                onChange={() => toggle(option)}
              />
            </div>
          ))}
        </div>
      </section>
      <section className="profile-card">
        <div className="profile-card-head">
          <h2>新帖提醒订阅</h2>
        </div>
        <div className="notify-subscriptions">
          <div className="notify-subscription-card">
            <div className="notify-subscription-head">
              <span className="notify-subscription-glyph">
                <AuthorGlyph />
              </span>
              <h3>作者</h3>
              <span className="notify-subscription-count">
                {people.filter((p) => subscriptions.authors.includes(p.id)).length}
              </span>
            </div>
            {people.length ? (
              <ul className="notify-subscription-list">
                {people.map((person) => (
                  <li key={person.id}>
                    <Avatar name={person.name} initials={person.initials} avatar={person.avatar} userId={person.id} />
                    <span className="notify-subscription-name">
                      <strong>{person.name}</strong>
                      <small>{person.bio || "这位成员还没有留下简介。"}</small>
                    </span>
                    <SubscribeBell
                      subscribed={subscriptions.authors.includes(person.id)}
                      label={person.name}
                      className="is-compact"
                      size={15}
                      onToggle={() => onSubscribe("author", person.id)}
                    />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="profile-empty">还没有订阅任何作者的新帖提醒。</p>
            )}
          </div>
          <div className="notify-subscription-card">
            <div className="notify-subscription-head">
              <span className="notify-subscription-glyph">
                <BoardGlyph />
              </span>
              <h3>版块</h3>
              <span className="notify-subscription-count">
                {boards.filter((b) => subscriptions.boards.includes(b.id)).length}
              </span>
            </div>
            {boards.length ? (
              <ul className="notify-subscription-list">
                {boards.map((board) => {
                  const Icon = boardIcon(board.icon);
                  return (
                    <li key={board.id}>
                      <span className="notify-board-icon">
                        <Icon size={15} strokeWidth={1.6} />
                      </span>
                      <button type="button" className="notify-subscription-name" onClick={() => onOpenBoard(board.id)}>
                        <strong>{board.name}</strong>
                        <small>{board.en || "版块"}</small>
                      </button>
                      <SubscribeBell
                        subscribed={subscriptions.boards.includes(board.id)}
                        label={board.name}
                        className="is-compact"
                        size={15}
                        onToggle={() => onSubscribe("board", board.id)}
                      />
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="profile-empty">还没有订阅任何版块的新帖提醒。</p>
            )}
          </div>
        </div>
      </section>
    </>
  );
}
