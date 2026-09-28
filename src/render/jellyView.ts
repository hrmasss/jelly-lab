import * as THREE from 'three';
import { type Palette } from '../engine/shapes.ts';
import { type ShapeMesh } from '../engine/protocol.ts';

/** The page's copy of one jelly: its shape wiring plus the latest node positions from the simulation. */
export interface JellyHandle {
  id: number;
  mesh: ShapeMesh;
  palette: Palette;
  pos: Float32Array;
  aabb: Float32Array;
}

const indexCache = new WeakMap<ShapeMesh, THREE.BufferAttribute>();

/** The visible side of one jelly: a smooth skin that follows the lattice, and an optional lattice overlay. */
export class JellyView {
  readonly body: JellyHandle;
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshPhysicalMaterial>;
  readonly lattice: THREE.LineSegments;
  /** New positions arrived since the last skin update. */
  dirty = true;
  private readonly skinPos: THREE.BufferAttribute;
  private readonly latticePos: THREE.BufferAttribute;
  private readonly normals: THREE.BufferAttribute;

  constructor(body: JellyHandle) {
    this.body = body;
    const { skin, edges } = body.mesh;
    const pal = body.palette;
    const geo = new THREE.BufferGeometry();
    this.skinPos = new THREE.BufferAttribute(new Float32Array(skin.rest.length), 3);
    this.skinPos.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.skinPos);
    this.normals = new THREE.BufferAttribute(new Float32Array(skin.rest.length), 3);
    this.normals.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('normal', this.normals);
    let index = indexCache.get(body.mesh);
    if (!index) { index = new THREE.BufferAttribute(skin.index, 1); indexCache.set(body.mesh, index); }
    geo.setIndex(index);

    const base = new THREE.Color(pal.color);
    const material = new THREE.MeshPhysicalMaterial({
      color: base,
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
    if (pal.top) {
      // Blend to the second colour above topY in the rest shape, so it stays put however the jelly deforms.
      const top = new THREE.Color(pal.top.color);
      const col = new Float32Array(skin.rest.length);
      const c = new THREE.Color();
      for (let v = 0; v < skin.rest.length / 3; v++) {
        const t = THREE.MathUtils.smoothstep(skin.rest[v * 3 + 1], pal.top.y - 0.02, pal.top.y + 0.02);
        c.copy(base).lerp(top, t);
        col[v * 3] = c.r; col[v * 3 + 1] = c.g; col[v * 3 + 2] = c.b;
      }
      geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
      material.vertexColors = true;
      material.color.set('#ffffff');
    }
    this.mesh = new THREE.Mesh(geo, material);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    this.mesh.userData.view = this;

    const lg = new THREE.BufferGeometry();
    this.latticePos = new THREE.BufferAttribute(new Float32Array(body.mesh.n * 3), 3);
    this.latticePos.setUsage(THREE.DynamicDrawUsage);
    lg.setAttribute('position', this.latticePos);
    lg.setIndex(new THREE.BufferAttribute(new Uint32Array(edges), 1));
    this.lattice = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: pal.deep, transparent: true, opacity: 0.55, depthTest: false }));
    this.lattice.frustumCulled = false;
    this.lattice.renderOrder = 2;
    this.lattice.visible = false;
    this.update();
  }

  update() {
    const { pos } = this.body;
    const { tets, skin } = this.body.mesh;
    const out = this.skinPos.array as Float32Array;
    const nv = out.length / 3;
    for (let v = 0; v < nv; v++) {
      const t = skin.tet[v] * 4;
      const a = tets[t] * 3, b = tets[t + 1] * 3, c = tets[t + 2] * 3, d = tets[t + 3] * 3;
      const w0 = skin.bary[v * 4], w1 = skin.bary[v * 4 + 1], w2 = skin.bary[v * 4 + 2], w3 = skin.bary[v * 4 + 3];
      out[v * 3] = w0 * pos[a] + w1 * pos[b] + w2 * pos[c] + w3 * pos[d];
      out[v * 3 + 1] = w0 * pos[a + 1] + w1 * pos[b + 1] + w2 * pos[c + 1] + w3 * pos[d + 1];
      out[v * 3 + 2] = w0 * pos[a + 2] + w1 * pos[b + 2] + w2 * pos[c + 2] + w3 * pos[d + 2];
    }
    this.skinPos.needsUpdate = true;
    this.updateNormals(out);
    if (this.lattice.visible) {
      (this.latticePos.array as Float32Array).set(pos);
      this.latticePos.needsUpdate = true;
    }
  }

  /** Area-weighted vertex normals. Same result as computeVertexNormals, several times faster. */
  private updateNormals(p: Float32Array) {
    const nrm = this.normals.array as Float32Array;
    nrm.fill(0);
    const idx = this.body.mesh.skin.index;
    for (let f = 0; f < idx.length; f += 3) {
      const a = idx[f] * 3, b = idx[f + 1] * 3, c = idx[f + 2] * 3;
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
    this.normals.needsUpdate = true;
  }

  /** Bounds for picking; only needed on pointer down. */
  refreshBounds() {
    this.mesh.geometry.computeBoundingSphere();
    this.mesh.geometry.computeBoundingBox();
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.lattice.geometry.dispose();
    (this.lattice.material as THREE.Material).dispose();
  }
}
