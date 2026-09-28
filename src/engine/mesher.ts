import { type SDF, sdfGrad } from './sdf.ts';
import { type Field } from './field.ts';

export interface SurfaceMesh {
  positions: Float32Array;
  indices: Uint32Array;
}

// Cube corner c = x | y << 1 | z << 2. The 12 edges, as corner pairs.
const EDGES = [
  [0, 1], [2, 3], [4, 5], [6, 7],
  [0, 2], [1, 3], [4, 6], [5, 7],
  [0, 4], [1, 5], [2, 6], [3, 7],
];

/**
 * Naive surface nets over a baked distance grid. Vertices are then snapped onto the surface of `project`
 * (the shape's own formula when it is cheap, the baked grid when it is not), so the mesh is smooth even at coarse steps.
 */
export function surfaceNets(field: Field, project: SDF): SurfaceMesh {
  const { o, step, v: vals } = field;
  const [nx, ny, nz] = field.n;
  const sdf = project;

  const cx = nx - 1, cy = ny - 1, cz = nz - 1;
  const cellVert = new Int32Array(cx * cy * cz).fill(-1);
  const pos: number[] = [];
  const corner = new Float32Array(8);
  const g = new Float64Array(3);

  for (let k = 0; k < cz; k++)
    for (let j = 0; j < cy; j++)
      for (let i = 0; i < cx; i++) {
        let mask = 0;
        for (let c = 0; c < 8; c++) {
          const v = vals[(i + (c & 1)) + nx * ((j + ((c >> 1) & 1)) + ny * (k + ((c >> 2) & 1)))];
          corner[c] = v;
          if (v < 0) mask |= 1 << c;
        }
        if (mask === 0 || mask === 255) continue;
        let sx = 0, sy = 0, sz = 0, cnt = 0;
        for (const [a, b] of EDGES) {
          const va = corner[a], vb = corner[b];
          if (va < 0 === vb < 0) continue;
          const t = va / (va - vb);
          sx += (a & 1) + t * ((b & 1) - (a & 1));
          sy += ((a >> 1) & 1) + t * (((b >> 1) & 1) - ((a >> 1) & 1));
          sz += ((a >> 2) & 1) + t * (((b >> 2) & 1) - ((a >> 2) & 1));
          cnt++;
        }
        let x = o[0] + (i + sx / cnt) * step;
        let y = o[1] + (j + sy / cnt) * step;
        let z = o[2] + (k + sz / cnt) * step;
        for (let it = 0; it < 3; it++) {
          const d = sdf(x, y, z);
          sdfGrad(sdf, x, y, z, g, step * 0.05);
          x -= d * g[0]; y -= d * g[1]; z -= d * g[2];
        }
        cellVert[i + cx * (j + cy * k)] = pos.length / 3;
        pos.push(x, y, z);
      }

  const idx: number[] = [];
  const cell = (i: number, j: number, k: number) => cellVert[i + cx * (j + cy * k)];
  const dist2 = (a: number, b: number) => {
    const dx = pos[a * 3] - pos[b * 3], dy = pos[a * 3 + 1] - pos[b * 3 + 1], dz = pos[a * 3 + 2] - pos[b * 3 + 2];
    return dx * dx + dy * dy + dz * dz;
  };
  for (let a = 0; a < 3; a++) {
    const b = (a + 1) % 3, c = (a + 2) % 3;
    for (let k = 1; k < nz - 1; k++)
      for (let j = 1; j < ny - 1; j++)
        for (let i = 1; i < nx - 1; i++) {
          const v0 = vals[i + nx * (j + ny * k)];
          const q = [i, j, k];
          q[a]++;
          const v1 = vals[q[0] + nx * (q[1] + ny * q[2])];
          if (v0 < 0 === v1 < 0) continue;
          const at = (db: number, dc: number) => {
            const r = [i, j, k];
            r[b] -= db; r[c] -= dc;
            return cell(r[0], r[1], r[2]);
          };
          // Counter-clockwise around +a, so the face normal points +a when the inside is at the low end.
          const q0 = at(1, 1), q1 = at(0, 1), q2 = at(0, 0), q3 = at(1, 0);
          if (q0 < 0 || q1 < 0 || q2 < 0 || q3 < 0) continue;
          const quad = v0 < 0 ? [q0, q1, q2, q3] : [q0, q3, q2, q1];
          if (dist2(quad[0], quad[2]) <= dist2(quad[1], quad[3])) {
            idx.push(quad[0], quad[1], quad[2], quad[0], quad[2], quad[3]);
          } else {
            idx.push(quad[0], quad[1], quad[3], quad[1], quad[2], quad[3]);
          }
        }
  }
  return { positions: new Float32Array(pos), indices: new Uint32Array(idx) };
}
