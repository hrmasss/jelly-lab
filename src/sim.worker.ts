/// <reference lib="webworker" />
import { SHAPES } from './engine/shapes.ts';
import { topology } from './engine/lattice.ts';
import { SoftBody } from './engine/body.ts';
import { World } from './engine/world.ts';
import { type FromSim, type ShapeMesh, type ToSim } from './engine/protocol.ts';

// Owns the world. The page sends commands and one 'step' per frame; each step answers with node positions.
const world = new World();
const bodies = new Map<number, SoftBody>();
const sent = new Set<string>();
const post = (m: FromSim, transfer: Transferable[] = []) => (self as DedicatedWorkerGlobalScope).postMessage(m, transfer);

function removeBody(id: number) {
  const b = bodies.get(id);
  if (!b) return;
  if (world.grab?.body === b) world.grab = null;
  world.bodies.splice(world.bodies.indexOf(b), 1);
  bodies.delete(id);
}

self.onmessage = (e: MessageEvent<ToSim>) => {
  const m = e.data;
  switch (m.type) {
    case 'spawn': {
      const shape = SHAPES.find((s) => s.id === m.shapeId);
      if (!shape) return;
      const topo = topology(shape);
      if (!sent.has(shape.id)) {
        sent.add(shape.id);
        const mesh: ShapeMesh = {
          shapeId: shape.id, n: topo.n, cell: shape.cell, tets: topo.tets, edges: topo.edges,
          skin: topo.skin, inclusions: topo.inclusions,
        };
        post({ type: 'shape', mesh });
      }
      const b = new SoftBody(topo, shape.palettes[m.palette], m.x, m.y, m.z, m.yaw);
      b.kick(0, -1, 0, ...m.spin);
      world.bodies.push(b);
      bodies.set(m.id, b);
      break;
    }
    case 'remove': removeBody(m.id); break;
    case 'clear': for (const id of [...bodies.keys()]) removeBody(id); break;
    case 'params': Object.assign(world.params, m.params); break;
    case 'grab': {
      const b = bodies.get(m.id);
      if (b) world.startGrab(b, ...m.point);
      break;
    }
    case 'drag': if (world.grab) world.grab.target = m.target; break;
    case 'release': world.grab = null; break;
    case 'nudge':
      for (const b of world.bodies) {
        b.updateFrame();
        b.kick((Math.random() - 0.5) * 1.5, 3 + Math.random() * 2.5, (Math.random() - 0.5) * 1.5,
          (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 3, (Math.random() - 0.5) * 6);
      }
      break;
    case 'step': {
      const t0 = performance.now();
      world.params.substeps = m.substeps;
      if (world.bodies.length && m.dt > 0) world.step(m.dt);
      const frames = [];
      const transfer: Transferable[] = [];
      for (const [id, b] of bodies) {
        if (b.isBroken()) { removeBody(id); post({ type: 'removed', id, reason: 'broken' }); continue; }
        const pos = new Float32Array(b.pos);
        const aabb = new Float32Array(b.aabb);
        frames.push({ id, pos, aabb });
        transfer.push(pos.buffer, aabb.buffer);
      }
      post({ type: 'frame', bodies: frames, contacts: world.contacts, ms: performance.now() - t0 }, transfer);
      break;
    }
  }
};
