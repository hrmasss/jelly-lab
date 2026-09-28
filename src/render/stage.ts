import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

export const PAPER = '#efe9e1';

export interface Stage {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  resize(): void;
}

/** Renderer, camera, lights and a plate whose rim sits where the physics fence is. */
export function createStage(canvas: HTMLCanvasElement, fence: number, beforeControls: () => void): Stage {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(PAPER);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.6;

  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 60);
  camera.position.set(0, 3.3, 5.6);

  const key = new THREE.DirectionalLight('#fff4e6', 3.2);
  key.position.set(-2.5, 7, 2.5);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  const sc = key.shadow.camera;
  sc.left = -3.5; sc.right = 3.5; sc.top = 3.5; sc.bottom = -3.5; sc.near = 1; sc.far = 20;
  key.shadow.radius = 6;
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.02;
  scene.add(key);
  scene.add(new THREE.HemisphereLight('#ffffff', '#d9cbb8', 0.35));

  // Plate: flat well out to the fence, then a rim that curls up.
  // The skin reaches a little past the fence, so the flat part does too.
  const rimIn = fence + 0.3, rimOut = rimIn + 0.4;
  const profile: THREE.Vector2[] = [new THREE.Vector2(0, 0.0)];
  for (let i = 0; i <= 12; i++) {
    const t = i / 12;
    profile.push(new THREE.Vector2(rimIn + (rimOut - rimIn) * t, 0.16 * t * t));
  }
  profile.push(new THREE.Vector2(rimOut + 0.04, 0.17), new THREE.Vector2(rimOut + 0.02, 0.1), new THREE.Vector2(fence * 0.8, -0.06), new THREE.Vector2(0, -0.06));
  const plate = new THREE.Mesh(
    new THREE.LatheGeometry(profile, 128),
    new THREE.MeshPhysicalMaterial({ color: '#fbf8f3', roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.12, side: THREE.DoubleSide }),
  );
  plate.receiveShadow = true;
  scene.add(plate);
  const ground = new THREE.Mesh(new THREE.CircleGeometry(30, 64), new THREE.ShadowMaterial({ color: '#5a4630', opacity: 0.14 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.06;
  ground.receiveShadow = true;
  scene.add(ground);

  // Pointer handlers registered before the controls get first say on each press.
  beforeControls();
  const controls = new OrbitControls(camera, canvas);
  controls.target.set(0, 0.3, 0);
  controls.enableDamping = true;
  controls.enablePan = false;
  controls.minDistance = 2.4;
  controls.maxDistance = 12;
  controls.maxPolarAngle = 1.42;
  controls.update();

  const resize = () => {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // Keep the whole plate in view on tall phone screens.
    camera.fov = w / h < 0.8 ? 48 : 32;
    camera.updateProjectionMatrix();
  };
  resize();
  return { renderer, scene, camera, controls, resize };
}
