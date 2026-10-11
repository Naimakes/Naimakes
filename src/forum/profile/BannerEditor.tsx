import { LiquidButton } from "../motion/LiquidButton";
import { AnimatePresence, animate, motion, useMotionValue } from "motion/react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { Check, ImagePlus, LoaderCircle, Minus, Monitor, Plus, RefreshCw, RotateCw, Scan, Smartphone } from "lucide-react";
import { ModalRegistration as Modal } from "../motion/OverlayHost";
import { GlassSegments } from "../ui/GlassSegments";
import { useMotionPreferences } from "../motion/motion-preferences";
import { transitions } from "../motion/motion-tokens";
import { rotateQuarterTurn } from "../posts/image-rotate";
import { uploadFile } from "../api";
import { UploadProgress, capPercent } from "../ui/UploadProgress";

const BANNER_RATIO = 1240 / 270;
const BANNER_RATIO_MOBILE = 16 / 10;
type Target = "wide" | "tall";
const targets = {
  wide: { ratio: BANNER_RATIO, output: 2480, label: "电脑端", hint: "电脑上会完整显示框里这一段。", file: "banner.jpg" },
  tall: { ratio: BANNER_RATIO_MOBILE, output: 1240, label: "手机端", hint: "手机上会完整显示框里这一段。", file: "banner-mobile.jpg" },
} as const;
const order: Target[] = ["wide", "tall"];
const other = (target: Target): Target => (target === "wide" ? "tall" : "wide");
const FILE_LIMIT = 8 * 1024 * 1024;
const MIN_BOX_HEIGHT = 30;

type Crop = { x: number; y: number; w: number };
type Loaded = { element: HTMLImageElement; url: string };
type Side = { image: Loaded | null; crop: Crop | null; origin: string; dirty: boolean };
type Sides = Record<Target, Side>;
type Corner = "nw" | "ne" | "sw" | "se";
type Spring = (typeof transitions)[keyof typeof transitions] | null;
type Gesture =
  | { kind: "move"; id: number; from: { x: number; y: number }; start: Crop }
  | { kind: "resize"; id: number; corner: Corner; anchor: { x: number; y: number } }
  | { kind: "pinch"; distance: number; start: Crop };

const corners: Corner[] = ["nw", "ne", "sw", "se"];
const empty: Side = { image: null, crop: null, origin: "", dirty: false };
const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));
const centred = (element: HTMLImageElement, ratio: number): Crop => {
  const w = Math.min(element.naturalWidth, element.naturalHeight * ratio);
  return { w, x: (element.naturalWidth - w) / 2, y: (element.naturalHeight - w / ratio) / 2 };
};
const enter = { opacity: 0, y: 6, filter: "blur(3px)" };
const rest = { opacity: 1, y: 0, filter: "blur(0px)" };
const leave = { opacity: 0, y: -4, filter: "blur(2px)" };

export default function BannerEditor({
  banner,
  bannerMobile,
  onCancel,
  onSave,
}: {
  banner: string;
  bannerMobile: string;
  onCancel: () => void;
  onSave: (next: { banner: string; banner_mobile: string }) => Promise<boolean>;
}) {
  const { reduced } = useMotionPreferences();
  const [mode, setMode] = useState<Target>("wide"),
    [sides, setSides] = useState<Sides>({ wide: empty, tall: empty }),
    [pending, setPending] = useState<Target | "">(""),
    [measured, setMeasured] = useState({ url: "", scale: 0 }),
    [over, setOver] = useState(false),
    [busy, setBusy] = useState(false),
    [percent, setPercent] = useState(0),
    [rotating, setRotating] = useState(false),
    [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null),
    stage = useRef<HTMLDivElement>(null),
    canvas = useRef<HTMLDivElement>(null),
    box = useRef<HTMLDivElement>(null);
  const crops = useRef<Record<Target, Crop | null>>({ wide: null, tall: null }),
    gesture = useRef<Gesture | null>(null),
    pointers = useRef(new Map<number, { x: number; y: number }>()),
    enteredFor = useRef(""),
    urls = useRef<string[]>([]);
  const bx = useMotionValue(0),
    by = useMotionValue(0),
    bw = useMotionValue(0),
    bh = useMotionValue(0);

  const { ratio, hint } = targets[mode];
  const side = sides[mode];
  const image = side.image;
  const crop = side.crop;
  const natural = image ? { w: image.element.naturalWidth, h: image.element.naturalHeight } : null;
  const fit = image && measured.url === image.url ? measured.scale : 0;
  const maxWidth = natural ? Math.min(natural.w, natural.h * ratio) : 0;
  const minWidth = fit ? Math.min(maxWidth, (MIN_BOX_HEIGHT * ratio) / fit) : maxWidth;
  const ready = !!natural && !!crop && fit > 0;
  const complete = !!sides.wide.image && !!sides.tall.image;

  const writeSides = useCallback((update: (prev: Sides) => Sides) => {
    setSides((prev) => {
      const next = update(prev);
      crops.current = { wide: next.wide.crop, tall: next.tall.crop };
      return next;
    });
  }, []);

  useEffect(() => () => urls.current.forEach((url) => URL.revokeObjectURL(url)), []);

  useEffect(() => {
    let live = true;
    for (const target of order) {
      const src = target === "wide" ? banner : bannerMobile || banner;
      if (!src) continue;
      const element = new Image();
      element.onload = () => {
        if (!live) return;
        writeSides((prev) =>
          prev[target].image || prev[target].dirty
            ? prev
            : {
                ...prev,
                [target]: {
                  image: { element, url: src },
                  crop: centred(element, targets[target].ratio),
                  origin: target === "wide" ? banner : bannerMobile,
                  dirty: false,
                },
              },
        );
      };
      element.src = src;
    }
    return () => {
      live = false;
    };
  }, [banner, bannerMobile, writeSides]);

  const put = useCallback(
    (loaded: Loaded, target: Target, spread: boolean) => {
      const fresh = (t: Target): Side => ({ image: loaded, crop: centred(loaded.element, targets[t].ratio), origin: "", dirty: true });
      writeSides((prev) => {
        const away = other(target);
        const shared = !prev[away].image || prev[away].image.url === prev[target].image?.url;
        const next = { ...prev, [target]: fresh(target) };
        if (spread && shared) next[away] = fresh(away);
        return next;
      });
      setError("");
    },
    [writeSides],
  );

  function pick(next: File | undefined) {
    if (!next) return;
    if (!next.type.startsWith("image/")) return setError("请选择一张图片作为背景图。");
    if (next.size > FILE_LIMIT) return setError("背景图不能大于 8MB，换一张小一点的图片。");
    setError("");
    setPending(mode);
    const target = mode;
    const url = URL.createObjectURL(next);
    urls.current.push(url);
    const element = new Image();
    element.onload = () => {
      setPending("");
      put({ element, url }, target, true);
    };
    element.onerror = () => {
      setPending("");
      setError("这张图片打不开，换一张试试。");
    };
    element.src = url;
  }

  useLayoutEffect(() => {
    const el = stage.current;
    if (!el || !image) return;
    const measure = () => {
      const style = getComputedStyle(el);
      const width = el.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      const height = el.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
      if (width > 0 && height > 0)
        setMeasured({
          url: image.url,
          scale: Math.min(width / image.element.naturalWidth, height / image.element.naturalHeight),
        });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [image]);

  const place = useCallback(
    (next: Crop, spring: Spring, shape = ratio) => {
      const targetValues = [next.x * fit, next.y * fit, next.w * fit, (next.w / shape) * fit];
      [bx, by, bw, bh].forEach((value, i) => {
        if (spring && !reduced) animate(value, targetValues[i], spring);
        else value.jump(targetValues[i]);
      });
    },
    [bx, by, bw, bh, fit, ratio, reduced],
  );

  useLayoutEffect(() => {
    const current = crops.current[mode];
    if (!image || !fit || !current) return;
    const key = `${mode}|${image.url}`;
    if (enteredFor.current === key) return place(current, null);
    const first = !enteredFor.current.endsWith("|" + image.url);
    enteredFor.current = key;
    if (first) {
      bx.jump(0);
      by.jump(0);
      bw.jump(image.element.naturalWidth * fit);
      bh.jump(image.element.naturalHeight * fit);
    }
    place(current, transitions.surface);
  }, [image, fit, mode, place, bx, by, bw, bh]);

  const commit = (next: Crop, spring: Spring = null) => {
    if (!natural) return;
    const w = clamp(next.w, minWidth, maxWidth);
    const settled = {
      w,
      x: clamp(next.x, 0, natural.w - w),
      y: clamp(next.y, 0, natural.h - w / ratio),
    };
    crops.current[mode] = settled;
    setSides((prev) => ({ ...prev, [mode]: { ...prev[mode], crop: settled, dirty: true } }));
    place(settled, spring);
  };
  const resizeAround = (start: Crop, width: number, spring: Spring = null) => {
    const w = clamp(width, minWidth, maxWidth);
    const cx = start.x + start.w / 2,
      cy = start.y + start.w / ratio / 2;
    commit({ w, x: cx - w / 2, y: cy - w / ratio / 2 }, spring);
  };
  const resizeBy = (delta: number) => {
    const current = crops.current[mode];
    if (current) resizeAround(current, current.w + delta, transitions.responsive);
  };

  async function rotate() {
    if (!image || busy || rotating) return;
    setRotating(true);
    setError("");
    try {
      const { url } = await rotateQuarterTurn(image.element);
      urls.current.push(url);
      const element = new Image();
      element.onload = () => {
        put({ element, url }, mode, false);
        setRotating(false);
      };
      element.onerror = () => {
        setError("旋转失败，请重试。");
        setRotating(false);
      };
      element.src = url;
    } catch (e) {
      setError((e as Error).message);
      setRotating(false);
    }
  }

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const wheel = (event: WheelEvent) => {
      const current = crops.current[mode];
      if (!current || busy || rotating) return;
      event.preventDefault();
      resizeAround(current, current.w * Math.exp(event.deltaY * (event.ctrlKey ? 0.01 : 0.0015)));
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  });

  const toImage = (point: { clientX: number; clientY: number }) => {
    const rect = canvas.current!.getBoundingClientRect();
    return { x: (point.clientX - rect.left) / fit, y: (point.clientY - rect.top) / fit };
  };
  const down = (event: ReactPointerEvent<HTMLDivElement>) => {
    const current = crops.current[mode];
    if (!current || !ready || busy || rotating || event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()];
      gesture.current = { kind: "pinch", distance: Math.hypot(a.x - b.x, a.y - b.y), start: current };
      return;
    }
    box.current?.focus({ preventScroll: true });
    const corner = (event.target as HTMLElement).closest<HTMLElement>("[data-corner]")?.dataset.corner as Corner | undefined;
    if (corner) {
      const h = current.w / ratio;
      gesture.current = {
        kind: "resize",
        id: event.pointerId,
        corner,
        anchor: {
          x: corner.includes("w") ? current.x + current.w : current.x,
          y: corner.includes("n") ? current.y + h : current.y,
        },
      };
    } else gesture.current = { kind: "move", id: event.pointerId, from: toImage(event), start: current };
  };
  const drag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(event.pointerId) || !natural) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const active = gesture.current;
    if (!active) return;
    if (active.kind === "pinch") {
      const [a, b] = [...pointers.current.values()];
      if (!a || !b || !active.distance) return;
      return resizeAround(active.start, active.start.w * (Math.hypot(a.x - b.x, a.y - b.y) / active.distance));
    }
    if (active.id !== event.pointerId) return;
    const p = toImage(event);
    if (active.kind === "move")
      return commit({ ...active.start, x: active.start.x + p.x - active.from.x, y: active.start.y + p.y - active.from.y });
    const east = active.corner.includes("e"),
      south = active.corner.includes("s"),
      { anchor } = active;
    const room = Math.min(east ? natural.w - anchor.x : anchor.x, (south ? natural.h - anchor.y : anchor.y) * ratio);
    const pulled = Math.max((p.x - anchor.x) * (east ? 1 : -1), (p.y - anchor.y) * (south ? 1 : -1) * ratio);
    const w = Math.max(Math.min(pulled, room), Math.min(minWidth, room));
    const h = w / ratio;
    const next = { w, x: east ? anchor.x : anchor.x - w, y: south ? anchor.y : anchor.y - h };
    crops.current[mode] = next;
    setSides((prev) => ({ ...prev, [mode]: { ...prev[mode], crop: next, dirty: true } }));
    place(next, null);
  };
  const release = (event: ReactPointerEvent<HTMLDivElement>) => {
    pointers.current.delete(event.pointerId);
    const current = crops.current[mode];
    const left = [...pointers.current.entries()][0];
    if (left && current && gesture.current?.kind === "pinch")
      gesture.current = { kind: "move", id: left[0], from: toImage({ clientX: left[1].x, clientY: left[1].y }), start: current };
    else if (!left) gesture.current = null;
  };

  const keys = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const current = crops.current[mode];
    if (!current || !ready || busy || rotating) return;
    const step = (event.shiftKey ? 20 : 4) / fit;
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    if (moves[event.key]) {
      const [dx, dy] = moves[event.key];
      commit({ ...current, x: current.x + dx, y: current.y + dy }, transitions.responsive);
    } else if (event.key === "+" || event.key === "=") resizeBy(maxWidth * 0.1);
    else if (event.key === "-" || event.key === "_") resizeBy(-maxWidth * 0.1);
    else return;
    event.preventDefault();
  };

  async function exportSide(target: Target, onProgress: (fraction: number) => void) {
    const { element } = sides[target].image!;
    const area = crops.current[target]!;
    const shape = targets[target].ratio;
    const width = Math.max(1, Math.round(Math.min(targets[target].output, area.w)));
    const height = Math.max(1, Math.round(width / shape));
    const output = document.createElement("canvas");
    output.width = width;
    output.height = height;
    const context = output.getContext("2d");
    if (!context) throw new Error("裁剪失败，请重试。");
    context.fillStyle = "#0d0e11";
    context.fillRect(0, 0, width, height);
    context.imageSmoothingQuality = "high";
    context.drawImage(element, area.x, area.y, area.w, area.w / shape, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) => output.toBlob(resolve, "image/jpeg", 0.9));
    if (!blob) throw new Error("裁剪失败，请重试。");
    const uploaded = await uploadFile(new File([blob], targets[target].file, { type: "image/jpeg" }), onProgress);
    return uploaded.url;
  }

  async function save() {
    if (!complete) return;
    setBusy(true);
    setPercent(0);
    setError("");
    try {
      const saved: Record<Target, string> = { wide: banner, tall: bannerMobile };
      const changed = order.filter((target) => {
        const stored = target === "wide" ? banner : bannerMobile;
        return sides[target].dirty || !stored || sides[target].origin !== stored;
      });
      for (const [index, target] of changed.entries()) {
        saved[target] = await exportSide(target, (fraction) => setPercent(capPercent((index + fraction) / changed.length)));
      }
      if (!(await onSave({ banner: saved.wide, banner_mobile: saved.tall }))) setBusy(false);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  const drop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    setOver(false);
    if (!busy && !rotating) pick(event.dataTransfer.files?.[0]);
  };
  const share = ready ? Math.round((crop.w / maxWidth) * 100) : 100;
  const floor = ready ? Math.ceil((minWidth / maxWidth) * 100) : 100;
  const locked = busy || rotating || !!pending;

  return (
    <Modal
      title={banner ? "更换背景图像" : "上传背景图像"}
      onClose={() => !busy && !rotating && onCancel()}
      wide
      motionKey="profile-banner-editor"
      className={`banner-editor${busy ? " is-busy" : ""}`}
    >
      <h2>更改背景图像</h2>
      <div className="banner-targets">
        <GlassSegments<Target>
          className="banner-target-segs"
          label="要调整哪一端的背景图"
          value={mode}
          onChange={(next) => !busy && !rotating && setMode(next)}
          items={[
            { id: "wide", label: targets.wide.label, icon: <Monitor size={15} /> },
            { id: "tall", label: targets.tall.label, icon: <Smartphone size={15} /> },
          ]}
        />
        <p className="banner-target-hint">{hint}</p>
      </div>
      <div
        ref={stage}
        className={`banner-stage${image ? " has-image" : ""}${over ? " is-over" : ""}`}
        onDragOver={(event) => {
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
          if (!over) setOver(true);
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOver(false);
        }}
        onDrop={drop}
      >
        <AnimatePresence initial={false} mode="popLayout">
          {image ? (
            <motion.div
              key="canvas"
              ref={canvas}
              className={`banner-canvas${locked ? " is-locked" : ""}`}
              style={{ width: (natural?.w || 0) * fit, height: (natural?.h || 0) * fit }}
              initial={reduced ? false : enter}
              animate={ready ? rest : { opacity: 0 }}
              exit={leave}
              transition={transitions.responsive}
              onPointerDown={down}
              onPointerMove={drag}
              onPointerUp={release}
              onPointerCancel={release}
            >
              <img src={image.url} alt="已选择的背景图" draggable={false} />
              <div className="banner-shade" aria-hidden="true">
                <motion.span style={{ x: bx, y: by, width: bw, height: bh }} />
              </div>
              <motion.div
                ref={box}
                className="banner-box"
                style={{ x: bx, y: by, width: bw, height: bh }}
                tabIndex={0}
                role="group"
                aria-label={`${targets[mode].label}背景图选取框，宽度为可选范围的 ${share}%。方向键移动，加号、减号放大缩小`}
                onKeyDown={keys}
              >
                <i className="banner-grid" aria-hidden="true" />
                {corners.map((corner) => (
                  <span key={corner} className="banner-handle" data-corner={corner} aria-hidden="true" />
                ))}
              </motion.div>
            </motion.div>
          ) : (
            <motion.div
              key="empty"
              className="banner-drop"
              initial={reduced ? false : enter}
              animate={rest}
              exit={leave}
              transition={transitions.responsive}
            >
              <LiquidButton type="button" className="banner-drop-button" disabled={!!pending} onClick={() => input.current?.click()}>
                <span className="banner-drop-icon">
                  {pending ? <LoaderCircle className="spin" size={22} /> : <ImagePlus size={22} strokeWidth={1.6} />}
                </span>
                <strong>{pending ? "正在读取图片…" : over ? "松开即可使用这张图片" : "拖入图片，或点击选择"}</strong>
                <small>选好后可以框选要显示的范围</small>
              </LiquidButton>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      <div className={`avatar-tools banner-tools${ready ? "" : " is-idle"}`}>
        <LiquidButton
          type="button"
          className="icon-button"
          aria-label="缩小选取框"
          disabled={!ready || locked || share <= floor}
          onClick={() => resizeBy(-maxWidth * 0.1)}
        >
          <Minus size={17} />
        </LiquidButton>
        <input
          type="range"
          aria-label="选取框大小"
          aria-valuetext={`${share}%`}
          min={Math.min(floor, 100)}
          max={100}
          step={1}
          value={share}
          disabled={!ready || locked || floor >= 100}
          onChange={(event) => {
            const current = crops.current[mode];
            if (current) resizeAround(current, (Number(event.target.value) / 100) * maxWidth);
          }}
        />
        <LiquidButton
          type="button"
          className="icon-button"
          aria-label="放大选取框"
          disabled={!ready || locked || share >= 100}
          onClick={() => resizeBy(maxWidth * 0.1)}
        >
          <Plus size={17} />
        </LiquidButton>
        <LiquidButton
          type="button"
          className="icon-button"
          aria-label="重置选取框：最大并居中"
          title="重置选取框"
          disabled={!ready || locked}
          onClick={() => natural && image && commit(centred(image.element, ratio), transitions.responsive)}
        >
          <Scan size={17} />
        </LiquidButton>
        <LiquidButton
          type="button"
          className="icon-button"
          aria-label="向右旋转 90 度"
          title="旋转"
          disabled={!ready || locked}
          onClick={rotate}
        >
          {rotating ? <LoaderCircle className="spin" size={17} /> : <RotateCw size={17} />}
        </LiquidButton>
      </div>
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif,image/avif"
        hidden
        onChange={(event) => {
          const next = event.target.files?.[0];
          event.target.value = "";
          pick(next);
        }}
      />
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="library-form-actions">
        {image ? (
          <LiquidButton type="button" className="button secondary" disabled={locked} onClick={() => input.current?.click()}>
            <RefreshCw size={15} />
            换一张
          </LiquidButton>
        ) : (
          <LiquidButton type="button" className="button secondary" onClick={onCancel}>
            取消
          </LiquidButton>
        )}
        <LiquidButton type="button" className="button primary" disabled={!complete || !ready || locked} onClick={save}>
          {busy ? <UploadProgress percent={percent} /> : <Check size={16} />}
          {busy ? "正在上传…" : "使用这张背景图"}
        </LiquidButton>
      </div>
    </Modal>
  );
}
