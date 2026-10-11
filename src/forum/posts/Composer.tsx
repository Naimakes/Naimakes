import { GlassSelect } from "../ui/GlassSelect";
import { GlassSegments } from "../ui/GlassSegments";
import { LiquidButton } from "../motion/LiquidButton";
import { Component, lazy, Suspense, useId, useState, type FormEvent, type ReactNode } from "react";
import "../auth/auth-form.css";
import {
  ArrowUpRight,
  Eye,
  PenLine,
  LoaderCircle,
  Check,
  Globe2,
  LockKeyhole,
  Save,
} from "lucide-react";
import { ModalRegistration as Modal } from "../motion/OverlayHost";
import { AttachmentPicker } from "./Attachments";
import { LineField } from "../ui/LineField";
import { QuoteButton, QuoteList, QuotePicker } from "./Quotes";
import { KeywordInput, parseKeywords } from "./KeywordInput";
import { MyDrafts, saveDraft } from "./Drafts";
import Confirm from "../ui/Confirm";
import { RichContent } from "./rich-text/RichContent";
const RichEditor = lazy(() => import("./rich-text/RichEditor"));
const MarkdownContent = lazy(() => import("./MarkdownContent"));
import {
  api,
  post,
  visibilityLabels,
  type Attachment,
  type Draft,
  type Category,
  type Post,
  type PostVisibility,
  type Quote,
} from "../api";
class EditorBoundary extends Component<{ children: ReactNode }, { failed: boolean; key: number }> {
  state = { failed: false, key: 0 };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown) {
    console.error(error);
  }
  render() {
    if (!this.state.failed) return <div key={this.state.key}>{this.props.children}</div>;
    return (
      <div className="rt-shell rt-loading" role="alert">
        <span>编辑器暂时没能打开，草稿已保存在这台设备上。</span>
        <LiquidButton type="button" className="button secondary compact" onClick={() => this.setState((s) => ({ failed: false, key: s.key + 1 }))}>
          重新打开编辑器
        </LiquidButton>
      </div>
    );
  }
}
export function Composer({
  categories,
  onClose,
  onPublish,
  editing,
  announcement = false,
}: {
  categories: Category[];
  onClose: () => void;
  onPublish: (p: Post) => void;
  editing?: Post;
  announcement?: boolean;
}) {
  const isAnnouncement = announcement || editing?.kind === "announcement";
  const formId = useId();
  const initial = () => {
    if (editing)
      return {
        title: editing.title,
        content: editing.content,
        format: editing.format === "html" ? "html" : "markdown",
        category: editing.category,
        kind: editing.kind,
        tags: editing.tags.join(", "),
        visibility: editing.visibility,
        comments_closed: editing.comments_closed,
      };
    if (isAnnouncement) return { kind: "announcement", format: "html" };
    try {
      return JSON.parse(localStorage.getItem("nmk-draft") || "{}");
    } catch {
      return {};
    }
  };
  const [draft, setDraft] = useState(initial),
    [files, setFiles] = useState<Attachment[]>(editing?.attachments ?? []),
    [quotes, setQuotes] = useState<Quote[]>(editing?.quotes ?? []),
    [inlineImages, setInlineImages] = useState(
      editing?.attachments.length
        ? editing.attachments.some((f) => f.inline)
        : true,
    ),
    [quoting, setQuoting] = useState(false),
    [preview, setPreview] = useState(false),
    [busy, setBusy] = useState(false),
    [draftId, setDraftId] = useState(""),
    [saving, setSaving] = useState(false),
    [saved, setSaved] = useState(false),
    [draftVersion, setDraftVersion] = useState(0),
    [importing, setImporting] = useState<Draft | null>(null),
    [error, setError] = useState("");
  const [opening, setOpening] = useState(() => ({
    value: String(draft.content || ""),
    format: (draft.format === "html" || !draft.content ? "html" : "markdown") as "html" | "markdown",
    key: 0,
  }));
  const visibility: PostVisibility = isAnnouncement
    ? "public"
    : draft.visibility === "private"
      ? "private"
      : "public";
  const commentsClosed = !!draft.comments_closed;
  const hasExtras = files.length > 0 || quotes.length > 0;
  const update = (key: string, value: string | boolean) => {
    setDraft((d: any) => {
      const next = { ...d, [key]: value };
      if (key === "content") next.format = "html";
      if (!editing && !isAnnouncement) {
        try {
          localStorage.setItem("nmk-draft", JSON.stringify(next));
        } catch {}
      }
      return next;
    });
  };
  const composed = () => ({
    title: draft.title || "",
    content: draft.content || "",
    format: draft.format === "html" ? "html" : "markdown",
    category: isAnnouncement ? "announcement" : draft.category || categories[0]?.id || "",
    kind: isAnnouncement ? "announcement" : draft.kind || "discussion",
    tags: parseKeywords(draft.tags || ""),
    attachments: files,
    quotes: quotes.map((q) => q.id),
    inline_images: inlineImages,
    visibility,
    comments_closed: commentsClosed,
  });
  async function storeDraft() {
    setSaving(true);
    setError("");
    try {
      let stored;
      try {
        stored = await saveDraft(composed(), draftId || undefined);
      } catch (e) {
        if (!draftId) throw e;
        stored = await saveDraft(composed());
      }
      setDraftId(stored.id);
      setDraftVersion((v) => v + 1);
      setSaved(true);
      setTimeout(() => setSaved(false), 2400);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  function applyDraft(d: Draft) {
    setDraft({
      title: d.title,
      content: d.content,
      format: d.format,
      category: d.category || categories[0]?.id,
      kind: d.kind,
      tags: d.tags.join(", "),
      visibility: d.visibility,
      comments_closed: d.comments_closed,
    });
    setOpening((o) => ({ value: d.content, format: d.format, key: o.key + 1 }));
    setFiles(d.attachments);
    setQuotes(d.quotes);
    setInlineImages(d.inline_images);
    setDraftId(d.id);
    setPreview(false);
    setError("");
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!draft.content && !hasExtras) {
      setError("请写下正文，或至少添加一个附件或引用。");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const r = await api(editing ? "/posts/" + editing.id : "/posts", {
        ...post({
          title: draft.title || "",
          content: draft.content || "",
          format: draft.format === "html" ? "html" : "markdown",
          category: isAnnouncement
            ? "announcement"
            : draft.category || categories[0]?.id,
          kind: isAnnouncement ? "announcement" : draft.kind || "discussion",
          tags: parseKeywords(draft.tags || ""),
          attachments: files,
          quotes: quotes.map((q) => q.id),
          inline_images: inlineImages,
          visibility,
          comments_closed: commentsClosed,
        }),
        method: editing ? "PATCH" : "POST",
      });
      if (!editing && !isAnnouncement) localStorage.removeItem("nmk-draft");
      onPublish(r.post);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const pageTitle = isAnnouncement
    ? editing
      ? "编辑公告"
      : "发布公告"
    : editing
      ? "编辑讨论"
      : "发起讨论";
  const publishLabel = editing ? "保存修改" : isAnnouncement ? "发布公告" : "发布讨论";
  const publishButton = (extra = "") => (
    <LiquidButton type="submit" form={formId} className={`button primary composer-publish ${extra}`} disabled={busy}>
      {busy ? (
        <LoaderCircle size={17} className="spin" />
      ) : (
        <>
          {publishLabel}
          <ArrowUpRight size={17} />
        </>
      )}
    </LiquidButton>
  );
  return (
    <Modal
      title={pageTitle}
      onClose={onClose}
      page
      backLabel="返回"
      motionKey="composer"
      actions={publishButton("composer-top-publish")}
      className={`composer-modal composer-page ${isAnnouncement ? "announcement-composer" : ""}`}
    >
      <form id={formId} className="composer-layout" onSubmit={submit}>
        <div className="composer-main">
          <div className="composer-heading">
            {!isAnnouncement && (
              <div className="eyebrow">EVERY FUTURE STARTS WITH AN IDEA</div>
            )}
            <h2>
              {isAnnouncement
                ? "公告"
                : editing
                  ? "让你的想法，更进一步。"
                  : "你的想法，值得被看见。"}
            </h2>
          </div>
          <LineField
            aria-label="讨论标题"
            className="title-input"
            placeholder={
              isAnnouncement ? "公告标题…" : "用一个好问题，开启一场讨论…"
            }
            maxLength={200}
            value={draft.title || ""}
            onValue={(value) => update("title", value)}
            required
          />
          <div className="editor-toolbar">
            <GlassSegments<"write" | "preview">
              className="composer-mode is-compact"
              label="撰写或预览"
              value={preview ? "preview" : "write"}
              onChange={(mode) => setPreview(mode === "preview")}
              items={[
                { id: "write", label: "撰写", icon: <PenLine size={14} /> },
                { id: "preview", label: "预览", icon: <Eye size={14} /> },
              ]}
            />
          </div>
          {preview && (
            <div className="editor-preview-wrap">
              {draft.content ? (
                draft.format === "html" ? (
                  <RichContent html={draft.content} className="editor-preview" />
                ) : (
                  <div className="markdown editor-preview">
                    <Suspense fallback={null}>
                      <MarkdownContent content={draft.content} />
                    </Suspense>
                  </div>
                )
              ) : (
                <p className="editor-preview editor-preview-empty">你的内容预览会出现在这里。</p>
              )}
            </div>
          )}
          <div className="composer-editor" hidden={preview}>
            <EditorBoundary>
            <Suspense
              fallback={
                <div className="rt-shell rt-loading">
                  <LoaderCircle className="spin" size={20} />
                  正在准备编辑器…
                </div>
              }
            >
              <RichEditor
                key={opening.key}
                value={opening.value}
                initialFormat={opening.format}
                label="讨论正文"
                placeholder={isAnnouncement ? "写下公告内容…" : "写下你的想法、问题或发现…"}
                onChange={(html) => update("content", html)}
                onError={setError}
              />
            </Suspense>
            </EditorBoundary>
          </div>
          <div className="composer-attachments">
            <AttachmentPicker
              files={files}
              onChange={setFiles}
              onError={setError}
              inline={inlineImages}
              onInline={setInlineImages}
              toolbarExtra={
                <QuoteButton onClick={() => setQuoting(true)} count={quotes.length} />
              }
            />
          </div>
          <QuoteList
            quotes={quotes}
            categoryName={(id) =>
              categories.find((c) => c.id === id)?.name || "站内讨论"
            }
            onRemove={(id) => setQuotes((list) => list.filter((q) => q.id !== id))}
          />
        </div>
        <aside className="composer-side" aria-label="发布设置">
          {!isAnnouncement && (
            <div className="composer-card">
              <h3>发布到</h3>
              <label>
                选择版块
                <GlassSelect
                  value={draft.category || categories[0]?.id}
                  onChange={(e) => update("category", e.target.value)}
                >
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </GlassSelect>
              </label>
              <label>
                内容类型
                <GlassSelect
                  value={draft.kind || "discussion"}
                  onChange={(e) => update("kind", e.target.value)}
                >
                  <option value="discussion">话题讨论</option>
                  <option value="project">共创项目</option>
                </GlassSelect>
              </label>
            </div>
          )}
          {!isAnnouncement && (
            <div className="composer-card">
              <KeywordInput value={draft.tags || ""} onChange={(value) => update("tags", value)} />
            </div>
          )}
          <fieldset className="publish-settings composer-card">
            <legend>发布设置</legend>
            <div className="form-row">
              {!isAnnouncement && (
                <label>
                  可见范围
                  <GlassSelect
                    value={visibility}
                    onChange={(e) => update("visibility", e.target.value)}
                  >
                    <option value="public">{visibilityLabels.public}</option>
                    <option value="private">{visibilityLabels.private}</option>
                  </GlassSelect>
                </label>
              )}
              <label>
                评论权限
                <GlassSelect
                  value={commentsClosed ? "closed" : "open"}
                  onChange={(e) =>
                    update("comments_closed", e.target.value === "closed")
                  }
                >
                  <option value="open">允许其他人评论</option>
                  <option value="closed">关闭评论</option>
                </GlassSelect>
              </label>
            </div>
            <p className="settings-hint">
              {visibility === "private" ? (
                <LockKeyhole size={13} />
              ) : (
                <Globe2 size={13} />
              )}
              <span>
                {visibility === "private"
                  ? "只有你自己能在「我的发布」中看到这篇内容。"
                  : isAnnouncement
                    ? "公告会发送给每位成员。"
                    : "所有人都能浏览、收藏与分享这篇内容。"}
                {commentsClosed
                  ? "已关闭评论，读者会看到「评论已关闭」，现有回复仍然保留。"
                  : "其他人可以在下方发表评论。"}
              </span>
            </p>
          </fieldset>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <div className="composer-footer">
            <p className="composer-footer-note">
              <Check size={14} />
              <span>
                <strong>
                  {isAnnouncement
                    ? "发布后所有成员都会收到通知"
                    : editing
                      ? "修改后保留已有回复与收藏"
                      : "草稿自动保存在此设备"}
                </strong>
              </span>
            </p>
            {!isAnnouncement && !editing && (
              <div className="composer-draft-actions">
                <MyDrafts
                  categories={categories}
                  version={draftVersion}
                  onError={setError}
                  onImport={(d) =>
                    draft.title || draft.content || hasExtras ? setImporting(d) : applyDraft(d)
                  }
                />
                <LiquidButton
                  type="button"
                  className="button secondary composer-save-draft"
                  disabled={saving || busy}
                  onClick={storeDraft}
                >
                  {saving ? (
                    <LoaderCircle size={16} className="spin" />
                  ) : saved ? (
                    <Check size={16} />
                  ) : (
                    <Save size={16} />
                  )}
                  {saving ? "保存中…" : saved ? "已保存" : "保存草稿"}
                </LiquidButton>
              </div>
            )}
          </div>
        </aside>
        {importing && (
          <Confirm
            title="导入草稿"
            heading="用这份草稿替换当前内容？"
            description="正在写的标题、正文、附件和引用都会被换掉。想留住它，先按「保存草稿」。"
            confirmLabel="导入草稿"
            tone="primary"
            onClose={() => setImporting(null)}
            onConfirm={() => {
              applyDraft(importing);
              setImporting(null);
            }}
          />
        )}
        {quoting && (
          <QuotePicker
            categories={categories}
            chosen={quotes}
            onError={setError}
            onClose={() => setQuoting(false)}
            onPick={(q) => {
              setQuotes((list) =>
                list.some((x) => x.id === q.id) ? list : [...list, q],
              );
              setQuoting(false);
            }}
          />
        )}
      </form>
    </Modal>
  );
}
