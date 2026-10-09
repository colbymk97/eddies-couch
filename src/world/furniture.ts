import * as THREE from 'three';
import type { CouchDef } from './layout';
import { blobShadow, boxGeo, cylGeo, fabric, glossy, mesh, roundedBoxGeo, shared, sphereGeo, std } from './kit';
import { textLabelTexture } from './textures';
import { keepSeparate } from './batch';

export interface CouchTextures {
  weave: THREE.Texture;
  corduroy: THREE.Texture;
  leather: THREE.Texture;
  shadow: THREE.Texture;
}

export interface BuiltSeat {
  cushion: THREE.Mesh;
  plastic?: THREE.Mesh;
  top: THREE.Vector3;
  front: THREE.Vector3;
  facing: number;
}

export interface BuiltCouch {
  group: THREE.Group;
  seats: BuiltSeat[];
  boxes: { x: number; z: number; w: number; d: number; rot: number }[];
  vibrator?: THREE.Object3D;
  center: THREE.Vector3;
}

interface SofaOptions {
  seats: number;
  seatW?: number;
  depth?: number;
  armW?: number;
  armTop?: number;
  backTop?: number;
  legH?: number;
  frame: THREE.Material;
  cushion: () => THREE.Material;
  leg: THREE.Material;
  legRadius?: number;
  backCushions?: boolean;
  rolledArms?: boolean;
  tufted?: THREE.Material;
  cushionRadius?: number;
}

interface LocalSeat {
  cushion: THREE.Mesh;
  top: THREE.Vector3;
  front: THREE.Vector3;
  plastic?: THREE.Mesh;
}

function sofa(group: THREE.Group, o: SofaOptions) {
  const seatW = o.seatW ?? 0.92;
  const depth = o.depth ?? 1.0;
  const armW = o.armW ?? 0.26;
  const legH = o.legH ?? 0.1;
  const armTop = o.armTop ?? 0.74;
  const backTop = o.backTop ?? 1.08;
  const width = o.seats * seatW + armW * 2;
  const baseTop = legH + 0.34;

  mesh(roundedBoxGeo(width, 0.34, depth, 0.06), o.frame, 0, legH + 0.17, 0, { parent: group });
  mesh(roundedBoxGeo(width - 0.02, backTop - baseTop, 0.26, 0.08), o.frame, 0, (backTop + baseTop) / 2, -depth / 2 + 0.13, { parent: group });

  for (const side of [-1, 1]) {
    const ax = side * (width / 2 - armW / 2);
    mesh(roundedBoxGeo(armW, armTop - legH, depth, 0.09), o.frame, ax, (armTop + legH) / 2, 0, { parent: group });
    if (o.rolledArms) {
      mesh(cylGeo(armW * 0.62, armW * 0.62, depth + 0.02, 20), o.frame, ax + side * 0.03, armTop, 0, { rx: Math.PI / 2, parent: group });
      for (let k = 0; k < 7; k += 1) {
        mesh(sphereGeo(0.018, 8, 6), shared.brass, ax + side * (armW / 2 + 0.035), armTop - 0.16, -depth / 2 + 0.12 + k * ((depth - 0.24) / 6), {
          parent: group,
          cast: false,
        });
      }
    }
  }

  const seats: LocalSeat[] = [];
  const cushionDepth = depth - 0.3;
  const cushionZ = depth / 2 - cushionDepth / 2 - 0.02;
  for (let i = 0; i < o.seats; i += 1) {
    const x = -width / 2 + armW + seatW * (i + 0.5);
    const cushion = mesh(roundedBoxGeo(seatW - 0.03, 0.17, cushionDepth, o.cushionRadius ?? 0.07, 4), o.cushion(), x, baseTop + 0.085, cushionZ, {
      parent: group,
    });
    if (o.backCushions !== false) {
      mesh(roundedBoxGeo(seatW - 0.05, Math.min(0.5, backTop - baseTop - 0.12), 0.2, 0.08, 3), cushion.material as THREE.Material, x, baseTop + 0.17 + 0.24, -depth / 2 + 0.34, {
        rx: -0.14,
        parent: group,
      });
    }
    seats.push({
      cushion,
      top: new THREE.Vector3(x, baseTop + 0.17, cushionZ),
      front: new THREE.Vector3(x, 0, depth / 2 + 0.6),
    });
  }

  if (o.tufted) {
    const rows = 2;
    const perSeat = 3;
    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < o.seats * perSeat; c += 1) {
        const x = -width / 2 + armW + (c + 0.5) * (seatW / perSeat);
        mesh(sphereGeo(0.022, 8, 6), o.tufted, x, baseTop + 0.32 + r * 0.2, -depth / 2 + 0.265, { parent: group, cast: false });
      }
    }
  }

  const legGeo = cylGeo(o.legRadius ?? 0.035, (o.legRadius ?? 0.035) * 0.7, legH, 10);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      mesh(legGeo, o.leg, sx * (width / 2 - 0.12), legH / 2, sz * (depth / 2 - 0.12), { parent: group });
    }
  }

  return { seats, width, depth };
}

function pillow(group: THREE.Group, material: THREE.Material, x: number, y: number, z: number, rz: number, size = 0.4) {
  const p = mesh(roundedBoxGeo(size, size, 0.14, 0.065, 4), material, x, y, z, { rx: -0.35, rz, parent: group });
  p.scale.z = 1.1;
  return p;
}

function makeSegmentGroup(parent: THREE.Group, x: number, z: number, rot: number) {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  g.rotation.y = rot;
  parent.add(g);
  return g;
}

export function buildCouch(def: CouchDef, tex: CouchTextures): BuiltCouch {
  const group = new THREE.Group();
  group.name = `couch-${def.id}`;
  const seats: BuiltSeat[] = [];
  const boxes: BuiltCouch['boxes'] = [];
  let vibrator: THREE.Object3D | undefined;
  const color = new THREE.Color(def.color);

  const addSeats = (segment: THREE.Group, local: LocalSeat[], rot: number) => {
    segment.updateMatrixWorld(true);
    for (const s of local) {
      seats.push({
        cushion: s.cushion,
        plastic: s.plastic,
        top: segment.localToWorld(s.top.clone()),
        front: segment.localToWorld(s.front.clone()),
        facing: rot,
      });
    }
  };

  for (const seg of def.segments) {
    const g = makeSegmentGroup(group, seg.x, seg.z, seg.rot);
    switch (def.style) {
      case 'sectional':
      case 'loveseat':
      case 'white': {
        const isWhite = def.style === 'white';
        const isLove = def.style === 'loveseat';
        const frame = fabric(color, tex.weave, isLove ? 1 : 0.6);
        const built = sofa(g, {
          seats: seg.seats,
          frame,
          cushion: () => fabric(color.clone().offsetHSL(0, 0, isWhite ? 0.02 : 0.04), tex.weave, isLove ? 1 : 0.6),
          leg: isWhite ? shared.gold : shared.darkWood,
          legH: isWhite ? 0.16 : 0.1,
          tufted: isWhite ? shared.gold : undefined,
        });
        addSeats(g, built.seats, seg.rot);
        boxes.push({ x: seg.x, z: seg.z, w: built.width, d: built.depth, rot: seg.rot });
        g.add(blobShadow(tex.shadow, built.width + 0.5, built.depth + 0.5, 0.5));
        if (def.style === 'sectional') {
          const mustard = fabric('#e0a526', tex.weave);
          pillow(g, mustard, -built.width / 2 + 0.45, 0.78, -0.2, 0.25);
          if (seg.seats === 2) pillow(g, fabric('#e7e1d2', tex.weave), built.width / 2 - 0.45, 0.78, -0.2, -0.2);
        }
        if (isLove) {
          const text = textLabelTexture(['LIVE', 'LAUGH', 'LOUNGE'], { width: 256, height: 256, bg: '#f7e8ee', fg: '#9b2d5a', size: 52 });
          pillow(g, std(0xffffff, { map: text, roughness: 0.9 }), 0, 0.8, -0.18, 0.08, 0.46);
        }
        if (isWhite) {
          pillow(g, fabric('#ffffff', tex.weave), -built.width / 2 + 0.5, 0.82, -0.2, 0.2);
          pillow(g, fabric('#e8d9b0', tex.weave), built.width / 2 - 0.5, 0.82, -0.2, -0.2);
        }
        break;
      }
      case 'chesterfield': {
        const leather = glossy(color, { map: tex.leather, roughness: 0.42, clearcoat: 0.5 });
        const built = sofa(g, {
          seats: seg.seats,
          frame: leather,
          cushion: () => glossy(color.clone().offsetHSL(0, 0, 0.03), { map: tex.leather, roughness: 0.42, clearcoat: 0.5 }),
          leg: shared.darkWood,
          armTop: 0.82,
          backTop: 0.98,
          rolledArms: true,
          backCushions: false,
          tufted: glossy(color.clone().offsetHSL(0, 0, -0.06), { roughness: 0.3 }),
        });
        addSeats(g, built.seats, seg.rot);
        boxes.push({ x: seg.x, z: seg.z, w: built.width + 0.1, d: built.depth, rot: seg.rot });
        g.add(blobShadow(tex.shadow, built.width + 0.5, built.depth + 0.5, 0.5));
        break;
      }
      case 'plastic': {
        const floral = fabric(color, tex.weave, 0.8);
        const built = sofa(g, {
          seats: seg.seats,
          frame: floral,
          cushion: () => fabric(color.clone().offsetHSL(0.02, 0, 0.04), tex.weave, 0.8),
          leg: shared.midWood,
          legH: 0.14,
        });
        const plasticMat = new THREE.MeshPhysicalMaterial({
          color: 0xffffff,
          roughness: 0.05,
          metalness: 0,
          clearcoat: 1,
          clearcoatRoughness: 0.03,
          transparent: true,
          opacity: 0.32,
          depthWrite: false,
        });
        for (const s of built.seats) {
          const plastic = mesh(roundedBoxGeo(0.94, 0.2, 0.74, 0.08, 4), plasticMat, s.top.x, s.top.y - 0.08, s.top.z, {
            parent: g,
            cast: false,
          });
          s.plastic = plastic;
        }
        mesh(roundedBoxGeo(built.width + 0.04, 0.68, 0.3, 0.1), plasticMat, 0, 0.92, -built.depth / 2 + 0.13, { parent: g, cast: false });
        addSeats(g, built.seats, seg.rot);
        boxes.push({ x: seg.x, z: seg.z, w: built.width, d: built.depth, rot: seg.rot });
        g.add(blobShadow(tex.shadow, built.width + 0.5, built.depth + 0.5, 0.5));
        break;
      }
      case 'futon': {
        const wood = shared.lightWood;
        const width = seg.seats * 0.92 + 0.16;
        const depth = 1.0;
        for (const side of [-1, 1]) {
          mesh(roundedBoxGeo(0.08, 0.62, depth, 0.03), wood, side * (width / 2 - 0.04), 0.31, 0, { parent: g });
        }
        mesh(boxGeo(width - 0.1, 0.06, depth - 0.1), wood, 0, 0.26, 0, { parent: g });
        for (let k = 0; k < 6; k += 1) {
          mesh(boxGeo(width - 0.12, 0.06, 0.05), wood, 0, 0.5 + k * 0.1, -depth / 2 + 0.06 - k * 0.025, { rx: -0.28, parent: g });
        }
        const local: LocalSeat[] = [];
        const mattress = () => fabric(color, tex.weave, 0.4);
        for (let i = 0; i < seg.seats; i += 1) {
          const x = -width / 2 + 0.08 + 0.92 * (i + 0.5);
          const cushion = mesh(roundedBoxGeo(0.92, 0.2, depth - 0.18, 0.06, 4), mattress(), x, 0.39, 0.06, { parent: g });
          local.push({ cushion, top: new THREE.Vector3(x, 0.49, 0.06), front: new THREE.Vector3(x, 0, depth / 2 + 0.6) });
        }
        mesh(roundedBoxGeo(width - 0.18, 0.66, 0.18, 0.07, 3), fabric(color.clone().offsetHSL(0, 0, -0.04), tex.weave, 0.4), 0, 0.78, -depth / 2 + 0.2, {
          rx: -0.28,
          parent: g,
        });
        addSeats(g, local, seg.rot);
        boxes.push({ x: seg.x, z: seg.z, w: width, d: depth, rot: seg.rot });
        g.add(blobShadow(tex.shadow, width + 0.5, depth + 0.5, 0.5));
        break;
      }
      case 'recliner': {
        const cord = fabric(color, tex.corduroy, 0.5);
        const w = 1.12;
        const d = 1.0;
        mesh(roundedBoxGeo(w, 0.36, d, 0.08), cord, 0, 0.26, 0, { parent: g });
        for (const side of [-1, 1]) {
          mesh(roundedBoxGeo(0.27, 0.64, d, 0.12), cord, side * (w / 2 - 0.135), 0.44, 0, { parent: g });
        }
        mesh(roundedBoxGeo(w - 0.1, 0.9, 0.3, 0.12), cord, 0, 0.88, -d / 2 + 0.12, { rx: -0.2, parent: g });
        mesh(roundedBoxGeo(w - 0.4, 0.26, 0.2, 0.1), cord, 0, 1.2, -d / 2 + 0.24, { rx: -0.2, parent: g });
        const cushion = mesh(roundedBoxGeo(w - 0.52, 0.18, 0.7, 0.07, 4), fabric(color.clone().offsetHSL(0, 0, 0.05), tex.corduroy, 0.5), 0, 0.53, 0.1, {
          parent: g,
        });
        mesh(roundedBoxGeo(w - 0.5, 0.14, 0.46, 0.06), cord, 0, 0.36, d / 2 + 0.24, { rx: 0.1, parent: g });
        mesh(cylGeo(0.02, 0.02, 0.2, 8), shared.chrome, w / 2 + 0.01, 0.42, 0.2, { rz: 0.4, parent: g });
        addSeats(g, [{ cushion, top: new THREE.Vector3(0, 0.62, 0.1), front: new THREE.Vector3(0, 0, d / 2 + 0.85) }], seg.rot);
        boxes.push({ x: seg.x, z: seg.z, w, d: d + 0.3, rot: seg.rot });
        g.add(blobShadow(tex.shadow, w + 0.6, d + 0.8, 0.55));
        break;
      }
      case 'massage': {
        const body = new THREE.Group();
        g.add(body);
        const shell = glossy(0x222226, { roughness: 0.3, clearcoat: 1 });
        const pad = glossy(0x3a3a40, { map: tex.leather, roughness: 0.45, clearcoat: 0.4 });
        mesh(roundedBoxGeo(0.9, 0.3, 0.9, 0.1), shell, 0, 0.22, 0, { parent: body });
        const cushion = mesh(roundedBoxGeo(0.6, 0.16, 0.66, 0.07, 4), pad, 0, 0.45, 0.06, { parent: body });
        mesh(roundedBoxGeo(0.72, 1.1, 0.3, 0.14), shell, 0, 0.98, -0.36, { rx: -0.32, parent: body });
        mesh(roundedBoxGeo(0.56, 0.9, 0.12, 0.06), pad, 0, 0.98, -0.24, { rx: -0.32, parent: body });
        for (const side of [-1, 1]) {
          mesh(roundedBoxGeo(0.16, 0.36, 0.86, 0.07), shell, side * 0.38, 0.52, 0.02, { parent: body });
          mesh(boxGeo(0.02, 0.04, 0.7), shared.chrome, side * 0.465, 0.6, 0.02, { parent: body, cast: false });
        }
        mesh(roundedBoxGeo(0.5, 0.48, 0.16, 0.06), shell, 0, 0.28, 0.52, { rx: -0.35, parent: body });
        mesh(boxGeo(0.12, 0.02, 0.08), std(0x111111, { emissive: 0x33ff88, emissiveIntensity: 1.6 }), 0.38, 0.715, 0.25, { parent: body, cast: false });
        addSeats(g, [{ cushion, top: new THREE.Vector3(0, 0.53, 0.06), front: new THREE.Vector3(0, 0, 1.25) }], seg.rot);
        boxes.push({ x: seg.x, z: seg.z, w: 0.95, d: 1.15, rot: seg.rot });
        g.add(blobShadow(tex.shadow, 1.4, 1.5, 0.55));
        vibrator = body;
        break;
      }
      case 'beanbag': {
        const geo = new THREE.SphereGeometry(0.64, 40, 28);
        const pos = geo.getAttribute('position') as THREE.BufferAttribute;
        const v = new THREE.Vector3();
        for (let i = 0; i < pos.count; i += 1) {
          v.fromBufferAttribute(pos, i);
          v.y *= 0.58;
          if (v.y < -0.18) v.y = -0.18 - (v.y + 0.18) * 0.15;
          const dent = Math.exp(-((v.x * v.x + (v.z - 0.05) * (v.z - 0.05)) / 0.12)) * 0.12;
          if (v.y > 0) v.y -= dent;
          v.y += Math.sin(v.x * 9) * 0.012 + Math.cos(v.z * 7) * 0.012;
          pos.setXYZ(i, v.x, v.y, v.z);
        }
        geo.computeVertexNormals();
        const vinyl = glossy(color, { roughness: 0.3, clearcoat: 1 });
        const cushion = mesh(geo, vinyl, 0, 0.2, 0, { parent: g });
        addSeats(g, [{ cushion, top: new THREE.Vector3(0, 0.44, 0.05), front: new THREE.Vector3(0, 0, 1.1) }], seg.rot);
        boxes.push({ x: seg.x, z: seg.z, w: 1.15, d: 1.15, rot: 0 });
        g.add(blobShadow(tex.shadow, 1.6, 1.6, 0.6));
        break;
      }
    }
  }

  for (const seat of seats) {
    keepSeparate(seat.cushion);
    (seat.cushion.material as THREE.Material).userData.unique = true;
    if (seat.plastic) keepSeparate(seat.plastic);
  }
  if (vibrator) keepSeparate(vibrator);
  group.updateMatrixWorld(true);
  const center = new THREE.Vector3();
  for (const s of seats) center.add(s.top);
  center.divideScalar(seats.length);
  return { group, seats, boxes, vibrator, center };
}

/** Velvet rope stanchions in front of the white couch. Purely ceremonial. */
export function velvetRopes(x0: number, x1: number, z: number) {
  const group = new THREE.Group();
  const posts = 3;
  const rope = std(0x9b111e, { roughness: 0.75 });
  const points: THREE.Vector3[] = [];
  for (let i = 0; i < posts; i += 1) {
    const x = x0 + ((x1 - x0) * i) / (posts - 1);
    mesh(cylGeo(0.13, 0.15, 0.04, 20), shared.gold, x, 0.02, z, { parent: group });
    mesh(cylGeo(0.025, 0.025, 0.86, 10), shared.gold, x, 0.45, z, { parent: group });
    mesh(sphereGeo(0.05, 12, 10), shared.gold, x, 0.9, z, { parent: group });
    points.push(new THREE.Vector3(x, 0.84, z));
  }
  for (let i = 0; i < posts - 1; i += 1) {
    const a = points[i];
    const b = points[i + 1];
    const mid = a.clone().lerp(b, 0.5);
    mid.y -= 0.22;
    const curve = new THREE.QuadraticBezierCurve3(a, mid, b);
    mesh(new THREE.TubeGeometry(curve, 20, 0.025, 8, false), rope, 0, 0, 0, { parent: group });
  }
  return group;
}
