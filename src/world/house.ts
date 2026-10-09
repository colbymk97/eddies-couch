import * as THREE from 'three';
import { Collision, MASK_ALL } from './collision';
import { buildCouch, velvetRopes, type BuiltCouch, type CouchTextures } from './furniture';
import { blobShadow, boxGeo, cylGeo, mesh, roundedBoxGeo, scaleUVs, shared, std } from './kit';
import { dedupeMaterials, mergeStatic } from './batch';
import {
  COUCHES,
  HOUSE,
  MICROWAVE,
  PORTRAITS,
  ROOMS,
  TRASH_CANS,
  WALLS,
  WINDOWS,
  roomAt,
  type CouchDef,
  type FloorKind,
  type WallDef,
  type WindowDef,
} from './layout';
import { PropBuilder, type TvChannel } from './props';
import {
  blobShadowTexture,
  canvasTexture,
  carpetTexture,
  corduroyTexture,
  grassTexture,
  leatherTexture,
  textLabelTexture,
  tileFloorTexture,
  wallpaperTexture,
  weaveTexture,
  woodFloorTexture,
  type WallpaperKind,
} from './textures';
import { TAU, rand } from '../core/util';

export interface Occluder {
  object: THREE.Object3D;
  materials: THREE.Material[];
  box: THREE.Box3;
  opacity: number;
  /** Decorations copy the opacity of the wall they hang on. */
  follow?: Occluder;
}

export interface House {
  collision: Collision;
  couches: { def: CouchDef; built: BuiltCouch }[];
  props: PropBuilder;
  occluders: Occluder[];
  sun: THREE.DirectionalLight;
  lamps: THREE.PointLight[];
  tvLight: THREE.PointLight;
  tv: TvChannel;
  microwave: ReturnType<PropBuilder['microwave']>;
  trashCans: ReturnType<PropBuilder['trashCan']>[];
  update(dt: number, time: number): void;
}

const H = HOUSE.wallHeight;
const T = HOUSE.wallThickness;

export const SUN_DIRECTION = new THREE.Vector3(-0.42, 0.78, 0.46).normalize();

export function buildHouse(scene: THREE.Scene, quality: 'fancy' | 'fast'): House {
  const collision = new Collision();
  const root = new THREE.Group();
  root.name = 'house';
  scene.add(root);
  const shadowTex = blobShadowTexture();

  // ------------------------------------------------------------ sky + yard
  buildSky(scene);
  buildYard(root, shadowTex);

  // ------------------------------------------------------------ floors
  mesh(boxGeo(HOUSE.maxX - HOUSE.minX + 0.6, 0.36, HOUSE.maxZ - HOUSE.minZ + 0.6), std(0x8d8478, { roughness: 0.9 }), 0, -0.18, 0, {
    parent: root,
  });
  const floorMaterials: Record<FloorKind, THREE.Material> = {
    wood: new THREE.MeshPhysicalMaterial({ map: woodFloorTexture(), roughness: 0.42, clearcoat: 0.35, clearcoatRoughness: 0.25 }),
    tile: std(0xffffff, { map: tileFloorTexture(), roughness: 0.28 }),
    carpetDen: std(0xffffff, { map: carpetTexture('#7a5c46', '#b08a6a'), roughness: 1 }),
    carpetBed: std(0xffffff, { map: carpetTexture('#5d6f8f', '#8ea0c0'), roughness: 1 }),
  };
  const floorTile: Record<FloorKind, number> = { wood: 2.6, tile: 2.4, carpetDen: 2, carpetBed: 2 };
  for (const room of ROOMS) {
    const w = room.maxX - room.minX;
    const d = room.maxZ - room.minZ;
    const geo = new THREE.PlaneGeometry(w, d);
    const map = (floorMaterials[room.floor] as THREE.MeshStandardMaterial).map;
    if (map) map.repeat.set(1, 1);
    scaleUVs(geo, w / floorTile[room.floor], d / floorTile[room.floor]);
    mesh(geo, floorMaterials[room.floor], (room.minX + room.maxX) / 2, 0.002, (room.minZ + room.maxZ) / 2, {
      rx: -Math.PI / 2,
      parent: root,
      cast: false,
    });
  }

  // ------------------------------------------------------------ walls
  const wallpapers = new Map<WallpaperKind, THREE.Texture>();
  const wallpaper = (kind: WallpaperKind) => {
    let tex = wallpapers.get(kind);
    if (!tex) {
      tex = wallpaperTexture(kind);
      tex.repeat.set(1, 1);
      wallpapers.set(kind, tex);
    }
    return tex;
  };
  const occluders: Occluder[] = [];
  const exteriorGroups = new Map<string, THREE.Group>();
  const skyTex = windowSkyTexture();

  for (const wall of WALLS) {
    const pieces = solidIntervals(wall);
    for (const [a, b] of pieces) {
      const group = buildWallPiece(wall, a, b, wallpaper);
      root.add(group);
      if (wall.exterior) exteriorGroups.set(exteriorSide(wall), group);
      registerOccluder(occluders, group);
      const mid = (a + b) / 2;
      const len = b - a;
      if (wall.axis === 'x') collision.addBox(mid, wall.at, len, T, { sight: true });
      else collision.addBox(wall.at, mid, T, len, { sight: true });
    }
    for (const [d0, d1] of wall.doors ?? []) {
      const lintel = buildLintel(wall, d0, d1);
      root.add(lintel);
      registerOccluder(occluders, lintel);
    }
  }

  for (const win of WINDOWS) {
    const parent = exteriorGroups.get(win.side);
    if (!parent) continue;
    const w = buildWindow(win, skyTex);
    parent.add(w);
  }
  // Windows were added after the occluders captured materials; refresh them.
  for (const occ of occluders) collectMaterials(occ);

  // ------------------------------------------------------------ couches
  const couchTextures: CouchTextures = {
    weave: weaveTexture(),
    corduroy: corduroyTexture(),
    leather: leatherTexture(),
    shadow: shadowTex,
  };
  const couches = COUCHES.map((def) => {
    const built = buildCouch(def, couchTextures);
    root.add(built.group);
    for (const box of built.boxes) collision.addBox(box.x, box.z, box.w, box.d, { rot: box.rot, mask: MASK_ALL, tag: def.id });
    return { def, built };
  });
  root.add(velvetRopes(4.8, 8.2, 7.25));

  // ------------------------------------------------------------ props
  const props = new PropBuilder(root, collision, shadowTex);
  // Living room.
  const tv = props.tvConsole(7.6, -8.6, 0);
  props.coffeeTable(7.5, -5.35);
  props.rug(7.6, -5.0, 5.4, 3.6, ['#7b2d26', '#e9c46a', '#264653']);
  props.floorLamp(12.3, -0.3);
  props.plant(12.3, -8.3, 1.1);
  props.plant(2.65, -8.35, 0.9);
  props.sideTable(2.7, -5.0);
  props.wallSign(4.45, 1.75, 0.86, Math.PI, ['LIVE · LAUGH · LOUNGE'], '#fdf2e9', '#8e3b5b', 1.6, 0.3);
  props.bunClock(9.6, 1.85, -8.86, 0);
  // Kitchen.
  props.counters(-12.7, -5.6, -8.88, -8.6, -11.2);
  props.fridge(-4.0, -8.43);
  const microwave = props.microwave(MICROWAVE.x, MICROWAVE.z);
  props.diningTable(-8.2, -4.2);
  props.pantry(-12.6, -6.3, -3.0, -12.88);
  // Den.
  props.bookshelf(-5.0, 0.84, 0);
  props.crtTv(-8.7, 4.6, -Math.PI / 2);
  props.rug(-10.2, 4.6, 3.4, 3.0, ['#3d5a40', '#d9b26f', '#8c2f39']);
  props.floorLamp(-12.3, 8.2);
  props.plant(-3.7, 8.3, 1);
  props.crossStitch(-7.0, 1.65, 8.86, Math.PI, ['HOME SWEET', 'COUCH']);
  // Hall.
  props.rug(-0.5, 0, 1.5, 13.5, ['#8c2f39', '#e9c46a', '#2a3b5b']);
  props.sideTable(1.6, 1.3);
  props.playpen(-0.5, 7.3);
  for (const p of PORTRAITS) {
    if (p.wall === 'hallWest') props.portrait(p, -2.86, p.z, Math.PI / 2);
    else props.portrait(p, 1.86, p.z, -Math.PI / 2);
  }
  // Bedroom.
  props.bed(11.35, 5.2);
  props.dresser(4.2, 1.38, 0);
  props.dogBed(3.1, 7.7);
  props.floorLamp(9.3, 8.4);
  props.plant(12.35, 8.35, 1);
  props.rug(6.6, 4.9, 4.2, 3.0, ['#e8eef7', '#7d9cc7', '#c76d7d']);
  props.crossStitch(12.86, 1.7, 5.2, -Math.PI / 2, ['NO PUKING', 'ON THE BED']);

  const trashCans = TRASH_CANS.map(([x, z]) => props.trashCan(x, z));

  for (const occ of props.occluders) {
    const o: Occluder = { object: occ, materials: [], box: new THREE.Box3(), opacity: 1 };
    collectMaterials(o);
    occluders.push(o);
  }

  // ------------------------------------------------------------ lights
  const hemi = new THREE.HemisphereLight(0xcfe0ff, 0x7a5c40, 0.6);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffdcb0, 2.7);
  sun.position.copy(SUN_DIRECTION).multiplyScalar(40);
  sun.castShadow = true;
  const shadowSize = quality === 'fancy' ? 2048 : 1024;
  sun.shadow.mapSize.set(shadowSize, shadowSize);
  sun.shadow.camera.near = 5;
  sun.shadow.camera.far = 90;
  sun.shadow.camera.left = -24;
  sun.shadow.camera.right = 24;
  sun.shadow.camera.top = 22;
  sun.shadow.camera.bottom = -22;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  sun.shadow.radius = 3;
  scene.add(sun);
  scene.add(sun.target);

  const lamps = props.lampLights.map((p) => {
    const light = new THREE.PointLight(0xffb36b, 7, 8, 1.6);
    light.position.copy(p);
    scene.add(light);
    return light;
  });
  const tvLight = new THREE.PointLight(0x9cc4ff, 4, 7, 1.5);
  tvLight.position.set(7.6, 1.3, -7.6);
  scene.add(tvLight);

  // ------------------------------------------------------------ nav
  collision.buildNav(HOUSE.minX, HOUSE.minZ, HOUSE.maxX, HOUSE.maxZ, 0.42);

  root.updateMatrixWorld(true);
  for (const occ of occluders) occ.box.setFromObject(occ.object);
  const walls = [...occluders];
  for (const decor of props.wallDecor) {
    const center = new THREE.Box3().setFromObject(decor).getCenter(new THREE.Vector3());
    const wall = walls.find((w) => w.box.clone().expandByScalar(0.25).containsPoint(center));
    if (!wall) continue;
    const o: Occluder = { object: decor, materials: [], box: new THREE.Box3(), opacity: 1, follow: wall };
    collectMaterials(o);
    occluders.push(o);
  }

  // ------------------------------------------------------------ batching
  // Hundreds of little meshes share a handful of materials; merge them into a few big draws.
  const occluderObjects = new Set(occluders.map((o) => o.object));
  const skip = (o: THREE.Object3D) => occluderObjects.has(o);
  dedupeMaterials(root, skip);
  mergeStatic(root, skip);
  for (const occ of occluders) mergeStatic(occ.object);

  const animated = props.animated;
  return {
    collision,
    couches,
    props,
    occluders,
    sun,
    lamps,
    tvLight,
    tv,
    microwave,
    trashCans,
    update(dt, time) {
      for (const a of animated) a.update(dt, time);
      tvLight.intensity = 3 + Math.sin(time * 13) * 0.6 + Math.sin(time * 5.3) * 0.8;
    },
  };
}

// ---------------------------------------------------------------- walls

function exteriorSide(wall: WallDef): string {
  if (wall.axis === 'x') return wall.at < 0 ? 'north' : 'south';
  return wall.at < 0 ? 'west' : 'east';
}

function solidIntervals(wall: WallDef): [number, number][] {
  const doors = [...(wall.doors ?? [])].sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [];
  let cursor = wall.from;
  for (const [d0, d1] of doors) {
    if (d0 > cursor) out.push([cursor, d0]);
    cursor = d1;
  }
  if (cursor < wall.to) out.push([cursor, wall.to]);
  return out;
}

const coreMaterial = std(0xf2e8d8, { roughness: 0.8 });
const capMaterial = std(0x3b2a20, { roughness: 0.6 });
const exteriorWallpaper = () => wallpaperTexture('exterior');
let exteriorTex: THREE.Texture | undefined;

function buildWallPiece(wall: WallDef, a: number, b: number, wallpaper: (k: WallpaperKind) => THREE.Texture) {
  const group = new THREE.Group();
  const len = b - a;
  const mid = (a + b) / 2;
  const alongX = wall.axis === 'x';
  if (alongX) group.position.set(mid, 0, wall.at);
  else {
    group.position.set(wall.at, 0, mid);
    group.rotation.y = Math.PI / 2;
  }
  // In local space the wall runs along X, with faces at +/- Z.
  mesh(boxGeo(len, H, T), coreMaterial, 0, H / 2, 0, { parent: group });
  mesh(boxGeo(len + 0.02, 0.05, T + 0.05), capMaterial, 0, H + 0.025, 0, { parent: group, cast: false });

  for (const side of [-1, 1]) {
    // Local +Z maps to world +Z (along X) or world +X (along Z, after the +90 rotation).
    const worldOffset = alongX ? new THREE.Vector3(0, 0, side * 0.4) : new THREE.Vector3(side * 0.4, 0, 0);
    const probe = group.position.clone().add(worldOffset);
    const room = roomAt(probe.x, probe.z);
    let tex: THREE.Texture;
    let roughness = 0.85;
    if (room && Math.abs(probe.x) < 13 && Math.abs(probe.z) < 9) {
      tex = wallpaper(room.wall);
    } else {
      exteriorTex ??= exteriorWallpaper();
      tex = exteriorTex;
      roughness = 0.9;
    }
    const geo = new THREE.PlaneGeometry(len, H - 0.02);
    scaleUVs(geo, len / 1.6, (H - 0.02) / 1.6);
    const plane = mesh(geo, std(0xffffff, { map: tex, roughness }), 0, H / 2, side * (T / 2 + 0.002), {
      ry: side > 0 ? 0 : Math.PI,
      parent: group,
      cast: false,
    });
    void plane;
    if (room) {
      mesh(boxGeo(len, 0.13, 0.025), shared.trim, 0, 0.065, side * (T / 2 + 0.0125), { parent: group, cast: false });
      mesh(boxGeo(len, 0.05, 0.03), shared.trim, 0, H - 0.04, side * (T / 2 + 0.015), { parent: group, cast: false });
    }
  }
  return group;
}

function buildLintel(wall: WallDef, d0: number, d1: number) {
  const group = new THREE.Group();
  const len = d1 - d0;
  const mid = (d0 + d1) / 2;
  if (wall.axis === 'x') group.position.set(mid, 0, wall.at);
  else {
    group.position.set(wall.at, 0, mid);
    group.rotation.y = Math.PI / 2;
  }
  const doorTop = 2.05;
  mesh(boxGeo(len, H - doorTop, T), coreMaterial, 0, (H + doorTop) / 2, 0, { parent: group });
  mesh(boxGeo(len + 0.02, 0.05, T + 0.05), capMaterial, 0, H + 0.025, 0, { parent: group, cast: false });
  for (const side of [-1, 1]) {
    mesh(boxGeo(len + 0.16, 0.08, 0.03), shared.trim, 0, doorTop + 0.04, side * (T / 2 + 0.015), { parent: group, cast: false });
    for (const end of [-1, 1]) {
      mesh(boxGeo(0.08, doorTop, 0.03), shared.trim, end * (len / 2 + 0.04), doorTop / 2, side * (T / 2 + 0.015), { parent: group, cast: false });
    }
  }
  for (const end of [-1, 1]) {
    mesh(boxGeo(0.02, doorTop, T + 0.02), shared.trim, end * (len / 2 - 0.01), doorTop / 2, 0, { parent: group, cast: false });
  }
  return group;
}

function registerOccluder(list: Occluder[], object: THREE.Object3D) {
  const occ: Occluder = { object, materials: [], box: new THREE.Box3(), opacity: 1 };
  list.push(occ);
}

/** Gives each occluder its own material instances so it can fade independently. */
function collectMaterials(occ: Occluder) {
  const seen = new Map<THREE.Material, THREE.Material>();
  occ.materials = [];
  occ.object.traverse((child) => {
    const m = child as THREE.Mesh;
    if (!m.isMesh) return;
    const mat = m.material as THREE.Material;
    if (mat.userData.occluderOwner === occ) {
      if (!occ.materials.includes(mat)) occ.materials.push(mat);
      return;
    }
    let clone = seen.get(mat);
    if (!clone) {
      clone = mat.clone();
      clone.userData.occluderOwner = occ;
      clone.userData.baseOpacity = mat.opacity;
      clone.userData.baseTransparent = mat.transparent;
      seen.set(mat, clone);
      occ.materials.push(clone);
    }
    m.material = clone;
  });
}

// ---------------------------------------------------------------- windows

function windowSkyTexture() {
  return canvasTexture(256, 256, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#7fb6e8');
    g.addColorStop(0.55, '#f6c79b');
    g.addColorStop(0.75, '#f2a678');
    g.addColorStop(0.76, '#5f9a4c');
    g.addColorStop(1, '#4b7f3c');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    for (let i = 0; i < 4; i += 1) {
      ctx.beginPath();
      ctx.ellipse(40 + i * 60, 50 + (i % 2) * 30, 30, 10, 0, 0, TAU);
      ctx.fill();
    }
    ctx.fillStyle = '#2f6b33';
    for (let i = 0; i < 5; i += 1) {
      ctx.beginPath();
      ctx.arc(20 + i * 55, 190, 26 + (i % 3) * 8, 0, TAU);
      ctx.fill();
    }
  });
}

function buildWindow(win: WindowDef, skyTex: THREE.Texture) {
  // Built in the parent wall's local space: wall runs along local X, interior faces vary by side.
  const group = new THREE.Group();
  // Exterior walls along X: north (z=-9) interior is +Z, south interior is -Z.
  // Along Z (rotated +90): local +Z maps to world +X, so west interior (+X) is local +Z.
  const interiorSign = win.side === 'north' || win.side === 'west' ? 1 : -1;
  // Wall pieces are centered on the wall's midpoint (0 for exterior walls).
  // For walls along Z, local X maps to world -Z after the +90 rotation.
  const localX = win.side === 'west' || win.side === 'east' ? -win.center : win.center;
  group.position.set(localX, 0, 0);

  const y = 1.45;
  const wh = 1.05;
  const glassInterior = new THREE.MeshStandardMaterial({
    color: 0x223344,
    emissive: 0xffffff,
    emissiveMap: skyTex,
    emissiveIntensity: 1.05,
    roughness: 0.05,
    metalness: 0.1,
  });
  const glassExterior = new THREE.MeshStandardMaterial({
    color: 0x1b2836,
    emissive: 0xffc078,
    emissiveIntensity: 0.25,
    roughness: 0.05,
    metalness: 0.4,
  });

  for (const side of [1, -1]) {
    const interior = side === interiorSign;
    const z = side * (T / 2 + 0.004);
    const face = new THREE.Group();
    face.position.z = z;
    face.rotation.y = side > 0 ? 0 : Math.PI;
    group.add(face);
    mesh(new THREE.PlaneGeometry(win.width, wh), interior ? glassInterior : glassExterior, 0, y, 0.002, { parent: face, cast: false });
    const fw = 0.07;
    for (const [fx, fy, w, h] of [
      [0, y + wh / 2 + fw / 2, win.width + fw * 2, fw],
      [0, y - wh / 2 - fw / 2, win.width + fw * 2, fw],
      [-win.width / 2 - fw / 2, y, fw, wh],
      [win.width / 2 + fw / 2, y, fw, wh],
      [0, y, 0.04, wh],
      [0, y, win.width, 0.04],
    ]) {
      mesh(boxGeo(w, h, 0.05), shared.trim, fx, fy, 0.02, { parent: face, cast: false });
    }
    mesh(boxGeo(win.width + 0.3, 0.05, 0.14), shared.trim, 0, y - wh / 2 - 0.09, 0.06, { parent: face, cast: false });
    if (interior && win.curtains) {
      const curtainMat = new THREE.MeshStandardMaterial({ color: win.curtains, roughness: 0.9, side: THREE.DoubleSide });
      for (const cs of [-1, 1]) {
        const geo = new THREE.PlaneGeometry(0.42, 1.75, 12, 1);
        const pos = geo.getAttribute('position') as THREE.BufferAttribute;
        for (let i = 0; i < pos.count; i += 1) pos.setZ(i, Math.sin(pos.getX(i) * 38) * 0.035 + 0.04);
        geo.computeVertexNormals();
        mesh(geo, curtainMat, cs * (win.width / 2 + 0.2), y + 0.05, 0.03, { parent: face });
      }
      mesh(cylGeo(0.018, 0.018, win.width + 1.0, 8), shared.brass, 0, y + wh / 2 + 0.2, 0.08, { rz: Math.PI / 2, parent: face, cast: false });
    }
  }
  return group;
}

// ---------------------------------------------------------------- sky + yard

function buildSky(scene: THREE.Scene) {
  const horizon = new THREE.Color(0xf6d2ad);
  scene.background = horizon.clone();
  scene.fog = new THREE.Fog(horizon, 45, 140);
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(220, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        uTop: { value: new THREE.Color(0x3d7fd1) },
        uMid: { value: new THREE.Color(0x9cc8ef) },
        uHorizon: { value: horizon },
        uSunDir: { value: SUN_DIRECTION.clone() },
      },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uTop;
        uniform vec3 uMid;
        uniform vec3 uHorizon;
        uniform vec3 uSunDir;
        varying vec3 vDir;
        void main() {
          float h = clamp(vDir.y, 0.0, 1.0);
          vec3 col = mix(uHorizon, uMid, smoothstep(0.0, 0.25, h));
          col = mix(col, uTop, smoothstep(0.25, 0.9, h));
          float sun = max(dot(normalize(vDir), normalize(uSunDir)), 0.0);
          col += vec3(1.0, 0.75, 0.45) * pow(sun, 18.0) * 0.6;
          col += vec3(1.0, 0.9, 0.7) * pow(sun, 600.0) * 4.0;
          if (vDir.y < 0.0) col = uHorizon * 0.9;
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
    }),
  );
  sky.name = 'sky';
  sky.frustumCulled = false;
  scene.add(sky);
}

function buildYard(root: THREE.Group, shadowTex: THREE.Texture) {
  const grass = std(0xffffff, { map: grassTexture(), roughness: 0.95 });
  mesh(new THREE.PlaneGeometry(260, 260), grass, 0, -0.02, 0, { rx: -Math.PI / 2, parent: root, cast: false });

  // Picket fence (instanced).
  const fx = 19;
  const fz = 15;
  const picketGeo = new THREE.BoxGeometry(0.1, 1, 0.04);
  picketGeo.translate(0, 0.5, 0);
  const positions: [number, number, number][] = [];
  for (let x = -fx; x <= fx; x += 0.24) {
    positions.push([x, -fz, 0]);
    if (Math.abs(x + 0.5) > 1.2) positions.push([x, fz, 0]);
  }
  for (let z = -fz; z <= fz; z += 0.24) {
    positions.push([-fx, z, Math.PI / 2]);
    positions.push([fx, z, Math.PI / 2]);
  }
  const fence = new THREE.InstancedMesh(picketGeo, std(0xfbfaf5, { roughness: 0.6 }), positions.length);
  const m = new THREE.Matrix4();
  positions.forEach(([x, z, r], i) => {
    m.makeRotationY(r);
    m.setPosition(x, 0, z);
    m.scale(new THREE.Vector3(1, 0.85 + ((i * 7) % 3) * 0.04, 1));
    fence.setMatrixAt(i, m);
  });
  fence.castShadow = true;
  fence.receiveShadow = true;
  root.add(fence);
  for (const [x, z, w, d] of [
    [0, -fz, fx * 2, 0.05],
    [-fx, 0, 0.05, fz * 2],
    [fx, 0, 0.05, fz * 2],
    [-9.85, fz, fx - 0.6, 0.05],
    [9.25, fz, fx - 1.7, 0.05],
  ]) {
    for (const y of [0.3, 0.65]) mesh(boxGeo(w, 0.06, d), std(0xf0eee6), x, y, z, { parent: root });
  }

  // Trees.
  const foliage = [0x4f8f3a, 0x5fa043, 0x3f7d33, 0x6aa84f];
  const treeSpots: [number, number, number][] = [
    [-17, -12, 1.2],
    [-16.5, 6, 1],
    [16.5, -11.5, 1.1],
    [17, 11, 1.25],
    [-4, -13, 0.9],
    [8, -13.2, 1.05],
    [-12, 12.5, 0.95],
    [13, 13, 0.85],
    [-26, -4, 1.5],
    [27, 2, 1.6],
    [-6, 24, 1.6],
    [12, -24, 1.7],
  ];
  for (const [x, z, s] of treeSpots) {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.scale.setScalar(s);
    root.add(g);
    mesh(cylGeo(0.18, 0.28, 2.2, 8), std(0x6b4a2e, { roughness: 0.9 }), 0, 1.1, 0, { parent: g });
    for (let i = 0; i < 4; i += 1) {
      const f = mesh(new THREE.IcosahedronGeometry(1.2 - i * 0.12, 1), std(foliage[i % foliage.length], { roughness: 0.8, flatShading: true }), rand(-0.5, 0.5), 2.6 + i * 0.55, rand(-0.5, 0.5), {
        parent: g,
      });
      f.rotation.set(rand(0, TAU), rand(0, TAU), 0);
    }
    g.add(blobShadow(shadowTex, 3.2, 3.2, 0.35));
  }

  // Bushes hugging the house.
  for (let i = 0; i < 16; i += 1) {
    const onX = i % 2 === 0;
    const x = onX ? rand(-12, 12) : (i % 4 === 1 ? -1 : 1) * 13.9;
    const z = onX ? (i % 4 === 0 ? -1 : 1) * 9.9 : rand(-8, 8);
    const bush = mesh(new THREE.IcosahedronGeometry(rand(0.5, 0.8), 1), std(foliage[i % foliage.length], { flatShading: true, roughness: 0.85 }), x, 0.35, z, {
      parent: root,
    });
    bush.scale.y = 0.75;
    if (Math.random() < 0.6) {
      for (let k = 0; k < 4; k += 1) {
        mesh(new THREE.SphereGeometry(0.06, 8, 6), std([0xff6b81, 0xfff176, 0xffffff][k % 3], { roughness: 0.6 }), x + rand(-0.4, 0.4), 0.6 + rand(0, 0.15), z + rand(-0.4, 0.4), {
          parent: root,
          cast: false,
        });
      }
    }
  }

  // Stepping stones + mailbox.
  for (let i = 0; i < 6; i += 1) {
    mesh(cylGeo(0.42, 0.45, 0.06, 14), std(0xb9b2a6, { roughness: 0.9 }), -0.5 + Math.sin(i) * 0.2, 0.0, 9.9 + i * 0.95, { parent: root, cast: false });
  }
  const box = new THREE.Group();
  box.position.set(2.6, 0, 15.6);
  root.add(box);
  mesh(cylGeo(0.05, 0.05, 1.1, 8), shared.darkWood, 0, 0.55, 0, { parent: box });
  mesh(roundedBoxGeo(0.32, 0.3, 0.55, 0.12), std(0x2c6fbb, { roughness: 0.4, metalness: 0.3 }), 0, 1.2, 0, { parent: box });
  mesh(boxGeo(0.03, 0.22, 0.08), std(0xe74c3c), 0.18, 1.32, -0.1, { parent: box });
  const label = textLabelTexture(['EDDIE'], { width: 256, height: 64, bg: '#ffffff', fg: '#2c3e50', size: 46 });
  mesh(new THREE.PlaneGeometry(0.4, 0.1), std(0xffffff, { map: label }), 0.165, 1.2, 0, { ry: Math.PI / 2, parent: box, cast: false });

  // Distant hills.
  for (let i = 0; i < 9; i += 1) {
    const a = (i / 9) * TAU;
    const hill = mesh(new THREE.SphereGeometry(rand(22, 36), 24, 12), std(0x7fa86a, { roughness: 1 }), Math.cos(a) * 110, -14, Math.sin(a) * 110, {
      parent: root,
      cast: false,
      receive: false,
    });
    hill.scale.y = 0.6;
  }

  // Clouds.
  const cloudMat = std(0xffffff, { emissive: 0xffe8d0, emissiveIntensity: 0.55, roughness: 1 });
  for (let i = 0; i < 8; i += 1) {
    const cloud = new THREE.Group();
    const a = (i / 8) * TAU + rand(0, 0.5);
    cloud.position.set(Math.cos(a) * rand(55, 80), rand(26, 38), Math.sin(a) * rand(55, 80));
    for (let k = 0; k < 5; k += 1) {
      const puff = mesh(new THREE.SphereGeometry(rand(3, 5.5), 12, 10), cloudMat, rand(-6, 6), rand(-1, 1.5), rand(-2.5, 2.5), {
        parent: cloud,
        cast: false,
        receive: false,
      });
      puff.scale.y = 0.6;
    }
    root.add(cloud);
  }
}
