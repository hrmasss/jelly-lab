import './style.css';
import * as THREE from 'three';
import { SHAPES, type ShapeDef } from './engine/shapes.ts';
import { type FromSim, type ShapeMesh, type ToSim } from './engine/protocol.ts';
import { JellyView } from './render/jellyView.ts';
import { createStage } from './render/stage.ts';

const MAX_JELLIES = 10;
const FENCE = 2.5;
const GRAVITY = 14;
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const canvas = $<HTMLCanvasElement>('stage');
const state = { paused: false, slow: false, mesh: false, tilt: false };

// ---------- simulation thread ----------

const worker = new Worker(new URL('./sim.worker.ts', import.meta.url), { type: 'module' });
const send = (m: ToSim) => worker.postMessage(m);
const meshes = new Map<string, ShapeMesh>();
/** Spawned but not drawn yet: waiting for the shape's mesh and the first frame that includes it. */
const pending = new Map<number, { shape: ShapeDef; palette: number }>();
const views = new Map<number, JellyView>();
/** Spawn order, oldest first, so the oldest jelly leaves when the plate is full. */
const order: number[] = [];
let nextId = 1;
let awaitingFrame = false;
let awaitingSince = 0;
let simMs = 0;
let contacts = 0;

worker.onmessage = (e: MessageEvent<FromSim>) => {
  const m = e.data;
  if (m.type === 'shape') meshes.set(m.mesh.shapeId, m.mesh);
  else if (m.type === 'removed') { removeLocal(m.id); toast('One jelly got too excited and was removed'); }
  else if (m.type === 'frame') {
    for (const f of m.bodies) {
      let v = views.get(f.id);
      if (!v) {
        const p = pending.get(f.id);
        const mesh = p && meshes.get(p.shape.id);
        if (!p || !mesh) continue;
        pending.delete(f.id);
        v = new JellyView({ id: f.id, shape: p.shape, mesh, palette: p.shape.palettes[p.palette], pos: f.pos, aabb: f.aabb });
        v.lattice.visible = state.mesh;
        scene.add(v.group);
        views.set(f.id, v);
        updateStatus();
      }
      v.body.pos = f.pos;
      v.body.aabb = f.aabb;
      v.dirty = true;
    }
    simMs += (m.ms - simMs) * 0.1;
    contacts = m.contacts;
    awaitingFrame = false;
  }
};
worker.onerror = (e) => { console.error(e); toast('The simulation stopped. Reload to start again.'); };

// ---------- stage ----------

let stage: ReturnType<typeof createStage>;
try {
  stage = createStage(canvas, FENCE, () => canvas.addEventListener('pointerdown', onPointerDown));
} catch (err) {
  const div = document.createElement('div');
  div.className = 'fallback';
  div.textContent = 'This browser could not start WebGL, so the jellies cannot be drawn here.';
  document.body.append(div);
  throw err;
}
const { renderer, scene, camera, controls } = stage;
send({ type: 'params', params: { fence: FENCE } });

// ---------- spawning ----------

function spawn(shape: ShapeDef, at?: { x: number; z: number }, variant?: number) {
  if (order.length >= MAX_JELLIES) remove(order[0]);
  const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * 1.3;
  const x = at?.x ?? Math.cos(a) * r, z = at?.z ?? Math.sin(a) * r;
  // Drop from just above whatever is already under that spot.
  let top = 0;
  for (const v of views.values()) {
    const bb = v.body.aabb;
    if (x > bb[0] - 0.6 && x < bb[3] + 0.6 && z > bb[2] - 0.6 && z < bb[5] + 0.6) top = Math.max(top, bb[4]);
  }
  const id = nextId++;
  const chosen = variant ?? flavour.get(shape.id) ?? -1;
  const palette = chosen >= 0 ? chosen : Math.floor(Math.random() * shape.palettes.length);
  warnIfBusy();
  const spin = (): number => (Math.random() - 0.5) * 2;
  send({ type: 'spawn', id, shapeId: shape.id, palette, x, y: top + 0.5 + Math.random() * 0.4, z, yaw: faceCamera(shape), spin: [spin(), spin(), spin()] });
  pending.set(id, { shape, palette });
  order.push(id);
  updateStatus();
}

/** A shape's front is +z; land it roughly facing wherever the camera is looking from. */
const faceCamera = (shape: ShapeDef) => controls.getAzimuthalAngle() + (shape.facing ?? 0) + (Math.random() - 0.5) * 1.2;

function removeLocal(id: number) {
  if (grabbedId === id) endGrab();
  const v = views.get(id);
  if (v) { scene.remove(v.group); v.dispose(); views.delete(id); }
  pending.delete(id);
  const i = order.indexOf(id);
  if (i >= 0) order.splice(i, 1);
  updateStatus();
}

function remove(id: number) {
  send({ type: 'remove', id });
  removeLocal(id);
}

function clear() {
  send({ type: 'clear' });
  for (const id of [...order]) removeLocal(id);
}

const nudge = () => send({ type: 'nudge' });

// ---------- grabbing ----------

let grabbedId = 0;
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const dragPlane = new THREE.Plane();
const hitPoint = new THREE.Vector3();

function setRay(e: PointerEvent) {
  const r = canvas.getBoundingClientRect();
  ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
}

function pick(e: PointerEvent) {
  setRay(e);
  const list = [...views.values()];
  for (const v of list) v.refreshBounds();
  return raycaster.intersectObjects(list.map((v) => v.mesh), false)[0];
}

function onPointerDown(e: PointerEvent) {
  if (e.button !== 0) return;
  const hit = pick(e);
  if (!hit) return;
  const view = hit.object.userData.view as JellyView;
  controls.enabled = false;
  grabbedId = view.body.id;
  canvas.setPointerCapture(e.pointerId);
  canvas.classList.add('grabbing');
  dragPlane.setFromNormalAndCoplanarPoint(camera.getWorldDirection(new THREE.Vector3()).negate(), hit.point);
  send({ type: 'grab', id: grabbedId, point: [hit.point.x, hit.point.y, hit.point.z] });
  hideHint();
}

function onPointerMove(e: PointerEvent) {
  if (grabbedId) {
    setRay(e);
    if (raycaster.ray.intersectPlane(dragPlane, hitPoint)) send({ type: 'drag', target: [hitPoint.x, Math.max(hitPoint.y, 0.02), hitPoint.z] });
    return;
  }
  if (e.pointerType === 'mouse' && e.buttons === 0) canvas.classList.toggle('can-grab', !!pick(e));
}

function endGrab() {
  if (grabbedId) send({ type: 'release' });
  grabbedId = 0;
  controls.enabled = true;
  canvas.classList.remove('grabbing');
}

canvas.addEventListener('pointermove', onPointerMove);
canvas.addEventListener('pointerup', endGrab);
canvas.addEventListener('pointercancel', endGrab);
controls.addEventListener('start', hideHint);

// ---------- phone tilt ----------

let tiltBase: { beta: number; gamma: number } | null = null;
function onOrientation(e: DeviceOrientationEvent) {
  if (e.beta == null || e.gamma == null) return;
  if (!tiltBase) tiltBase = { beta: e.beta, gamma: e.gamma };
  const clampA = (a: number) => (Math.max(-50, Math.min(50, a)) * Math.PI) / 180;
  const sx = Math.sin(clampA(e.gamma - tiltBase.gamma)) * GRAVITY;
  const sz = Math.sin(clampA(e.beta - tiltBase.beta)) * GRAVITY;
  // Screen right and screen down, turned to match where the camera is looking from.
  const yaw = controls.getAzimuthalAngle();
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const gy = -Math.sqrt(Math.max(GRAVITY * GRAVITY - sx * sx - sz * sz, GRAVITY * GRAVITY * 0.3));
  send({ type: 'params', params: { gravity: [c * sx + s * sz, gy, -s * sx + c * sz] } });
}

async function toggleTilt() {
  const btn = $<HTMLButtonElement>('tilt');
  if (state.tilt) {
    state.tilt = false;
    window.removeEventListener('deviceorientation', onOrientation);
    send({ type: 'params', params: { gravity: [0, -GRAVITY, 0] } });
    btn.setAttribute('aria-pressed', 'false');
    return;
  }
  const DOE = DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> };
  if (DOE.requestPermission) {
    try {
      if ((await DOE.requestPermission()) !== 'granted') { toast('Motion access was declined'); return; }
    } catch { toast('Motion access is not available'); return; }
  }
  state.tilt = true;
  tiltBase = null;
  window.addEventListener('deviceorientation', onOrientation);
  btn.setAttribute('aria-pressed', 'true');
  toast('Tilt your phone to slide them around');
}

// ---------- UI ----------

const shelf = $('shelf');
const variants = $('variants');
/** Chosen flavour per shape: a palette index, or -1 for a random one each drop. */
const flavour = new Map<string, number>();
let selected = SHAPES[0];

const swatch = (p: ShapeDef['palettes'][number]) => {
  const extra = Object.values(p.colors ?? {}).slice(0, 2);
  return extra.length ? `linear-gradient(135deg, ${p.color} 0 55%, ${extra.join(', ')})` : p.color;
};

function showVariants(shape: ShapeDef) {
  variants.replaceChildren();
  const label = document.createElement('span');
  label.className = 'label';
  label.textContent = shape.name;
  variants.append(label);
  const current = flavour.get(shape.id) ?? -1;
  const chip = (name: string, bg: string, index: number) => {
    const c = document.createElement('button');
    c.type = 'button';
    c.className = 'chip';
    c.setAttribute('aria-pressed', String(index === current));
    c.title = `Drop a ${name.toLowerCase()} ${shape.name.toLowerCase()}`;
    const dot = document.createElement('span');
    dot.className = 'dot';
    dot.style.background = bg;
    c.append(dot, name);
    c.addEventListener('click', () => { flavour.set(shape.id, index); spawn(shape, undefined, index); showVariants(shape); hideHint(); });
    variants.append(c);
  };
  shape.palettes.forEach((p, i) => chip(p.name, swatch(p), i));
  chip('Mix', `conic-gradient(${shape.palettes.map((p) => p.color).join(', ')}, ${shape.palettes[0].color})`, -1);
}

SHAPES.forEach((shape, i) => {
  const b = document.createElement('button');
  b.className = 'shape';
  b.type = 'button';
  b.title = `${shape.name} (${(i + 1) % 10})`;
  const blob = document.createElement('span');
  blob.className = 'blob';
  blob.style.background = swatch(shape.palettes[0]);
  const name = document.createElement('span');
  const short = shape.name.replace('Gummy ', '').replace('Jelly ', '');
  name.textContent = short[0].toUpperCase() + short.slice(1);
  b.append(blob, name);
  b.addEventListener('click', () => {
    selected = shape;
    for (const el of shelf.children) el.classList.toggle('selected', el === b);
    spawn(shape);
    showVariants(shape);
    hideHint();
  });
  shelf.append(b);
});
shelf.children[0]?.classList.add('selected');
showVariants(selected);

let warned = false;
function warnIfBusy() {
  if (warned || views.size < 2 || simMs < 12) return;
  warned = true;
  toast('Getting crowded. Each extra jelly slows this device down.');
}

const firm = $<HTMLInputElement>('firm'), damp = $<HTMLInputElement>('damp');
const firmLabel = (f: number) => (f < 0.2 ? 'custard' : f < 0.45 ? 'jelly' : f < 0.75 ? 'gummy' : 'rubber');
const dampLabel = (d: number) => (d < 0.2 ? 'wobbly' : d < 0.65 ? 'springy' : 'calm');
const syncSliders = () => {
  const firmness = Number(firm.value) / 100, damping = Number(damp.value) / 100;
  send({ type: 'params', params: { firmness, damping } });
  $('firmOut').textContent = firmLabel(firmness);
  $('dampOut').textContent = dampLabel(damping);
};
firm.addEventListener('input', syncSliders);
damp.addEventListener('input', syncSliders);
syncSliders();

const toggle = (id: string, key: 'paused' | 'slow' | 'mesh', after?: () => void) => {
  const btn = $<HTMLButtonElement>(id);
  const flip = () => {
    state[key] = !state[key];
    btn.setAttribute('aria-pressed', String(state[key]));
    after?.();
  };
  btn.addEventListener('click', flip);
  return flip;
};
const togglePause = toggle('pause', 'paused');
const toggleSlow = toggle('slow', 'slow');
const toggleMesh = toggle('mesh', 'mesh', () => { for (const v of views.values()) { v.lattice.visible = state.mesh; v.dirty = true; } });
$('nudge').addEventListener('click', nudge);
$('clear').addEventListener('click', clear);
const tiltBtn = $<HTMLButtonElement>('tilt');
if ('DeviceOrientationEvent' in window && matchMedia('(pointer: coarse)').matches) tiltBtn.hidden = false;
tiltBtn.addEventListener('click', toggleTilt);

const panel = $('panel');
$('panelToggle').addEventListener('click', () => {
  const collapsed = panel.classList.toggle('collapsed');
  $('panelToggle').setAttribute('aria-expanded', String(!collapsed));
});
if (matchMedia('(max-width: 720px)').matches) {
  panel.classList.add('collapsed');
  $('panelToggle').setAttribute('aria-expanded', 'false');
}

window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement || e.metaKey || e.ctrlKey || e.altKey) return;
  const k = e.key.toLowerCase();
  if (k === 'n') nudge();
  else if (k === 'c') clear();
  else if (k === ' ') { e.preventDefault(); togglePause(); }
  else if (k === 's') toggleSlow();
  else if (k === 'm') toggleMesh();
  else if (/^[0-9]$/.test(k) && SHAPES[(Number(k) + 9) % 10]) spawn(SHAPES[(Number(k) + 9) % 10]);
});

let hintGone = false;
function hideHint() {
  if (hintGone) return;
  hintGone = true;
  $('hint').classList.add('gone');
}

let toastTimer = 0;
function toast(msg: string) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => t.classList.remove('show'), 2200);
}

let fps = 60;
function updateStatus() {
  const n = views.size;
  // First drop of a shape builds its lattice in the worker, up to a couple of seconds for the octopus.
  const coming = pending.size ? ` · ${pending.size} on the way` : '';
  $('statusText').textContent = `${n} ${n === 1 ? 'jelly' : 'jellies'}${coming} · ${Math.round(fps)} fps`;
}

window.addEventListener('resize', stage.resize);

// ---------- loop ----------

let last = performance.now();
let statusClock = 0;
function frame(now: number) {
  const dt = Math.min((now - last) / 1000, 1 / 30);
  last = now;
  fps += (1 / Math.max(dt, 1e-3) - fps) * 0.05;
  if (awaitingFrame && now - awaitingSince > 2000) awaitingFrame = false;
  if (!awaitingFrame) {
    // Hold the substep near 1/480 s whatever the refresh rate, so stiffness feels the same everywhere.
    // Capped: an overloaded frame runs the world in slow motion rather than asking for even more work.
    const substeps = Math.max(1, Math.min(8, Math.round(dt * 480)));
    const simDt = state.paused ? 0 : (substeps / 480) * (state.slow ? 0.25 : 1);
    send({ type: 'step', dt: simDt, substeps });
    awaitingFrame = true;
    awaitingSince = now;
  }
  for (const v of views.values()) if (v.dirty) { v.update(); v.dirty = false; }
  controls.update();
  renderer.render(scene, camera);
  statusClock += dt;
  if (statusClock > 0.5) { statusClock = 0; updateStatus(); }
  requestAnimationFrame(frame);
}

// One jelly to start. More are one tap away, and each one costs the device real work.
spawn(SHAPES[0], { x: 0, z: 0 });
$('status').classList.add('live');
if (import.meta.env.DEV) {
  Object.assign(window, { jelly: { views, spawn, send, SHAPES, camera, canvas, stats: () => ({ simMs, contacts, fps }) } });
}
requestAnimationFrame(frame);
