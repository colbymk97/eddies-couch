import * as THREE from 'three';
import { FOOD_SPOTS, FRIDGE_RAID, JUICE_SPOTS, MICROWAVE, TOY_SPOTS } from '../world/layout';
import { blobShadow, boxGeo, cylGeo, glossy, mesh, roundedBoxGeo, sphereGeo, std } from '../world/kit';
import { glowTexture, textLabelTexture } from '../world/textures';
import { TAU, dist2D, rand } from '../core/util';
import { mergeStatic } from '../world/batch';
import type { MesserId } from '../actors/cast';

export type PickupKind = 'food' | 'feast' | 'juice' | 'toy' | 'burrito';
export type FoodKind = 'nuggets' | 'drumsticks' | 'mac' | 'chicken' | 'burrito';

interface Pickup {
  kind: PickupKind;
  food: FoodKind | null;
  group: THREE.Group;
  home: THREE.Vector3;
  active: boolean;
  respawn: number;
  timer: number;
  spin: number;
}

interface ThrownToy {
  group: THREE.Group;
  from: THREE.Vector3;
  to: THREE.Vector3;
  t: number;
  duration: number;
  landed: boolean;
  linger: number;
}

export interface Collector {
  id: MesserId;
  position: THREE.Vector3;
}

export interface PickupHost {
  canCollect(kind: PickupKind, who: MesserId): boolean;
  collect(kind: PickupKind, food: FoodKind | null, at: THREE.Vector3, who: MesserId): void;
  toyLanded(at: THREE.Vector3): void;
  microwaveStarted(): void;
  microwaveDing(at: THREE.Vector3): void;
}

function makeNuggets() {
  const g = new THREE.Group();
  const label = textLabelTexture(['NUGS'], { width: 128, height: 96, bg: '#d62828', fg: '#ffd23f', size: 44 });
  mesh(roundedBoxGeo(0.26, 0.17, 0.18, 0.02), std(0xffffff, { map: label, roughness: 0.6 }), 0, 0, 0, { parent: g });
  const nug = std(0xd9962f, { roughness: 0.8 });
  for (let i = 0; i < 5; i += 1) {
    const n = mesh(new THREE.CapsuleGeometry(0.035, 0.035, 4, 8), nug, -0.08 + i * 0.04, 0.1 + (i % 2) * 0.02, (i % 2) * 0.03 - 0.015, { rz: Math.PI / 2 + rand(-0.4, 0.4), parent: g });
    n.scale.set(1, 1, 1.3);
  }
  return g;
}

function makeBucket() {
  const g = new THREE.Group();
  mesh(cylGeo(0.13, 0.1, 0.22, 18), std(0xc0392b, { roughness: 0.55 }), 0, 0, 0, { parent: g });
  mesh(cylGeo(0.132, 0.132, 0.04, 18), std(0xffffff, { roughness: 0.55 }), 0, 0.06, 0, { parent: g });
  const meat = std(0x9a4f1c, { roughness: 0.55 });
  const bone = std(0xf3ead8, { roughness: 0.5 });
  for (let i = 0; i < 3; i += 1) {
    const a = (i / 3) * TAU;
    const leg = new THREE.Group();
    leg.position.set(Math.cos(a) * 0.05, 0.14, Math.sin(a) * 0.05);
    leg.rotation.set(Math.sin(a) * 0.5, 0, -Math.cos(a) * 0.5);
    g.add(leg);
    mesh(sphereGeo(0.05, 10, 8), meat, 0, 0, 0, { parent: leg }).scale.set(1, 1.4, 1);
    mesh(cylGeo(0.012, 0.012, 0.08, 6), bone, 0, 0.09, 0, { parent: leg });
  }
  return g;
}

function makeMac() {
  const g = new THREE.Group();
  mesh(cylGeo(0.15, 0.09, 0.1, 20), glossy(0x3a86ff, { roughness: 0.3 }), 0, 0, 0, { parent: g });
  const mac = mesh(sphereGeo(0.14, 16, 8), std(0xf7c548, { roughness: 0.6 }), 0, 0.04, 0, { parent: g });
  mac.scale.set(1, 0.35, 1);
  mesh(cylGeo(0.008, 0.008, 0.2, 6), std(0xd0d6dc, { metalness: 0.9, roughness: 0.3 }), 0.05, 0.1, 0, { rz: -0.5, parent: g });
  return g;
}

function makeChicken() {
  const g = new THREE.Group();
  mesh(cylGeo(0.24, 0.22, 0.02, 24), std(0xf4f4f4, { roughness: 0.3 }), 0, -0.08, 0, { parent: g });
  const skin = std(0xb5651d, { roughness: 0.45 });
  mesh(sphereGeo(0.15, 18, 14), skin, 0, 0.02, 0, { parent: g }).scale.set(1.2, 0.8, 1);
  for (const side of [-1, 1]) {
    mesh(sphereGeo(0.06, 10, 8), skin, side * 0.12, 0.0, 0.1, { parent: g }).scale.set(1, 0.9, 1.5);
    mesh(cylGeo(0.012, 0.012, 0.07, 6), std(0xf3ead8), side * 0.14, 0.03, 0.18, { rx: 1.1, parent: g });
  }
  for (let i = 0; i < 4; i += 1) mesh(sphereGeo(0.025, 6, 4), std(0x6aa84f), Math.cos(i * 1.6) * 0.19, -0.06, Math.sin(i * 1.6) * 0.19, { parent: g });
  return g;
}

function makeJuice() {
  const g = new THREE.Group();
  const label = textLabelTexture(['JUICE'], { width: 128, height: 128, bg: '#ff9f1c', fg: '#ffffff', size: 40 });
  mesh(roundedBoxGeo(0.2, 0.3, 0.13, 0.02), std(0xffffff, { map: label, roughness: 0.5 }), 0, 0, 0, { parent: g });
  mesh(cylGeo(0.012, 0.012, 0.2, 6), std(0xffffff), 0.05, 0.2, 0, { rz: 0.3, parent: g });
  return g;
}

function makeToy() {
  const g = new THREE.Group();
  const mat = glossy(0xff5d8f, { roughness: 0.3 });
  mesh(new THREE.CapsuleGeometry(0.05, 0.26, 4, 10), mat, 0, 0, 0, { rz: Math.PI / 2, parent: g });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) mesh(sphereGeo(0.065, 12, 10), mat, sx * 0.17, 0, sz * 0.05, { parent: g });
  return g;
}

function makeBurrito() {
  const g = new THREE.Group();
  const wrap = std(0xf0d9a6, { roughness: 0.75 });
  mesh(new THREE.CapsuleGeometry(0.11, 0.3, 6, 14), wrap, 0, 0, 0, { rz: Math.PI / 2, parent: g });
  mesh(sphereGeo(0.1, 12, 10), std(0x8a4b2a), 0.24, 0.02, 0, { parent: g }).scale.set(0.5, 0.8, 0.8);
  mesh(sphereGeo(0.05, 8, 6), std(0x62a83a), 0.27, 0.06, 0.03, { parent: g });
  mesh(boxGeo(0.34, 0.01, 0.24), std(0xd0d6dc, { metalness: 0.9, roughness: 0.3 }), -0.04, -0.02, 0, { rz: Math.PI / 2, ry: 0.2, parent: g }).visible = false;
  return g;
}

const FOODS: { food: FoodKind; make: () => THREE.Group }[] = [
  { food: 'nuggets', make: makeNuggets },
  { food: 'drumsticks', make: makeBucket },
  { food: 'mac', make: makeMac },
];

export class Pickups {
  private readonly items: Pickup[] = [];
  private readonly thrown: ThrownToy[] = [];
  private readonly glow = new THREE.SpriteMaterial({ map: glowTexture('255,230,140'), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
  private readonly burrito: Pickup;
  private microwaveTimer = 24;
  private microwaveRunning = 0;
  private burritoFlight = -1;
  private time = 0;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly shadow: THREE.Texture,
    private readonly microwave: { run(seconds: number): void },
  ) {
    FOOD_SPOTS.forEach(([x, z], i) => {
      const f = FOODS[i % FOODS.length];
      this.add('food', f.food, f.make(), x, z, 15);
    });
    this.add('feast', 'chicken', makeChicken(), FRIDGE_RAID.x, FRIDGE_RAID.z, 30);
    JUICE_SPOTS.forEach(([x, z]) => this.add('juice', null, makeJuice(), x, z, 28));
    TOY_SPOTS.forEach(([x, z]) => this.add('toy', null, makeToy(), x, z, 22));
    this.burrito = this.add('burrito', 'burrito', makeBurrito(), MICROWAVE.drop.x, MICROWAVE.drop.z, 0);
    this.burrito.active = false;
    this.burrito.group.visible = false;
  }

  private add(kind: PickupKind, food: FoodKind | null, model: THREE.Group, x: number, z: number, respawn: number) {
    const group = new THREE.Group();
    group.position.set(x, 0, z);
    model.name = 'model';
    model.traverse((o) => (o.castShadow = false));
    mergeStatic(model);
    group.add(model);
    const glow = new THREE.Sprite(this.glow);
    glow.scale.setScalar(kind === 'burrito' || kind === 'feast' ? 1.3 : 0.9);
    glow.position.y = 0.45;
    glow.name = 'glow';
    group.add(glow);
    group.add(blobShadow(this.shadow, 0.6, 0.6, 0.45));
    this.scene.add(group);
    const item: Pickup = { kind, food, group, home: new THREE.Vector3(x, 0, z), active: true, respawn, timer: 0, spin: rand(0, TAU) };
    this.items.push(item);
    return item;
  }

  reset() {
    for (const item of this.items) {
      item.active = item.kind !== 'burrito';
      item.group.visible = item.active;
      item.timer = 0;
      item.group.position.copy(item.home);
      item.group.scale.setScalar(1);
    }
    for (const t of this.thrown) t.group.removeFromParent();
    this.thrown.length = 0;
    this.microwaveTimer = 24;
    this.microwaveRunning = 0;
    this.burritoFlight = -1;
  }

  /** Positions of live pickups for the minimap. */
  markers(): { kind: PickupKind; x: number; z: number }[] {
    return this.items.filter((i) => i.active).map((i) => ({ kind: i.kind, x: i.group.position.x, z: i.group.position.z }));
  }

  /** Nearest live pickup of the given kinds (for the AI). */
  nearest(from: THREE.Vector3, kinds: PickupKind[]): THREE.Vector3 | null {
    let best: THREE.Vector3 | null = null;
    let bestD = Infinity;
    for (const item of this.items) {
      if (!item.active || !kinds.includes(item.kind) || (item.kind === 'burrito' && this.burritoFlight >= 0)) continue;
      const d = dist2D(item.group.position.x, item.group.position.z, from.x, from.z);
      if (d < bestD) {
        bestD = d;
        best = item.group.position;
      }
    }
    return best;
  }

  throwToy(from: THREE.Vector3, to: THREE.Vector3) {
    const group = makeToy();
    group.position.copy(from);
    this.scene.add(group);
    this.thrown.push({ group, from: from.clone(), to: to.clone(), t: 0, duration: 0.55 + from.distanceTo(to) * 0.05, landed: false, linger: 6 });
  }

  update(dt: number, collectors: Collector[], host: PickupHost) {
    this.time += dt;
    for (const item of this.items) {
      if (!item.active) {
        if (item.kind === 'burrito') continue;
        item.timer -= dt;
        if (item.timer <= 0) {
          item.active = true;
          item.group.visible = true;
          item.group.scale.setScalar(0.01);
        }
        continue;
      }
      const model = item.group.getObjectByName('model');
      const glow = item.group.getObjectByName('glow') as THREE.Sprite | undefined;
      if (item.group.scale.x < 1) item.group.scale.setScalar(Math.min(1, item.group.scale.x + dt * 3));
      if (model && !(item.kind === 'burrito' && this.burritoFlight >= 0)) {
        model.position.y = (item.kind === 'feast' ? 0.5 : 0.42) + Math.sin(this.time * 3 + item.spin) * 0.06;
        model.rotation.y = this.time * 1.6 + item.spin;
      }
      if (glow) glow.material.opacity = 0.55 + Math.sin(this.time * 4 + item.spin) * 0.2;
      if (item.kind === 'burrito' && this.burritoFlight >= 0) continue;
      for (const c of collectors) {
        if (dist2D(item.group.position.x, item.group.position.z, c.position.x, c.position.z) >= 0.62) continue;
        if (!host.canCollect(item.kind, c.id)) continue;
        item.active = false;
        item.group.visible = false;
        item.timer = item.respawn;
        host.collect(item.kind, item.food, item.group.position.clone().setY(0.5), c.id);
        if (item.kind === 'burrito') this.microwaveTimer = 38;
        break;
      }
    }

    // Microwave → Mystery Burrito.
    if (!this.burrito.active && this.burritoFlight < 0) {
      if (this.microwaveRunning > 0) {
        this.microwaveRunning -= dt;
        if (this.microwaveRunning <= 0) {
          this.burrito.active = true;
          this.burrito.group.visible = true;
          this.burrito.group.scale.setScalar(1);
          this.burritoFlight = 0;
          host.microwaveDing(this.burrito.home.clone().setY(1));
        }
      } else {
        this.microwaveTimer -= dt;
        if (this.microwaveTimer <= 0) {
          this.microwaveRunning = 6;
          this.microwave.run(6);
          host.microwaveStarted();
        }
      }
    }
    if (this.burritoFlight >= 0) {
      this.burritoFlight += dt;
      const k = Math.min(1, this.burritoFlight / 0.6);
      const model = this.burrito.group.getObjectByName('model');
      if (model) {
        const startZ = MICROWAVE.z - MICROWAVE.drop.z;
        model.position.set(0, 1.15 * (1 - k) + 0.42 * k + Math.sin(k * Math.PI) * 0.8, startZ * (1 - k));
        model.rotation.z = k * TAU * 1.5;
      }
      if (k >= 1) this.burritoFlight = -1;
    }

    // Thrown squeaky toys.
    for (let i = this.thrown.length - 1; i >= 0; i -= 1) {
      const t = this.thrown[i];
      if (!t.landed) {
        t.t += dt;
        const k = Math.min(1, t.t / t.duration);
        t.group.position.lerpVectors(t.from, t.to, k);
        t.group.position.y = t.from.y * (1 - k) + 0.07 + Math.sin(k * Math.PI) * 1.4;
        t.group.rotation.set(k * 9, k * 5, 0);
        if (k >= 1) {
          t.landed = true;
          t.group.rotation.set(0, rand(0, TAU), 0);
          host.toyLanded(t.to.clone());
        }
      } else {
        t.linger -= dt;
        t.group.scale.setScalar(t.linger < 0.5 ? Math.max(0.01, t.linger * 2) : 1 + Math.max(0, Math.sin(t.linger * 20)) * 0.15 * (t.linger > 5 ? 1 : 0));
        if (t.linger <= 0) {
          t.group.removeFromParent();
          this.thrown.splice(i, 1);
        }
      }
    }
  }
}
