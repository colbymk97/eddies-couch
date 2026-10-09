import * as THREE from 'three';
import { BUN_SPOTS, JUICE_SPOTS, MICROWAVE, TOY_SPOTS, TRASH_CANS } from '../world/layout';
import { blobShadow, boxGeo, cylGeo, glossy, makeBun, mesh, roundedBoxGeo, sphereGeo, std } from '../world/kit';
import { glowTexture, textLabelTexture } from '../world/textures';
import { TAU, dist2D, rand } from '../core/util';
import { mergeStatic } from '../world/batch';

export type PickupKind = 'bun' | 'juice' | 'toy' | 'burrito';

interface Pickup {
  kind: PickupKind;
  group: THREE.Group;
  home: THREE.Vector3;
  active: boolean;
  respawn: number;
  timer: number;
  spin: number;
}

interface TrashCanState {
  x: number;
  z: number;
  cooldown: number;
  extra: THREE.Object3D | null;
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

export interface PickupHost {
  canCollect(kind: PickupKind): boolean;
  collect(kind: PickupKind, at: THREE.Vector3): void;
  rummage(at: THREE.Vector3): boolean;
  toyLanded(at: THREE.Vector3): void;
  microwaveStarted(): void;
  microwaveDing(at: THREE.Vector3): void;
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
  const body = mesh(new THREE.CapsuleGeometry(0.11, 0.3, 6, 14), wrap, 0, 0, 0, { rz: Math.PI / 2, parent: g });
  void body;
  mesh(sphereGeo(0.1, 12, 10), std(0x8a4b2a), 0.24, 0.02, 0, { parent: g }).scale.set(0.5, 0.8, 0.8);
  mesh(sphereGeo(0.05, 8, 6), std(0x62a83a), 0.27, 0.06, 0.03, { parent: g });
  mesh(boxGeo(0.34, 0.01, 0.24), std(0xd0d6dc, { metalness: 0.9, roughness: 0.3 }), -0.04, -0.02, 0, { rz: Math.PI / 2, ry: 0.2, parent: g }).visible = false;
  return g;
}

export class Pickups {
  private readonly items: Pickup[] = [];
  private readonly cans: TrashCanState[] = [];
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
    canBuns: THREE.Object3D[],
    private readonly microwave: { run(seconds: number): void },
  ) {
    BUN_SPOTS.forEach(([x, z]) => this.add('bun', makeBun(1.7), x, z, 16));
    JUICE_SPOTS.forEach(([x, z]) => this.add('juice', makeJuice(), x, z, 28));
    TOY_SPOTS.forEach(([x, z]) => this.add('toy', makeToy(), x, z, 22));
    this.burrito = this.add('burrito', makeBurrito(), MICROWAVE.drop.x, MICROWAVE.drop.z, 0);
    this.burrito.active = false;
    this.burrito.group.visible = false;
    TRASH_CANS.forEach(([x, z], i) => this.cans.push({ x, z, cooldown: 0, extra: canBuns[i] ?? null }));
  }

  private add(kind: PickupKind, model: THREE.Group, x: number, z: number, respawn: number) {
    const group = new THREE.Group();
    group.position.set(x, 0, z);
    model.name = 'model';
    model.traverse((o) => (o.castShadow = false));
    mergeStatic(model);
    group.add(model);
    const glow = new THREE.Sprite(this.glow);
    glow.scale.setScalar(kind === 'burrito' ? 1.3 : 0.9);
    glow.position.y = 0.45;
    glow.name = 'glow';
    group.add(glow);
    group.add(blobShadow(this.shadow, 0.6, 0.6, 0.45));
    this.scene.add(group);
    const item: Pickup = { kind, group, home: new THREE.Vector3(x, 0, z), active: true, respawn, timer: 0, spin: rand(0, TAU) };
    this.items.push(item);
    return item;
  }

  reset() {
    for (const item of this.items) {
      item.active = item.kind !== 'burrito';
      item.group.visible = item.active;
      item.timer = 0;
      item.group.position.copy(item.home);
    }
    for (const can of this.cans) {
      can.cooldown = 0;
      if (can.extra) can.extra.visible = true;
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

  trashMarkers() {
    return this.cans.map((c) => ({ x: c.x, z: c.z, ready: c.cooldown <= 0 }));
  }

  throwToy(from: THREE.Vector3, to: THREE.Vector3) {
    const group = makeToy();
    group.position.copy(from);
    this.scene.add(group);
    this.thrown.push({ group, from: from.clone(), to: to.clone(), t: 0, duration: 0.55 + from.distanceTo(to) * 0.05, landed: false, linger: 6 });
  }

  update(dt: number, theo: THREE.Vector3, host: PickupHost) {
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
        model.position.y = 0.42 + Math.sin(this.time * 3 + item.spin) * 0.06;
        model.rotation.y = this.time * 1.6 + item.spin;
      }
      if (glow) glow.material.opacity = 0.55 + Math.sin(this.time * 4 + item.spin) * 0.2;
      if (dist2D(item.group.position.x, item.group.position.z, theo.x, theo.z) < 0.62 && host.canCollect(item.kind)) {
        item.active = false;
        item.group.visible = false;
        item.timer = item.respawn;
        host.collect(item.kind, item.group.position.clone().setY(0.5));
        if (item.kind === 'burrito') this.microwaveTimer = 38;
      }
    }

    // Trash cans: rummage for buns.
    for (const can of this.cans) {
      if (can.cooldown > 0) {
        can.cooldown -= dt;
        if (can.cooldown <= 0 && can.extra) can.extra.visible = true;
        continue;
      }
      if (dist2D(can.x, can.z, theo.x, theo.z) < 0.85 && host.rummage(new THREE.Vector3(can.x, 0.8, can.z))) {
        can.cooldown = 12;
        if (can.extra) can.extra.visible = false;
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
