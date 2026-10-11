import { LiquidSwitch } from "../ui/LiquidSwitch";
import { LineField } from "../ui/LineField";
import { GlassSelect } from "../ui/GlassSelect";
import { LiquidButton } from "../motion/LiquidButton";
import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  Check,
  FolderPlus,
  ImagePlus,
  LoaderCircle,
  Plus,
  Globe2,
  LockKeyhole,
  Trash2,
} from "lucide-react";
import { ModalRegistration as Modal } from "../motion/OverlayHost";
import AvatarEditor from "../profile/AvatarEditor";
import {
  api,
  post,
  type Category,
  type Collection,
  type Post,
  type TopicTrack,
} from "../api";

export function CollectionForm({
  initial,
  onClose,
  onSaved,
}: {
  initial?: Collection;
  onClose: () => void;
  onSaved: (folder: Collection) => void;
}) {
  const [name, setName] = useState(initial?.name || "");
  const [description, setDescription] = useState(initial?.description || "");
  const [isPublic, setIsPublic] = useState(
    initial ? !!initial.is_public : true,
  );
  const [cover, setCover] = useState(initial?.cover || "");
  const [busy, setBusy] = useState(false),
    [picked, setPicked] = useState<File | null>(null),
    [error, setError] = useState("");
  const uploading = !!picked;
  const uploadRef = useRef<HTMLInputElement>(null);
  function pick(file?: File) {
    if (uploadRef.current) uploadRef.current.value = "";
    if (!file) return;
    setError("");
    if (
      !["image/png", "image/jpeg", "image/webp", "image/gif"].includes(
        file.type,
      ) ||
      file.size > 5 * 1024 * 1024
    ) {
      setError("请选择 5MB 以内的 JPG、PNG、WebP 或 GIF 图片。");
      return;
    }
    setPicked(file);
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const r = await api(
        initial ? "/collections/" + initial.id : "/collections",
        {
          method: initial ? "PATCH" : "POST",
          body: JSON.stringify({
            name,
            description,
            cover,
            is_public: isPublic,
          }),
        },
      );
      onSaved(r.collection);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={initial ? "编辑收藏夹" : "新建收藏夹"}
      onClose={onClose}
      className="collection-modal"
    >
      <form onSubmit={submit}>
        <div className="cover-upload-row">
          <LiquidButton
            type="button"
            className={`cover-upload ${cover ? "has-cover" : ""}`}
            onClick={() => uploadRef.current?.click()}
            disabled={uploading || busy}
            aria-label={cover ? "更换收藏夹封面" : "上传收藏夹封面"}
          >
            {cover && <img src={cover} alt="收藏夹封面预览" />}
            <span>
              {uploading ? (
                <LoaderCircle className="spin" size={26} />
              ) : (
                <ImagePlus size={28} />
              )}
              <span>
                {uploading ? "正在调整" : cover ? "更换封面" : "上传封面"}
              </span>
            </span>
          </LiquidButton>
          <div className="cover-upload-help">
            <p>为收藏夹选一张封面</p>
            <small>
              JPG / PNG / WebP / GIF
              <br />
              大小不超过 5MB
            </small>
            {cover && (
              <LiquidButton
                type="button"
                className="text-button"
                onClick={() => setCover("")}
                disabled={uploading || busy}
              >
                <Trash2 size={14} />
                移除封面
              </LiquidButton>
            )}
          </div>
          <input
            ref={uploadRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            hidden
            onChange={(e) => pick(e.target.files?.[0])}
          />
        </div>
        <label htmlFor="collection-name">
          名称 <span className="required-star">*</span>
        </label>
        <div className="counted-input">
          <input
            id="collection-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={20}
            required
            placeholder="给你的收藏夹起个名字"
            autoFocus
          />
          <span>{name.length} / 20</span>
        </div>
        <div className="visibility-field">
          <div>
            <strong>
              {isPublic ? <Globe2 size={17} /> : <LockKeyhole size={17} />}
              公开收藏夹
            </strong>
            <p>
              {isPublic
                ? "其他人可通过分享链接浏览收藏夹"
                : "仅你自己可以查看收藏夹内容"}
            </p>
          </div>
          <LiquidSwitch checked={isPublic} label="公开收藏夹" onChange={() => setIsPublic(!isPublic)} />
        </div>
        <label htmlFor="collection-description">
          简介 <small>选填</small>
        </label>
        <div className="counted-input counted-textarea">
          <textarea
            id="collection-description"
            rows={4}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={200}
            placeholder="简单介绍一下，这里收藏了什么…"
          />
          <span>{description.length} / 200</span>
        </div>
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
            disabled={!name.trim() || busy || uploading}
          >
            {busy && <LoaderCircle className="spin" size={16} />}
            {initial ? "保存修改" : "创建收藏夹"}
          </LiquidButton>
        </div>
      </form>
      {picked && (
        <AvatarEditor
          variant="cover"
          file={picked}
          onCancel={() => setPicked(null)}
          onSave={(url) => {
            setCover(url);
            setPicked(null);
          }}
        />
      )}
    </Modal>
  );
}

export function BookmarkPicker({
  article,
  onClose,
  onSaved,
}: {
  article: Post;
  onClose: () => void;
  onSaved: (p: Post) => void;
}) {
  const [folders, setFolders] = useState<Collection[]>([]),
    [selected, setSelected] = useState<string[]>([]);
  const [loading, setLoading] = useState(true),
    [creating, setCreating] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [loadFailed, setLoadFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    setLoading(true);
    setLoadFailed(false);
    setError("");
    Promise.all([api("/collections"), api("/posts/" + article.id)])
      .then(([r, p]) => {
        if (live) {
          setFolders(r.collections);
          setSelected(p.post.collection_ids);
        }
      })
      .catch((e) => {
        if (live) {
          setError(e.message);
          setLoadFailed(true);
        }
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [article.id, attempt]);
  async function save() {
    setBusy(true);
    setError("");
    try {
      const r = await api("/posts/" + article.id + "/collections", {
        method: "PUT",
        body: JSON.stringify({ collection_ids: selected }),
      });
      onSaved(r.post);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (creating)
    return (
      <CollectionForm
        onClose={() => setCreating(false)}
        onSaved={(folder) => {
          setFolders((prev) => [...prev, folder]);
          setSelected((prev) => [...prev, folder.id]);
          setCreating(false);
        }}
      />
    );
  return (
    <Modal title="收藏到" onClose={onClose} className="collection-modal">
      <p className="picker-article-title">{article.title}</p>
      {loading ? (
        <p className="library-loading">
          <LoaderCircle className="spin" />
          正在加载收藏夹
        </p>
      ) : (
        <div className="folder-picker">
          {folders.map((folder) => (
            <label key={folder.id}>
              <input
                type="checkbox"
                checked={selected.includes(folder.id)}
                onChange={() =>
                  setSelected((prev) =>
                    prev.includes(folder.id)
                      ? prev.filter((id) => id !== folder.id)
                      : [...prev, folder.id],
                  )
                }
              />
              <span className="picker-check" aria-hidden="true">
                <Check size={15} strokeWidth={2.4} />
              </span>
              <span className="picker-folder-cover">
                {folder.cover ? (
                  <img src={folder.cover} alt="" />
                ) : (
                  <FolderPlus size={22} />
                )}
              </span>
              <span>
                <strong>{folder.name}</strong>
                <small>
                  {folder.count} 篇文章 · {folder.is_public ? "公开" : "私密"}
                </small>
              </span>
              {folder.is_public ? (
                <Globe2 size={15} />
              ) : (
                <LockKeyhole size={15} />
              )}
            </label>
          ))}
        </div>
      )}
      <LiquidButton
        type="button"
        className="button secondary new-folder-inline"
        onClick={() => setCreating(true)}
        disabled={loading || busy || loadFailed}
      >
        <Plus size={18} />
        新建收藏夹
      </LiquidButton>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {loadFailed && (
        <LiquidButton
          className="button secondary"
          onClick={() => setAttempt((v) => v + 1)}
        >
          重新加载收藏夹
        </LiquidButton>
      )}
      <div className="library-form-actions">
        <LiquidButton className="button secondary" onClick={onClose}>
          取消
        </LiquidButton>
        <LiquidButton
          className="button primary"
          disabled={loading || busy || loadFailed || folders.length === 0}
          onClick={save}
        >
          {busy ? (
            <LoaderCircle className="spin" size={16} />
          ) : (
            <Check size={16} />
          )}
          保存{selected.length ? ` · ${selected.length}` : "（取消收藏）"}
        </LiquidButton>
      </div>
    </Modal>
  );
}

export function TrackForm({
  categories,
  initial = "",
  onClose,
  onSaved,
}: {
  categories: Category[];
  initial?: string;
  onClose: () => void;
  onSaved: (track: TopicTrack) => void;
}) {
  const [kind, setKind] = useState("keyword"),
    [value, setValue] = useState(initial.slice(0, 40)),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const r = await api("/topic-tracks", post({ kind, value }));
      onSaved(r.track);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="跟踪话题" onClose={onClose} className="collection-modal">
      <form onSubmit={submit}>
        <p className="library-hint">
          持续收集相关讨论，新发布的文章也会自动出现在这个话题中。
        </p>
        <label htmlFor="track-kind">跟踪方式</label>
        <GlassSelect
          id="track-kind"
          value={kind}
          onChange={(e) => {
            setKind(e.target.value);
            setValue(
              e.target.value === "category" ? categories[0]?.id || "" : "",
            );
          }}
        >
          <option value="keyword">话题关键词</option>
          <option value="category">整个版块</option>
        </GlassSelect>
        <label htmlFor="track-value">
          {kind === "keyword" ? "关键词" : "选择版块"}
        </label>
        {kind === "keyword" ? (
          <LineField
            id="track-value"
            value={value}
            onValue={setValue}
            maxLength={40}
            required
            placeholder="例如：大模型、可控核聚变、开源"
            autoFocus
          />
        ) : (
          <GlassSelect
            id="track-value"
            value={value}
            onChange={(e) => setValue(e.target.value)}
          >
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </GlassSelect>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="library-form-actions">
          <LiquidButton type="button" className="button secondary" onClick={onClose}>
            取消
          </LiquidButton>
          <LiquidButton className="button primary" disabled={busy || !value.trim()}>
            {busy && <LoaderCircle className="spin" size={16} />}开始跟踪
          </LiquidButton>
        </div>
      </form>
    </Modal>
  );
}
