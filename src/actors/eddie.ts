import * as THREE from 'three';
import { EddieModel, type EddieAnim } from './eddieModel';
import { MASK_EDDIE, type Collision } from '../world/collision';
import { PATROL_POINTS } from '../world/layout';
import type { CouchState, Mood, Puddle, Seat } from '../game/types';
import { EDDIE } from '../data/lines';
import { clamp, dampAngle, dist2D, pick, rand, wrapAngle, yawTo } from '../core/util';

export type EddieState =
  | 'sleep'
  | 'wake'
  | 'patrol'
  | 'look'
  | 'investigate'
  | 'alert'
  | 'chase'
  | 'windup'
  | 'lunge'
  | 'recover'
  | 'search'
  | 'gotoClean'
  | 'clean'
  | 'mourn'
  | 'slip'
  | 'grab'
  | 'pukedOn';

export interface EddieHost {
  collision: Collision;
  seats: Seat[];
  puddles: Puddle[];
  theo: { position: THREE.Vector3; hidden: boolean; noisy: boolean };
  rage: number;
  say(text: string, mood: Mood, duration?: number): void;
  onAlert(): void;
  onSlip(puddle: Puddle): void;
  onCleaned(seat: Seat): void;
  onSpray(origin: THREE.Vector3, direction: THREE.Vector3): void;
  onWake(): void;
  onDirtySpotted(seat: Seat): void;
  onSnore(): void;
}

const ALERTABLE = new Set<EddieState>(['patrol', 'look', 'investigate', 'search', 'gotoClean', 'clean']);
const MOVING = new Set<EddieState>(['patrol', 'investigate', 'chase', 'search', 'gotoClean', 'lunge', 'recover']);

export class Eddie {
  readonly model = new EddieModel();
  readonly position = new THREE.Vector3();
  readonly radius = 0.4;
  facing = 0;
  state: EddieState = 'sleep';
  stateTime = 0;
  suspicion = 0;
  canSee = false;
  speedNow = 0;
  readonly lastSeen = new THREE.Vector3();
  timeSinceSeen = 99;
  readonly knownDirty = new Set<Seat>();

  private path: THREE.Vector2[] = [];
  private pathIndex = 0;
  private readonly goal = new THREE.Vector2();
  private hasGoal = false;
  private repathTimer = 0;
  private stuckTimer = 0;
  private readonly stuckAnchor = new THREE.Vector3();
  private cleaning: Seat | null = null;
  private readonly lungeDir = new THREE.Vector3();
  private lungeCooldown = 0;
  private slipImmunity = 0;
  private lineTimer = 2;
  private sleepTimer = 20;
  private snoreTimer = 1;
  private scanTimer = 0;
  private lastPatrol = -1;
  private pendingMourn: CouchState | null = null;
  private readonly noisePos = new THREE.Vector3();
  private hasNoise = false;
  private readonly bedPos = new THREE.Vector3();
  private bedFacing = 0;
  private bedSeat: Seat | null = null;
  private lookTotal = 1.3;

  constructor(private readonly host: EddieHost) {}

  reset(bed: Seat) {
    this.bedSeat = bed;
    const back = new THREE.Vector3(Math.sin(bed.facing), 0, Math.cos(bed.facing)).multiplyScalar(-0.12);
    this.bedPos.set(bed.top.x, 0, bed.top.z).add(back);
    this.bedFacing = bed.facing;
    this.position.copy(this.bedPos);
    this.facing = bed.facing;
    bed.occupied = true;
    this.knownDirty.clear();
    this.suspicion = 0;
    this.timeSinceSeen = 99;
    this.lungeCooldown = 0;
    this.slipImmunity = 0;
    this.pendingMourn = null;
    this.cleaning = null;
    this.hasNoise = false;
    this.sleepTimer = 25;
    this.setState('sleep');
    this.syncModel(0);
  }

  get rageLevel() {
    return this.host.rage;
  }

  private setState(state: EddieState) {
    this.state = state;
    this.stateTime = 0;
  }

  // ---------------------------------------------------------------- senses

  /** A noise in the world (puke, splat, squeaky toy). */
  hear(pos: THREE.Vector3, radius: number, kind: 'puke' | 'splat' | 'squeak') {
    const d = dist2D(pos.x, pos.z, this.position.x, this.position.z);
    const muffled = this.host.collision.lineOfSight(pos.x, pos.z, this.position.x, this.position.z) ? 1 : 0.72;
    const effective = radius * muffled * (1 + this.rageLevel * 0.08);
    if (d > effective) return;

    if (this.state === 'sleep') {
      if (d < effective * 0.85) {
        this.noisePos.copy(pos);
        this.hasNoise = true;
        this.wakeUp(true);
      }
      return;
    }
    if (this.state === 'chase' && !(kind === 'squeak' && !this.canSee)) return;
    if (!ALERTABLE.has(this.state) && this.state !== 'chase') return;

    this.investigate(pos, kind);
  }

  private investigate(pos: THREE.Vector3, kind: 'puke' | 'splat' | 'squeak' | 'couch') {
    const already = this.state === 'investigate' && dist2D(pos.x, pos.z, this.goal.x, this.goal.y) < 1.5;
    if (this.state !== 'investigate') {
      this.host.say(kind === 'squeak' ? EDDIE.squeak.next() : EDDIE.investigate.next(), kind === 'squeak' ? 'calm' : 'angry', 2.2);
    }
    this.setState('investigate');
    if (!already) this.goTo(pos.x, pos.z);
  }

  private wakeUp(startled: boolean) {
    if (this.state !== 'sleep') return;
    this.setState('wake');
    this.host.say(startled ? EDDIE.wake.next() : EDDIE.alarm.next(), startled ? 'shout' : 'calm', 2.4);
    this.host.onWake();
  }

  private checkVision() {
    const theo = this.host.theo;
    if (theo.hidden) return false;
    const range = 7.4 + this.rageLevel * 0.55;
    const dx = theo.position.x - this.position.x;
    const dz = theo.position.z - this.position.z;
    const d = Math.hypot(dx, dz);
    if (d > range) return false;
    if (d > 1.7) {
      const angle = Math.abs(wrapAngle(Math.atan2(dx, dz) - this.facing));
      if (angle > (Math.PI / 180) * 62) return false;
    }
    return this.host.collision.lineOfSight(this.position.x, this.position.z, theo.position.x, theo.position.z);
  }

  private scanForDirtySeats() {
    for (const seat of this.host.seats) {
      if (!seat.puked || seat.couch.ruined || this.knownDirty.has(seat)) continue;
      const dx = seat.top.x - this.position.x;
      const dz = seat.top.z - this.position.z;
      const d = Math.hypot(dx, dz);
      if (d > 7.5) continue;
      if (d > 1.5 && Math.abs(wrapAngle(Math.atan2(dx, dz) - this.facing)) > 1.1) continue;
      if (!this.host.collision.lineOfSight(this.position.x, this.position.z, seat.top.x, seat.top.z)) continue;
      this.knownDirty.add(seat);
      this.host.onDirtySpotted(seat);
    }
  }

  // ---------------------------------------------------------------- external triggers

  mourn(couch: CouchState) {
    for (const seat of couch.seats) this.knownDirty.delete(seat);
    if (this.state === 'grab' || this.state === 'pukedOn' || this.state === 'slip' || this.state === 'mourn') {
      this.pendingMourn = couch;
      return;
    }
    if (this.state === 'sleep') this.releaseBed();
    this.startMourn(couch);
  }

  private startMourn(couch: CouchState) {
    this.pendingMourn = null;
    this.setState('mourn');
    this.noisePos.copy(couch.center);
    this.hasNoise = true;
    this.host.say(couch.def.mourn, 'sad', 2.8);
  }

  startGrab(theoPos: THREE.Vector3) {
    if (this.state === 'sleep') this.releaseBed();
    this.setState('grab');
    this.facing = yawTo(this.position.x, this.position.z, theoPos.x, theoPos.z);
    this.host.say(EDDIE.catch.next(), 'shout', 2);
  }

  startPukedOn() {
    this.setState('pukedOn');
    this.model.slimed = 1;
    this.host.say(EDDIE.pukedOn.next(), 'sad', 2.6);
    this.suspicion = 0;
    this.timeSinceSeen = 99;
  }

  private releaseBed() {
    if (this.bedSeat) this.bedSeat.occupied = false;
    const front = this.bedSeat?.front ?? this.position;
    this.position.set(front.x, 0, front.z);
    this.host.collision.pushOut(this.position, this.radius, MASK_EDDIE);
  }

  // ---------------------------------------------------------------- movement

  private goTo(x: number, z: number) {
    this.goal.set(x, z);
    this.hasGoal = true;
    this.path = this.host.collision.findPath(this.position.x, this.position.z, x, z) ?? [];
    this.pathIndex = 0;
    this.stuckTimer = 0;
    this.stuckAnchor.copy(this.position);
  }

  /** Returns true when the goal is reached (or unreachable). */
  private follow(dt: number, speed: number): boolean {
    if (!this.hasGoal) return true;
    if (this.pathIndex >= this.path.length) {
      this.speedNow = 0;
      return true;
    }
    const target = this.path[this.pathIndex];
    const dx = target.x - this.position.x;
    const dz = target.y - this.position.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.22) {
      this.pathIndex += 1;
      return this.pathIndex >= this.path.length;
    }
    const step = Math.min(d, speed * dt);
    this.host.collision.move(this.position, (dx / d) * step, (dz / d) * step, this.radius, MASK_EDDIE);
    this.facing = dampAngle(this.facing, Math.atan2(dx, dz), 10, dt);
    this.speedNow = speed;

    this.stuckTimer += dt;
    if (this.stuckTimer > 0.7) {
      if (this.stuckAnchor.distanceTo(this.position) < 0.12) {
        this.goTo(this.goal.x, this.goal.y);
        if (this.path.length === 0) return true;
      }
      this.stuckTimer = 0;
      this.stuckAnchor.copy(this.position);
    }
    return false;
  }

  private pickPatrolPoint() {
    const theo = this.host.theo.position;
    const hunch = Math.random() < 0.28 + this.rageLevel * 0.1;
    let best = -1;
    if (hunch) {
      let bestD = Infinity;
      PATROL_POINTS.forEach(([x, z], i) => {
        const d = dist2D(x, z, theo.x, theo.z) + rand(0, 2);
        if (i !== this.lastPatrol && d < bestD) {
          bestD = d;
          best = i;
        }
      });
    } else {
      const options = PATROL_POINTS.map((_, i) => i).filter(
        (i) => i !== this.lastPatrol && dist2D(PATROL_POINTS[i][0], PATROL_POINTS[i][1], this.position.x, this.position.z) > 3.5,
      );
      best = options.length ? pick(options) : Math.floor(Math.random() * PATROL_POINTS.length);
    }
    this.lastPatrol = best;
    const [x, z] = PATROL_POINTS[best];
    this.goTo(x, z);
  }

  private nextDirtySeat(): Seat | null {
    let best: Seat | null = null;
    let bestD = Infinity;
    for (const seat of this.knownDirty) {
      if (!seat.puked || seat.couch.ruined) {
        this.knownDirty.delete(seat);
        continue;
      }
      const d = dist2D(seat.front.x, seat.front.z, this.position.x, this.position.z);
      if (d < bestD) {
        bestD = d;
        best = seat;
      }
    }
    return best;
  }

  private beginPatrol() {
    const dirty = this.nextDirtySeat();
    if (dirty) {
      this.cleaning = dirty;
      this.setState('gotoClean');
      this.goTo(dirty.front.x, dirty.front.z);
      return;
    }
    this.setState('patrol');
    this.pickPatrolPoint();
  }

  private startChase() {
    this.setState('chase');
    this.repathTimer = 0;
    this.lineTimer = rand(1.5, 3);
  }

  // ---------------------------------------------------------------- update

  update(dt: number) {
    this.stateTime += dt;
    this.lungeCooldown -= dt;
    this.slipImmunity -= dt;
    this.speedNow = 0;
    const theo = this.host.theo;

    const awake = this.state !== 'sleep' && this.state !== 'wake' && this.state !== 'grab' && this.state !== 'pukedOn' && this.state !== 'slip' && this.state !== 'mourn';
    this.canSee = awake && this.checkVision();
    if (this.canSee) {
      this.lastSeen.copy(theo.position);
      this.timeSinceSeen = 0;
    } else {
      this.timeSinceSeen += dt;
    }

    if (ALERTABLE.has(this.state)) {
      if (this.canSee) {
        const d = dist2D(theo.position.x, theo.position.z, this.position.x, this.position.z);
        const range = 7.4 + this.rageLevel * 0.55;
        let rate = 1.5 + (1 - d / range) * 4.5;
        if (this.state === 'investigate' || this.state === 'search') rate *= 1.6;
        if (theo.noisy) rate *= 2;
        this.suspicion = Math.min(1, this.suspicion + rate * dt);
        if (this.suspicion >= 1) {
          this.setState('alert');
          this.cleaning = null;
          this.host.say(EDDIE.spot.next(), 'shout', 1.8);
          this.host.onAlert();
        }
      } else {
        this.suspicion = Math.max(0, this.suspicion - dt * 0.35);
      }
    } else if (this.state === 'chase' || this.state === 'windup' || this.state === 'lunge' || this.state === 'recover' || this.state === 'alert') {
      this.suspicion = 1;
    }

    if (awake) {
      this.scanTimer -= dt;
      if (this.scanTimer <= 0) {
        this.scanTimer = 0.4;
        this.scanForDirtySeats();
      }
    }

    // Slip on puke puddles.
    if (MOVING.has(this.state) && this.slipImmunity <= 0) {
      for (const p of this.host.puddles) {
        if (!p.active) continue;
        if (dist2D(p.position.x, p.position.z, this.position.x, this.position.z) < p.radius * 0.8) {
          this.setState('slip');
          this.host.say(EDDIE.slip.next(), 'shout', 1.6);
          this.host.onSlip(p);
          break;
        }
      }
    }

    switch (this.state) {
      case 'sleep': {
        this.position.copy(this.bedPos);
        this.facing = this.bedFacing;
        this.sleepTimer -= dt;
        this.snoreTimer -= dt;
        if (this.snoreTimer <= 0) {
          this.snoreTimer = 3.2;
          this.host.onSnore();
          if (Math.random() < 0.45) this.host.say(EDDIE.snore.next(), 'sleepy', 2.4);
        }
        if (this.sleepTimer <= 0) this.wakeUp(false);
        break;
      }
      case 'wake': {
        const k = clamp(this.stateTime / 1.5, 0, 1);
        const front = this.bedSeat?.front ?? this.bedPos;
        this.position.lerpVectors(this.bedPos, new THREE.Vector3(front.x, 0, front.z), k);
        if (this.stateTime > 1.6) {
          this.releaseBed();
          if (this.hasNoise) {
            this.hasNoise = false;
            this.setState('investigate');
            this.goTo(this.noisePos.x, this.noisePos.z);
          } else {
            this.beginPatrol();
          }
        }
        break;
      }
      case 'patrol': {
        if (this.knownDirty.size > 0) {
          this.beginPatrol();
          break;
        }
        if (this.follow(dt, 1.9 + this.rageLevel * 0.12)) {
          this.setState('look');
          this.lookTotal = rand(1.0, 1.8);
        }
        break;
      }
      case 'look': {
        this.facing += Math.sin(this.stateTime * 2.4) * dt * 1.4;
        if (this.stateTime > this.lookTotal) this.beginPatrol();
        break;
      }
      case 'investigate': {
        if (this.follow(dt, 2.5 + this.rageLevel * 0.15)) {
          this.setState('look');
          this.lookTotal = 2.0;
        }
        break;
      }
      case 'alert': {
        this.facing = dampAngle(this.facing, yawTo(this.position.x, this.position.z, theo.position.x, theo.position.z), 14, dt);
        if (this.stateTime > 0.5) this.startChase();
        break;
      }
      case 'chase': {
        const target = this.canSee ? theo.position : this.lastSeen;
        this.repathTimer -= dt;
        if (this.repathTimer <= 0) {
          this.repathTimer = this.canSee ? 0.22 : 0.5;
          this.goTo(target.x, target.z);
        }
        const speed = 3.35 + this.rageLevel * 0.22;
        const arrived = this.follow(dt, speed);
        const d = dist2D(theo.position.x, theo.position.z, this.position.x, this.position.z);
        if (this.canSee && d < 2.4 && d > 0.9 && this.lungeCooldown <= 0) {
          this.setState('windup');
          this.lungeDir.set(theo.position.x - this.position.x, 0, theo.position.z - this.position.z).normalize();
          break;
        }
        this.lineTimer -= dt;
        if (this.lineTimer <= 0) {
          this.lineTimer = rand(3.2, 5.2);
          this.host.say(EDDIE.chase.next(), 'angry', 2.2);
        }
        if (!this.canSee && (this.timeSinceSeen > 2.4 || arrived)) {
          this.setState('search');
          this.goTo(this.lastSeen.x, this.lastSeen.z);
          this.host.say(EDDIE.lost.next(), 'calm', 2.2);
        }
        break;
      }
      case 'windup': {
        // Telegraph: crouch, then commit to a direction.
        this.lungeDir.set(theo.position.x - this.position.x, 0, theo.position.z - this.position.z).normalize();
        this.facing = dampAngle(this.facing, Math.atan2(this.lungeDir.x, this.lungeDir.z), 12, dt);
        if (this.stateTime > 0.36) {
          this.setState('lunge');
          this.lungeDir.set(Math.sin(this.facing), 0, Math.cos(this.facing));
        }
        break;
      }
      case 'lunge': {
        const speed = 7.6;
        this.host.collision.move(this.position, this.lungeDir.x * speed * dt, this.lungeDir.z * speed * dt, this.radius, MASK_EDDIE);
        this.speedNow = speed;
        if (this.stateTime > 0.38) this.setState('recover');
        break;
      }
      case 'recover': {
        this.speedNow = 0.6;
        this.host.collision.move(this.position, this.lungeDir.x * 0.6 * dt, this.lungeDir.z * 0.6 * dt, this.radius, MASK_EDDIE);
        if (this.stateTime > 0.6) {
          this.lungeCooldown = 2.0;
          this.startChase();
        }
        break;
      }
      case 'search': {
        if (this.follow(dt, 2.6 + this.rageLevel * 0.12)) {
          this.setState('look');
          this.lookTotal = 2.4;
        }
        break;
      }
      case 'gotoClean': {
        const seat = this.cleaning;
        if (!seat || !seat.puked || seat.couch.ruined) {
          this.cleaning = null;
          this.beginPatrol();
          break;
        }
        if (this.follow(dt, 2.4 + this.rageLevel * 0.1)) {
          if (dist2D(seat.front.x, seat.front.z, this.position.x, this.position.z) < 1.4) {
            this.setState('clean');
            this.host.say(EDDIE.clean.next(), 'calm', 2.6);
          } else {
            // Couldn't reach it; forget it for now.
            this.knownDirty.delete(seat);
            this.cleaning = null;
            this.beginPatrol();
          }
        }
        break;
      }
      case 'clean': {
        const seat = this.cleaning;
        if (!seat || !seat.puked || seat.couch.ruined) {
          this.cleaning = null;
          this.beginPatrol();
          break;
        }
        this.facing = dampAngle(this.facing, yawTo(this.position.x, this.position.z, seat.top.x, seat.top.z), 8, dt);
        if (Math.floor(this.stateTime * 3) !== Math.floor((this.stateTime - dt) * 3)) {
          const nozzle = this.model.nozzle.getWorldPosition(new THREE.Vector3());
          const dir = new THREE.Vector3(seat.top.x - nozzle.x, seat.top.y - nozzle.y, seat.top.z - nozzle.z).normalize();
          this.host.onSpray(nozzle, dir);
        }
        if (this.stateTime > 3.0) {
          this.host.onCleaned(seat);
          this.knownDirty.delete(seat);
          this.cleaning = null;
          this.host.say(EDDIE.cleaned.next(), 'calm', 1.8);
          this.beginPatrol();
        }
        break;
      }
      case 'mourn': {
        if (this.stateTime > 2.6) {
          if (this.checkVision()) {
            this.startChase();
          } else if (this.hasNoise) {
            this.hasNoise = false;
            this.setState('investigate');
            this.goTo(this.noisePos.x, this.noisePos.z);
          } else {
            this.beginPatrol();
          }
        }
        break;
      }
      case 'slip': {
        if (this.stateTime > 2.6) {
          this.slipImmunity = 1.6;
          if (this.pendingMourn) {
            this.startMourn(this.pendingMourn);
          } else if (this.checkVision()) {
            this.startChase();
          } else {
            this.setState('search');
            this.goTo(this.lastSeen.x, this.lastSeen.z);
          }
        }
        break;
      }
      case 'grab':
        break;
      case 'pukedOn': {
        this.model.slimed = Math.max(0.35, 1 - this.stateTime * 0.15);
        if (this.stateTime > 3.2) {
          if (this.pendingMourn) this.startMourn(this.pendingMourn);
          else this.beginPatrol();
        }
        break;
      }
    }

    this.syncModel(dt);
  }

  /** Animate without thinking (title screen, victory). */
  animateOnly(dt: number) {
    this.syncModel(dt);
  }

  private syncModel(dt: number) {
    this.model.root.position.copy(this.position);
    this.model.root.rotation.y = this.facing;
    this.model.rage = clamp(this.rageLevel / 4 + (this.state === 'chase' ? 0.15 : 0), 0, 1);
    if (this.state !== 'pukedOn') this.model.slimed = Math.max(0, this.model.slimed - dt * 0.02);
    this.model.animate(dt, this.animName(), this.stateTime, this.speedNow);
  }

  private animName(): EddieAnim {
    switch (this.state) {
      case 'sleep':
        return 'sleep';
      case 'wake':
        return 'wake';
      case 'look':
        return 'look';
      case 'alert':
        return 'alert';
      case 'chase':
        return this.speedNow > 0.1 ? 'run' : 'idle';
      case 'windup':
        return 'windup';
      case 'lunge':
        return 'lunge';
      case 'recover':
        return 'recover';
      case 'clean':
        return 'scrub';
      case 'mourn':
        return this.stateTime < 1.5 ? 'mourn' : 'cry';
      case 'slip':
        return 'slip';
      case 'grab':
        return 'lift';
      case 'pukedOn':
        return 'pukedOn';
      default:
        return this.speedNow > 0.1 ? 'walk' : 'idle';
    }
  }

  /** Human-readable status for the HUD. */
  status(): { label: string; tone: 'calm' | 'warn' | 'danger' | 'good' } {
    switch (this.state) {
      case 'sleep':
        return { label: 'NAPPING', tone: 'good' };
      case 'wake':
        return { label: 'WAKING UP', tone: 'warn' };
      case 'patrol':
      case 'look':
        return this.suspicion > 0.2 ? { label: 'SUSPICIOUS', tone: 'warn' } : { label: 'PATROLLING', tone: 'calm' };
      case 'investigate':
        return { label: 'INVESTIGATING', tone: 'warn' };
      case 'search':
        return { label: 'SEARCHING', tone: 'warn' };
      case 'gotoClean':
      case 'clean':
        return { label: 'CLEANING', tone: 'warn' };
      case 'alert':
      case 'chase':
      case 'windup':
      case 'lunge':
      case 'recover':
        return { label: 'CHASING YOU', tone: 'danger' };
      case 'mourn':
        return { label: 'GRIEVING', tone: 'good' };
      case 'slip':
        return { label: 'SLIPPED!', tone: 'good' };
      case 'grab':
        return { label: 'GOT YOU', tone: 'danger' };
      case 'pukedOn':
        return { label: 'WIPING FACE', tone: 'good' };
    }
  }

  get chasing() {
    return this.state === 'chase' || this.state === 'windup' || this.state === 'lunge' || this.state === 'recover' || this.state === 'alert';
  }

  /** Eddie can only catch Theo while actually pursuing or wandering upright. */
  get canCatch() {
    return ['patrol', 'look', 'investigate', 'chase', 'windup', 'lunge', 'recover', 'search', 'gotoClean', 'clean', 'alert'].includes(this.state);
  }
}
