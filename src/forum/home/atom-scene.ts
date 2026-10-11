import * as THREE from "three";

const ATOM_RADIUS = 2.32;
const ORBIT_MINOR_RADIUS = 0.93;
export const NUCLEON_RADIUS = 0.17;
const TAU = Math.PI * 2;

type Nucleon = { position: [number, number, number]; kind: "proton" | "neutron" };

export const NUCLEON_LAYOUT: readonly Nucleon[] = [
  { position: [0, 0, 0], kind: "proton" },
  { position: [.218, .218, 0], kind: "proton" },
  { position: [.218, -.218, 0], kind: "neutron" },
  { position: [-.218, .218, 0], kind: "neutron" },
  { position: [-.218, -.218, 0], kind: "proton" },
  { position: [.218, 0, .218], kind: "neutron" },
  { position: [.218, 0, -.218], kind: "proton" },
  { position: [-.218, 0, .218], kind: "proton" },
  { position: [-.218, 0, -.218], kind: "neutron" },
  { position: [0, .218, .218], kind: "proton" },
  { position: [0, .218, -.218], kind: "neutron" },
  { position: [0, -.218, .218], kind: "neutron" },
  { position: [0, -.218, -.218], kind: "proton" },
];

class ElectronOrbit extends THREE.Curve<THREE.Vector3> {
  constructor() { super(); }
  getPoint(t: number, target = new THREE.Vector3()) {
    return target.set(ATOM_RADIUS * Math.cos(t * TAU), ORBIT_MINOR_RADIUS * Math.sin(t * TAU), 0);
  }
}

export function orbitPath(scale = 78) {
  const x = (ATOM_RADIUS * scale).toFixed(2), y = (ORBIT_MINOR_RADIUS * scale).toFixed(2);
  return `M ${x} 0 A ${x} ${y} 0 1 0 -${x} 0 A ${x} ${y} 0 1 0 ${x} 0 Z`;
}

export function createAtom(lite = false) {
  const group = new THREE.Group(); group.name = "atom";
  group.rotation.set(0.08, 0, -0.14);
  const silver = new THREE.MeshPhysicalMaterial({ color: 0xc6cbd0, metalness: 0.78, roughness: 0.28, clearcoat: 0.35, clearcoatRoughness: 0.25, envMapIntensity: 0.72 });
  const warm = new THREE.MeshPhysicalMaterial({ color: 0xd8af84, metalness: 0.42, roughness: 0.27, clearcoat: 0.5, clearcoatRoughness: 0.18, envMapIntensity: 0.56 });
  const cool = new THREE.MeshPhysicalMaterial({ color: 0x94aec9, metalness: 0.48, roughness: 0.26, clearcoat: 0.5, clearcoatRoughness: 0.18, envMapIntensity: 0.56 });
  const electronMaterial = new THREE.MeshPhysicalMaterial({ color: 0xeee4d8, metalness: 0.65, roughness: 0.2, clearcoat: 0.5, envMapIntensity: 0.85 });
  const trailMaterial = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.5, depthWrite: false, depthTest: false });
  const materials = [silver, warm, cool, electronMaterial, trailMaterial];
  const nucleonGeometry = new THREE.SphereGeometry(NUCLEON_RADIUS, lite ? 32 : 64, lite ? 24 : 40);
  const electronGeometry = new THREE.SphereGeometry(0.12, lite ? 24 : 40, lite ? 16 : 28);
  const railGeometry = new THREE.TubeGeometry(new ElectronOrbit(), lite ? 192 : 448, 0.023, lite ? 10 : 16, true);
  const geometries: THREE.BufferGeometry[] = [nucleonGeometry, electronGeometry, railGeometry];
  const nucleus = new THREE.Group(); nucleus.name = "nucleus";
  NUCLEON_LAYOUT.forEach(({ position, kind }) => {
    const sphere = new THREE.Mesh(nucleonGeometry, kind === "neutron" ? cool : warm);
    sphere.name = kind;
    sphere.position.fromArray(position); nucleus.add(sphere);
  });
  group.add(nucleus);
  const electrons: THREE.Mesh[] = [], orbits: THREE.Group[] = [], trails: THREE.Line[] = [];
  const tilts = [[.12, -.26, 0], [-.2, .34, Math.PI / 3], [.18, .06, -Math.PI / 3]];
  for (let i = 0; i < 3; i++) {
    const curve = new ElectronOrbit();
    const orbit = new THREE.Group(); orbit.name = `orbit-${i}`;
    orbit.rotation.set(...tilts[i] as [number, number, number]);

    const rail = new THREE.Mesh(railGeometry, silver); rail.name = "silver-orbit"; orbit.add(rail);
    const electron = new THREE.Mesh(electronGeometry, electronMaterial); electron.name = `electron-${i}`;
    electron.userData.topic = i; electron.userData.curve = curve; electron.userData.phase = [0.14, 0.53, 0.84][i];
    const count = lite ? 10 : 20, trailGeometry = new THREE.BufferGeometry();
    trailGeometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(count * 3), 3).setUsage(THREE.DynamicDrawUsage));
    const colors = new Float32Array(count * 3);
    for (let j = 0; j < count; j++) {
      const fade = (j / (count - 1)) ** 1.6;
      colors.set([fade * .65, fade * .69, fade * .75], j * 3);
    }
    trailGeometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    const trail = new THREE.Line(trailGeometry, trailMaterial); trail.name = "electron-trail"; trail.frustumCulled = false; trail.renderOrder = 1;
    electron.userData.trail = trail;
    geometries.push(trailGeometry); trails.push(trail);
    orbit.add(trail, electron); group.add(orbit); orbits.push(orbit); electrons.push(electron);
  }
  updateElectrons(electrons, 0);
  let disposed = false;
  return { group, nucleus, electrons, orbits, trails, dispose: () => {
    if (disposed) return;
    disposed = true;
    materials.forEach(material => material.dispose());
    geometries.forEach(geometry => geometry.dispose());
  } };
}

const electronPoint = new THREE.Vector3();
export function updateElectrons(electrons: THREE.Mesh[], elapsed: number) {
  electrons.forEach((electron, i) => {
    const curve = electron.userData.curve as ElectronOrbit | undefined;
    if (!curve) return;
    const t = ((elapsed * (0.034 + i * 0.004) + electron.userData.phase) % 1 + 1) % 1;
    electron.position.copy(curve.getPointAt(t, electronPoint));
    const trail = electron.userData.trail as THREE.Line | undefined;
    if (!trail) return;
    const positions = trail.geometry.getAttribute("position") as THREE.BufferAttribute;
    for (let j = 0; j < positions.count; j++) {
      const phase = (t - .045 * (1 - j / (positions.count - 1)) + 1) % 1;
      curve.getPointAt(phase, electronPoint); positions.setXYZ(j, electronPoint.x, electronPoint.y, electronPoint.z);
    }
    positions.needsUpdate = true;
  });
}
