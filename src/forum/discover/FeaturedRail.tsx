import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ComponentType } from "react";
import { ArrowUpRight, ChevronLeft, ChevronRight, Clock3, Eye, Heart, LockKeyhole, MessageCircle, Pause, Play, Sparkles } from "lucide-react";
import { LiquidButton } from "../motion/LiquidButton";
import { TextDisclosure } from "../motion/TextDisclosure";
import { useMotionPreferences } from "../motion/motion-preferences";
import Avatar from "../ui/Avatar";
import { postDescription, timeAgo, type Post } from "../api";
import "./featured-rail.css";

const INTERVAL = 6200;
const INTERACTION_REST = 9000;
const COPIES = 3;
const dialogOpen = () => Boolean(document.querySelector("dialog[open]"));
const scrollTimeline = typeof CSS !== "undefined" && CSS.supports("animation-timeline: view()");
const FOCUS_SCALE = .2, FOCUS_FADE = .78;

export default function FeaturedRail({ posts, iconFor, categoryName, onOpen }: {
  posts: Post[];
  iconFor: (id: string) => ComponentType<{ size?: number }>;
  categoryName: (id: string) => string;
  onOpen: (id: string) => void;
}) {
  const section = useRef<HTMLElement>(null), track = useRef<HTMLDivElement>(null);
  const cards = useRef<(HTMLButtonElement | null)[]>([]);
  const restTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const destination = useRef(0), settling = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dragging = useRef(false);
  const count = posts.length, looping = count > 1, copies = looping ? COPIES : 1;
  const [current, setCurrent] = useState(looping ? count : 0), [paused, setPaused] = useState(false);
  const [hovered, setHovered] = useState(false), [focused, setFocused] = useState(false), [resting, setResting] = useState(false);
  const [visible, setVisible] = useState(true), [pageVisible, setPageVisible] = useState(!document.hidden);
  const [openNotes, setOpenNotes] = useState<ReadonlySet<string>>(() => new Set());
  const { reduced } = useMotionPreferences();
  const id = useId();
  const signature = posts.map(post => post.id).join("|");
  const active = count ? current % count : 0;
  const running = looping && !paused && !reduced && !hovered && !focused && !resting && visible && pageVisible && !openNotes.size;

  const positions = useCallback(() => {
    const el = track.current;
    if (!el) return [];
    const slides = Array.from(el.querySelectorAll<HTMLElement>(".featured-slide"));
    const max = Math.max(0, el.scrollWidth - el.clientWidth);
    return slides.map(slide => Math.min(max, Math.max(0, slide.offsetLeft + slide.offsetWidth / 2 - el.clientWidth / 2)));
  }, []);
  const nearest = useCallback((offsets: number[], left: number) => {
    let index = 0;
    offsets.forEach((position, i) => { if (Math.abs(position - left) < Math.abs(offsets[index] - left)) index = i; });
    return index;
  }, []);
  const pauseForInteraction = useCallback(() => {
    setResting(true);
    if (restTimer.current) clearTimeout(restTimer.current);
    restTimer.current = setTimeout(() => { restTimer.current = null; setResting(false); }, INTERACTION_REST);
  }, []);
  const recentre = useCallback(() => {
    const el = track.current, offsets = positions();
    if (!el || !looping || dragging.current || settling.current || dialogOpen() || offsets.length < count * copies) return;
    const index = nearest(offsets, el.scrollLeft);
    if (index >= count && index < count * 2) return;
    if (Math.abs(offsets[index] - el.scrollLeft) > 2) return;
    const target = index < count ? index + count : index - count;
    const focusedCard = cards.current[index]?.contains(document.activeElement);
    el.scrollTo({ left: el.scrollLeft + offsets[target] - offsets[index], behavior: "instant" });
    destination.current = target;
    setCurrent(target);
    if (focusedCard) cards.current[target]?.focus({ preventScroll: true });
  }, [positions, nearest, looping, count, copies]);
  const goTo = useCallback((requested: number, manual = true, focusCard = false) => {
    const el = track.current;
    if (!el) return;
    recentre();
    const offsets = positions();
    if (!offsets.length) return;
    const index = Math.min(offsets.length - 1, Math.max(0, requested));
    destination.current = index;
    if (settling.current) clearTimeout(settling.current);
    settling.current = setTimeout(() => { settling.current = null; recentre(); }, reduced ? 0 : 800);
    if (manual) pauseForInteraction();
    el.scrollTo({ left: offsets[index], behavior: reduced ? "instant" : "smooth" });
    if (focusCard) cards.current[index]?.focus({ preventScroll: true });
  }, [positions, reduced, pauseForInteraction, recentre]);
  const step = useCallback((delta: number, manual = true, focusCard = false) => {
    recentre();
    goTo(destination.current + delta, manual, focusCard);
  }, [goTo, recentre]);
  const show = useCallback((post: number, focusCard = false) => {
    recentre();
    const base = looping ? Math.floor(destination.current / count) * count : 0;
    goTo(base + post, true, focusCard);
  }, [goTo, recentre, looping, count]);

  useLayoutEffect(() => {
    setOpenNotes(new Set());
    const el = track.current, offsets = positions();
    const start = looping ? count : 0;
    destination.current = start;
    setCurrent(start);
    if (el && offsets[start] !== undefined) el.scrollTo({ left: offsets[start], behavior: "instant" });
  }, [signature, positions, looping, count]);

  useEffect(() => {
    const el = track.current;
    if (!el) return;
    let frame = 0, idle: ReturnType<typeof setTimeout> | null = null;
    const endSupported = "onscrollend" in window;
    const focus = () => {
      if (scrollTimeline || reduced) return;
      const middle = el.scrollLeft + el.clientWidth / 2;
      el.querySelectorAll<HTMLElement>(".featured-slide").forEach(slide => {
        const story = slide.firstElementChild as HTMLElement | null;
        if (!story) return;
        const t = Math.min(1, Math.abs(slide.offsetLeft + slide.offsetWidth / 2 - middle) / (slide.offsetWidth || 1));
        const eased = t * t * (3 - 2 * t);
        story.style.scale = String(1 - FOCUS_SCALE * eased);
        story.style.opacity = String(1 - FOCUS_FADE * eased);
      });
    };
    const read = () => {
      frame = 0;
      focus();
      const offsets = positions();
      if (!offsets.length) return;
      const index = nearest(offsets, el.scrollLeft);
      setCurrent(index);
      if (!settling.current) destination.current = index;
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(read);
      if (!endSupported) { if (idle) clearTimeout(idle); idle = setTimeout(recentre, 160); }
    };
    const onScrollEnd = () => { read(); recentre(); };
    const release = () => { if (!dragging.current) return; dragging.current = false; if (!endSupported) { if (idle) clearTimeout(idle); idle = setTimeout(recentre, 160); } };
    const resize = new ResizeObserver(() => {
      const offsets = positions();
      const index = Math.min(destination.current, offsets.length - 1);
      if (index >= 0) el.scrollTo({ left: offsets[index], behavior: "instant" });
      read();
    });
    resize.observe(el);
    el.addEventListener("scroll", onScroll, { passive: true });
    el.addEventListener("scrollend", onScrollEnd);
    window.addEventListener("pointerup", release);
    window.addEventListener("pointercancel", release);
    window.addEventListener("touchend", release);
    read();
    return () => {
      el.removeEventListener("scroll", onScroll); el.removeEventListener("scrollend", onScrollEnd);
      window.removeEventListener("pointerup", release); window.removeEventListener("pointercancel", release); window.removeEventListener("touchend", release);
      resize.disconnect(); cancelAnimationFrame(frame); if (idle) clearTimeout(idle);
    };
  }, [signature, positions, nearest, recentre, reduced]);

  useEffect(() => {
    const el = section.current;
    if (!el) return;
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { threshold: .15 });
    observer.observe(el);
    const visibility = () => setPageVisible(!document.hidden);
    document.addEventListener("visibilitychange", visibility);
    return () => { observer.disconnect(); document.removeEventListener("visibilitychange", visibility); };
  }, [count]);
  useEffect(() => {
    if (!running) return;
    const timer = setTimeout(() => { if (dialogOpen()) pauseForInteraction(); else step(1, false); }, INTERVAL);
    return () => clearTimeout(timer);
  }, [current, running, step, pauseForInteraction]);
  useEffect(() => () => {
    if (restTimer.current) clearTimeout(restTimer.current);
    if (settling.current) clearTimeout(settling.current);
  }, []);

  const manualScroll = () => {
    if (settling.current) clearTimeout(settling.current);
    settling.current = null;
    destination.current = current;
    pauseForInteraction();
  };
  if (!count) return null;
  const slides = Array.from({ length: count * copies }, (_, index) => ({ post: posts[index % count], index, order: index % count }));
  return <section className={`featured-rail featured-editorial ${count === 1 ? "is-single" : ""}`} ref={section} aria-labelledby={`${id}-heading`} aria-roledescription="轮播"
    onPointerEnter={event => { if (event.pointerType === "mouse") setHovered(true); }}
    onPointerLeave={event => { if (event.pointerType === "mouse") { setHovered(false); pauseForInteraction(); } }}
    onFocusCapture={() => setFocused(true)}
    onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) { setFocused(false); pauseForInteraction(); } }}
    onKeyDown={event => {
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      const direction = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
      const onCard = Boolean((event.target as Element).closest(".featured-story"));
      if (direction) { event.preventDefault(); step(direction, true, onCard); }
      else if (event.key === "Home" || event.key === "End") { event.preventDefault(); show(event.key === "Home" ? 0 : count - 1, onCard); }
    }}>
    <div className="featured-editorial-heading">
      <div><span className="featured-eyebrow"><Sparkles size={12} strokeWidth={1.5}/> THE COMMUNITY EDIT</span><h2 id={`${id}-heading`}>值得停留的讨论<span>。</span></h2></div>
      {looping && <div className="featured-editorial-controls">
        <LiquidButton type="button" className="featured-control featured-play" aria-label={paused ? "继续自动轮播" : reduced ? "已按系统设置关闭自动轮播" : "暂停自动轮播"} aria-pressed={paused} disabled={reduced} onClick={() => setPaused(value => !value)}>{paused || reduced ? <Play size={15}/> : <Pause size={15}/>}</LiquidButton>
        <span className="featured-control-separator" aria-hidden="true"/>
        <LiquidButton type="button" className="featured-control" aria-label="上一条精选讨论" aria-controls={`${id}-track`} onClick={() => step(-1)}><ChevronLeft size={19}/></LiquidButton>
        <LiquidButton type="button" className="featured-control" aria-label="下一条精选讨论" aria-controls={`${id}-track`} onClick={() => step(1)}><ChevronRight size={19}/></LiquidButton>
      </div>}
    </div>
    <div className="featured-snap-track" ref={track} id={`${id}-track`} aria-label="左右滑动浏览精选讨论" onPointerDown={() => { dragging.current = true; manualScroll(); }} onWheel={manualScroll} onTouchStart={() => { dragging.current = true; manualScroll(); }}>
      {slides.map(({ post, index, order }) => {
        const Icon = iconFor(post.category);
        const kind = post.kind === "announcement" ? "社区公告" : post.kind === "project" ? "开放共创" : "深度讨论";
        const state = post.visibility === "private" ? "仅自己可见" : post.locked ? "此帖子已被禁言" : post.comments_closed ? "评论已关闭" : "";
        const mirror = looping && Math.floor(index / count) !== 1;
        const key = `${id}-${index}`;
        return <div key={`${post.id}-${index}`} className={`featured-slide ${current === index ? "is-current" : ""}`} role="group" aria-roledescription="幻灯片" aria-label={`${order + 1} / ${count}`} aria-hidden={mirror || undefined}>
          <div data-post-id={post.id} className={`featured-story featured-story-${post.category}`}>
            <LiquidButton ref={node => { cards.current[index] = node; }} type="button" tabIndex={mirror ? -1 : undefined} className="featured-story-hit" aria-labelledby={`${key}-title`} aria-describedby={state ? `${key}-state` : undefined} onClick={event => {
              if (event.detail > 0 && looping && index !== current) goTo(index);
              else onOpen(post.id);
            }} />
            <div className="featured-story-content">
              <span className="featured-story-topline"><span className="featured-category"><Icon size={14}/>{categoryName(post.category)}</span><span className="featured-kind">{kind}</span>{post.demo === 1 && <span className="featured-sample">示例</span>}</span>
              <span className="featured-story-title" role="heading" aria-level={3} id={`${key}-title`}>{post.title}</span>
              <TextDisclosure className="featured-story-note" textClassName="featured-story-excerpt" tabIndex={mirror ? -1 : undefined}
                open={openNotes.has(post.id)}
                onOpenChange={open => { pauseForInteraction(); setOpenNotes(notes => { const next = new Set(notes); if (open) next.add(post.id); else next.delete(post.id); return next; }); }}>
                {postDescription(post) || "一个想法，一种新的视角。打开这场讨论，和好奇的人继续聊聊。"}
              </TextDisclosure>
              <span className="featured-story-author"><Avatar name={post.author_name} initials={post.author_initials} avatar={post.author_avatar} size={30}/><span><strong>{post.author_name}</strong><small>{timeAgo(post.created_at)}</small></span></span>
              <span className="featured-story-footer"><span className="featured-story-metrics"><span><Eye size={13}/>{post.views ?? 0} 人阅读</span><span><Heart size={12}/>{post.likes}</span><span><MessageCircle size={13}/>{post.comments} 条讨论</span>{post.reading_minutes > 0 && <span><Clock3 size={12}/>{post.reading_minutes} 分钟</span>}</span>
                <span className="featured-story-actions">
                  <span className="featured-read">{post.kind === "project" ? "了解项目" : "阅读讨论"}<ArrowUpRight size={17}/></span>
                </span></span>
              {state && <span className="featured-access-state" id={`${key}-state`}><LockKeyhole size={11}/>{state}</span>}
            </div>
            <span className="featured-story-index" aria-hidden="true">{String(order + 1).padStart(2, "0")}</span>
          </div>
        </div>;
      })}
    </div>
    {looping && <div className="featured-editorial-footer">
      <span className="featured-page-count" aria-live={running ? "off" : "polite"} aria-atomic="true"><strong>{String(active + 1).padStart(2, "0")}</strong><span>/ {String(count).padStart(2, "0")}</span></span>
      <div className="featured-pagination" role="group" aria-label="选择精选讨论">{posts.map((post, index) => <LiquidButton type="button" key={post.id} className={`featured-page-dot ${index === active ? "is-active" : ""}`} aria-label={`显示第 ${index + 1} 条：${post.title}`} aria-current={index === active ? "true" : undefined} onClick={() => show(index)}><span aria-hidden="true"><i key={`${active}-${running}`} className={index === active && running ? "is-counting" : ""}/></span></LiquidButton>)}</div>
      <span className="featured-footer-note">向好奇心，再走近一点<ArrowUpRight size={12}/></span>
    </div>}
  </section>;
}
