import {
  type SDF, extrude, sdCappedCone, sdEllipsoid, sdHeart2, sdPie2, sdRoundBox, sdStar2, sdTorus, smax,
} from './sdf.ts';
import { type PartMesh, type RGB, ellipsoidMesh, lin, merge, mix, rng, smoothstep } from './parts.ts';
import { bear024, octopus, pineapple } from './originals.ts';

export interface Palette {
  name: string;
  /** Surface tint. */
  color: string;
  /** Colour light picks up travelling through the body. */
  deep: string;
  /** 0 = opaque, 1 = glass. */
  clarity: number;
  roughness: number;
  sheen?: string;
  /** Extra named colours a shape's paint function or inclusions use. */
  colors?: Record<string, string>;
}

export interface Inclusion extends PartMesh {
  /** A key into the palette's colors, or a literal '#rrggbb'. */
  color: string;
  roughness: number;
}

export interface ShapeDef {
  id: string;
  name: string;
  /** Rest shape in local coordinates, resting on y = 0. */
  sdf: SDF;
  min: [number, number, number];
  max: [number, number, number];
  /** Physics lattice spacing. Smaller = more detail, slower. */
  cell: number;
  /** Render surface grid spacing. */
  skin: number;
  palettes: Palette[];
  /** Colour by rest-shape position. Omitted means the plain palette colour. */
  paint?: Paint;
  /** Solid bits carried inside the jelly. */
  inclusions?: () => Inclusion[];
  /** Turn added when dropped, in radians about +y. The shape's +z otherwise faces the camera. */
  facing?: number;
}

/**
 * Paint in two halves. `masks` is the slow part (noise, distances), run once per shape in the worker.
 * `blend` turns one vertex's masks into a colour for a palette, cheap enough to run on the page per jelly.
 */
export interface Paint {
  channels: number;
  masks: (x: number, y: number, z: number, grad: (x: number, y: number, z: number, out: number[]) => void) => number[];
  blend: (m: ArrayLike<number>, p: Palette) => RGB;
}

export const col = (p: Palette, key: string) => lin(p.colors?.[key] ?? p.color);

const pudding: SDF = (x, y, z) => sdCappedCone(x, y - 0.28, z, 0.2, 0.47, 0.33) - 0.08;

const cube: SDF = (x, y, z) => sdRoundBox(x, y - 0.36, z, 0.36, 0.36, 0.36, 0.09);

const star: SDF = (x, y, z) => extrude(sdStar2(x, -z, 0.62, 0.5), y - 0.17, 0.17, 0.08);

const ring: SDF = (x, y, z) => sdTorus(x, y - 0.21, z, 0.42, 0.21);

const mochi: SDF = (x, y, z) => smax(sdEllipsoid(x, y - 0.27, z, 0.46, 0.33, 0.46), -y, 0.08);

const heart: SDF = (x, y, z) => {
  const s = 0.9;
  return extrude(sdHeart2(x / s, (0.5 - z) / s) * s, y - 0.18, 0.18, 0.08);
};

// Watermelon wedge: a rounded pie slice lying flat, rind toward +z. Proportions from the Melon Jelly original.
const MELON = { a: (32 * Math.PI) / 180, Ri: 1.134, rho: 0.119, T: 0.406, bevel: 0.091, skin: 0.053, pale: 0.175, shift: 0.57 };
const MELON_RO = MELON.Ri + MELON.rho;

const melon: SDF = (x, y, z) => extrude(sdPie2(x, z + MELON.shift, MELON.a, MELON.Ri) - MELON.rho, y - MELON.T / 2, MELON.T / 2, MELON.bevel);

/** Green striped rind, a pale band inside it, then flesh, all by depth in from the rind. */
const paintMelon: Paint = {
  channels: 3,
  masks: (x, y, z) => {
    const w = z + MELON.shift;
    const depth = MELON_RO - Math.sqrt(x * x + w * w);
    const th = Math.atan2(x, w);
    return [
      smoothstep(-0.05, 0.35, Math.sin(th * 34 + Math.sin(th * 9 + y * 5) * 1.6)),
      // Wider than the rind edge really is, so the change spans a few skin vertices instead of zigzagging.
      smoothstep(MELON.skin - 0.014, MELON.skin + 0.012, depth),
      smoothstep(MELON.pale - 0.035, MELON.pale + 0.02, depth),
    ];
  },
  blend: (m, p) => mix(mix(mix(col(p, 'skin'), col(p, 'stripe'), m[0]), col(p, 'pale'), m[1]), lin(p.color), m[2]),
};

/** Rows of teardrop seeds just under both faces, wide end out, plus two floating deep inside. */
function melonSeeds(): Inclusion[] {
  const R = rng(9);
  const rows = [{ r: 0.32, n: 2 }, { r: 0.48, n: 3 }, { r: 0.63, n: 4 }, { r: 0.78, n: 5 }, { r: 0.93, n: 5 }];
  const parts: PartMesh[] = [];
  const seed = (r: number, th: number, y: number, s: number) => {
    const a: RGB = [Math.sin(th), 0, Math.cos(th)], b: RGB = [Math.cos(th), 0, -Math.sin(th)];
    const c: RGB = [a[0] * r, y, a[2] * r - MELON.shift];
    parts.push(ellipsoidMesh(c, a, b, 0.053 * s, 0.031 * s, 0.015 * s, 0.55, 8));
  };
  for (const face of [1, -1]) {
    for (const row of rows) {
      const maxTh = MELON.a - 0.133 / row.r - 0.02;
      for (let i = 0; i < row.n; i++) {
        const t = row.n === 1 ? 0 : (i / (row.n - 1)) * 2 - 1;
        const th = t * maxTh * 0.88 + (R() - 0.5) * 0.06 + (face < 0 ? 0.05 : 0);
        seed(row.r + (R() - 0.5) * 0.056, th, face > 0 ? MELON.T - 0.05 : 0.05, 0.85 + R() * 0.3);
      }
    }
  }
  seed(0.63, 0.12, MELON.T * 0.45, 0.9);
  seed(0.78, -0.2, MELON.T * 0.55, 0.8);
  return [{ ...merge(parts), color: 'seed', roughness: 0.35 }];
}

export const SHAPES: ShapeDef[] = [
  bear024,
  {
    id: 'melon', name: 'Watermelon', sdf: melon,
    min: [-0.74, 0, -0.7], max: [0.74, 0.41, 0.7], cell: 0.12, skin: 0.018,
    paint: paintMelon, inclusions: melonSeeds,
    palettes: [
      { name: 'Crimson', color: '#f74b5d', deep: '#ad2435', clarity: 0.72, roughness: 0.16, colors: { pale: '#e7efce', skin: '#306535', stripe: '#103419', seed: '#191310' } },
      { name: 'Golden', color: '#fcbf3f', deep: '#cb861d', clarity: 0.72, roughness: 0.16, colors: { pale: '#ecf1d1', skin: '#386c30', stripe: '#143819', seed: '#1d1610' } },
      { name: 'Rosé', color: '#f97c95', deep: '#cb506c', clarity: 0.72, roughness: 0.16, colors: { pale: '#ecf3dd', skin: '#457c59', stripe: '#1d4530', seed: '#1f1814' } },
    ],
  },
  pineapple,
  octopus,
  {
    id: 'pudding', name: 'Pudding', sdf: pudding,
    min: [-0.56, 0, -0.56], max: [0.56, 0.57, 0.56], cell: 0.13, skin: 0.022,
    palettes: [
      { name: 'Custard', color: '#ffe08a', deep: '#e6a31c', clarity: 0.35, roughness: 0.3, colors: { top: '#9a4a12' } },
      { name: 'Matcha', color: '#c9e59a', deep: '#6f9a2e', clarity: 0.3, roughness: 0.32, colors: { top: '#3d5a18' } },
    ],
    // Caramel above y = 0.43 in the rest shape, so it stays on top however the pudding wobbles.
    paint: { channels: 1, masks: (_x, y) => [smoothstep(0.41, 0.45, y)], blend: (m, p) => mix(lin(p.color), col(p, 'top'), m[0]) },
  },
  {
    id: 'cube', name: 'Jelly cube', sdf: cube,
    min: [-0.37, 0, -0.37], max: [0.37, 0.73, 0.37], cell: 0.13, skin: 0.02,
    palettes: [
      { name: 'Melon', color: '#9ef0b0', deep: '#1f9e5a', clarity: 0.86, roughness: 0.14 },
      { name: 'Berry', color: '#ff8fb8', deep: '#d4145a', clarity: 0.86, roughness: 0.14 },
      { name: 'Blue', color: '#8fd3ff', deep: '#1466d4', clarity: 0.88, roughness: 0.12 },
    ],
  },
  {
    id: 'star', name: 'Star', sdf: star,
    min: [-0.62, 0, -0.62], max: [0.62, 0.35, 0.62], cell: 0.1, skin: 0.018,
    palettes: [
      { name: 'Lemon', color: '#ffe45c', deep: '#e0a800', clarity: 0.8, roughness: 0.18 },
      { name: 'Peach', color: '#ffb88a', deep: '#e05a1c', clarity: 0.8, roughness: 0.2 },
    ],
  },
  {
    id: 'ring', name: 'Ring', sdf: ring,
    min: [-0.64, 0, -0.64], max: [0.64, 0.43, 0.64], cell: 0.12, skin: 0.02,
    palettes: [
      { name: 'Mint', color: '#9ff5e0', deep: '#0f9e84', clarity: 0.85, roughness: 0.16 },
      { name: 'Rose', color: '#ffb0c8', deep: '#e0346a', clarity: 0.82, roughness: 0.18 },
    ],
  },
  {
    id: 'mochi', name: 'Mochi', sdf: mochi,
    min: [-0.47, 0, -0.47], max: [0.47, 0.61, 0.47], cell: 0.13, skin: 0.022,
    palettes: [
      { name: 'Sakura', color: '#ffd6e2', deep: '#f08aa8', clarity: 0.12, roughness: 0.55, sheen: '#ffffff' },
      { name: 'Snow', color: '#f7f4ee', deep: '#d9d0c0', clarity: 0.08, roughness: 0.6, sheen: '#ffffff' },
      { name: 'Yomogi', color: '#cfe3b0', deep: '#7fa35a', clarity: 0.1, roughness: 0.55, sheen: '#ffffff' },
    ],
  },
  {
    id: 'heart', name: 'Heart', sdf: heart,
    min: [-0.58, 0, -0.54], max: [0.58, 0.37, 0.52], cell: 0.1, skin: 0.018,
    palettes: [
      { name: 'Strawberry', color: '#ff6b81', deep: '#c2002f', clarity: 0.8, roughness: 0.2 },
      { name: 'Plum', color: '#d98cff', deep: '#8a1fc9', clarity: 0.8, roughness: 0.2 },
    ],
  },
];
