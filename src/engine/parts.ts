// Small helpers for building shapes: seeded randomness, colour maths, and solid inclusion meshes.

export type RGB = [number, number, number];

/** Seeded PRNG (mulberry32), so a shape's seeds land in the same place on every load. */
export function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** '#rrggbb' to linear RGB, the space vertex colours are stored in. */
export function lin(hex: string): RGB {
  const n = parseInt(hex.slice(1), 16);
  const f = (c: number) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  return [f((n >> 16) & 255), f((n >> 8) & 255), f(n & 255)];
}

export function mix(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

export function smoothstep(e0: number, e1: number, x: number) {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

export interface PartMesh {
  positions: Float32Array;
  indices: Uint32Array;
}

/**
 * Ellipsoid centred at c with semi-axes along the (orthogonal) directions a, b, and a x b.
 * `taper` narrows the -a end, for seed-like teardrops.
 */
export function ellipsoidMesh(c: RGB, a: RGB, b: RGB, ra: number, rb: number, rc: number, taper = 0, seg = 10): PartMesh {
  const cx = a[1] * b[2] - a[2] * b[1], cy = a[2] * b[0] - a[0] * b[2], cz = a[0] * b[1] - a[1] * b[0];
  const rings = seg, around = seg + 2;
  const pos: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= rings; i++) {
    const th = (Math.PI * i) / rings;
    const along = -Math.cos(th);
    const w = Math.sin(th) * (1 - taper * (1 - along) * 0.5);
    for (let j = 0; j < around; j++) {
      const ph = (2 * Math.PI * j) / around;
      const u = Math.cos(ph) * w * rb, v = Math.sin(ph) * w * rc, s = along * ra;
      pos.push(c[0] + a[0] * s + b[0] * u + cx * v, c[1] + a[1] * s + b[1] * u + cy * v, c[2] + a[2] * s + b[2] * u + cz * v);
    }
  }
  for (let i = 0; i < rings; i++)
    for (let j = 0; j < around; j++) {
      const p = i * around + j, q = i * around + ((j + 1) % around);
      idx.push(p, q, p + around, q, q + around, p + around);
    }
  return { positions: new Float32Array(pos), indices: new Uint32Array(idx) };
}

/** Concatenate meshes into one. */
export function merge(parts: PartMesh[]): PartMesh {
  let np = 0, ni = 0;
  for (const p of parts) { np += p.positions.length; ni += p.indices.length; }
  const positions = new Float32Array(np), indices = new Uint32Array(ni);
  let op = 0, oi = 0;
  for (const p of parts) {
    positions.set(p.positions, op);
    for (let k = 0; k < p.indices.length; k++) indices[oi + k] = p.indices[k] + op / 3;
    op += p.positions.length; oi += p.indices.length;
  }
  return { positions, indices };
}

const fract = (x: number) => x - Math.floor(x);

/** Hash of a lattice point to [0, 1). Same recipe as the originals' shaders, so patterns match. */
export function hash3(x: number, y: number, z: number) {
  let qx = fract(x * 0.1031), qy = fract(y * 0.1031), qz = fract(z * 0.1031);
  const d = qx * (qy + 33.33) + qy * (qz + 33.33) + qz * (qx + 33.33);
  qx += d; qy += d; qz += d;
  return fract((qx + qy) * qz);
}

/** Trilinear value noise over hash3, smoothstep weights. */
export function vnoise(x: number, y: number, z: number) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const fx = x - ix, fy = y - iy, fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy), uz = fz * fz * (3 - 2 * fz);
  const h = (a: number, b: number, c: number) => hash3(ix + a, iy + b, iz + c);
  const l = (a: number, b: number, t: number) => a + (b - a) * t;
  return l(
    l(l(h(0, 0, 0), h(1, 0, 0), ux), l(h(0, 1, 0), h(1, 1, 0), ux), uy),
    l(l(h(0, 0, 1), h(1, 0, 1), ux), l(h(0, 1, 1), h(1, 1, 1), ux), uy),
    uz,
  );
}

export function fbm(x: number, y: number, z: number) {
  return 0.55 * vnoise(x, y, z) + 0.3 * vnoise(x * 2.13 + 7.1, y * 2.13 + 7.1, z * 2.13 + 7.1)
    + 0.15 * vnoise(x * 4.37 + 3.3, y * 4.37 + 3.3, z * 4.37 + 3.3);
}
