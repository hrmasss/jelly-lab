import { type SDF } from './sdf.ts';

/**
 * A shape's distance sampled on a regular grid. Built once; afterwards meshing, contact and painting read the grid
 * instead of calling the shape's formula, which for the octopus costs ~20 microseconds a call.
 */
export class Field {
  readonly o: [number, number, number];
  readonly step: number;
  readonly n: [number, number, number];
  readonly v: Float32Array;

  constructor(o: [number, number, number], step: number, n: [number, number, number], v: Float32Array) {
    this.o = o; this.step = step; this.n = n; this.v = v;
  }

  /** Trilinear distance; clamps to the grid edge outside it. */
  sample(x: number, y: number, z: number) {
    const { o, step, n, v } = this;
    let fx = (x - o[0]) / step, fy = (y - o[1]) / step, fz = (z - o[2]) / step;
    fx = Math.min(Math.max(fx, 0), n[0] - 1.001);
    fy = Math.min(Math.max(fy, 0), n[1] - 1.001);
    fz = Math.min(Math.max(fz, 0), n[2] - 1.001);
    const i = Math.floor(fx), j = Math.floor(fy), k = Math.floor(fz);
    const tx = fx - i, ty = fy - j, tz = fz - k;
    const sx = 1, sy = n[0], sz = n[0] * n[1];
    const b = i + j * sy + k * sz;
    const c00 = v[b] + (v[b + sx] - v[b]) * tx;
    const c10 = v[b + sy] + (v[b + sy + sx] - v[b + sy]) * tx;
    const c01 = v[b + sz] + (v[b + sz + sx] - v[b + sz]) * tx;
    const c11 = v[b + sz + sy] + (v[b + sz + sy + sx] - v[b + sz + sy]) * tx;
    const c0 = c00 + (c10 - c00) * ty, c1 = c01 + (c11 - c01) * ty;
    return c0 + (c1 - c0) * tz;
  }

  /** Normalised gradient into out. */
  grad(x: number, y: number, z: number, out: Float64Array | number[]) {
    const e = this.step * 0.5;
    const gx = this.sample(x + e, y, z) - this.sample(x - e, y, z);
    const gy = this.sample(x, y + e, z) - this.sample(x, y - e, z);
    const gz = this.sample(x, y, z + e) - this.sample(x, y, z - e);
    const l = Math.sqrt(gx * gx + gy * gy + gz * gz) || 1;
    out[0] = gx / l; out[1] = gy / l; out[2] = gz / l;
  }
}

/**
 * Sample f every `step` over [min, max] plus padding. Nodes every 4 steps come first; a 4-cell the surface might cross
 * gets its nodes every 2 steps, and a 2-cell the surface might cross gets every node. Everything else is interpolated,
 * which keeps signs right away from the surface and only pays for the formula near it.
 */
export function bakeField(f: SDF, min: number[], max: number[], step: number, pad = step * 2): Field {
  const o: [number, number, number] = [min[0] - pad, min[1] - pad, min[2] - pad];
  const n = [0, 1, 2].map((a) => Math.ceil(Math.ceil((max[a] - min[a] + 2 * pad) / step) / 4) * 4 + 1) as [number, number, number];
  const [n0, n1] = n;
  const v = new Float32Array(n[0] * n[1] * n[2]);
  const at = (i: number, j: number, k: number) => i + n0 * (j + n1 * k);
  // Neighbouring cells share nodes; each node pays for the formula at most once.
  const known = new Uint8Array(v.length);
  const evalAt = (i: number, j: number, k: number) => {
    const q = at(i, j, k);
    if (known[q]) return;
    known[q] = 1;
    v[q] = f(o[0] + i * step, o[1] + j * step, o[2] + k * step);
  };
  // Surface can only cross a cell if some corner is within a cell diagonal of it (small margin for inexact sdfs).
  const near = (i: number, j: number, k: number, S: number) => {
    const reach = S * step * Math.sqrt(3) * 1.1;
    for (let c = 0; c < 8; c++) if (Math.abs(v[at(i + (c & 1) * S, j + ((c >> 1) & 1) * S, k + (c >> 2) * S)]) < reach) return true;
    return false;
  };
  /** Fill the inside of a cell of size S by trilinear interpolation of its corners. */
  const fill = (i: number, j: number, k: number, S: number) => {
    const c = (a: number, b: number, d: number) => v[at(i + a * S, j + b * S, k + d * S)];
    const c000 = c(0, 0, 0), c100 = c(1, 0, 0), c010 = c(0, 1, 0), c110 = c(1, 1, 0);
    const c001 = c(0, 0, 1), c101 = c(1, 0, 1), c011 = c(0, 1, 1), c111 = c(1, 1, 1);
    for (let dk = 0; dk <= S; dk++)
      for (let dj = 0; dj <= S; dj++)
        for (let di = 0; di <= S; di++) {
          if ((di === 0 || di === S) && (dj === 0 || dj === S) && (dk === 0 || dk === S)) continue;
          if (known[at(i + di, j + dj, k + dk)]) continue;
          const x = di / S, y = dj / S, z = dk / S;
          const a0 = c000 + (c100 - c000) * x, a1 = c010 + (c110 - c010) * x;
          const b0 = c001 + (c101 - c001) * x, b1 = c011 + (c111 - c011) * x;
          const e0 = a0 + (a1 - a0) * y, e1 = b0 + (b1 - b0) * y;
          v[at(i + di, j + dj, k + dk)] = e0 + (e1 - e0) * z;
        }
  };
  for (let k = 0; k < n[2]; k += 4) for (let j = 0; j < n[1]; j += 4) for (let i = 0; i < n[0]; i += 4) evalAt(i, j, k);
  for (let k = 0; k < n[2] - 1; k += 4)
    for (let j = 0; j < n[1] - 1; j += 4)
      for (let i = 0; i < n[0] - 1; i += 4) {
        if (!near(i, j, k, 4)) { fill(i, j, k, 4); continue; }
        for (let dk = 0; dk <= 4; dk += 2) for (let dj = 0; dj <= 4; dj += 2) for (let di = 0; di <= 4; di += 2)
          if (di % 4 || dj % 4 || dk % 4) evalAt(i + di, j + dj, k + dk);
        for (let dk = 0; dk < 4; dk += 2)
          for (let dj = 0; dj < 4; dj += 2)
            for (let di = 0; di < 4; di += 2) {
              const I = i + di, J = j + dj, K = k + dk;
              if (!near(I, J, K, 2)) { fill(I, J, K, 2); continue; }
              for (let ek = 0; ek <= 2; ek++) for (let ej = 0; ej <= 2; ej++) for (let ei = 0; ei <= 2; ei++)
                if (ei % 2 || ej % 2 || ek % 2) evalAt(I + ei, J + ej, K + ek);
            }
      }
  return new Field(o, step, n, v);
}
