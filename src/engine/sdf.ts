// Signed distance helpers. Negative inside, positive outside, roughly metric.
// Most formulas follow Inigo Quilez's catalogue (iquilezles.org/articles/distfunctions).

export type SDF = (x: number, y: number, z: number) => number;

const len2 = (x: number, y: number) => Math.sqrt(x * x + y * y);
const len3 = (x: number, y: number, z: number) => Math.sqrt(x * x + y * y + z * z);
const clamp = (x: number, a: number, b: number) => (x < a ? a : x > b ? b : x);

export function sdSphere(x: number, y: number, z: number, r: number) {
  return len3(x, y, z) - r;
}

export function sdEllipsoid(x: number, y: number, z: number, rx: number, ry: number, rz: number) {
  const k0 = len3(x / rx, y / ry, z / rz);
  const k1 = len3(x / (rx * rx), y / (ry * ry), z / (rz * rz));
  return k1 < 1e-9 ? -Math.min(rx, ry, rz) : (k0 * (k0 - 1)) / k1;
}

export function sdRoundBox(x: number, y: number, z: number, bx: number, by: number, bz: number, r: number) {
  const qx = Math.abs(x) - bx + r;
  const qy = Math.abs(y) - by + r;
  const qz = Math.abs(z) - bz + r;
  return len3(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qy, qz), 0) - r;
}

/** Torus lying in the xz plane. */
export function sdTorus(x: number, y: number, z: number, R: number, r: number) {
  return len2(len2(x, z) - R, y) - r;
}

/** Cone frustum along y, from -h (radius r1) to +h (radius r2). */
export function sdCappedCone(x: number, y: number, z: number, h: number, r1: number, r2: number) {
  const qx = len2(x, z);
  const qy = y;
  const k1x = r2, k1y = h;
  const k2x = r2 - r1, k2y = 2 * h;
  const cax = qx - Math.min(qx, qy < 0 ? r1 : r2);
  const cay = Math.abs(qy) - h;
  const t = clamp(((k1x - qx) * k2x + (k1y - qy) * k2y) / (k2x * k2x + k2y * k2y), 0, 1);
  const cbx = qx - k1x + k2x * t;
  const cby = qy - k1y + k2y * t;
  const s = cbx < 0 && cay < 0 ? -1 : 1;
  return s * Math.sqrt(Math.min(cax * cax + cay * cay, cbx * cbx + cby * cby));
}

/** Five point star in 2D. r = outer radius, rf = inner radius factor. */
export function sdStar2(px: number, py: number, r: number, rf: number) {
  const k1x = 0.809016994375, k1y = -0.587785252292;
  const k2x = -k1x, k2y = k1y;
  px = Math.abs(px);
  let d = 2 * Math.max(k1x * px + k1y * py, 0);
  px -= d * k1x; py -= d * k1y;
  d = 2 * Math.max(k2x * px + k2y * py, 0);
  px -= d * k2x; py -= d * k2y;
  px = Math.abs(px);
  py -= r;
  const bax = rf * -k1y - 0, bay = rf * k1x - 1;
  const h = clamp((px * bax + py * bay) / (bax * bax + bay * bay), 0, r);
  return len2(px - bax * h, py - bay * h) * Math.sign(py * bax - px * bay);
}

/** Circular sector ("pie") in 2D: apex at the origin, opening along +y, half angle a, radius r. */
export function sdPie2(px: number, py: number, a: number, r: number) {
  px = Math.abs(px);
  const cx = Math.sin(a), cy = Math.cos(a);
  const l = len2(px, py) - r;
  const d = clamp(px * cx + py * cy, 0, r);
  const m = len2(px - cx * d, py - cy * d);
  const s = Math.sign(cy * px - cx * py) || 1;
  return Math.max(l, m * s);
}

/** Heart in 2D, tip at the origin, lobes up to y ~ 1.1. */
export function sdHeart2(px: number, py: number) {
  px = Math.abs(px);
  if (py + px > 1) return len2(px - 0.25, py - 0.75) - Math.SQRT2 / 4;
  const m = 0.5 * Math.max(px + py, 0);
  return Math.sqrt(Math.min(px * px + (py - 1) * (py - 1), (px - m) * (px - m) + (py - m) * (py - m))) * Math.sign(px - py);
}

/** Extrude a 2D distance along y by half height h, with rounded edges of radius r. */
export function extrude(d2: number, y: number, h: number, r: number) {
  const wx = d2 + r;
  const wy = Math.abs(y) - h + r;
  return Math.min(Math.max(wx, wy), 0) + len2(Math.max(wx, 0), Math.max(wy, 0)) - r;
}

export function smin(a: number, b: number, k: number) {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}

export function smax(a: number, b: number, k: number) {
  return -smin(-a, -b, k);
}

/** Normalised central-difference gradient, written into out. Returns the gradient length before normalising. */
export function sdfGrad(f: SDF, x: number, y: number, z: number, out: Float64Array | number[], eps = 1e-3) {
  const gx = f(x + eps, y, z) - f(x - eps, y, z);
  const gy = f(x, y + eps, z) - f(x, y - eps, z);
  const gz = f(x, y, z + eps) - f(x, y, z - eps);
  const l = len3(gx, gy, gz);
  const inv = l > 1e-12 ? 1 / l : 0;
  out[0] = gx * inv; out[1] = gy * inv; out[2] = gz * inv;
  return l / (2 * eps);
}
