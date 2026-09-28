import { type ShapeDef } from './shapes.ts';
import { sdfGrad } from './sdf.ts';
import { surfaceNets } from './mesher.ts';

/** Everything about a shape that does not change per instance. Built once, shared by every copy. */
export interface Topology {
  shape: ShapeDef;
  n: number;
  rest: Float32Array;
  mass: Float32Array;
  restCom: [number, number, number];
  tets: Int32Array;
  restVol: Float32Array;
  /** Inverse of the rest edge matrix [x1-x0 | x2-x0 | x3-x0], row-major, 9 per tet. */
  invDm: Float32Array;
  /** Tet across the face opposite vertex k, or -1 on the boundary. 4 per tet. */
  neighbors: Int32Array;
  edges: Int32Array;
  restLen: Float32Array;
  /** Rest offset from each node to the nearest point of the true surface: sdf times its gradient. 3 per node. */
  surfOffset: Float32Array;
  /** Nodes within one cell of the true surface. These carry contact. */
  contactNodes: Int32Array;
  /** Rest-space lookup grid: the tets born in each lattice cell. */
  grid: { o: [number, number, number]; h: number; dims: [number, number, number]; start: Int32Array; tets: Int32Array };
  skin: {
    rest: Float32Array;
    index: Uint32Array;
    tet: Int32Array;
    /** 4 weights per vertex. */
    bary: Float32Array;
  };
}

// Five-tet split of a cube, two mirrored variants so neighbouring cells share face diagonals.
// Corner c = x | y << 1 | z << 2.
const SPLIT = [
  [[0, 1, 2, 4], [3, 1, 2, 7], [5, 1, 4, 7], [6, 2, 4, 7], [1, 2, 4, 7]],
  [[1, 0, 3, 5], [2, 0, 3, 6], [4, 0, 5, 6], [7, 3, 5, 6], [0, 3, 5, 6]],
];

export function inv3(m: ArrayLike<number>, out: Float32Array | Float64Array, off = 0): number {
  const a = m[0], b = m[1], c = m[2], d = m[3], e = m[4], f = m[5], g = m[6], h = m[7], i = m[8];
  const A = e * i - f * h, B = f * g - d * i, C = d * h - e * g;
  const det = a * A + b * B + c * C;
  const s = Math.abs(det) > 1e-20 ? 1 / det : 0;
  out[off] = A * s; out[off + 1] = (c * h - b * i) * s; out[off + 2] = (b * f - c * e) * s;
  out[off + 3] = B * s; out[off + 4] = (a * i - c * g) * s; out[off + 5] = (c * d - a * f) * s;
  out[off + 6] = C * s; out[off + 7] = (b * g - a * h) * s; out[off + 8] = (a * e - b * d) * s;
  return det;
}

export function tetVolume(p: ArrayLike<number>, a: number, b: number, c: number, d: number) {
  const ax = p[a * 3], ay = p[a * 3 + 1], az = p[a * 3 + 2];
  const ux = p[b * 3] - ax, uy = p[b * 3 + 1] - ay, uz = p[b * 3 + 2] - az;
  const vx = p[c * 3] - ax, vy = p[c * 3 + 1] - ay, vz = p[c * 3 + 2] - az;
  const wx = p[d * 3] - ax, wy = p[d * 3 + 1] - ay, wz = p[d * 3 + 2] - az;
  return ((uy * vz - uz * vy) * wx + (uz * vx - ux * vz) * wy + (ux * vy - uy * vx) * wz) / 6;
}

const cache = new Map<string, Topology>();

export function topology(shape: ShapeDef): Topology {
  let t = cache.get(shape.id);
  if (!t) { t = build(shape); cache.set(shape.id, t); }
  return t;
}

function build(shape: ShapeDef): Topology {
  const f = shape.sdf;
  const h = shape.cell;
  const o: [number, number, number] = [shape.min[0] - h, shape.min[1] - h, shape.min[2] - h];
  const dims: [number, number, number] = [0, 1, 2].map((a) => Math.ceil((shape.max[a] - shape.min[a]) / h) + 2) as [number, number, number];
  const [cx, cy, cz] = dims;
  const gx = cx + 1, gy = cy + 1;
  const gid = (i: number, j: number, k: number) => i + gx * (j + gy * k);

  // 1. Keep every cell the surface can pass through, split each into five tets.
  // The lattice stays a regular grid that fully contains the surface, so the skin never has to extrapolate.
  const raw: number[] = [];
  const keptCell: number[] = [];
  for (let k = 0; k < cz; k++)
    for (let j = 0; j < cy; j++)
      for (let i = 0; i < cx; i++) {
        if (f(o[0] + (i + 0.5) * h, o[1] + (j + 0.5) * h, o[2] + (k + 0.5) * h) > 0.9 * h) continue;
        const split = SPLIT[(i + j + k) & 1];
        for (const tet of split) {
          for (const c of tet) raw.push(gid(i + (c & 1), j + ((c >> 1) & 1), k + ((c >> 2) & 1)));
          keptCell.push(i + cx * (j + cy * k));
        }
      }

  // 2. Compact the grid nodes and orient every tet positively.
  const remap = new Map<number, number>();
  const rest: number[] = [];
  for (const g of raw) {
    if (remap.has(g)) continue;
    remap.set(g, rest.length / 3);
    const i = g % gx, j = Math.floor(g / gx) % gy, k = Math.floor(g / (gx * gy));
    rest.push(o[0] + i * h, o[1] + j * h, o[2] + k * h);
  }
  const tets = new Int32Array(raw.map((g) => remap.get(g)!));
  for (let t = 0; t < tets.length; t += 4) {
    if (tetVolume(rest, tets[t], tets[t + 1], tets[t + 2], tets[t + 3]) < 0) {
      const tmp = tets[t + 2]; tets[t + 2] = tets[t + 3]; tets[t + 3] = tmp;
    }
  }
  const nT = tets.length / 4;
  const n = rest.length / 3;
  const restF = new Float32Array(rest);

  // 3. Where the true surface is, seen from each node.
  const surfOffset = new Float32Array(n * 3);
  const contact: number[] = [];
  const grad = new Float64Array(3);
  for (let i = 0; i < n; i++) {
    const x = restF[i * 3], y = restF[i * 3 + 1], z = restF[i * 3 + 2];
    const d = f(x, y, z);
    sdfGrad(f, x, y, z, grad, h * 0.02);
    surfOffset[i * 3] = d * grad[0]; surfOffset[i * 3 + 1] = d * grad[1]; surfOffset[i * 3 + 2] = d * grad[2];
    if (Math.abs(d) < h) contact.push(i);
  }

  // 4. Per-tet rest data and node masses.
  const restVol = new Float32Array(nT);
  const invDm = new Float32Array(nT * 9);
  const mass = new Float32Array(n);
  const m = new Float64Array(9);
  for (let t = 0; t < nT; t++) {
    const a = tets[t * 4], b = tets[t * 4 + 1], c = tets[t * 4 + 2], d = tets[t * 4 + 3];
    const vol = tetVolume(restF, a, b, c, d);
    restVol[t] = vol;
    for (let r = 0; r < 3; r++) {
      m[r * 3] = restF[b * 3 + r] - restF[a * 3 + r];
      m[r * 3 + 1] = restF[c * 3 + r] - restF[a * 3 + r];
      m[r * 3 + 2] = restF[d * 3 + r] - restF[a * 3 + r];
    }
    inv3(m, invDm, t * 9);
    for (let k = 0; k < 4; k++) mass[tets[t * 4 + k]] += vol / 4;
  }
  let mx = 0, my = 0, mz = 0, mt = 0;
  for (let i = 0; i < n; i++) {
    mx += restF[i * 3] * mass[i]; my += restF[i * 3 + 1] * mass[i]; mz += restF[i * 3 + 2] * mass[i]; mt += mass[i];
  }

  // 5. Face neighbours and unique edges.
  const neighbors = new Int32Array(nT * 4).fill(-1);
  const faces = new Map<string, number>();
  for (let t = 0; t < nT; t++)
    for (let k = 0; k < 4; k++) {
      const fv = [0, 1, 2, 3].filter((q) => q !== k).map((q) => tets[t * 4 + q]).sort((x, y) => x - y);
      const key = fv.join(',');
      const other = faces.get(key);
      if (other === undefined) faces.set(key, t * 4 + k);
      else {
        neighbors[t * 4 + k] = other >> 2;
        neighbors[other] = t;
        faces.delete(key);
      }
    }
  const edgeSet = new Set<number>();
  const edges: number[] = [];
  for (let t = 0; t < nT; t++)
    for (let a = 0; a < 4; a++)
      for (let b = a + 1; b < 4; b++) {
        const i = Math.min(tets[t * 4 + a], tets[t * 4 + b]);
        const j = Math.max(tets[t * 4 + a], tets[t * 4 + b]);
        const key = i * n + j;
        if (edgeSet.has(key)) continue;
        edgeSet.add(key);
        edges.push(i, j);
      }
  const restLen = new Float32Array(edges.length / 2);
  for (let e = 0; e < restLen.length; e++) {
    const i = edges[e * 2], j = edges[e * 2 + 1];
    restLen[e] = Math.hypot(restF[i * 3] - restF[j * 3], restF[i * 3 + 1] - restF[j * 3 + 1], restF[i * 3 + 2] - restF[j * 3 + 2]);
  }

  // 6. Rest-space grid: cell -> the tets born there.
  const nCells = cx * cy * cz;
  const start = new Int32Array(nCells + 1);
  for (const c of keptCell) start[c + 1]++;
  for (let c = 0; c < nCells; c++) start[c + 1] += start[c];
  const fill = start.slice(0, nCells);
  const cellTets = new Int32Array(nT);
  keptCell.forEach((c, t) => { cellTets[fill[c]++] = t; });
  const grid = { o, h, dims, start, tets: cellTets };

  // 7. Render skin, each vertex tied to the tet that contains it (or the nearest one).
  const mesh = surfaceNets(f, shape.min, shape.max, shape.skin);
  const nv = mesh.positions.length / 3;
  const skinTet = new Int32Array(nv);
  const skinBary = new Float32Array(nv * 4);
  const b = new Float64Array(4);
  for (let v = 0; v < nv; v++) {
    const X = mesh.positions[v * 3], Y = mesh.positions[v * 3 + 1], Z = mesh.positions[v * 3 + 2];
    let best = -1, bestScore = -Infinity;
    const ci = Math.floor((X - o[0]) / h), cj = Math.floor((Y - o[1]) / h), ck = Math.floor((Z - o[2]) / h);
    for (let dk = -1; dk <= 1; dk++)
      for (let dj = -1; dj <= 1; dj++)
        for (let di = -1; di <= 1; di++) {
          const i = ci + di, j = cj + dj, k = ck + dk;
          if (i < 0 || j < 0 || k < 0 || i >= cx || j >= cy || k >= cz) continue;
          const c = i + cx * (j + cy * k);
          for (let s = start[c]; s < start[c + 1]; s++) {
            const t = cellTets[s];
            baryRest(restF, tets, invDm, t, X, Y, Z, b);
            const score = Math.min(b[0], b[1], b[2], b[3]);
            if (score > bestScore) { bestScore = score; best = t; }
          }
        }
    if (best < 0) best = 0;
    skinTet[v] = best;
    baryRest(restF, tets, invDm, best, X, Y, Z, b);
    skinBary.set(b, v * 4);
  }

  return {
    shape, n, rest: restF, mass, restCom: [mx / mt, my / mt, mz / mt],
    tets, restVol, invDm, neighbors,
    edges: new Int32Array(edges), restLen,
    surfOffset,
    contactNodes: new Int32Array(contact),
    grid,
    skin: { rest: mesh.positions, index: mesh.indices, tet: skinTet, bary: skinBary },
  };
}

function baryRest(rest: Float32Array, tets: Int32Array, invDm: Float32Array, t: number, x: number, y: number, z: number, out: Float64Array) {
  const a = tets[t * 4] * 3;
  const dx = x - rest[a], dy = y - rest[a + 1], dz = z - rest[a + 2];
  const m = t * 9;
  const b1 = invDm[m] * dx + invDm[m + 1] * dy + invDm[m + 2] * dz;
  const b2 = invDm[m + 3] * dx + invDm[m + 4] * dy + invDm[m + 5] * dz;
  const b3 = invDm[m + 6] * dx + invDm[m + 7] * dy + invDm[m + 8] * dz;
  out[0] = 1 - b1 - b2 - b3; out[1] = b1; out[2] = b2; out[3] = b3;
}
