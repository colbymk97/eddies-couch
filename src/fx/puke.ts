import * as THREE from 'three';
import { DecalGeometry } from 'three/examples/jsm/geometries/DecalGeometry.js';
import { pukeSplatTexture } from '../world/textures';
import type { Puddle, Seat } from '../game/types';
import { TAU, clamp, easeOutBack, rand } from '../core/util';

const GRAVITY = 13;
const MAX_PARTICLES = 900;

type Kind = 0 | 1 | 2; // 0 = blob (lands), 1 = droplet (fades), 2 = mist (spray bottle)

export interface Shot {
  start: () => THREE.Vector3;
  target: THREE.Vector3;
  spread: number;
  power: number;
  flight: number;
  emitFor: number;
  age: number;
  emitAccumulator: number;
  landed: boolean;
  onLand: () => void;
}

const PUKE_COLORS = [0x9fcf3a, 0xb4d84a, 0x8cbf2f, 0xc9df5c, 0xa6c93a, 0xe08a2a, 0xe8c27a];

export class PukeSystem {
  private readonly mesh: THREE.InstancedMesh;
  private readonly pos = new Float32Array(MAX_PARTICLES * 3);
  private readonly vel = new Float32Array(MAX_PARTICLES * 3);
  private readonly life = new Float32Array(MAX_PARTICLES);
  private readonly size = new Float32Array(MAX_PARTICLES);
  private readonly floor = new Float32Array(MAX_PARTICLES);
  private readonly kind = new Uint8Array(MAX_PARTICLES);
  private readonly active = new Uint8Array(MAX_PARTICLES);
  private cursor = 0;
  private readonly shots: Shot[] = [];
  private readonly dummy = new THREE.Object3D();
  private readonly color = new THREE.Color();

  readonly puddles: Puddle[] = [];
  private readonly decalMaterials: THREE.MeshPhysicalMaterial[];
  private readonly puddleGeo = new THREE.PlaneGeometry(1, 1);
  private readonly growing: { mesh: THREE.Mesh; age: number; scale: number }[] = [];
  private readonly drippers: { seat: Seat; time: number; next: number }[] = [];
  private puddleLayer = 0;

  // Aiming visuals.
  private readonly arcDots: THREE.InstancedMesh;
  private readonly ring: THREE.Mesh;
  private readonly reticle: THREE.Group;

  constructor(private readonly scene: THREE.Scene) {
    const geo = new THREE.IcosahedronGeometry(1, 1);
    const mat = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.15 });
    this.mesh = new THREE.InstancedMesh(geo, mat, MAX_PARTICLES);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.castShadow = true;
    this.mesh.frustumCulled = false;
    this.mesh.count = MAX_PARTICLES;
    for (let i = 0; i < MAX_PARTICLES; i += 1) {
      this.dummy.scale.setScalar(0);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);
      this.mesh.setColorAt(i, this.color.setHex(PUKE_COLORS[i % PUKE_COLORS.length]));
    }
    scene.add(this.mesh);

    this.decalMaterials = [0, 1, 2, 3].map(
      (i) =>
        new THREE.MeshPhysicalMaterial({
          map: pukeSplatTexture(i),
          transparent: true,
          depthWrite: false,
          polygonOffset: true,
          polygonOffsetFactor: -4,
          polygonOffsetUnits: -4,
          roughness: 0.3,
          clearcoat: 1,
          clearcoatRoughness: 0.12,
        }),
    );
    this.puddleGeo.rotateX(-Math.PI / 2);

    // Trajectory preview.
    this.arcDots = new THREE.InstancedMesh(
      new THREE.SphereGeometry(0.045, 8, 6),
      new THREE.MeshBasicMaterial({ color: 0xd8ff6a, transparent: true, opacity: 0.9, toneMapped: false }),
      26,
    );
    this.arcDots.frustumCulled = false;
    this.arcDots.visible = false;
    scene.add(this.arcDots);
    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(0.86, 1, 48).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xd8ff6a, transparent: true, opacity: 0.85, toneMapped: false, depthWrite: false }),
    );
    this.ring.visible = false;
    this.ring.renderOrder = 5;
    scene.add(this.ring);

    this.reticle = new THREE.Group();
    const reticleRing = new THREE.Mesh(
      new THREE.RingGeometry(0.34, 0.42, 40).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xfff27a, transparent: true, opacity: 0.95, toneMapped: false, depthWrite: false }),
    );
    reticleRing.name = 'ring';
    this.reticle.add(reticleRing);
    const arrow = new THREE.Mesh(
      new THREE.ConeGeometry(0.11, 0.24, 4).rotateX(Math.PI),
      new THREE.MeshBasicMaterial({ color: 0xfff27a, toneMapped: false }),
    );
    arrow.name = 'arrow';
    arrow.position.y = 0.7;
    this.reticle.add(arrow);
    this.reticle.visible = false;
    this.reticle.renderOrder = 5;
    scene.add(this.reticle);
  }

  // ---------------------------------------------------------------- particles

  private spawn(kind: Kind, x: number, y: number, z: number, vx: number, vy: number, vz: number, size: number, floorY: number, life = 3) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % MAX_PARTICLES;
    this.active[i] = 1;
    this.kind[i] = kind;
    this.pos[i * 3] = x;
    this.pos[i * 3 + 1] = y;
    this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx;
    this.vel[i * 3 + 1] = vy;
    this.vel[i * 3 + 2] = vz;
    this.size[i] = size;
    this.floor[i] = floorY;
    this.life[i] = life;
    if (kind === 2) this.mesh.setColorAt(i, this.color.setHex(0xbfe6ff));
    else this.mesh.setColorAt(i, this.color.setHex(PUKE_COLORS[Math.floor(Math.random() * PUKE_COLORS.length)]));
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  /** Launches a stream of puke from Theo's mouth toward a landing point. */
  fire(start: () => THREE.Vector3, target: THREE.Vector3, spread: number, power: number, onLand: () => void) {
    const from = start();
    const distance = Math.hypot(target.x - from.x, target.z - from.z);
    this.shots.push({
      start,
      target: target.clone(),
      spread,
      power,
      flight: 0.32 + distance * 0.07,
      emitFor: 0.28 + power * 0.32,
      age: 0,
      emitAccumulator: 0,
      landed: false,
      onLand,
    });
  }

  splash(at: THREE.Vector3, count: number, strength = 1) {
    for (let i = 0; i < count; i += 1) {
      const a = rand(0, TAU);
      const s = rand(0.6, 2.2) * strength;
      this.spawn(1, at.x, at.y + 0.05, at.z, Math.cos(a) * s, rand(1.2, 3.2) * strength, Math.sin(a) * s, rand(0.025, 0.05), at.y, rand(0.5, 0.9));
    }
  }

  spray(origin: THREE.Vector3, dir: THREE.Vector3) {
    for (let i = 0; i < 10; i += 1) {
      const s = rand(2, 3.5);
      this.spawn(2, origin.x, origin.y, origin.z, dir.x * s + rand(-0.4, 0.4), dir.y * s + rand(-0.2, 0.4), dir.z * s + rand(-0.4, 0.4), rand(0.015, 0.03), -10, rand(0.35, 0.6));
    }
  }

  /** Puke on Eddie's face during the catch cutscene. */
  faceBlast(from: THREE.Vector3, to: THREE.Vector3) {
    for (let i = 0; i < 40; i += 1) {
      const t = 0.25;
      const vx = (to.x - from.x) / t + rand(-0.6, 0.6);
      const vy = (to.y - from.y) / t + 0.5 * GRAVITY * t + rand(-0.4, 0.6);
      const vz = (to.z - from.z) / t + rand(-0.6, 0.6);
      this.spawn(1, from.x, from.y, from.z, vx * rand(0.7, 1.1), vy, vz * rand(0.7, 1.1), rand(0.035, 0.07), 0.01, 1.4);
    }
  }

  // ---------------------------------------------------------------- surfaces

  splatSeat(seat: Seat) {
    const cushion = seat.cushion;
    cushion.updateMatrixWorld(true);
    const helper = new THREE.Object3D();
    helper.position.copy(seat.top);
    helper.lookAt(seat.top.x, seat.top.y + 1, seat.top.z);
    helper.rotateZ(rand(0, TAU));
    const size = new THREE.Vector3(0.98, 0.98, 0.7);
    const geo = new DecalGeometry(cushion, seat.top, helper.rotation, size);
    geo.computeBoundingBox();
    const center = new THREE.Vector3();
    geo.boundingBox?.getCenter(center);
    geo.translate(-center.x, -center.y, -center.z);
    const decal = new THREE.Mesh(geo, this.decalMaterials[Math.floor(Math.random() * this.decalMaterials.length)]);
    decal.position.copy(center);
    decal.scale.setScalar(0.2);
    decal.renderOrder = 2;
    decal.receiveShadow = true;
    this.scene.add(decal);
    seat.decals.push(decal);
    this.growing.push({ mesh: decal, age: 0, scale: 1 });
    this.drippers.push({ seat, time: 3.5, next: 0.2 });
  }

  clearSeat(seat: Seat) {
    for (const d of seat.decals) {
      d.removeFromParent();
      d.geometry.dispose();
    }
    seat.decals.length = 0;
  }

  addPuddle(at: THREE.Vector3, radius: number): Puddle {
    const material = this.decalMaterials[Math.floor(Math.random() * this.decalMaterials.length)];
    const mesh = new THREE.Mesh(this.puddleGeo, material);
    this.puddleLayer = (this.puddleLayer + 1) % 6;
    mesh.position.set(at.x, 0.014 + this.puddleLayer * 0.0015, at.z);
    mesh.rotation.y = rand(0, TAU);
    mesh.scale.setScalar(0.1);
    mesh.renderOrder = 2;
    mesh.receiveShadow = true;
    this.scene.add(mesh);
    const puddle: Puddle = { position: mesh.position.clone(), radius, active: true, mesh, age: 0, fade: 0 };
    this.puddles.push(puddle);
    this.growing.push({ mesh, age: 0, scale: radius * 2 });
    const live = this.puddles.filter((p) => p.active);
    if (live.length > 7) {
      live[0].active = false;
      live[0].fade = 1;
    }
    return puddle;
  }

  /** Eddie slid through it: smear and retire the puddle. */
  smear(puddle: Puddle, direction: number) {
    puddle.active = false;
    puddle.fade = 6;
    puddle.mesh.rotation.y = direction;
    puddle.mesh.scale.set(puddle.radius * 1.5, 1, puddle.radius * 4);
  }

  reset() {
    for (const p of this.puddles) p.mesh.removeFromParent();
    this.puddles.length = 0;
    this.growing.length = 0;
    this.drippers.length = 0;
    this.shots.length = 0;
    this.active.fill(0);
    this.hideAim();
  }

  // ---------------------------------------------------------------- aim visuals

  showArc(start: THREE.Vector3, target: THREE.Vector3, radius: number, time: number) {
    this.arcDots.visible = true;
    this.ring.visible = true;
    const n = this.arcDots.count;
    const peak = 0.6 + start.distanceTo(target) * 0.12;
    for (let i = 0; i < n; i += 1) {
      const t = (i + ((time * 3) % 1)) / n;
      this.dummy.position.set(
        start.x + (target.x - start.x) * t,
        start.y + (target.y - start.y) * t + Math.sin(t * Math.PI) * peak,
        start.z + (target.z - start.z) * t,
      );
      this.dummy.scale.setScalar(0.6 + t * 0.6);
      this.dummy.updateMatrix();
      this.arcDots.setMatrixAt(i, this.dummy.matrix);
    }
    this.arcDots.instanceMatrix.needsUpdate = true;
    this.ring.position.set(target.x, target.y + 0.03, target.z);
    const pulse = 1 + Math.sin(time * 10) * 0.04;
    this.ring.scale.setScalar(radius * pulse);
  }

  showReticle(seat: Seat | null, time: number) {
    if (!seat) {
      this.reticle.visible = false;
      return;
    }
    this.reticle.visible = true;
    this.reticle.position.set(seat.top.x, seat.top.y + 0.04, seat.top.z);
    const arrow = this.reticle.getObjectByName('arrow');
    if (arrow) {
      arrow.position.y = 0.65 + Math.sin(time * 6) * 0.08;
      arrow.rotation.y = time * 2;
    }
    const ring = this.reticle.getObjectByName('ring');
    if (ring) ring.scale.setScalar(1 + Math.sin(time * 8) * 0.06);
  }

  hideAim() {
    this.arcDots.visible = false;
    this.ring.visible = false;
    this.reticle.visible = false;
  }

  // ---------------------------------------------------------------- update

  update(dt: number) {
    // Streams.
    for (let s = this.shots.length - 1; s >= 0; s -= 1) {
      const shot = this.shots[s];
      shot.age += dt;
      if (shot.age < shot.emitFor) {
        const rate = 140 + shot.power * 160;
        shot.emitAccumulator += rate * dt;
        const from = shot.start();
        while (shot.emitAccumulator >= 1) {
          shot.emitAccumulator -= 1;
          const a = rand(0, TAU);
          const r = Math.sqrt(Math.random()) * shot.spread * 0.75;
          const tx = shot.target.x + Math.cos(a) * r;
          const tz = shot.target.z + Math.sin(a) * r;
          const t = shot.flight * rand(0.88, 1.08);
          const vx = (tx - from.x) / t;
          const vz = (tz - from.z) / t;
          const vy = (shot.target.y - from.y) / t + 0.5 * GRAVITY * t;
          this.spawn(0, from.x, from.y, from.z, vx, vy, vz, rand(0.04, 0.085) * (0.85 + shot.power * 0.5), shot.target.y, 3);
        }
      }
      if (!shot.landed && shot.age >= shot.flight) {
        shot.landed = true;
        shot.onLand();
      }
      if (shot.age > shot.emitFor + shot.flight + 0.3) this.shots.splice(s, 1);
    }

    // Drips off soaked seats.
    for (let i = this.drippers.length - 1; i >= 0; i -= 1) {
      const d = this.drippers[i];
      d.time -= dt;
      d.next -= dt;
      if (d.next <= 0) {
        d.next = rand(0.25, 0.6);
        const fx = Math.sin(d.seat.facing) * 0.4;
        const fz = Math.cos(d.seat.facing) * 0.4;
        this.spawn(1, d.seat.top.x + fx + rand(-0.25, 0.25), d.seat.top.y - 0.05, d.seat.top.z + fz + rand(-0.25, 0.25), 0, -0.2, 0, rand(0.02, 0.035), 0.01, 1.4);
      }
      if (d.time <= 0) this.drippers.splice(i, 1);
    }

    // Particles.
    const p = this.pos;
    const v = this.vel;
    for (let i = 0; i < MAX_PARTICLES; i += 1) {
      if (!this.active[i]) continue;
      this.life[i] -= dt;
      const k = this.kind[i];
      v[i * 3 + 1] -= GRAVITY * dt * (k === 2 ? 0.25 : 1);
      if (k === 2) {
        v[i * 3] *= 1 - dt * 3;
        v[i * 3 + 2] *= 1 - dt * 3;
      }
      p[i * 3] += v[i * 3] * dt;
      p[i * 3 + 1] += v[i * 3 + 1] * dt;
      p[i * 3 + 2] += v[i * 3 + 2] * dt;
      let scale = this.size[i];
      if (p[i * 3 + 1] <= this.floor[i] && v[i * 3 + 1] < 0) {
        if (k === 0) {
          if (Math.random() < 0.35) {
            const a = rand(0, TAU);
            this.spawn(1, p[i * 3], this.floor[i] + 0.02, p[i * 3 + 2], Math.cos(a) * rand(0.5, 1.5), rand(0.8, 2), Math.sin(a) * rand(0.5, 1.5), this.size[i] * 0.5, this.floor[i], 0.5);
          }
          this.active[i] = 0;
          scale = 0;
        } else {
          p[i * 3 + 1] = this.floor[i];
          v[i * 3] *= 0.3;
          v[i * 3 + 1] = 0;
          v[i * 3 + 2] *= 0.3;
        }
      }
      if (this.life[i] <= 0) {
        this.active[i] = 0;
        scale = 0;
      } else if (k !== 0) {
        scale *= clamp(this.life[i] * 3, 0, 1);
      }
      const speed = Math.hypot(v[i * 3], v[i * 3 + 1], v[i * 3 + 2]);
      this.dummy.position.set(p[i * 3], p[i * 3 + 1], p[i * 3 + 2]);
      const stretch = k === 0 ? 1 + Math.min(speed * 0.08, 0.9) : 1;
      this.dummy.scale.set(scale, scale * stretch, scale);
      if (speed > 0.01) this.dummy.lookAt(p[i * 3] + v[i * 3], p[i * 3 + 1] + v[i * 3 + 1], p[i * 3 + 2] + v[i * 3 + 2]);
      this.dummy.rotateX(Math.PI / 2);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);
      if (!this.active[i]) {
        this.dummy.scale.setScalar(0);
        this.dummy.updateMatrix();
        this.mesh.setMatrixAt(i, this.dummy.matrix);
      }
    }
    this.mesh.instanceMatrix.needsUpdate = true;

    // Growing decals and puddles.
    for (let i = this.growing.length - 1; i >= 0; i -= 1) {
      const g = this.growing[i];
      g.age += dt;
      const k = clamp(g.age / 0.32, 0, 1);
      const s = easeOutBack(k) * g.scale;
      g.mesh.scale.set(s, 1, s);
      if (g.mesh.geometry !== this.puddleGeo) g.mesh.scale.set(s, s, s);
      if (k >= 1) this.growing.splice(i, 1);
    }

    for (let i = this.puddles.length - 1; i >= 0; i -= 1) {
      const pd = this.puddles[i];
      pd.age += dt;
      if (!pd.active && pd.fade > 0) {
        pd.fade -= dt;
        if (pd.fade <= 0) {
          pd.mesh.removeFromParent();
          this.puddles.splice(i, 1);
        }
      }
    }
  }
}
