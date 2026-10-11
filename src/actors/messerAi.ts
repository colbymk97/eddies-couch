import * as THREE from 'three';
import type { Messer, MessControls } from './messer';
import type { MesserId } from './cast';
import type { Collision } from '../world/collision';
import type { Seat } from '../game/types';
import type { Pickups } from '../game/pickups';
import { PATROL_POINTS } from '../world/layout';
import { clamp, dist2D, rand, yawTo } from '../core/util';

/** What a computer-controlled mess-maker knows about the world. */
export interface AiView {
  collision: Collision;
  seats: Seat[];
  pickups: Pickups;
  toilets: { front: THREE.Vector3 }[];
  eddie: {
    position: THREE.Vector3;
    awake: boolean;
    chasing: boolean;
    target: MesserId | null;
    driven: boolean;
  };
  /** The other mess-maker's current seat, so they spread out. */
  partnerSeat: Seat | null;
  /** Seconds between shots, [min, max]. */
  fireRate: [number, number];
  /** Chance a shot is a charged mega when seats are clustered. */
  megaChance: number;
}

export type AiFire = { kind: 'quick'; seat: Seat } | { kind: 'mega'; yaw: number; level: number };

export interface AiIntent {
  controls: MessControls;
  fire: AiFire | null;
  throwToy: boolean;
}

type Mode = 'seek' | 'flee' | 'eat' | 'toilet' | 'hide';

export class MesserBrain {
  mode: Mode = 'seek';
  seat: Seat | null = null;
  private readonly goal = new THREE.Vector3();
  private path: THREE.Vector2[] = [];
  private pathIndex = 0;
  private repath = 0;
  private think = 0;
  private hideTimer = 0;
  private stuck = 0;
  private readonly stuckAnchor = new THREE.Vector3();
  private readonly controls: MessControls = { move: new THREE.Vector2(), sprint: false, face: null };
  private readonly intent: AiIntent = { controls: this.controls, fire: null, throwToy: false };

  reset() {
    this.mode = 'seek';
    this.seat = null;
    this.path = [];
    this.pathIndex = 0;
    this.repath = 0;
    this.think = rand(0.2, 0.8);
    this.hideTimer = 0;
  }

  update(dt: number, m: Messer, v: AiView): AiIntent {
    const c = this.controls;
    c.move.set(0, 0);
    c.sprint = false;
    c.face = null;
    this.intent.fire = null;
    this.intent.throwToy = false;
    if (!m.active || m.frozen > 0) return this.intent;

    const eddieD = dist2D(m.position.x, m.position.z, v.eddie.position.x, v.eddie.position.z);
    const eddieSeesMe = v.eddie.awake && eddieD < 7 && v.collision.lineOfSight(m.position.x, m.position.z, v.eddie.position.x, v.eddie.position.z);
    const threatened =
      (v.eddie.chasing && v.eddie.target === m.id && eddieD < 9) ||
      (v.eddie.driven && eddieSeesMe && eddieD < 4.2) ||
      (v.eddie.awake && eddieD < 2.0);

    this.think -= dt;
    this.repath -= dt;
    if (this.think <= 0) {
      this.think = 0.45;
      this.choose(m, v, threatened);
    }

    switch (this.mode) {
      case 'toilet':
      case 'eat':
        this.steer(dt, m, v, false);
        break;
      case 'flee': {
        this.steer(dt, m, v, true);
        if (m.hasToy && eddieD < 5 && Math.random() < dt * 1.5) this.intent.throwToy = true;
        break;
      }
      case 'hide': {
        // Tucked under furniture: sit tight until the coast is clear.
        if (!m.hidden) this.steer(dt, m, v, true);
        this.hideTimer -= dt;
        break;
      }
      case 'seek': {
        const seat = this.seat;
        if (!seat) break;
        const d = dist2D(m.position.x, m.position.z, seat.top.x, seat.top.z);
        const inRange = d < 2.5 && v.collision.lineOfSight(m.position.x, m.position.z, seat.top.x, seat.top.z);
        if (inRange) {
          c.face = yawTo(m.position.x, m.position.z, seat.top.x, seat.top.z);
          if (m.fireCooldown <= 0 && (m.ammo >= 12 || m.burrito > 0)) {
            m.fireCooldown = rand(v.fireRate[0], v.fireRate[1]);
            this.intent.fire = this.planShot(m, v, seat, d);
          }
        } else {
          this.steer(dt, m, v, false);
        }
        break;
      }
    }
    return this.intent;
  }

  private planShot(m: Messer, v: AiView, seat: Seat, d: number): AiFire {
    // A mega shot when a few fresh seats sit close together.
    const cluster = v.seats.filter((s) => !s.messed && !s.occupied && !s.couch.ruined && dist2D(s.top.x, s.top.z, seat.top.x, seat.top.z) < 1.25).length;
    if (cluster >= 2 && (m.burrito > 0 || m.ammo > 55) && Math.random() < v.megaChance) {
      const level = clamp((d - 2.4) / 5.6, 0.12, 1);
      return { kind: 'mega', yaw: yawTo(m.position.x, m.position.z, seat.top.x, seat.top.z), level };
    }
    return { kind: 'quick', seat };
  }

  private choose(m: Messer, v: AiView, threatened: boolean) {
    const prev = this.mode;
    if (m.emergency > 0) {
      this.mode = 'toilet';
      let best = v.toilets[0].front;
      let bestD = Infinity;
      for (const t of v.toilets) {
        const d = dist2D(t.front.x, t.front.z, m.position.x, m.position.z);
        if (d < bestD) {
          bestD = d;
          best = t.front;
        }
      }
      this.setGoal(m, v, best.x, best.z, prev !== 'toilet');
      return;
    }
    if (this.mode === 'hide' && m.hidden && (this.hideTimer > 0 || threatened)) return;
    if (threatened) {
      this.flee(m, v, prev);
      return;
    }
    if (m.ammo < 30 && m.burrito <= 0) {
      const food = v.pickups.nearest(m.position, ['food', 'feast', 'burrito']);
      if (food) {
        this.mode = 'eat';
        this.setGoal(m, v, food.x, food.z, prev !== 'eat' || food.distanceTo(this.goal) > 0.5);
        return;
      }
    }
    this.mode = 'seek';
    if (!this.seat || this.seat.messed || this.seat.couch.ruined || this.seat.occupied || prev !== 'seek' || Math.random() < 0.05) {
      this.seat = this.pickSeat(m, v);
      if (this.seat) this.setGoal(m, v, this.seat.front.x, this.seat.front.z, true);
    } else if (this.repath <= 0 && this.seat) {
      this.setGoal(m, v, this.seat.front.x, this.seat.front.z, true);
    }
  }

  private flee(m: Messer, v: AiView, prev: Mode) {
    const e = v.eddie.position;
    const toEddie = new THREE.Vector2(e.x - m.position.x, e.z - m.position.z).normalize();
    let best: [number, number] | null = null;
    let bestScore = -Infinity;
    let hiding = false;
    const consider = (x: number, z: number, bonus: number, hide: boolean) => {
      const dMe = dist2D(x, z, m.position.x, m.position.z);
      if (dMe < 1.2) return;
      const away = new THREE.Vector2(x - m.position.x, z - m.position.z).normalize();
      if (away.dot(toEddie) > 0.35) return;
      const score = dist2D(x, z, e.x, e.z) * 1.0 - dMe * 0.55 + bonus + rand(0, 0.8);
      if (score > bestScore) {
        bestScore = score;
        best = [x, z];
        hiding = hide;
      }
    };
    for (const [x, z] of PATROL_POINTS) consider(x, z, 0, false);
    if (m.id === 'theo') {
      for (const h of v.collision.hideZones) {
        const x = (h.minX + h.maxX) / 2;
        const z = (h.minZ + h.maxZ) / 2;
        if (dist2D(x, z, m.position.x, m.position.z) < 7) consider(x, z, 5, true);
      }
    }
    if (!best) {
      // Cornered: just run directly away.
      best = [m.position.x - toEddie.x * 3, m.position.z - toEddie.y * 3];
    }
    const [x, z] = best;
    this.mode = hiding ? 'hide' : 'flee';
    if (hiding) this.hideTimer = rand(3, 5);
    const changed = prev !== this.mode || dist2D(x, z, this.goal.x, this.goal.z) > 1.5;
    this.setGoal(m, v, x, z, changed || this.repath <= 0);
  }

  private pickSeat(m: Messer, v: AiView): Seat | null {
    let best: Seat | null = null;
    let bestScore = Infinity;
    const e = v.eddie.position;
    for (const seat of v.seats) {
      if (seat.messed || seat.occupied || seat.couch.ruined) continue;
      const d = dist2D(seat.front.x, seat.front.z, m.position.x, m.position.z);
      const fromEddie = dist2D(seat.front.x, seat.front.z, e.x, e.z);
      const done = seat.couch.seats.filter((s) => s.messed).length / seat.couch.seats.length;
      let score = d - done * 5 + rand(0, 3);
      if (v.eddie.awake && fromEddie < 4) score += (4 - fromEddie) * 2.5;
      if (v.partnerSeat && v.partnerSeat.couch === seat.couch && done < 0.5) score += 3;
      if (score < bestScore) {
        bestScore = score;
        best = seat;
      }
    }
    return best;
  }

  private setGoal(m: Messer, v: AiView, x: number, z: number, force: boolean) {
    if (!force && this.repath > 0) return;
    this.goal.set(x, 0, z);
    this.path = v.collision.findPath(m.position.x, m.position.z, x, z) ?? [];
    this.pathIndex = 0;
    this.repath = 1.2;
    this.stuck = 0;
    this.stuckAnchor.copy(m.position);
  }

  private steer(dt: number, m: Messer, v: AiView, hurry: boolean) {
    const c = this.controls;
    let tx = this.goal.x;
    let tz = this.goal.z;
    while (this.pathIndex < this.path.length) {
      const p = this.path[this.pathIndex];
      if (dist2D(p.x, p.y, m.position.x, m.position.z) < 0.3) this.pathIndex += 1;
      else {
        tx = p.x;
        tz = p.y;
        break;
      }
    }
    const dx = tx - m.position.x;
    const dz = tz - m.position.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.12) return;
    const throttle = d < 0.6 && this.pathIndex >= this.path.length ? 0.6 : 1;
    c.move.set((dx / d) * throttle, (dz / d) * throttle);
    c.sprint = hurry && m.stamina > 0.15;

    this.stuck += dt;
    if (this.stuck > 1) {
      if (this.stuckAnchor.distanceTo(m.position) < 0.15) {
        this.repath = 0;
        this.setGoal(m, v, this.goal.x, this.goal.z, true);
        // Wiggle free.
        c.move.set(rand(-1, 1), rand(-1, 1));
      }
      this.stuck = 0;
      this.stuckAnchor.copy(m.position);
    }
  }
}
