import { createRef, useEffect, useId, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { MoveUpRight, Pause, Play, RotateCcw } from "lucide-react";
import type { MotionValue } from "motion/react";
import { LiquidButton } from "../motion/LiquidButton";
import { LiquidPopover } from "../motion/LiquidPopover";
import { useMotionPreferences } from "../motion/motion-preferences";
import { nearestAngle, stepSpring } from "../motion/spring-physics";
import { createAtom, NUCLEON_LAYOUT, NUCLEON_RADIUS, orbitPath, updateElectrons } from "./atom-scene";
import { atomTopics } from "./atom-topics";
import { placeAtomLabels, type AtomLabelRect, type AtomLabelState } from "./atom-label-layout";

const fallbackNucleons = NUCLEON_LAYOUT.map(({ position, kind }) => ({
  kind,
  position: new THREE.Vector3(...position).applyEuler(new THREE.Euler(.27, -.44, -.14)),
})).sort((a, b) => a.position.z - b.position.z);

export default function Orbital({ variant = 0, onVariant, onExplore, progress }: { variant?: number; onVariant?: (index: number) => void; onExplore?: (id: string) => void; progress?: MotionValue<number> }) {
  const fallbackId = useId().replace(/:/g, "");
  const host = useRef<HTMLDivElement>(null), labels = useRef<(HTMLDivElement | null)[]>([]), stage = useRef<HTMLDivElement>(null);
  const topicTriggers = useMemo(() => atomTopics.map(() => createRef<HTMLButtonElement>()), []);
  const trigger = useRef<() => void>(() => {});
  const control = useRef({ paused: false, reset: false, variant: 0, onVariant, scroll: 0 });
  const [paused, setPaused] = useState(false), [failed, setFailed] = useState(false);
  const { reduced, quality } = useMotionPreferences();
  control.current.variant = variant; control.current.onVariant = onVariant;
  useEffect(() => { trigger.current(); }, [variant]);
  useEffect(() => progress?.on("change", (value) => { control.current.scroll = value; trigger.current(); }), [progress]);
  useEffect(() => {
    const el = host.current!;
    const lite = quality !== "full" || matchMedia("(max-width: 760px), (pointer: coarse)").matches;
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: lite ? "low-power" : "high-performance" }); }
    catch { setFailed(true); return; }
    setFailed(false);
    renderer.setPixelRatio(1);
    renderer.setClearColor(0x000000, 0); renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.03;
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(35, 1, 0.1, 80);
    const pmrem = new THREE.PMREMGenerator(renderer), environment = new RoomEnvironment(), env = pmrem.fromScene(environment, .025);
    scene.environment = env.texture;
    [[0xfff1df,1.7,3,5,5],[0xcbd9ed,1.1,-4,-1,4],[0xffffff,1.2,0,2,-4]].forEach(([color,intensity,x,y,z]) => { const light = new THREE.DirectionalLight(color,intensity); light.position.set(x,y,z); scene.add(light); });
    const atom = createAtom(lite); scene.add(atom.group);
    atom.trails.forEach(trail => { trail.visible = !reduced; });
    let width = 1, height = 1, bleed = 0, visible = true, disposed = false, raf = 0, last = 0, elapsed = 0, selected = -1, activeFrames = 90;
    const yaw = { value: -.4, velocity: 0 }, pitch = { value: .12, velocity: 0 }, distance = { value: 10.3, velocity: 0 };
    let targetYaw = -.4, dragYaw = 0, pointerX = 0, pointerY = 0, pointerBounds: DOMRect | null = null;
    let startX = 0, startY = 0, lastX = 0, dragging = false, down = false, activePointer: number | null = null;
    const world = new THREE.Vector3(), projected = new THREE.Vector3(), raycaster = new THREE.Raycaster();
    const schedule = () => { if (!raf && !disposed && visible && !document.hidden) raf = requestAnimationFrame(render); };
    const wake = () => { activeFrames = 90; schedule(); }; trigger.current = wake;
    const mobileLabels = matchMedia("(max-width: 600px)");
    let labelSizes = labels.current.map(label => ({ width: label?.offsetWidth || 110, height: label?.offsetHeight || 40 }));
    let labelStates: AtomLabelState[] = [], labelPositions: AtomLabelRect[] = [], labelObstacles: AtomLabelRect[] = [];
    const labelLayoutNodes = new Set<HTMLElement>();
    const layoutBox = (node: HTMLElement): AtomLabelRect => {
      let x = 0, y = 0, current: HTMLElement | null = node;
      while (current && current !== stage.current) {
        x += current.offsetLeft; y += current.offsetTop;
        current = current.offsetParent as HTMLElement | null;
        if (current && current !== stage.current) { x += current.clientLeft; y += current.clientTop; }
      }
      return { x, y, width: node.offsetWidth, height: node.offsetHeight };
    };
    const cacheLabelLayout = () => {
      labelSizes = labels.current.map(label => ({ width: label?.offsetWidth || 110, height: label?.offsetHeight || 40 }));
      labelObstacles = Array.from(stage.current?.querySelectorAll<HTMLElement>(".atom-topic-details, .scene-controls") || [])
        .map(layoutBox).filter(box => box.width > 0 && box.height > 0);
      wake();
    };
    const labelObserver = new ResizeObserver(cacheLabelLayout);
    const observeLabelLayout = () => {
      const next = new Set(Array.from(stage.current?.querySelectorAll<HTMLElement>(".atom-label, .atom-inspector, .atom-topic-details, .scene-controls") || []));
      for (const node of labelLayoutNodes) if (!next.has(node)) { labelObserver.unobserve(node); labelLayoutNodes.delete(node); }
      for (const node of next) if (!labelLayoutNodes.has(node)) { labelObserver.observe(node); labelLayoutNodes.add(node); }
      cacheLabelLayout();
    };
    const labelMutations = new MutationObserver(observeLabelLayout);
    const inspector = stage.current?.querySelector(".atom-inspector");
    if (inspector) labelMutations.observe(inspector, { childList: true, subtree: true });
    observeLabelLayout();
    const resize = () => { const r = el.getBoundingClientRect(); width = r.width; height = r.height; if (!width || !height) return; pointerBounds = r;
      const pin = el.closest(".home-hero-pin"); bleed = pin ? Math.max(0, Math.round(r.left - pin.getBoundingClientRect().left)) : 0;
      Object.assign(renderer.domElement.style, { position: "absolute", top: "0", left: `${-bleed}px`, width: `${width + bleed}px`, height: `${height}px`, pointerEvents: "none" });
      const nativeRatio = Math.max(1, window.devicePixelRatio || 1);
      const pixelBudget = lite ? 1_600_000 : 4_500_000;
      const ratio = Math.min(Math.max(nativeRatio, 1.5), lite ? 2 : 2.5, Math.sqrt(pixelBudget / ((width + bleed) * height)));
      renderer.setPixelRatio(Math.max(.5, ratio)); renderer.setSize(width + bleed,height,false);
      renderer.domElement.dataset.renderRatio = renderer.getPixelRatio().toFixed(2);
      renderer.domElement.dataset.antialias = String(renderer.getContext().getContextAttributes()?.antialias === true);
      camera.aspect = width / height;
      if (bleed) camera.setViewOffset(width, height, -bleed, 0, width + bleed, height); else camera.clearViewOffset();
      camera.updateProjectionMatrix(); cacheLabelLayout(); wake(); };
    function render(now: number) {
      raf = 0; if (disposed || !visible || document.hidden) return;
      const dt = Math.min((now - (last || now)) / 1000, .04); last = now;
      if (!control.current.paused && !reduced) elapsed += dt;
      updateElectrons(atom.electrons, elapsed);
      atom.group.updateMatrixWorld(true);
      if (selected !== control.current.variant || control.current.reset) {
        selected = THREE.MathUtils.clamp(Math.floor(control.current.variant), 0, atom.electrons.length - 1);
        atom.electrons[selected].getWorldPosition(world);
        targetYaw = nearestAngle(yaw.value, -.22 + Math.sin(Math.atan2(world.x,world.z)) * .28);
        dragYaw = 0; control.current.reset = false; activeFrames = 90;
      }
      const scroll = reduced ? 0 : control.current.scroll;
      const goalYaw = targetYaw + dragYaw + (reduced ? 0 : pointerX * .18 + scroll * 1.25);
      const goalPitch = [.16,-.12,.32][selected] + (reduced ? 0 : pointerY * .09 + scroll * .2);
      const baseDistance = width < 500 ? 10.8 : 8.6, goalDistance = baseDistance + scroll * 3.5;
      if (reduced) { yaw.value = goalYaw; pitch.value = goalPitch; distance.value = baseDistance; }
      else { stepSpring(yaw,goalYaw,dt,80,18); stepSpring(pitch,goalPitch,dt,90,20); stepSpring(distance,goalDistance,dt,95,20); }
      camera.position.set(Math.sin(yaw.value)*Math.cos(pitch.value)*distance.value, Math.sin(pitch.value)*distance.value, Math.cos(yaw.value)*Math.cos(pitch.value)*distance.value);
      const roll = reduced ? 0 : THREE.MathUtils.clamp(yaw.velocity * .015, -.07, .07) + scroll * .035;
      camera.up.set(Math.sin(roll),Math.cos(roll),0); camera.lookAt(0,0,0); camera.updateMatrixWorld();
      renderer.render(scene,camera);
      const anchors = atom.electrons.map((electron,i) => {
        electron.getWorldPosition(projected); projected.project(camera);
        return { x: (projected.x*.5+.5)*(width+bleed)-bleed, y: (-projected.y*.5+.5)*height, ...labelSizes[i], depth: projected.z };
      });
      if (!mobileLabels.matches) {
        projected.set(0, 0, 0).project(camera);
        const centerX = (projected.x * .5 + .5) * (width + bleed) - bleed, centerY = (-projected.y * .5 + .5) * height;
        const coreRadius = height * .48 / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * Math.max(1, distance.value - .48));
        const core = { x: centerX - coreRadius, y: centerY - coreRadius, width: coreRadius * 2, height: coreRadius * 2 };
        ({ states: labelStates, rects: labelPositions } = placeAtomLabels(anchors, labelStates, { width, height }, [...labelObstacles, core], { x: centerX, y: centerY }, dt, reduced));
      }
      anchors.forEach((anchor, i) => {
        const label = labels.current[i]; if (!label) return;
        if (!mobileLabels.matches) {
          const position = labelPositions[i];
          label.style.transform = `translate3d(${position.x}px,${position.y}px,0)`;
        }
        label.style.zIndex = i === selected ? "6" : "3";
        label.style.setProperty("--electron-depth", i === selected ? "1" : String(THREE.MathUtils.clamp(1-(anchor.depth-.96)*18,.48,.82)));
      });
      stage.current?.classList.add("is-ready");
      activeFrames--;
      if ((!control.current.paused && !reduced) || (!reduced && activeFrames > 0)) schedule();
    }
    const observer = new ResizeObserver(resize); observer.observe(el); resize();
    const intersection = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; if (visible) { last = 0; wake(); } else { cancelAnimationFrame(raf); raf = 0; } }); intersection.observe(el);
    const visibility = () => { if (document.hidden) { cancelAnimationFrame(raf); raf = 0; } else { last = 0; wake(); } }; document.addEventListener("visibilitychange",visibility);
    const enter = () => { pointerBounds = el.getBoundingClientRect(); };
    const move = (event: PointerEvent) => {
      if (!pointerBounds || (down && event.pointerId !== activePointer)) return;
      if (event.pointerType === "mouse") { pointerX = (event.clientX-pointerBounds.left)/width-.5; pointerY = (event.clientY-pointerBounds.top)/height-.5; }
      if (down && !dragging && Math.abs(event.clientX-startX)>7 && Math.abs(event.clientX-startX)>Math.abs(event.clientY-startY)) { dragging = true; el.setPointerCapture(event.pointerId); }
      if (dragging) dragYaw -= (event.clientX-lastX)*.007;
      lastX = event.clientX; if (dragging || !reduced) wake();
    };
    const pointerDown = (event: PointerEvent) => { if (event.button !== 0 || down) return; enter(); activePointer = event.pointerId; down = true; startX = lastX = event.clientX; startY = event.clientY; };
    const pointerUp = (event: PointerEvent) => {
      if (event.pointerId !== activePointer) return;
      if (down && !dragging && event.type !== "pointercancel" && pointerBounds && Math.hypot(event.clientX-startX,event.clientY-startY) < 7) {
        const point = new THREE.Vector2((event.clientX-pointerBounds.left+bleed)/(width+bleed)*2-1,-(event.clientY-pointerBounds.top)/height*2+1);
        raycaster.setFromCamera(point,camera); const hit = raycaster.intersectObjects(atom.electrons)[0]; if (hit) control.current.onVariant?.(hit.object.userData.topic);
      }
      down = dragging = false; activePointer = null; if (el.hasPointerCapture(event.pointerId)) el.releasePointerCapture(event.pointerId);
    };
    const cancel = () => { const pointer = activePointer; activePointer = null; down = dragging = false; pointerX = pointerY = 0; if (pointer !== null && el.hasPointerCapture(pointer)) el.releasePointerCapture(pointer); wake(); };
    const leave = () => { if (!dragging) cancel(); };
    el.addEventListener("pointerenter",enter); el.addEventListener("pointermove",move); el.addEventListener("pointerdown",pointerDown); el.addEventListener("pointerup",pointerUp); el.addEventListener("pointercancel",pointerUp); el.addEventListener("pointerleave",leave); el.addEventListener("lostpointercapture",cancel); window.addEventListener("blur",cancel);
    const lost = (event: Event) => { event.preventDefault(); setFailed(true); disposed = true; cancelAnimationFrame(raf); };
    renderer.domElement.addEventListener("webglcontextlost",lost);
    schedule();
    return () => { disposed = true; cancelAnimationFrame(raf); observer.disconnect(); labelObserver.disconnect(); labelMutations.disconnect(); intersection.disconnect(); document.removeEventListener("visibilitychange",visibility); el.removeEventListener("pointerenter",enter); el.removeEventListener("pointermove",move); el.removeEventListener("pointerdown",pointerDown); el.removeEventListener("pointerup",pointerUp); el.removeEventListener("pointercancel",pointerUp); el.removeEventListener("pointerleave",leave); el.removeEventListener("lostpointercapture",cancel); window.removeEventListener("blur",cancel); renderer.domElement.removeEventListener("webglcontextlost",lost); atom.dispose(); env.dispose(); environment.dispose(); pmrem.dispose(); renderer.dispose(); renderer.domElement.remove(); trigger.current = () => {}; };
  }, [reduced, quality]);
  return <div ref={stage} className={`orbital-stage atom-stage ${failed ? "atom-static is-ready" : ""}`}>
    <div className="orbital-canvas" ref={host} role="img" aria-label="风格化原子：暖金色质子与冷蓝色中子交错组成紧凑原子核，三条相交椭圆轨道上各有一颗电子。可横向拖动旋转视角。" />
    {failed && <svg className="atom-fallback" viewBox="0 0 600 460" role="img" aria-label="两色核子交错堆积，三条相交椭圆围绕原子核的静态示意图">
      <defs>
        <linearGradient id={`${fallbackId}-silver`}><stop stopColor="#68727e"/><stop offset=".35" stopColor="#e1e3e5"/><stop offset=".65" stopColor="#909ba8"/><stop offset="1" stopColor="#d3bca2"/></linearGradient>
        <radialGradient id={`${fallbackId}-proton`} cx="32%" cy="24%" r="76%"><stop stopColor="#f4dec0"/><stop offset=".48" stopColor="#d8af84"/><stop offset="1" stopColor="#6b4f3a"/></radialGradient>
        <radialGradient id={`${fallbackId}-neutron`} cx="32%" cy="24%" r="76%"><stop stopColor="#e2edf7"/><stop offset=".48" stopColor="#94aec9"/><stop offset="1" stopColor="#43596f"/></radialGradient>
      </defs>
      <g transform="translate(300 230) rotate(-8)" fill="none" stroke={`url(#${fallbackId}-silver)`} strokeWidth="2.5">{[0,60,-60].map(angle => <path key={angle} transform={`rotate(${angle})`} d={orbitPath()}/>)}</g>
      <g>{fallbackNucleons.map(({ position, kind }, i) => <circle key={i} cx={300 + position.x * 78} cy={230 - position.y * 78} r={NUCLEON_RADIUS * 78} fill={`url(#${fallbackId}-${kind})`}/>)}</g>
      <g fill={`url(#${fallbackId}-silver)`}>{[[460,190],[231,98],[217,365]].map(([x,y],i) => <circle key={i} cx={x} cy={y} r="8"/>)}</g>
    </svg>}
    <div className="atom-labels">{atomTopics.map((topic,i) => <div className={`atom-label ${variant === i ? "selected" : ""}`} key={topic.id} ref={(el) => { labels.current[i] = el; }} data-popover-owner="atom-topic">
      <LiquidButton ref={topicTriggers[i]} type="button" className="atom-label-button" onClick={() => onVariant?.(i)} aria-expanded={variant === i}><span className="orbit-dot"/><span>{topic.title}</span><MoveUpRight size={11}/></LiquidButton>

    </div>)}</div>
    <div className="atom-inspector">{atomTopics.map((topic, i) => <LiquidPopover key={topic.id} open={variant === i} triggerRef={topicTriggers[i]} className="atom-topic-details" role="region" label={topic.title + "简介"}><div><small>{topic.english}</small><p>{topic.description}</p>{onExplore && <LiquidButton type="button" onClick={() => onExplore(topic.id)}>进入{topic.title} <MoveUpRight size={12}/></LiquidButton>}</div></LiquidPopover>)}</div>
    <div className="scene-controls"><span>{reduced || failed ? "静态视图" : "拖动，换个视角"}</span><LiquidButton type="button" disabled={reduced || failed} aria-label={paused ? "播放 3D 动画" : "暂停 3D 动画"} aria-pressed={paused} onClick={() => { control.current.paused = !paused; setPaused(!paused); trigger.current(); }}>{paused ? <Play size={13}/> : <Pause size={13}/>}</LiquidButton><LiquidButton type="button" disabled={failed} aria-label="重置 3D 视角" onClick={() => { control.current.reset = true; trigger.current(); }}><RotateCcw size={13}/></LiquidButton></div>
  </div>;
}
