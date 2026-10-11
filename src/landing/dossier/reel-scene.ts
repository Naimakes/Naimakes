import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { CSS3DObject, CSS3DRenderer } from "three/addons/renderers/CSS3DRenderer.js";
import { LineSegments2 } from "three/addons/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/addons/lines/LineSegmentsGeometry.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import reelDeviceUrl from "../models/reel-device.glb?url";
import { createGL, type GLStage } from "./webgl-helpers";
import { CARD_BOX, createDeviceCard } from "./reel-card";
import { CameraPath, orbitDirections, type CameraKey } from "./camera-path";
import { easeInCubic, easeInOutCubic, lerp, smoothstep, span } from "./cinema-helpers";
import { FRONT_VIEW } from "./dossier-approach";
import "./reel-scene.css";

export const REEL_DURATION = 10.7;

export type CardView = {
  card: number[];
  camera: number[];
  fov: number;
  face: { width: number; height: number; center: [number, number, number] };
};

const plan = (x: number, y: number, h = 0) => new THREE.Vector3(x, h, -y);

const CARD = { center: plan(0.457, 0.03), width: 5.48, height: 5.48 / 1.5 };
const CARD_SCALE = CARD.width / CARD_BOX.width;
const CARD_THICKNESS = 110 * CARD_SCALE;

const HFOV_FLAT = THREE.MathUtils.degToRad(12);
const HFOV_3D = 2 * Math.atan(18 / 78);
const OBLIQUE = { target: plan(0.5049, 0.1697), azimuth: 119.419, elevation: 34.886, distance: 10.504 };
const PLAN_VIEW = { center: plan(0.52, 0.21), width: 5.03, height: 2.56 };
const DOWN = new THREE.Vector3(0, -1, 0);
const NORTH = new THREE.Vector3(0, 0, -1);

const T = {
  shell: [1.7, 0.85] as const,
  plan: 2.85,
  tilt: [2.85, 2.0] as const,
  oblique: 4.75,
  orbitEnd: 9.95,
  rush: [9.95, 0.75] as const,
};

type Fade = { material: THREE.Material & { opacity: number }; base: number };

export class DeviceScene {
  private root: HTMLDivElement;
  private glHost: HTMLDivElement;
  private gl: GLStage;
  private css = new CSS3DRenderer();
  private scene = new THREE.Scene();
  private cssScene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(15, 16 / 9, 0.05, 200);
  private card: CSS3DObject;
  private cardElement: HTMLElement;
  private hemi = new THREE.HemisphereLight("#ffffff", "#cfc8bf", 2.0);
  private sun = new THREE.DirectionalLight("#fff6ec", 0.5);
  private floor: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private reels: THREE.Object3D[] = [];
  private ribbonFades: Fade[] = [];
  private lineMaterials: LineMaterial[] = [];
  private edgeFades: Fade[] = [];
  private siteLines: Fade[] = [];
  private orange?: THREE.MeshStandardMaterial;
  private occluder = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: true, transparent: true, polygonOffset: true, polygonOffsetFactor: 1.5, polygonOffsetUnits: 2 });
  private path?: CameraPath;
  private disposed = false;
  private rushing = false;

  private view?: CardView;
  readonly ready: Promise<void>;

  constructor(private host: HTMLElement, number: number) {
    this.root = document.createElement("div");
    this.root.className = "dv-root";
    host.append(this.root);

    this.css.domElement.className = "dv-css";
    this.root.append(this.css.domElement);
    this.cardElement = createDeviceCard(number);
    this.cardElement.style.setProperty("--dv-edge", `${CARD_THICKNESS / CARD_SCALE}px`);
    this.card = new CSS3DObject(this.cardElement);
    this.card.position.copy(CARD.center);
    this.card.rotation.x = -Math.PI / 2;
    this.card.scale.setScalar(CARD_SCALE);
    this.cssScene.add(this.card);

    this.glHost = document.createElement("div");
    this.glHost.className = "dv-gl";
    this.root.append(this.glHost);
    this.gl = createGL(this.glHost, { alpha: true, budget: 8_000_000 });
    const { renderer } = this.gl;
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.setClearColor(0x000000, 0);

    this.sun.position.set(-3, 8, 4);
    this.scene.add(this.hemi, this.sun, this.sun.target);

    this.floor = this.createFloor();
    this.scene.add(this.floor);

    this.resize();
    this.ready = this.load().catch(() => {});
  }

  private createFloor() {
    const material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: {
        lineColor: { value: new THREE.Color("#aba6a1") },
        floorColor: { value: new THREE.Color("#d8d3cd") },
        floorAlpha: { value: 0.55 },
        cell: { value: 0.22 },
        width: { value: 0.02 },
        fade: { value: 0 },
        fogNear: { value: 8 },
        fogFar: { value: 26 },
      },
      vertexShader: `
        varying vec3 vWorld;
        varying float vDepth;
        void main() {
          vec4 world = modelMatrix * vec4(position, 1.0);
          vWorld = world.xyz;
          vec4 view = viewMatrix * world;
          vDepth = -view.z;
          gl_Position = projectionMatrix * view;
        }`,
      fragmentShader: `
        uniform vec3 lineColor, floorColor;
        uniform float cell, width, fade, fogNear, fogFar, floorAlpha;
        varying vec3 vWorld;
        varying float vDepth;
        void main() {
          vec2 p = vWorld.xz;
          vec2 d = abs(fract(p / cell + 0.5) - 0.5) * cell;
          vec2 fw = max(fwidth(p), vec2(1e-5));
          vec2 cover = 1.0 - smoothstep(width * 0.5 - fw * 0.5, width * 0.5 + fw * 0.5, d);
          cover *= clamp(width / fw, 0.0, 1.0);
          float line = max(cover.x, cover.y);
          float fog = smoothstep(fogNear, fogFar, vDepth);
          float base = floorAlpha * (1.0 - fog);
          float alpha = base + (1.0 - base) * line * (1.0 - fog);
          vec3 color = mix(floorColor, lineColor, line * (1.0 - fog) / max(alpha, 1e-4));
          gl_FragColor = vec4(color, alpha * fade);
          #include <colorspace_fragment>
        }`,
    });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), material);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.0005;
    floor.renderOrder = -2;
    return floor;
  }

  private async load() {
    const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
    const gltf = await loader.loadAsync(reelDeviceUrl);
    if (this.disposed) return;
    const model = gltf.scene;
    const body = new THREE.MeshStandardMaterial({ color: "#b9b9b9", roughness: 0.6, metalness: 0, transparent: true, opacity: 0.45, depthWrite: false });
    const ribbon = body.clone();
    const lip = body.clone();
    lip.color.set("#7a7774");
    lip.opacity = 0.78;
    const orange = new THREE.MeshStandardMaterial({ color: "#d9772b", roughness: 0.6, metalness: 0, emissive: "#d9772b", emissiveIntensity: 0 });
    this.orange = orange;
    this.ribbonFades.push({ material: ribbon, base: 0.45 });

    const edgeMaterial = (opacity = 0.8, width = 1.15) => {
      const material = new LineMaterial({ color: 0xffffff, linewidth: width, transparent: true, opacity, depthWrite: false, alphaToCoverage: true });
      this.lineMaterials.push(material);
      return material;
    };
    const bodyEdges = edgeMaterial();
    const ribbonEdges = edgeMaterial();
    this.edgeFades.push({ material: bodyEdges, base: 0.8 });
    this.ribbonFades.push({ material: ribbonEdges, base: 0.8 });

    const meshes: THREE.Mesh[] = [];
    model.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (mesh.isMesh) meshes.push(mesh);
    });
    for (const mesh of meshes) {
      const data = mesh.userData;
      const role = String(data.role ?? "body");
      if (role === "orange") mesh.material = orange;
      else if (role === "ribbon") mesh.material = ribbon;
      else if (mesh.name === "Big_Collar" || mesh.name === "Small_Hub") mesh.material = lip;
      else mesh.material = body;
      mesh.renderOrder = role === "orange" ? 0 : 2;
      if (role !== "orange") {
        const occluder = new THREE.Mesh(mesh.geometry, this.occluder);
        occluder.renderOrder = 5;
        occluder.userData.occluder = true;
        mesh.add(occluder);
      }
      if (data.edges === 0 || role === "rib") continue;
      const edges = new THREE.EdgesGeometry(mesh.geometry, Number(data.edgeAngle ?? 30));
      const geometry = new LineSegmentsGeometry().fromEdgesGeometry(edges);
      edges.dispose();
      const material = role === "ribbon" ? ribbonEdges : bodyEdges;
      const lines = new LineSegments2(geometry, material);
      lines.renderOrder = 10;
      lines.userData.edges = true;
      mesh.add(lines);
    }

    for (const name of ["PlanLines", "SiteLines"]) {
      const source = model.getObjectByName(name) as THREE.LineSegments | undefined;
      if (!source) continue;
      const material = edgeMaterial(name === "PlanLines" ? 0.75 : 0.7, 1);
      const pairs = source.geometry.index ? source.geometry.toNonIndexed() : source.geometry;
      const geometry = new LineSegmentsGeometry().setPositions(pairs.attributes.position.array as Float32Array);
      if (pairs !== source.geometry) pairs.dispose();
      const lines = new LineSegments2(geometry, material);
      lines.renderOrder = 11;
      lines.position.copy(source.position);
      source.parent?.add(lines);
      source.removeFromParent();
      source.geometry.dispose();
      if (name === "SiteLines") this.siteLines.push({ material, base: material.opacity });
    }

    for (const name of ["BigReel", "SmallReel", "RibbonGroup"]) {
      const group = model.getObjectByName(name);
      if (group) this.reels.push(group);
    }

    this.scene.add(model);
    this.resize();
  }

  resize() {
    this.gl.resize();
    const width = Math.max(1, this.host.clientWidth);
    const height = Math.max(1, this.host.clientHeight);
    this.css.setSize(width, height);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    for (const material of this.lineMaterials) material.resolution.set(width, height);
    this.path = undefined;
  }

  private fitDistance(w: number, h: number, fx: number, fy: number, hfov: number) {
    const th = Math.tan(hfov / 2);
    const tv = th / this.camera.aspect;
    return Math.max(w / 2 / (fx * th), h / 2 / (fy * tv));
  }

  private tanHalf(hfov: number) {
    return Math.tan(hfov / 2) / this.camera.aspect;
  }

  handoff(view?: CardView) {
    this.view = view;
    this.path = undefined;
  }

  private arrayKey(): CameraKey {
    const fallback: CameraKey = {
      t: 0,
      target: CARD.center.clone(),
      forward: DOWN.clone(),
      up: NORTH.clone(),
      dist: this.fitDistance(CARD.width, CARD.height, FRONT_VIEW.width, FRONT_VIEW.height, HFOV_FLAT),
      tanHalf: this.tanHalf(HFOV_FLAT),
    };
    const view = this.view;
    if (!view) return fallback;
    const cardWorld = new THREE.Matrix4().fromArray(view.card);
    const cameraWorld = new THREE.Matrix4().fromArray(view.camera);
    const relative = cardWorld.clone().invert().multiply(cameraWorld);
    const s = CARD.width / view.face.width;
    const [cx, cy, cz] = view.face.center;
    const faceUp = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
    const toWorld = new THREE.Matrix4()
      .compose(CARD.center, faceUp, new THREE.Vector3(s, s, s))
      .multiply(new THREE.Matrix4().makeTranslation(-cx, -cy, -cz));
    const camera = toWorld.multiply(relative);
    const position = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    camera.decompose(position, quat, new THREE.Vector3());
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(quat);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(quat);
    if (forward.y > -0.05 || position.y <= 0) return fallback;
    const dist = -position.y / forward.y;
    const target = position.clone().addScaledVector(forward, dist);
    return { t: 0, target, forward, up, dist, tanHalf: Math.tan(THREE.MathUtils.degToRad(view.fov) / 2) };
  }

  private buildPath() {
    const flat = this.tanHalf(HFOV_FLAT);
    const deep = this.tanHalf(HFOV_3D);
    const top = (t: number, target: THREE.Vector3, dist: number, tanHalf = flat, up = NORTH): CameraKey =>
      ({ t, target: target.clone(), forward: DOWN.clone(), up: up.clone(), dist, tanHalf });
    const front = this.fitDistance(CARD.width, CARD.height, FRONT_VIEW.width, FRONT_VIEW.height, HFOV_FLAT);
    const fill = this.fitDistance(CARD.width, CARD.height, 0.93, 0.926, HFOV_FLAT);
    const planDist = this.fitDistance(PLAN_VIEW.width, PLAN_VIEW.height, 1, 1, HFOV_FLAT);
    const oblique = orbitDirections(OBLIQUE.azimuth, OBLIQUE.elevation);
    const orbit = orbitDirections(OBLIQUE.azimuth + 21, OBLIQUE.elevation - 1.8);
    this.path = new CameraPath([
      this.arrayKey(),
      top(0.95, CARD.center.clone().add(plan(0.01, 0.005)), front * 0.9),
      top(2.05, CARD.center.clone().add(plan(0.03, 0.03)), fill),
      { ...top(T.plan, PLAN_VIEW.center, planDist), rest: true },
      { t: T.oblique, target: OBLIQUE.target.clone(), forward: oblique.forward, up: oblique.up, dist: OBLIQUE.distance, tanHalf: deep },
      { t: T.orbitEnd, target: OBLIQUE.target.clone().add(plan(0.14, -0.05)), forward: orbit.forward, up: orbit.up, dist: OBLIQUE.distance * 0.88, tanHalf: deep },
    ]);
  }

  render(t: number) {
    t = Math.max(0, t);
    if (!this.path) this.buildPath();
    const rush = easeInCubic(span(t, T.rush[0], T.rush[1]));
    this.path!.apply(this.camera, t, 0.82 * rush, 0.35 * rush);
    const shouldRush = rush > 0.02;
    if (shouldRush !== this.rushing) {
      this.rushing = shouldRush;
      this.host.classList.toggle("is-rushing", shouldRush);
    }

    const shell = 1 - easeInOutCubic(span(t, T.shell[0], T.shell[1]));
    this.cardElement.style.opacity = shell.toFixed(3);
    this.card.visible = shell > 0.002;

    const [t0, dt] = T.tilt;
    const extrude = smoothstep(span(t, t0 + 0.1, dt * 0.95));
    const look = smoothstep(span(t, t0 + 0.15, dt * 0.95));
    for (const reel of this.reels) reel.scale.y = lerp(0.06, 1, extrude);
    const setFade = (list: Fade[], k: number) => {
      for (const { material, base } of list) {
        material.opacity = base * k;
        material.visible = k > 0.002;
      }
    };
    setFade(this.ribbonFades, lerp(0.4, 1, look));
    setFade(this.siteLines, 1 - shell);
    this.floor.material.uniforms.fade.value = smoothstep(span(t, t0 + 0.35, dt * 0.75));
    this.hemi.intensity = lerp(3.1, 0.52, look);
    this.sun.intensity = lerp(0.3, 0.62, look);
    if (this.orange) this.orange.emissiveIntensity = lerp(0.05, 0.42, look);
    for (const material of this.lineMaterials) material.linewidth = lerp(1.0, 1.25, look);
    setFade(this.edgeFades, lerp(0.55, 1, look));

    this.css.render(this.cssScene, this.camera);
    this.gl.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.disposed = true;
    this.host.classList.remove("is-rushing");
    this.scene.traverse((object) => {
      const mesh = object as THREE.Mesh;
      mesh.geometry?.dispose?.();
      const materials = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
      for (const material of materials) material.dispose();
    });
    this.cssScene.clear();
    this.gl.dispose();
    this.root.remove();
  }
}
