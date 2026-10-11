import * as THREE from 'three';
import { HumanRig, type Anim } from './rig';
import { SPECS, type MesserId } from './cast';
import { MASK_EDDIE, MASK_THEO, type Collision } from '../world/collision';
import { clamp, damp, dampAngle } from '../core/util';
import type { MessStyle } from '../game/types';

export interface MessControls {
  /** World-space desired direction (x, z); length 0..1 is the throttle. */
  move: THREE.Vector2;
  sprint: boolean;
  /** Turn to face this yaw (aiming) instead of the walking direction. */
  face: number | null;
}

export type ActionAnim = 'hurl' | 'throw' | 'squeeze' | 'eat' | 'flex' | 'yelp' | 'blast';

/**
 * Someone making a mess in Eddie's house: Theo (puke) or Zach (sauce and crumbs).
 * Holds body state and movement; the game decides what their attacks do.
 */
export class Messer {
  readonly rig: HumanRig;
  readonly position = new THREE.Vector3();
  readonly vel = new THREE.Vector3();
  readonly radius: number;
  readonly mask: number;
  readonly style: MessStyle;
  readonly walkSpeed: number;
  readonly sprintSpeed: number;
  facing = Math.PI;
  isPlayer = false;

  /** Tummy (Theo) or sauce (Zach), 0..100. */
  ammo = 100;
  stamina = 1;
  tired = false;
  zoomies = 0;
  burrito = 0;
  hasToy = false;
  invuln = 0;
  hidden = false;

  charging = false;
  chargeTime = 0;
  /** The charge in progress is Zach's gut power-up, not a sauce shot. */
  blastCharge = false;
  action: ActionAnim | null = null;
  actionTime = 0;
  heaveCooldown = 0;
  fireCooldown = 0;

  /** Zach only: how full his gut is, 0..100. Full means his power-up is ready. */
  bloat = 0;
  /** Seconds left to reach a bidet after using the power-up. 0 = all clean. */
  emergency = 0;
  /** Index of the toilet he is sitting on. */
  toilet = -1;
  toiletTime = 0;
  /** Zach breaks free of the first grab each life. */
  swoleUsed = false;

  /** Seconds left sitting in the time-out corner (AI only). */
  timeout = 0;
  /** Frozen by one of Eddie's yells. */
  frozen = 0;
  carried = false;
  celebrating = false;
  sulking = false;

  private animName: Anim = 'idle';
  private animTime = 0;

  constructor(readonly id: MesserId) {
    this.rig = new HumanRig(SPECS[id]);
    const theo = id === 'theo';
    this.radius = theo ? 0.27 : 0.34;
    // Theo fits under tables and beds; Zach does not.
    this.mask = theo ? MASK_THEO : MASK_EDDIE;
    this.style = theo ? 'puke' : 'sauce';
    this.walkSpeed = theo ? 3.1 : 2.9;
    this.sprintSpeed = theo ? 4.7 : 4.4;
  }

  get name() {
    return this.id === 'theo' ? 'Theo' : 'Zach';
  }

  get speed() {
    return Math.hypot(this.vel.x, this.vel.z);
  }

  /** Not available to Eddie: on the toilet, in time-out, already carried. */
  get catchable() {
    return this.timeout <= 0 && this.toilet < 0 && !this.carried && this.invuln <= 0 && !this.hidden;
  }

  /** Zach's gut is full: hold the action to unleash it. */
  get gutReady() {
    return this.id === 'zach' && this.bloat >= 100 && this.emergency <= 0;
  }

  get active() {
    return this.timeout <= 0 && this.toilet < 0 && !this.carried;
  }

  reset(x: number, z: number, facing = Math.PI) {
    this.position.set(x, 0, z);
    this.vel.set(0, 0, 0);
    this.facing = facing;
    this.ammo = 100;
    this.stamina = 1;
    this.tired = false;
    this.zoomies = 0;
    this.burrito = 0;
    this.hasToy = false;
    this.invuln = 0;
    this.hidden = false;
    this.charging = false;
    this.chargeTime = 0;
    this.blastCharge = false;
    this.action = null;
    this.actionTime = 0;
    this.heaveCooldown = 0;
    this.fireCooldown = 0;
    this.bloat = 0;
    this.emergency = 0;
    this.toilet = -1;
    this.toiletTime = 0;
    this.swoleUsed = false;
    this.timeout = 0;
    this.frozen = 0;
    this.carried = false;
    this.celebrating = false;
    this.sulking = false;
    this.rig.slimed = 0;
    this.rig.pale = 0;
    this.rig.queasy = 0;
    this.sync();
  }

  play(action: ActionAnim, duration: number) {
    this.action = action;
    this.actionTime = duration;
  }

  /** Movement with collision, stamina and facing. */
  move(dt: number, collision: Collision, c: MessControls) {
    const move = c.move;
    const throttle = Math.min(1, move.length() * 1.2);
    const moving = throttle > 0.05;
    this.hidden = this.id === 'theo' && collision.isHidden(this.position.x, this.position.z);

    const clenching = this.emergency > 0;
    const wantsSprint = c.sprint && moving && !this.tired && !this.charging && !this.hidden && !clenching;
    let speed = wantsSprint ? this.sprintSpeed : this.walkSpeed;
    if (this.zoomies > 0) speed *= 1.4;
    if (this.hidden) speed = 1.8;
    if (clenching) speed = 2.35;
    if (this.charging) speed *= 0.45;
    if (this.action === 'hurl' || this.action === 'squeeze') speed *= 0.5;
    if (this.frozen > 0) speed = 0;

    if (wantsSprint && this.zoomies <= 0) {
      this.stamina = Math.max(0, this.stamina - dt * 0.42);
      if (this.stamina <= 0) this.tired = true;
    } else {
      this.stamina = Math.min(1, this.stamina + dt * (this.zoomies > 0 ? 1 : 0.28));
      if (this.tired && this.stamina > 0.35) this.tired = false;
    }
    if (this.zoomies > 0) this.zoomies = Math.max(0, this.zoomies - dt);

    const len = move.length();
    const dx = len > 0.001 ? (move.x / len) * speed * throttle : 0;
    const dz = len > 0.001 ? (move.y / len) * speed * throttle : 0;
    this.vel.x = damp(this.vel.x, dx, 14, dt);
    this.vel.z = damp(this.vel.z, dz, 14, dt);
    collision.move(this.position, this.vel.x * dt, this.vel.z * dt, this.radius, this.mask);

    if (c.face !== null) {
      this.facing = dampAngle(this.facing, c.face, 14, dt);
    } else if (this.vel.lengthSq() > 0.05) {
      this.facing = dampAngle(this.facing, Math.atan2(this.vel.x, this.vel.z), 12, dt);
    }
  }

  /** Timers that tick no matter who is driving. */
  tick(dt: number) {
    if (this.invuln > 0) this.invuln -= dt;
    if (this.heaveCooldown > 0) this.heaveCooldown -= dt;
    if (this.fireCooldown > 0) this.fireCooldown -= dt;
    if (this.frozen > 0) this.frozen -= dt;
    if (this.actionTime > 0) {
      this.actionTime -= dt;
      if (this.actionTime <= 0) this.action = null;
    }
    if (this.id === 'zach') this.rig.pale = damp(this.rig.pale, this.emergency > 0 ? 1 : 0, 3, dt);
  }

  /** World position of the mouth (Theo) or the sauce bottle nozzle (Zach). */
  emitter = (target = new THREE.Vector3()) => this.rig.emitter.getWorldPosition(target);

  /** Where the power-up comes out. */
  rear(target = new THREE.Vector3()) {
    return this.rig.rear.getWorldPosition(target);
  }

  mouth(target = new THREE.Vector3()) {
    return this.rig.headTop.getWorldPosition(target).add(new THREE.Vector3(0, -this.rig.spec.headR * 1.4, 0));
  }

  head(target = new THREE.Vector3()) {
    return this.rig.headTop.getWorldPosition(target);
  }

  sync() {
    if (!this.carried) {
      this.rig.root.position.copy(this.position);
      this.rig.root.rotation.y = this.facing;
    }
  }

  /** Picks the animation from the current state and poses the rig. */
  animate(dt: number, time: number, chargeLevel: number) {
    this.sync();
    let anim: Anim;
    let amount = 0;
    const speed = this.speed;
    if (this.carried) anim = 'carried';
    else if (this.toilet >= 0) {
      anim = 'sit';
      amount = this.toiletTime < 0.9 ? 1 : 0;
    } else if (this.timeout > 0) anim = 'sit';
    else if (this.celebrating) anim = 'celebrate';
    else if (this.sulking) anim = 'sulk';
    else if (this.frozen > 0) anim = 'alert';
    else if (this.action === 'flex') anim = 'flex';
    else if (this.charging && this.blastCharge) {
      anim = 'blast';
      amount = Math.min(0.94, chargeLevel);
    } else if (this.action === 'blast') {
      anim = 'blast';
      amount = 1;
    } else if (this.charging) {
      anim = 'charge';
      amount = chargeLevel;
    } else if (this.action === 'hurl') anim = this.id === 'zach' ? 'squeeze' : 'hurl';
    else if (this.action === 'squeeze') anim = 'squeeze';
    else if (this.action === 'throw') anim = 'throw';
    else if (this.action === 'yelp') anim = 'alert';
    else if (this.emergency > 0) anim = 'clench';
    else if (this.hidden) anim = 'crawl';
    else if (this.action === 'eat') anim = 'eat';
    else if (speed > this.walkSpeed * 1.12) anim = 'run';
    else if (speed > 0.2) anim = 'walk';
    else anim = 'idle';

    if (anim !== this.animName) {
      this.animName = anim;
      this.animTime = 0;
    }
    this.animTime += dt;
    this.rig.queasy = this.id === 'theo' ? (this.charging ? 0.35 + chargeLevel * 0.6 : this.action === 'hurl' ? 0.5 : 0) : 0;
    this.rig.animate(dt, anim, this.animTime, speed, amount);
    // Blink while invulnerable after a respawn.
    this.rig.setVisible(this.invuln <= 0 || this.carried || Math.floor(time * 12) % 2 === 0);
  }
}
