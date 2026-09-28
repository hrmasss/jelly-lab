// Headless physics check: drop every shape, stack two cubes, pile six. Fails if anything breaks or tunnels.
import { SHAPES } from '../src/engine/shapes.ts';
import { topology } from '../src/engine/lattice.ts';
import { SoftBody } from '../src/engine/body.ts';
import { World } from '../src/engine/world.ts';
const byId = (id: string) => SHAPES.find(s => s.id === id)!;
const restH = (id: string) => { const t = topology(byId(id)); let m = 0; for (let i=1;i<t.rest.length;i+=3) m=Math.max(m,t.rest[i]); return m; };
function run(label: string, setup: (w: World) => void, frames = 240): World {
  const w = new World(); setup(w);
  let ms = 0, maxC = 0;
  for (let f = 0; f < frames; f++) { const t0 = performance.now(); w.step(1/60); ms += performance.now()-t0; maxC = Math.max(maxC, w.contacts); }
  if (w.bodies.some(b => b.isBroken())) process.exitCode = 1;
  const out = w.bodies.map(b => `${b.topo.shape.id}: y ${b.aabb[1].toFixed(3)}..${b.aabb[4].toFixed(3)} (rest h ${restH(b.topo.shape.id).toFixed(2)}) broken=${b.isBroken()}`);
  console.log(`[${label}] ${(ms/frames).toFixed(2)} ms/frame, peak contacts ${maxC}\n  ` + out.join('\n  '));
  return w;
}
for (const id of ['bear','pudding','cube','ring','star','mochi','heart']) {
  run(`drop ${id}`, w => w.bodies.push(new SoftBody(topology(byId(id)), byId(id).palettes[0], 0, 0.8, 0, 0.3)));
}
const stack = run('cube on cube', w => {
  const c = byId('cube'), t = topology(c);
  w.bodies.push(new SoftBody(t, c.palettes[0], 0, 0, 0, 0));
  w.bodies.push(new SoftBody(t, c.palettes[1], 0.1, 1.0, 0.05, 0.5));
});
if (stack.bodies[1].com[1] < 0.6) { console.error('top cube did not stay on top'); process.exitCode = 1; }
run('six mixed stack', w => {
  const ids = ['bear','pudding','cube','ring','mochi','heart'];
  ids.forEach((id, i) => w.bodies.push(new SoftBody(topology(byId(id)), byId(id).palettes[0], (i%2)*0.3-0.15, 0.2 + i*0.9, (i%3)*0.2-0.2, i)));
}, 360);
