import * as THREE from 'three';
import { GameRenderer, type Quality } from '../core/renderer';
import { Input } from '../core/input';
import { Sound, type ChargeHandle } from '../core/audio';
import { clamp, damp, dampAngle, dist2D, formatTime, pick, rand, safeStorageGet, safeStorageSet } from '../core/util';
import { buildHouse, type House } from '../world/house';
import { MASK_THEO } from '../world/collision';
import { THEO_SPAWN, TOTAL_SEATS } from '../world/layout';
import { TheoModel } from '../actors/theo';
import { Eddie, type EddieHost } from '../actors/eddie';
import { PukeSystem } from '../fx/puke';
import { Effects } from '../fx/effects';
import { Pickups, type PickupHost, type PickupKind } from './pickups';
import { Hud } from '../ui/hud';
import { WorldUi } from '../ui/worldui';
import { Minimap } from '../ui/minimap';
import { EDDIE, POP, THEO, TIPS, rankFor } from '../data/lines';
import type { CouchState, Mood, Puddle, Seat } from './types';
import { blobShadow } from '../world/kit';
import { blobShadowTexture } from '../world/textures';

type Mode = 'title' | 'intro' | 'playing' | 'caught' | 'paused' | 'won' | 'lost';

const MAX_LIVES = 3;
const QUICK_COST = 13;
const MEGA_BASE_COST = 18;
const MEGA_EXTRA_COST = 27;
const CHARGE_DELAY = 0.2;
const CHARGE_TIME = 0.95;

function $(id: string) {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing #${id}`);
  return node;
}

export class Game {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(52, window.innerWidth / window.innerHeight, 0.1, 400);
  private readonly gfx: GameRenderer;
  private readonly house: House;
  private readonly input: Input;
  private readonly sound = new Sound();
  private readonly hud = new Hud();
  private readonly worldUi: WorldUi;
  private readonly minimap: Minimap;
  private readonly puke: PukeSystem;
  private readonly effects: Effects;
  private readonly pickups: Pickups;
  private readonly eddie: Eddie;
  private readonly eddieHost: EddieHost;
  private readonly theoModel = new TheoModel();
  private readonly couches: CouchState[] = [];
  private readonly seats: Seat[] = [];
  private readonly timer = new THREE.Timer();

  private mode: Mode = 'title';
  private pausedFrom: Mode = 'playing';
  private time = 0;
  private modeTime = 0;

  // Theo.
  private readonly theoPos = new THREE.Vector3();
  private readonly theoVel = new THREE.Vector3();
  private theoFacing = Math.PI;
  private tummy = 100;
  private stamina = 1;
  private tired = false;
  private zoomies = 0;
  private burrito = 0;
  private hasToy = false;
  private invuln = 0;
  private hidden = false;
  private charging = false;
  private chargeTime = 0;
  private chargeHandle: ChargeHandle | null = null;
  private pukeAnim = 0;
  private heaveCooldown = 0;
  private carried = false;
  private aimSeat: Seat | null = null;
  private readonly aimPoint = new THREE.Vector3();
  private aimBlend = 0;

  // Camera.
  private camYaw = Math.PI;
  private camPitch = 0.72;
  private camDist = 7.2;
  private readonly camTarget = new THREE.Vector3();
  private readonly camPos = new THREE.Vector3();
  private shake = 0;
  private fovKick = 0;
  private introFrom = new THREE.Vector3();
  private introLook = new THREE.Vector3();

  // Score + stats.
  private score = 0;
  private combo = 0;
  private comboTimer = 0;
  private maxCombo = 0;
  private lives = MAX_LIVES;
  private elapsed = 0;
  private stats = { slips: 0, caught: 0, seats: 0, megas: 0, buns: 0, cleaned: 0 };
  private rage = 0;
  private beastAnnounced = false;
  private seenHints = new Set<string>();
  private hintQueue: string[] = [];
  private hintCooldown = 0;
  private caughtStage = 0;
  private steamTimer = 0;
  private tearTimer = 0;
  private chaseMusic = false;
  private danger = 0;
  private flash = 0;
  private best = Number(safeStorageGet('eddie.best') ?? 0) || 0;
  private readonly tmp = new THREE.Vector3();
  private readonly tmp2 = new THREE.Vector3();
  private readonly ray = new THREE.Ray();

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly isTouch: boolean,
  ) {
    const savedQuality = safeStorageGet('eddie.quality') as Quality | null;
    const quality: Quality = savedQuality === 'fancy' || savedQuality === 'fast' ? savedQuality : isTouch ? 'fast' : 'fancy';
    this.gfx = new GameRenderer(canvas, this.scene, this.camera, quality);
    this.house = buildHouse(this.scene, quality);

    for (const { def, built } of this.house.couches) {
      const couch: CouchState = { def, seats: [], ruined: false, center: built.center, vibrator: built.vibrator, ruinedAt: 0 };
      built.seats.forEach((b, index) => {
        const material = b.cushion.material as THREE.MeshStandardMaterial;
        const seat: Seat = {
          id: `${def.id}-${index}`,
          index,
          couch,
          cushion: b.cushion,
          material,
          baseColor: material.color.clone(),
          plastic: b.plastic ?? null,
          top: b.top,
          front: b.front,
          facing: b.facing,
          puked: false,
          occupied: false,
          decals: [],
        };
        couch.seats.push(seat);
        this.seats.push(seat);
      });
      this.couches.push(couch);
    }

    this.puke = new PukeSystem(this.scene);
    this.effects = new Effects(this.scene);
    const shadowTex = blobShadowTexture();
    this.pickups = new Pickups(
      this.scene,
      shadowTex,
      this.house.trashCans.map((c) => c.extra),
      this.house.microwave,
    );

    this.scene.add(this.theoModel.root);
    this.theoModel.root.add(blobShadow(shadowTex, 0.7, 0.7, 0.5));

    const host: EddieHost = {
      collision: this.house.collision,
      seats: this.seats,
      puddles: this.puke.puddles,
      theo: { position: this.theoPos, hidden: false, noisy: false },
      rage: 0,
      say: (text, mood, duration) => this.say('eddie', text, mood, duration),
      onAlert: () => {
        this.sound.alert();
        this.shake = Math.max(this.shake, 0.15);
        this.flash = 0.12;
        this.queueHint('spotted', 'Busted! Break line of sight, hide under the table/bed, or lay puddles to trip him.');
      },
      onSlip: (p) => this.onEddieSlip(p),
      onCleaned: (seat) => this.cleanSeat(seat),
      onSpray: (origin, dir) => this.puke.spray(origin, dir),
      onWake: () => {
        this.queueHint('wake', 'Eddie is awake! Stay out of his red vision cone on the minimap.');
      },
      onDirtySpotted: (seat) => {
        if (this.eddie.state !== 'chase') this.say('eddie', EDDIE.dirty.next(), 'shout', 1.6);
        this.queueHint('clean', `Eddie spotted puke on ${seat.couch.def.name} and will scrub it clean. Finish couches to ruin them for good!`);
      },
      onSnore: () => this.sound.snore(),
    };
    this.eddieHost = host;
    this.eddie = new Eddie(host);
    this.scene.add(this.eddie.model.root);
    this.eddie.model.root.add(blobShadow(shadowTex, 1.1, 1.1, 0.5));

    const touch = {
      zone: $('touch-zone'),
      joystick: $('joystick'),
      knob: $('joystick-knob'),
      pukeButton: $('puke-button'),
      toyButton: $('toy-button'),
    };
    this.input = new Input(canvas, isTouch, touch);
    this.input.onPointerLockLost = () => {
      if (this.mode === 'playing' || this.mode === 'intro') this.pause();
    };

    this.worldUi = new WorldUi($('world-layer'), this.camera);
    this.minimap = new Minimap($('minimap') as HTMLCanvasElement);
    this.hud.buildCouches(this.couches);

    this.wireScreens();
    window.addEventListener('resize', () => {
      this.gfx.resize();
      this.minimap.resize();
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && (this.mode === 'playing' || this.mode === 'intro')) this.pause();
    });

    this.resetRound();
    this.toTitle();
    this.timer.connect(document);
    this.gfx.renderer.setAnimationLoop((t) => this.frame(t));
  }

  // ================================================================ screens

  private wireScreens() {
    const click = (id: string, fn: () => void) =>
      $(id).addEventListener('click', () => {
        this.sound.unlock();
        this.sound.click();
        fn();
      });
    click('play-button', () => this.startGame());
    click('help-button', () => this.showScreen('screen-help', true));
    click('help-close', () => this.showScreen('screen-help', false));
    click('resume-button', () => this.resume());
    click('restart-button', () => this.restart());
    click('quit-button', () => this.toTitle());
    click('again-button', () => this.restart());
    click('end-menu-button', () => this.toTitle());
    click('sound-toggle', () => this.toggleMute());
    click('pause-sound', () => this.toggleMute());
    click('quality-toggle', () => this.toggleQuality());
    click('pause-quality', () => this.toggleQuality());
    $('pause-button').addEventListener('click', () => {
      if (this.mode === 'playing') this.pause();
    });
    window.addEventListener('keydown', (event) => {
      if (event.code === 'Enter' && this.mode === 'title') {
        this.sound.unlock();
        this.startGame();
      }
    });
    this.refreshToggles();
  }

  private showScreen(id: string, visible: boolean) {
    $(id).classList.toggle('is-hidden', !visible);
  }

  private refreshToggles() {
    const sound = `Sound: ${this.sound.muted ? 'off' : 'on'}`;
    const quality = `Graphics: ${this.gfx.quality}`;
    $('sound-toggle').textContent = sound;
    $('pause-sound').textContent = sound;
    $('quality-toggle').textContent = quality;
    $('pause-quality').textContent = quality;
    $('best-score').textContent = this.best > 0 ? `Best: ${this.best.toLocaleString()}` : '';
  }

  private toggleMute() {
    this.sound.toggleMute();
    this.refreshToggles();
  }

  private toggleQuality() {
    const next: Quality = this.gfx.quality === 'fancy' ? 'fast' : 'fancy';
    this.gfx.setQuality(next);
    const size = next === 'fancy' ? 2048 : 1024;
    this.house.sun.shadow.mapSize.set(size, size);
    this.house.sun.shadow.map?.dispose();
    (this.house.sun.shadow as { map: THREE.WebGLRenderTarget | null }).map = null;
    safeStorageSet('eddie.quality', next);
    this.refreshToggles();
  }

  private toTitle() {
    this.mode = 'title';
    this.modeTime = 0;
    this.input.enabled = false;
    this.input.exitPointerLock();
    this.resetRound();
    this.hud.show(false);
    this.hud.hideBanner();
    this.hud.clearHint();
    $('touch').classList.remove('is-active');
    for (const id of ['screen-help', 'screen-pause', 'screen-end']) this.showScreen(id, false);
    this.showScreen('screen-title', true);
    this.refreshToggles();
    this.sound.setMusic('title');
    this.attractCamera(0, true);
  }

  private startGame() {
    if (this.mode !== 'title') return;
    this.sound.unlock();
    this.showScreen('screen-title', false);
    this.showScreen('screen-help', false);
    this.beginIntro();
  }

  private beginIntro() {
    this.mode = 'intro';
    this.modeTime = 0;
    this.introFrom.copy(this.camera.position);
    this.introLook.set(0, 0, 0);
    this.hud.show(true);
    $('touch').classList.add('is-active');
    this.input.enabled = true;
    if (!this.isTouch) this.input.requestPointerLock();
    this.hud.showBanner('Shhh... Eddie is napping', 'Hurl on every seat of all 9 couches. Don’t get caught.', 'info', 3.6);
    this.sound.setMusic('calm');
    this.queueHint(
      'controls',
      this.isTouch
        ? 'Left thumb: waddle · Right thumb: look · HURL: tap, or hold for a MEGA HURL'
        : 'WASD: waddle · Mouse: look · Click/Space: HURL (hold for MEGA) · Shift: zoomies',
    );
    this.queueHint('aim', 'The yellow arrow marks your auto-aim seat. Puke on every seat of every couch!');
  }

  private restart() {
    for (const id of ['screen-pause', 'screen-end', 'screen-help', 'screen-title']) this.showScreen(id, false);
    this.resetRound();
    this.beginIntro();
  }

  private pause() {
    if (this.mode !== 'playing' && this.mode !== 'intro' && this.mode !== 'caught') return;
    this.pausedFrom = this.mode;
    this.mode = 'paused';
    this.input.enabled = false;
    this.input.releaseAll();
    this.input.exitPointerLock();
    this.stopCharge();
    this.hud.hideBanner();
    $('pause-tip').textContent = pick(TIPS);
    this.refreshToggles();
    this.showScreen('screen-pause', true);
    this.sound.setMusic('off');
  }

  private resume() {
    if (this.mode !== 'paused') return;
    this.showScreen('screen-pause', false);
    this.mode = this.pausedFrom;
    this.input.enabled = true;
    if (!this.isTouch) this.input.requestPointerLock();
    this.sound.setMusic(this.eddie.chasing ? 'chase' : 'calm');
    this.timer.reset();
  }

  // ================================================================ round

  private resetRound() {
    this.puke.reset();
    this.effects.reset();
    this.worldUi.clear();
    this.pickups.reset();
    for (const couch of this.couches) {
      couch.ruined = false;
      couch.ruinedAt = 0;
      for (const seat of couch.seats) {
        seat.puked = false;
        seat.occupied = false;
        this.puke.clearSeat(seat);
        seat.material.color.copy(seat.baseColor);
        if (seat.plastic) {
          seat.plastic.visible = true;
          seat.plastic.scale.setScalar(1);
        }
      }
      if (couch.vibrator) couch.vibrator.position.set(0, 0, 0);
    }
    this.theoPos.set(THEO_SPAWN.x, 0, THEO_SPAWN.z);
    this.theoVel.set(0, 0, 0);
    this.theoFacing = Math.PI;
    this.tummy = 100;
    this.stamina = 1;
    this.tired = false;
    this.zoomies = 0;
    this.burrito = 0;
    this.hasToy = false;
    this.invuln = 0;
    this.hidden = false;
    this.carried = false;
    this.stopCharge();
    this.pukeAnim = 0;
    this.score = 0;
    this.combo = 0;
    this.comboTimer = 0;
    this.maxCombo = 0;
    this.lives = MAX_LIVES;
    this.elapsed = 0;
    this.stats = { slips: 0, caught: 0, seats: 0, megas: 0, buns: 0, cleaned: 0 };
    this.rage = 0;
    this.beastAnnounced = false;
    this.seenHints.clear();
    this.hintQueue = [];
    this.hintCooldown = 0;
    this.camYaw = Math.PI;
    this.camPitch = 0.72;
    this.chaseMusic = false;
    this.danger = 0;
    this.eddie.model.slimed = 0;
    const recliner = this.seats.find((s) => s.couch.def.id === 'recliner');
    if (recliner) this.eddie.reset(recliner);
    this.syncHostRage();
    this.theoModel.root.position.copy(this.theoPos);
    this.theoModel.root.rotation.y = this.theoFacing;
    this.theoModel.root.visible = true;
  }

  private syncHostRage() {
    this.eddieHost.rage = this.rage;
  }

  // ================================================================ frame

  private frame(timestamp: number) {
    this.timer.update(timestamp);
    const dt = Math.min(this.timer.getDelta(), 1 / 20);
    this.tick(dt);
    this.gfx.render(this.time);
  }

  /** Test hook: advance the simulation without waiting for real frames. */
  debugAdvance(seconds: number, step = 1 / 30) {
    const steps = Math.round(seconds / step);
    for (let i = 0; i < steps; i += 1) this.tick(step);
  }

  private tick(dt: number) {
    this.time += dt;
    this.modeTime += dt;
    this.input.poll();

    if (this.input.mutePressed) this.toggleMute();
    if (this.input.pausePressed && (this.mode === 'playing' || this.mode === 'intro')) this.pause();
    else if (this.input.pausePressed && this.mode === 'paused') this.resume();

    switch (this.mode) {
      case 'title':
        this.updateWorld(dt, false);
        this.attractCamera(dt);
        break;
      case 'intro':
        this.updatePlaying(dt);
        if (this.modeTime > 1.6) {
          this.mode = 'playing';
        }
        break;
      case 'playing':
        this.updatePlaying(dt);
        break;
      case 'caught':
        this.updateCaught(dt);
        break;
      case 'won':
      case 'lost':
        this.updateWorld(dt, true);
        this.followCamera(dt, 0.6);
        this.updateHud(dt);
        break;
      case 'paused':
        break;
    }

    this.input.endFrame();
    this.updatePost(dt);
  }

  /** Simulates everything that isn't Theo's input. */
  private updateWorld(dt: number, eddieActive: boolean) {
    this.house.update(dt, this.time);
    if (this.mode === 'won') {
      this.eddie.state = 'mourn';
      this.eddie.stateTime = Math.max(this.eddie.stateTime, 1.6) + dt;
      this.eddie.animateOnly(dt);
    } else if (eddieActive) this.eddie.update(dt);
    else this.eddie.animateOnly(dt);
    this.puke.update(dt);
    this.effects.update(dt);
    this.animateTheo(dt);
    this.updateCouchFx(dt);
    this.updatePortraits();
    const eddieHead = this.eddie.model.headTop.getWorldPosition(this.tmp);
    const theoHead = this.tmp2.copy(this.theoPos).setY(1.15);
    this.worldUi.update(dt, eddieHead, theoHead, this.eddie.suspicion, this.eddie.chasing, false, false);
    this.eddie.model.talking = this.worldUi.isTalking('eddie') ? 1 : 0;
    this.updateOccluders(dt, this.mode === 'title' ? false : true);
  }

  private updatePlaying(dt: number) {
    this.eddieHost.theo.hidden = this.hidden;
    this.eddieHost.theo.noisy = this.charging || this.pukeAnim > 0;

    if (this.mode === 'playing') this.elapsed += dt;
    this.updateCameraInput(dt);
    this.updateTheo(dt);
    this.updatePuke(dt);
    this.house.update(dt, this.time);
    this.eddie.update(dt);
    this.pickups.update(dt, this.theoPos, this.pickupHost);
    this.puke.update(dt);
    this.effects.update(dt);
    this.animateTheo(dt);
    this.updateCouchFx(dt);
    this.updatePortraits();
    this.updateEddieFx(dt);
    this.checkCatch();
    this.updateCombo(dt);
    this.updateHints(dt);
    this.updateMusic();

    if (this.mode === 'intro') {
      const k = clamp(this.modeTime / 1.6, 0, 1);
      this.followCamera(dt, 1);
      const ease = k * k * (3 - 2 * k);
      this.camera.position.lerpVectors(this.introFrom, this.camPos, ease);
      this.camera.lookAt(this.tmp.lerpVectors(this.introLook, this.camTarget, ease));
    } else {
      this.followCamera(dt, 1);
    }

    this.updateHud(dt);
  }

  // ================================================================ theo

  private aimDir(target = new THREE.Vector3()) {
    return target.set(Math.sin(this.camYaw), 0, Math.cos(this.camYaw));
  }

  private updateCameraInput(dt: number) {
    const look = this.input.look;
    const sens = this.isTouch ? 0.0042 : 0.0024;
    this.camYaw -= look.x * sens;
    this.camPitch = clamp(this.camPitch + look.y * sens * 0.8, 0.32, 1.2);
    if (this.input.zoom !== 0) this.camDist = clamp(this.camDist + this.input.zoom * 0.6, 4.2, 11);
    void dt;
  }

  private updateTheo(dt: number) {
    const move = this.input.move;
    const fwd = this.aimDir(this.tmp);
    const right = this.tmp2.set(-fwd.z, 0, fwd.x);
    const desired = new THREE.Vector3().addScaledVector(fwd, move.y).addScaledVector(right, move.x);
    const moving = desired.lengthSq() > 0.01;

    this.hidden = this.house.collision.isHidden(this.theoPos.x, this.theoPos.z);
    const wantsSprint = this.input.sprintHeld && moving && !this.tired && !this.charging && !this.hidden;
    let speed = 3.1;
    if (wantsSprint) speed = 4.7;
    if (this.zoomies > 0) speed *= 1.4;
    if (this.hidden) speed = 1.8;
    if (this.charging) speed *= 0.45;
    if (this.pukeAnim > 0) speed *= 0.5;

    if (wantsSprint && this.zoomies <= 0) {
      this.stamina = Math.max(0, this.stamina - dt * 0.42);
      if (this.stamina <= 0) this.tired = true;
    } else {
      this.stamina = Math.min(1, this.stamina + dt * (this.zoomies > 0 ? 1 : 0.28));
      if (this.tired && this.stamina > 0.35) this.tired = false;
    }
    if (this.zoomies > 0) this.zoomies = Math.max(0, this.zoomies - dt);

    desired.multiplyScalar(speed * Math.min(1, move.length() * 1.2));
    this.theoVel.x = damp(this.theoVel.x, desired.x, 14, dt);
    this.theoVel.z = damp(this.theoVel.z, desired.z, 14, dt);
    this.house.collision.move(this.theoPos, this.theoVel.x * dt, this.theoVel.z * dt, 0.27, MASK_THEO);

    if (this.charging || this.pukeAnim > 0) {
      this.theoFacing = dampAngle(this.theoFacing, this.pukeFacing(), 14, dt);
    } else if (this.theoVel.lengthSq() > 0.05) {
      this.theoFacing = dampAngle(this.theoFacing, Math.atan2(this.theoVel.x, this.theoVel.z), 12, dt);
    }
    if (this.invuln > 0) this.invuln -= dt;
    if (this.heaveCooldown > 0) this.heaveCooldown -= dt;

    // Throw a squeaky toy.
    if (this.input.throwPressed && this.hasToy && this.mode === 'playing') {
      const dir = this.aimDir(new THREE.Vector3());
      const dist = Math.min(7, this.house.collision.rayDistance(this.theoPos.x, this.theoPos.z, dir.x, dir.z, 7) - 0.4);
      const to = this.theoPos.clone().addScaledVector(dir, Math.max(1, dist));
      to.y = 0.07;
      this.pickups.throwToy(this.theoPos.clone().setY(0.8), to);
      this.hasToy = false;
      this.sound.whoosh();
    }
  }

  private pukeFacing() {
    if (this.aimSeat && !this.charging) return Math.atan2(this.aimSeat.top.x - this.theoPos.x, this.aimSeat.top.z - this.theoPos.z);
    return this.camYaw;
  }

  private animateTheo(dt: number) {
    const m = this.theoModel;
    if (!this.carried) {
      m.root.position.copy(this.theoPos);
      m.root.rotation.y = this.theoFacing;
    }
    const speed = Math.hypot(this.theoVel.x, this.theoVel.z);
    m.animate(dt, {
      speed,
      sprinting: speed > 3.6,
      charge: this.charging ? this.chargeLevel() : 0,
      puking: this.pukeAnim,
      crawling: this.hidden && !this.carried,
      carried: this.carried,
      dizzy: false,
      happy: this.mode === 'won' ? 1 : 0,
    });
    if (this.pukeAnim > 0) this.pukeAnim = Math.max(0, this.pukeAnim - dt);
    m.setBlink(this.invuln <= 0 || Math.floor(this.time * 12) % 2 === 0);
  }

  private mouth = () => this.theoModel.mouthAnchor.getWorldPosition(new THREE.Vector3());

  // ================================================================ hurling

  private chargeLevel() {
    const raw = clamp((this.chargeTime - CHARGE_DELAY) / CHARGE_TIME, 0, 1);
    if (this.burrito > 0) return raw;
    const affordable = clamp((this.tummy - MEGA_BASE_COST) / MEGA_EXTRA_COST, 0, 1);
    return Math.min(raw, affordable);
  }

  private stopCharge() {
    this.charging = false;
    this.chargeTime = 0;
    this.chargeHandle?.stop();
    this.chargeHandle = null;
    this.puke.hideAim();
  }

  private findAimSeat(): Seat | null {
    const dir = this.aimDir(new THREE.Vector3());
    let best: Seat | null = null;
    let bestScore = Infinity;
    for (const seat of this.seats) {
      if (seat.puked || seat.occupied || seat.couch.ruined) continue;
      const dx = seat.top.x - this.theoPos.x;
      const dz = seat.top.z - this.theoPos.z;
      const d = Math.hypot(dx, dz);
      if (d > 3.6) continue;
      const angle = Math.acos(clamp((dx * dir.x + dz * dir.z) / Math.max(d, 0.001), -1, 1));
      if (d > 1.3 && angle > 1.25) continue;
      if (!this.house.collision.lineOfSight(this.theoPos.x, this.theoPos.z, seat.top.x, seat.top.z)) continue;
      const score = d + angle * 1.8;
      if (score < bestScore) {
        bestScore = score;
        best = seat;
      }
    }
    return best;
  }

  private megaLanding(level: number) {
    const dir = this.aimDir(new THREE.Vector3());
    let distance = 2.4 + level * 5.6;
    const wall = this.house.collision.rayDistance(this.theoPos.x, this.theoPos.z, dir.x, dir.z, distance + 0.5);
    distance = Math.min(distance, wall - 0.3);
    const point = this.theoPos.clone().addScaledVector(dir, Math.max(0.8, distance));
    const radius = (0.75 + level * 0.8) * (this.burrito > 0 ? 1.4 : 1);
    const hits = this.seats.filter(
      (s) =>
        !s.occupied &&
        dist2D(s.top.x, s.top.z, point.x, point.z) < radius + 0.2 &&
        this.house.collision.lineOfSight(point.x, point.z, s.top.x, s.top.z),
    );
    point.y = hits.length > 0 ? hits.reduce((sum, s) => sum + s.top.y, 0) / hits.length : 0.02;
    return { point, radius, hits };
  }

  private updatePuke(dt: number) {
    if (this.mode !== 'playing') {
      this.puke.hideAim();
      return;
    }
    this.aimSeat = this.charging ? null : this.findAimSeat();

    if (this.input.pukePressed) {
      if (this.tummy < QUICK_COST - 3 && this.burrito <= 0) {
        if (this.heaveCooldown <= 0) {
          this.heaveCooldown = 0.9;
          this.sound.heave();
          this.pukeAnim = 0.3;
          this.say('theo', THEO.heave.next(), 'calm', 1.5);
          this.queueHint('tummy', 'Tummy empty! Eat hotdog buns or dig through trash cans to refill.', true);
        }
      } else {
        this.charging = true;
        this.chargeTime = 0;
      }
    }

    if (this.charging) {
      this.chargeTime += dt;
      if (this.chargeTime > CHARGE_DELAY && !this.chargeHandle) this.chargeHandle = this.sound.chargeStart();
      const level = this.chargeLevel();
      this.chargeHandle?.update(level);
      if (this.chargeTime > CHARGE_DELAY) {
        const landing = this.megaLanding(level);
        this.puke.showArc(this.mouth(), landing.point, landing.radius, this.time);
        this.aimPoint.copy(landing.point);
      }
      if (this.input.pukeReleased || !this.input.pukeHeld) {
        const wasMega = this.chargeTime > CHARGE_DELAY;
        this.stopCharge();
        if (wasMega) this.megaHurl(level);
        else this.quickHurl();
      }
    }

    if (!this.charging) this.puke.showReticle(this.aimSeat, this.time);
    else this.puke.showReticle(null, this.time);
  }

  private spend(amount: number) {
    if (this.burrito > 0) {
      this.burrito -= 1;
      return;
    }
    this.tummy = Math.max(0, this.tummy - amount);
  }

  private quickHurl() {
    const target = this.findAimSeat();
    const burrito = this.burrito > 0;
    this.pukeAnim = 0.5;
    this.sound.puke(burrito ? 0.8 : 0.35);
    this.shake = Math.max(this.shake, 0.08);
    if (target) {
      this.spend(QUICK_COST);
      this.puke.fire(this.mouth, target.top, burrito ? 0.7 : 0.25, burrito ? 0.8 : 0.35, () => {
        this.hitSeat(target);
        if (burrito) {
          for (const s of this.seats) {
            if (s !== target && dist2D(s.top.x, s.top.z, target.top.x, target.top.z) < 1.1) this.hitSeat(s);
          }
        }
        this.makeNoise(target.top, 7.5, 'splat');
      });
    } else {
      this.spend(QUICK_COST - 3);
      const dir = this.aimDir(new THREE.Vector3());
      const d = Math.min(2.2, this.house.collision.rayDistance(this.theoPos.x, this.theoPos.z, dir.x, dir.z, 2.6) - 0.3);
      const point = this.theoPos.clone().addScaledVector(dir, Math.max(0.7, d));
      point.y = 0.02;
      this.puke.fire(this.mouth, point, 0.35, 0.35, () => {
        this.floorSplat(point, burrito ? 0.85 : 0.6);
        this.makeNoise(point, 6, 'splat');
      });
    }
    this.makeNoise(this.theoPos, 5, 'puke');
  }

  private megaHurl(level: number) {
    const { point, radius, hits } = this.megaLanding(level);
    this.spend(MEGA_BASE_COST + MEGA_EXTRA_COST * level);
    this.stats.megas += 1;
    this.pukeAnim = 0.7 + level * 0.3;
    this.sound.puke(0.6 + level * 0.5);
    this.shake = Math.max(this.shake, 0.15 + level * 0.2);
    this.fovKick = 6 + level * 6;
    this.flash = 0.06;
    this.puke.fire(this.mouth, point, radius, 0.6 + level, () => {
      const fresh = hits.filter((s) => !s.puked);
      for (const s of hits) this.hitSeat(s);
      if (fresh.length >= 2) {
        const bonus = 200 * (fresh.length - 1);
        this.addScore(bonus, false);
        this.worldUi.pop(point.clone().setY(point.y + 0.9), `MULTI-HURL x${fresh.length}! +${bonus}`, 'gold');
      }
      if (hits.length === 0) this.floorSplat(point, 0.6 + level * 0.55);
      this.puke.splash(point, 18 + Math.round(level * 20), 1 + level * 0.5);
      this.sound.splat(true);
      this.makeNoise(point, 9 + level * 3, 'splat');
      this.shake = Math.max(this.shake, 0.12);
    });
    this.makeNoise(this.theoPos, 6, 'puke');
  }

  private floorSplat(point: THREE.Vector3, radius: number) {
    this.puke.addPuddle(point, radius);
    this.puke.splash(point, 10);
    this.sound.splat(false);
    this.worldUi.pop(point.clone().setY(0.6), pick(POP.floor), 'small');
    this.queueHint('puddle', 'Missed! But puddles are traps: Eddie slips on them.');
  }

  private hitSeat(seat: Seat) {
    if (seat.couch.ruined || seat.occupied) return;
    if (seat.plastic && seat.plastic.visible) {
      seat.plastic.visible = false;
      this.puke.splash(seat.top, 14, 1.2);
      const slide = seat.front.clone();
      slide.y = 0.02;
      this.puke.addPuddle(slide.lerp(seat.top.clone().setY(0.02), 0.45), 0.55);
      this.sound.slip();
      this.addScore(50, false);
      this.worldUi.pop(seat.top.clone().setY(seat.top.y + 0.8), pick(POP.plastic), 'blue');
      return;
    }
    if (seat.puked) {
      this.puke.splash(seat.top, 6);
      return;
    }
    seat.puked = true;
    this.puke.splatSeat(seat);
    seat.material.color.copy(seat.baseColor).lerp(new THREE.Color(0xa6c93a), 0.5);
    this.puke.splash(seat.top, 12);
    this.sound.splat(false);
    this.stats.seats += 1;
    this.combo += 1;
    this.comboTimer = 5;
    this.maxCombo = Math.max(this.maxCombo, this.combo);
    const gained = this.addScore(100, true);
    this.worldUi.pop(seat.top.clone().setY(seat.top.y + 0.7), `${pick(POP.seat)} +${gained}`);

    if (seat.couch.seats.every((s) => s.puked)) this.ruinCouch(seat.couch);
  }

  private addScore(base: number, useCombo: boolean) {
    const mult = useCombo ? Math.min(4, 1 + (this.combo - 1) * 0.5) : 1;
    const gained = Math.round(base * mult);
    this.score += gained;
    return gained;
  }

  private ruinCouch(couch: CouchState) {
    couch.ruined = true;
    couch.ruinedAt = this.time;
    const bonus = 500 + couch.def.bonus;
    this.score += bonus;
    this.sound.ruined();
    this.effects.confettiBurst(couch.center);
    this.effects.addStink(couch.center);
    const ruined = this.couches.filter((c) => c.ruined).length;
    this.hud.showBanner(`${couch.def.name} — RUINED!`, `${couch.def.flavor}  +${bonus}`, 'puke', 2.8);
    this.worldUi.pop(couch.center.clone().setY(1.6), `+${bonus}`, 'gold');
    this.flash = 0.1;

    if (ruined >= this.couches.length) {
      this.win();
      return;
    }
    const newRage = Math.min(4, Math.floor((ruined + 1) / 2));
    if (newRage > this.rage) {
      this.rage = newRage;
      this.syncHostRage();
    }
    if (this.eddie.state !== 'grab') this.eddie.mourn(couch);
    if (this.rage >= 4 && !this.beastAnnounced) {
      this.beastAnnounced = true;
      window.setTimeout(() => {
        if (this.mode !== 'playing') return;
        this.hud.showBanner('EDDIE HAS ENTERED BEAST MODE', 'He is faster. He is louder. He is sweating.', 'danger', 2.8);
        this.say('eddie', EDDIE.beast, 'shout', 2.6);
      }, 3200);
    }
    this.queueHint('ruined', 'Ruined couches stay ruined. Eddie gets angrier (and faster) with every one.');
  }

  private cleanSeat(seat: Seat) {
    if (seat.couch.ruined) return;
    seat.puked = false;
    this.puke.clearSeat(seat);
    seat.material.color.copy(seat.baseColor);
    this.effects.sparkle(seat.top, 14);
    this.stats.cleaned += 1;
    this.worldUi.pop(seat.top.clone().setY(seat.top.y + 0.7), 'CLEANED!', 'blue');
  }

  private makeNoise(at: THREE.Vector3, radius: number, kind: 'puke' | 'splat' | 'squeak') {
    this.eddie.hear(at, radius, kind);
  }

  private onEddieSlip(puddle: Puddle) {
    this.stats.slips += 1;
    this.puke.smear(puddle, this.eddie.facing);
    this.puke.splash(puddle.position, 16, 1.2);
    this.sound.slip();
    this.shake = Math.max(this.shake, 0.25);
    this.addScore(300, false);
    this.worldUi.pop(this.eddie.position.clone().setY(2.2), 'SLAPSTICK! +300', 'gold');
  }

  // ================================================================ catching

  private checkCatch() {
    if (this.mode !== 'playing' || this.invuln > 0 || this.hidden || !this.eddie.canCatch) return;
    const d = dist2D(this.theoPos.x, this.theoPos.z, this.eddie.position.x, this.eddie.position.z);
    if (d < 0.8) this.startCaught();
  }

  private startCaught() {
    this.mode = 'caught';
    this.modeTime = 0;
    this.caughtStage = 0;
    this.stopCharge();
    this.input.enabled = false;
    this.input.releaseAll();
    this.eddie.startGrab(this.theoPos);
    this.carried = true;
    this.lives -= 1;
    this.stats.caught += 1;
    this.combo = 0;
    this.shake = 0.35;
    this.flash = 0.25;
    this.sound.thud();
    this.sound.setMusic('off');
    this.hud.showBanner('CAUGHT!', this.lives > 0 ? `${this.lives} diaper${this.lives === 1 ? '' : 's'} left` : 'Uh oh.', 'danger', 2.2);
  }

  private updateCaught(dt: number) {
    const t = this.modeTime;
    this.house.update(dt, this.time);
    this.eddie.update(dt);
    this.puke.update(dt);
    this.effects.update(dt);
    this.updateCouchFx(dt);
    this.updatePortraits();
    this.updateEddieFx(dt);

    if (this.carried) {
      const l = this.eddie.model.handL.getWorldPosition(new THREE.Vector3());
      const r = this.eddie.model.handR.getWorldPosition(new THREE.Vector3());
      const mid = l.add(r).multiplyScalar(0.5);
      this.theoModel.root.position.set(mid.x, Math.max(0, mid.y - 0.62), mid.z);
      this.theoModel.root.rotation.y = this.eddie.facing + Math.PI;
    }
    this.animateTheo(dt);

    if (this.caughtStage === 0 && t > 1.1) {
      this.caughtStage = 1;
      const head = this.eddie.model.headTop.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, -0.3, 0));
      this.puke.faceBlast(this.mouth(), head);
      this.sound.puke(0.9);
      this.pukeAnim = 0.6;
      this.shake = 0.3;
    }
    if (this.caughtStage === 1 && t > 1.5) {
      this.caughtStage = 2;
      this.eddie.startPukedOn();
      $('fade').classList.add('is-on');
    }
    if (this.caughtStage === 2 && t > 2.0) {
      this.caughtStage = 3;
      this.carried = false;
      if (this.lives <= 0) {
        $('fade').classList.remove('is-on');
        this.lose();
        return;
      }
      this.theoPos.set(THEO_SPAWN.x, 0, THEO_SPAWN.z);
      this.theoVel.set(0, 0, 0);
      this.theoFacing = Math.PI;
      this.camYaw = Math.PI;
      this.invuln = 3;
      $('fade').classList.remove('is-on');
    }
    if (this.caughtStage === 3 && t > 2.4) {
      this.camPos.copy(this.camera.position);
      this.mode = 'playing';
      this.input.enabled = true;
      this.sound.setMusic('calm');
      this.chaseMusic = false;
    }

    // Cinematic camera on the pair.
    const focus = this.caughtStage < 3 ? this.eddie.position : this.theoPos;
    this.camTarget.lerp(this.tmp.copy(focus).setY(this.caughtStage < 3 ? 1.5 : 0.75), 1 - Math.exp(-6 * dt));
    // Swing around to a three-quarter view of Eddie's face (camera looks along -facing).
    const yaw = this.caughtStage < 3 ? this.eddie.facing + Math.PI + 1.15 + Math.sin(t * 0.6) * 0.1 : this.camYaw;
    const dist = this.caughtStage < 3 ? 4.4 : this.camDist;
    const pitch = this.caughtStage < 3 ? 0.28 : this.camPitch;
    const desired = this.tmp2
      .copy(this.camTarget)
      .add(new THREE.Vector3(-Math.sin(yaw) * Math.cos(pitch) * dist, Math.sin(pitch) * dist, -Math.cos(yaw) * Math.cos(pitch) * dist));
    this.camera.position.lerp(desired, 1 - Math.exp(-5 * dt));
    this.camera.lookAt(this.camTarget);
    this.updateOccluders(dt, true);
    const eddieHead = this.eddie.model.headTop.getWorldPosition(new THREE.Vector3());
    this.worldUi.update(dt, eddieHead, this.theoModel.root.position.clone().setY(this.theoModel.root.position.y + 1.2), 1, false, false, false);
    this.eddie.model.talking = this.worldUi.isTalking('eddie') ? 1 : 0;
    this.updateHud(dt);
  }

  // ================================================================ end states

  private win() {
    this.mode = 'won';
    this.modeTime = 0;
    this.stopCharge();
    this.input.enabled = false;
    this.input.exitPointerLock();
    this.sound.setMusic('off');
    this.sound.fanfare();
    const timeBonus = Math.max(0, Math.round(4000 - this.elapsed * 12));
    const lifeBonus = this.lives * 1000;
    this.score += timeBonus + lifeBonus;
    this.hud.showBanner('ALL COUCHES RUINED!', 'Eddie is going to need a minute. Or a year.', 'gold', 3);
    this.effects.confettiBurst(this.theoPos, 140);
    this.eddie.state = 'mourn';
    this.eddie.stateTime = 1.6;
    this.say('eddie', 'WHY. WHY WOULD YOU DO THIS. I LOVED THEM ALL.', 'sad', 4);
    window.setTimeout(() => this.showEnd(true, timeBonus, lifeBonus), 2600);
  }

  private lose() {
    this.mode = 'lost';
    this.modeTime = 0;
    this.input.enabled = false;
    this.input.exitPointerLock();
    this.sound.setMusic('off');
    this.sound.caught();
    this.hud.showBanner('NAP TIME.', 'Theo has been sentenced to the playpen.', 'danger', 3);
    window.setTimeout(() => this.showEnd(false, 0, 0), 2400);
  }

  private showEnd(won: boolean, timeBonus: number, lifeBonus: number) {
    if (this.mode !== 'won' && this.mode !== 'lost') return;
    const isBest = this.score > this.best;
    if (isBest) {
      this.best = this.score;
      safeStorageSet('eddie.best', String(this.best));
    }
    const rank = rankFor(this.score);
    const ruined = this.couches.filter((c) => c.ruined).length;
    $('end-kicker').textContent = won ? (isBest ? 'New best score!' : 'Victory') : isBest ? 'New best score!' : 'Game over';
    $('end-title').textContent = won ? 'Couchapocalypse!' : 'Nap time.';
    $('end-blurb').textContent = won
      ? `Every seat in the house is soaked. Eddie is in the yard, lying face-down in the grass.`
      : `Eddie confiscated your diaper privileges. ${ruined} of 9 couches ruined.`;
    $('end-grade').textContent = rank.grade;
    $('end-rank-title').textContent = rank.title;
    $('end-rank-blurb').textContent = rank.blurb;
    const stats: [string, string][] = [
      ['Time', formatTime(this.elapsed)],
      ['Couches', `${ruined}/9`],
      ['Seats soaked', `${this.stats.seats}/${TOTAL_SEATS}`],
      ['Eddie slips', String(this.stats.slips)],
      ['Best combo', `x${this.maxCombo}`],
      ['Buns eaten', String(this.stats.buns)],
    ];
    if (won) stats.push(['Time bonus', `+${timeBonus}`], ['Diaper bonus', `+${lifeBonus}`], ['Mega hurls', String(this.stats.megas)]);
    $('end-stats').innerHTML = stats.map(([k, v]) => `<div class="stat"><b>${v}</b><span>${k}</span></div>`).join('');
    $('end-score').textContent = this.score.toLocaleString();
    $('end-best').textContent = this.best.toLocaleString();
    this.showScreen('screen-end', true);
    this.hud.show(false);
    this.hud.hideBanner();
    $('touch').classList.remove('is-active');
  }

  // ================================================================ pickups

  private readonly pickupHost: PickupHost = {
    canCollect: (kind: PickupKind) => {
      if (kind === 'bun') return this.tummy < 99;
      if (kind === 'toy') return !this.hasToy;
      return true;
    },
    collect: (kind: PickupKind, at: THREE.Vector3) => {
      switch (kind) {
        case 'bun':
          this.tummy = Math.min(100, this.tummy + 28);
          this.stats.buns += 1;
          this.sound.chomp();
          this.worldUi.pop(at.clone().setY(1.2), '+TUMMY', 'small');
          if (Math.random() < 0.4) this.say('theo', THEO.bun.next(), 'calm', 1.4);
          break;
        case 'juice':
          this.zoomies = 7;
          this.stamina = 1;
          this.tired = false;
          this.sound.zoomies();
          this.worldUi.pop(at.clone().setY(1.2), 'ZOOMIES!', 'gold');
          this.say('theo', THEO.zoomies, 'shout', 1.4);
          break;
        case 'toy':
          this.hasToy = true;
          this.sound.squeak();
          this.worldUi.pop(at.clone().setY(1.2), 'SQUEAKY TOY!', 'small');
          this.queueHint('toy', this.isTouch ? 'Tap TOY to throw it. Eddie will go check on the squeak.' : 'Press Q (or right-click) to throw the toy. Eddie will go check on the squeak.', true);
          break;
        case 'burrito':
          this.tummy = 100;
          this.burrito = 3;
          this.sound.chomp();
          this.sound.fanfare();
          this.hud.showBanner('MYSTERY BURRITO!', 'Your next 3 hurls are free and extra chunky.', 'gold', 2.6);
          break;
      }
      this.effects.sparkle(at, 8);
    },
    rummage: (at: THREE.Vector3) => {
      if (this.tummy >= 99) return false;
      this.tummy = Math.min(100, this.tummy + 20);
      this.stats.buns += 1;
      this.sound.chomp();
      this.worldUi.pop(at.clone().setY(1.3), 'TRASH BUN!', 'small');
      return true;
    },
    toyLanded: (at: THREE.Vector3) => {
      this.sound.squeak();
      this.worldUi.pop(at.clone().setY(0.8), 'SQUEAK!', 'gold');
      this.makeNoise(at, 13, 'squeak');
    },
    microwaveStarted: () => {
      this.sound.microwaveHum(6);
    },
    microwaveDing: (at: THREE.Vector3) => {
      this.sound.ding();
      this.worldUi.pop(at.clone().setY(1.6), 'DING!', 'gold');
      this.queueHint('burrito', 'DING! A Mystery Burrito popped out of the kitchen microwave.', true);
      this.makeNoise(at, 7, 'splat');
    },
  };

  // ================================================================ ambient fx

  private updateCouchFx(dt: number) {
    for (const couch of this.couches) {
      if (couch.vibrator && couch.ruined) {
        couch.vibrator.position.set(rand(-0.015, 0.015), rand(0, 0.01), rand(-0.015, 0.015));
        if (Math.random() < dt * 6) this.puke.splash(couch.center, 1, 0.6);
      }
    }
  }

  private updatePortraits() {
    for (const p of this.house.props.portraits) {
      const local = p.group.worldToLocal(this.tmp.copy(this.theoPos).setY(0.9));
      for (let i = 0; i < p.pupils.length; i += 1) {
        const c = p.centers[i];
        const dir = this.tmp2.set(local.x - c.x, local.y - c.y, Math.max(0.5, local.z));
        dir.normalize();
        p.pupils[i].position.set(c.x + dir.x * p.radius, c.y + dir.y * p.radius, c.z);
      }
    }
  }

  private updateEddieFx(dt: number) {
    const model = this.eddie.model;
    const head = model.headTop.getWorldPosition(new THREE.Vector3());
    this.effects.dizzy(this.eddie.state === 'slip' && this.eddie.stateTime > 0.5 ? head : null);
    this.steamTimer -= dt;
    if (this.rage >= 3 && this.eddie.chasing && this.steamTimer <= 0) {
      this.steamTimer = 0.12;
      this.effects.steam(model.earL.getWorldPosition(new THREE.Vector3()), -1);
      this.effects.steam(model.earR.getWorldPosition(new THREE.Vector3()), 1);
    }
    this.tearTimer -= dt;
    if (this.eddie.state === 'mourn' && this.tearTimer <= 0) {
      this.tearTimer = 0.1;
      const eye = head.clone().add(new THREE.Vector3(0, -0.3, 0));
      this.effects.tear(eye, Math.random() < 0.5 ? -1 : 1);
    }
  }

  // ================================================================ camera

  private attractCamera(dt: number, snap = false) {
    const a = this.time * 0.06 + 0.6;
    const pos = this.tmp.set(Math.sin(a) * 21, 15 + Math.sin(this.time * 0.13) * 1.5, Math.cos(a) * 17);
    if (snap) this.camera.position.copy(pos);
    else this.camera.position.lerp(pos, 1 - Math.exp(-2 * dt));
    this.camera.lookAt(0, -1.5, 0);
    this.camPos.copy(this.camera.position);
  }

  private followCamera(dt: number, weight: number) {
    // While winding up a mega hurl, frame both Theo and the landing zone.
    const aiming = this.charging && this.chargeTime > CHARGE_DELAY;
    this.aimBlend = damp(this.aimBlend, aiming ? 1 : 0, 5, dt);
    const target = this.tmp.copy(this.theoPos).setY(0.75);
    if (this.aimBlend > 0.001) target.lerp(this.tmp2.copy(this.aimPoint).setY(0.75), 0.42 * this.aimBlend);
    this.camTarget.lerp(target, 1 - Math.exp(-12 * dt));
    const dist = this.camDist + this.aimBlend * 2.2;
    const pitch = this.camPitch + this.aimBlend * 0.12;
    const horizontal = Math.cos(pitch) * dist;
    const desired = this.tmp2.set(
      this.camTarget.x - Math.sin(this.camYaw) * horizontal,
      this.camTarget.y + Math.sin(pitch) * dist,
      this.camTarget.z - Math.cos(this.camYaw) * horizontal,
    );
    this.camPos.lerp(desired, 1 - Math.exp(-14 * dt));
    if (weight >= 1 || this.mode !== 'intro') {
      this.camera.position.copy(this.camPos);
      if (this.shake > 0) {
        this.camera.position.x += rand(-1, 1) * this.shake * 0.25;
        this.camera.position.y += rand(-1, 1) * this.shake * 0.25;
        this.camera.position.z += rand(-1, 1) * this.shake * 0.25;
      }
      const look = this.tmp.copy(this.camTarget).addScaledVector(this.aimDir(new THREE.Vector3()), 1.2);
      this.camera.lookAt(look);
    }
    this.shake = Math.max(0, this.shake - dt * 1.2);
    const sprintFov = Math.hypot(this.theoVel.x, this.theoVel.z) > 3.6 ? 5 : 0;
    this.fovKick = Math.max(0, this.fovKick - dt * 18);
    const fov = 52 + sprintFov + this.fovKick;
    if (Math.abs(this.camera.fov - fov) > 0.01) {
      this.camera.fov = damp(this.camera.fov, fov, 8, dt);
      this.camera.updateProjectionMatrix();
    }
    this.updateOccluders(dt, true);
  }

  private updateOccluders(dt: number, active: boolean) {
    const cam = this.camera.position;
    const targets: THREE.Vector3[] = [];
    if (active) {
      targets.push(new THREE.Vector3(this.theoPos.x, 0.8, this.theoPos.z), new THREE.Vector3(this.theoPos.x, 0.15, this.theoPos.z));
      if (dist2D(this.eddie.position.x, this.eddie.position.z, this.theoPos.x, this.theoPos.z) < 9) {
        targets.push(new THREE.Vector3(this.eddie.position.x, 1.2, this.eddie.position.z));
      }
      if (this.aimSeat) targets.push(this.aimSeat.top.clone());
    }
    for (const occ of this.house.occluders) {
      let hidden = false;
      if (occ.follow) hidden = occ.follow.opacity < 0.9;
      else for (const t of targets) {
        const dir = this.tmp.copy(t).sub(cam);
        const len = dir.length();
        dir.divideScalar(len);
        this.ray.set(cam, dir);
        const hit = this.ray.intersectBox(occ.box, this.tmp2);
        if (hit && hit.distanceTo(cam) < len - 0.1) {
          hidden = true;
          break;
        }
      }
      const target = hidden ? 0.16 : 1;
      if (Math.abs(occ.opacity - target) < 0.001) continue;
      occ.opacity = damp(occ.opacity, target, 10, dt);
      if (Math.abs(occ.opacity - target) < 0.01) occ.opacity = target;
      for (const m of occ.materials) {
        const base = (m.userData.baseOpacity as number) ?? 1;
        const fading = occ.opacity < 0.999;
        m.opacity = base * occ.opacity;
        const transparent = fading || Boolean(m.userData.baseTransparent);
        if (m.transparent !== transparent) {
          // The OPAQUE define is baked into the shader program, so it must be rebuilt.
          m.transparent = transparent;
          m.needsUpdate = true;
        }
        m.depthWrite = occ.opacity > 0.6;
      }
    }
  }

  private updatePost(dt: number) {
    const u = this.gfx.uniforms;
    const nausea = this.charging ? this.chargeLevel() : 0;
    u.uNausea.value = damp(u.uNausea.value, nausea, 8, dt);
    let danger = 0;
    if ((this.mode === 'playing' || this.mode === 'caught') && this.eddie.chasing) {
      const d = dist2D(this.theoPos.x, this.theoPos.z, this.eddie.position.x, this.eddie.position.z);
      danger = clamp(1 - (d - 1) / 6, 0.15, 1);
    }
    this.danger = damp(this.danger, danger, 4, dt);
    u.uDanger.value = this.danger;
    this.flash = Math.max(0, this.flash - dt * 1.5);
    u.uFlash.value = this.flash;
    u.uDim.value = damp(u.uDim.value, this.mode === 'paused' ? 0.55 : 0, 10, dt);
  }

  // ================================================================ misc

  private say(who: 'eddie' | 'theo', text: string, mood: Mood, duration = 2.2) {
    this.worldUi.say(who, text, mood, duration);
    const syllables = Math.round(clamp(text.length / 4, 2, 12));
    if (who === 'eddie') {
      if (mood !== 'sleepy') this.sound.voice(syllables, { pitch: mood === 'sad' ? 150 : 118, angry: mood === 'shout' || mood === 'angry' });
    } else {
      this.sound.voice(Math.min(4, syllables), { pitch: 340, speed: 1.3 });
    }
  }

  private updateCombo(dt: number) {
    if (this.comboTimer > 0) {
      this.comboTimer -= dt;
      if (this.comboTimer <= 0) this.combo = 0;
    }
  }

  private queueHint(key: string, text: string, urgent = false) {
    if (this.seenHints.has(key)) return;
    this.seenHints.add(key);
    if (urgent) this.hintQueue.unshift(text);
    else this.hintQueue.push(text);
  }

  private updateHints(dt: number) {
    if (this.tummy < 30) this.queueHint('tummyLow', 'Tummy getting low. Hotdog buns float around the house; trash cans are full of them.');
    this.hintCooldown -= dt;
    if (this.hintCooldown <= 0 && this.hintQueue.length > 0) {
      const text = this.hintQueue.shift() as string;
      this.hud.showHint(text, 5.5);
      this.hintCooldown = 6.2;
    }
  }

  private updateMusic() {
    const chasing = this.eddie.chasing;
    if (chasing !== this.chaseMusic) {
      this.chaseMusic = chasing;
      this.sound.setMusic(chasing ? 'chase' : 'calm');
    }
  }

  private updateHud(dt: number) {
    const status = this.eddie.status();
    this.hud.update(dt, {
      couches: this.couches,
      targetCouch: this.aimSeat?.couch ?? null,
      score: this.score,
      combo: this.combo,
      lives: this.lives,
      maxLives: MAX_LIVES,
      tummy: this.tummy,
      stamina: this.stamina,
      tired: this.tired,
      eddie: status,
      rage: this.rage,
      hasToy: this.hasToy,
      burrito: this.burrito,
      zoomies: this.zoomies,
      hidden: this.hidden,
    });
    this.minimap.draw({
      theo: { x: this.theoPos.x, z: this.theoPos.z, facing: this.theoFacing },
      cameraYaw: this.camYaw,
      eddie: {
        x: this.eddie.position.x,
        z: this.eddie.position.z,
        facing: this.eddie.facing,
        chasing: this.eddie.chasing,
        asleep: this.eddie.state === 'sleep',
        range: 7.4 + this.rage * 0.55,
      },
      couches: this.couches,
      pickups: this.pickups.markers(),
      trash: this.pickups.trashMarkers(),
      puddles: this.puke.puddles,
      time: this.time,
    });
    const eddieHead = this.eddie.model.headTop.getWorldPosition(new THREE.Vector3());
    const theoHead = this.theoModel.root.position.clone().setY(this.theoModel.root.position.y + 1.15);
    if (this.mode === 'playing' || this.mode === 'intro') {
      this.worldUi.update(dt, eddieHead, theoHead, this.eddie.suspicion, this.eddie.chasing && this.eddie.state === 'alert', this.eddie.state !== 'sleep', this.eddie.chasing);
    }
    this.eddie.model.talking = this.worldUi.isTalking('eddie') ? 1 : 0;
  }
}

