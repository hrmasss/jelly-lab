import { SoftBody } from './body.ts';
import { sdfGrad } from './sdf.ts';

export interface Grab {
  body: SoftBody;
  nodes: Int32Array;
  weights: Float32Array;
  /** Node offsets from the grab point at the moment of grabbing. */
  offsets: Float32Array;
  target: [number, number, number];
}

export interface WorldParams {
  /** 0 = barely holds its shape, 1 = firm gummy. */
  firmness: number;
  /** 0 = wobbles forever, 1 = settles fast. */
  damping: number;
  substeps: number;
  gravity: [number, number, number];
  friction: number;
  /** Friction between jellies. */
  stickiness: number;
  fence: number;
}

export class World {
  bodies: SoftBody[] = [];
  grab: Grab | null = null;
  params: WorldParams = {
    firmness: 0.45, damping: 0.4, substeps: 8,
    gravity: [0, -14, 0], friction: 0.35, fence: 2.5, stickiness: 0.9,
  };
  /** Contacts resolved in the last frame, for the readout. */
  contacts = 0;

  step(dt: number) {
    const p = this.params;
    const sub = p.substeps;
    const h = dt / sub;
    // Compliance in log space: soft jellies around 1e-2, firm ones around 3e-6.
    const edgeAlpha = Math.pow(10, -1.9 - 3.6 * p.firmness) / (h * h);
    const volAlpha = edgeAlpha * 0.02;
    const damp = 0.002 + 0.06 * p.damping * p.damping;
    const [gx, gy, gz] = p.gravity;
    this.contacts = 0;
    for (const b of this.bodies) b.updateFrame();
    for (let s = 0; s < sub; s++) {
      for (const b of this.bodies) b.predict(h, gx, gy, gz);
      for (const b of this.bodies) {
        b.solveEdges(edgeAlpha);
        b.solveVolumes(volAlpha);
      }
      if (this.grab) this.solveGrab(this.grab);
      for (const b of this.bodies) { b.solveBounds(p.friction, p.fence); b.updateAabb(); }
      for (let i = 0; i < this.bodies.length; i++)
        for (let j = i + 1; j < this.bodies.length; j++) {
          const A = this.bodies[i], B = this.bodies[j];
          if (!overlaps(A.aabb, B.aabb)) continue;
          this.contacts += collide(A, B, p.stickiness) + collide(B, A, p.stickiness);
        }
      // Internal damping once per frame, compounded to match damping every substep.
      const last = s === sub - 1;
      for (const b of this.bodies) b.finish(h, last ? 1 - Math.pow(1 - damp, sub) : 0);
    }
    for (const b of this.bodies) b.updateAabb();
  }

  /** Grab the nodes around a world-space point on a body's surface. */
  startGrab(body: SoftBody, x: number, y: number, z: number) {
    const r = body.topo.shape.cell * 1.6;
    const nodes: number[] = [], weights: number[] = [], offsets: number[] = [];
    let nearest = -1, nd = Infinity;
    for (let i = 0; i < body.n; i++) {
      const dx = body.pos[i * 3] - x, dy = body.pos[i * 3 + 1] - y, dz = body.pos[i * 3 + 2] - z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d < nd) { nd = d; nearest = i; }
      if (d > r) continue;
      nodes.push(i);
      weights.push(1 - (d / r) * (d / r));
      offsets.push(dx, dy, dz);
    }
    if (nodes.length === 0) {
      nodes.push(nearest); weights.push(1);
      offsets.push(body.pos[nearest * 3] - x, body.pos[nearest * 3 + 1] - y, body.pos[nearest * 3 + 2] - z);
    }
    this.grab = {
      body, nodes: new Int32Array(nodes), weights: new Float32Array(weights), offsets: new Float32Array(offsets),
      target: [x, y, z],
    };
  }

  private solveGrab(g: Grab) {
    const pos = g.body.pos;
    const [tx, ty, tz] = g.target;
    for (let k = 0; k < g.nodes.length; k++) {
      const j = g.nodes[k] * 3;
      const w = g.weights[k] * 0.35;
      pos[j] += (tx + g.offsets[k * 3] - pos[j]) * w;
      pos[j + 1] += (ty + g.offsets[k * 3 + 1] - pos[j + 1]) * w;
      pos[j + 2] += (tz + g.offsets[k * 3 + 2] - pos[j + 2]) * w;
    }
  }
}

function overlaps(a: Float64Array, b: Float64Array) {
  return a[0] <= b[3] && b[0] <= a[3] && a[1] <= b[4] && b[1] <= a[4] && a[2] <= b[5] && b[2] <= a[5];
}

const SKIN_GAP = 0.025;
const ds = new Float64Array(9);
const dsi = new Float64Array(9);
const bary = new Float64Array(4);
const grad = new Float64Array(3);

/** Barycentric coordinates of (x, y, z) in body tet t, current pose. Leaves the inverse edge matrix in dsi. */
function baryNow(B: SoftBody, t: number, x: number, y: number, z: number) {
  const P = B.pos, T = B.topo.tets;
  const a = T[t * 4] * 3, b = T[t * 4 + 1] * 3, c = T[t * 4 + 2] * 3, d = T[t * 4 + 3] * 3;
  for (let r = 0; r < 3; r++) {
    ds[r * 3] = P[b + r] - P[a + r];
    ds[r * 3 + 1] = P[c + r] - P[a + r];
    ds[r * 3 + 2] = P[d + r] - P[a + r];
  }
  invert(ds, dsi);
  const dx = x - P[a], dy = y - P[a + 1], dz = z - P[a + 2];
  bary[1] = dsi[0] * dx + dsi[1] * dy + dsi[2] * dz;
  bary[2] = dsi[3] * dx + dsi[4] * dy + dsi[5] * dz;
  bary[3] = dsi[6] * dx + dsi[7] * dy + dsi[8] * dz;
  bary[0] = 1 - bary[1] - bary[2] - bary[3];
}

function invert(m: Float64Array, out: Float64Array) {
  const a = m[0], b = m[1], c = m[2], d = m[3], e = m[4], f = m[5], g = m[6], h = m[7], i = m[8];
  const A = e * i - f * h, Bc = f * g - d * i, C = d * h - e * g;
  const det = a * A + b * Bc + c * C;
  const s = Math.abs(det) > 1e-24 ? 1 / det : 0;
  out[0] = A * s; out[1] = (c * h - b * i) * s; out[2] = (b * f - c * e) * s;
  out[3] = Bc * s; out[4] = (a * i - c * g) * s; out[5] = (c * d - a * f) * s;
  out[6] = C * s; out[7] = (b * g - a * h) * s; out[8] = (a * e - b * d) * s;
}

/**
 * Push A's surface nodes out of B's volume. Depth and normal come from B's rest-shape sdf, carried into the current pose
 * through the containing tet, so contact happens at B's true surface rather than its coarse lattice.
 */
function collide(A: SoftBody, B: SoftBody, mu: number): number {
  const T = B.topo;
  const { o, h, dims, start, tets: cellTets } = T.grid;
  const sdf = T.shape.sdf;
  const bb = B.aabb, R = B.rot, c = B.com, X0 = T.restCom;
  const P = A.pos, Pp = A.prev, Q = B.pos, Qp = B.prev, S = A.surf;
  const wA = A.invMass, wB = B.invMass;
  const tets = T.tets, nb = T.neighbors, rest = T.rest;
  let hits = 0;
  const cn = A.topo.contactNodes;
  for (let s = 0; s < cn.length; s++) {
    const ai = cn[s];
    const j = ai * 3;
    // Test A's true surface point near this node; corrections still move the node itself.
    const px = P[j] - S[j], py = P[j + 1] - S[j + 1], pz = P[j + 2] - S[j + 2];
    if (px < bb[0] || px > bb[3] || py < bb[1] || py > bb[4] || pz < bb[2] || pz > bb[5]) continue;
    // Guess rest coordinates from B's rigid fit, and skip nodes clearly outside.
    const rx = px - c[0], ry = py - c[1], rz = pz - c[2];
    const X = R[0] * rx + R[3] * ry + R[6] * rz + X0[0];
    const Y = R[1] * rx + R[4] * ry + R[7] * rz + X0[1];
    const Z = R[2] * rx + R[5] * ry + R[8] * rz + X0[2];
    if (sdf(X, Y, Z) > 1.5 * h + SKIN_GAP) continue;
    // Start in a tet near the guess, then walk through the current mesh to the one that contains the node.
    const ci = Math.min(dims[0] - 1, Math.max(0, Math.floor((X - o[0]) / h)));
    const cj = Math.min(dims[1] - 1, Math.max(0, Math.floor((Y - o[1]) / h)));
    const ck = Math.min(dims[2] - 1, Math.max(0, Math.floor((Z - o[2]) / h)));
    let t = -1;
    for (let r = 0; r <= 1 && t < 0; r++)
      for (let dk = -r; dk <= r && t < 0; dk++)
        for (let dj = -r; dj <= r && t < 0; dj++)
          for (let di = -r; di <= r && t < 0; di++) {
            const i = ci + di, jj = cj + dj, k = ck + dk;
            if (i < 0 || jj < 0 || k < 0 || i >= dims[0] || jj >= dims[1] || k >= dims[2]) continue;
            const cell = i + dims[0] * (jj + dims[1] * k);
            if (start[cell + 1] > start[cell]) t = cellTets[start[cell]];
          }
    if (t < 0) continue;
    let inside = false;
    for (let step = 0; step < 16; step++) {
      baryNow(B, t, px, py, pz);
      let k = 0;
      for (let q = 1; q < 4; q++) if (bary[q] < bary[k]) k = q;
      if (bary[k] >= -1e-4) { inside = true; break; }
      const next = nb[t * 4 + k];
      if (next < 0) break;
      t = next;
    }
    if (!inside) continue;
    const i0 = tets[t * 4], i1 = tets[t * 4 + 1], i2 = tets[t * 4 + 2], i3 = tets[t * 4 + 3];
    const b0 = bary[0], b1 = bary[1], b2 = bary[2], b3 = bary[3];
    const Xr = b0 * rest[i0 * 3] + b1 * rest[i1 * 3] + b2 * rest[i2 * 3] + b3 * rest[i3 * 3];
    const Yr = b0 * rest[i0 * 3 + 1] + b1 * rest[i1 * 3 + 1] + b2 * rest[i2 * 3 + 1] + b3 * rest[i3 * 3 + 1];
    const Zr = b0 * rest[i0 * 3 + 2] + b1 * rest[i1 * 3 + 2] + b2 * rest[i2 * 3 + 2] + b3 * rest[i3 * 3 + 2];
    // Keep a thin gap: the smooth skin bulges slightly past the lattice, and would otherwise show through.
    const d = sdf(Xr, Yr, Zr) - SKIN_GAP;
    if (d >= 0) continue;
    sdfGrad(sdf, Xr, Yr, Zr, grad, h * 0.02);
    // World normal n = F^-T g with F = Ds Dm^-1, so n = Ds^-T (Dm^T g).
    const e1x = rest[i1 * 3] - rest[i0 * 3], e1y = rest[i1 * 3 + 1] - rest[i0 * 3 + 1], e1z = rest[i1 * 3 + 2] - rest[i0 * 3 + 2];
    const e2x = rest[i2 * 3] - rest[i0 * 3], e2y = rest[i2 * 3 + 1] - rest[i0 * 3 + 1], e2z = rest[i2 * 3 + 2] - rest[i0 * 3 + 2];
    const e3x = rest[i3 * 3] - rest[i0 * 3], e3y = rest[i3 * 3 + 1] - rest[i0 * 3 + 1], e3z = rest[i3 * 3 + 2] - rest[i0 * 3 + 2];
    const u0 = e1x * grad[0] + e1y * grad[1] + e1z * grad[2];
    const u1 = e2x * grad[0] + e2y * grad[1] + e2z * grad[2];
    const u2 = e3x * grad[0] + e3y * grad[1] + e3z * grad[2];
    let nx = dsi[0] * u0 + dsi[3] * u1 + dsi[6] * u2;
    let ny = dsi[1] * u0 + dsi[4] * u1 + dsi[7] * u2;
    let nz = dsi[2] * u0 + dsi[5] * u1 + dsi[8] * u2;
    const ln = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (ln < 1e-9) continue;
    nx /= ln; ny /= ln; nz /= ln;
    const depth = d / ln;
    const wa = wA[ai], w0 = wB[i0], w1 = wB[i1], w2 = wB[i2], w3 = wB[i3];
    const W = wa + b0 * b0 * w0 + b1 * b1 * w1 + b2 * b2 * w2 + b3 * b3 * w3;
    if (W < 1e-12) continue;
    const lam = -depth / W;
    P[j] += nx * lam * wa; P[j + 1] += ny * lam * wa; P[j + 2] += nz * lam * wa;
    const push = (i: number, b: number, w: number, fx: number, fy: number, fz: number) => {
      Q[i * 3] -= fx * b * w; Q[i * 3 + 1] -= fy * b * w; Q[i * 3 + 2] -= fz * b * w;
    };
    push(i0, b0, w0, nx * lam, ny * lam, nz * lam);
    push(i1, b1, w1, nx * lam, ny * lam, nz * lam);
    push(i2, b2, w2, nx * lam, ny * lam, nz * lam);
    push(i3, b3, w3, nx * lam, ny * lam, nz * lam);
    // Friction: cancel part of the sliding between the node and the point of B it touches, capped by penetration.
    const dax = P[j] - Pp[j], day = P[j + 1] - Pp[j + 1], daz = P[j + 2] - Pp[j + 2];
    let dbx = 0, dby = 0, dbz = 0;
    for (let q = 0; q < 4; q++) {
      const i = tets[t * 4 + q] * 3, b = bary[q];
      dbx += b * (Q[i] - Qp[i]); dby += b * (Q[i + 1] - Qp[i + 1]); dbz += b * (Q[i + 2] - Qp[i + 2]);
    }
    let tx = dax - dbx, ty = day - dby, tz = daz - dbz;
    const dn = tx * nx + ty * ny + tz * nz;
    tx -= dn * nx; ty -= dn * ny; tz -= dn * nz;
    const tl = Math.sqrt(tx * tx + ty * ty + tz * tz);
    if (tl > 1e-9) {
      const k = Math.min(1, (mu * -depth) / tl) / W;
      P[j] -= tx * k * wa; P[j + 1] -= ty * k * wa; P[j + 2] -= tz * k * wa;
      push(i0, b0, w0, -tx * k, -ty * k, -tz * k);
      push(i1, b1, w1, -tx * k, -ty * k, -tz * k);
      push(i2, b2, w2, -tx * k, -ty * k, -tz * k);
      push(i3, b3, w3, -tx * k, -ty * k, -tz * k);
    }
    hits++;
  }
  return hits;
}
