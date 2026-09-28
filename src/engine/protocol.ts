import { type WorldParams } from './world.ts';
import { type SkinPart } from './lattice.ts';

/** What the page needs to draw a shape: its lattice wiring and the skin tied to it. Sent once per shape. */
export interface ShapeMesh {
  shapeId: string;
  n: number;
  cell: number;
  tets: Int32Array;
  edges: Int32Array;
  skin: SkinPart;
  inclusions: (SkinPart & { color: string; roughness: number })[];
}

export type ToSim =
  | { type: 'spawn'; id: number; shapeId: string; palette: number; x: number; y: number; z: number; yaw: number; spin: [number, number, number] }
  | { type: 'remove'; id: number }
  | { type: 'clear' }
  | { type: 'params'; params: Partial<WorldParams> }
  | { type: 'grab'; id: number; point: [number, number, number] }
  | { type: 'drag'; target: [number, number, number] }
  | { type: 'release' }
  | { type: 'nudge' }
  | { type: 'step'; dt: number; substeps: number };

export interface BodyFrame {
  id: number;
  pos: Float32Array;
  aabb: Float32Array;
}

export type FromSim =
  | { type: 'shape'; mesh: ShapeMesh }
  | { type: 'frame'; bodies: BodyFrame[]; contacts: number; ms: number }
  | { type: 'removed'; id: number; reason: 'broken' };
