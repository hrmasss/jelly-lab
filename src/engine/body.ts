import { type Palette } from './shapes.ts';
import { type Topology } from './lattice.ts';

let nextId = 1;

/** One jelly. Shares its topology with every other copy of the same shape. */
export class SoftBody {
  readonly id = nextId++;
  readonly topo: Topology;
  readonly n: number;
  readonly palette: Palette;
  readonly pos: Float64Array;
  readonly prev: Float64Array;
  readonly vel: Float64Array;
  readonly invMass: Float64Array;
  /** min xyz, max xyz. */
  readonly aabb = new Float64Array(6);
  /** Best rigid fit of the current pose: centre of mass and rotation (row-major). Used to guess rest coordinates. */
  readonly com = new Float64Array(3);
  readonly rot = new Float64Array(9);
  /** Each node's offset to the true surface, turned by rot. The surface point is pos - surf. */
  readonly surf: Float64Array;
  private q = [0, 0, 0, 1];

  constructor(topo: Topology, palette: Palette, x: number, y: number, z: number, yaw: number) {
    this.topo = topo;
    this.n = topo.n;
    this.palette = palette;
    this.pos = new Float64Array(this.n * 3);
    this.prev = new Float64Array(this.n * 3);
    this.vel = new Float64Array(this.n * 3);
    this.invMass = new Float64Array(this.n);
    this.surf = new Float64Array(this.n * 3);
    for (let i = 0; i < this.n; i++) this.invMass[i] = topo.mass[i] > 0 ? 1 / topo.mass[i] : 0;
    this.place(x, y, z, yaw);
  }

  /** Put the body back in its rest shape, rest centre at (x, _, z), bottom at y, turned by yaw about +y. */
  place(x: number, y: number, z: number, yaw: number) {
    const { rest, restCom } = this.topo;
    const c = Math.cos(yaw), s = Math.sin(yaw);
    for (let i = 0; i < this.n; i++) {
      const rx = rest[i * 3] - restCom[0], rz = rest[i * 3 + 2] - restCom[2];
      this.pos[i * 3] = x + c * rx + s * rz;
      this.pos[i * 3 + 1] = y + rest[i * 3 + 1];
      this.pos[i * 3 + 2] = z - s * rx + c * rz;
    }
    this.prev.set(this.pos);
    this.vel.fill(0);
    this.q = [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)];
    // Rest bottom sits on y; with the lattice reaching past the surface, lift by the lowest surface point instead.
    let low = Infinity;
    for (let i = 0; i < this.n; i++) low = Math.min(low, rest[i * 3 + 1] - this.topo.surfOffset[i * 3 + 1]);
    for (let i = 0; i < this.n; i++) this.pos[i * 3 + 1] -= low;
    this.prev.set(this.pos);
    this.updateFrame();
    this.updateAabb();
  }

  predict(dt: number, gx: number, gy: number, gz: number) {
    const { pos, prev, vel, invMass } = this;
    for (let i = 0; i < this.n; i++) {
      const j = i * 3;
      prev[j] = pos[j]; prev[j + 1] = pos[j + 1]; prev[j + 2] = pos[j + 2];
      if (invMass[i] === 0) continue;
      vel[j] += gx * dt; vel[j + 1] += gy * dt; vel[j + 2] += gz * dt;
      pos[j] += vel[j] * dt; pos[j + 1] += vel[j + 1] * dt; pos[j + 2] += vel[j + 2] * dt;
    }
  }

  solveEdges(alpha: number) {
    const { pos, invMass } = this;
    const { edges, restLen } = this.topo;
    for (let e = 0; e < restLen.length; e++) {
      const a = edges[e * 2], b = edges[e * 2 + 1];
      const i = a * 3, j = b * 3;
      const w0 = invMass[a], w1 = invMass[b];
      const w = w0 + w1;
      if (w === 0) continue;
      const dx = pos[i] - pos[j], dy = pos[i + 1] - pos[j + 1], dz = pos[i + 2] - pos[j + 2];
      const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (len < 1e-9) continue;
      const s = -(len - restLen[e]) / (w + alpha) / len;
      pos[i] += dx * s * w0; pos[i + 1] += dy * s * w0; pos[i + 2] += dz * s * w0;
      pos[j] -= dx * s * w1; pos[j + 1] -= dy * s * w1; pos[j + 2] -= dz * s * w1;
    }
  }

  solveVolumes(alpha: number) {
    const { pos, invMass } = this;
    const { tets, restVol } = this.topo;
    for (let t = 0; t < restVol.length; t++) {
      const ta = tets[t * 4], tb = tets[t * 4 + 1], tc = tets[t * 4 + 2], td = tets[t * 4 + 3];
      const a = ta * 3, b = tb * 3, c = tc * 3, d = td * 3;
      const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
      const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
      const qx = pos[d] - pos[a], qy = pos[d + 1] - pos[a + 1], qz = pos[d + 2] - pos[a + 2];
      // Gradients of V = (u x v) . q / 6 with respect to b, c, d; a takes minus their sum.
      const g1x = (vy * qz - vz * qy) / 6, g1y = (vz * qx - vx * qz) / 6, g1z = (vx * qy - vy * qx) / 6;
      const g2x = (qy * uz - qz * uy) / 6, g2y = (qz * ux - qx * uz) / 6, g2z = (qx * uy - qy * ux) / 6;
      const g3x = (uy * vz - uz * vy) / 6, g3y = (uz * vx - ux * vz) / 6, g3z = (ux * vy - uy * vx) / 6;
      const g0x = -g1x - g2x - g3x, g0y = -g1y - g2y - g3y, g0z = -g1z - g2z - g3z;
      const wa = invMass[ta], wb = invMass[tb], wc = invMass[tc], wd = invMass[td];
      const W = wa * (g0x * g0x + g0y * g0y + g0z * g0z) + wb * (g1x * g1x + g1y * g1y + g1z * g1z)
        + wc * (g2x * g2x + g2y * g2y + g2z * g2z) + wd * (g3x * g3x + g3y * g3y + g3z * g3z);
      if (W < 1e-20) continue;
      const vol = g3x * qx + g3y * qy + g3z * qz;
      const s = -(vol - restVol[t]) / (W + alpha);
      pos[a] += g0x * s * wa; pos[a + 1] += g0y * s * wa; pos[a + 2] += g0z * s * wa;
      pos[b] += g1x * s * wb; pos[b + 1] += g1y * s * wb; pos[b + 2] += g1z * s * wb;
      pos[c] += g2x * s * wc; pos[c + 1] += g2y * s * wc; pos[c + 2] += g2z * s * wc;
      pos[d] += g3x * s * wd; pos[d + 1] += g3y * s * wd; pos[d + 2] += g3z * s * wd;
    }
  }

  /** Floor at y = 0 with friction, round fence of radius R. Both act on the true surface, not the lattice. */
  solveBounds(friction: number, R: number) {
    const { pos, prev, surf } = this;
    for (let i = 0; i < this.n; i++) {
      const j = i * 3;
      const floor = surf[j + 1];
      if (pos[j + 1] < floor) {
        pos[j + 1] = floor;
        pos[j] -= (pos[j] - prev[j]) * friction;
        pos[j + 2] -= (pos[j + 2] - prev[j + 2]) * friction;
      }
      const sx = pos[j] - surf[j], sz = pos[j + 2] - surf[j + 2];
      const r2 = sx * sx + sz * sz;
      if (r2 > R * R) {
        const k = 1 - R / Math.sqrt(r2);
        pos[j] -= sx * k; pos[j + 2] -= sz * k;
      }
    }
  }

  /** New velocities from the substep, then damp stretching along edges only, so free flight is untouched. */
  finish(dt: number, damping: number) {
    const { pos, prev, vel, invMass } = this;
    const inv = 1 / dt;
    const vmax = 25;
    for (let j = 0; j < this.n * 3; j += 3) {
      let vx = (pos[j] - prev[j]) * inv, vy = (pos[j + 1] - prev[j + 1]) * inv, vz = (pos[j + 2] - prev[j + 2]) * inv;
      const v2 = vx * vx + vy * vy + vz * vz;
      if (v2 > vmax * vmax) { const k = vmax / Math.sqrt(v2); vx *= k; vy *= k; vz *= k; }
      vel[j] = vx; vel[j + 1] = vy; vel[j + 2] = vz;
    }
    if (damping <= 0) return;
    const { edges, restLen } = this.topo;
    for (let e = 0; e < restLen.length; e++) {
      const ia = edges[e * 2], ib = edges[e * 2 + 1];
      const i = ia * 3, j = ib * 3;
      const w0 = invMass[ia], w1 = invMass[ib];
      const w = w0 + w1;
      if (w === 0) continue;
      const dx = pos[j] - pos[i], dy = pos[j + 1] - pos[i + 1], dz = pos[j + 2] - pos[i + 2];
      const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (len < 1e-9) continue;
      const nx = dx / len, ny = dy / len, nz = dz / len;
      const dv = (vel[j] - vel[i]) * nx + (vel[j + 1] - vel[i + 1]) * ny + (vel[j + 2] - vel[i + 2]) * nz;
      const k = dv * damping / w;
      vel[i] += nx * k * w0; vel[i + 1] += ny * k * w0; vel[i + 2] += nz * k * w0;
      vel[j] -= nx * k * w1; vel[j + 1] -= ny * k * w1; vel[j + 2] -= nz * k * w1;
    }
  }

  updateAabb() {
    const { pos, aabb } = this;
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    for (let j = 0; j < this.n * 3; j += 3) {
      const x = pos[j], y = pos[j + 1], z = pos[j + 2];
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
      if (z < z0) z0 = z; if (z > z1) z1 = z;
    }
    aabb[0] = x0; aabb[1] = y0; aabb[2] = z0; aabb[3] = x1; aabb[4] = y1; aabb[5] = z1;
  }

  /** Centre of mass plus the rotation closest to the current deformation (Mueller et al. 2016, warm started). */
  updateFrame() {
    const { pos, com, rot } = this;
    const { mass, rest, restCom } = this.topo;
    let cx = 0, cy = 0, cz = 0, mt = 0;
    for (let i = 0; i < this.n; i++) {
      const m = mass[i];
      cx += pos[i * 3] * m; cy += pos[i * 3 + 1] * m; cz += pos[i * 3 + 2] * m; mt += m;
    }
    cx /= mt; cy /= mt; cz /= mt;
    com[0] = cx; com[1] = cy; com[2] = cz;
    // A = sum m (p - c)(X - X0)^T, stored by columns.
    const A = new Float64Array(9);
    for (let i = 0; i < this.n; i++) {
      const m = mass[i];
      const px = (pos[i * 3] - cx) * m, py = (pos[i * 3 + 1] - cy) * m, pz = (pos[i * 3 + 2] - cz) * m;
      const X = rest[i * 3] - restCom[0], Y = rest[i * 3 + 1] - restCom[1], Z = rest[i * 3 + 2] - restCom[2];
      A[0] += px * X; A[1] += py * X; A[2] += pz * X;
      A[3] += px * Y; A[4] += py * Y; A[5] += pz * Y;
      A[6] += px * Z; A[7] += py * Z; A[8] += pz * Z;
    }
    let [x, y, z, w] = this.q;
    for (let it = 0; it < 12; it++) {
      // Columns of R(q).
      const r0 = [1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w)];
      const r1 = [2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w)];
      const r2 = [2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y)];
      const cols = [r0, r1, r2];
      let ox = 0, oy = 0, oz = 0, dot = 0;
      for (let c = 0; c < 3; c++) {
        const r = cols[c], ax = A[c * 3], ay = A[c * 3 + 1], az = A[c * 3 + 2];
        ox += r[1] * az - r[2] * ay; oy += r[2] * ax - r[0] * az; oz += r[0] * ay - r[1] * ax;
        dot += r[0] * ax + r[1] * ay + r[2] * az;
      }
      const inv = 1 / (Math.abs(dot) + 1e-12);
      ox *= inv; oy *= inv; oz *= inv;
      const ang = Math.sqrt(ox * ox + oy * oy + oz * oz);
      if (ang < 1e-9) break;
      const s = Math.sin(ang / 2) / ang, qw = Math.cos(ang / 2);
      const qx = ox * s, qy = oy * s, qz = oz * s;
      // q = dq * q
      const nx = qw * x + qx * w + qy * z - qz * y;
      const ny = qw * y - qx * z + qy * w + qz * x;
      const nz = qw * z + qx * y - qy * x + qz * w;
      const nw = qw * w - qx * x - qy * y - qz * z;
      const l = Math.hypot(nx, ny, nz, nw);
      x = nx / l; y = ny / l; z = nz / l; w = nw / l;
    }
    this.q = [x, y, z, w];
    rot[0] = 1 - 2 * (y * y + z * z); rot[1] = 2 * (x * y - z * w); rot[2] = 2 * (x * z + y * w);
    rot[3] = 2 * (x * y + z * w); rot[4] = 1 - 2 * (x * x + z * z); rot[5] = 2 * (y * z - x * w);
    rot[6] = 2 * (x * z - y * w); rot[7] = 2 * (y * z + x * w); rot[8] = 1 - 2 * (x * x + y * y);
    const o = this.topo.surfOffset, s = this.surf;
    for (let j = 0; j < this.n * 3; j += 3) {
      s[j] = rot[0] * o[j] + rot[1] * o[j + 1] + rot[2] * o[j + 2];
      s[j + 1] = rot[3] * o[j] + rot[4] * o[j + 1] + rot[5] * o[j + 2];
      s[j + 2] = rot[6] * o[j] + rot[7] * o[j + 1] + rot[8] * o[j + 2];
    }
  }

  /** Throw the whole body: linear velocity plus spin about its centre. */
  kick(vx: number, vy: number, vz: number, wx: number, wy: number, wz: number) {
    const { pos, vel, com } = this;
    for (let j = 0; j < this.n * 3; j += 3) {
      const rx = pos[j] - com[0], ry = pos[j + 1] - com[1], rz = pos[j + 2] - com[2];
      vel[j] += vx + wy * rz - wz * ry;
      vel[j + 1] += vy + wz * rx - wx * rz;
      vel[j + 2] += vz + wx * ry - wy * rx;
    }
  }

  isBroken() {
    return !Number.isFinite(this.aabb[0] + this.aabb[4]);
  }
}
