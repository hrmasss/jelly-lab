import * as THREE from 'three';
import { type Palette, type ShapeDef } from '../engine/shapes.ts';
import { type ShapeMesh } from '../engine/protocol.ts';
import { type SkinPart } from '../engine/lattice.ts';

/** The page's copy of one jelly: its shape wiring plus the latest node positions from the simulation. */
export interface JellyHandle {
  id: number;
  shape: ShapeDef;
  mesh: ShapeMesh;
  palette: Palette;
  pos: Float32Array;
  aabb: Float32Array;
}

const indexCache = new WeakMap<SkinPart, THREE.BufferAttribute>();

/** A geometry whose vertices follow the lattice nodes. */
class Skinned {
  readonly geometry = new THREE.BufferGeometry();
  private readonly part: SkinPart;
  private readonly position: THREE.BufferAttribute;
  private readonly normal: THREE.BufferAttribute;

  constructor(part: SkinPart) {
    this.part = part;
    this.position = new THREE.BufferAttribute(new Float32Array(part.rest.length), 3);
    this.normal = new THREE.BufferAttribute(new Float32Array(part.rest.length), 3);
    this.position.setUsage(THREE.DynamicDrawUsage);
    this.normal.setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute('position', this.position);
    this.geometry.setAttribute('normal', this.normal);
    let index = indexCache.get(part);
    if (!index) { index = new THREE.BufferAttribute(part.index, 1); indexCache.set(part, index); }
    this.geometry.setIndex(index);
  }

  update(pos: Float32Array, tets: Int32Array) {
    const { tet, bary, index } = this.part;
    const p = this.position.array as Float32Array;
    for (let v = 0; v < p.length / 3; v++) {
      const t = tet[v] * 4;
      const a = tets[t] * 3, b = tets[t + 1] * 3, c = tets[t + 2] * 3, d = tets[t + 3] * 3;
      const w0 = bary[v * 4], w1 = bary[v * 4 + 1], w2 = bary[v * 4 + 2], w3 = bary[v * 4 + 3];
      p[v * 3] = w0 * pos[a] + w1 * pos[b] + w2 * pos[c] + w3 * pos[d];
      p[v * 3 + 1] = w0 * pos[a + 1] + w1 * pos[b + 1] + w2 * pos[c + 1] + w3 * pos[d + 1];
      p[v * 3 + 2] = w0 * pos[a + 2] + w1 * pos[b + 2] + w2 * pos[c + 2] + w3 * pos[d + 2];
    }
    this.position.needsUpdate = true;
    // Area-weighted vertex normals. Same result as computeVertexNormals, several times faster.
    const nrm = this.normal.array as Float32Array;
    nrm.fill(0);
    for (let f = 0; f < index.length; f += 3) {
      const a = index[f] * 3, b = index[f + 1] * 3, c = index[f + 2] * 3;
      const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
      const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      nrm[a] += nx; nrm[a + 1] += ny; nrm[a + 2] += nz;
      nrm[b] += nx; nrm[b + 1] += ny; nrm[b + 2] += nz;
      nrm[c] += nx; nrm[c + 1] += ny; nrm[c + 2] += nz;
    }
    for (let i = 0; i < nrm.length; i += 3) {
      const l = Math.sqrt(nrm[i] * nrm[i] + nrm[i + 1] * nrm[i + 1] + nrm[i + 2] * nrm[i + 2]) || 1;
      nrm[i] /= l; nrm[i + 1] /= l; nrm[i + 2] /= l;
    }
    this.normal.needsUpdate = true;
  }
}

/** The visible side of one jelly: a smooth skin, any solid bits inside it, and an optional lattice overlay. */
export class JellyView {
  readonly body: JellyHandle;
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshPhysicalMaterial>;
  readonly group = new THREE.Group();
  readonly lattice: THREE.LineSegments;
  /** New positions arrived since the last skin update. */
  dirty = true;
  private readonly skin: Skinned;
  private readonly parts: Skinned[] = [];
  private readonly latticePos: THREE.BufferAttribute;

  constructor(body: JellyHandle) {
    this.body = body;
    const { skin, edges, inclusions } = body.mesh;
    const pal = body.palette;

    this.skin = new Skinned(skin);
    const material = new THREE.MeshPhysicalMaterial({
      color: pal.color,
      roughness: pal.roughness,
      transmission: pal.clarity,
      thickness: 0.5,
      ior: 1.38,
      attenuationColor: new THREE.Color(pal.deep),
      attenuationDistance: 1.1,
      clearcoat: 0.6,
      clearcoatRoughness: 0.22,
      specularIntensity: 0.9,
    });
    if (pal.sheen) {
      material.sheen = 1;
      material.sheenColor = new THREE.Color(pal.sheen);
      material.sheenRoughness = 0.6;
      material.clearcoat = 0.15;
    }
    const paint = body.shape.paint;
    if (paint && skin.masks) {
      // Colour comes from the rest shape, so every stripe and layer stays put however the jelly deforms.
      const ch = paint.channels, masks = skin.masks;
      const col = new Float32Array(skin.rest.length);
      for (let v = 0; v < skin.rest.length / 3; v++) col.set(paint.blend(masks.subarray(v * ch, v * ch + ch), pal), v * 3);
      this.skin.geometry.setAttribute('color', new THREE.BufferAttribute(col, 3));
      material.vertexColors = true;
      material.color.set('#ffffff');
    }
    this.mesh = new THREE.Mesh(this.skin.geometry, material);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    this.mesh.userData.view = this;
    this.group.add(this.mesh);

    for (const inc of inclusions) {
      const part = new Skinned(inc);
      const color = inc.color.startsWith('#') ? inc.color : pal.colors?.[inc.color] ?? pal.deep;
      const m = new THREE.Mesh(part.geometry, new THREE.MeshStandardMaterial({ color, roughness: inc.roughness }));
      m.frustumCulled = false;
      m.castShadow = true;
      this.parts.push(part);
      this.group.add(m);
    }

    const lg = new THREE.BufferGeometry();
    this.latticePos = new THREE.BufferAttribute(new Float32Array(body.mesh.n * 3), 3);
    this.latticePos.setUsage(THREE.DynamicDrawUsage);
    lg.setAttribute('position', this.latticePos);
    lg.setIndex(new THREE.BufferAttribute(new Uint32Array(edges), 1));
    this.lattice = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: pal.deep, transparent: true, opacity: 0.55, depthTest: false }));
    this.lattice.frustumCulled = false;
    this.lattice.renderOrder = 2;
    this.lattice.visible = false;
    this.group.add(this.lattice);
    this.update();
  }

  update() {
    const { pos } = this.body;
    const { tets } = this.body.mesh;
    this.skin.update(pos, tets);
    for (const p of this.parts) p.update(pos, tets);
    if (this.lattice.visible) {
      (this.latticePos.array as Float32Array).set(pos);
      this.latticePos.needsUpdate = true;
    }
  }

  /** Bounds for picking; only needed on pointer down. */
  refreshBounds() {
    this.mesh.geometry.computeBoundingSphere();
    this.mesh.geometry.computeBoundingBox();
  }

  dispose() {
    this.group.traverse((o) => {
      if (o instanceof THREE.Mesh || o instanceof THREE.LineSegments) {
        o.geometry.dispose();
        (o.material as THREE.Material).dispose();
      }
    });
  }
}
