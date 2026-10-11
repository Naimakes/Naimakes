import { useEffect, useRef, useState, type FormEvent } from "react";
import { Check, ImagePlus, LoaderCircle, Trash2 } from "lucide-react";
import { LiquidButton } from "../motion/LiquidButton";
import { StatusPill, type StatusState } from "../motion/StatusPill";
import Avatar from "../ui/Avatar";
import AvatarEditor from "../profile/AvatarEditor";
import { NameStatus, NameTakenDialog, isNameTaken, refocusField, useNameAvailability } from "../profile/NameField";
import { api, type User } from "../api";

const imageLimit = 8 * 1024 * 1024;

export default function AccountSettings({
  user,
  banner,
  onUser,
  onEditBanner,
  notify,
}: {
  user: User;
  banner: string;
  onUser: (next: User) => void;
  onEditBanner: () => void;
  notify: (text: string) => void;
}) {
  const [name, setName] = useState(user.name),
    [email, setEmail] = useState(user.email || ""),
    [bio, setBio] = useState(user.bio || ""),
    [picked, setPicked] = useState<File | null>(null),
    [busy, setBusy] = useState<"" | "form" | "avatar">(""),
    [status, setStatus] = useState<StatusState>(null),
    [error, setError] = useState(""),
    [takenName, setTakenName] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  const availability = useNameAvailability(name, { own: user.name });
  const changed = name.trim() !== user.name || email.trim().toLowerCase() !== (user.email || "").toLowerCase() || bio.trim() !== (user.bio || "");

  useEffect(() => {
    setName(user.name);
    setEmail(user.email || "");
    setBio(user.bio || "");
  }, [user.id, user.name, user.email, user.bio]);

  async function patch(next: Partial<User>, kind: "form" | "avatar") {
    setBusy(kind);
    setError("");
    setStatus({ state: "busy", at: Date.now() });
    try {
      const r = await api<{ user: User }>("/me", {
        method: "PATCH",
        body: JSON.stringify({ name: user.name, email: user.email, bio: user.bio, avatar: user.avatar, ...next }),
      });
      onUser(r.user);
      setStatus({ state: "done", at: Date.now() });
      return true;
    } catch (e) {
      setStatus({ state: "error", at: Date.now() });
      if (isNameTaken(e)) {
        availability.markTaken(name);
        setTakenName(name.trim());
      } else setError((e as Error).message);
      return false;
    } finally {
      setBusy("");
    }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (availability.state === "taken") return setTakenName(name.trim());
    if (await patch({ name: name.trim(), email: email.trim(), bio: bio.trim() }, "form")) notify("个人资料已更新");
  }

  return (
    <section className="profile-card settings-section" id="settings-profile" aria-labelledby="settings-profile-title">
      <div className="profile-card-head">
        <h2 id="settings-profile-title">个人资料</h2>
        <StatusPill status={status} labels={{ busy: "保存中", done: "已保存", error: "没能保存" }} />
        <p className="profile-card-note">头像、昵称和签名会展示在你的主页与讨论中，邮箱只用于登录，不会公开。</p>
      </div>

      <div className="settings-avatar-row">
        <Avatar name={user.name} initials={user.initials} avatar={user.avatar} className="settings-avatar" />
        <div className="settings-avatar-text">
          <strong>头像</strong>
          <small>支持 JPG、PNG、GIF、WebP，不超过 8MB，上传后可以裁剪。</small>
          <div className="settings-actions">
            <LiquidButton type="button" className="button secondary" disabled={!!busy} onClick={() => fileInput.current?.click()}>
              {busy === "avatar" ? <LoaderCircle size={15} className="spin" /> : <ImagePlus size={15} />}
              {user.avatar ? "更换头像" : "上传头像"}
            </LiquidButton>
            {user.avatar && (
              <LiquidButton
                type="button"
                className="button secondary"
                disabled={!!busy}
                onClick={async () => {
                  if (await patch({ avatar: "" }, "avatar")) notify("头像已删除，已恢复默认头像");
                }}
              >
                <Trash2 size={14} />
                删除头像
              </LiquidButton>
            )}
          </div>
        </div>
        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (!file) return;
            if (!file.type.startsWith("image/")) return notify("请选择一张图片作为头像。");
            if (file.size > imageLimit) return notify("头像图片不能大于 8MB。");
            setPicked(file);
          }}
        />
      </div>

      <div className="settings-avatar-row settings-banner-row">
        <div className="settings-banner-thumb" style={banner ? { backgroundImage: `url(${banner})` } : undefined} aria-hidden="true" />
        <div className="settings-avatar-text">
          <strong>主页背景图</strong>
          <small>显示在个人主页顶部，可以分别为宽屏和手机设置裁剪区域。</small>
          <div className="settings-actions">
            <LiquidButton type="button" className="button secondary" disabled={!!busy} onClick={onEditBanner}>
              <ImagePlus size={15} />
              {banner ? "更换背景图像" : "上传背景图像"}
            </LiquidButton>
          </div>
        </div>
      </div>

      <form className="settings-form" onSubmit={save}>
        <label>
          <span id="settings-name-label">昵称</span>
          <input
            ref={nameInput}
            aria-labelledby="settings-name-label"
            value={name}
            onChange={(event) => setName(event.target.value)}
            minLength={2}
            maxLength={24}
            required
            aria-describedby="settings-name-status"
            aria-invalid={availability.state === "taken" || undefined}
          />
          <NameStatus state={availability.state} id="settings-name-status" />
        </label>
        <label>
          <span>邮箱</span>
          <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} maxLength={254} required />
        </label>
        <label className="settings-form-wide">
          <span>个性签名</span>
          <textarea value={bio} onChange={(event) => setBio(event.target.value)} maxLength={160} rows={3} placeholder="你正在关注什么，或创造什么？" />
          <small className="settings-counter">{Array.from(bio).length}/160</small>
        </label>
        {error && <p className="form-error settings-form-wide">{error}</p>}
        <div className="settings-form-foot settings-form-wide">
          <LiquidButton type="button" className="button secondary" disabled={!changed || !!busy} onClick={() => { setName(user.name); setEmail(user.email || ""); setBio(user.bio || ""); setError(""); }}>
            撤销修改
          </LiquidButton>
          <LiquidButton type="submit" className="button primary" disabled={!changed || !!busy}>
            {busy === "form" ? <LoaderCircle size={15} className="spin" /> : <Check size={16} />}
            保存修改
          </LiquidButton>
        </div>
      </form>

      {picked && (
        <AvatarEditor
          file={picked}
          onCancel={() => setPicked(null)}
          onSave={async (url) => {
            setPicked(null);
            if (await patch({ avatar: url }, "avatar")) notify("头像已更新");
          }}
        />
      )}
      {takenName !== null && (
        <NameTakenDialog
          name={takenName}
          context="profile"
          onClose={() => {
            setTakenName(null);
            refocusField(nameInput.current);
          }}
        />
      )}
    </section>
  );
}
