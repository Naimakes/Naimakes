import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

export function createArchiveLighting(renderer: THREE.WebGLRenderer, scene: THREE.Scene) {
  renderer.toneMappingExposure = 1.03;
  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  scene.environment = pmrem.fromScene(room, 0.04).texture;
  room.dispose();
  pmrem.dispose();
  scene.environmentIntensity = 0.56;
  scene.add(
    new THREE.HemisphereLight("#fff7ee", "#a98e70", 0.62),
  );
  const key = new THREE.DirectionalLight("#fff0dc", 1.75);
  key.position.set(-6, 14, -5);
  const fill = new THREE.DirectionalLight("#ffffff", 0.6);
  fill.position.set(7, 8, -10);
  scene.add(key, fill);
  const glow = new THREE.DirectionalLight("#ffd7a6", 0.55);
  glow.position.set(10, 30, -22);
  scene.add(glow);
  return key;
}
