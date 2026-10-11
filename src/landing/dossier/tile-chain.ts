import * as THREE from "three";
import { createGL, studioEnvironment, type GLStage } from "./webgl-helpers";
import { createCassette, CASSETTE, type CassetteModel } from "./cassette-parts";
import { clamp, easeOutCubic } from "./cinema-helpers";

const TILE_WIDTH = 1.12;
const SCALE = TILE_WIDTH / CASSETTE.width;
const SPACING = 0.3;
const TWIST = 2.6;

type Tile = { u: number; matrix: THREE.Matrix4; depth: number };

export class TileChain {
  private gl: GLStage;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(26, 16 / 9, 0.1, 60);
  private curve: THREE.CatmullRomCurve3;
  private length = 1;
  private count = 0;
  private instances: THREE.InstancedMesh[] = [];
  private shared?: THREE.InstancedBufferAttribute;
  private model?: CassetteModel;
  private ready = false;
  private offset = 0;
  private last = 0;
  private reveal = 0;
  private revealTarget = 0;
  private disposed = false;
  private pointer = new THREE.Vector2();
  private pointerTarget = new THREE.Vector2();
  private onPointer = (event: PointerEvent) => {
    const rect = this.host.getBoundingClientRect();
    this.pointerTarget.set(((event.clientX - rect.left) / rect.width) * 2 - 1, ((event.clientY - rect.top) / rect.height) * 2 - 1);
  };

  constructor(private host: HTMLElement, number: number, background = "#ebe7e3") {
    this.gl = createGL(host);
    const { renderer } = this.gl;
    renderer.toneMapping = THREE.NeutralToneMapping;
    renderer.toneMappingExposure = 1.04;
    this.scene.background = new THREE.Color(background);
    this.scene.environment = studioEnvironment(renderer, 0.03);
    this.scene.environmentIntensity = 1.1;
    this.camera.position.set(0, 0, 13);
    this.camera.lookAt(0, 0, 0);
    this.curve = new THREE.CatmullRomCurve3(
      [
        new THREE.Vector3(-0.55, -3.7, 3.4),
        new THREE.Vector3(-1.25, -2.56, 2.5),
        new THREE.Vector3(-1.95, -1.75, 1.6),
        new THREE.Vector3(-2.76, -1.15, 0.8),
        new THREE.Vector3(-3.94, -0.56, 0),
        new THREE.Vector3(-5.12, -0.12, -0.8),
        new THREE.Vector3(-6.44, 0.25, -1.5),
        new THREE.Vector3(-8.1, 0.62, -2.2),
      ],
      false,
      "catmullrom",
      0.5,
    );
    this.length = this.curve.getLength();
    this.count = Math.ceil(this.length / SPACING) + 2;
    this.scene.add(new THREE.HemisphereLight("#ffffff", "#cfc4b8", 0.95));
    const key = new THREE.DirectionalLight("#fff4e6", 2.2);
    key.position.set(6, 7, 9);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight("#ffe6c4", 1.4);
    rim.position.set(-8, 3, -6);
    this.scene.add(rim);
    this.resize();
    window.addEventListener("pointermove", this.onPointer);
    void this.build(number);
  }

  private async build(number: number) {
    const model = await createCassette({ look: "lite", number });
    if (this.disposed) {
      model.dispose();
      return;
    }
    this.model = model;
    const matrix = new THREE.InstancedBufferAttribute(new Float32Array(this.count * 16), 16).setUsage(THREE.DynamicDrawUsage);
    this.shared = matrix;
    const order: Record<string, number> = { substrate: 1, "optical-core": 2, "optical-lenses": 3, carrier: 4, fasteners: 5, cover: 6 };
    model.group.updateMatrixWorld(true);
    model.group.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      const geometry = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
      const instanced = new THREE.InstancedMesh(geometry, mesh.material, this.count);
      instanced.instanceMatrix = matrix;
      instanced.frustumCulled = false;
      const surface = String(mesh.userData.surface ?? "");
      instanced.renderOrder = (order[String(mesh.userData.part)] ?? 6) + (surface === "Optical_Window" ? 0.5 : 0) + (mesh.name ? 0.8 : 0);
      this.scene.add(instanced);
      this.instances.push(instanced);
    });
    this.ready = true;
  }

  resize() {
    this.gl.resize();
    const width = Math.max(1, this.host.clientWidth);
    const height = Math.max(1, this.host.clientHeight);
    this.camera.aspect = width / height;
    this.camera.position.x = (16 / 9 - width / height) * 1.9;
    this.camera.updateProjectionMatrix();
  }

  show(visible: boolean) {
    this.revealTarget = visible ? 1 : 0;
  }

  private readonly tmp = {
    tangent: new THREE.Vector3(),
    toCamera: new THREE.Vector3(),
    face: new THREE.Vector3(),
    side: new THREE.Vector3(),
    up: new THREE.Vector3(),
    basis: new THREE.Matrix4(),
    quaternion: new THREE.Quaternion(),
    roll: new THREE.Quaternion(),
    scale: new THREE.Vector3(SCALE, SCALE, SCALE),
    world: new THREE.Vector3(0, 1, 0),
    view: new THREE.Vector3(),
  };

  render(time: number) {
    const dt = this.last ? Math.min(0.05, time - this.last) : 0;
    this.last = time;
    this.reveal += (this.revealTarget - this.reveal) * (1 - Math.exp(-dt * 2.4));
    this.pointer.lerp(this.pointerTarget, 0.06);
    this.camera.lookAt(this.camera.position.x + this.pointer.x * 0.12, -this.pointer.y * 0.08, 0);
    this.camera.updateMatrixWorld();
    if (!this.ready || !this.shared) {
      this.gl.renderer.render(this.scene, this.camera);
      return;
    }
    this.offset = (this.offset + dt * 0.14) % SPACING;
    const reveal = easeOutCubic(this.reveal);
    const t = this.tmp;
    const tiles: Tile[] = [];
    for (let index = 0; index < this.count; index++) {
      const distance = index * SPACING + this.offset - (1 - reveal) * this.length * 0.9;
      const u = distance / this.length;
      if (u < 0 || u > 1) continue;
      const point = this.curve.getPointAt(u);
      this.curve.getTangentAt(u, t.tangent);
      t.toCamera.copy(this.camera.position).sub(point).normalize();
      t.face.copy(t.toCamera).lerp(t.tangent.clone().multiplyScalar(-1), 0.34).normalize();
      t.side.crossVectors(t.world, t.face).normalize();
      t.up.crossVectors(t.face, t.side).normalize();
      t.basis.makeBasis(t.side, t.up, t.face);
      t.quaternion.setFromRotationMatrix(t.basis);
      const twist = -0.42 + u * TWIST + Math.sin(time * 0.75 - u * 6.5) * 0.2;
      t.roll.setFromAxisAngle(t.tangent, twist);
      t.quaternion.premultiply(t.roll);
      t.roll.setFromAxisAngle(t.up, -0.36 + Math.sin(time * 0.6 + u * 4) * 0.05);
      t.quaternion.multiply(t.roll);
      const fade = clamp(u * 10) * clamp((1 - u) * 6);
      const s = SCALE * (0.92 + 0.08 * fade);
      t.scale.set(s, s, s);
      const matrix = new THREE.Matrix4().compose(point, t.quaternion, t.scale);
      t.view.copy(point).applyMatrix4(this.camera.matrixWorldInverse);
      tiles.push({ u, matrix, depth: t.view.z });
    }
    tiles.sort((a, b) => a.depth - b.depth);
    const array = this.shared.array as Float32Array;
    tiles.forEach((tile, i) => tile.matrix.toArray(array, i * 16));
    this.shared.needsUpdate = true;
    for (const mesh of this.instances) mesh.count = tiles.length;
    this.gl.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.disposed = true;
    window.removeEventListener("pointermove", this.onPointer);
    for (const mesh of this.instances) {
      mesh.geometry.dispose();
      mesh.dispose();
    }
    this.model?.dispose();
    this.scene.environment?.dispose();
    this.gl.dispose();
  }
}
