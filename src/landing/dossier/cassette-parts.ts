import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import assemblyUrl from "../models/archive-assembly.glb?url";
import { labelMarkSvg } from "../ui/brand-marks";
import { CARD_CENTER_Y, CARD_DEPTH, CARD_HEIGHT, CARD_LABEL, CARD_WIDTH, LABEL_CANVAS, drawCardLabel } from "../array/card-spec";

export const CASSETTE = { width: CARD_WIDTH, height: CARD_HEIGHT, depth: CARD_DEPTH, center: new THREE.Vector3(0, CARD_CENTER_Y, 0.038) };

let assembly: Promise<THREE.Group> | null = null;
function loadAssembly() {
  assembly ??= new GLTFLoader()
    .loadAsync(assemblyUrl)
    .then((gltf) => {
      gltf.scene.updateMatrixWorld(true);
      return gltf.scene;
    })
    .catch((error) => {
      assembly = null;
      throw error;
    });
  return assembly;
}

const surfaceOf = (material: THREE.Material) => material.name.replace(/\.\d+$/, "");

let markImage: Promise<HTMLImageElement> | null = null;
function loadMark() {
  markImage ??= new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(labelMarkSvg)}`;
  });
  return markImage;
}

async function drawCassetteLabel(number: number) {
  const mark = await loadMark();
  const canvas = document.createElement("canvas");
  canvas.width = LABEL_CANVAS.width;
  canvas.height = LABEL_CANVAS.height;
  drawCardLabel(canvas.getContext("2d")!, number, mark);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

function labelPlane(texture: THREE.Texture) {
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(CARD_LABEL.width, CARD_LABEL.height),
    new THREE.MeshBasicMaterial({ map: texture, toneMapped: false, transparent: true, depthWrite: false }),
  );
  mesh.position.set(CARD_LABEL.x, CARD_LABEL.y, CARD_LABEL.z);
  mesh.name = "cassette-label";
  mesh.userData.part = "cover";
  return mesh;
}

let letteringTexture: THREE.CanvasTexture | null = null;
function mouldedLetteringTexture() {
  if (letteringTexture) return letteringTexture;
  const canvas = document.createElement("canvas");
  canvas.width = 2048;
  canvas.height = 216;
  const c = canvas.getContext("2d")!;
  c.clearRect(0, 0, canvas.width, canvas.height);
  c.font = "600 168px 'Newsreader Variable', 'Noto Serif SC Variable', serif";
  c.textBaseline = "middle";
  c.fillStyle = "#ffffff";
  const text = "NAIMAKES FORUM.";
  const letters = Array.from(text);
  const widths = letters.map((letter) => c.measureText(letter).width);
  const gap = 10;
  const total = widths.reduce((sum, w) => sum + w, 0) + gap * (letters.length - 1);
  let x = (canvas.width - total) / 2;
  letters.forEach((letter, i) => {
    c.fillText(letter, x, canvas.height / 2 + 6);
    x += widths[i] + gap;
  });
  letteringTexture = new THREE.CanvasTexture(canvas);
  letteringTexture.colorSpace = THREE.SRGBColorSpace;
  letteringTexture.anisotropy = 8;
  return letteringTexture;
}

function mouldedLettering(width = 0.129, height = 1.218) {
  const material = new THREE.MeshPhysicalMaterial({
    color: "#fdfbf8",
    alphaMap: mouldedLetteringTexture(),
    transparent: true,
    opacity: 0.92,
    roughness: 0.18,
    clearcoat: 1,
    clearcoatRoughness: 0.08,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(height, width * 1.08), material);
  mesh.rotation.z = -Math.PI / 2;
  mesh.name = "naimakes-lettering";
  return mesh;
}

type CassetteLook = "crystal" | "lite";

function materialFor(surface: string, look: CassetteLook): THREE.Material | null {
  const lite = look === "lite";
  const glass = (params: THREE.MeshPhysicalMaterialParameters) =>
    lite
      ? new THREE.MeshPhysicalMaterial({
          ...params,
          transmission: 0,
          thickness: 0,
          transparent: true,
          opacity: params.transmission ? 0.34 + (1 - params.transmission) * 0.5 : 1,
          depthWrite: false,
        })
      : new THREE.MeshPhysicalMaterial(params);
  switch (surface) {
    case "Frosted_Polymer":
      return new THREE.MeshStandardMaterial({ color: "#e1dad5", roughness: 0.5, envMapIntensity: 0.9 });
    case "Optical_Window":
      return lite
        ? glass({ color: "#fbf8f4", roughness: 0.07, transmission: 1, thickness: 0.34, ior: 1.46, clearcoat: 1, clearcoatRoughness: 0.04 })
        : new THREE.MeshPhysicalMaterial({ color: "#fbf7f2", roughness: 0.06, transparent: true, opacity: 0.14, clearcoat: 1, clearcoatRoughness: 0.03, specularIntensity: 1, envMapIntensity: 1.4, depthWrite: false });
    case "Ivory_Edges":
      return lite
        ? glass({ color: "#f1e5d6", roughness: 0.2, transmission: 0.62, thickness: 0.22, ior: 1.46, clearcoat: 0.8, clearcoatRoughness: 0.1, envMapIntensity: 1.1 })
        : new THREE.MeshPhysicalMaterial({ color: "#e9dac6", roughness: 0.46, sheen: 0.6, sheenRoughness: 0.5, sheenColor: new THREE.Color("#f3d9b4"), clearcoat: 0.25, clearcoatRoughness: 0.35, envMapIntensity: 1.0, emissive: new THREE.Color("#8a5a2a"), emissiveIntensity: 0.06 });
    case "Optical_Edges":
      return glass({ color: "#d9d4ce", roughness: 0.1, transmission: 0.82, thickness: 0.32, ior: 1.5, clearcoat: 1, clearcoatRoughness: 0.05, envMapIntensity: 1.3 });
    case "Optical_Diffuser":
      return lite
        ? glass({ color: "#f4f0ea", roughness: 0.55, transmission: 0.3, thickness: 0.18, envMapIntensity: 0.9 })
        : new THREE.MeshStandardMaterial({ color: "#eee6dc", roughness: 0.7, envMapIntensity: 0.9 });
    case "Subsurface_Optics":
      return glass({ color: "#cdc8c2", roughness: 0.1, transmission: 0.86, thickness: 0.62, ior: 1.52, attenuationColor: new THREE.Color("#8f8881"), attenuationDistance: 0.9, clearcoat: 1, clearcoatRoughness: 0.04, specularIntensity: 1, envMapIntensity: 1.4 });
    case "Amber_Optical_Inlay":
      return new THREE.MeshStandardMaterial({ color: "#dc7a26", roughness: 0.32, metalness: 0.05, emissive: new THREE.Color("#7a3000"), emissiveIntensity: 0.28 });
    case "Optical_Film":
      return new THREE.MeshPhysicalMaterial({ color: "#ebe6e0", roughness: 0.18, transparent: true, opacity: lite ? 0.55 : 0.72, side: THREE.DoubleSide, clearcoat: 0.6, depthWrite: false });
    case "Optical_Film_Edge":
      return new THREE.MeshStandardMaterial({ color: "#a8a29b", roughness: 0.3, metalness: 0.1 });
    case "Internal_Ceramic":
      return new THREE.MeshStandardMaterial({ color: "#8e877f", roughness: 0.5 });
    case "Printed_Label":
      return new THREE.MeshStandardMaterial({ color: "#e6e2d9", roughness: 0.6 });
    case "Index_Inlay":
      return new THREE.MeshStandardMaterial({ color: "#d6bea2", roughness: 0.42 });
    case "Case_Engraving":
      return new THREE.MeshStandardMaterial({ color: "#d9d2ca", roughness: 0.35, transparent: true, opacity: 0.9 });
    case "Case_Engraving_Highlight":
      return new THREE.MeshStandardMaterial({ color: "#f6f2ed", roughness: 0.25 });
    case "Titanium_Fasteners":
      return new THREE.MeshStandardMaterial({ color: "#c9ccd1", metalness: 0.9, roughness: 0.22 });
    case "Fastener_Socket":
      return new THREE.MeshStandardMaterial({ color: "#3f3b49", roughness: 0.5 });
    case "Plan_Hairline":
      return new THREE.MeshStandardMaterial({ color: "#f6f4f1", roughness: 0.6 });
    case "Champagne_Index":
      return new THREE.MeshStandardMaterial({ color: "#d4c4ad", metalness: 0.45, roughness: 0.3 });
    case "Moulded_Lettering":
    case "Carbon_Ink":
      return null;
    default:
      return new THREE.MeshStandardMaterial({ color: "#e8e3dd", roughness: 0.4 });
  }
}

export type CassetteModel = {
  group: THREE.Group;
  meshes: THREE.Mesh[];
  parts: Map<string, THREE.Object3D[]>;
  dispose: () => void;
};

export async function createCassette({ look = "crystal" as CassetteLook, number = 1 } = {}): Promise<CassetteModel> {
  const template = await loadAssembly();
  const group = new THREE.Group();
  const meshes: THREE.Mesh[] = [];
  const parts = new Map<string, THREE.Object3D[]>();
  const materials = new Map<string, THREE.Material>();
  const add = (part: string, object: THREE.Object3D) => {
    if (!parts.has(part)) parts.set(part, []);
    parts.get(part)!.push(object);
  };
  template.traverse((object) => {
    const source = object as THREE.Mesh;
    if (!source.isMesh) return;
    const surface = surfaceOf(source.material as THREE.Material);
    const part = String(source.userData.assemblyPart ?? "cover");
    let material = materials.get(surface);
    if (!materials.has(surface)) {
      const created = materialFor(surface, look);
      if (created) materials.set(surface, created);
      material = created ?? undefined;
    }
    const geometry = source.geometry.clone().applyMatrix4(source.matrixWorld);
    geometry.translate(-CASSETTE.center.x, -CASSETTE.center.y, -CASSETTE.center.z);
    if (surface === "Moulded_Lettering") {
      geometry.computeBoundingBox();
      const box = geometry.boundingBox!;
      const size = box.getSize(new THREE.Vector3());
      const lettering = mouldedLettering(size.x, size.y);
      lettering.position.set((box.min.x + box.max.x) / 2, (box.min.y + box.max.y) / 2, box.max.z + 0.002);
      lettering.userData.part = part;
      group.add(lettering);
      add(part, lettering);
      geometry.dispose();
      return;
    }
    if (!material) {
      geometry.dispose();
      return;
    }
    const mesh = new THREE.Mesh(geometry, material);
    mesh.userData.part = part;
    mesh.userData.surface = surface;
    group.add(mesh);
    meshes.push(mesh);
    add(part, mesh);
  });
  const label = labelPlane(await drawCassetteLabel(number));
  label.position.sub(CASSETTE.center);
  group.add(label);
  add("cover", label);
  return {
    group,
    meshes,
    parts,
    dispose() {
      group.traverse((object) => {
        const mesh = object as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.geometry.dispose();
        const material = mesh.material as THREE.Material & { map?: THREE.Texture };
        if (material.map) material.map.dispose();
      });
      materials.forEach((material) => material.dispose());
    },
  };
}
