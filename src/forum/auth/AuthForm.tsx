import { BrandMark } from "../layout/BrandMark";
import { LiquidButton } from "../motion/LiquidButton";
import { FluidTabs } from "../motion/FluidTabs";
import { useMotionPreferences } from "../motion/motion-preferences";
import { motion } from "motion/react";
import { useId, useRef, useState, type FormEvent } from "react";
import "./auth-form.css";
import {
  ArrowRight,
  LoaderCircle,
  LockKeyhole,
} from "lucide-react";
import { ModalRegistration as Modal } from "../motion/OverlayHost";
import { NameStatus, NameTakenDialog, isNameTaken, refocusField, useNameAvailability } from "../profile/NameField";
import { validationHandled, validationText } from "../ui/ValidationHint";
import {
  api,
  post,
  type User,
} from "../api";
export function AuthForm({
  onClose,
  onSuccess,
  onFeedback,
}: {
  onClose: () => void;
  onSuccess: (u: User, registered: boolean) => void;
  onFeedback?: (message: string, tone: "success" | "error") => void;
}) {
  const [register, setRegister] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [name, setName] = useState(""),
    [takenName, setTakenName] = useState<string | null>(null);
  const { reduced } = useMotionPreferences();
  const authId = useId();
  const nameInput = useRef<HTMLInputElement>(null);
  const availability = useNameAvailability(name, { enabled: register });
  const nameHint = `${authId}-name-status`;
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (register && availability.state === "taken") return setTakenName(name.trim());
    setBusy(true);
    setError("");
    const data = Object.fromEntries(new FormData(e.currentTarget));
    try {
      const r = await api(
        "/auth/" + (register ? "register" : "login"),
        post(data),
      );
      onSuccess(r.user, register);
    } catch (e) {
      if (register && isNameTaken(e)) {
        availability.markTaken(name);
        return setTakenName(name.trim());
      }
      const message = (e as Error).message;
      setError(message);
      onFeedback?.(message, "error");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="NAIMAKES COMMUNITY" onClose={onClose} className="auth-modal">
      <div className="auth-intro">
        <BrandMark />
        <div className="eyebrow">STAY CURIOUS. MAKE WHAT’S NEXT.</div>
        <div className="auth-mode-copy">
          {[false, true].map((mode) => <motion.div key={String(mode)}
            aria-hidden={register !== mode} inert={register !== mode} initial={false}
            animate={{ opacity: register === mode ? 1 : 0, y: register === mode ? 0 : mode ? 5 : -5 }}
            transition={{ duration: reduced ? 0 : .24, ease: [.22, 1, .36, 1] }}>
            <h2>{mode ? "让未来，多一种声音。" : "很高兴，再次相遇。"}</h2>
            <p>{mode ? "加入 Naimakes，与好奇的人一起探索。" : "登录 Naimakes，继续你的探索。"}</p>
          </motion.div>)}
        </div>
      </div>
      <FluidTabs className="segmented auth-segments" active={register ? "register" : "login"} label="账号操作">
        <LiquidButton
          type="button" role="tab" id={`${authId}-login`} aria-selected={!register}
          aria-controls={`${authId}-fields`} tabIndex={!register ? 0 : -1}
          onClick={() => {
            setRegister(false);
            setError("");
          }}
        >
          登录
        </LiquidButton>
        <LiquidButton
          type="button" role="tab" id={`${authId}-register`} aria-selected={register}
          aria-controls={`${authId}-fields`} tabIndex={register ? 0 : -1}
          onClick={() => {
            setRegister(true);
            setError("");
          }}
        >
          创建账号
        </LiquidButton>
      </FluidTabs>
      <div className="auth-panel" role="tabpanel" id={`${authId}-fields`} aria-labelledby={`${authId}-${register ? "register" : "login"}`}>
      <form onSubmit={submit} onInvalidCapture={(event) => {
        event.preventDefault();
        const input = event.target as HTMLInputElement;
        if (input !== event.currentTarget.querySelector(":invalid")) return;
        validationHandled(input);
        const message = validationText(input);
        setError(message); onFeedback?.(message, "error"); input.focus();
      }}>
        <motion.div className="auth-name-reveal" initial={false} aria-hidden={!register} inert={!register}
          animate={{ height: register ? "auto" : 0, opacity: register ? 1 : 0 }}
          transition={reduced ? { duration: 0 } : {
            height: { type: "spring", stiffness: 320, damping: 25, mass: .9 },
            opacity: { duration: .2, delay: register ? .06 : 0 },
          }}>
          <label>
            <span id={`${authId}-name-label`}>你的昵称</span>
            <input
              ref={nameInput}
              aria-labelledby={`${authId}-name-label`}
              name="name"
              autoComplete="nickname"
              minLength={2}
              maxLength={24}
              placeholder="让大家如何称呼你"
              required={register}
              disabled={!register}
              tabIndex={register ? undefined : -1}
              value={name}
              onChange={(event) => setName(event.target.value)}
              aria-describedby={nameHint}
              aria-invalid={availability.state === "taken" || undefined}
            />
            <NameStatus state={availability.state} id={nameHint} />
          </label>
        </motion.div>
        <label>
          {register ? "邮箱地址" : "邮箱 / 用户 ID"}
          <input
            name="email"
            type={register ? "email" : "text"}
            autoComplete={register ? "email" : "username"}
            placeholder={register ? "you@example.com" : "输入邮箱或用户 ID"}
            maxLength={254}
            required
          />
        </label>
        <label>
          密码
          <input
            name="password"
            type="password"
            autoComplete={register ? "new-password" : "current-password"}
            minLength={register ? 8 : 1}
            maxLength={128}
            placeholder={register ? "至少 8 位字符" : "输入你的密码"}
            required
          />
        </label>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <LiquidButton className="button primary full-width" disabled={busy}>
          {busy ? (
            <LoaderCircle className="spin" size={18} />
          ) : (
            <>
              {register ? "创建账号" : "登录"}
              <ArrowRight size={17} />
            </>
          )}
        </LiquidButton>
      </form>
      </div>
      <p className="auth-footer">
        <LockKeyhole size={13} />
        尊重隐私，保持好奇，友善交流。
      </p>
      {takenName !== null && (
        <NameTakenDialog
          name={takenName}
          context="register"
          onClose={() => {
            setTakenName(null);
            refocusField(nameInput.current);
          }}
        />
      )}
    </Modal>
  );
}
