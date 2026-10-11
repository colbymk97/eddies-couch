import * as THREE from 'three';
import { HumanRig, type Anim } from './rig';
import { EDDIE_SPEC, type MesserId } from './cast';
import { MASK_EDDIE, type Collision } from '../world/collision';
import { PATROL_POINTS } from '../world/layout';
import type { CouchState, Mood, Puddle, Seat } from '../game/types';
import { EDDIE } from '../data/lines';
import { clamp, damp, dampAngle, dist2D, pick, rand, wrapAngle, yawTo } from '../core/util';

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
  | 'stunned'
  | 'grab'
  | 'pukedOn'
  | 'yell'
  | 'celebrate';

/** Somebody Eddie might chase. */
export interface EddieTarget {
  id: MesserId;
  position: THREE.Vector3;
  /** Under a table, in the bathroom, in time-out: Eddie can't see them. */
  hidden: boolean;
  noisy: boolean;
  catchable: boolean;
  onToilet: boolean;
}

export interface EddieHost {
  collision: Collision;
  seats: Seat[];
  puddles: Puddle[];
  targets: EddieTarget[];
  rage: number;
  say(text: string, mood: Mood, duration?: number): void;
  onAlert(target: EddieTarget): void;
  onSlip(puddle: Puddle): void;
  onCleaned(seat: Seat): void;
  onSpray(origin: THREE.Vector3, direction: THREE.Vector3): void;
  onWake(): void;
  onDirtySpotted(seat: Seat): void;
  onSnore(): void;
}

/** What the player asks of Eddie this frame when they are Eddie. */
export interface EddieDrive {
  move: THREE.Vector2;
  sprint: boolean;
  aimYaw: number;
  lunge: boolean;
  yell: boolean;
  /** Where to scrub (a stained seat or a puddle), if the action is held next to one. */
  scrub: THREE.Vector3 | null;
}

const ALERTABLE = new Set<EddieState>(['patrol', 'look', 'investigate', 'search', 'gotoClean', 'clean']);
const MOVING = new Set<EddieState>(['patrol', 'investigate', 'chase', 'search', 'gotoClean', 'lunge', 'recover']);
const SIGHT_RANGE = 7.4;

export class Eddie {
  readonly model = new HumanRig(EDDIE_SPEC);
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
  /** Who he is after right now. */
  target: EddieTarget | null = null;
  /** True when the player is Eddie. */
  driven = false;
  /** Who he's holding during a grab. */
  grabbing: MesserId | null = null;
  stamina = 1;
  tired = false;
  lungeCooldown = 0;
  yellCooldown = 0;

  private path: THREE.Vector2[] = [];
  private pathIndex = 0;
  private readonly goal = new THREE.Vector2();
  private hasGoal = false;
  private repathTimer = 0;
  private stuckTimer = 0;
  private readonly stuckAnchor = new THREE.Vector3();
  private cleaning: Seat | null = null;
  private readonly lungeDir = new THREE.Vector3();
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
  private readonly vel = new THREE.Vector3();
  private animName: Anim = 'idle';
  private animTime = 0;

  constructor(private readonly host: EddieHost) {}

  reset(bed: Seat, asleep: boolean, spawn?: { x: number; z: number }) {
    this.bedSeat = bed;
    const back = new THREE.Vector3(Math.sin(bed.facing), 0, Math.cos(bed.facing)).multiplyScalar(-0.12);
    this.bedPos.set(bed.top.x, 0, bed.top.z).add(back);
    this.bedFacing = bed.facing;
    this.knownDirty.clear();
    this.suspicion = 0;
    this.timeSinceSeen = 99;
    this.lungeCooldown = 0;
    this.yellCooldown = 0;
    this.slipImmunity = 0;
    this.pendingMourn = null;
    this.cleaning = null;
    this.hasNoise = false;
    this.target = null;
    this.stamina = 1;
    this.tired = false;
    this.vel.set(0, 0, 0);
    this.sleepTimer = 25;
    this.model.slimed = 0;
    this.model.rage = 0;
    if (asleep) {
      this.position.copy(this.bedPos);
      this.facing = bed.facing;
      bed.occupied = true;
      this.setState('sleep');
    } else {
      bed.occupied = false;
      this.position.set(spawn?.x ?? bed.front.x, 0, spawn?.z ?? bed.front.z);
      this.facing = 0;
      this.setState('patrol');
      this.hasGoal = false;
    }
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
    if (this.driven) return;
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

  private sees(t: EddieTarget, range: number) {
    if (t.hidden) return false;
    const dx = t.position.x - this.position.x;
    const dz = t.position.z - this.position.z;
    const d = Math.hypot(dx, dz);
    if (d > range) return false;
    if (d > 1.7) {
      const angle = Math.abs(wrapAngle(Math.atan2(dx, dz) - this.facing));
      if (angle > (Math.PI / 180) * 62) return false;
    }
    return this.host.collision.lineOfSight(this.position.x, this.position.z, t.position.x, t.position.z);
  }

  /** The nearest visible mess-maker, if any. */
  private lookAround(): EddieTarget | null {
    const range = SIGHT_RANGE + this.rageLevel * 0.55;
    let best: EddieTarget | null = null;
    let bestD = Infinity;
    for (const t of this.host.targets) {
      if (!t.catchable || !this.sees(t, range)) continue;
      const d = dist2D(t.position.x, t.position.z, this.position.x, this.position.z);
      if (d < bestD) {
        bestD = d;
        best = t;
      }
    }
    return best;
  }

  private scanForDirtySeats() {
    for (const seat of this.host.seats) {
      if (!seat.messed || seat.couch.ruined || this.knownDirty.has(seat)) continue;
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
    if (this.state === 'grab' || this.state === 'pukedOn' || this.state === 'slip' || this.state === 'stunned' || this.state === 'mourn') {
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

  startGrab(at: THREE.Vector3, who: MesserId) {
    if (this.state === 'sleep') this.releaseBed();
    this.grabbing = who;
    this.setState('grab');
    this.facing = yawTo(this.position.x, this.position.z, at.x, at.z);
  }

  /** Done holding someone; go back to work. */
  finishGrab() {
    if (this.state !== 'grab') return;
    this.target = null;
    this.suspicion = 0;
    this.timeSinceSeen = 99;
    this.setState('look');
    this.lookTotal = 1.2;
  }

  /** Zach flexed out of his grip. Eddie ends up on the floor. */
  stun() {
    this.setState('stunned');
    this.target = null;
    this.suspicion = 0;
  }

  startPukedOn(sauced = false) {
    this.setState('pukedOn');
    this.model.slimed = sauced ? 0 : 1;
    this.host.say(sauced ? EDDIE.saucedOn.next() : EDDIE.pukedOn.next(), 'sad', 2.6);
    this.suspicion = 0;
    this.timeSinceSeen = 99;
    this.target = null;
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
    const targets = this.host.targets.filter((t) => t.catchable);
    const hunch = targets.length > 0 && Math.random() < 0.28 + this.rageLevel * 0.1;
    let best = -1;
    if (hunch) {
      const near = pick(targets).position;
      let bestD = Infinity;
      PATROL_POINTS.forEach(([x, z], i) => {
        const d = dist2D(x, z, near.x, near.z) + rand(0, 2);
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
      if (!seat.messed || seat.couch.ruined) {
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

  private checkSlip() {
    if (!MOVING.has(this.state) || this.slipImmunity > 0) return false;
    for (const p of this.host.puddles) {
      if (!p.active) continue;
      if (dist2D(p.position.x, p.position.z, this.position.x, this.position.z) < p.radius * 0.8) {
        this.setState('slip');
        this.host.say(EDDIE.slip.next(), 'shout', 1.6);
        this.host.onSlip(p);
        return true;
      }
    }
    return false;
  }

  // ---------------------------------------------------------------- AI update

  update(dt: number) {
    this.stateTime += dt;
    this.lungeCooldown -= dt;
    this.slipImmunity -= dt;
    this.speedNow = 0;

    const awake = !['sleep', 'wake', 'grab', 'pukedOn', 'slip', 'stunned', 'mourn'].includes(this.state);
    const seen = awake ? this.lookAround() : null;
    // Stick with the current target while he can see them, unless someone else is much closer.
    if (seen) {
      if (this.target && this.target !== seen && this.sees(this.target, SIGHT_RANGE + this.rageLevel * 0.55)) {
        const dCur = dist2D(this.target.position.x, this.target.position.z, this.position.x, this.position.z);
        const dNew = dist2D(seen.position.x, seen.position.z, this.position.x, this.position.z);
        if (dNew < dCur - 2) this.target = seen;
      } else {
        this.target = seen;
      }
    }
    this.canSee = Boolean(seen) && this.target !== null && this.sees(this.target, SIGHT_RANGE + this.rageLevel * 0.55);
    const target = this.target;
    if (this.canSee && target) {
      this.lastSeen.copy(target.position);
      this.timeSinceSeen = 0;
    } else {
      this.timeSinceSeen += dt;
    }

    if (ALERTABLE.has(this.state)) {
      if (this.canSee && target) {
        const d = dist2D(target.position.x, target.position.z, this.position.x, this.position.z);
        const range = SIGHT_RANGE + this.rageLevel * 0.55;
        let rate = 1.5 + (1 - d / range) * 4.5;
        if (this.state === 'investigate' || this.state === 'search') rate *= 1.6;
        if (target.noisy) rate *= 2;
        this.suspicion = Math.min(1, this.suspicion + rate * dt);
        if (this.suspicion >= 1) {
          this.setState('alert');
          this.cleaning = null;
          this.host.say(target.id === 'zach' ? EDDIE.spotZach.next() : EDDIE.spotTheo.next(), 'shout', 1.8);
          this.host.onAlert(target);
        }
      } else {
        this.suspicion = Math.max(0, this.suspicion - dt * 0.35);
      }
    } else if (this.chasing) {
      this.suspicion = 1;
    }

    if (awake) {
      this.scanTimer -= dt;
      if (this.scanTimer <= 0) {
        this.scanTimer = 0.4;
        this.scanForDirtySeats();
      }
    }

    // A chase target who ducks into the bathroom or gets sent to time-out is off the hook.
    if (this.chasing && target && (target.onToilet || (!target.catchable && !target.hidden))) {
      if (target.onToilet) this.host.say(EDDIE.toilet.next(), 'angry', 2.4);
      this.target = null;
      this.beginPatrol();
    }

    this.checkSlip();

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
        if (target) this.facing = dampAngle(this.facing, yawTo(this.position.x, this.position.z, target.position.x, target.position.z), 14, dt);
        if (this.stateTime > 0.5) this.startChase();
        break;
      }
      case 'chase': {
        if (!target) {
          this.beginPatrol();
          break;
        }
        const goal = this.canSee ? target.position : this.lastSeen;
        this.repathTimer -= dt;
        if (this.repathTimer <= 0) {
          this.repathTimer = this.canSee ? 0.22 : 0.5;
          this.goTo(goal.x, goal.z);
        }
        const speed = 3.35 + this.rageLevel * 0.22;
        const arrived = this.follow(dt, speed);
        const d = dist2D(target.position.x, target.position.z, this.position.x, this.position.z);
        if (this.canSee && target.catchable && d < 2.4 && d > 0.9 && this.lungeCooldown <= 0) {
          this.setState('windup');
          this.lungeDir.set(target.position.x - this.position.x, 0, target.position.z - this.position.z).normalize();
          break;
        }
        this.lineTimer -= dt;
        if (this.lineTimer <= 0) {
          this.lineTimer = rand(3.2, 5.2);
          this.host.say(target.id === 'zach' ? EDDIE.chaseZach.next() : EDDIE.chase.next(), 'angry', 2.2);
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
        if (target) this.lungeDir.set(target.position.x - this.position.x, 0, target.position.z - this.position.z).normalize();
        this.facing = dampAngle(this.facing, Math.atan2(this.lungeDir.x, this.lungeDir.z), 12, dt);
        if (this.stateTime > 0.36) {
          this.setState('lunge');
          this.lungeDir.set(Math.sin(this.facing), 0, Math.cos(this.facing));
        }
        break;
      }
      case 'lunge':
        this.updateLunge(dt);
        break;
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
        if (!seat || !seat.messed || seat.couch.ruined) {
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
        if (!seat || !seat.messed || seat.couch.ruined) {
          this.cleaning = null;
          this.beginPatrol();
          break;
        }
        this.facing = dampAngle(this.facing, yawTo(this.position.x, this.position.z, seat.top.x, seat.top.z), 8, dt);
        this.sprayAt(seat.top, dt);
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
          if (this.lookAround()) {
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
      case 'slip':
      case 'stunned': {
        if (this.stateTime > 2.6) {
          this.slipImmunity = 1.6;
          if (this.pendingMourn) {
            this.startMourn(this.pendingMourn);
          } else if (this.lookAround()) {
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
      case 'yell':
        if (this.stateTime > 0.7) this.beginPatrol();
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

  private updateLunge(dt: number) {
    const speed = 7.6;
    this.host.collision.move(this.position, this.lungeDir.x * speed * dt, this.lungeDir.z * speed * dt, this.radius, MASK_EDDIE);
    this.speedNow = speed;
    if (this.stateTime > 0.38) this.setState('recover');
  }

  private sprayTick = 0;
  private sprayAt(at: THREE.Vector3, dt: number) {
    this.sprayTick -= dt;
    if (this.sprayTick > 0) return;
    this.sprayTick = 0.33;
    const nozzle = this.model.emitter.getWorldPosition(new THREE.Vector3());
    const dir = new THREE.Vector3(at.x - nozzle.x, at.y - nozzle.y, at.z - nozzle.z).normalize();
    this.host.onSpray(nozzle, dir);
  }

  // ---------------------------------------------------------------- player-driven

  /** The player is Eddie: move, lunge, scrub and yell on command. */
  drive(dt: number, d: EddieDrive) {
    this.stateTime += dt;
    this.lungeCooldown -= dt;
    this.yellCooldown -= dt;
    this.slipImmunity -= dt;
    this.speedNow = 0;
    this.canSee = false;
    this.suspicion = 0;

    if (this.checkSlip()) this.vel.set(0, 0, 0);

    switch (this.state) {
      case 'slip':
      case 'stunned':
        if (this.stateTime > 2.2) {
          this.slipImmunity = 1.4;
          this.setState('patrol');
        }
        break;
      case 'pukedOn':
        this.model.slimed = Math.max(0.35, 1 - this.stateTime * 0.3);
        if (this.stateTime > 1.6) this.setState('patrol');
        break;
      case 'mourn':
        if (this.stateTime > 1.4) this.setState('patrol');
        break;
      case 'grab':
        break;
      case 'yell':
        if (this.stateTime > 0.7) this.setState('patrol');
        break;
      case 'windup':
        this.facing = dampAngle(this.facing, d.aimYaw, 20, dt);
        if (this.stateTime > 0.12) {
          this.setState('lunge');
          this.lungeDir.set(Math.sin(this.facing), 0, Math.cos(this.facing));
        }
        break;
      case 'lunge':
        this.updateLunge(dt);
        break;
      case 'recover':
        this.speedNow = 0.6;
        this.host.collision.move(this.position, this.lungeDir.x * 0.6 * dt, this.lungeDir.z * 0.6 * dt, this.radius, MASK_EDDIE);
        if (this.stateTime > 0.3) {
          this.lungeCooldown = 0.8;
          this.setState('patrol');
        }
        break;
      case 'clean':
        if (!d.scrub) {
          this.setState('patrol');
          break;
        }
        this.facing = dampAngle(this.facing, yawTo(this.position.x, this.position.z, d.scrub.x, d.scrub.z), 10, dt);
        this.sprayAt(d.scrub, dt);
        this.walk(dt, d, 0.25);
        break;
      default: {
        if (this.state !== 'patrol') this.setState('patrol');
        if (d.yell && this.yellCooldown <= 0) {
          this.yellCooldown = 7;
          this.setState('yell');
          break;
        }
        if (d.lunge && this.lungeCooldown <= 0) {
          this.setState('windup');
          break;
        }
        if (d.scrub) {
          this.setState('clean');
          break;
        }
        this.walk(dt, d, 1);
        break;
      }
    }

    // Stamina for sprinting.
    const sprinting = this.state === 'patrol' && d.sprint && d.move.lengthSq() > 0.01 && !this.tired;
    if (sprinting) {
      this.stamina = Math.max(0, this.stamina - dt * 0.32);
      if (this.stamina <= 0) this.tired = true;
    } else {
      this.stamina = Math.min(1, this.stamina + dt * 0.26);
      if (this.tired && this.stamina > 0.35) this.tired = false;
    }
    this.syncModel(dt);
  }

  private walk(dt: number, d: EddieDrive, scale: number) {
    const throttle = Math.min(1, d.move.length() * 1.2);
    const sprint = d.sprint && !this.tired && throttle > 0.05;
    const speed = (sprint ? 4.5 : 3.0) * (1 + this.rageLevel * 0.04) * scale;
    const len = d.move.length();
    const tx = len > 0.001 ? (d.move.x / len) * speed * throttle : 0;
    const tz = len > 0.001 ? (d.move.y / len) * speed * throttle : 0;
    this.vel.x = damp(this.vel.x, tx, 12, dt);
    this.vel.z = damp(this.vel.z, tz, 12, dt);
    this.host.collision.move(this.position, this.vel.x * dt, this.vel.z * dt, this.radius, MASK_EDDIE);
    this.speedNow = Math.hypot(this.vel.x, this.vel.z);
    if (this.speedNow > 0.25 && this.state === 'patrol') this.facing = dampAngle(this.facing, Math.atan2(this.vel.x, this.vel.z), 12, dt);
  }

  // ---------------------------------------------------------------- model

  /** Animate without thinking (title screen, victory). */
  animateOnly(dt: number) {
    this.syncModel(dt);
  }

  private syncModel(dt: number) {
    this.model.root.position.copy(this.position);
    this.model.root.rotation.y = this.facing;
    this.model.rage = clamp(this.rageLevel / 4 + (this.chasing ? 0.15 : 0), 0, 1);
    if (this.state !== 'pukedOn') this.model.slimed = Math.max(0, this.model.slimed - dt * 0.02);
    const anim = this.animFor();
    if (anim !== this.animName) {
      this.animName = anim;
      this.animTime = 0;
    }
    this.animTime += dt;
    // Stunned shares the slip pratfall but it keeps its own clock.
    const time = this.state === 'slip' || this.state === 'stunned' || this.state === 'mourn' || this.state === 'wake' || this.state === 'alert' ? this.stateTime : this.animTime;
    this.model.animate(dt, anim, time, this.speedNow);
  }

  private animFor(): Anim {
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
      case 'stunned':
        return 'slip';
      case 'grab':
        return 'lift';
      case 'pukedOn':
        return 'pukedOn';
      case 'yell':
        return 'yell';
      case 'celebrate':
        return 'celebrate';
      default:
        if (this.speedNow > 3.6) return 'run';
        return this.speedNow > 0.1 ? 'walk' : 'idle';
    }
  }

  /** Human-readable status for the HUD. `you` is the player's mess-maker, if any. */
  status(you: MesserId | null): { label: string; tone: 'calm' | 'warn' | 'danger' | 'good' } {
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
      case 'recover': {
        const who = this.target?.id;
        if (!who || who === you) return { label: 'CHASING YOU', tone: 'danger' };
        return { label: `CHASING ${who.toUpperCase()}`, tone: 'warn' };
      }
      case 'mourn':
        return { label: 'GRIEVING', tone: 'good' };
      case 'slip':
        return { label: 'SLIPPED!', tone: 'good' };
      case 'stunned':
        return { label: 'OUT-MUSCLED', tone: 'good' };
      case 'grab':
        return { label: you && this.grabbing === you ? 'GOT YOU' : `GOT ${(this.grabbing ?? 'one').toUpperCase()}`, tone: 'danger' };
      case 'pukedOn':
        return { label: 'WIPING FACE', tone: 'good' };
      case 'yell':
        return { label: 'YELLING', tone: 'warn' };
      case 'celebrate':
        return { label: 'VICTORIOUS', tone: 'danger' };
    }
  }

  get chasing() {
    return this.state === 'chase' || this.state === 'windup' || this.state === 'lunge' || this.state === 'recover' || this.state === 'alert';
  }

  /** Eddie can only catch someone while upright and moving about. */
  get canCatch() {
    return ['patrol', 'look', 'investigate', 'chase', 'windup', 'lunge', 'recover', 'search', 'gotoClean', 'clean', 'alert', 'yell'].includes(this.state);
  }
}
