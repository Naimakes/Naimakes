import { LiquidButton } from "../motion/LiquidButton";
import {
  ArrowUpRight,
  Bell,
  Bot,
  FileX2,
  Folder,
  FolderHeart,
  LayoutGrid,
  MessageSquareText,
  Paperclip,
  Quote as QuoteIcon,
  Users,
} from "lucide-react";
import Avatar from "../ui/Avatar";
import { boardIcon } from "../boards/Boards";
import { QuoteCard } from "../posts/Quotes";
import { isShareUnavailable, timeAgo, type ShareCardData, type ShareUnavailable } from "../api";
import { openSharedChat, type ShareTarget } from "./share-api";

type Open = {
  onOpenCollection?: (id: string) => void;
  onOpenBoard?: (id: string) => void;
};

function Mark({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <span className="quote-card-mark share-card-mark">
      {icon}
      {label}
    </span>
  );
}

function Unavailable({ card }: { card: ShareUnavailable }) {
  return (
    <div className="quote-card share-card is-unavailable" role="note">
      <div className="quote-card-open share-card-static">
        <span className="quote-card-top">
          <FileX2 size={15} />
          <Mark icon={card.type === "board" ? <LayoutGrid size={12} /> : card.type === "assistant" ? <Bot size={12} /> : <FolderHeart size={12} />} label={card.type === "board" ? "版块" : card.type === "assistant" ? "对话" : "收藏夹"} />
        </span>
        <strong className="quote-card-title">{card.unavailable}</strong>
      </div>
    </div>
  );
}

export function ShareCardView({ card, onOpenCollection, onOpenBoard }: { card: ShareCardData } & Open) {
  if (isShareUnavailable(card)) return <Unavailable card={card} />;
  if (card.type === "collection")
    return (
      <div className="quote-card share-card share-card-collection">
        <LiquidButton
          type="button"
          className="quote-card-open"
          disabled={!onOpenCollection}
          onClick={() => onOpenCollection?.(card.id)}
        >
          <span className="quote-card-top">
            {card.owner && <Avatar name={card.owner.name} initials={card.owner.initials} avatar={card.owner.avatar || ""} />}
            <span className="quote-card-author">{card.owner?.name || "收藏夹"}</span>
            <span className="meta-dot">·</span>
            <span>创建于 {timeAgo(card.created_at)}</span>
            <Mark icon={<FolderHeart size={12} />} label="收藏夹" />
          </span>
          <span className="share-card-main">
            <span className={`share-card-cover ${card.cover ? "has-cover" : ""}`} aria-hidden="true">
              {card.cover ? <img src={card.cover} alt="" loading="lazy" /> : <Folder size={26} strokeWidth={1.2} />}
            </span>
            <span className="share-card-copy">
              <strong className="quote-card-title">{card.name}</strong>
              {card.description && <span className="quote-card-excerpt">{card.description}</span>}
            </span>
          </span>
          {card.previews.length > 0 && (
            <span className="share-card-previews">
              {card.previews.map((p) => (
                <span key={p.id}>{p.title}</span>
              ))}
            </span>
          )}
          <span className="quote-card-foot">
            <span className="quote-card-board">{card.count} 篇讨论</span>
            <span className="quote-card-stats">查看收藏夹</span>
            {onOpenCollection && <ArrowUpRight size={14} />}
          </span>
        </LiquidButton>
      </div>
    );
  if (card.type === "board") {
    const Icon = boardIcon(card.icon);
    const manager = card.lead ? `版主 ${card.lead.name}` : card.acting_owner ? `站主 ${card.acting_owner.name} 代管` : "站主代管";
    return (
      <div className="quote-card share-card share-card-board">
        <LiquidButton type="button" className="quote-card-open" disabled={!onOpenBoard} onClick={() => onOpenBoard?.(card.id)}>
          <span className="quote-card-top">
            {card.lead ? (
              <Avatar name={card.lead.name} initials={card.lead.initials} avatar={card.lead.avatar || ""} />
            ) : null}
            <span className="quote-card-author">{manager}</span>
            {card.creator && !card.builtin && (
              <>
                <span className="meta-dot">·</span>
                <span>{card.creator.name} 创建</span>
              </>
            )}
            <Mark icon={<LayoutGrid size={12} />} label="版块" />
          </span>
          <span className="share-card-main">
            <span className="share-card-cover share-card-glyph" aria-hidden="true">
              <Icon size={26} strokeWidth={1.3} />
            </span>
            <span className="share-card-copy">
              <strong className="quote-card-title">
                {card.name}
                {card.en && <small className="share-card-en">{card.en}</small>}
              </strong>
              {card.description && <span className="quote-card-excerpt">{card.description}</span>}
            </span>
          </span>
          <span className="quote-card-foot">
            <span className="quote-card-board">{card.posts} 个讨论</span>
            <span className="quote-card-stats">
              <Users size={13} />
              {card.members} 位成员 · {card.followers} 人关注
            </span>
            {onOpenBoard && <ArrowUpRight size={14} />}
          </span>
        </LiquidButton>
      </div>
    );
  }
  if (card.type === "assistant")
    return (
      <div className="quote-card share-card share-card-assistant">
        <LiquidButton type="button" className="quote-card-open" onClick={() => openSharedChat(card.id)}>
          <span className="quote-card-top">
            {card.owner && <Avatar name={card.owner.name} initials={card.owner.initials} avatar={card.owner.avatar || ""} />}
            <span className="quote-card-author">{card.owner?.name || "Naimakes 对话"}</span>
            <span className="meta-dot">·</span>
            <span>{timeAgo(card.shared_at)}</span>
            <Mark icon={<Bot size={12} />} label="对话" />
          </span>
          <strong className="quote-card-title">{card.title || "未命名对话"}</strong>
          <span className="quote-card-foot">
            <span className="quote-card-board">{card.count} 条消息</span>
            <span className="quote-card-stats">查看对话</span>
            <ArrowUpRight size={14} />
          </span>
        </LiquidButton>
      </div>
    );
  if (card.type === "message")
    return (
      <div className="quote-card share-card share-card-message">
        <div className="quote-card-open share-card-static">
          <span className="quote-card-top">
            <MessageSquareText size={15} />
            <span className="quote-card-author">{card.mine ? "我发出的私信" : "收到的私信"}</span>
            <span className="meta-dot">·</span>
            <span>{timeAgo(card.created_at)}</span>
            <Mark icon={<MessageSquareText size={12} />} label="私信" />
          </span>
          {card.text && <span className="share-card-text">{card.text}</span>}
          {(card.files > 0 || card.quote) && (
            <span className="quote-card-foot">
              {card.quote && (
                <span className="quote-card-board">
                  <QuoteIcon size={11} /> {card.quote}
                </span>
              )}
              {card.files > 0 && (
                <span className="quote-card-stats">
                  <Paperclip size={12} />
                  {card.files} 个附件未随转发
                </span>
              )}
            </span>
          )}
        </div>
      </div>
    );
  return (
    <div className="quote-card share-card share-card-notice">
      <div className="quote-card-open share-card-static">
        <span className="quote-card-top">
          <Bell size={15} />
          <span className="quote-card-author">消息中心通知</span>
          <span className="meta-dot">·</span>
          <span>{timeAgo(card.created_at)}</span>
          <Mark icon={<Bell size={12} />} label="通知" />
        </span>
        <span className="share-card-text">{card.text}</span>
        {card.preview && <span className="quote-card-excerpt">{card.preview}</span>}
      </div>
    </div>
  );
}

export function SharePreview({ target, categoryName }: { target: ShareTarget; categoryName: (id: string) => string }) {
  if (target.type === "post") return <QuoteCard quote={target.post} categoryName={categoryName} mark="讨论" />;
  if (target.type === "collection") {
    const c = target.collection;
    return (
      <ShareCardView
        card={{
          type: "collection",
          id: c.id,
          name: c.name,
          description: c.description,
          cover: c.cover,
          count: c.count,
          created_at: c.created_at,
          owner: c.owner_name ? { id: c.user_id, name: c.owner_name, initials: Array.from(c.owner_name)[0] || "", avatar: "" } : null,
          previews: [],
        }}
      />
    );
  }
  if (target.type === "board") {
    const b = target.board;
    return (
      <ShareCardView
        card={{
          type: "board",
          id: b.id,
          name: b.name,
          en: b.en,
          description: b.description,
          icon: b.icon,
          builtin: b.builtin,
          posts: b.posts,
          followers: b.followers,
          members: b.members,
          lead: b.lead,
          acting_owner: b.acting_owner,
          creator: null,
        }}
      />
    );
  }
  if (target.type === "assistant")
    return (
      <ShareCardView
        card={{ type: "assistant", id: target.chat.id, title: target.chat.title, count: target.chat.count, shared_at: target.chat.shared_at || Date.now(), owner: null }}
      />
    );
  if (target.type === "message") {
    const m = target.message;
    return (
      <ShareCardView
        card={{
          type: "message",
          id: m.id,
          text: Array.from(m.content.replace(/!\[[^\]]*\]\([^)]*\)/g, "").replace(/\s+/g, " ").trim()).slice(0, 500).join(""),
          files: m.attachments.length,
          quote: m.quotes[0]?.title || "",
          mine: m.mine,
          created_at: m.created_at,
        }}
      />
    );
  }
  const n = target.notice;
  return (
    <ShareCardView
      card={{ type: "notice", id: n.id, kind: n.kind, text: n.text, preview: n.preview || "", created_at: n.created_at }}
    />
  );
}
