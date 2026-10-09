import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

const geometryCache = new Map<string, THREE.BufferGeometry>();

function cachedGeometry(key: string, make: () => THREE.BufferGeometry) {
  let geometry = geometryCache.get(key);
  if (!geometry) {
    geometry = make();
    geometryCache.set(key, geometry);
  }
  return geometry;
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;

export function roundedBoxGeo(w: number, h: number, d: number, radius = 0.05, segments = 3) {
  const rr = Math.min(radius, w / 2 - 0.001, h / 2 - 0.001, d / 2 - 0.001);
  return cachedGeometry(`rb:${r3(w)}:${r3(h)}:${r3(d)}:${r3(rr)}:${segments}`, () => new RoundedBoxGeometry(w, h, d, segments, rr));
}

export function boxGeo(w: number, h: number, d: number) {
  return cachedGeometry(`b:${r3(w)}:${r3(h)}:${r3(d)}`, () => new THREE.BoxGeometry(w, h, d));
}

export function cylGeo(rTop: number, rBottom: number, h: number, segments = 16) {
  return cachedGeometry(`c:${r3(rTop)}:${r3(rBottom)}:${r3(h)}:${segments}`, () => new THREE.CylinderGeometry(rTop, rBottom, h, segments));
}

export function sphereGeo(r: number, w = 18, h = 14) {
  return cachedGeometry(`s:${r3(r)}:${w}:${h}`, () => new THREE.SphereGeometry(r, w, h));
}

export interface MatOptions {
  roughness?: number;
  metalness?: number;
  map?: THREE.Texture | null;
  emissive?: THREE.ColorRepresentation;
  emissiveIntensity?: number;
  emissiveMap?: THREE.Texture | null;
  transparent?: boolean;
  opacity?: number;
  side?: THREE.Side;
  flatShading?: boolean;
}

export function std(color: THREE.ColorRepresentation, options: MatOptions = {}) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: options.roughness ?? 0.7,
    metalness: options.metalness ?? 0,
    map: options.map ?? null,
    emissive: options.emissive ?? 0x000000,
    emissiveIntensity: options.emissiveIntensity ?? 1,
    emissiveMap: options.emissiveMap ?? null,
    transparent: options.transparent ?? false,
    opacity: options.opacity ?? 1,
    side: options.side ?? THREE.FrontSide,
    flatShading: options.flatShading ?? false,
  });
}

export function fabric(color: THREE.ColorRepresentation, map: THREE.Texture | null, sheen = 0.6) {
  const c = new THREE.Color(color);
  return new THREE.MeshPhysicalMaterial({
    color: c,
    map,
    roughness: 0.85,
    sheen,
    sheenRoughness: 0.55,
    sheenColor: c.clone().lerp(new THREE.Color(0xffffff), 0.45),
  });
}

export function glossy(color: THREE.ColorRepresentation, options: { roughness?: number; clearcoat?: number; map?: THREE.Texture | null; metalness?: number } = {}) {
  return new THREE.MeshPhysicalMaterial({
    color,
    map: options.map ?? null,
    roughness: options.roughness ?? 0.4,
    metalness: options.metalness ?? 0,
    clearcoat: options.clearcoat ?? 0.6,
    clearcoatRoughness: 0.2,
  });
}

export const shared = {
  darkWood: std(0x4a2e1c, { roughness: 0.55 }),
  midWood: std(0x8a5a34, { roughness: 0.5 }),
  lightWood: std(0xc9955f, { roughness: 0.55 }),
  white: std(0xf4efe6, { roughness: 0.5 }),
  trim: std(0xfaf5ea, { roughness: 0.45 }),
  black: std(0x1c1b1f, { roughness: 0.4 }),
  chrome: new THREE.MeshStandardMaterial({ color: 0xdedede, metalness: 1, roughness: 0.18 }),
  gold: new THREE.MeshStandardMaterial({ color: 0xd9a93a, metalness: 1, roughness: 0.28 }),
  brass: new THREE.MeshStandardMaterial({ color: 0xb8862b, metalness: 0.9, roughness: 0.35 }),
  steel: new THREE.MeshStandardMaterial({ color: 0x9aa3ab, metalness: 0.8, roughness: 0.35 }),
  bun: std(0xe2a65a, { roughness: 0.6 }),
  bunTop: std(0xb86a2c, { roughness: 0.5 }),
  leaf: std(0x3f8f3a, { roughness: 0.6, side: THREE.DoubleSide }),
  leafDark: std(0x2c6b2c, { roughness: 0.6, side: THREE.DoubleSide }),
  terracotta: std(0xc0643a, { roughness: 0.75 }),
  lampShade: std(0xfff1cf, { roughness: 0.8, emissive: 0xffc27a, emissiveIntensity: 0.9, side: THREE.DoubleSide }),
};

export function mesh(
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  x = 0,
  y = 0,
  z = 0,
  options: { rx?: number; ry?: number; rz?: number; cast?: boolean; receive?: boolean; parent?: THREE.Object3D; name?: string } = {},
) {
  const m = new THREE.Mesh(geometry, material);
  m.position.set(x, y, z);
  m.rotation.set(options.rx ?? 0, options.ry ?? 0, options.rz ?? 0);
  m.castShadow = options.cast ?? true;
  m.receiveShadow = options.receive ?? true;
  if (options.name) m.name = options.name;
  options.parent?.add(m);
  return m;
}

/** A hotdog bun: two toasted halves with a slit. */
export function makeBun(scale = 1) {
  const group = new THREE.Group();
  const half = cachedGeometry('bun-half', () => {
    const g = new THREE.CapsuleGeometry(0.06, 0.24, 6, 12);
    g.rotateZ(Math.PI / 2);
    return g;
  });
  for (const side of [-1, 1]) {
    const m = mesh(half, shared.bun, 0, 0, side * 0.045);
    m.scale.set(1, 0.85, 0.9);
    group.add(m);
    const top = mesh(half, shared.bunTop, 0, 0.012, side * 0.05);
    top.scale.set(0.96, 0.8, 0.82);
    group.add(top);
  }
  group.scale.setScalar(scale);
  return group;
}

const blobMaterials = new Map<string, THREE.MeshBasicMaterial>();

export function blobShadow(texture: THREE.Texture, w: number, d: number, opacity = 0.6) {
  const key = `${texture.uuid}:${opacity.toFixed(2)}`;
  let material = blobMaterials.get(key);
  if (!material) {
    material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, opacity, depthWrite: false, color: 0x000000 });
    blobMaterials.set(key, material);
  }
  const m = new THREE.Mesh(
    cachedGeometry('blob-plane', () => {
      const g = new THREE.PlaneGeometry(1, 1);
      g.rotateX(-Math.PI / 2);
      return g;
    }),
    material,
  );
  m.scale.set(w, 1, d);
  m.position.y = 0.006;
  m.renderOrder = 1;
  m.castShadow = false;
  m.receiveShadow = false;
  return m;
}

/** Scales a geometry's UVs so a repeating texture keeps a constant world size. */
export function scaleUVs(geometry: THREE.BufferGeometry, su: number, sv: number) {
  const uv = geometry.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i += 1) {
    uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
  }
  uv.needsUpdate = true;
  return geometry;
}
