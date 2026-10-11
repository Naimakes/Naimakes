import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { Bell, Bot, Hash, ListOrdered, LockKeyhole, UserRound, UserCog } from "lucide-react";
import { useMotionPreferences } from "../motion/motion-preferences";

export const settingsSections = [
  { id: "profile", label: "个人资料", Icon: UserRound },
  { id: "assistant", label: "Naimakes", Icon: Bot },
  { id: "notifications", label: "通知", Icon: Bell },
  { id: "privacy", label: "隐私", Icon: LockKeyhole },
  { id: "order", label: "主页排序", Icon: ListOrdered },
  { id: "tags", label: "个人标签", Icon: Hash },
  { id: "account", label: "账户", Icon: UserCog },
] as const;

export function scrollToSection(id: string, smooth = true) {
  const target = document.getElementById("settings-" + id);
  if (!target) return false;
  const nav = document.querySelector(".settings-nav-track");
  const offset = (nav ? nav.getBoundingClientRect().height + parseFloat(getComputedStyle(nav.parentElement!).top || "96") : 150) + 18;
  window.scrollTo({ top: Math.max(0, target.getBoundingClientRect().top + window.scrollY - offset), behavior: smooth ? "smooth" : "auto" });
  return true;
}

export function SettingsNav({ sections = settingsSections.map((s) => s.id) }: { sections?: readonly string[] }) {
  const { reduced } = useMotionPreferences();
  const items = settingsSections.filter((s) => sections.includes(s.id));
  const [active, setActive] = useState<string>(items[0]?.id || "");
  const bar = useRef<HTMLDivElement>(null);
  const locked = useRef(0);

  useEffect(() => {
    let frame = 0;
    const measure = () => {
      frame = 0;
      if (Date.now() < locked.current) return;
      const line = (bar.current?.getBoundingClientRect().bottom || 140) + 48;
      let current = items[0]?.id || "";
      for (const item of items) {
        const node = document.getElementById("settings-" + item.id);
        if (node && node.getBoundingClientRect().top <= line) current = item.id;
      }
      const end = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4;
      if (end) {
        const last = [...items].reverse().find((item) => {
          const rect = document.getElementById("settings-" + item.id)?.getBoundingClientRect();
          return rect && rect.top < window.innerHeight;
        });
        if (last) current = last.id;
      }
      setActive(current);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    measure();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, [items.map((s) => s.id).join()]);

  useEffect(() => {
    const track = bar.current;
    const button = track?.querySelector<HTMLElement>(`[data-section="${active}"]`);
    if (track && button && track.scrollWidth > track.clientWidth)
      track.scrollTo({ left: button.offsetLeft - (track.clientWidth - button.offsetWidth) / 2, behavior: reduced ? "auto" : "smooth" });
  }, [active, reduced]);

  return (
    <nav className="settings-nav" aria-label="设置分区">
      <div className="settings-nav-track" ref={bar}>
        {items.map(({ id, label, Icon }) => (
          <button
            key={id}
            type="button"
            data-section={id}
            className={"settings-nav-item" + (active === id ? " is-active" : "")}
            aria-current={active === id ? "true" : undefined}
            onClick={() => {
              setActive(id);
              locked.current = Date.now() + 900;
              scrollToSection(id, !reduced);
            }}
          >
            {active === id && (
              <motion.span
                layoutId="settings-nav-lens"
                className="settings-nav-lens"
                transition={reduced ? { duration: 0 } : { type: "spring", stiffness: 520, damping: 40 }}
              />
            )}
            <Icon size={15} strokeWidth={1.9} />
            <span>{label}</span>
          </button>
        ))}
      </div>
    </nav>
  );
}
