// The jellies from the first soft body pages: gummy bear No. 024, pineapple ring, octopus.
// Each is written in its original units, then scaled to sit beside the other shapes.
import { type SDF, extrude, sdEllipsoid, sdfGrad, smax, smin } from './sdf.ts';
import type { Inclusion, Paint, Palette, ShapeDef } from './shapes.ts';
import { type PartMesh, type RGB, ellipsoidMesh, fbm, lin, merge, mix, rng, smoothstep, vnoise } from './parts.ts';

const col = (p: Palette, key: string) => lin(p.colors?.[key] ?? p.color);
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
// Math.hypot is several times slower than a plain square root in V8, and these run millions of times.
const hyp2 = (a: number, b: number) => Math.sqrt(a * a + b * b);
const hyp3 = (a: number, b: number, c: number) => Math.sqrt(a * a + b * b + c * c);
const norm = (v: RGB): RGB => { const l = hyp3(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
const cross = (a: RGB, b: RGB): RGB => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** Scale a shape authored in other units: geometry, paint and inclusions together. */
function scaled(s: number, o: { sdf: SDF; min: number[]; max: number[]; paint?: Paint; inclusions?: () => Inclusion[] }) {
  const paint = o.paint, inclusions = o.inclusions;
  return {
    sdf: ((x, y, z) => o.sdf(x / s, y / s, z / s) * s) as SDF,
    min: o.min.map((v) => v * s) as [number, number, number],
    max: o.max.map((v) => v * s) as [number, number, number],
    paint: paint && ({
      channels: paint.channels,
      blend: paint.blend,
      masks: (x, y, z, grad) => paint.masks(x / s, y / s, z / s, (X, Y, Z, out) => grad(X * s, Y * s, Z * s, out)),
    } as Paint),
    inclusions: inclusions && (() => inclusions().map((inc) => ({ ...inc, positions: inc.positions.map((v) => v * s) }))),
  };
}

// ---------- gummy bear No. 024 ----------

/** Capsule from a to b whose radius goes from ra to rb. */
function sdCone(px: number, py: number, pz: number, ax: number, ay: number, az: number, bx: number, by: number, bz: number, ra: number, rb: number) {
  const bax = bx - ax, bay = by - ay, baz = bz - az;
  const pax = px - ax, pay = py - ay, paz = pz - az;
  const t = clamp01((pax * bax + pay * bay + paz * baz) / (bax * bax + bay * bay + baz * baz));
  return hyp3(pax - bax * t, pay - bay * t, paz - baz * t) - (ra + (rb - ra) * t);
}

/** Bear standing in its own frame: x right, y head up, z face forward. */
function bearLocal(x: number, y: number, z: number) {
  const ax = Math.abs(x);
  let d = sdEllipsoid(x, y + 0.18, z, 0.6, 0.7, z > 0 ? 0.45 : 0.37);
  d = smin(d, sdEllipsoid(x, y + 0.3, z - 0.14, 0.43, 0.45, 0.34), 0.15);
  d = smin(d, sdEllipsoid(ax - 0.33, y + 0.92, z - 0.08, 0.275, 0.255, 0.315), 0.15);
  d = smin(d, sdCone(ax, y, z, 0.43, 0.15, 0.02, 0.7, -0.22, 0.2, 0.195, 0.185), 0.13);
  let hd = sdEllipsoid(x, y - 0.74, z - 0.02, 0.56, 0.47, z > 0.02 ? 0.42 : 0.35);
  hd = smin(hd, sdEllipsoid(ax - 0.405, y - 1.125, z + 0.01, 0.175, 0.16, 0.12), 0.08);
  hd = smin(hd, sdEllipsoid(x, y - 0.585, z - 0.32, 0.255, 0.185, 0.165), 0.09);
  d = smin(d, hd, 0.17);
  if (y > 0.35 && z > 0.2) {
    d = smin(d, sdEllipsoid(x, y - 0.672, z - 0.482, 0.098, 0.066, 0.058), 0.035);
    d = smin(d, sdEllipsoid(ax - 0.19, y - 0.835, z - 0.392, 0.07, 0.08, 0.05), 0.026);
    if (y < 0.64 && y > 0.44 && ax < 0.16) {
      // Smile: an arc carved into the muzzle.
      const cx = ax, cy = y - 0.625, R = 0.105, ang = Math.atan2(cy, cx);
      let d2: number;
      if (cy < 0 && ang > -2.53 && ang < -0.61) d2 = Math.abs(hyp2(cx, cy) - R);
      else d2 = hyp2(cx - R * Math.cos(-0.61), cy - R * Math.sin(-0.61));
      const dz = Math.max(0, 0.445 - z);
      d = smax(d, -(Math.sqrt(d2 * d2 + dz * dz) - 0.02), 0.014);
    }
  }
  if (y < -1.0) d = smin(d, sdEllipsoid(ax - 0.33, y + 1.168, z - 0.1, 0.135, 0.03, 0.14), 0.03);
  return d;
}

/** Lying on its back, face up, head toward -z. */
const bearSdf: SDF = (x, y, z) => bearLocal(x, -z, y - 0.3719);

function bearBubbles(): Inclusion[] {
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const spots: RGB[] = [[-0.18, 0.35, 0.05], [0.22, 0.42, 0.25], [0.05, 0.3, -0.35], [-0.3, 0.3, -0.55], [0.33, 0.36, -0.15],
    [-0.08, 0.52, 0.55], [0.15, 0.28, 0.7], [-0.42, 0.33, 0.2], [0.5, 0.3, 0.12], [0.02, 0.25, -0.8], [-0.25, 0.45, 0.72]];
  const parts: PartMesh[] = [];
  for (const [sx, sy, sz] of spots) {
    const x = sx + (rnd() - 0.5) * 0.06, z = sz + (rnd() - 0.5) * 0.06;
    if (bearSdf(x, sy, z) > -0.09) continue;
    const r = 0.012 + rnd() * 0.022;
    parts.push(ellipsoidMesh([x, sy, z], [1, 0, 0], [0, 1, 0], r, r, r, 0, 6));
    if (parts.length >= 9) break;
  }
  return [{ ...merge(parts), color: '#fffaf0', roughness: 0.05 }];
}

export const bear024: ShapeDef = {
  id: 'bear', name: 'Gummy bear',
  // Head away and to the left, so it reads as a bear rather than a pair of feet.
  facing: 0.9,
  ...scaled(0.55, { sdf: bearSdf, min: [-0.9, 0, -1.3], max: [0.9, 0.92, 1.22], inclusions: bearBubbles }),
  cell: 0.1, skin: 0.011,
  palettes: [
    { name: 'Honey', color: '#ffc760', deep: '#e0800a', clarity: 0.8, roughness: 0.22 },
    { name: 'Cherry', color: '#ff6b78', deep: '#c0142c', clarity: 0.8, roughness: 0.22 },
    { name: 'Emerald', color: '#7fe8aa', deep: '#16965a', clarity: 0.82, roughness: 0.22 },
    { name: 'Grape', color: '#c9a0ff', deep: '#6a2bd0', clarity: 0.8, roughness: 0.22 },
    { name: 'Lemon', color: '#fff08a', deep: '#e0b400', clarity: 0.82, roughness: 0.22 },
  ],
};

// ---------- pineapple ring ----------

const RING = { Ro: 1.36, Ri: 0.5, T: 0.5, bevel: 0.12, lobes: 14, lobeAmp: 0.016 };

const pineSdf: SDF = (x, y, z) => {
  const r = hyp2(x, z), th = Math.atan2(z, x);
  const d2 = Math.max(r - RING.Ro * (1 + RING.lobeAmp * Math.cos(RING.lobes * th)), RING.Ri - r);
  return extrude(d2, y - RING.T / 2, RING.T / 2, RING.bevel);
};

/** Pale woody core, fibrous flesh, a band of "eyes" near the rim. Same noise recipe as the original shader. */
const pinePaint: Paint = {
  channels: 3,
  masks: (x, y, z) => {
  const r = hyp2(x, z), th = Math.atan2(z, x);
  const yc = Math.abs(y - RING.T / 2);
  const span = clamp01((r - RING.Ri) / (RING.Ro - RING.Ri));
  const wob = fbm(x * 4, z * 4, yc * 4) - 0.5;
  const coreW = 1 - smoothstep(0.08, 0.22, span + wob * 0.06);
  const rimW = smoothstep(0.86, 0.98, span + wob * 0.04);
  const fa = vnoise(th * 58, span * 2.2, yc * 9), fb = vnoise(th * 131 + 7, span * 4, yc * 17);
  const fibers = smoothstep(0.55, 0.85, fa) * 0.7 + smoothstep(0.62, 0.9, fb) * 0.45;
  const eyeBand = smoothstep(0.62, 0.78, span) * (1 - smoothstep(0.9, 0.97, span));
  const eyes = smoothstep(0.58, 0.8, vnoise(th * 22, span * 6, yc * 5)) * eyeBand;
  return [clamp01(fibers * 0.9 + eyes * 0.4), rimW * 0.35 + eyes * 0.15, clamp01(coreW * 0.85 + fibers * 0.12)];
  },
  blend: (m, p) => {
    const flesh = lin(p.color), pale = col(p, 'pale');
    return mix(mix(mix(flesh, mix(flesh, pale, 0.45), m[0]), lin(p.deep), m[1]), pale, m[2]);
  },
};

/** Juice cells pointing outward through the flesh, and a few trapped bubbles. */
function pineInclusions(): Inclusion[] {
  const R = rng(23);
  const cells: PartMesh[] = [], bubbles: PartMesh[] = [];
  for (let i = 0; i < 130; i++) {
    const th = R() * Math.PI * 2, r = RING.Ri + 0.16 + R() * (RING.Ro - RING.Ri - 0.3), y = 0.06 + R() * (RING.T - 0.12);
    const len = 0.07 + R() * 0.08, wid = 0.012 + R() * 0.01, hgt = 0.01 + R() * 0.008;
    const ta = th + (R() - 0.5) * 0.25;
    const a: RGB = [Math.cos(ta), 0, Math.sin(ta)], b: RGB = [-Math.sin(ta), 0, Math.cos(ta)];
    cells.push(ellipsoidMesh([Math.cos(th) * r, y, Math.sin(th) * r], a, b, len / 2, wid / 2, hgt / 2, 0.2, 5));
  }
  for (let i = 0; i < 16; i++) {
    const th = R() * Math.PI * 2, r = RING.Ri + 0.15 + R() * (RING.Ro - RING.Ri - 0.3);
    const rad = 0.008 + R() * R() * 0.02;
    const y = 0.05 + rad + R() * (RING.T - 0.1 - 2 * rad);
    bubbles.push(ellipsoidMesh([Math.cos(th) * r, y, Math.sin(th) * r], [1, 0, 0], [0, 1, 0], rad, rad, rad, 0, 6));
  }
  return [{ ...merge(cells), color: 'juice', roughness: 0.35 }, { ...merge(bubbles), color: '#fff8ec', roughness: 0.05 }];
}

export const pineapple: ShapeDef = {
  id: 'pineapple', name: 'Pineapple',
  ...scaled(0.52, { sdf: pineSdf, min: [-1.39, 0, -1.39], max: [1.39, 0.5, 1.39], paint: pinePaint, inclusions: pineInclusions }),
  cell: 0.1, skin: 0.013,
  palettes: [
    { name: 'Golden', color: '#fde269', deep: '#f3bc30', clarity: 0.78, roughness: 0.18, colors: { pale: '#fef6cb', juice: '#feeea8' } },
    { name: 'Amber', color: '#fabf4b', deep: '#dd8b21', clarity: 0.75, roughness: 0.18, colors: { pale: '#fde7b5', juice: '#fcdc8e' } },
    { name: 'Rosé', color: '#fcc5b5', deep: '#ec958b', clarity: 0.75, roughness: 0.2, colors: { pale: '#fef1e7', juice: '#fde0d5' } },
  ],
};

// ---------- octopus ----------

const OCTO = {
  head: { c: [0, 1.0, -0.06] as RGB, r: [0.74, 0.8, 0.7] as RGB },
  skirt: { c: [0, 0.34, 0] as RGB, r: [0.64, 0.31, 0.64] as RGB },
  kBody: 0.34, arms: 8, L: 1.95, sGround: 1.02, rBase: 0.215, rTip: 0.047, kArm: 0.13, kArmArm: 0.07,
};

const armRadius = (s: number) => OCTO.rTip + (OCTO.rBase - OCTO.rTip) * Math.pow(Math.max(0, 1 - s / OCTO.L), 1.25);

const sdBody = (x: number, y: number, z: number) => {
  const { head: h, skirt: k } = OCTO;
  return smin(
    sdEllipsoid(x - h.c[0], y - h.c[1], z - h.c[2], h.r[0], h.r[1], h.r[2]),
    sdEllipsoid(x - k.c[0], y - k.c[1], z - k.c[2], k.r[0], k.r[1], k.r[2]),
    OCTO.kBody,
  );
};

interface Arm {
  /** Centreline, 3 per point. */
  pts: Float64Array;
  s: Float64Array;
  /** Underside direction per point. */
  ven: Float64Array;
  /** Every 3rd point plus the last, for distance queries: x, y, z, radius. */
  coarse: Float64Array;
  box: Box;
  /** Runs of CHUNK coarse segments with their own bounds, so distance queries can skip most of an arm. */
  chunks: { from: number; to: number; box: Box }[];
}

type Box = [number, number, number, number, number, number];
const CHUNK = 6;

/** Eight arms: a run along the table that sweeps sideways, then a tightening curl. Seeded, so they match the original. */
function buildArms(): Arm[] {
  const R = rng(7);
  const sm = smoothstep;
  const arms: Arm[] = [];
  for (let i = 0; i < OCTO.arms; i++) {
    const sg = i % 2 ? 1 : -1;
    const th0 = (2 * Math.PI * (i + 0.5)) / OCTO.arms + (R() - 0.5) * 0.08;
    const sweep = sg * (0.2 + R() * 0.16);
    const tilt = sg * (1.02 + R() * 0.16);
    const turns = 0.95 + R() * 0.12;
    const Lc = OCTO.L - OCTO.sGround;
    const K = (turns * 2 * Math.PI * 2.4) / Lc;
    const ds = 0.012, N = Math.round(OCTO.L / ds);
    const y0 = 0.36;
    let px = 0.24 * Math.cos(th0), pz = 0.24 * Math.sin(th0), heading = th0;
    const pts: number[] = [], sv: number[] = [], ven: number[] = [];
    let q: RGB | null = null, Rh: RGB = [1, 0, 0], U: RGB = [0, 1, 0];
    for (let k = 0; k <= N; k++) {
      const s = k * ds;
      if (s <= OCTO.sGround) {
        const drop = 1 - sm(0, 0.62, s);
        pts.push(px, armRadius(s) + (y0 - armRadius(0)) * drop * drop, pz);
        ven.push(0, -1, 0);
        heading += sweep * ds * sm(0.15, 0.6, s);
        px += Math.cos(heading) * ds; pz += Math.sin(heading) * ds;
      } else {
        if (!q) {
          const n = pts.length;
          q = [pts[n - 3], pts[n - 2], pts[n - 1]];
          Rh = [Math.cos(heading), 0, Math.sin(heading)];
          const side: RGB = [Rh[2], 0, -Rh[0]];
          U = norm([side[0] * Math.sin(tilt), Math.cos(tilt), side[2] * Math.sin(tilt)]);
        }
        const sig = (s - OCTO.sGround) / Lc;
        const a = (K * Lc * Math.pow(sig, 2.4)) / 2.4;
        for (let c = 0; c < 3; c++) q[c] += (Math.cos(a) * Rh[c] + Math.sin(a) * U[c]) * ds;
        pts.push(q[0], q[1], q[2]);
        const b = sm(OCTO.sGround, OCTO.sGround + 0.12, s);
        const vc: RGB = [Math.sin(a) * Rh[0] - Math.cos(a) * U[0], Math.sin(a) * Rh[1] - Math.cos(a) * U[1], Math.sin(a) * Rh[2] - Math.cos(a) * U[2]];
        const v = norm([vc[0] * b, -1 * (1 - b) + vc[1] * b, vc[2] * b]);
        ven.push(v[0], v[1], v[2]);
      }
      sv.push(s);
    }
    // Keep the underside direction square to the centreline.
    const np = sv.length;
    for (let k = 0; k < np; k++) {
      const a = Math.max(0, k - 1), b = Math.min(np - 1, k + 1);
      const t = norm([pts[b * 3] - pts[a * 3], pts[b * 3 + 1] - pts[a * 3 + 1], pts[b * 3 + 2] - pts[a * 3 + 2]]);
      const d = ven[k * 3] * t[0] + ven[k * 3 + 1] * t[1] + ven[k * 3 + 2] * t[2];
      const v = norm([ven[k * 3] - d * t[0], ven[k * 3 + 1] - d * t[1], ven[k * 3 + 2] - d * t[2]]);
      ven[k * 3] = v[0]; ven[k * 3 + 1] = v[1]; ven[k * 3 + 2] = v[2];
    }
    const coarse: number[] = [];
    const box: Box = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
    for (let k = 0; k < np; k += 3) coarse.push(pts[k * 3], pts[k * 3 + 1], pts[k * 3 + 2], armRadius(sv[k]));
    if ((np - 1) % 3) coarse.push(pts[(np - 1) * 3], pts[(np - 1) * 3 + 1], pts[(np - 1) * 3 + 2], armRadius(sv[np - 1]));
    for (let k = 0; k < coarse.length; k += 4)
      for (let c = 0; c < 3; c++) {
        box[c] = Math.min(box[c], coarse[k + c] - OCTO.rBase);
        box[c + 3] = Math.max(box[c + 3], coarse[k + c] + OCTO.rBase);
      }
    const chunks: Arm['chunks'] = [];
    const segs = coarse.length / 4 - 1;
    for (let from = 0; from < segs; from += CHUNK) {
      const to = Math.min(segs, from + CHUNK);
      const cb: Box = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
      for (let k = from; k <= to; k++)
        for (let c = 0; c < 3; c++) {
          const r = coarse[k * 4 + 3];
          cb[c] = Math.min(cb[c], coarse[k * 4 + c] - r);
          cb[c + 3] = Math.max(cb[c + 3], coarse[k * 4 + c] + r);
        }
      chunks.push({ from, to, box: cb });
    }
    arms.push({ pts: new Float64Array(pts), s: new Float64Array(sv), ven: new Float64Array(ven), coarse: new Float64Array(coarse), box, chunks });
  }
  return arms;
}

let armCache: Arm[] | null = null;
const getArms = () => (armCache ??= buildArms());

/**
 * Distance to one arm: a chain of capsules whose radius tapers along it. Also reports the nearest coarse point.
 * Anything farther than `limit` may come back as `limit`; callers pass the distance beyond which it cannot matter.
 */
function armDist(arm: Arm, x: number, y: number, z: number, out?: { k: number }, limit = Infinity) {
  const c = arm.coarse;
  let best = limit, bestK = 0;
  // Nearest sections first, so the cutoff tightens early and far sections are skipped.
  const nc = arm.chunks.length;
  for (let q = 0; q < nc; q++) { chunkOrder[q] = q; chunkDist[q] = boxDist(arm.chunks[q].box, x, y, z); }
  sortBy(chunkOrder, chunkDist, nc);
  for (let q = 0; q < nc; q++) {
    const ch = arm.chunks[chunkOrder[q]];
    if (chunkDist[chunkOrder[q]] >= best) break;
  for (let k = ch.from * 4; k < ch.to * 4; k += 4) {
    const ax = c[k], ay = c[k + 1], az = c[k + 2], bx = c[k + 4], by = c[k + 5], bz = c[k + 6];
    const bax = bx - ax, bay = by - ay, baz = bz - az;
    const t = clamp01(((x - ax) * bax + (y - ay) * bay + (z - az) * baz) / (bax * bax + bay * bay + baz * baz));
    const d = hyp3(x - ax - bax * t, y - ay - bay * t, z - az - baz * t) - (c[k + 3] + (c[k + 7] - c[k + 3]) * t);
    if (d < best) { best = d; bestK = t < 0.5 ? k / 4 : k / 4 + 1; }
  }
  }
  if (out) out.k = Math.min(bestK * 3, arm.s.length - 1);
  return best;
}

const chunkOrder = new Int32Array(64), chunkDist = new Float64Array(64);
const armOrder = new Int32Array(16), armDistBox = new Float64Array(16);

/** Insertion sort of the first n indices by key; n is at most a few dozen. */
function sortBy(idx: Int32Array, key: Float64Array, n: number) {
  for (let i = 1; i < n; i++) {
    const v = idx[i], kv = key[v];
    let j = i - 1;
    while (j >= 0 && key[idx[j]] > kv) { idx[j + 1] = idx[j]; j--; }
    idx[j + 1] = v;
  }
}

const boxDist = (b: Box, x: number, y: number, z: number) =>
  hyp3(Math.max(b[0] - x, 0, x - b[3]), Math.max(b[1] - y, 0, y - b[4]), Math.max(b[2] - z, 0, z - b[5]));

const octoSdf: SDF = (x, y, z) => {
  const body = sdBody(x, y, z);
  let A = 1e3;
  const arms = getArms();
  for (let i = 0; i < arms.length; i++) { armOrder[i] = i; armDistBox[i] = boxDist(arms[i].box, x, y, z); }
  sortBy(armOrder, armDistBox, arms.length);
  for (let q = 0; q < arms.length; q++) {
    // An arm this far away cannot change the blend, and nor can any after it.
    const limit = Math.min(A, body + OCTO.kArm) + OCTO.kArmArm;
    if (armDistBox[armOrder[q]] > limit) break;
    A = smin(A, armDist(arms[armOrder[q]], x, y, z, undefined, limit), OCTO.kArmArm);
  }
  return Math.max(smin(body, A, OCTO.kArm), -y);
};

const HC = OCTO.head.c;
const DORSAL = norm([0, 0.75, -0.66]);
const CHEEK: RGB = [0.445, 0.857, 0.485];

/** Pale undersides on the arms and skirt, freckles on the back of the head, blushing cheeks. */
const octoPaint: Paint = {
  channels: 3,
  masks: (x, y, z, grad) => {
  let bd = Infinity, arm: Arm | null = null, k = 0;
  const hit = { k: 0 };
  for (const a of getArms()) {
    if (boxDist(a.box, x, y, z) > bd) continue;
    const d = armDist(a, x, y, z, hit, bd);
    if (d < bd) { bd = d; arm = a; k = hit.k; }
  }
  let ventral = 0;
  if (arm && bd < sdBody(x, y, z) + 0.04) {
    const g = [0, 0, 0];
    grad(x, y, z, g);
    const dot = g[0] * arm.ven[k * 3] + g[1] * arm.ven[k * 3 + 1] + g[2] * arm.ven[k * 3 + 2];
    ventral = Math.min(0.99, Math.pow(Math.max(0, dot), 1.5) * smoothstep(0.35, 0.8, arm.s[k]));
  } else if (y < 0.25) ventral = Math.min(0.99, smoothstep(0.25, 0.03, y) * 0.8);
  const hd = norm([x - HC[0], y - HC[1], z - HC[2]]);
  const dorsal = smoothstep(-0.1, 0.5, hd[0] * DORSAL[0] + hd[1] * DORSAL[1] + hd[2] * DORSAL[2]);
  const freck = smoothstep(0.66, 0.8, vnoise(x * 9 + 3.1, y * 9, z * 9 + 1.7)) * smoothstep(0.45, 0.75, y) * dorsal * 0.8;
  const d2 = (cx: number) => (x - cx) ** 2 + (y - CHEEK[1]) ** 2 + (z - CHEEK[2]) ** 2;
  const blush = (Math.exp(-d2(CHEEK[0]) / 0.085 ** 2) + Math.exp(-d2(-CHEEK[0]) / 0.085 ** 2)) * 0.26;
  return [clamp01(ventral * 0.75), freck * 0.6, clamp01(blush) * 0.6];
  },
  blend: (m, p) => mix(mix(mix(lin(p.color), col(p, 'pale'), m[0]), col(p, 'freckle'), m[1]), col(p, 'blush'), m[2]),
};

/** Walk from the head centre along dir until the surface. */
function surfaceAlong(dir: RGB): RGB {
  let t = 0;
  for (let i = 0; i < 64; i++) {
    const d = octoSdf(HC[0] + dir[0] * t, HC[1] + dir[1] * t, HC[2] + dir[2] * t);
    if (d > -1e-4 && t > 0.1) break;
    t += Math.max(Math.abs(d), 0.004);
  }
  return [HC[0] + dir[0] * t, HC[1] + dir[1] * t, HC[2] + dir[2] * t];
}

function octoInclusions(): Inclusion[] {
  const arms = getArms();
  const suckers: PartMesh[] = [], face: PartMesh[] = [];
  const g = [0, 0, 0];
  // Suckers: two staggered rows under each arm.
  for (const arm of arms) {
    const np = arm.s.length;
    for (const row of [1, -1]) {
      let s = 0.42 + (row < 0 ? 0.03 : 0);
      while (s < OCTO.L - 0.07) {
        const k = Math.min(np - 2, Math.round(s / 0.012));
        const r = armRadius(s);
        const cr = Math.min(0.056, Math.max(0.019, 0.37 * r));
        const c: RGB = [arm.pts[k * 3], arm.pts[k * 3 + 1], arm.pts[k * 3 + 2]];
        const t = norm([arm.pts[k * 3 + 3] - c[0], arm.pts[k * 3 + 4] - c[1], arm.pts[k * 3 + 5] - c[2]]);
        const v: RGB = [arm.ven[k * 3], arm.ven[k * 3 + 1], arm.ven[k * 3 + 2]];
        const ang = row * (s < OCTO.sGround ? 0.95 : 0.5);
        const side = cross(t, v);
        const dir = norm([v[0] * Math.cos(ang) + side[0] * Math.sin(ang), v[1] * Math.cos(ang) + side[1] * Math.sin(ang), v[2] * Math.cos(ang) + side[2] * Math.sin(ang)]);
        const at: RGB = [c[0] + dir[0] * (r - 0.1 * cr), c[1] + dir[1] * (r - 0.1 * cr), c[2] + dir[2] * (r - 0.1 * cr)];
        if (at[1] > 0.005) suckers.push(ellipsoidMesh(at, dir, t, 0.22 * cr, cr, cr, 0, 6));
        s += Math.max(0.055, cr * 1.8);
      }
    }
  }
  // Eyes: glossy domes on the face.
  for (const sx of [1, -1]) {
    const p = surfaceAlong(norm([0.4 * sx, -0.08, 0.91]));
    sdfGrad(octoSdf, p[0], p[1], p[2], g, 0.004);
    const n = norm(g as RGB);
    const side = norm(cross([0, 1, 0], n));
    // Half proud of the skin, so they read as glossy domes through the jelly.
    face.push(ellipsoidMesh([p[0] + n[0] * 0.012, p[1] + n[1] * 0.012, p[2] + n[2] * 0.012], n, side, 0.05, 0.078, 0.094, 0, 10));
  }
  // Smile: a row of beads just proud of the surface.
  for (let i = 0; i <= 18; i++) {
    const u = (i / 18) * 2 - 1;
    const p = surfaceAlong(norm([u * 0.13, -0.3 - 0.045 * (1 - u * u), 0.95]));
    const r = 0.011 * (0.55 + 0.45 * Math.sin((Math.PI * i) / 18));
    face.push(ellipsoidMesh(p, [1, 0, 0], [0, 1, 0], r, r, r, 0, 5));
  }
  return [{ ...merge(suckers), color: 'pale', roughness: 0.35 }, { ...merge(face), color: 'eye', roughness: 0.08 }];
}

export const octopus: ShapeDef = {
  id: 'octopus', name: 'Octopus',
  ...scaled(0.45, { sdf: octoSdf, min: [-1.66, 0, -1.66], max: [1.66, 1.82, 1.66], paint: octoPaint, inclusions: octoInclusions }),
  cell: 0.1, skin: 0.014,
  palettes: [
    { name: 'Coral', color: '#fca27c', deep: '#e76c50', clarity: 0.6, roughness: 0.24, colors: { pale: '#ffe7d4', blush: '#fd9595', freckle: '#ce593f', eye: '#241816' } },
    { name: 'Lagoon', color: '#7ce2dd', deep: '#30aaad', clarity: 0.62, roughness: 0.24, colors: { pale: '#e5fcf6', blush: '#fdbfc4', freckle: '#278b95', eye: '#161f24' } },
    { name: 'Grape', color: '#cb90f3', deep: '#954bbc', clarity: 0.6, roughness: 0.24, colors: { pale: '#f6e7ff', blush: '#feadce', freckle: '#7c38a2', eye: '#1d1624' } },
  ],
};
