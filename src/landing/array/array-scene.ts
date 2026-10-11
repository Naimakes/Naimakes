import * as THREE from "three";
import { ArchiveVisibility } from "./array-visibility";
import { InstanceUpdates } from "./instance-updates";
import { RenderState } from "./render-cache";
import { SharedDepthAO, SharedDepthBokeh } from "./shared-depth-passes";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { createArchiveLighting } from "./array-lighting";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { BokehPass } from "three/addons/postprocessing/BokehPass.js";
import { SMAAPass } from "three/addons/postprocessing/SMAAPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { QUALITY } from "./render-quality";
import { applyTextureQuality, resizeQuality, SupersampleGovernor, SupersampleRenderPass } from "./supersample-renderer";
import { CardAppearance } from "./card-appearance";
import { configureInternalOptics } from "./card-internal-optics";
import { createStackUniforms, injectStack, STACK_DEPTH } from "./array-stack-optics";
import { CARD_CENTER_Y, CARD_DEPTH, CARD_FACE_Z, CARD_HEIGHT, CARD_LABEL, CARD_WIDTH, LABEL_CANVAS, drawCardLabel } from "./card-spec";
import { DecryptionController } from "./card-decryption";
import { archiveColumns, columnFiles, fileAtSlot, fileLocation } from "../data/archive-data";
import {
  cellKey,
  sameCell,
  selectionCell,
  fileAtCell,
  poolCell,
  wrap,
  LOOP_COLUMNS,
  LOOP_ROWS,
  COLUMN_SPACING,
  ROW_SPACING,
  type ArchiveCell,
  type ArchiveNavigation,
} from "./array-loop";
import { labelMarkSvg } from "../ui/brand-marks";
import { createCardFaceUniforms, injectCardFace, loadCardFace } from "./card-face-texture";
import { displayAlbedo, displayVertexColors } from "./display-albedo";
import { archiveFraming } from "../ui/viewport-layout";
import { ArchiveDrag, ArchivePlaneMomentum, type DragAxis, type DragProjection, type DragPosition } from "./array-drag";
import { fadeMaterial } from "./array-fade";
import { APPROACH, FRONT_VIEW, easeOutSpring } from "../dossier/dossier-approach";
import { EXTRACT, extractStart, searchWave, smooth, spring } from "../search/search-timeline";
import { planExtraction, POSE_STEP, type ExtractionFrame, type Motion, type Pose } from "../search/extraction-layout";
import cassetteUrl from "../models/archive-cassette.glb?url";
import assemblyUrl from "../models/archive-assembly.glb?url";
import {
  archiveWave,
  extraction,
  baselineSelectionWave,
  settlingWave,
  damp,
  columnStrength,
  idleWave,
  cinematicField,
  INSPECTION_LIFT,
  returnStep,
} from "./array-motion";

const ease = (t: number) => {
  t = THREE.MathUtils.clamp(t, 0, 1);
  return t * t * t * (t * (t * 6 - 15) + 10);
};
const progress = (t: number, [start, length]: readonly [number, number]) =>
  THREE.MathUtils.clamp((t - start) / length, 0, 1);
const FACE_CENTER = new THREE.Vector3(0, CARD_CENTER_Y, CARD_FACE_Z);
const BLOOM_STRENGTH = 0.3;
const DOSSIER_PAPER = new THREE.Color("#e9e5e1");
const BACKDROP = new THREE.Color("#e9e5e1");
type ApproachView = { aim: THREE.Vector3; dir: THREE.Vector3; dist: number };
type SearchTarget = { index: number; cell: ArchiveCell; lean: number; group: THREE.Group; released: boolean; pulsed: boolean };
type SearchPlay = {
  t: number;
  targets: SearchTarget[];
  from: ApproachView & { tanHalf: number };
  to: ApproachView & { tanHalf: number };
  center: ArchiveCell;
  face: THREE.Quaternion;
};
const FACE_CORNERS = [[-CARD_WIDTH / 2, CARD_HEIGHT], [CARD_WIDTH / 2, CARD_HEIGHT], [CARD_WIDTH / 2, 0], [-CARD_WIDTH / 2, 0]] as const;
const ENTRY_DEPTH = 28;
const SEARCH_WINDOWS = [[5, 30], [9, 50]] as const;
const SEARCH_SITES = { min: 12, max: 48 };
function archiveDirection() {
  const yaw = THREE.MathUtils.degToRad(59);
  const elevation = THREE.MathUtils.degToRad(19);
  return new THREE.Vector3(-Math.sin(yaw) * Math.cos(elevation), Math.sin(elevation), Math.cos(yaw) * Math.cos(elevation));
}
function blendView(a: ApproachView, b: ApproachView, k: number): ApproachView {
  const turn = a.dir.angleTo(b.dir);
  const dir = turn > 1e-5
    ? a.dir.clone().multiplyScalar(Math.sin((1 - k) * turn)).addScaledVector(b.dir, Math.sin(k * turn)).divideScalar(Math.sin(turn))
    : b.dir.clone();
  return { aim: a.aim.clone().lerp(b.aim, k), dir, dist: a.dist * Math.pow(b.dist / a.dist, k) };
}
function toPhysical(source: THREE.MeshStandardMaterial): THREE.MeshPhysicalMaterial {
  if ((source as THREE.MeshPhysicalMaterial).isMeshPhysicalMaterial) return source.clone() as THREE.MeshPhysicalMaterial;
  const physical = new THREE.MeshPhysicalMaterial();
  THREE.MeshStandardMaterial.prototype.copy.call(physical, source);
  (physical as unknown as { defines: Record<string, string> }).defines = { STANDARD: "", PHYSICAL: "" };
  physical.name = source.name;
  return physical;
}
function sharpLabel<T extends THREE.MeshBasicMaterial>(material: T) {
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <map_fragment>",
      THREE.ShaderChunk.map_fragment.replace("texture2D( map, vMapUv )", "texture( map, vMapUv, -0.6 )"),
    );
  };
  material.customProgramCacheKey = () => "archive-sharp-label";
  return material;
}

const DISPLAY_COLORED = new Set([
  "Frosted_Polymer", "Ivory_Edges", "Optical_Edges", "Optical_Diffuser", "Printed_Label", "Index_Inlay",
  "Champagne_Index", "Case_Engraving", "Case_Engraving_Highlight", "Fastener_Socket", "Plan_Hairline",
  "Optical_Film_Edge", "Amber_Optical_Inlay", "Optical_Film",
]);
export class ArchiveScene {
  private inputEvents = new AbortController();
  private stackAttribute?: THREE.InstancedBufferAttribute;
  private stackUpdates?: InstanceUpdates;
  private stackUniforms = createStackUniforms();
  private cardFace = createCardFaceUniforms();
  private numberAttribute?: THREE.InstancedBufferAttribute;
  private numberUpdates?: InstanceUpdates;
  private fadeAttribute?: THREE.InstancedBufferAttribute;
  private fadeUpdates?: InstanceUpdates;
  private floorFade = { value: 0 };
  private approach: {
    t: number;
    weight: number;
    releasing: boolean;
    from: { aim: THREE.Vector3; dir: THREE.Vector3; dist: number; tanHalf: number };
  } | null = null;
  private snapCamera = false;
  private search: SearchPlay | null = null;
  private searchPoses?: Motion;
  private searchFade = 0;
  private shoulderGain = 1;
  private columnCache = new Map<number, number[]>();
  private cardNumber(cell: ArchiveCell) {
    const lane = wrap(cell.lane, archiveColumns.length);
    let files = this.columnCache.get(lane);
    if (!files) this.columnCache.set(lane, (files = columnFiles(lane)));
    return files.length ? files[wrap(cell.row - 12, files.length)] + 1 : 0;
  }
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(34, 16 / 9, 5, 300);
  private composer: EffectComposer;
  private supersample: SupersampleRenderPass;
  private governor = new SupersampleGovernor();
  private transmissionTarget?: THREE.WebGLRenderTarget;
  private transmissionBox = new THREE.Box3();
  private transmissionCorner = new THREE.Vector3();
  private transmissionRect: number[] | null = null;
  private adoptTransmissionTarget(target: THREE.WebGLRenderTarget) {
    this.transmissionTarget = target;
    const setSize = target.setSize.bind(target);
    target.setSize = (width: number, height: number, depth?: number) => {
      setSize(width, height, depth);
      const rect = this.transmissionRect;
      target.scissorTest = false;
      if (!rect) return;
      const w = Math.floor(width), h = Math.floor(height);
      const margin = Math.max(24, 0.04 * Math.max(w, h));
      const left = Math.max(0, Math.floor((rect[0] * 0.5 + 0.5) * w - margin));
      const right = Math.min(w, Math.ceil((rect[2] * 0.5 + 0.5) * w + margin));
      const bottom = Math.max(0, Math.floor((rect[1] * 0.5 + 0.5) * h - margin));
      const top = Math.min(h, Math.ceil((rect[3] * 0.5 + 0.5) * h + margin));
      if (right <= left || top <= bottom) return;
      target.scissor.set(left, bottom, right - left, top - bottom);
      target.scissorTest = true;
    };
  }
  private scissorTransmission() {
    this.transmissionRect = null;
    const box = this.transmissionBox.makeEmpty();
    if (this.model.visible) box.expandByObject(this.model);
    for (const o of this.outgoing) box.expandByObject(o.group);
    for (const target of this.search?.targets ?? []) if (target.group.visible) box.expandByObject(target.group);
    if (box.isEmpty()) return;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const corner = this.transmissionCorner;
    for (let i = 0; i < 8; i++) {
      corner.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z);
      corner.applyMatrix4(this.camera.matrixWorldInverse);
      if (corner.z > -this.camera.near) return;
      corner.applyMatrix4(this.camera.projectionMatrix);
      x0 = Math.min(x0, corner.x); x1 = Math.max(x1, corner.x);
      y0 = Math.min(y0, corner.y); y1 = Math.max(y1, corner.y);
    }
    this.transmissionRect = [x0, y0, x1, y1];
  }
  private ao: SharedDepthAO;
  private bokeh: BokehPass;
  private instances: THREE.InstancedMesh[] = [];
  private matrixUpdates?: InstanceUpdates;
  private renderState = new RenderState();
  private visibility = new ArchiveVisibility();
  private instanceCapacity = LOOP_COLUMNS * LOOP_ROWS;
  private drawnCells: ArchiveCell[] = [];
  private model = new THREE.Group();
  private appearance = new CardAppearance(this.stackUniforms, this.cardFace);
  private decryption = new DecryptionController();
  private cursor = new THREE.Vector2();
  private raycaster = new THREE.Raycaster();
  private dummy = new THREE.Object3D();
  private cells: ArchiveCell[] = [];
  private selectedCell: ArchiveCell = { lane: 2, row: 12 };
  private looping = false;
  private coordinateOrigin: ArchiveCell = { lane: 0, row: 0 };
  private lift = { value: 0, velocity: 0 };
  private rail = { value: 0, velocity: 0 };
  private shoulder = { value: 12, velocity: 0 };
  private laneFocus = { value: 2, velocity: 0 };
  private columnCamera = { value: 0, velocity: 0 };
  private returnY: number | null = null;
  private canInspect = false;
  private clearance = 0;
  private pulseGain = 1;
  private idleGain = 0;
  private lastInteraction = 0;
  private scanTime = 29.1;
  private scanBlend = 0;
  private cameraAim = new THREE.Vector3();
  private outgoing: {
    group: THREE.Group;
    slot: number;
    cell: ArchiveCell;
    lift: { value: number; velocity: number };
    returnY: number | null;
    clarity: number;
  }[] = [];
  private pulses: { row: number; lane: number; time: number }[] = [];
  private selectedSlot = 76;
  private detail = 0;
  private targetDetail = 0;
  private reveal = 0;
  private targetReveal = 0;
  private last = 0;
  private pointer = new THREE.Vector2();
  private dragging = false;
  private hoverCell: ArchiveCell | null = null;
  private hoverLifts = new Map<string, number>();
  private archiveDrag = new ArchiveDrag();
  private dragTrack: DragPosition | null = null;
  private navigatingDrag = false;
  private archiveMomentum: { motion: ArchivePlaneMomentum; time: number } | null = null;
  private holdingArchive = false;
  private cancelPointer = () => {};
  private rotation = 0;
  private targetRotation = 0;
  private light: THREE.DirectionalLight;
  private clock = 0;
  private loaded = false;
  private labelCanvas = document.createElement("canvas");
  private labelTexture?: THREE.CanvasTexture;
  private labelMark = new Image();
  private smaa = new SMAAPass();
  private bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), BLOOM_STRENGTH, 0.6, 0.88);
  onSelect?: (index: number, cell?: ArchiveCell) => void;
  onHover?: (index: number | null) => void;
  onNavigate?: (axis: "row" | "lane", direction: number) => void;
  constructor(private container: HTMLElement, private readonly reduced: boolean) {
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(
      Math.min(devicePixelRatio, 1.5) *
        Math.min(innerWidth / 1920, innerHeight / 1080),
    );
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.info.autoReset = false;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.domElement.setAttribute(
      "aria-label",
      "三维帖子阵列：每一道纵列是一个板块，点击选择，左右拖动切换板块，上下拖动或滚轮切换板块里的帖子",
    );
    container.appendChild(this.renderer.domElement);
    this.renderer.domElement.addEventListener('webglcontextrestored', () => this.renderState.invalidate(), { signal: this.inputEvents.signal });
    this.scene.background = new THREE.Color("#e9e5e1");
    this.scene.matrixWorldAutoUpdate = false;
    this.scene.fog = new THREE.Fog("#e9e5e1", 22, 47);
    this.light = createArchiveLighting(this.renderer, this.scene);
    this.light.castShadow = true;
    Object.assign(this.light.shadow.camera, {
      left: -20,
      right: 20,
      top: 18,
      bottom: -18,
      near: 0.1,
      far: 80,
    });
    this.light.shadow.mapSize.set(2048, 2048);
    this.light.shadow.normalBias = 0.035;
    this.light.shadow.bias = -0.0003;
    this.light.shadow.radius = 4;
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(200, 200),
      new THREE.MeshStandardMaterial({ color: "#d6cfc8", roughness: 0.95 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.name = "archive-floor";
    floor.position.y = -4.63;
    floor.receiveShadow = true;
    fadeMaterial(floor.material, this.floorFade);
    floor.onBeforeRender = (renderer) => {
      const target = renderer.getRenderTarget();
      if (target && target !== this.transmissionTarget && target.samples > 0 && target.texture.generateMipmaps)
        this.adoptTransmissionTarget(target);
    };
    this.scene.add(floor);
    this.camera.position.set(-62.26, 35.98, 43.28);
    this.cameraAim.set(-0.5, 1.1, 0.4);
    this.camera.fov = 6.15;
    this.camera.lookAt(this.cameraAim);
    this.composer = new EffectComposer(this.renderer);
    this.supersample = new SupersampleRenderPass(this.scene, this.camera);
    this.composer.addPass(this.supersample);
    this.ao = new SharedDepthAO(
      this.scene,
      this.camera,
      container.clientWidth,
      container.clientHeight,
    );
    this.ao.kernelRadius = 0.38;
    this.ao.minDistance = 0.001;
    this.ao.maxDistance = 0.09;
    this.composer.addPass(this.ao);
    this.composer.addPass(this.bloom);
    this.bokeh = new SharedDepthBokeh(this.scene, this.camera, {
      focus: 25,
      aperture: 0.0018,
      maxblur: 0.008,
    }, () => this.ao);
    this.composer.addPass(this.bokeh);
    this.composer.addPass(this.smaa);
    this.composer.addPass(new OutputPass());
    this.bindPointer();
  }
  private detailMaterial(name: string, source: THREE.MeshStandardMaterial) {
    const mat = toPhysical(source);
    mat.envMapIntensity = 0.6;
    switch (name) {
      case "Frosted_Polymer":
        mat.roughness = 0.5;
        mat.clearcoat = 0.2;
        mat.clearcoatRoughness = 0.3;
        mat.specularIntensity = 0.6;
        break;
      case "Optical_Window":
        mat.color.set("#fffdfa");
        mat.transmission = 0.9;
        mat.thickness = 0.06;
        mat.roughness = 0.21;
        mat.ior = 1.46;
        mat.attenuationColor = new THREE.Color("#f5e9dc");
        mat.attenuationDistance = 2.6;
        mat.clearcoat = 1;
        mat.clearcoatRoughness = 0.035;
        mat.specularIntensity = 1;
        break;
      case "Ivory_Edges":
      case "Optical_Edges":
        mat.roughness = 0.45;
        mat.clearcoat = 0.15;
        mat.clearcoatRoughness = 0.3;
        break;
      case "Optical_Diffuser":
        mat.roughness = 0.55;
        break;
      case "Subsurface_Optics":
        mat.roughness = 0.55;
        mat.metalness = 0;
        mat.envMapIntensity = 0.7;
        break;
      case "Amber_Optical_Inlay":
        mat.roughness = 0.5;
        mat.metalness = 0;
        mat.emissive = new THREE.Color("#7c3300");
        mat.emissiveIntensity = 0.18;
        break;
      case "Titanium_Fasteners":
        mat.roughness = 0.28;
        mat.metalness = 0.75;
        mat.clearcoat = 0.6;
        mat.clearcoatRoughness = 0.1;
        mat.envMapIntensity = 1.1;
        break;
      case "Printed_Label":
      case "Index_Inlay":
      case "Champagne_Index":
      case "Case_Engraving":
      case "Case_Engraving_Highlight":
      case "Fastener_Socket":
      case "Plan_Hairline":
      case "Optical_Film_Edge":
        mat.roughness = Math.max(0.45, mat.roughness);
        break;
    }
    if (DISPLAY_COLORED.has(name)) mat.color.copy(displayAlbedo(mat.color, this.renderer.toneMappingExposure));
    configureInternalOptics(name, mat);
    return mat;
  }

  private arrayMaterial(name: string, base: THREE.MeshPhysicalMaterial) {
    const arrayMat = base.clone();
    arrayMat.envMapIntensity = 0.6;
    arrayMat.vertexColors = false;
    if (name === "Frosted_Polymer") {
      arrayMat.transmission = 0;
      arrayMat.thickness = 0;
      arrayMat.transparent = false;
      arrayMat.color.set("#ece4dc");
      arrayMat.roughness = 0.34;
      arrayMat.clearcoat = 1;
      arrayMat.clearcoatRoughness = 0.06;
      arrayMat.specularIntensity = 1;
      arrayMat.specularColor = new THREE.Color("#fbf5ef");
      arrayMat.envMapIntensity = 0.75;
      arrayMat.onBeforeCompile = (shader) => {
        injectStack(shader, this.stackUniforms, "vArchiveStack", "1.0", true);
        injectCardFace(shader, this.cardFace);
      };
    }
    if (name === "Optical_Diffuser") arrayMat.color.set("#806447");
    if (name === "Ivory_Edges") {
      arrayMat.transmission = 0;
      arrayMat.color.set("#e6ddd5");
      arrayMat.roughness = 0.3;
      arrayMat.clearcoat = 1;
      arrayMat.clearcoatRoughness = 0.06;
      arrayMat.onBeforeCompile = (shader) =>
        injectStack(shader, this.stackUniforms, "vArchiveStack", "1.0", true);
    }
    if (name === "Index_Inlay") {
      arrayMat.color.set("#dccabb");
      arrayMat.metalness = 0.05;
    }
    return arrayMat;
  }

  async load() {
    this.labelMark.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(labelMarkSvg)}`;
    await this.labelMark.decode();
    const loader = new GLTFLoader();
    const [lod, detail] = await Promise.all([loader.loadAsync(cassetteUrl), loader.loadAsync(assemblyUrl)]);
    const meshesOf = (root: THREE.Object3D) => {
      root.updateMatrixWorld(true);
      const meshes: THREE.Mesh[] = [];
      root.traverse((o) => {
        if (o instanceof THREE.Mesh) meshes.push(o);
      });
      return meshes;
    };
    const surfaceOf = (material: THREE.Material) => material.name.replace(/\.\d+$/, "");
    const count = LOOP_COLUMNS * LOOP_ROWS;
    for (let index = 0; index < count; index++) {
      const cell = poolCell(index);
      this.cells.push(cell);
    }
    const high = new Map<string, THREE.MeshPhysicalMaterial>();
    for (const mesh of meshesOf(detail.scene)) {
      const source = mesh.material as THREE.MeshStandardMaterial;
      const name = surfaceOf(source);
      let mat = high.get(name);
      if (!mat) high.set(name, (mat = this.detailMaterial(name, source)));
      const geometry = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
      if (name === "Subsurface_Optics") displayVertexColors(geometry, this.renderer.toneMappingExposure);
      const selectedMesh = new THREE.Mesh(geometry, mat);
      selectedMesh.userData.surface = name;
      selectedMesh.castShadow = name === "Optical_Diffuser";
      selectedMesh.receiveShadow = true;
      this.model.add(selectedMesh);
    }
    const low = new Map<string, THREE.MeshPhysicalMaterial>();
    for (const mesh of meshesOf(lod.scene)) {
      const source = mesh.material as THREE.MeshStandardMaterial;
      const name = surfaceOf(source);
      if (!["Frosted_Polymer", "Ivory_Edges", "Titanium_Fasteners", "Index_Inlay", "Optical_Diffuser"].includes(name)) continue;
      const geom = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
      const arrayMat = this.arrayMaterial(name, high.get(name) ?? toPhysical(source));
      low.set(name, arrayMat);
      this.stackAttribute ??= new THREE.InstancedBufferAttribute(new Float32Array(count * STACK_DEPTH), STACK_DEPTH).setUsage(THREE.DynamicDrawUsage);
      geom.setAttribute("archiveStack", this.stackAttribute);
      this.numberAttribute ??= new THREE.InstancedBufferAttribute(new Float32Array(count), 1).setUsage(THREE.DynamicDrawUsage);
      geom.setAttribute("archiveNumber", this.numberAttribute);
      this.fadeAttribute ??= new THREE.InstancedBufferAttribute(new Float32Array(count), 1).setUsage(THREE.DynamicDrawUsage);
      geom.setAttribute("archiveFade", this.fadeAttribute);
      fadeMaterial(arrayMat);
      const inst = new THREE.InstancedMesh(geom, arrayMat, count);
      inst.instanceMatrix = this.instances[0]?.instanceMatrix ?? inst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      inst.castShadow = name === "Optical_Diffuser";
      inst.receiveShadow = true;
      inst.frustumCulled = false;
      if (name === "Optical_Diffuser") {
        inst.layers.set(1);
        this.light.shadow.camera.layers.enable(1);
      }
      this.instances.push(inst);
      this.scene.add(inst);
    }
    for (const [name, mat] of high)
      this.appearance.register(name, mat, name === "Optical_Window" ? low.get("Frosted_Polymer") : low.get(name));
    this.labelCanvas.width = LABEL_CANVAS.width;
    this.labelCanvas.height = LABEL_CANVAS.height;
    this.labelTexture = new THREE.CanvasTexture(this.labelCanvas);
    this.labelTexture.colorSpace = THREE.SRGBColorSpace;
    this.labelTexture.anisotropy =
      this.renderer.capabilities.getMaxAnisotropy();
    const label = new THREE.Mesh(
      new THREE.PlaneGeometry(CARD_LABEL.width, CARD_LABEL.height),
      sharpLabel(new THREE.MeshBasicMaterial({
        map: this.labelTexture,
        toneMapped: false,
        transparent: true,
        depthWrite: false,
      })),
    );
    label.name = "archive-label";
    label.position.set(CARD_LABEL.x, CARD_LABEL.y, CARD_LABEL.z);
    this.model.add(label);
    this.appearance.prepare(this.model);
    this.appearance.apply(this.model, 0);
    this.drawLabel(0);
    this.scene.add(this.model);
    loadCardFace(this.cardFace, this.renderer, this.labelMark)
      .then(() => this.renderState.invalidate())
      .catch((error) => console.warn("[archive] card face unavailable", error));
    this.model.position.copy(this.cellPosition(poolCell(this.selectedSlot)));
    applyTextureQuality(this.scene, this.renderer, QUALITY);
    this.resize();
    this.loaded = true;
  }

  beginApproach() {
    this.cancelPointer();
    this.setHover(null);
    for (const old of this.outgoing) {
      this.scene.remove(old.group);
      this.appearance.dispose(old.group);
    }
    this.outgoing = [];
    this.targetRotation = 0;
    const aim = this.cameraAim.clone();
    const offset = this.camera.position.clone().sub(aim);
    this.approach = {
      t: 0,
      weight: 1,
      releasing: false,
      from: { aim, dist: offset.length(), dir: offset.normalize(), tanHalf: Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2) },
    };
  }
  setApproachTime(t: number) {
    if (this.approach && !this.approach.releasing) this.approach.t = Math.max(0, t);
  }
  endApproach(immediate: boolean) {
    if (!this.approach) return;
    if (!immediate) {
      this.approach.releasing = true;
      return;
    }
    this.approach = null;
    this.snapCamera = true;
    this.renderState.invalidate();
  }
  private frontView(face: THREE.Vector3) {
    const tanH = Math.tan(THREE.MathUtils.degToRad(FRONT_VIEW.hfov / 2));
    const tanHalf = tanH / this.camera.aspect;
    const near = Math.max(CARD_WIDTH / 2 / (FRONT_VIEW.width * tanH), CARD_HEIGHT / 2 / (FRONT_VIEW.height * tanHalf));
    const dist = near * APPROACH.pullRatio;
    const elevation = THREE.MathUtils.degToRad(APPROACH.elevation);
    const up = new THREE.Vector3(0, Math.cos(elevation), -Math.sin(elevation));
    const turn: ApproachView = {
      aim: face.clone().addScaledVector(up, -APPROACH.lift * 2 * dist * tanHalf),
      dir: new THREE.Vector3(0, Math.sin(elevation), Math.cos(elevation)),
      dist,
    };
    const close: ApproachView = { aim: face.clone().setZ(face.z + APPROACH.extract), dir: new THREE.Vector3(0, 0, 1), dist: near };
    return { turn, close, tanHalf };
  }
  private approachFade(cell: ArchiveCell, weight: number) {
    const a = this.approach;
    if (!a || weight <= 0) return 0;
    const lanes = Math.abs(cell.lane - this.selectedCell.lane);
    const rows = Math.abs(cell.row - this.selectedCell.row);
    const [start, length] = lanes ? APPROACH.others : APPROACH.column;
    const near = lanes
      ? THREE.MathUtils.clamp(1 - (lanes - 1 + rows * 0.06) / 3, 0, 1)
      : THREE.MathUtils.clamp(1 - rows / 16, 0, 1);
    const lag = (lanes ? 0.5 : 0.35) * length;
    return ease((a.t - start - lag * near) / (length - lag)) * weight;
  }
  private cardClone(number: number) {
    const group = this.model.clone(true);
    group.visible = true;
    const label = group.getObjectByName("archive-label") as THREE.Mesh;
    const canvas = document.createElement("canvas");
    canvas.width = LABEL_CANVAS.width;
    canvas.height = LABEL_CANVAS.height;
    drawCardLabel(canvas.getContext("2d")!, number, this.labelMark.complete ? this.labelMark : null);
    const map = new THREE.CanvasTexture(canvas);
    map.colorSpace = THREE.SRGBColorSpace;
    map.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    label.material = sharpLabel(new THREE.MeshBasicMaterial({ map, toneMapped: false, transparent: true, depthWrite: false }));
    for (const child of group.children as THREE.Mesh[])
      if (child.name === "naimakes-lettering") child.material = (child.material as THREE.Material).clone();
    this.appearance.prepare(group);
    this.appearance.apply(group, 0);
    this.appearance.setClarity(group, 0);
    this.appearance.setNumber(group, number);
    this.scene.add(group);
    return group;
  }
  private cellWorld(cell: ArchiveCell) {
    return new THREE.Vector3(
      (cell.lane - 2) * COLUMN_SPACING - this.columnCamera.value,
      -4.6,
      (cell.row - 15.5) * ROW_SPACING - ENTRY_DEPTH * (1 - this.targetReveal) + this.rail.value,
    );
  }
  private searchMotion(face: THREE.Quaternion, right: THREE.Vector3, up: THREE.Vector3, dir: THREE.Vector3): Motion {
    const pivot = new THREE.Vector3(0, CARD_CENTER_Y, 0);
    const corners: THREE.Vector3[] = [];
    for (const x of [-CARD_WIDTH / 2, CARD_WIDTH / 2])
      for (const y of [0, CARD_HEIGHT])
        for (const z of [CARD_FACE_Z - CARD_DEPTH, CARD_FACE_Z]) corners.push(new THREE.Vector3(x, y, z));
    const middle = new THREE.Vector3(0, CARD_CENTER_Y, CARD_FACE_Z - CARD_DEPTH / 2);
    const turn = new THREE.Quaternion();
    const point = new THREE.Vector3();
    const poses: Pose[] = [];
    const presence = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    for (let i = 0; i < Math.round((EXTRACT.handoff + EXTRACT.crossfade) / POSE_STEP); i++) {
      const t = i * POSE_STEP;
      const lift = EXTRACT.height * spring(t / EXTRACT.lift);
      const facing = spring((t - EXTRACT.turnDelay) / EXTRACT.turn);
      turn.identity().slerp(face, facing);
      const position = new THREE.Vector3(0, lift, 0).add(pivot).sub(pivot.clone().applyQuaternion(turn)).addScaledVector(dir, EXTRACT.toward * facing);
      const pose = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity, depth: point.copy(middle).applyQuaternion(turn).add(position).dot(dir), facing };
      for (const corner of corners) {
        point.copy(corner).applyQuaternion(turn).add(position);
        const x = point.dot(right), y = point.dot(up);
        pose.x0 = Math.min(pose.x0, x); pose.x1 = Math.max(pose.x1, x);
        pose.y0 = Math.min(pose.y0, y); pose.y1 = Math.max(pose.y1, y);
      }
      poses.push(pose);
      if (lift < CARD_HEIGHT) continue;
      presence.x0 = Math.min(presence.x0, pose.x0); presence.x1 = Math.max(presence.x1, pose.x1);
      presence.y0 = Math.min(presence.y0, pose.y0); presence.y1 = Math.max(presence.y1, pose.y1);
    }
    return { poses, presence, emerge: poses[0].y1 };
  }
  private searchSites(index: number, right: THREE.Vector3, up: THREE.Vector3, dir: THREE.Vector3, aim: THREE.Vector3) {
    const ax = aim.dot(right), ay = aim.dot(up);
    const canonical = fileLocation(index);
    const period = Math.max(1, columnFiles(canonical.lane).length);
    const site = (cell: ArchiveCell) => {
      const base = this.cellWorld(cell);
      const x = base.dot(right), y = base.dot(up);
      return { x, y, depth: base.dot(dir), travel: Math.hypot(x - ax, y - ay), cell, lane: cell.lane, block: Math.floor((cell.row - 12) / period) };
    };
    if (!this.looping) return [site({ lane: canonical.lane, row: canonical.row })];
    const home = selectionCell(index, this.selectedCell);
    const lanes = archiveColumns.length;
    const rows = Math.max(1, columnFiles(wrap(home.lane, lanes)).length);
    const { lane: laneAt, row: rowAt } = this.selectedCell;
    let sites: ReturnType<typeof site>[] = [];
    for (const [laneReach, rowReach] of SEARCH_WINDOWS) {
      sites = [];
      for (let lane = home.lane - Math.floor((home.lane - laneAt + laneReach) / lanes) * lanes; lane <= laneAt + laneReach; lane += lanes)
        for (let row = home.row - Math.floor((home.row - rowAt + rowReach) / rows) * rows; row <= rowAt + rowReach; row += rows)
          if (lane !== laneAt || row !== rowAt) sites.push(site({ lane, row }));
      if (sites.length >= SEARCH_SITES.min) break;
    }
    if (!sites.length) sites.push(site(home));
    return sites.sort((a, b) => a.travel - b.travel).slice(0, SEARCH_SITES.max);
  }
  beginSearch(indices: number[], frame: ExtractionFrame) {
    this.endSearch(true);
    this.cancelPointer();
    this.setHover(null);
    this.stopMomentum();
    this.endApproach(true);
    this.camera.updateMatrixWorld();
    const aim = this.cameraAim.clone();
    const offset = this.camera.position.clone().sub(aim);
    const from = { aim, dist: offset.length(), dir: offset.normalize(), tanHalf: Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2) };
    const dir = archiveDirection();
    const dist = 140;
    const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), dir).normalize();
    const up = new THREE.Vector3().crossVectors(dir, right).normalize();
    const face = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.asin(dir.y), Math.atan2(dir.x, dir.z), 0, "YXZ"));
    this.searchPoses ??= this.searchMotion(face, right, up, dir);
    const sites = indices.map((index) => this.searchSites(index, right, up, dir, aim));
    const plan = planExtraction(sites, this.searchPoses, frame, { dist, minSpan: 12.5, groups: indices.map((index) => fileLocation(index).lane) });
    const faceDepth = this.searchPoses.poses[this.searchPoses.poses.length - 1].depth;
    const targets: SearchTarget[] = indices.map((index, i) => ({
      index,
      cell: sites[i][plan.picks[i]].cell,
      lean: plan.depth - sites[i][plan.picks[i]].depth - faceDepth,
      group: this.cardClone(index + 1),
      released: false,
      pulsed: false,
    }));
    const aimPoint = right.clone().multiplyScalar(plan.x).addScaledVector(up, plan.y).addScaledVector(dir, plan.depth);
    const center = targets.reduce((sum, t) => ({ lane: sum.lane + t.cell.lane / targets.length, row: sum.row + t.cell.row / targets.length }), { lane: 0, row: 0 });
    this.search = {
      t: 0,
      targets,
      from,
      to: { aim: aimPoint, dir, dist, tanHalf: plan.span / (2 * dist) },
      center: { lane: Math.round(center.lane), row: Math.round(center.row) },
      face,
    };
    this.lastInteraction = this.clock;
    this.renderState.invalidate();
  }
  setSearchTime(t: number) {
    if (this.search) this.search.t = Math.max(0, t);
  }
  setSearchFade(value: number) {
    this.searchFade = THREE.MathUtils.clamp(value, 0, 1);
  }
  releaseSearchCard(i: number) {
    const target = this.search?.targets[i];
    if (target) target.released = true;
  }
  searchCardQuad(i: number) {
    const target = this.search?.targets[i];
    if (!target) return null;
    target.group.updateMatrixWorld(true);
    const w = this.container.clientWidth, h = this.container.clientHeight;
    return FACE_CORNERS.map(([x, y]) => {
      const p = new THREE.Vector3(x, y, CARD_FACE_Z).applyMatrix4(target.group.matrixWorld).project(this.camera);
      return [((p.x + 1) * w) / 2, ((1 - p.y) * h) / 2] as [number, number];
    });
  }
  endSearch(immediate: boolean) {
    const search = this.search;
    if (!search) return;
    for (const target of search.targets) {
      this.scene.remove(target.group);
      this.appearance.dispose(target.group);
    }
    this.search = null;
    if (immediate) this.searchFade = 0;
    this.model.visible = true;
    this.lastInteraction = this.clock;
    this.renderState.invalidate();
  }
  get searching() {
    return Boolean(this.search);
  }
  setMode(mode: "hidden" | "archive" | "detail") {
    if (mode === "hidden") this.endSearch(true);
    if (mode !== "detail") this.endApproach(true);
    this.cancelPointer();
    this.setHover(null);
    if (mode === "detail") this.decryption.enter(this.scanBlend > .9 && this.decryption.clarity > .999);
    else this.decryption.leave();
    if (mode === "hidden") this.decryption.select();
    this.looping = mode !== "hidden";
    if (!this.looping) {
      const canonical = fileLocation(fileAtSlot(this.selectedSlot));
      this.selectedCell = { lane: canonical.lane, row: canonical.row };
      this.coordinateOrigin = { lane: 0, row: 0 };
      for (const old of this.outgoing) {
        this.scene.remove(old.group);
        this.appearance.dispose(old.group);
      }
      this.outgoing = [];
    }
    this.lastInteraction = this.clock;
    this.targetReveal = mode === "hidden" ? 0 : 1;
    this.targetDetail = mode === "detail" ? 1 : 0;
    this.dragging = false;
    if (mode !== "detail") {
      this.targetRotation = 0;
      if (this.rotation !== 0) this.returnY = this.model.position.y;
    } else this.returnY = null;
  }
  private modelClarity() {
    return this.reduced ? this.targetDetail : this.decryption.clarity;
  }
  private cellPosition(cell: ArchiveCell) {
    return new THREE.Vector3(
      (cell.lane - 2) * COLUMN_SPACING,
      -4.6,
      (cell.row - 15.5) * ROW_SPACING,
    );
  }
  private rebaseCoordinates() {
    const shift = {
      lane:
        Math.abs(this.selectedCell.lane) > 2048
          ? Math.round((this.selectedCell.lane - 2) / 5) * 5
          : 0,
      row:
        Math.abs(this.selectedCell.row) > 2048
          ? Math.floor((this.selectedCell.row - 12) / 8) * 8
          : 0,
    };
    if (!shift.lane && !shift.row) return;
    this.setHover(null);
    this.hoverLifts.clear();
    this.selectedCell.lane -= shift.lane;
    this.selectedCell.row -= shift.row;
    this.coordinateOrigin.lane += shift.lane;
    this.coordinateOrigin.row += shift.row;
    this.laneFocus.value -= shift.lane;
    this.shoulder.value -= shift.row;
    this.columnCamera.value -= shift.lane * COLUMN_SPACING;
    this.rail.value += shift.row * ROW_SPACING;
    for (const old of this.outgoing) {
      old.cell.lane -= shift.lane;
      old.cell.row -= shift.row;
    }
    for (const pulse of this.pulses) {
      pulse.lane -= shift.lane;
      pulse.row -= shift.row;
    }
  }
  select(index: number, navigation?: ArchiveNavigation) {
    if (!this.navigatingDrag) this.cancelPointer();
    this.setHover(null);
    this.lastInteraction = this.clock;
    const next = fileLocation(index).slot;
    const canonical = fileLocation(index);
    const cell = this.looping
      ? selectionCell(index, this.selectedCell, navigation)
      : { lane: canonical.lane, row: canonical.row };
    const changed = !sameCell(cell, this.selectedCell);
    if (this.looping && changed && this.loaded && this.lift.value > 0.0001) {
      const group = this.model.clone(true);
      const label = group.getObjectByName("archive-label") as THREE.Mesh;
      const canvas = document.createElement("canvas");
      canvas.width = 1024;
      canvas.height = 440;
      canvas.getContext("2d")!.drawImage(this.labelCanvas, 0, 0);
      const map = new THREE.CanvasTexture(canvas);
      map.colorSpace = THREE.SRGBColorSpace;
      label.material = sharpLabel(new THREE.MeshBasicMaterial({
        map,
        toneMapped: false,
        transparent: true,
        depthWrite: false,
      }));
      for (const child of group.children as THREE.Mesh[])
        if (child.name === "naimakes-lettering") child.material = (child.material as THREE.Material).clone();
      this.appearance.prepare(group);
      this.appearance.apply(group, ease(this.lift.value / 0.4));
      this.appearance.setClarity(group, this.modelClarity());
      this.scene.add(group);
      this.outgoing.push({
        group,
        slot: this.selectedSlot,
        cell: { ...this.selectedCell },
        lift: { ...this.lift },
        returnY: group.rotation.y !== 0 ? group.position.y : null,
        clarity: this.modelClarity(),
      });
      this.lift.value = 0;
      this.lift.velocity = 0;
    }
    this.selectedSlot = next;
    this.selectedCell = cell;
    if (changed) {
      this.decryption.select();
      this.rotation = 0;
      this.returnY = null;
    }
    const returning = this.outgoing.findIndex((o) => sameCell(o.cell, cell));
    if (returning >= 0) {
      const o = this.outgoing[returning];
      this.lift = { ...o.lift };
      this.rotation = o.group.rotation.y;
      this.returnY = o.returnY;
      this.decryption.select(o.clarity);
      this.scene.remove(o.group);
      this.appearance.dispose(o.group);
      this.outgoing.splice(returning, 1);
    }
    this.emitPulse(cell);
    this.targetRotation = 0;
    this.drawLabel(index);
  }
  private emitPulse(cell: ArchiveCell) {
    this.pulses.push({ ...cell, time: this.clock });
    this.pulses = this.pulses.slice(-6);
  }
  private drawLabel(index: number) {
    if (!this.labelTexture) return;
    drawCardLabel(this.labelCanvas.getContext("2d")!, index + 1, this.labelMark.complete ? this.labelMark : null);
    this.labelTexture.needsUpdate = true;
  }
  private ensureInstanceCapacity(required: number) {
    if (required <= this.instanceCapacity) return;
    const capacity = Math.max(required, this.instanceCapacity * 2);
    const matrix = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 16), 16).setUsage(THREE.DynamicDrawUsage);
    matrix.array.set(this.instances[0].instanceMatrix.array);
    for (const inst of this.instances) {
      inst.dispose();
      inst.instanceMatrix = matrix;
    }
    const previousStack = this.stackAttribute;
    this.stackAttribute = new THREE.InstancedBufferAttribute(new Float32Array(capacity * STACK_DEPTH), STACK_DEPTH).setUsage(THREE.DynamicDrawUsage);
    if (previousStack) this.stackAttribute.array.set(previousStack.array);
    for (const inst of this.instances) inst.geometry.setAttribute("archiveStack", this.stackAttribute);
    const previousNumber = this.numberAttribute;
    this.numberAttribute = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1).setUsage(THREE.DynamicDrawUsage);
    if (previousNumber) this.numberAttribute.array.set(previousNumber.array);
    for (const inst of this.instances) inst.geometry.setAttribute("archiveNumber", this.numberAttribute);
    this.numberUpdates = new InstanceUpdates(this.numberAttribute);
    const previousFade = this.fadeAttribute;
    this.fadeAttribute = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1).setUsage(THREE.DynamicDrawUsage);
    if (previousFade) this.fadeAttribute.array.set(previousFade.array);
    for (const inst of this.instances) inst.geometry.setAttribute("archiveFade", this.fadeAttribute);
    this.fadeUpdates = new InstanceUpdates(this.fadeAttribute);
    this.matrixUpdates = new InstanceUpdates(matrix);
    this.stackUpdates = new InstanceUpdates(this.stackAttribute);
    this.instanceCapacity = capacity;
  }
  resize() {
    this.renderState.invalidate();
    const w = this.container.clientWidth,
      h = this.container.clientHeight;
    const dimensions = resizeQuality(
      this.renderer,
      this.composer,
      this.container,
      QUALITY,
      this.supersample,
      this.governor.cap,
    );
    this.governor.settle();
    this.ao.setSize(dimensions.width, dimensions.height);
    this.ao.setSharing(true);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }
  private canBrowse() {
    return (
      this.looping &&
      !this.search &&
      !this.targetDetail &&
      this.detail < 0.2 &&
      this.reveal >= 0.8 &&
      this.loaded &&
      !this.container.closest("[inert]")
    );
  }
  private setHover(cell: ArchiveCell | null) {
    if (
      (!cell && !this.hoverCell) ||
      (cell && this.hoverCell && sameCell(cell, this.hoverCell))
    )
      return;
    this.hoverCell = cell ? { ...cell } : null;
    this.onHover?.(cell ? fileAtCell(cell) : null);
  }
  private pickCell(x: number, y: number) {
    const r = this.renderer.domElement.getBoundingClientRect();
    this.cursor.set(
      ((x - r.left) / r.width) * 2 - 1,
      (-(y - r.top) / r.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.cursor, this.camera);
    const hit = this.raycaster.intersectObjects(
      [this.instances[0], this.model, ...this.outgoing.map((o) => o.group)],
      true,
    )[0];
    if (!hit) return null;
    if (hit.instanceId !== undefined) return { ...this.drawnCells[hit.instanceId] };
    let object: THREE.Object3D | null = hit.object;
    while (object) {
      const copy = this.outgoing.find((o) => o.group === object);
      if (copy) return { ...copy.cell };
      object = object.parent;
    }
    return { ...this.selectedCell };
  }
  private trackCoordinate(axis: DragAxis, value: number) {
    return axis === "lane"
      ? value / COLUMN_SPACING + 2
      : (-value - 2.17) / ROW_SPACING + 15.5;
  }
  private dragProjection(): DragProjection {
    this.model.updateMatrixWorld(true);
    this.camera.updateMatrixWorld(true);
    const center = this.model.localToWorld(new THREE.Vector3(0, CARD_CENTER_Y, 0));
    const rect = this.renderer.domElement.getBoundingClientRect();
    const project = (motion: THREE.Vector3) => {
      const from = center
        .clone()
        .addScaledVector(motion, -0.5)
        .project(this.camera);
      const to = center
        .clone()
        .addScaledVector(motion, 0.5)
        .project(this.camera);
      return {
        x: ((to.x - from.x) * rect.width) / 2,
        y: (-(to.y - from.y) * rect.height) / 2,
      };
    };
    return {
      lane: project(new THREE.Vector3(-COLUMN_SPACING, 0, 0)),
      row: project(new THREE.Vector3(0, 0, -ROW_SPACING)),
    };
  }
  private trackPosition(axis: DragAxis, coordinate: number) {
    return axis === "lane"
      ? (coordinate - 2) * COLUMN_SPACING
      : -2.17 - (coordinate - 15.5) * ROW_SPACING;
  }
  private navigatePlane(coordinate: DragPosition) {
    const goal = { lane: Math.round(coordinate.lane), row: Math.round(coordinate.row) };
    if (sameCell(goal, this.selectedCell)) return;
    const from = { ...this.selectedCell };
    const steps = Math.min(64, Math.max(Math.abs(goal.lane - from.lane), Math.abs(goal.row - from.row)));
    this.navigatingDrag = true;
    try {
      for (let i = 1; i <= steps; i++) {
        const cell = {
          lane: Math.round(from.lane + (goal.lane - from.lane) * i / steps),
          row: Math.round(from.row + (goal.row - from.row) * i / steps),
        };
        if (!sameCell(cell, this.selectedCell)) this.onSelect?.(fileAtCell(cell), cell);
      }
    } finally {
      this.navigatingDrag = false;
    }
  }
  private stopMomentum() {
    if (this.archiveMomentum) {
      this.columnCamera.velocity = 0;
      this.rail.velocity = 0;
    }
    this.archiveMomentum = null;
  }
  private bindPointer() {
    const canvas = this.renderer.domElement;
    let activePointer: number | null = null;
    let previousX = 0,
      startX = 0,
      startY = 0,
      moved = false;
    let browse = false,
      cancelled = false;
    let startTrack = { lane: 0, row: 0 };
    let wheelTotal = 0,
      wheelTime = 0;
    const pointers = new Set<number>();
    const hover = (e: PointerEvent) => {
      if (
        e.pointerType !== "mouse" ||
        !this.canBrowse() ||
        this.archiveMomentum
      )
        return;
      const r = canvas.getBoundingClientRect();
      this.pointer.set(
        (e.clientX - r.left) / r.width - 0.5,
        (e.clientY - r.top) / r.height - 0.5,
      );
      const cell = this.pickCell(e.clientX, e.clientY);
      this.setHover(cell);
      canvas.style.cursor = cell ? "pointer" : "grab";
    };
    const reset = () => {
      const id = activePointer;
      activePointer = null;
      this.dragging = false;
      this.dragTrack = null;
      this.holdingArchive = false;
      browse = false;
      this.setHover(null);
      canvas.style.cursor = this.canBrowse() ? "grab" : "default";
      if (id !== null && canvas.hasPointerCapture(id))
        canvas.releasePointerCapture(id);
    };
    this.cancelPointer = () => {
      cancelled = true;
      this.stopMomentum();
      pointers.clear();
      wheelTotal = 0;
      reset();
    };
    const moveArchive = (e: PointerEvent) => {
      const pending = !this.archiveDrag.active;
      for (const sample of e.getCoalescedEvents?.() ?? []) {
        this.archiveDrag.move(sample.clientX, sample.clientY, sample.timeStamp);
      }
      this.archiveDrag.move(e.clientX, e.clientY, e.timeStamp);
      moved ||= this.archiveDrag.moved;
      if (!this.archiveDrag.active) return;
      if (pending) {
        startTrack = { lane: this.columnCamera.value, row: this.rail.value };
      }
      this.setHover(null);
      this.lastInteraction = this.clock;
      canvas.style.cursor = "grabbing";
      this.dragTrack = {
        lane: startTrack.lane + this.archiveDrag.value.lane * COLUMN_SPACING,
        row: startTrack.row - this.archiveDrag.value.row * ROW_SPACING,
      };
      this.columnCamera.value = this.dragTrack.lane;
      this.rail.value = this.dragTrack.row;
      this.columnCamera.velocity = this.rail.velocity = 0;
      this.navigatePlane({
        lane: this.trackCoordinate("lane", this.columnCamera.value),
        row: this.trackCoordinate("row", this.rail.value),
      });
    };
    canvas.addEventListener("pointerdown", (e) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      if (!this.canBrowse() && !this.canInspect) return;
      pointers.add(e.pointerId);
      if (pointers.size > 1) {
        cancelled = true;
        reset();
        return;
      }
      activePointer = e.pointerId;
      cancelled = false;
      moved = this.archiveMomentum !== null;
      startX = previousX = e.clientX;
      startY = e.clientY;
      browse = this.canBrowse();
      this.stopMomentum();
      if (browse) {
        this.columnCamera.velocity = 0;
        this.rail.velocity = 0;
      }
      this.holdingArchive = browse;
      this.dragging = !browse && this.canInspect;
      startTrack = { lane: this.columnCamera.value, row: this.rail.value };
      this.archiveDrag.start(e.clientX, e.clientY, this.dragProjection(), e.timeStamp);
      this.setHover(null);
      canvas.setPointerCapture(e.pointerId);
    }, { signal: this.inputEvents.signal });
    canvas.addEventListener("pointermove", (e) => {
      if (activePointer !== null && e.pointerId !== activePointer) return;
      if (activePointer === null) {
        hover(e);
        return;
      }
      if (cancelled) return;
      moved ||= Math.hypot(e.clientX - startX, e.clientY - startY) > 7;
      if (browse) {
        if (!this.canBrowse()) {
          this.cancelPointer();
          return;
        }
        moveArchive(e);
        return;
      }
      if (this.dragging && this.canInspect) {
        this.targetRotation = THREE.MathUtils.clamp(
          this.targetRotation + (e.clientX - previousX) * 0.004,
          -0.8,
          0.8,
        );
        previousX = e.clientX;
      }
    }, { signal: this.inputEvents.signal });
    canvas.addEventListener("pointerup", (e) => {
      pointers.delete(e.pointerId);
      if (e.pointerId !== activePointer) return;
      if (!cancelled && browse && this.canBrowse()) {
        moveArchive(e);
        if (this.archiveDrag.active) {
          if (!this.reduced) {
            this.archiveMomentum = {
              time: performance.now() / 1000,
              motion: new ArchivePlaneMomentum(
                { lane: this.trackCoordinate("lane", this.columnCamera.value), row: this.trackCoordinate("row", this.rail.value) },
                this.archiveDrag.releaseVelocity(e.timeStamp, false),
              ),
            };
          }
        } else if (!moved) {
          const cell = this.pickCell(e.clientX, e.clientY);
          if (cell) this.onSelect?.(fileAtCell(cell), cell);
        }
      }
      reset();
    }, { signal: this.inputEvents.signal });
    canvas.addEventListener("pointercancel", (e) => {
      pointers.delete(e.pointerId);
      if (e.pointerId === activePointer) {
        cancelled = true;
        reset();
      }
    }, { signal: this.inputEvents.signal });
    canvas.addEventListener("lostpointercapture", (e) => {
      pointers.delete(e.pointerId);
      if (e.pointerId === activePointer) {
        cancelled = true;
        reset();
      }
    }, { signal: this.inputEvents.signal });
    canvas.addEventListener("pointerleave", () => {
      this.pointer.set(0, 0);
      this.setHover(null);
    }, { signal: this.inputEvents.signal });
    canvas.addEventListener(
      "wheel",
      (e) => {
        if (
          !this.canBrowse() ||
          activePointer !== null ||
          e.ctrlKey ||
          Math.abs(e.deltaX) > Math.abs(e.deltaY)
        )
          return;
        e.preventDefault();
        if (this.archiveMomentum) this.stopMomentum();
        const now = performance.now();
        const delta = THREE.MathUtils.clamp(
          e.deltaY *
            (e.deltaMode === 1
              ? 40
              : e.deltaMode === 2
                ? canvas.clientHeight
                : 1),
          -300,
          300,
        );
        if (now - wheelTime > 180 || Math.sign(delta) !== Math.sign(wheelTotal))
          wheelTotal = 0;
        wheelTime = now;
        wheelTotal += delta;
        const steps = Math.min(3, Math.floor(Math.abs(wheelTotal) / 100));
        if (!steps) return;
        const direction = Math.sign(wheelTotal);
        wheelTotal -= direction * steps * 100;
        this.navigatingDrag = true;
        try {
          for (let i = 0; i < steps; i++) this.onNavigate?.("row", direction);
        } finally {
          this.navigatingDrag = false;
        }
      },
      { ...{ passive: false }, signal: this.inputEvents.signal },
    );
    window.addEventListener("blur", () => this.cancelPointer(), { signal: this.inputEvents.signal });
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) this.cancelPointer();
    }, { signal: this.inputEvents.signal });
    window.addEventListener("resize", () => this.cancelPointer(), { signal: this.inputEvents.signal });
    window.addEventListener("pointerup", (e) => pointers.delete(e.pointerId), { signal: this.inputEvents.signal });
    window.addEventListener("pointercancel", (e) =>
      pointers.delete(e.pointerId), { signal: this.inputEvents.signal }
    );
  }
  update(
    time: number,
    cinematic?: { reveal: number; lift: number; zoom: number; time: number },
  ) {
    const elapsed = Math.max(0, time - this.last || 0.016);
    const dt = Math.min(elapsed, 0.05);
    this.last = time;
    this.clock = time;
    if (!this.loaded) return;
    (this.scene.background as THREE.Color).copy(BACKDROP);
    this.scene.fog!.color.copy(BACKDROP);
    this.bloom.strength = BLOOM_STRENGTH;
    if (this.approach) {
      const presence = ease(this.approach.weight);
      this.bloom.strength *= 1 - ease(progress(this.approach.t, APPROACH.bloom)) * presence;
      const paper = displayAlbedo(DOSSIER_PAPER, this.renderer.toneMappingExposure, 4);
      const k = ease(progress(this.approach.t, APPROACH.others)) * presence;
      (this.scene.background as THREE.Color).lerp(paper, k);
      this.scene.fog?.color.lerp(paper, k);
    }
    if (this.searchFade > 0) {
      const paper = displayAlbedo(DOSSIER_PAPER, this.renderer.toneMappingExposure, 4);
      (this.scene.background as THREE.Color).lerp(paper, this.searchFade);
      this.scene.fog?.color.lerp(paper, this.searchFade);
      this.bloom.strength *= 1 - this.searchFade;
    }
    const blend = 1 - Math.exp(-dt * (this.reduced ? 35 : 2.8));
    const detailBlend = 1 - Math.exp(-dt * (this.reduced ? 35 : 2.8));
    this.reveal = cinematic
      ? cinematic.reveal
      : THREE.MathUtils.lerp(this.reveal, this.targetReveal, blend);
    this.rotation = this.targetDetail
      ? THREE.MathUtils.lerp(this.rotation, this.targetRotation, detailBlend)
      : returnStep(this.rotation, dt, this.reduced);
    const shot = cinematic?.time ?? 29.1;
    if (cinematic) {
      this.scanTime = shot;
      this.scanBlend = 1;
    } else {
      this.scanTime += dt;
      this.scanBlend *= Math.exp(-dt * 3);
    }
    if (!this.canBrowse()) {
      this.setHover(null);
      if (this.holdingArchive || this.archiveMomentum) this.cancelPointer();
    }
    if (this.looping && !cinematic && !this.search && !this.holdingArchive && !this.archiveMomentum) this.rebaseCoordinates();
    const momentum = !cinematic ? this.archiveMomentum : null;
    if (momentum) {
      momentum.motion.step(Math.min(Math.max(time - momentum.time, 0), 0.25));
      momentum.time = time;
      this.navigatePlane(momentum.motion.value);
      this.lastInteraction = time;
    }
    const hoverKey = !cinematic && this.hoverCell ? cellKey(this.hoverCell) : null;
    if (hoverKey && !this.hoverLifts.has(hoverKey)) this.hoverLifts.set(hoverKey, 0);
    for (const [key, value] of this.hoverLifts) {
      const target = key === hoverKey ? 0.28 : 0;
      const next = cinematic ? 0 : this.reduced ? target : THREE.MathUtils.lerp(value, target, 1 - Math.exp(-dt * 14));
      if (target === 0 && next < 0.0001) this.hoverLifts.delete(key);
      else this.hoverLifts.set(key, next);
    }
    const hoverLift = (cell: ArchiveCell) => this.hoverLifts.get(cellKey(cell)) ?? 0;
    const chosen = this.cellPosition(this.selectedCell);
    const selectedRow = this.selectedCell.row;
    const selectedLane = this.selectedCell.lane;
    damp(this.shoulder, selectedRow, this.reduced ? 35 : 5, dt);
    damp(this.laneFocus, selectedLane, this.reduced ? 35 : 4, dt);
    if (!this.holdingArchive && !momentum && !this.search) {
      damp(this.columnCamera, chosen.x, this.reduced ? 35 : 3.7, dt);
      damp(this.rail, -2.17 - chosen.z, this.reduced ? 35 : 3.7, dt);
    }
    const search = cinematic ? null : this.search;
    if (search) this.lastInteraction = time;
    this.shoulderGain = this.reduced ? (search ? 0 : 1) : THREE.MathUtils.lerp(this.shoulderGain, search ? 0 : 1, 1 - Math.exp(-dt * 2.2));
    if (momentum) {
      this.columnCamera.value = this.trackPosition("lane", momentum.motion.lane.value);
      this.rail.value = this.trackPosition("row", momentum.motion.row.value);
      this.columnCamera.velocity = momentum.motion.lane.velocity * COLUMN_SPACING;
      this.rail.velocity = -momentum.motion.row.velocity * ROW_SPACING;
      if (momentum.motion.phase === "idle") this.archiveMomentum = null;
    }
    if (this.dragTrack && !cinematic) {
      this.columnCamera.value = this.dragTrack.lane;
      this.rail.value = this.dragTrack.row;
      this.columnCamera.velocity = this.rail.velocity = 0;
    }
    if (cinematic) {
      this.rail.value = -2.17 - chosen.z;
      this.rail.velocity = 0;
      this.lift.value = extraction(shot);
      this.lift.velocity = 0;
      this.shoulder.value = selectedRow;
      this.laneFocus.value = selectedLane;
      this.laneFocus.velocity = 0;
      this.columnCamera.value = chosen.x;
      this.columnCamera.velocity = 0;
    }
    const trackX = this.columnCamera.value;
    this.pulses = this.pulses.filter((p) => time - p.time < 3.2);
    const aligningCopy = this.outgoing.some((o) => o.returnY !== null);
    const idle =
      !cinematic &&
      !this.reduced &&
      this.targetReveal > 0 &&
      !this.targetDetail &&
      this.detail < 0.01 &&
      this.returnY === null &&
      !aligningCopy &&
      time - this.lastInteraction > 2.5;
    this.idleGain = cinematic
      ? 0
      : THREE.MathUtils.lerp(
          this.idleGain,
          idle ? 1 : 0,
          1 - Math.exp(-dt * (idle ? 0.8 : 4)),
        );
    this.pulseGain = THREE.MathUtils.lerp(
      this.pulseGain,
      this.targetDetail || this.returnY !== null || aligningCopy ? 0 : 1,
      1 - Math.exp(-dt * 8),
    );
    const field = (row: number, lane: number) => {
      if (cinematic)
        return cinematicField(
          row,
          lane,
          shot,
          this.shoulder.value,
          this.laneFocus.value,
        );
      const height =
        archiveWave(
          row + this.coordinateOrigin.row,
          lane + this.coordinateOrigin.lane,
          this.scanTime,
        ) *
          this.scanBlend;
      const breathing = idleWave(
          row + this.coordinateOrigin.row,
          lane + this.coordinateOrigin.lane,
          time,
        ) *
          this.idleGain;
      let pulseHeight = 0;
      if (!cinematic && !this.reduced) {
        let ripple = 0;
        for (const p of this.pulses) {
          const distance = Math.hypot(row - p.row, (lane - p.lane) * 2.2);
          const age = time - p.time;
          ripple += baselineSelectionWave(distance, age);
        }
        pulseHeight = THREE.MathUtils.clamp(ripple, -0.6, 0.6) * this.pulseGain;
      }
      const distance = row - this.shoulder.value;
      const scanning = search ? searchWave(row - search.center.row, lane - search.center.lane, search.t) : 0;
      return (
        height +
        settlingWave(distance, 26.56) * columnStrength(lane, this.laneFocus.value) * this.shoulderGain +
        breathing +
        pulseHeight +
        scanning
      );
    };
    const selectedBase = chosen.y + field(selectedRow, selectedLane);
    if (!cinematic) {
      if (this.returnY !== null && this.rotation !== 0) {
        this.lift.value = this.returnY - selectedBase;
        this.lift.velocity = 0;
      } else {
        this.returnY = null;
        damp(
          this.lift,
          this.targetDetail
            ? INSPECTION_LIFT
            : search
              ? 0
              : this.outgoing.some(
                  (o) =>
                    o.returnY !== null &&
                    o.cell.lane === selectedLane &&
                    Math.abs(o.cell.row - selectedRow) < 5,
                )
              ? 0
              : 0.4 * this.targetReveal,
          this.reduced ? 35 : 4.2,
          dt,
        );
      }
    }
    const cameraTarget = this.targetDetail
      ? ease((this.lift.value - 0.8) / 2.4)
      : this.returnY !== null
        ? this.detail
        : ease((this.lift.value - 0.4) / (INSPECTION_LIFT - 0.4));
    this.detail = cinematic
      ? cinematic.zoom
      : THREE.MathUtils.lerp(this.detail, cameraTarget, detailBlend);
    const detail = this.detail;
    this.decryption.update(dt, detail > .78 && this.lift.value > 3.3, false,
      cinematic ? shot + 5 : undefined);
    this.appearance.apply(this.model, ease(this.lift.value / 0.4));
    this.appearance.setClarity(this.model, this.modelClarity());
    const entry = cinematic ? ease((shot - 21.9) / 0.86) : this.reveal;
    const entranceTime = THREE.MathUtils.clamp((shot - 21.92) / 0.75, 0, 1);
    const entryZ = cinematic
      ? -23 * (1 - entranceTime) ** 2
      : -ENTRY_DEPTH * (1 - entry);
    for (let i = this.outgoing.length - 1; i >= 0; i--) {
      const o = this.outgoing[i];
      const p = this.cellPosition(o.cell);
      const baseY = p.y + field(o.cell.row, o.cell.lane);
      o.group.rotation.y = returnStep(o.group.rotation.y, dt, this.reduced);
      if (o.returnY !== null) {
        o.lift.value = o.returnY - baseY;
        o.lift.velocity = 0;
        if (o.group.rotation.y === 0) o.returnY = null;
      } else damp(o.lift, 0, this.reduced ? 35 : 4.5, dt);
      o.group.position.set(
        p.x - trackX,
        baseY + o.lift.value + hoverLift(o.cell),
        p.z + entryZ + this.rail.value,
      );
      const quality = ease(o.lift.value / 0.4);
      this.appearance.apply(o.group, quality);
      o.clarity = this.reduced ? 0 : o.clarity * Math.exp(-dt * 9);
      this.appearance.setClarity(o.group, o.clarity);
      const { row, lane } = o.cell;
      o.group.rotation.x =
        (field(row + 0.5, lane) - field(row - 0.5, lane)) *
        0.024 *
        (1 - detail) *
        (1 - quality);
      if (o.lift.value < 0.0001 && Math.abs(o.group.rotation.y) < 0.0001) {
        this.scene.remove(o.group);
        this.appearance.dispose(o.group);
        this.outgoing.splice(i, 1);
      }
    }
    this.model.position.set(
      chosen.x - trackX,
      chosen.y + field(selectedRow, selectedLane) + this.lift.value + hoverLift(this.selectedCell),
      chosen.z + entryZ + this.rail.value,
    );
    this.model.rotation.set(
      (field(selectedRow + 0.5, selectedLane) -
        field(selectedRow - 0.5, selectedLane)) *
        0.024 *
        (1 - detail) *
        (1 - ease(this.lift.value / 0.4)),
      cinematic ? 0 : this.rotation,
      0,
    );
    const modelInstanced = Boolean(search) && Math.abs(this.lift.value) < 0.002 && this.rotation === 0 && this.returnY === null;
    this.model.visible = !modelInstanced;
    if (search) {
      const pivot = new THREE.Vector3(0, CARD_CENTER_Y, 0);
      const tilt = new THREE.Quaternion();
      const turn = new THREE.Quaternion();
      search.targets.forEach((target, i) => {
        const start = extractStart(i);
        if (!target.pulsed && search.t >= start - 0.4) {
          target.pulsed = true;
          if (!this.reduced) this.emitPulse(target.cell);
        }
        const rise = spring((search.t - start) / EXTRACT.lift);
        const facing = spring((search.t - start - EXTRACT.turnDelay) / EXTRACT.turn);
        const lift = EXTRACT.height * rise;
        const quality = ease(lift / 0.4);
        const { row, lane } = target.cell;
        const base = this.cellPosition(target.cell);
        tilt.setFromAxisAngle(new THREE.Vector3(1, 0, 0), (field(row + 0.5, lane) - field(row - 0.5, lane)) * 0.024 * (1 - quality));
        turn.identity().slerp(search.face, facing).multiply(tilt);
        target.group.quaternion.copy(turn);
        target.group.position
          .set(base.x - trackX, base.y + field(row, lane) * (1 - Math.min(1, rise)) + lift, base.z + entryZ + this.rail.value)
          .add(pivot.clone().sub(pivot.clone().applyQuaternion(turn)))
          .addScaledVector(search.to.dir, (EXTRACT.toward + target.lean) * facing);
        target.group.visible = !target.released;
        this.appearance.apply(target.group, quality);
        this.appearance.setClarity(target.group, this.reduced ? 0 : smooth((search.t - start - EXTRACT.clarityDelay) / EXTRACT.clarity));
      });
    }
    let approach = this.approach;
    if (approach?.releasing) {
      approach.weight = Math.max(0, approach.weight - dt / 0.9);
      if (approach.weight === 0) approach = this.approach = null;
    }
    const approachWeight = approach ? ease(approach.weight) : 0;
    const front = approach ? this.frontView(FACE_CENTER.clone().applyEuler(this.model.rotation).add(this.model.position)) : null;
    const pull = approach ? easeOutSpring(progress(approach.t, APPROACH.pull), 5) : 0;
    this.model.position.z += APPROACH.extract * pull * approachWeight;
    const orbit = ease((shot - 22.6) / 1.6);
    const settle = ease((shot - 24.25) / 2.25);
    const yaw = THREE.MathUtils.degToRad(89 - 22 * orbit - 8 * settle);
    const elevation = THREE.MathUtils.degToRad(
      3 + 40 * ease((shot - 21.96) / 0.22) - 8 * orbit - 16 * settle,
    );
    const span = THREE.MathUtils.lerp(
      THREE.MathUtils.lerp(10.8, 10.3, orbit),
      7.33,
      settle,
    );
    const responsiveOpening = Boolean(cinematic) && this.container.closest<HTMLElement>("[data-layout]")?.dataset.layout === "opening";
    const openingAspect = responsiveOpening ? this.container.clientWidth / this.container.clientHeight / (16 / 9) : 1;
    const openingSpan = (value: number) => value / Math.min(1, openingAspect);
    const distance = THREE.MathUtils.lerp(
      THREE.MathUtils.lerp(28 + 7 * orbit, 140, settle),
      72,
      detail,
    );
    const arrayAim = new THREE.Vector3(
      -1.091,
      THREE.MathUtils.lerp(-2.55 + 0.4 * orbit, -0.045, settle),
      THREE.MathUtils.lerp(2.48, 0.481, settle),
    );
    const cameraAim = arrayAim.clone();
    const viewDirection = new THREE.Vector3(
      -Math.sin(yaw) * Math.cos(elevation),
      Math.sin(elevation),
      Math.cos(yaw) * Math.cos(elevation),
    );
    if (cinematic) {
      const earlyTurn = ease((shot - 27.3) / 1.3);
      const finalTurn = ease((shot - 28.6) / 5.4);
      const shotYaw =
        yaw - THREE.MathUtils.degToRad(9 * earlyTurn + 32 * finalTurn);
      const shotElevation =
        elevation - THREE.MathUtils.degToRad(1.5 * earlyTurn + 3.7 * finalTurn);
      viewDirection.set(
        -Math.sin(shotYaw) * Math.cos(shotElevation),
        Math.sin(shotElevation),
        Math.cos(shotYaw) * Math.cos(shotElevation),
      );
    } else {
      viewDirection
        .lerp(new THREE.Vector3(-0.277, 0.238, 0.931), detail)
        .normalize();
    }
    if (cinematic) {
      const pan = ease((shot - 25.4) / 0.95);
      const right = new THREE.Vector3()
        .crossVectors(new THREE.Vector3(0, 1, 0), viewDirection)
        .normalize();
      cameraAim.addScaledVector(
        right,
        -2.05 * (1 - pan) * ease((shot - 24.2) / 0.8),
      );
    }
    if (cinematic && shot >= 25.05) {
      const pan = ease((shot - 25.4) / 1.05);
      const right = new THREE.Vector3()
        .crossVectors(new THREE.Vector3(0, 1, 0), viewDirection)
        .normalize();
      const up = new THREE.Vector3()
        .crossVectors(viewDirection, right)
        .normalize();
      const pixelScale = 1080 / openingSpan(span);
      const anchorAim = this.model.position
        .clone()
        .add(new THREE.Vector3(-CARD_WIDTH / 2, CARD_HEIGHT, 0));
      anchorAim.addScaledVector(
        right,
        -(THREE.MathUtils.lerp(840, 518, pan) - 960) * openingAspect / pixelScale,
      );
      anchorAim.addScaledVector(
        up,
        -(540 - THREE.MathUtils.lerp(340, 288, pan)) / pixelScale,
      );
      cameraAim.lerp(anchorAim, ease((shot - 25.05) / 0.35));
    }
    if (cinematic && shot > 27.3) {
      const close = ease((shot - 27.3) / 6.7);
      const extractionCamera = ease((shot - 27.3) / 1.25);
      const screenX = THREE.MathUtils.lerp(
        518 - 98 * extractionCamera,
        618,
        close,
      );
      const screenY = THREE.MathUtils.lerp(
        296 + 34 * extractionCamera,
        287,
        close,
      );
      const pixelScale = 1080 / openingSpan(THREE.MathUtils.lerp(span, 5.9, detail));
      const right = new THREE.Vector3()
        .crossVectors(new THREE.Vector3(0, 1, 0), viewDirection)
        .normalize();
      const up = new THREE.Vector3()
        .crossVectors(viewDirection, right)
        .normalize();
      const anchorAim = this.model.position
        .clone()
        .add(new THREE.Vector3(-CARD_WIDTH / 2, CARD_HEIGHT, 0));
      anchorAim.addScaledVector(right, -(screenX - 960) * openingAspect / pixelScale);
      anchorAim.addScaledVector(up, -(540 - screenY) / pixelScale);
      cameraAim.lerp(anchorAim, ease((shot - 27.3) / 0.5));
    }
    const framing = archiveFraming(this.container.clientWidth, this.container.clientHeight, span, detail,
      this.container.closest<HTMLElement>("[data-layout]")?.dataset.layout === "compact");
    if (!cinematic) {
      const right = new THREE.Vector3()
        .crossVectors(new THREE.Vector3(0, 1, 0), viewDirection)
        .normalize();
      const up = new THREE.Vector3()
        .crossVectors(viewDirection, right)
        .normalize();
      const width = this.container.clientWidth, height = this.container.clientHeight;
      const pixelScale = height / framing.span;
      if (framing.portrait) {
        const previewAim = new THREE.Vector3(0, -4.6 + settlingWave(0, 26.56) + 0.4 + CARD_CENTER_Y, -2.17);
        previewAim.addScaledVector(up, (framing.previewY - 0.5) * height / pixelScale);
        cameraAim.copy(previewAim);
      }
      const detailAim = this.model.position
        .clone()
        .add(new THREE.Vector3(0, CARD_CENTER_Y, 0));
      detailAim.addScaledVector(right, (0.5 - framing.detailX) * width / pixelScale);
      detailAim.addScaledVector(up, (framing.detailY - 0.5) * height / pixelScale);
      cameraAim.lerp(detailAim, detail);
    }
    const cameraPosition = cameraAim
      .clone()
      .addScaledVector(viewDirection, distance);
    if (!cinematic && !this.reduced) {
      cameraPosition.x += this.pointer.x * 0.12;
      cameraPosition.y -= this.pointer.y * 0.12;
    }
    const snapped = this.snapCamera;
    this.snapCamera = false;
    const cameraBlend = cinematic || snapped || this.reduced ? 1 : 1 - Math.exp(-dt * 5);
    this.camera.position.lerp(cameraPosition, cameraBlend);
    this.cameraAim.lerp(cameraAim, cameraBlend);
    this.camera.lookAt(this.cameraAim);
    this.camera.fov = THREE.MathUtils.lerp(
      this.camera.fov,
      THREE.MathUtils.radToDeg(
        2 * Math.atan((cinematic ? openingSpan(THREE.MathUtils.lerp(span, 5.9, detail)) : framing.span) / (2 * distance)),
      ),
      cameraBlend,
    );
    if (approach && front && !approach.releasing) {
      const from = approach.from;
      const turn = easeOutSpring(progress(approach.t, APPROACH.turn));
      const view = blendView(blendView(from, front.turn, turn), front.close, pull);
      this.cameraAim.copy(view.aim);
      this.camera.position.copy(view.aim).addScaledVector(view.dir, view.dist);
      this.camera.lookAt(view.aim);
      this.camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(from.tanHalf * Math.pow(front.tanHalf / from.tanHalf, turn)));
    }
    if (search) {
      const k = this.reduced ? 1 : spring(search.t / EXTRACT.camera);
      const view = blendView(search.from, search.to, k);
      this.cameraAim.copy(view.aim);
      this.camera.position.copy(view.aim).addScaledVector(view.dir, view.dist);
      this.camera.lookAt(view.aim);
      this.camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(search.from.tanHalf * Math.pow(search.to.tanHalf / search.from.tanHalf, k)));
    }
    const fog = this.scene.fog as THREE.Fog;
    const renderedDistance = this.camera.position.distanceTo(this.cameraAim);
    fog.near = renderedDistance + THREE.MathUtils.lerp(5, -1, detail);
    fog.far = renderedDistance + THREE.MathUtils.lerp(25, 12, detail);

    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
    this.aimFloodLight(dt, Boolean(cinematic) || snapped);
    const fixed = (Boolean(cinematic) || !this.looping) && !responsiveOpening;
    this.cells = fixed ? Array.from({ length: 160 }, (_, i) => poolCell(i))
      : this.visibility.update(this.camera, fog.far, trackX, entryZ + this.rail.value);
    const hidden = new Set(this.outgoing.map(o => cellKey(o.cell)));
    if (!modelInstanced) hidden.add(cellKey(this.selectedCell));
    const searchCells = new Map((search?.targets ?? []).map((target) => [cellKey(target.cell), target]));
    for (const key of searchCells.keys()) hidden.add(key);
    this.drawnCells = [];
    this.matrixUpdates ??= new InstanceUpdates(this.instances[0].instanceMatrix);
    if (this.stackAttribute) this.stackUpdates ??= new InstanceUpdates(this.stackAttribute);
    if (this.numberAttribute) this.numberUpdates ??= new InstanceUpdates(this.numberAttribute);
    if (this.fadeAttribute) this.fadeUpdates ??= new InstanceUpdates(this.fadeAttribute);
    this.floorFade.value = Math.max(approach ? ease(progress(approach.t, APPROACH.others)) * approachWeight : 0, this.searchFade);
    const cardHeights = new Map<string, number>();
    const cardHeight = (row: number, lane: number) => {
      const cell = { row, lane };
      const key = cellKey(cell);
      let height = cardHeights.get(key);
      if (height !== undefined) return height;
      const extracted = searchCells.get(key);
      if (fixed && (row < 0 || row >= LOOP_ROWS)) height = -40;
      else if (extracted) height = extracted.released ? -40 : extracted.group.position.y;
      else if (sameCell(cell, this.selectedCell) && !modelInstanced) height = this.model.position.y;
      else {
        const copy = this.outgoing.find((o) => sameCell(o.cell, cell));
        height = copy ? copy.group.position.y : -4.6 + field(row, lane) + hoverLift(cell);
      }
      cardHeights.set(key, height);
      return height;
    };
    const reliefs = new Array<number>(STACK_DEPTH);
    const stackReliefs = (cell: ArchiveCell, height: number) => {
      for (let n = 0; n < STACK_DEPTH; n++) reliefs[n] = cardHeight(cell.row - n - 1, cell.lane) - height;
      return reliefs;
    };
    for (const cell of this.cells) {
      const { row, lane } = cell;
      if (hidden.has(cellKey(cell))) continue;
      const x = (lane - 2) * COLUMN_SPACING - trackX;
      const y = -4.6 + field(row, lane) + hoverLift(cell);
      const z = (row - 15.5) * ROW_SPACING + entryZ + this.rail.value;
      if (!fixed && !this.visibility.intersects(x, y, z)) continue;
      const i = this.drawnCells.length;
      this.ensureInstanceCapacity(i + 1);
      this.drawnCells.push(cell);
      this.numberUpdates?.scalar(i, this.cardNumber(cell));
      this.fadeUpdates?.scalar(i, Math.max(this.approachFade(cell, approachWeight), this.searchFade));
      cardHeights.set(cellKey(cell), y);
      this.stackUpdates?.set(i * STACK_DEPTH, stackReliefs(cell, y));
      const slope = field(row + .5, lane) - field(row - .5, lane);
      this.dummy.position.set(x, y, z);
      this.dummy.rotation.set(slope * .024 * (1 - detail), 0, 0);
      this.dummy.scale.setScalar(1);
      this.dummy.updateMatrix();
      this.matrixUpdates!.set(i * 16, this.dummy.matrix.elements);
    }
    const countChanged = this.instances[0].count !== this.drawnCells.length;
    const matricesChanged = this.matrixUpdates!.commit();
    for (const inst of this.instances) {
      inst.count = this.drawnCells.length;
    }
    if (matricesChanged || countChanged || !this.instances[0].boundingSphere) this.instances[0].computeBoundingSphere();
    this.stackUpdates?.commit();
    this.numberUpdates?.commit();
    this.fadeUpdates?.commit();
    this.appearance.setStack(this.model, stackReliefs(this.selectedCell, this.model.position.y));
    for (const o of this.outgoing) this.appearance.setStack(o.group, stackReliefs(o.cell, o.group.position.y));
    for (const target of search?.targets ?? []) this.appearance.setStack(target.group, stackReliefs(target.cell, target.group.position.y));
    this.appearance.setNumber(this.model, this.cardNumber(this.selectedCell));
    for (const o of this.outgoing) this.appearance.setNumber(o.group, this.cardNumber(o.cell));
    let neighborTop = -Infinity;
    const lane = selectedLane,
      row = selectedRow;
    for (let r = row - 5; r <= row + 5; r++) {
      if (r !== row)
        neighborTop = Math.max(neighborTop, -4.6 + field(r, lane) + CARD_HEIGHT + 0.06);
    }
    for (const o of this.outgoing) {
      if (o.cell.lane === lane && Math.abs(o.cell.row - row) <= 5) {
        neighborTop = Math.max(neighborTop, o.group.position.y + CARD_HEIGHT + 0.06);
      }
    }
    this.clearance = this.model.position.y - neighborTop;
    this.canInspect =
      !cinematic &&
      Boolean(this.targetDetail) &&
      detail > 0.9 &&
      this.pulseGain < 0.01 &&
      this.clearance > 0.3;
    this.container.dataset.inspection =
      this.returnY !== null
        ? "aligning"
        : this.canInspect
          ? "ready"
          : this.targetDetail
            ? "lifting"
            : "preview";
    const focalPoint = this.model.position
      .clone()
      .add(new THREE.Vector3(0, 2, 0))
      .applyMatrix4(this.camera.matrixWorldInverse);
    const bokehUniforms = this.bokeh.uniforms as Record<
      string,
      { value: number }
    >;
    bokehUniforms.focus.value = -focalPoint.z;
    const soften = approach ? ease(progress(approach.t, APPROACH.column)) * approachWeight : 0;
    bokehUniforms.aperture.value =
      (THREE.MathUtils.lerp(cinematic ? 0.0011 : 0.00032, 0.00034, detail) *
        (1 + 5 * soften));
    bokehUniforms.maxblur.value = 0.008 + 0.005 * soften;
    if (search) {
      bokehUniforms.focus.value = this.camera.position.distanceTo(this.cameraAim);
      bokehUniforms.aperture.value = 0.00018;
    }
    this.renderer.info.reset();
    const state = this.renderState;
    this.scene.updateMatrixWorld();
    if (matricesChanged || cinematic) {
      state.invalidate();
    } else {
      state.begin();
      state.floats(...this.camera.projectionMatrix.elements, ...this.camera.matrixWorldInverse.elements,
        ...this.light.position.toArray(),
        ...this.camera.position.toArray(),
        fog.near, fog.far,
        bokehUniforms.focus.value, bokehUniforms.aperture.value, bokehUniforms.maxblur.value, this.floorFade.value,
        ...(this.scene.background as THREE.Color).toArray(), this.bloom.strength);
      this.scene.traverse(object => {
        state.add(object.id, Number(object.visible));
        if (!(object instanceof THREE.Mesh)) return;
        object.modelViewMatrix.multiplyMatrices(this.camera.matrixWorldInverse, object.matrixWorld);
        object.normalMatrix.getNormalMatrix(object.modelViewMatrix);
        state.floats(...object.modelViewMatrix.elements, ...object.normalMatrix.elements, ...object.matrixWorld.elements);
        const mat = object.material as THREE.MeshPhysicalMaterial;
        state.add(object.geometry.id, mat.uuid, mat.map?.uuid, mat.map?.version ?? 0);
        state.floats(
          mat.opacity, mat.roughness, mat.metalness, mat.transmission, mat.thickness,
          mat.attenuationDistance, mat.clearcoat, mat.clearcoatRoughness,
          mat.color.r, mat.color.g, mat.color.b,
          mat.attenuationColor?.r ?? 0, mat.attenuationColor?.g ?? 0, mat.attenuationColor?.b ?? 0);
        for (const name of ['appearance', 'glassClarity'])
          state.floats(object.userData[name]?.value ?? 0);
        const stack = object.userData.stackReliefs?.value as THREE.Vector4 | undefined;
        if (stack) state.floats(stack.x, stack.y, stack.z, stack.w);
        if (object instanceof THREE.InstancedMesh)
          state.add(object.count, object.instanceMatrix.version, this.stackAttribute?.version ?? 0, this.numberAttribute?.version ?? 0, this.fadeAttribute?.version ?? 0);
      });
      if (!state.end()) return;
    }
    this.renderer.shadowMap.needsUpdate = true;
    const clearing = this.modelClarity() > 0.001 || this.outgoing.some((o) => o.clarity > 0.001);
    const transmission = (1 / this.supersample.supersample) * (clearing ? 1 : 0.5);
    if (this.renderer.transmissionResolutionScale !== transmission) this.renderer.transmissionResolutionScale = transmission;
    this.scissorTransmission();
    this.composer.render();
    if (this.governor.frame(this.supersample.supersample)) this.resize();
  }
  private floodDirection = new THREE.Vector3(0.62, 0.62, -0.48).normalize();
  private aimFloodLight(dt: number, immediate: boolean) {
    const forward = new THREE.Vector3().subVectors(this.cameraAim, this.camera.position);
    forward.y = 0;
    if (forward.lengthSq() < 1e-6) return;
    forward.normalize();
    const right = new THREE.Vector3(-forward.z, 0, forward.x);
    const target = forward.multiplyScalar(0.72).add(new THREE.Vector3(0, 0.66, 0)).addScaledVector(right, -0.2).normalize();
    this.floodDirection.lerp(target, immediate ? 1 : 1 - Math.exp(-dt * 3)).normalize();
    this.light.target.position.copy(this.cameraAim);
    this.light.position.copy(this.cameraAim).addScaledVector(this.floodDirection, 36);
    this.light.target.updateMatrixWorld();
    this.light.updateMatrixWorld();
    this.stackUniforms.archiveLightDir.value.copy(this.floodDirection);
  }
  cardView() {
    this.model.updateMatrixWorld(true);
    this.camera.updateMatrixWorld();
    return {
      card: this.model.matrixWorld.toArray(),
      camera: this.camera.matrixWorld.toArray(),
      fov: this.camera.fov,
      face: { width: CARD_WIDTH, height: CARD_HEIGHT, center: [0, CARD_CENTER_Y, CARD_FACE_Z] as [number, number, number] },
    };
  }
  projectCard(x: number, y: number) {
    this.model.updateMatrixWorld(true);
    const p = this.model
      .localToWorld(new THREE.Vector3(x, y, CARD_LABEL.z))
      .project(this.camera);
    return [(p.x + 1) * this.container.clientWidth / 2, (1 - p.y) * this.container.clientHeight / 2];
  }
  get decryptionFrame() { return this.decryption.frame; }
  get detailVisibility() {
    return ease((this.detail - 0.25) / 0.55);
  }
}
