import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** Merges the static meshes directly under each animated pivot of a character rig. */
export function mergeRig(pivots: THREE.Object3D[]) {
  const isPivot = (o: THREE.Object3D) => !(o as THREE.Mesh).isMesh;
  for (const pivot of pivots) mergeStatic(pivot, isPivot);
}

/** Marks an object (and its subtree) as something that must stay a separate draw. */
export function keepSeparate(object: THREE.Object3D) {
  object.userData.noMerge = true;
  return object;
}

function materialKey(m: THREE.Material): string | null {
  if (m.userData.unique || m.userData.occluderOwner) return null;
  const parts: unknown[] = [m.type, m.transparent, m.opacity, m.side, m.depthWrite, m.alphaTest, m.blending, m.toneMapped, m.polygonOffset];
  const any = m as THREE.Material & Record<string, unknown>;
  for (const key of [
    'color',
    'emissive',
    'sheenColor',
  ]) {
    const c = any[key] as THREE.Color | undefined;
    if (c && (c as THREE.Color).isColor) parts.push(c.getHexString());
  }
  for (const key of [
    'roughness',
    'metalness',
    'emissiveIntensity',
    'flatShading',
    'sheen',
    'sheenRoughness',
    'clearcoat',
    'clearcoatRoughness',
    'transmission',
    'vertexColors',
  ]) {
    if (key in any) parts.push(any[key]);
  }
  for (const key of ['map', 'emissiveMap', 'normalMap', 'roughnessMap', 'alphaMap']) {
    const t = any[key] as THREE.Texture | null | undefined;
    parts.push(t ? t.uuid : '-');
  }
  return parts.join('|');
}

/** Replaces identical-looking materials with a single shared instance. */
export function dedupeMaterials(root: THREE.Object3D, skip: (o: THREE.Object3D) => boolean) {
  const byKey = new Map<string, THREE.Material>();
  const visit = (o: THREE.Object3D) => {
    if (o !== root && skip(o)) return;
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh && !(o as THREE.InstancedMesh).isInstancedMesh && !Array.isArray(mesh.material)) {
      const key = materialKey(mesh.material);
      if (key) {
        const existing = byKey.get(key);
        if (existing) mesh.material = existing;
        else byKey.set(key, mesh.material);
      }
    }
    for (const child of o.children) visit(child);
  };
  visit(root);
}

function normalizeGeometry(geometry: THREE.BufferGeometry) {
  for (const name of Object.keys(geometry.attributes)) {
    if (name !== 'position' && name !== 'normal' && name !== 'uv') geometry.deleteAttribute(name);
  }
  geometry.morphAttributes = {};
  const count = geometry.getAttribute('position').count;
  if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();
  if (!geometry.getAttribute('uv')) geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(count * 2), 2));
  if (!geometry.index) {
    const index = new (count > 65535 ? Uint32Array : Uint16Array)(count);
    for (let i = 0; i < count; i += 1) index[i] = i;
    geometry.setIndex(new THREE.BufferAttribute(index, 1));
  }
  geometry.clearGroups();
  return geometry;
}

/**
 * Merges static meshes under `root` that share a material into single meshes.
 * Subtrees for which `skip` returns true (and objects marked keepSeparate) are left alone.
 */
export function mergeStatic(root: THREE.Object3D, skip: (o: THREE.Object3D) => boolean = () => false) {
  root.updateMatrixWorld(true);
  const inverseRoot = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const groups = new Map<string, THREE.Mesh[]>();

  const visit = (o: THREE.Object3D) => {
    if (o !== root && (o.userData.noMerge || skip(o))) return;
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh && !(o as THREE.InstancedMesh).isInstancedMesh && !Array.isArray(mesh.material) && mesh.visible) {
      const key = `${mesh.material.uuid}|${mesh.castShadow}|${mesh.receiveShadow}|${mesh.renderOrder}`;
      const list = groups.get(key);
      if (list) list.push(mesh);
      else groups.set(key, [mesh]);
    }
    for (const child of [...o.children]) visit(child);
  };
  visit(root);

  let removed = 0;
  for (const meshes of groups.values()) {
    if (meshes.length < 2) continue;
    const geometries: THREE.BufferGeometry[] = [];
    for (const mesh of meshes) {
      const matrix = new THREE.Matrix4().multiplyMatrices(inverseRoot, mesh.matrixWorld);
      const g = normalizeGeometry(mesh.geometry.clone());
      g.applyMatrix4(matrix);
      geometries.push(g);
    }
    const merged = mergeGeometries(geometries, false);
    for (const g of geometries) g.dispose();
    if (!merged) continue;
    const first = meshes[0];
    const batch = new THREE.Mesh(merged, first.material);
    batch.castShadow = first.castShadow;
    batch.receiveShadow = first.receiveShadow;
    batch.renderOrder = first.renderOrder;
    batch.name = 'batch';
    root.add(batch);
    for (const mesh of meshes) mesh.removeFromParent();
    removed += meshes.length - 1;
  }
  return removed;
}
