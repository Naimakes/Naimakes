import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Check, CircleAlert, UserRoundX } from "lucide-react";
import { useMotionPreferences } from "../motion/motion-preferences";
import { api, type ApiError } from "../api";
import Confirm from "../ui/Confirm";
import "./name-field.css";

type NameState = "idle" | "available" | "taken";
type Verdict = { key: string; taken: boolean };
const keyOf = (name: string) => name.trim().toLowerCase();

export const isNameTaken = (error: unknown) => (error as ApiError)?.code === "name_taken";

export function useNameAvailability(name: string, { enabled = true, own = "" } = {}) {
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const key = keyOf(name);
  const eligible = enabled && key.length >= 2 && name.trim().length <= 24 && key !== keyOf(own);
  useEffect(() => {
    if (!eligible || verdict?.key === key) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      api<{ available: boolean }>(`/auth/name-available?name=${encodeURIComponent(name.trim())}`, { signal: controller.signal })
        .then((result) => setVerdict({ key, taken: !result.available }))
        .catch(() => {});
    }, 380);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [eligible, key, name, verdict?.key]);
  const markTaken = useCallback((taken: string) => setVerdict({ key: keyOf(taken), taken: true }), []);
  const state: NameState = eligible && verdict?.key === key ? (verdict.taken ? "taken" : "available") : "idle";
  return { state, markTaken };
}

export function NameStatus({ state, id }: { state: NameState; id?: string }) {
  const { reduced } = useMotionPreferences();
  return (
    <div className="name-status-slot" id={id} role="status" aria-live="polite">
      <AnimatePresence initial={false}>
        {state !== "idle" && (
          <motion.div
            key={state}
            className="name-status-clip"
            initial={reduced ? { opacity: 0 } : { opacity: 0, height: 0, y: -4, filter: "blur(4px)" }}
            animate={{ opacity: 1, height: "auto", y: 0, filter: "blur(0px)" }}
            exit={reduced ? { opacity: 0, transition: { duration: 0.1 } } : { opacity: 0, height: 0, y: -3, filter: "blur(3px)", transition: { duration: 0.18 } }}
            transition={reduced ? { duration: 0.12 } : {
              height: { type: "spring", stiffness: 320, damping: 25, mass: 0.9 },
              y: { type: "spring", stiffness: 380, damping: 26 },
              opacity: { duration: 0.2 },
              filter: { duration: 0.22 },
            }}
          >
            <p className={`name-status is-${state}`}>
              {state === "taken" ? <CircleAlert size={14} strokeWidth={1.9} /> : <Check size={14} strokeWidth={2} />}
              {state === "taken" ? "此用户名已存在，请换一个。" : "这个用户名可以使用。"}
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function refocusField(field: HTMLInputElement | null) {
  if (!field) return;
  let frames = 0;
  const tick = () => {
    if (!field.isConnected || frames++ > 90) return;
    if (document.querySelector('dialog[data-state="closing"]')) return void requestAnimationFrame(tick);
    field.focus();
    field.select();
  };
  requestAnimationFrame(() => requestAnimationFrame(tick));
}

export function NameTakenDialog({ name, context, onClose }: {
  name: string;
  context: "register" | "profile";
  onClose: () => void;
}) {
  return (
    <Confirm
      title="用户名已存在"
      heading="此用户名已存在"
      description={
        context === "register"
          ? `「${name}」已经有人在使用了。换一个新的用户名就能继续；如果这是你的账号，请回到登录。`
          : `「${name}」已经有人在使用了。换一个新的用户名再保存，你现在的用户名不会被改动。`
      }
      confirmLabel="重新起一个"
      cancelLabel={null}
      tone="primary"
      icon={<UserRoundX size={22} strokeWidth={1.6} />}
      onConfirm={onClose}
      onClose={onClose}
    />
  );
}
