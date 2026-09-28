import {
  type SDF, extrude, sdCappedCone, sdEllipsoid, sdHeart2, sdRoundBox, sdSphere, sdStar2, sdTorus, smax, smin,
} from './sdf.ts';

export interface Palette {
  name: string;
  /** Surface tint. */
  color: string;
  /** Colour light picks up travelling through the body. */
  deep: string;
  /** 0 = opaque, 1 = glass. */
  clarity: number;
  roughness: number;
  /** Optional second colour for the part of the rest shape above topY (caramel on a pudding). */
  top?: { color: string; y: number };
  sheen?: string;
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
}

const bear: SDF = (x, y, z) => {
  const ax = Math.abs(x);
  let d = sdEllipsoid(x, y - 0.55, z, 0.36, 0.42, 0.28);
  d = smin(d, sdEllipsoid(x, y - 1.08, z, 0.33, 0.29, 0.27), 0.12);
  d = smin(d, sdSphere(ax - 0.22, y - 1.32, z + 0.02, 0.105), 0.06);
  d = smin(d, sdEllipsoid(x, y - 1.0, z - 0.21, 0.14, 0.11, 0.11), 0.06);
  d = smin(d, sdEllipsoid(ax - 0.35, y - 0.7, z - 0.05, 0.13, 0.19, 0.12), 0.08);
  d = smin(d, sdEllipsoid(ax - 0.19, y - 0.17, z - 0.05, 0.15, 0.18, 0.17), 0.08);
  return smax(d, -y, 0.04);
};

const pudding: SDF = (x, y, z) => sdCappedCone(x, y - 0.28, z, 0.2, 0.47, 0.33) - 0.08;

const cube: SDF = (x, y, z) => sdRoundBox(x, y - 0.36, z, 0.36, 0.36, 0.36, 0.09);

const star: SDF = (x, y, z) => extrude(sdStar2(x, -z, 0.62, 0.5), y - 0.17, 0.17, 0.08);

const ring: SDF = (x, y, z) => sdTorus(x, y - 0.21, z, 0.42, 0.21);

const mochi: SDF = (x, y, z) => smax(sdEllipsoid(x, y - 0.27, z, 0.46, 0.33, 0.46), -y, 0.08);

const heart: SDF = (x, y, z) => {
  const s = 0.9;
  return extrude(sdHeart2(x / s, (0.5 - z) / s) * s, y - 0.18, 0.18, 0.08);
};

export const SHAPES: ShapeDef[] = [
  {
    id: 'bear', name: 'Gummy bear', sdf: bear,
    min: [-0.52, 0, -0.34], max: [0.52, 1.44, 0.36], cell: 0.11, skin: 0.022,
    palettes: [
      { name: 'Honey', color: '#f6b24a', deep: '#d86a0c', clarity: 0.78, roughness: 0.26 },
      { name: 'Cherry', color: '#ff5a5f', deep: '#b3001b', clarity: 0.8, roughness: 0.24 },
      { name: 'Lime', color: '#b6e35a', deep: '#3f9a14', clarity: 0.8, roughness: 0.26 },
      { name: 'Grape', color: '#b58cff', deep: '#5a22c9', clarity: 0.78, roughness: 0.26 },
    ],
  },
  {
    id: 'pudding', name: 'Pudding', sdf: pudding,
    min: [-0.56, 0, -0.56], max: [0.56, 0.57, 0.56], cell: 0.13, skin: 0.022,
    palettes: [
      { name: 'Custard', color: '#ffe08a', deep: '#e6a31c', clarity: 0.35, roughness: 0.3, top: { color: '#9a4a12', y: 0.43 } },
      { name: 'Matcha', color: '#c9e59a', deep: '#6f9a2e', clarity: 0.3, roughness: 0.32, top: { color: '#3d5a18', y: 0.43 } },
    ],
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
