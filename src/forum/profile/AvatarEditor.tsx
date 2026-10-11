import { LiquidButton } from "../motion/LiquidButton";
import { AnimatePresence, animate, motion, useMotionValue } from "motion/react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { Check, LoaderCircle, Minus, Plus, RotateCw } from "lucide-react";
import { ModalRegistration as Modal } from "../motion/OverlayHost";
import { useMotionPreferences } from "../motion/motion-preferences";
import { transitions } from "../motion/motion-tokens";
import { rotateQuarterTurn } from "../posts/image-rotate";
import { uploadFile } from "../api";
import { UploadProgress, capPercent } from "../ui/UploadProgress";

const MIN_BOX = 60;

type Crop = { x: number; y: number; w: number };
type Corner = "nw" | "ne" | "sw" | "se";
type Spring = (typeof transitions)[keyof typeof transitions] | null;
type Gesture =
  | { kind: "move"; id: number; from: { x: number; y: number }; start: Crop }
  | { kind: "resize"; id: number; corner: Corner; anchor: { x: number; y: number } }
  | { kind: "pinch"; distance: number; start: Crop };

const corners: Corner[] = ["nw", "ne", "sw", "se"];
const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));
const enter = { opacity: 0, y: 6, filter: "blur(3px)" };
const rest = { opacity: 1, y: 0, filter: "blur(0px)" };
const leave = { opacity: 0, y: -4, filter: "blur(2px)" };

const COVER_ASPECT = 16 / 10;
const variants = {
  avatar: {
    aspect: 1,
    output: 512,
    title: "调整头像",
    heading: "选一张，作为你的样子。",
    note: "拖动或缩放圆形取景框调整范围，用下面的按钮微调大小或旋转照片。圆形区域里看到的，就是保存后的头像。",
    box: "头像取景框",
    file: "avatar.png",
    confirm: "使用这张头像",
  },
  cover: {
    aspect: COVER_ASPECT,
    output: 960,
    title: "调整封面",
    heading: "选一段，作为收藏夹的门面。",
    note: "拖动或缩放取景框调整范围，用下面的按钮微调大小或旋转图片。框里看到的，就是保存后的封面。",
    box: "封面取景框",
    file: "cover.png",
    confirm: "使用这张封面",
  },
};

export default function AvatarEditor({
  file,
  onCancel,
  onSave,
  variant = "avatar",
}: {
  file: File;
  onCancel: () => void;
  onSave: (url: string) => Promise<void> | void;
  variant?: keyof typeof variants;
}) {
  const copy = variants[variant],
    aspect = copy.aspect;
  const { reduced } = useMotionPreferences();
  const [image, setImage] = useState<{ element: HTMLImageElement; url: string } | null>(null),
    [crop, setCrop] = useState<Crop | null>(null),
    [measured, setMeasured] = useState({ url: "", scale: 0 }),
    [busy, setBusy] = useState(false),
    [percent, setPercent] = useState(0),
    [rotating, setRotating] = useState(false),
    [error, setError] = useState("");
  const stage = useRef<HTMLDivElement>(null),
    canvas = useRef<HTMLDivElement>(null),
    box = useRef<HTMLDivElement>(null);
  const cropRef = useRef<Crop | null>(null),
    gesture = useRef<Gesture | null>(null),
    pointers = useRef(new Map<number, { x: number; y: number }>()),
    enteredFor = useRef("");
  const bx = useMotionValue(0),
    by = useMotionValue(0),
    bw = useMotionValue(0),
    bh = useMotionValue(0);

  const natural = image ? { w: image.element.naturalWidth, h: image.element.naturalHeight } : null;
  const fit = image && measured.url === image.url ? measured.scale : 0;
  const maxWidth = natural ? Math.min(natural.w, natural.h * aspect) : 0;
  const minWidth = fit ? Math.min(maxWidth, (MIN_BOX * Math.max(1, aspect)) / fit) : maxWidth;
  const ready = !!natural && !!crop && fit > 0;

  useEffect(() => {
    const url = URL.createObjectURL(file);
    const element = new Image();
    let active = true;
    element.onload = () => {
      if (!active) return;
      const w = Math.min(element.naturalWidth, element.naturalHeight * aspect);
      const initial = { w, x: (element.naturalWidth - w) / 2, y: (element.naturalHeight - w / aspect) / 2 };
      cropRef.current = initial;
      setCrop(initial);
      setImage({ element, url });
    };
    element.onerror = () => {
      if (!active) return;
      setError("这张图片打不开，换一张试试。");
    };
    element.src = url;
    return () => {
      active = false;
      URL.revokeObjectURL(url);
    };
  }, [file]);

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
    (next: Crop, spring: Spring) => {
      const targets = [next.x * fit, next.y * fit, next.w * fit, (next.w / aspect) * fit];
      [bx, by, bw, bh].forEach((value, i) => {
        if (spring && !reduced) animate(value, targets[i], spring);
        else value.jump(targets[i]);
      });
    },
    [bx, by, bw, bh, fit, reduced, aspect],
  );

  useLayoutEffect(() => {
    if (!image || !fit || !cropRef.current) return;
    if (enteredFor.current === image.url) return place(cropRef.current, null);
    enteredFor.current = image.url;
    bx.jump(0);
    by.jump(0);
    bw.jump(image.element.naturalWidth * fit);
    bh.jump(image.element.naturalHeight * fit);
    place(cropRef.current, transitions.surface);
  }, [image, fit, place, bx, by, bw, bh]);

  const commit = (next: Crop, spring: Spring = null) => {
    if (!natural) return;
    const w = clamp(next.w, minWidth, maxWidth);
    const settled = {
      w,
      x: clamp(next.x, 0, natural.w - w),
      y: clamp(next.y, 0, natural.h - w / aspect),
    };
    cropRef.current = settled;
    setCrop(settled);
    place(settled, spring);
  };
  const resizeAround = (start: Crop, width: number, spring: Spring = null) => {
    const w = clamp(width, minWidth, maxWidth);
    const cx = start.x + start.w / 2,
      cy = start.y + start.w / aspect / 2;
    commit({ w, x: cx - w / 2, y: cy - w / aspect / 2 }, spring);
  };
  const resizeBy = (delta: number) => cropRef.current && resizeAround(cropRef.current, cropRef.current.w + delta, transitions.responsive);

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const wheel = (event: WheelEvent) => {
      const current = cropRef.current;
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
    const current = cropRef.current;
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
      gesture.current = {
        kind: "resize",
        id: event.pointerId,
        corner,
        anchor: {
          x: corner.includes("w") ? current.x + current.w : current.x,
          y: corner.includes("n") ? current.y + current.w / aspect : current.y,
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
    const room = Math.min(east ? natural.w - anchor.x : anchor.x, (south ? natural.h - anchor.y : anchor.y) * aspect);
    const pulled = Math.max((p.x - anchor.x) * (east ? 1 : -1), (p.y - anchor.y) * (south ? 1 : -1) * aspect);
    const w = Math.max(Math.min(pulled, room), Math.min(minWidth, room));
    cropRef.current = { w, x: east ? anchor.x : anchor.x - w, y: south ? anchor.y : anchor.y - w / aspect };
    setCrop(cropRef.current);
    place(cropRef.current, null);
  };
  const release = (event: ReactPointerEvent<HTMLDivElement>) => {
    pointers.current.delete(event.pointerId);
    const current = cropRef.current;
    const left = [...pointers.current.entries()][0];
    if (left && current && gesture.current?.kind === "pinch")
      gesture.current = { kind: "move", id: left[0], from: toImage({ clientX: left[1].x, clientY: left[1].y }), start: current };
    else if (!left) gesture.current = null;
  };

  const keys = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const current = cropRef.current;
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

  async function rotate() {
    if (!image || busy || rotating) return;
    setRotating(true);
    setError("");
    try {
      const { url } = await rotateQuarterTurn(image.element);
      const element = new Image();
      element.onload = () => {
        const old = image.url;
        const w = Math.min(element.naturalWidth, element.naturalHeight * aspect);
        cropRef.current = { w, x: (element.naturalWidth - w) / 2, y: (element.naturalHeight - w / aspect) / 2 };
        setCrop(cropRef.current);
        setImage({ element, url });
        setRotating(false);
        URL.revokeObjectURL(old);
      };
      element.onerror = () => {
        setError("旋转失败，请重试。");
        setRotating(false);
        URL.revokeObjectURL(url);
      };
      element.src = url;
    } catch (e) {
      setError((e as Error).message);
      setRotating(false);
    }
  }

  async function save() {
    const current = cropRef.current;
    if (!image || !current) return;
    setBusy(true);
    setPercent(0);
    setError("");
    try {
      const output = document.createElement("canvas");
      output.width = copy.output;
      output.height = Math.round(copy.output / aspect);
      const context = output.getContext("2d");
      if (!context) throw new Error("裁剪失败，请重试。");
      context.imageSmoothingQuality = "high";
      context.drawImage(image.element, current.x, current.y, current.w, current.w / aspect, 0, 0, output.width, output.height);
      const blob = await new Promise<Blob | null>((resolve) => output.toBlob(resolve, "image/png"));
      if (!blob) throw new Error("裁剪失败，请重试。");
      const uploaded = await uploadFile(new File([blob], copy.file, { type: "image/png" }), (fraction) => setPercent(capPercent(fraction)));
      await onSave(uploaded.url);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  const share = ready ? Math.round((crop.w / maxWidth) * 100) : 100;
  const floor = ready ? Math.ceil((minWidth / maxWidth) * 100) : 100;

  return (
    <Modal
      title={copy.title}
      onClose={() => !busy && !rotating && onCancel()}
      className={`avatar-editor${variant === "cover" ? " is-cover" : ""}`}
    >
      <h2>{copy.heading}</h2>
      <p className="modal-note">{copy.note}</p>
      <div ref={stage} className="avatar-stage">
        <AnimatePresence initial={false} mode="popLayout">
          {image ? (
            <motion.div
              key="canvas"
              ref={canvas}
              className={`avatar-canvas${busy || rotating ? " is-locked" : ""}`}
              style={{ width: natural!.w * fit, height: natural!.h * fit }}
              initial={reduced ? false : enter}
              animate={ready ? rest : { opacity: 0 }}
              exit={leave}
              transition={transitions.responsive}
              onPointerDown={down}
              onPointerMove={drag}
              onPointerUp={release}
              onPointerCancel={release}
            >
              <img src={image.url} alt="已选择的照片" draggable={false} />
              <div className="avatar-shade" aria-hidden="true">
                <motion.span style={{ x: bx, y: by, width: bw, height: bh }} />
              </div>
              <motion.div
                ref={box}
                className="avatar-box"
                style={{ x: bx, y: by, width: bw, height: bh }}
                tabIndex={0}
                role="group"
                aria-label={`${copy.box}，宽度为可选范围的 ${share}%。方向键移动，加号、减号放大缩小`}
                onKeyDown={keys}
              >
                {corners.map((corner) => (
                  <span key={corner} className="avatar-handle" data-corner={corner} aria-hidden="true" />
                ))}
              </motion.div>
            </motion.div>
          ) : (
            <motion.div
              key="empty"
              className="small-loading"
              initial={reduced ? false : enter}
              animate={rest}
              exit={leave}
              transition={transitions.responsive}
            >
              <LoaderCircle className="spin" size={22} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      <div className={`avatar-tools${ready ? "" : " is-idle"}`}>
        <LiquidButton
          type="button"
          className="icon-button"
          aria-label="缩小取景框"
          disabled={!ready || busy || rotating || share <= floor}
          onClick={() => resizeBy(-maxWidth * 0.1)}
        >
          <Minus size={17} />
        </LiquidButton>
        <input
          type="range"
          aria-label="取景框大小"
          aria-valuetext={`${share}%`}
          min={Math.min(floor, 100)}
          max={100}
          step={1}
          value={share}
          disabled={!ready || busy || rotating || floor >= 100}
          onChange={(event) => cropRef.current && resizeAround(cropRef.current, (Number(event.target.value) / 100) * maxWidth)}
        />
        <LiquidButton
          type="button"
          className="icon-button"
          aria-label="放大取景框"
          disabled={!ready || busy || rotating || share >= 100}
          onClick={() => resizeBy(maxWidth * 0.1)}
        >
          <Plus size={17} />
        </LiquidButton>
        <LiquidButton
          type="button"
          className="icon-button"
          aria-label="向右旋转 90 度"
          title="旋转"
          disabled={!ready || busy || rotating}
          onClick={rotate}
        >
          {rotating ? <LoaderCircle className="spin" size={17} /> : <RotateCw size={17} />}
        </LiquidButton>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="library-form-actions">
        <LiquidButton type="button" className="button secondary" onClick={onCancel}>
          取消
        </LiquidButton>
        <LiquidButton
          type="button"
          className="button primary"
          disabled={!ready || busy || rotating}
          onClick={save}
        >
          {busy ? <UploadProgress percent={percent} /> : <Check size={16} />}
          {copy.confirm}
        </LiquidButton>
      </div>
    </Modal>
  );
}
