import * as THREE from 'three';
import { GameRenderer, type Quality } from '../core/renderer';
import { Input } from '../core/input';
import { Sound, type ChargeHandle } from '../core/audio';
import { clamp, damp, dampAngle, dist2D, formatTime, pick, rand, safeStorageGet, safeStorageSet, yawTo } from '../core/util';
import { buildHouse, type House } from '../world/house';
import { SPAWNS, TOTAL_SEATS, roomAt } from '../world/layout';
import { Eddie, type EddieDrive, type EddieHost, type EddieTarget } from '../actors/eddie';
import { Messer, type MessControls } from '../actors/messer';
import { MesserBrain, type AiView } from '../actors/messerAi';
import { ROLES, timeoutSeat, type MesserId, type Role } from '../actors/cast';
import { PukeSystem } from '../fx/puke';
import { Effects } from '../fx/effects';
import { Pickups, type FoodKind, type PickupHost, type PickupKind } from './pickups';
import { Hud } from '../ui/hud';
import { WorldUi, type ArrowStyle, type Speaker } from '../ui/worldui';
import { Minimap } from '../ui/minimap';
import { renderPortraits } from '../ui/portraits';
import { EDDIE, EDDIE_RANKS, POP, THEO, TIPS, ZACH, rankFor } from '../data/lines';
import type { CouchState, MessStyle, Mood, Puddle, Seat } from './types';
import { blobShadow } from '../world/kit';
import { blobShadowTexture } from '../world/textures';

type Mode = 'title' | 'intro' | 'playing' | 'caught' | 'paused' | 'won' | 'lost';

const MAX_LIVES = 3;
const QUICK_COST = 13;
const MEGA_BASE_COST = 18;
const MEGA_EXTRA_COST = 27;
const CHARGE_DELAY = 0.2;
const CHARGE_TIME = 0.95;
/** Seconds a caught computer-controlled mess-maker spends in the time-out corner. */
const TIMEOUT = 12;
/** Seconds Zach has to find a toilet once his gut goes critical. */
const EMERGENCY_TIME = 18;
/** Eddie mode: survive this long... */
const ROUND_TIME = 150;
/** ...without this many couches getting ruined. */
const RUIN_LIMIT = 5;
/** Eddie mode: a fully messed couch takes this long to soak through, so there's time to scrub one seat. */
const SET_TIME = 10;

const FOOD: Record<FoodKind, { ammo: number; bloat: number; label: string }> = {
  nuggets: { ammo: 30, bloat: 20, label: 'NUGGETS!' },
  drumsticks: { ammo: 34, bloat: 26, label: 'DRUMSTICKS!' },
  mac: { ammo: 26, bloat: 16, label: 'MAC & CHEESE!' },
  chicken: { ammo: 100, bloat: 42, label: 'WHOLE CHICKEN!' },
  burrito: { ammo: 100, bloat: 50, label: 'MYSTERY BURRITO!' },
};

const COLORS: Record<Role, string> = { theo: '#8fd3ff', zach: '#ffb347', eddie: '#ff6b5e' };

interface Caught {
  m: Messer;
  stage: number;
  kind: 'grab' | 'accident';
}

function $(id: string) {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing #${id}`);
  return node;
}

function isRole(value: string | null): value is Role {
  return value === 'theo' || value === 'zach' || value === 'eddie';
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
  private readonly theo = new Messer('theo');
  private readonly zach = new Messer('zach');
  private readonly messers: Messer[] = [this.theo, this.zach];
  private readonly brains: Record<MesserId, MesserBrain> = { theo: new MesserBrain(), zach: new MesserBrain() };
  private readonly targets: Record<MesserId, EddieTarget>;
  private readonly couches: CouchState[] = [];
  private readonly seats: Seat[] = [];
  private readonly timer = new THREE.Timer();

  private role: Role;
  private player: Messer | null = null;
  private mode: Mode = 'title';
  private pausedFrom: Mode = 'playing';
  private time = 0;
  private modeTime = 0;

  private chargeHandle: ChargeHandle | null = null;
  private aimSeat: Seat | null = null;
  private readonly aimPoint = new THREE.Vector3();
  private aimBlend = 0;
  private readonly controls: MessControls = { move: new THREE.Vector2(), sprint: false, face: null };
  private readonly drive: EddieDrive = { move: new THREE.Vector2(), sprint: false, aimYaw: 0, lunge: false, yell: false, scrub: null };
  private scrubSpot: { seat: Seat | null; puddle: Puddle | null; at: THREE.Vector3 } | null = null;
  private readonly scrubProgress = new Map<object, number>();
  private aiCarry: { m: Messer; t: number } | null = null;
  private caught: Caught | null = null;
  private readonly gurgle: Record<MesserId, number> = { theo: 0, zach: 0 };
  private readonly timers: { t: number; fn: () => void }[] = [];

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
  private lastLook = 0;

  // Score + stats.
  private score = 0;
  private combo = 0;
  private comboTimer = 0;
  private maxCombo = 0;
  private lives = MAX_LIVES;
  private elapsed = 0;
  private clock = ROUND_TIME;
  private stats = { slips: 0, caught: 0, seats: 0, megas: 0, eaten: 0, cleaned: 0, catches: 0, braps: 0, swole: 0, accidents: 0, yells: 0 };
  private rage = 0;
  private beastAnnounced = false;
  private seenHints = new Set<string>();
  private hintQueue: string[] = [];
  private hintCooldown = 0;
  private steamTimer = 0;
  private tearTimer = 0;
  private chaseMusic = false;
  private danger = 0;
  private flash = 0;
  private best: Record<Role, number> = { theo: 0, zach: 0, eddie: 0 };
  private readonly tmp = new THREE.Vector3();
  private readonly tmp2 = new THREE.Vector3();
  private readonly ray = new THREE.Ray();

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly isTouch: boolean,
  ) {
    const savedQuality = safeStorageGet('eddie.quality') as Quality | null;
    const quality: Quality = savedQuality === 'fancy' || savedQuality === 'fast' ? savedQuality : isTouch ? 'fast' : 'fancy';
    const savedRole = safeStorageGet('eddie.role');
    this.role = isRole(savedRole) ? savedRole : 'theo';
    for (const r of ['theo', 'zach', 'eddie'] as Role[]) {
      this.best[r] = Number(safeStorageGet(`eddie.best.${r}`) ?? (r === 'theo' ? safeStorageGet('eddie.best') : 0) ?? 0) || 0;
    }
    this.gfx = new GameRenderer(canvas, this.scene, this.camera, quality);
    this.house = buildHouse(this.scene, quality);

    for (const { def, built } of this.house.couches) {
      const couch: CouchState = { def, seats: [], ruined: false, center: built.center, vibrator: built.vibrator, ruinedAt: 0, setting: 0 };
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
          messed: false,
          mess: null,
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
    this.pickups = new Pickups(this.scene, shadowTex, this.house.microwave);

    for (const m of this.messers) {
      this.scene.add(m.rig.root);
      const size = m.id === 'theo' ? 0.7 : 0.95;
      m.rig.root.add(blobShadow(shadowTex, size, size, 0.5));
    }
    this.targets = {
      theo: { id: 'theo', position: this.theo.position, hidden: false, noisy: false, catchable: true, onToilet: false },
      zach: { id: 'zach', position: this.zach.position, hidden: false, noisy: false, catchable: true, onToilet: false },
    };

    const host: EddieHost = {
      collision: this.house.collision,
      seats: this.seats,
      puddles: this.puke.puddles,
      targets: [this.targets.theo, this.targets.zach],
      rage: 0,
      say: (text, mood, duration) => this.say('eddie', text, mood, duration),
      onAlert: (target) => {
        this.sound.alert();
        if (this.player && target.id === this.player.id) {
          this.shake = Math.max(this.shake, 0.15);
          this.flash = 0.12;
          this.queueHint(
            'spotted',
            this.player.id === 'theo'
              ? 'Busted! Break line of sight, hide under the table/bed, or lay puddles to trip him.'
              : 'Busted! Outrun him, trip him on a sauce puddle, or let him grab you: you can flex out once.',
          );
        }
      },
      onSlip: (p) => this.onEddieSlip(p),
      onCleaned: (seat) => this.cleanSeat(seat),
      onSpray: (origin, dir) => this.puke.spray(origin, dir),
      onWake: () => this.queueHint('wake', 'Eddie is awake! Stay out of his red vision cone on the minimap.'),
      onDirtySpotted: (seat) => {
        if (this.eddie.state !== 'chase') this.say('eddie', EDDIE.dirty.next(), 'shout', 1.6);
        this.queueHint('clean', `Eddie spotted a stain on ${seat.couch.def.name} and will scrub it. Finish couches to ruin them for good!`);
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
    const onResize = () => {
      this.gfx.resize();
      this.minimap.resize();
    };
    window.addEventListener('resize', onResize);
    // iOS Safari's bars grow and shrink without always firing a window resize.
    window.visualViewport?.addEventListener('resize', onResize);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && (this.mode === 'playing' || this.mode === 'intro')) this.pause();
    });

    this.resetRound();
    this.toTitle();
    this.timer.connect(document);
    this.gfx.renderer.setAnimationLoop((t) => this.frame(t));
    // Paint the character cards once the game is up.
    window.setTimeout(() => this.paintPortraits(), 60);
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
    document.querySelectorAll<HTMLButtonElement>('.pick-card').forEach((card) => {
      card.addEventListener('click', () => {
        this.sound.unlock();
        this.sound.click();
        const role = card.dataset.role ?? null;
        if (isRole(role)) this.selectRole(role);
      });
      card.addEventListener('dblclick', () => this.startGame());
    });
    $('pause-button').addEventListener('click', () => {
      if (this.mode === 'playing') this.pause();
    });
    window.addEventListener('keydown', (event) => {
      if (this.mode !== 'title') return;
      if (event.code === 'Enter') {
        this.sound.unlock();
        this.startGame();
      }
      const keys: Record<string, Role> = { Digit1: 'theo', Digit2: 'zach', Digit3: 'eddie' };
      if (keys[event.code]) this.selectRole(keys[event.code]);
    });
    this.selectRole(this.role);
    this.refreshToggles();
  }

  private paintPortraits() {
    const urls = renderPortraits();
    for (const role of ['theo', 'zach', 'eddie'] as Role[]) {
      const img = document.querySelector<HTMLImageElement>(`.pick-card[data-role="${role}"] .pick-portrait`);
      const url = urls[role];
      if (img && url) {
        img.src = url;
        img.classList.add('is-ready');
      }
    }
  }

  private selectRole(role: Role) {
    this.role = role;
    safeStorageSet('eddie.role', role);
    document.querySelectorAll<HTMLElement>('.pick-card').forEach((card) => {
      const selected = card.dataset.role === role;
      card.classList.toggle('is-selected', selected);
      card.setAttribute('aria-pressed', String(selected));
    });
    $('play-button').textContent = `Play as ${ROLES[role].name}`;
    $('pick-blurb').textContent = ROLES[role].blurb;
    document.body.dataset.pick = role;
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
    const best = this.best[this.role];
    $('best-score').textContent = best > 0 ? `Best as ${ROLES[this.role].name}: ${best.toLocaleString()}` : '';
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
    $('fade').classList.remove('is-on');
    for (const id of ['screen-help', 'screen-pause', 'screen-end']) this.showScreen(id, false);
    this.showScreen('screen-title', true);
    this.refreshToggles();
    this.sound.setMusic('title');
    this.attractCamera(0, true);
  }

  private startGame() {
    if (this.mode !== 'title') return;
    this.sound.unlock();
    this.enterFullscreen();
    this.showScreen('screen-title', false);
    this.showScreen('screen-help', false);
    this.resetRound();
    this.beginIntro();
  }

  private beginIntro() {
    this.mode = 'intro';
    this.modeTime = 0;
    this.introFrom.copy(this.camera.position);
    this.introLook.set(0, 0, 0);
    const info = ROLES[this.role];
    this.hud.setRole(this.role, info.action, info.secondary);
    this.hud.show(true);
    $('touch').classList.add('is-active');
    this.input.enabled = true;
    if (!this.isTouch) this.input.requestPointerLock();
    this.sound.setMusic('calm');
    if (this.role === 'eddie') {
      this.hud.showBanner('Theo and Zach are loose in your house', `Keep the couches clean until bedtime. Lose ${RUIN_LIMIT} couches and it’s over.`, 'info', 3.8);
      this.queueHint(
        'controls',
        this.isTouch
          ? 'Left thumb: move · Right thumb: look · GRAB: lunge, or hold next to a stain to scrub · YELL: freeze everyone nearby'
          : 'WASD: move · Mouse: look · Click/Space: GRAB (lunge), hold next to a stain to SCRUB · Q: YELL · Shift: sprint',
      );
      this.queueHint('eddieGoal', 'Touch Theo or Zach to send them to time-out. Zach flexes out of the first grab, so grab him twice.');
    } else {
      const zach = this.role === 'zach';
      this.hud.showBanner('Shhh... Eddie is napping', zach ? 'Sauce every seat of all 9 couches. Mind your gut.' : 'Hurl on every seat of all 9 couches. Zach has your back. Sort of.', 'info', 3.6);
      this.queueHint(
        'controls',
        this.isTouch
          ? `Left thumb: move (you aim where you face) · Right thumb: look · ${info.action.toUpperCase()}: tap, or hold for MEGA`
          : `WASD: move · Mouse: look · Click/Space: ${info.action.toUpperCase()} (hold for MEGA) · Shift: sprint`,
      );
      this.queueHint('aim', 'The yellow arrow marks your auto-aim seat. Mess up every seat of every couch!');
      if (zach) this.queueHint('gut', 'Food refills your sauce but fills your gut. When it’s full, RUN to a bidet (the blue dots on the minimap).');
    }
  }

  /** Phones/tablets: grab real fullscreen where the browser allows it (Android, iPad). */
  private enterFullscreen() {
    if (!this.isTouch || document.fullscreenElement) return;
    const root = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => void };
    try {
      const request = root.requestFullscreen ? root.requestFullscreen({ navigationUI: 'hide' }) : root.webkitRequestFullscreen?.();
      Promise.resolve(request)
        .then(() => (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }).lock?.('landscape'))
        .catch(() => undefined);
    } catch {
      // Not supported (iPhone Safari): the title screen suggests Add to Home Screen instead.
    }
  }

  private get compact() {
    return document.body.classList.contains('is-compact');
  }

  private restart() {
    this.enterFullscreen();
    for (const id of ['screen-pause', 'screen-end', 'screen-help', 'screen-title']) this.showScreen(id, false);
    $('fade').classList.remove('is-on');
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
    this.input.enabled = this.mode !== 'caught';
    if (!this.isTouch) this.input.requestPointerLock();
    this.chaseMusic = false;
    this.sound.setMusic('calm');
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
      couch.setting = 0;
      for (const seat of couch.seats) {
        seat.messed = false;
        seat.mess = null;
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
    this.player = this.role === 'eddie' ? null : this.role === 'theo' ? this.theo : this.zach;
    for (const m of this.messers) {
      const spawn = SPAWNS[m.id];
      m.reset(spawn.x, spawn.z, Math.PI);
      m.isPlayer = m === this.player;
      this.brains[m.id].reset();
      this.gurgle[m.id] = rand(2, 4);
    }
    this.stopCharge();
    this.aimSeat = null;
    this.scrubSpot = null;
    this.scrubProgress.clear();
    this.aiCarry = null;
    this.caught = null;
    this.timers.length = 0;
    this.score = 0;
    this.combo = 0;
    this.comboTimer = 0;
    this.maxCombo = 0;
    this.lives = MAX_LIVES;
    this.elapsed = 0;
    this.clock = ROUND_TIME;
    this.stats = { slips: 0, caught: 0, seats: 0, megas: 0, eaten: 0, cleaned: 0, catches: 0, braps: 0, swole: 0, accidents: 0, yells: 0 };
    this.rage = 0;
    this.beastAnnounced = false;
    this.seenHints.clear();
    this.hintQueue = [];
    this.hintCooldown = 0;
    this.chaseMusic = false;
    this.danger = 0;
    const recliner = this.seats.find((s) => s.couch.def.id === 'recliner');
    this.eddie.driven = this.role === 'eddie';
    if (recliner) this.eddie.reset(recliner, this.role !== 'eddie', SPAWNS.eddie);
    this.syncHostRage();
    if (this.role === 'eddie') {
      this.camYaw = yawTo(SPAWNS.eddie.x, SPAWNS.eddie.z, 2, 2);
      this.eddie.facing = this.camYaw;
      this.camDist = 8.4;
    } else {
      this.camYaw = Math.PI;
      this.camDist = this.role === 'zach' ? 7.8 : 7.2;
    }
    this.camPitch = 0.72;
    for (const m of this.messers) m.sync();
  }

  private syncHostRage() {
    this.eddieHost.rage = this.rage;
  }

  /** Runs a callback after `seconds` of game time (pauses with the game). */
  private later(seconds: number, fn: () => void) {
    this.timers.push({ t: seconds, fn });
  }

  private updateTimers(dt: number) {
    for (let i = this.timers.length - 1; i >= 0; i -= 1) {
      const t = this.timers[i];
      t.t -= dt;
      if (t.t <= 0) {
        this.timers.splice(i, 1);
        t.fn();
      }
    }
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
        this.updateWorld(dt);
        this.attractCamera(dt);
        break;
      case 'intro':
        this.updatePlaying(dt);
        if (this.modeTime > 1.6) this.mode = 'playing';
        break;
      case 'playing':
        this.updatePlaying(dt);
        break;
      case 'caught':
        this.updateCaught(dt);
        break;
      case 'won':
      case 'lost':
        this.updateWorld(dt);
        this.followCamera(dt);
        this.updateHud(dt);
        break;
      case 'paused':
        break;
    }

    this.input.endFrame();
    this.updatePost(dt);
  }

  /** Title screen and end screens: everyone animates, nobody thinks. */
  private updateWorld(dt: number) {
    this.house.update(dt, this.time);
    const ended = this.mode === 'won' || this.mode === 'lost';
    const messersWon = (this.mode === 'won') === (this.role !== 'eddie');
    if (ended) {
      if (messersWon) {
        this.eddie.state = 'mourn';
        this.eddie.stateTime = Math.max(this.eddie.stateTime, 1.6) + dt;
      } else {
        this.eddie.state = 'celebrate';
      }
      for (const m of this.messers) {
        m.vel.set(0, 0, 0);
        m.celebrating = messersWon && m.timeout <= 0 && m.toilet < 0;
        m.sulking = !messersWon && m.timeout <= 0 && m.toilet < 0;
      }
    }
    this.eddie.animateOnly(dt);
    this.puke.update(dt);
    this.effects.update(dt);
    this.animateMessers(dt);
    this.updateCouchFx(dt);
    this.updatePortraits();
    this.worldUi.update(dt, this.heads(), 0, false, false, null);
    this.eddie.model.talking = this.worldUi.isTalking('eddie') ? 1 : 0;
    this.updateOccluders(dt, this.mode !== 'title');
  }

  private updatePlaying(dt: number) {
    const playing = this.mode === 'playing';
    if (playing) this.elapsed += dt;
    this.updateTimers(dt);
    this.updateCameraInput(dt);
    this.updateTargets();

    if (this.role === 'eddie') this.updateEddiePlayer(dt);
    else this.updatePlayerMesser(dt);
    this.updateAiMessers(dt);
    for (const m of this.messers) {
      this.updateGut(m, dt);
      this.updateToilet(m, dt);
      this.updateTimeout(m, dt);
    }

    this.house.update(dt, this.time);
    if (this.role !== 'eddie') this.eddie.update(dt);
    this.updateAiCarry(dt);
    this.updateSetting(dt);
    this.pickups.update(dt, this.collectors(), this.pickupHost);
    this.puke.update(dt);
    this.effects.update(dt);
    this.animateMessers(dt);
    this.updateCouchFx(dt);
    this.updatePortraits();
    this.updateEddieFx(dt);
    this.checkCatches();
    this.updateCombo(dt);
    this.updateHints(dt);
    this.updateMusic();

    if (this.role === 'eddie' && playing) {
      this.clock -= dt;
      if (this.clock <= 0) {
        this.clock = 0;
        this.win();
      }
    }

    if (this.mode === 'intro') {
      const k = clamp(this.modeTime / 1.6, 0, 1);
      this.followCamera(dt);
      const ease = k * k * (3 - 2 * k);
      this.camera.position.lerpVectors(this.introFrom, this.camPos, ease);
      this.camera.lookAt(this.tmp.lerpVectors(this.introLook, this.camTarget, ease));
    } else {
      this.followCamera(dt);
    }

    this.updateHud(dt);
  }

  private collectors() {
    return this.messers.filter((m) => m.active).map((m) => ({ id: m.id, position: m.position }));
  }

  private updateTargets() {
    for (const m of this.messers) {
      const t = this.targets[m.id];
      t.hidden = m.hidden;
      t.catchable = m.catchable;
      t.onToilet = m.toilet >= 0;
      t.noisy = m.charging || m.action === 'hurl' || m.action === 'squeeze';
    }
  }

  private heads(): Record<Speaker, THREE.Vector3> {
    return {
      eddie: this.eddie.model.headTop.getWorldPosition(new THREE.Vector3()),
      theo: this.theo.head(new THREE.Vector3()).add(new THREE.Vector3(0, 0.08, 0)),
      zach: this.zach.head(new THREE.Vector3()).add(new THREE.Vector3(0, 0.08, 0)),
    };
  }

  private animateMessers(dt: number) {
    for (const m of this.messers) {
      const level = m.isPlayer && m.charging ? this.chargeLevel(m) : 0;
      if (m.carried) this.carryPose(m);
      m.animate(dt, this.time, level);
      m.rig.talking = this.worldUi.isTalking(m.id) ? 1 : 0;
    }
  }

  // ================================================================ the player's mess-maker

  /** Movement input turned into a world-space direction relative to the camera. */
  private worldMove(target: THREE.Vector2) {
    const move = this.input.move;
    const fx = Math.sin(this.camYaw);
    const fz = Math.cos(this.camYaw);
    return target.set(fx * move.y - fz * move.x, fz * move.y + fx * move.x);
  }

  /** Desktop aims with the mouse (camera); touch aims where the character faces. */
  private aimYaw(facing: number) {
    return this.isTouch ? facing : this.camYaw;
  }

  private updateCameraInput(dt: number) {
    const look = this.input.look;
    const sens = this.isTouch ? 0.0042 : 0.0024;
    if (look.lengthSq() > 0) this.lastLook = this.time;
    this.camYaw -= look.x * sens;
    this.camPitch = clamp(this.camPitch + look.y * sens * 0.8, 0.32, 1.2);
    if (this.input.zoom !== 0) this.camDist = clamp(this.camDist + this.input.zoom * 0.6, 4.2, 12);

    // Touch: drift the camera in behind the character while they push forward.
    if (this.isTouch && this.mode === 'playing' && this.time - this.lastLook > 1.2) {
      const forward = Math.max(0, this.input.move.y);
      const facing = this.player ? this.player.facing : this.eddie.facing;
      const moving = this.player ? this.player.speed > 0.5 : this.eddie.speedNow > 0.5;
      if (forward > 0.3 && moving) this.camYaw = dampAngle(this.camYaw, facing, 0.9 * forward, dt);
    }
  }

  private updatePlayerMesser(dt: number) {
    const m = this.player;
    if (!m) return;
    m.tick(dt);
    if (!m.active || this.mode === 'caught') {
      m.vel.set(0, 0, 0);
      this.stopCharge();
      this.puke.hideAim();
      return;
    }
    const c = this.controls;
    this.worldMove(c.move);
    c.sprint = this.input.sprintHeld;
    c.face = null;
    const attacking = m.action === 'hurl' || m.action === 'throw' || m.action === 'squeeze';
    if (this.isTouch) {
      if (m.charging && c.move.lengthSq() > 0.02) c.face = Math.atan2(c.move.x, c.move.y);
    } else if (m.charging) {
      c.face = this.camYaw;
    }
    if (attacking && this.aimSeat) c.face = yawTo(m.position.x, m.position.z, this.aimSeat.top.x, this.aimSeat.top.z);
    else if (attacking && !this.isTouch) c.face = this.camYaw;
    m.move(dt, this.house.collision, c);
    this.updatePlayerAttack(m, dt);

    if (this.input.throwPressed && m.hasToy && this.mode === 'playing' && m.emergency <= 0) {
      this.throwToy(m, this.aimYaw(m.facing));
    }
  }

  private updatePlayerAttack(m: Messer, dt: number) {
    if (this.mode !== 'playing' || !m.active) {
      this.stopCharge();
      this.puke.hideAim();
      return;
    }
    const yaw = this.aimYaw(m.facing);
    this.aimSeat = m.charging || m.emergency > 0 ? null : this.findAimSeat(m, yaw);

    if (this.input.pukePressed) {
      if (m.emergency > 0) {
        if (m.heaveCooldown <= 0) {
          m.heaveCooldown = 1.4;
          this.sound.gurgle();
          this.say('zach', ZACH.cantAttack.next(), 'shout', 1.4);
        }
      } else if (m.frozen > 0) {
        // Frozen stiff.
      } else if (m.ammo < QUICK_COST - 3 && m.burrito <= 0) {
        if (m.heaveCooldown <= 0) {
          m.heaveCooldown = 0.9;
          this.sound.heave();
          m.play('hurl', 0.3);
          if (m.id === 'theo') {
            this.say('theo', THEO.heave.next(), 'calm', 1.5);
            this.queueHint('ammo', 'Tummy empty! Eat nuggets, drumsticks and mac & cheese to refill. Eddie’s fridge has a whole chicken.', true);
          } else {
            this.say('zach', ZACH.empty.next(), 'calm', 1.5);
            this.queueHint('ammo', 'Out of sauce! Eat to refill: nuggets, drumsticks, mac & cheese. Eddie’s fridge has a whole chicken.', true);
          }
        }
      } else {
        m.charging = true;
        m.chargeTime = 0;
      }
    }

    if (m.charging) {
      m.chargeTime += dt;
      if (m.chargeTime > CHARGE_DELAY && !this.chargeHandle) this.chargeHandle = this.sound.chargeStart();
      const level = this.chargeLevel(m);
      this.chargeHandle?.update(level);
      if (m.chargeTime > CHARGE_DELAY) {
        const landing = this.megaLanding(m, level, yaw);
        this.puke.showArc(m.emitter(), landing.point, landing.radius, this.time, m.style);
        this.aimPoint.copy(landing.point);
      }
      if (this.input.pukeReleased || !this.input.pukeHeld) {
        const wasMega = m.chargeTime > CHARGE_DELAY;
        this.stopCharge();
        if (wasMega) this.megaAttack(m, level, yaw);
        else this.quickAttack(m, this.findAimSeat(m, yaw), yaw);
      }
    }

    this.puke.showReticle(m.charging ? null : this.aimSeat, this.time);
  }

  private chargeLevel(m: Messer) {
    const raw = clamp((m.chargeTime - CHARGE_DELAY) / CHARGE_TIME, 0, 1);
    if (m.burrito > 0) return raw;
    const affordable = clamp((m.ammo - MEGA_BASE_COST) / MEGA_EXTRA_COST, 0, 1);
    return Math.min(raw, affordable);
  }

  private stopCharge() {
    const m = this.player;
    if (m) {
      m.charging = false;
      m.chargeTime = 0;
    }
    this.chargeHandle?.stop();
    this.chargeHandle = null;
    this.puke.hideAim();
  }

  private findAimSeat(m: Messer, yaw: number): Seat | null {
    const dx0 = Math.sin(yaw);
    const dz0 = Math.cos(yaw);
    let best: Seat | null = null;
    let bestScore = Infinity;
    for (const seat of this.seats) {
      if (seat.messed || seat.occupied || seat.couch.ruined) continue;
      const dx = seat.top.x - m.position.x;
      const dz = seat.top.z - m.position.z;
      const d = Math.hypot(dx, dz);
      if (d > 3.6) continue;
      const angle = Math.acos(clamp((dx * dx0 + dz * dz0) / Math.max(d, 0.001), -1, 1));
      if (d > 1.3 && angle > 1.25) continue;
      if (!this.house.collision.lineOfSight(m.position.x, m.position.z, seat.top.x, seat.top.z)) continue;
      const score = d + angle * 1.8;
      if (score < bestScore) {
        bestScore = score;
        best = seat;
      }
    }
    return best;
  }

  private megaLanding(m: Messer, level: number, yaw: number) {
    const dir = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    let distance = 2.4 + level * 5.6;
    const wall = this.house.collision.rayDistance(m.position.x, m.position.z, dir.x, dir.z, distance + 0.5);
    distance = Math.min(distance, wall - 0.3);
    const point = m.position.clone().addScaledVector(dir, Math.max(0.8, distance));
    const radius = (0.75 + level * 0.8) * (m.burrito > 0 ? 1.4 : 1);
    const hits = this.seats.filter(
      (s) =>
        !s.occupied &&
        dist2D(s.top.x, s.top.z, point.x, point.z) < radius + 0.2 &&
        this.house.collision.lineOfSight(point.x, point.z, s.top.x, s.top.z),
    );
    point.y = hits.length > 0 ? hits.reduce((sum, s) => sum + s.top.y, 0) / hits.length : 0.02;
    return { point, radius, hits };
  }

  private spend(m: Messer, amount: number) {
    if (m.burrito > 0) {
      m.burrito -= 1;
      return;
    }
    m.ammo = Math.max(0, m.ammo - amount);
  }

  /** Volume for sounds made by someone other than the player: quieter when far away. */
  private near(at: THREE.Vector3) {
    const focus = this.focus();
    return dist2D(at.x, at.z, focus.x, focus.z) < 9;
  }

  private quickAttack(m: Messer, target: Seat | null, yaw: number) {
    const burrito = m.burrito > 0;
    const audible = m.isPlayer || this.near(m.position);
    if (m.isPlayer) this.shake = Math.max(this.shake, 0.08);
    const emitter = () => m.emitter();
    let point: THREE.Vector3;
    if (target) {
      this.spend(m, QUICK_COST);
      point = target.top.clone();
    } else {
      this.spend(m, QUICK_COST - 3);
      const dir = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
      const d = Math.min(2.2, this.house.collision.rayDistance(m.position.x, m.position.z, dir.x, dir.z, 2.6) - 0.3);
      point = m.position.clone().addScaledVector(dir, Math.max(0.7, d));
      point.y = 0.02;
    }
    const land = () => {
      if (target) {
        this.hitSeat(target, m.style, m);
        if (burrito) {
          for (const s of this.seats) {
            if (s !== target && dist2D(s.top.x, s.top.z, target.top.x, target.top.z) < 1.1) this.hitSeat(s, m.style, m);
          }
        }
        if (m.style === 'sauce') this.puke.crumbs(target.top.clone().setY(target.top.y + 0.15), 10, target.top.y);
        this.makeNoise(target.top, 7.5, 'splat');
      } else {
        this.floorSplat(point, burrito ? 0.85 : m.style === 'sauce' ? 0.5 : 0.6, m.style, m.isPlayer);
        this.makeNoise(point, 6, 'splat');
      }
    };
    if (m.id === 'theo') {
      m.play('hurl', 0.5);
      if (audible) this.sound.puke(burrito ? 0.8 : 0.35);
      this.puke.fire(emitter, point, target ? (burrito ? 0.7 : 0.25) : 0.35, burrito ? 0.8 : 0.35, land);
    } else {
      m.play('throw', 0.45);
      if (audible) {
        this.sound.whoosh();
        this.sound.squirt(burrito ? 0.7 : 0.3);
      }
      const hand = m.rig.handR.getWorldPosition(new THREE.Vector3());
      this.puke.fling(hand, point, land);
      this.puke.fire(emitter, point, target ? 0.2 : 0.3, burrito ? 0.6 : 0.2, () => undefined, 'sauce');
      if (Math.random() < 0.3 && m.isPlayer) this.say('zach', ZACH.fling.next(), 'shout', 1.2);
    }
    this.makeNoise(m.position, 5, 'puke');
  }

  private megaAttack(m: Messer, level: number, yaw: number) {
    const { point, radius, hits } = this.megaLanding(m, level, yaw);
    this.spend(m, MEGA_BASE_COST + MEGA_EXTRA_COST * level);
    const audible = m.isPlayer || this.near(m.position);
    if (m.isPlayer) {
      this.stats.megas += 1;
      this.shake = Math.max(this.shake, 0.15 + level * 0.2);
      this.fovKick = 6 + level * 6;
      this.flash = 0.06;
    }
    m.play(m.id === 'theo' ? 'hurl' : 'squeeze', 0.7 + level * 0.3);
    if (audible) {
      if (m.id === 'theo') this.sound.puke(0.6 + level * 0.5);
      else this.sound.squirt(0.6 + level * 0.4);
    }
    this.puke.fire(
      () => m.emitter(),
      point,
      radius,
      0.6 + level,
      () => {
        const fresh = hits.filter((s) => !s.messed);
        for (const s of hits) this.hitSeat(s, m.style, m);
        if (fresh.length >= 2 && this.role !== 'eddie') {
          const bonus = 200 * (fresh.length - 1);
          this.addScore(bonus, false);
          this.worldUi.pop(point.clone().setY(point.y + 0.9), `MULTI-${m.id === 'zach' ? 'SAUCE' : 'HURL'} x${fresh.length}! +${bonus}`, 'gold');
        }
        if (hits.length === 0) this.floorSplat(point, 0.6 + level * 0.55, m.style, m.isPlayer);
        this.puke.splash(point, 18 + Math.round(level * 20), 1 + level * 0.5, m.style);
        if (m.style === 'sauce') this.puke.crumbs(point.clone().setY(point.y + 0.3), 24, point.y);
        if (this.near(point)) this.sound.splat(true);
        this.makeNoise(point, 9 + level * 3, 'splat');
        if (m.isPlayer) this.shake = Math.max(this.shake, 0.12);
      },
      m.style,
    );
    if (m.id === 'zach') {
      const hand = m.rig.handR.getWorldPosition(new THREE.Vector3());
      for (let i = 0; i < 3; i += 1) {
        const a = rand(0, Math.PI * 2);
        const r = rand(0, radius * 0.8);
        this.puke.fling(hand, point.clone().add(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r)), () => undefined);
      }
    }
    this.makeNoise(m.position, 6, 'puke');
  }

  private throwToy(m: Messer, yaw: number) {
    const dir = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    const dist = Math.min(7, this.house.collision.rayDistance(m.position.x, m.position.z, dir.x, dir.z, 7) - 0.4);
    const to = m.position.clone().addScaledVector(dir, Math.max(1, dist));
    to.y = 0.07;
    this.pickups.throwToy(m.position.clone().setY(m.rig.hipHeight + 0.3), to);
    m.hasToy = false;
    m.play('throw', 0.4);
    if (m.isPlayer || this.near(m.position)) this.sound.whoosh();
  }

  private floorSplat(point: THREE.Vector3, radius: number, style: MessStyle, byPlayer: boolean) {
    this.puke.addPuddle(point, radius, style);
    this.puke.splash(point, 10, 1, style);
    if (this.near(point)) this.sound.splat(false);
    this.worldUi.pop(point.clone().setY(0.6), pick(POP.floor), 'small');
    if (byPlayer) this.queueHint('puddle', 'Missed! But puddles are traps: Eddie slips on them.');
  }

  private hitSeat(seat: Seat, style: MessStyle, by: Messer) {
    if (seat.couch.ruined || seat.occupied) return;
    if (seat.plastic && seat.plastic.visible) {
      seat.plastic.visible = false;
      this.puke.splash(seat.top, 14, 1.2, style);
      const slide = seat.front.clone();
      slide.y = 0.02;
      this.puke.addPuddle(slide.lerp(seat.top.clone().setY(0.02), 0.45), 0.55, style);
      this.sound.slip();
      if (this.role !== 'eddie') this.addScore(50, false);
      this.worldUi.pop(seat.top.clone().setY(seat.top.y + 0.8), pick(POP.plastic), 'blue');
      return;
    }
    if (seat.messed) {
      this.puke.splash(seat.top, 6, 1, style);
      return;
    }
    seat.messed = true;
    seat.mess = style;
    this.puke.splatSeat(seat, style);
    seat.material.color.copy(seat.baseColor).lerp(new THREE.Color(style === 'sauce' ? 0x8e2b14 : 0xa6c93a), style === 'sauce' ? 0.35 : 0.5);
    this.puke.splash(seat.top, 12, 1, style);
    if (this.near(seat.top)) this.sound.splat(false);

    if (this.role === 'eddie') {
      this.worldUi.pop(seat.top.clone().setY(seat.top.y + 0.7), style === 'sauce' ? 'SAUCED!' : 'PUKED!', 'red');
      this.queueHint('scrub', this.isTouch ? 'A stain! Walk up to it and hold GRAB to scrub it clean.' : 'A stain! Walk up to it and hold Click/Space to scrub it clean.');
    } else {
      this.stats.seats += 1;
      this.combo += 1;
      this.comboTimer = 5;
      this.maxCombo = Math.max(this.maxCombo, this.combo);
      const gained = this.addScore(100, true);
      const word = style === 'sauce' ? pick(POP.sauce) : pick(POP.seat);
      this.worldUi.pop(seat.top.clone().setY(seat.top.y + 0.7), by.isPlayer ? `${word} +${gained}` : `${by.name.toUpperCase()}: ${word} +${gained}`, by.isPlayer ? '' : 'small');
    }

    if (seat.couch.seats.every((s) => s.messed)) {
      if (this.role === 'eddie') this.startSetting(seat.couch);
      else this.ruinCouch(seat.couch);
    }
  }

  /** Eddie mode: the couch is fully stained and starts soaking through. */
  private startSetting(couch: CouchState) {
    if (couch.setting > 0 || couch.ruined) return;
    couch.setting = SET_TIME;
    this.sound.alert();
    this.hud.showBanner(`${couch.def.name} is soaking through!`, `Scrub any seat within ${SET_TIME}s to save it!`, 'danger', 2.4);
    this.worldUi.pop(couch.center.clone().setY(1.8), 'SOAKING IN!', 'red');
  }

  private updateSetting(dt: number) {
    if (this.role !== 'eddie') return;
    for (const couch of this.couches) {
      if (couch.setting <= 0 || couch.ruined) continue;
      if (!couch.seats.every((s) => s.messed)) {
        couch.setting = 0;
        this.worldUi.pop(couch.center.clone().setY(1.8), 'SAVED!', 'blue');
        this.score += 200;
        continue;
      }
      const before = couch.setting;
      couch.setting -= dt;
      if (Math.ceil(couch.setting) !== Math.ceil(before) && couch.setting > 0) this.worldUi.pop(couch.center.clone().setY(1.6), String(Math.ceil(couch.setting)), 'red');
      if (couch.setting <= 0) {
        couch.setting = 0;
        this.ruinCouch(couch);
        if (this.mode !== 'playing') return;
      }
    }
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
    this.scrubProgress.clear();
    this.effects.addStink(couch.center);
    this.puke.splash(couch.center.clone().setY(0.8), 20, 1.2, couch.seats[0].mess ?? 'puke');
    const ruined = this.couches.filter((c) => c.ruined).length;
    this.flash = 0.1;

    if (this.role === 'eddie') {
      this.sound.caught();
      this.shake = Math.max(this.shake, 0.2);
      const left = RUIN_LIMIT - ruined;
      this.hud.showBanner(`${couch.def.name} — RUINED!`, left === 1 ? 'One more and bedtime is canceled!' : `${ruined} of ${RUIN_LIMIT}. Stay sharp.`, 'danger', 2.8);
      this.say('eddie', couch.def.mourn, 'sad', 2.6);
      if (ruined >= RUIN_LIMIT) {
        this.lose();
        return;
      }
    } else {
      const bonus = 500 + couch.def.bonus;
      this.score += bonus;
      this.sound.ruined();
      this.effects.confettiBurst(couch.center);
      this.hud.showBanner(`${couch.def.name} — RUINED!`, `${couch.def.flavor}  +${bonus}`, 'puke', 2.8);
      this.worldUi.pop(couch.center.clone().setY(1.6), `+${bonus}`, 'gold');
      if (ruined >= this.couches.length) {
        this.win();
        return;
      }
    }

    const newRage = Math.min(4, Math.floor((ruined + 1) / 2));
    if (newRage > this.rage) {
      this.rage = newRage;
      this.syncHostRage();
    }
    if (this.role !== 'eddie') {
      if (this.eddie.state !== 'grab') this.eddie.mourn(couch);
      if (this.rage >= 4 && !this.beastAnnounced) {
        this.beastAnnounced = true;
        this.later(3.2, () => {
          if (this.mode !== 'playing') return;
          this.hud.showBanner('EDDIE HAS ENTERED BEAST MODE', 'He is faster. He is louder. He is sweating.', 'danger', 2.8);
          this.say('eddie', EDDIE.beast, 'shout', 2.6);
        });
      }
      this.queueHint('ruined', 'Ruined couches stay ruined. Eddie gets angrier (and faster) with every one.');
    }
  }

  private cleanSeat(seat: Seat) {
    if (seat.couch.ruined) return;
    seat.messed = false;
    seat.mess = null;
    this.puke.clearSeat(seat);
    seat.material.color.copy(seat.baseColor);
    this.effects.sparkle(seat.top, 14);
    this.stats.cleaned += 1;
    if (this.role === 'eddie') {
      this.score += 150;
      this.sound.pickup();
      this.worldUi.pop(seat.top.clone().setY(seat.top.y + 0.7), 'CLEAN! +150', 'blue');
    } else {
      this.worldUi.pop(seat.top.clone().setY(seat.top.y + 0.7), 'CLEANED!', 'blue');
    }
  }

  private makeNoise(at: THREE.Vector3, radius: number, kind: 'puke' | 'splat' | 'squeak') {
    this.eddie.hear(at, radius, kind);
  }

  private onEddieSlip(puddle: Puddle) {
    this.stats.slips += 1;
    this.puke.smear(puddle, this.eddie.facing);
    this.puke.splash(puddle.position, 16, 1.2, puddle.style);
    this.sound.slip();
    this.shake = Math.max(this.shake, 0.25);
    this.scrubProgress.delete(puddle);
    if (this.role === 'eddie') {
      this.worldUi.pop(this.eddie.position.clone().setY(2.2), 'OOF!', 'red');
      this.queueHint('slip', 'Puddles are slippery! Hold GRAB next to one to mop it up.');
    } else {
      this.addScore(300, false);
      this.worldUi.pop(this.eddie.position.clone().setY(2.2), 'SLAPSTICK! +300', 'gold');
    }
  }

  // ================================================================ computer-controlled mess-makers

  private aiView(m: Messer): AiView {
    const other = m.id === 'theo' ? 'zach' : 'theo';
    const e = this.eddie;
    return {
      collision: this.house.collision,
      seats: this.seats,
      pickups: this.pickups,
      toilets: this.house.toilets,
      eddie: {
        position: e.position,
        awake: e.state !== 'sleep' && e.state !== 'wake',
        chasing: e.chasing,
        target: e.target?.id ?? null,
        driven: e.driven,
      },
      partnerSeat: this.brains[other].seat,
      // A sidekick helps; it shouldn't win the game for you. Against a human Eddie they push harder.
      fireRate: this.role === 'eddie' ? [9, 12] : [8, 12],
      megaChance: this.role === 'eddie' ? 0.2 : 0,
    };
  }

  private updateAiMessers(dt: number) {
    for (const m of this.messers) {
      if (m.isPlayer) continue;
      m.tick(dt);
      if (!m.active) {
        m.vel.set(0, 0, 0);
        continue;
      }
      const intent = this.brains[m.id].update(dt, m, this.aiView(m));
      m.move(dt, this.house.collision, intent.controls);
      if (this.mode !== 'playing' || m.emergency > 0 || m.frozen > 0) continue;
      const fire = intent.fire;
      if (fire?.kind === 'quick') this.quickAttack(m, fire.seat, yawTo(m.position.x, m.position.z, fire.seat.top.x, fire.seat.top.z));
      else if (fire?.kind === 'mega') this.megaAttack(m, fire.level, fire.yaw);
      if (intent.throwToy && m.hasToy) {
        const away = yawTo(this.eddie.position.x, this.eddie.position.z, m.position.x, m.position.z);
        this.throwToy(m, away + (Math.random() < 0.5 ? 1.4 : -1.4));
      }
    }
  }

  // ================================================================ Zach's gut

  private updateGut(m: Messer, dt: number) {
    if (m.id !== 'zach' || !m.active || this.mode !== 'playing') return;
    const toilets = this.house.toilets;
    if (m.emergency > 0) {
      m.emergency -= dt;
      if (Math.random() < dt * 5) {
        const back = new THREE.Vector3(-Math.sin(m.facing) * 0.25, m.rig.hipHeight * 0.95, -Math.cos(m.facing) * 0.25);
        this.effects.gas(m.position.clone().add(back));
      }
      this.gurgle[m.id] -= dt;
      if (this.gurgle[m.id] <= 0) {
        this.gurgle[m.id] = 2.2;
        if (m.isPlayer || this.near(m.position)) this.sound.gurgle();
      }
      const i = toilets.findIndex((t) => dist2D(t.front.x, t.front.z, m.position.x, m.position.z) < 0.8);
      if (i >= 0) this.sitOnToilet(m, i);
      else if (m.emergency <= 0) this.accident(m);
      return;
    }
    // Feeling it? A quick sit is always an option.
    if (m.bloat >= 35 && m.speed < 0.8) {
      const i = toilets.findIndex((t) => dist2D(t.front.x, t.front.z, m.position.x, m.position.z) < 0.7);
      if (i >= 0) {
        this.sitOnToilet(m, i);
        return;
      }
    }
    if (m.bloat > 55) {
      this.gurgle[m.id] -= dt;
      if (this.gurgle[m.id] <= 0) {
        this.gurgle[m.id] = rand(3.5, 5.5);
        if (m.isPlayer || this.near(m.position)) {
          this.sound.gurgle();
          if (Math.random() < 0.5) this.say('zach', ZACH.gurgle.next(), 'calm', 1.6);
        }
        if (m.isPlayer) this.queueHint('gutWarn', 'Zach’s gut is rumbling. Too much food and it WILL go critical. Bathrooms are the blue dots.', true);
      }
      const p = 0.03 + ((m.bloat - 55) / 45) * 0.22;
      if (Math.random() < p * dt) this.startEmergency(m);
    }
  }

  private nearestToilet(at: THREE.Vector3) {
    let best = this.house.toilets[0];
    let bestD = Infinity;
    for (const t of this.house.toilets) {
      const d = dist2D(t.front.x, t.front.z, at.x, at.z);
      if (d < bestD) {
        bestD = d;
        best = t;
      }
    }
    return best;
  }

  private startEmergency(m: Messer) {
    m.emergency = EMERGENCY_TIME;
    m.charging = false;
    if (m.isPlayer) this.stopCharge();
    this.gurgle[m.id] = 0.3;
    this.say('zach', ZACH.emergency.next(), 'shout', 1.8);
    const toilet = this.nearestToilet(m.position);
    const room = roomAt(toilet.seat.x, toilet.seat.z)?.name ?? 'the bathroom';
    if (m.isPlayer) {
      this.sound.gurgle();
      this.shake = Math.max(this.shake, 0.2);
      this.hud.showBanner('GUT EMERGENCY!', `Get to a bidet in ${EMERGENCY_TIME}s! Nearest: ${room}.`, 'brown', 3);
      this.queueHint('emergency', 'Follow the blue arrow to the nearest toilet. Every toilet has a bidet. You can’t attack while clenching.', true);
    } else if (this.role === 'eddie') {
      this.queueHint('zachRuns', 'Zach is sprint-waddling to the bathroom. Honestly? Let him go.');
    } else {
      this.queueHint('allyGut', 'Zach has a gut emergency. He’s on his own for a minute.');
    }
  }

  private sitOnToilet(m: Messer, i: number) {
    const t = this.house.toilets[i];
    m.toilet = i;
    m.toiletTime = 0;
    m.emergency = 0;
    m.charging = false;
    m.vel.set(0, 0, 0);
    m.position.set(t.seat.x, 0, t.seat.z);
    m.facing = t.facing;
    if (m.isPlayer) {
      this.stopCharge();
      this.puke.hideAim();
    }
  }

  private updateToilet(m: Messer, dt: number) {
    if (m.toilet < 0 || this.mode === 'caught') return;
    const t = this.house.toilets[m.toilet];
    const prev = m.toiletTime;
    m.toiletTime += dt;
    const k = m.toiletTime;
    const crossed = (x: number) => prev < x && k >= x;
    m.position.set(t.seat.x, 0, t.seat.z);
    m.facing = t.facing;
    const audible = m.isPlayer || this.near(m.position);
    const head = m.head(new THREE.Vector3()).add(new THREE.Vector3(0, 0.3, 0));
    if (crossed(0.35)) {
      this.stats.braps += 1;
      if (audible) this.sound.brap();
      this.worldUi.pop(head, pick(POP.brap), 'brown');
      for (let i = 0; i < 6; i += 1) this.effects.gas(m.position.clone().setY(0.5 + i * 0.05));
      if (m.isPlayer) this.shake = Math.max(this.shake, 0.18);
    }
    if (crossed(1.6)) {
      this.worldUi.pop(head, pick(POP.brap), 'brown');
      if (audible) this.sound.brap();
    }
    if (crossed(2.6)) {
      if (audible) this.sound.bidet();
      this.worldUi.pop(head, 'BIDET!', 'blue');
      this.say('zach', ZACH.toilet.next(), 'calm', 1.8);
    }
    if (k > 2.6 && k < 3.9 && Math.floor(k * 12) !== Math.floor(prev * 12)) this.puke.bidet(t.nozzle);
    if (crossed(4.0)) {
      if (audible) this.sound.flush();
      m.toilet = -1;
      m.bloat = 0;
      m.position.copy(t.front);
      m.facing = t.facing;
      m.invuln = 1.2;
      this.effects.sparkle(m.position.clone().setY(1), 12);
      this.say('zach', ZACH.clean.next(), 'calm', 1.6);
      if (this.role !== 'eddie') {
        const bonus = 250;
        this.score += bonus;
        this.worldUi.pop(head, `SQUEAKY CLEAN! +${bonus}`, 'blue');
      } else {
        this.worldUi.pop(head, 'SQUEAKY CLEAN!', 'blue');
      }
    }
  }

  private accident(m: Messer) {
    this.stats.accidents += 1;
    m.emergency = 0;
    const head = m.head(new THREE.Vector3()).add(new THREE.Vector3(0, 0.3, 0));
    this.worldUi.pop(head, 'CODE BROWN!', 'brown');
    if (m.isPlayer || this.near(m.position)) this.sound.brap();
    if (m.isPlayer) {
      this.mode = 'caught';
      this.modeTime = 0;
      this.caught = { m, stage: 0, kind: 'accident' };
      this.stopCharge();
      this.input.enabled = false;
      this.input.releaseAll();
      m.emergency = 0.01;
      this.lives -= 1;
      this.combo = 0;
      this.shake = 0.3;
      this.sound.setMusic('off');
      this.hud.showBanner('CODE BROWN', this.lives > 0 ? `Zach didn’t make it to the bidet. ${this.hearts()} left.` : 'Zach didn’t make it.', 'brown', 2.6);
      this.later(0.9, () => this.say('eddie', '...Zach? ZACH?! IN THE HALLWAY?!', 'shout', 2.2));
    } else {
      this.say('zach', '...I need new pants.', 'sad', 2);
      this.sendToTimeout(m, TIMEOUT + 4);
      this.queueHint('accident', this.role === 'eddie' ? 'Zach didn’t make it to the bathroom. He’s out for a bit.' : 'Zach didn’t make it to the bathroom. He’s changing pants in the time-out corner.');
    }
  }

  private hearts() {
    return `${this.lives} heart${this.lives === 1 ? '' : 's'}`;
  }

  // ================================================================ time-out

  private sendToTimeout(m: Messer, seconds = TIMEOUT) {
    const seat = timeoutSeat(m.id);
    m.position.copy(seat);
    m.facing = 0;
    m.vel.set(0, 0, 0);
    m.timeout = seconds;
    m.emergency = 0;
    m.bloat = Math.min(m.bloat, 30);
    m.toilet = -1;
    m.swoleUsed = false;
    m.charging = false;
    m.carried = false;
    m.ammo = Math.max(m.ammo, 50);
    this.brains[m.id].reset();
    this.later(0.6, () => this.say(m.id, m.id === 'theo' ? THEO.timeout.next() : ZACH.timeout.next(), 'sad', 2));
  }

  private updateTimeout(m: Messer, dt: number) {
    if (m.timeout <= 0) return;
    m.timeout -= dt;
    const seat = timeoutSeat(m.id);
    m.position.set(seat.x, 0, seat.z);
    m.facing = 0;
    if (m.timeout <= 0) {
      const spawn = SPAWNS[m.id];
      m.position.set(spawn.x, 0, spawn.z);
      m.facing = Math.PI;
      m.invuln = 1.5;
    }
  }

  // ================================================================ playing as Eddie

  private updateEddiePlayer(dt: number) {
    const d = this.drive;
    const playing = this.mode === 'playing';
    this.worldMove(d.move);
    d.sprint = this.input.sprintHeld;
    d.aimYaw = this.isTouch ? (d.move.lengthSq() > 0.02 ? Math.atan2(d.move.x, d.move.y) : this.eddie.facing) : this.camYaw;
    d.lunge = false;
    d.yell = false;
    d.scrub = null;
    this.scrubSpot = this.findScrubSpot();
    if (playing) {
      if (this.input.pukeHeld && this.scrubSpot) d.scrub = this.scrubSpot.at;
      else if (this.input.pukePressed) d.lunge = true;
      d.yell = this.input.throwPressed;
    }
    this.eddie.drive(dt, d);

    if (this.eddie.state === 'yell' && this.eddie.stateTime === 0) this.doYell();
    if (this.eddie.state === 'windup' && this.eddie.stateTime === 0) this.sound.whoosh();

    const spot = this.scrubSpot;
    if (this.eddie.state === 'clean' && d.scrub && spot) {
      const key: object = spot.seat ?? spot.puddle ?? spot;
      const p = (this.scrubProgress.get(key) ?? 0) + dt / (spot.seat ? 1.5 : 0.7);
      if (p >= 1) {
        this.scrubProgress.delete(key);
        if (spot.seat) {
          this.cleanSeat(spot.seat);
          this.say('eddie', EDDIE.cleaned.next(), 'calm', 1.6);
        } else if (spot.puddle) {
          this.puke.mop(spot.puddle);
          this.score += 50;
          this.effects.sparkle(spot.puddle.position.clone().setY(0.2), 8);
          this.worldUi.pop(spot.puddle.position.clone().setY(0.8), 'MOPPED +50', 'blue');
        }
      } else {
        this.scrubProgress.set(key, p);
      }
    }
    this.puke.showReticle(this.scrubSpot?.seat ?? this.nearestStain(6), this.time);
  }

  private findScrubSpot() {
    const e = this.eddie.position;
    let seat: Seat | null = null;
    let best = Infinity;
    for (const s of this.seats) {
      if (!s.messed || s.couch.ruined) continue;
      const d = Math.min(dist2D(s.front.x, s.front.z, e.x, e.z), dist2D(s.top.x, s.top.z, e.x, e.z) - 0.1);
      if (d < 1.35 && d < best) {
        best = d;
        seat = s;
      }
    }
    if (seat) return { seat, puddle: null, at: seat.top };
    for (const p of this.puke.puddles) {
      if (!p.active) continue;
      const d = dist2D(p.position.x, p.position.z, e.x, e.z);
      if (d < p.radius + 0.8) return { seat: null, puddle: p, at: p.position };
    }
    return null;
  }

  private nearestStain(range: number) {
    let best: Seat | null = null;
    let bestD = range;
    for (const s of this.seats) {
      if (!s.messed || s.couch.ruined) continue;
      const d = dist2D(s.top.x, s.top.z, this.eddie.position.x, this.eddie.position.z);
      if (d < bestD) {
        bestD = d;
        best = s;
      }
    }
    return best;
  }

  private doYell() {
    this.stats.yells += 1;
    this.say('eddie', EDDIE.yell.next(), 'shout', 1.6);
    this.sound.alert();
    this.shake = Math.max(this.shake, 0.25);
    this.flash = 0.08;
    let frozen = 0;
    for (const m of this.messers) {
      if (!m.active) continue;
      const d = dist2D(m.position.x, m.position.z, this.eddie.position.x, this.eddie.position.z);
      if (d > 5.5 || !this.house.collision.lineOfSight(m.position.x, m.position.z, this.eddie.position.x, this.eddie.position.z)) continue;
      m.frozen = 1.8;
      m.charging = false;
      frozen += 1;
      this.worldUi.pop(m.head(new THREE.Vector3()).add(new THREE.Vector3(0, 0.35, 0)), 'FROZEN!', 'blue');
    }
    if (frozen > 0) {
      this.score += 50 * frozen;
      this.queueHint('yell', 'Frozen! Grab them before they thaw. YELL needs a few seconds to recharge.');
    }
  }

  // ================================================================ catching

  private checkCatches() {
    if (this.mode !== 'playing' || this.aiCarry || !this.eddie.canCatch) return;
    const reach = this.eddie.state === 'lunge' ? 1.05 : this.eddie.driven ? 0.9 : 0.8;
    for (const m of this.messers) {
      if (!m.catchable) continue;
      const d = dist2D(m.position.x, m.position.z, this.eddie.position.x, this.eddie.position.z);
      if (d >= reach) continue;
      if (m.id === 'zach' && !m.swoleUsed) this.breakFree(m);
      else if (m.isPlayer) this.startCaught(m);
      else this.catchAi(m);
      return;
    }
  }

  private breakFree(m: Messer) {
    this.stats.swole += 1;
    m.swoleUsed = true;
    m.play('flex', 1.3);
    m.invuln = 2.2;
    m.charging = false;
    m.vel.set(0, 0, 0);
    if (m.isPlayer) this.stopCharge();
    this.eddie.stun();
    const push = new THREE.Vector3(this.eddie.position.x - m.position.x, 0, this.eddie.position.z - m.position.z);
    if (push.lengthSq() < 0.0001) push.set(0, 0, 1);
    push.normalize().multiplyScalar(0.7);
    this.house.collision.move(this.eddie.position, push.x, push.z, this.eddie.radius, 2);
    this.sound.flex();
    this.sound.thud(0.25);
    this.say('zach', ZACH.swole.next(), 'shout', 1.8);
    this.later(1.0, () => this.say('eddie', EDDIE.swole.next(), 'sad', 2));
    this.worldUi.pop(m.head(new THREE.Vector3()).add(new THREE.Vector3(0, 0.4, 0)), 'TOO SWOLE!', 'gold');
    this.shake = Math.max(this.shake, 0.3);
    this.flash = 0.1;
    if (this.role === 'eddie') {
      this.hud.showBanner('TOO SWOLE!', 'Zach flexed out of your grip. Grab him again!', 'info', 2.2);
    } else if (m.isPlayer) {
      this.score += 250;
      this.hud.showBanner('TOO SWOLE!', 'You broke free! The next grab sticks, though.', 'gold', 2.2);
    } else {
      this.queueHint('swole', 'Zach flexed out of Eddie’s grip! He can do that once per life.');
    }
  }

  private carryPose(m: Messer) {
    const l = this.eddie.model.handL.getWorldPosition(this.tmp);
    const r = this.eddie.model.handR.getWorldPosition(this.tmp2);
    const mid = l.add(r).multiplyScalar(0.5);
    const spec = m.rig.spec;
    m.rig.root.position.set(mid.x, Math.max(0, mid.y - (m.rig.hipHeight + 0.06 + spec.torsoLen * 0.7)), mid.z);
    m.rig.root.rotation.y = this.eddie.facing + Math.PI;
  }

  private catchAi(m: Messer) {
    this.eddie.startGrab(m.position, m.id);
    m.carried = true;
    m.charging = false;
    m.emergency = 0;
    this.brains[m.id].reset();
    this.aiCarry = { m, t: 0 };
    this.sound.thud();
    this.say('eddie', m.id === 'zach' ? EDDIE.catchZach.next() : EDDIE.catch.next(), 'shout', 1.8);
    this.say(m.id, m.id === 'zach' ? ZACH.caught.next() : THEO.caught.next(), 'shout', 1.4);
    if (this.role === 'eddie') {
      this.stats.catches += 1;
      this.score += 500;
      this.flash = 0.12;
      this.shake = Math.max(this.shake, 0.25);
      this.worldUi.pop(m.head(new THREE.Vector3()).add(new THREE.Vector3(0, 0.6, 0)), 'TIME-OUT! +500', 'gold');
    } else {
      this.queueHint(`allyCaught-${m.id}`, `${m.name} got caught! ${TIMEOUT} seconds in the time-out corner.`, true);
    }
  }

  private updateAiCarry(dt: number) {
    const c = this.aiCarry;
    if (!c) return;
    c.t += dt;
    this.carryPose(c.m);
    if (c.t > 1.3) {
      c.m.carried = false;
      this.sendToTimeout(c.m);
      this.eddie.finishGrab();
      this.aiCarry = null;
    }
  }

  private startCaught(m: Messer) {
    this.mode = 'caught';
    this.modeTime = 0;
    this.caught = { m, stage: 0, kind: 'grab' };
    this.stopCharge();
    this.input.enabled = false;
    this.input.releaseAll();
    this.eddie.startGrab(m.position, m.id);
    this.say('eddie', m.id === 'zach' ? EDDIE.catchZach.next() : EDDIE.catch.next(), 'shout', 2);
    m.carried = true;
    m.emergency = 0;
    this.lives -= 1;
    this.stats.caught += 1;
    this.combo = 0;
    this.shake = 0.35;
    this.flash = 0.25;
    this.sound.thud();
    this.sound.setMusic('off');
    this.hud.showBanner('CAUGHT!', this.lives > 0 ? `${this.hearts()} left` : 'Uh oh.', 'danger', 2.2);
  }

  private updateCaught(dt: number) {
    const c = this.caught;
    if (!c) return;
    const m = c.m;
    const t = this.modeTime;
    this.updateTimers(dt);
    this.house.update(dt, this.time);
    this.eddie.update(dt);
    this.updateTargets();
    this.updateAiMessers(dt);
    this.puke.update(dt);
    this.effects.update(dt);
    this.updateCouchFx(dt);
    this.updatePortraits();
    this.updateEddieFx(dt);
    this.animateMessers(dt);

    if (c.kind === 'grab') {
      if (c.stage === 0 && t > 1.1) {
        c.stage = 1;
        const head = this.eddie.model.headTop.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, -0.22, 0));
        this.puke.faceBlast(m.emitter(), head, m.style);
        if (m.id === 'theo') {
          this.sound.puke(0.9);
          m.play('hurl', 0.6);
        } else {
          this.sound.squirt(0.9);
          m.play('squeeze', 0.6);
        }
        this.shake = 0.3;
      }
      if (c.stage === 1 && t > 1.5) {
        c.stage = 2;
        this.eddie.startPukedOn(m.id === 'zach');
        $('fade').classList.add('is-on');
      }
      if (c.stage === 2 && t > 2.0) {
        c.stage = 3;
        m.carried = false;
        if (this.lives <= 0) {
          $('fade').classList.remove('is-on');
          this.lose();
          return;
        }
        this.respawnPlayer(m);
        $('fade').classList.remove('is-on');
      }
      if (c.stage === 3 && t > 2.4) this.resumeAfterCaught();
    } else {
      // Code brown: shiver, fade, respawn.
      if (Math.random() < dt * 8) this.effects.gas(m.position.clone().setY(m.rig.hipHeight));
      if (c.stage === 0 && t > 1.3) {
        c.stage = 1;
        $('fade').classList.add('is-on');
      }
      if (c.stage === 1 && t > 1.9) {
        c.stage = 2;
        m.emergency = 0;
        m.bloat = 0;
        if (this.lives <= 0) {
          $('fade').classList.remove('is-on');
          this.lose();
          return;
        }
        this.respawnPlayer(m);
        $('fade').classList.remove('is-on');
      }
      if (c.stage === 2 && t > 2.3) this.resumeAfterCaught();
    }

    // Cinematic camera.
    const holding = c.kind === 'grab' ? c.stage < 3 : c.stage < 2;
    const focus = c.kind === 'grab' && holding ? this.eddie.position : m.position;
    const focusY = c.kind === 'grab' && holding ? 1.5 : holding ? 1.0 : 0.75;
    this.camTarget.lerp(this.tmp.copy(focus).setY(focusY), 1 - Math.exp(-6 * dt));
    const faceYaw = c.kind === 'grab' ? this.eddie.facing : m.facing;
    const yaw = holding ? faceYaw + Math.PI + (c.kind === 'grab' ? 1.15 : 0.5) + Math.sin(t * 0.6) * 0.1 : this.camYaw;
    const dist = holding ? (c.kind === 'grab' ? 4.4 : 3.4) : this.camDist;
    const pitch = holding ? 0.28 : this.camPitch;
    const desired = this.tmp2
      .copy(this.camTarget)
      .add(new THREE.Vector3(-Math.sin(yaw) * Math.cos(pitch) * dist, Math.sin(pitch) * dist, -Math.cos(yaw) * Math.cos(pitch) * dist));
    this.camera.position.lerp(desired, 1 - Math.exp(-5 * dt));
    this.camera.lookAt(this.camTarget);
    this.updateOccluders(dt, true);
    this.worldUi.update(dt, this.heads(), 1, false, false, null);
    this.eddie.model.talking = this.worldUi.isTalking('eddie') ? 1 : 0;
    this.updateHud(dt);
  }

  private respawnPlayer(m: Messer) {
    const spawn = SPAWNS[m.id];
    m.position.set(spawn.x, 0, spawn.z);
    m.vel.set(0, 0, 0);
    m.facing = Math.PI;
    m.invuln = 3;
    m.swoleUsed = false;
    m.emergency = 0;
    m.action = null;
    this.camYaw = Math.PI;
  }

  private resumeAfterCaught() {
    this.caught = null;
    this.camPos.copy(this.camera.position);
    this.mode = 'playing';
    this.input.enabled = true;
    this.sound.setMusic('calm');
    this.chaseMusic = false;
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
    let timeBonus = 0;
    let lifeBonus = 0;
    if (this.role === 'eddie') {
      const standing = this.couches.filter((c) => !c.ruined).length;
      lifeBonus = standing * 300;
      this.score += lifeBonus;
      this.hud.showBanner('BEDTIME!', 'The mess squad has been sent home. The couches are safe.', 'gold', 3);
      this.effects.confettiBurst(this.eddie.position, 140);
      this.say('eddie', 'GOODNIGHT, EVERYBODY. SHOES BY THE DOOR.', 'shout', 3.5);
    } else {
      timeBonus = Math.max(0, Math.round(4000 - this.elapsed * 12));
      lifeBonus = this.lives * 1000;
      this.score += timeBonus + lifeBonus;
      this.hud.showBanner('ALL COUCHES RUINED!', 'Eddie is going to need a minute. Or a year.', 'gold', 3);
      if (this.player) this.effects.confettiBurst(this.player.position, 140);
      this.eddie.state = 'mourn';
      this.eddie.stateTime = 1.6;
      this.say('eddie', 'WHY. WHY WOULD YOU DO THIS. I LOVED THEM ALL.', 'sad', 4);
    }
    window.setTimeout(() => this.showEnd(true, timeBonus, lifeBonus), 2600);
  }

  private lose() {
    this.mode = 'lost';
    this.modeTime = 0;
    this.stopCharge();
    this.input.enabled = false;
    this.input.exitPointerLock();
    this.sound.setMusic('off');
    this.sound.caught();
    if (this.role === 'eddie') {
      this.hud.showBanner('THE HOUSE IS LOST.', `${RUIN_LIMIT} couches ruined. Eddie is lying face-down on the rug.`, 'danger', 3);
      this.eddie.state = 'mourn';
      this.eddie.stateTime = 1.6;
    } else {
      this.hud.showBanner('TIME-OUT.', `${ROLES[this.role].name} has been sent to the time-out corner for good.`, 'danger', 3);
    }
    window.setTimeout(() => this.showEnd(false, 0, 0), 2400);
  }

  private showEnd(won: boolean, timeBonus: number, lifeBonus: number) {
    if (this.mode !== 'won' && this.mode !== 'lost') return;
    const role = this.role;
    const isBest = this.score > this.best[role];
    if (isBest) {
      this.best[role] = this.score;
      safeStorageSet(`eddie.best.${role}`, String(this.score));
    }
    const rank = rankFor(this.score, role === 'eddie' ? EDDIE_RANKS : undefined);
    const ruined = this.couches.filter((c) => c.ruined).length;
    $('end-kicker').textContent = isBest ? 'New best score!' : won ? 'Victory' : 'Game over';
    let title: string;
    let blurb: string;
    if (role === 'eddie') {
      title = won ? 'House saved!' : 'Couchapocalypse.';
      blurb = won
        ? `Bedtime. ${this.couches.length - ruined} of 9 couches survived, ${this.stats.catches} time-outs handed out. Biscuit would be proud.`
        : `Theo and Zach ruined ${ruined} couches. The upholstery guy is on his way. He is bringing a boat brochure.`;
    } else if (won) {
      title = 'Couchapocalypse!';
      blurb =
        role === 'theo'
          ? 'Every seat in the house is soaked. Eddie is face-down in the yard. Somewhere, Biscuit is smiling.'
          : 'Every cushion is sauced, crumbed or worse. Eddie is crying into a bidet. It has a warm-water setting.';
    } else {
      title = 'Time-out.';
      blurb = `Eddie sent ${ROLES[role].name} to the time-out corner for good. ${ruined} of 9 couches ruined.`;
    }
    $('end-title').textContent = title;
    $('end-blurb').textContent = blurb;
    $('end-grade').textContent = rank.grade;
    $('end-rank-title').textContent = rank.title;
    $('end-rank-blurb').textContent = rank.blurb;
    const stats: [string, string][] =
      role === 'eddie'
        ? [
            ['Time', formatTime(this.elapsed)],
            ['Ruined', `${ruined}/9`],
            ['Time-outs', String(this.stats.catches)],
            ['Seats cleaned', String(this.stats.cleaned)],
            ['Slips', String(this.stats.slips)],
            ['Yells', String(this.stats.yells)],
          ]
        : [
            ['Time', formatTime(this.elapsed)],
            ['Couches', `${ruined}/9`],
            ['Seats by you', `${this.stats.seats}/${TOTAL_SEATS}`],
            ['Eddie slips', String(this.stats.slips)],
            ['Best combo', `x${this.maxCombo}`],
            [role === 'zach' ? 'Food eaten' : 'Snacks eaten', String(this.stats.eaten)],
          ];
    if (role === 'zach') stats.push(['Bidet visits', String(this.stats.braps)], ['Flexed free', String(this.stats.swole)]);
    if (won && role !== 'eddie') stats.push(['Time bonus', `+${timeBonus}`], ['Heart bonus', `+${lifeBonus}`]);
    if (won && role === 'eddie') stats.push(['Couch bonus', `+${lifeBonus}`]);
    $('end-stats').innerHTML = stats.map(([k, v]) => `<div class="stat"><b>${v}</b><span>${k}</span></div>`).join('');
    $('end-score').textContent = this.score.toLocaleString();
    $('end-best').textContent = this.best[role].toLocaleString();
    this.showScreen('screen-end', true);
    this.hud.show(false);
    this.hud.hideBanner();
    $('touch').classList.remove('is-active');
  }

  // ================================================================ pickups

  private readonly pickupHost: PickupHost = {
    canCollect: (kind: PickupKind, who: MesserId) => {
      const m = who === 'theo' ? this.theo : this.zach;
      if (kind === 'food' || kind === 'feast') return m.ammo < 96 && m.emergency <= 0;
      if (kind === 'toy') return !m.hasToy;
      return true;
    },
    collect: (kind: PickupKind, food: FoodKind | null, at: THREE.Vector3, who: MesserId) => {
      const m = who === 'theo' ? this.theo : this.zach;
      const audible = m.isPlayer || this.near(at);
      switch (kind) {
        case 'food':
        case 'feast': {
          const f = FOOD[food ?? 'nuggets'];
          m.ammo = Math.min(100, m.ammo + f.ammo);
          if (m.id === 'zach') m.bloat = Math.min(100, m.bloat + f.bloat);
          m.play('eat', 0.9);
          if (m.isPlayer) this.stats.eaten += 1;
          if (audible) this.sound.chomp();
          this.worldUi.pop(at.clone().setY(1.2), m.id === 'zach' ? `${f.label} +SAUCE` : `${f.label}`, 'small');
          if (m.id === 'zach') this.puke.crumbs(m.mouth(), 8);
          if (kind === 'feast') {
            this.makeNoise(at, 8, 'splat');
            if (this.role !== 'eddie') this.hud.showBanner('FRIDGE RAID!', m.id === 'zach' ? 'A whole rotisserie chicken. Your gut has concerns.' : 'A whole rotisserie chicken. Full tummy!', 'gold', 2.2);
          }
          if (m.isPlayer || Math.random() < 0.5) this.say(m.id, m.id === 'zach' ? ZACH.eat.next() : THEO.eat.next(), 'calm', 1.4);
          break;
        }
        case 'juice':
          m.zoomies = 7;
          m.stamina = 1;
          m.tired = false;
          if (audible) this.sound.zoomies();
          this.worldUi.pop(at.clone().setY(1.2), m.id === 'zach' ? 'PRE-WORKOUT!' : 'ZOOMIES!', 'gold');
          this.say(m.id, m.id === 'zach' ? ZACH.zoomies : THEO.zoomies, 'shout', 1.4);
          break;
        case 'toy':
          m.hasToy = true;
          if (audible) this.sound.squeak();
          this.worldUi.pop(at.clone().setY(1.2), 'SQUEAKY TOY!', 'small');
          if (m.isPlayer) this.queueHint('toy', this.isTouch ? 'Tap TOY to throw it. Eddie will go check on the squeak.' : 'Press Q (or right-click) to throw the toy. Eddie will go check on the squeak.', true);
          break;
        case 'burrito': {
          m.ammo = 100;
          m.burrito = 3;
          if (m.id === 'zach') m.bloat = Math.min(100, m.bloat + FOOD.burrito.bloat);
          m.play('eat', 1);
          if (audible) {
            this.sound.chomp();
            this.sound.fanfare();
          }
          if (m.isPlayer) this.hud.showBanner('MYSTERY BURRITO!', m.id === 'zach' ? 'Next 3 shots are free and extra saucy. Your gut is filing paperwork.' : 'Your next 3 hurls are free and extra chunky.', 'gold', 2.6);
          else this.worldUi.pop(at.clone().setY(1.4), `${m.name.toUpperCase()} GOT THE BURRITO!`, 'gold');
          break;
        }
      }
      this.effects.sparkle(at, 8);
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
      if (this.role !== 'eddie') this.queueHint('burrito', 'DING! A Mystery Burrito popped out of the kitchen microwave.', true);
      this.makeNoise(at, 7, 'splat');
    },
  };

  // ================================================================ ambient fx

  private updateCouchFx(dt: number) {
    for (const couch of this.couches) {
      if (couch.vibrator && couch.ruined) {
        couch.vibrator.position.set(rand(-0.015, 0.015), rand(0, 0.01), rand(-0.015, 0.015));
        if (Math.random() < dt * 6) this.puke.splash(couch.center, 1, 0.6, couch.seats[0].mess ?? 'puke');
      }
    }
    // Zach drops crumbs wherever he goes.
    const z = this.zach;
    if (z.active && z.speed > 0.5 && Math.random() < dt * 2.5) this.puke.crumbs(z.rig.handL.getWorldPosition(this.tmp), 2);
  }

  private updatePortraits() {
    const focus = this.focus();
    for (const p of this.house.props.portraits) {
      const local = p.group.worldToLocal(this.tmp.copy(focus).setY(0.9));
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
    const dazed = (this.eddie.state === 'slip' || this.eddie.state === 'stunned') && this.eddie.stateTime > 0.5;
    this.effects.dizzy(dazed ? head : null);
    this.steamTimer -= dt;
    if (this.rage >= 3 && this.eddie.chasing && this.steamTimer <= 0) {
      this.steamTimer = 0.12;
      this.effects.steam(model.earL.getWorldPosition(new THREE.Vector3()), -1);
      this.effects.steam(model.earR.getWorldPosition(new THREE.Vector3()), 1);
    }
    this.tearTimer -= dt;
    if (this.eddie.state === 'mourn' && this.tearTimer <= 0) {
      this.tearTimer = 0.1;
      const eye = head.clone().add(new THREE.Vector3(0, -0.18, 0));
      this.effects.tear(eye, Math.random() < 0.5 ? -1 : 1);
    }
  }

  // ================================================================ camera

  /** Where the camera (and the dog portraits) look. */
  private focus() {
    return this.player ? this.player.position : this.eddie.position;
  }

  private attractCamera(dt: number, snap = false) {
    const a = this.time * 0.06 + 0.6;
    const pos = this.tmp.set(Math.sin(a) * 21, 15 + Math.sin(this.time * 0.13) * 1.5, Math.cos(a) * 17);
    if (snap) this.camera.position.copy(pos);
    else this.camera.position.lerp(pos, 1 - Math.exp(-2 * dt));
    this.camera.lookAt(0, -1.5, 0);
    this.camPos.copy(this.camera.position);
  }

  private followCamera(dt: number) {
    const m = this.player;
    // While winding up a mega shot, frame both the shooter and the landing zone.
    const aiming = Boolean(m && m.charging && m.chargeTime > CHARGE_DELAY);
    this.aimBlend = damp(this.aimBlend, aiming ? 1 : 0, 5, dt);
    const height = m ? (m.id === 'zach' ? 0.95 : 0.75) : 1.1;
    const target = this.tmp.copy(this.focus()).setY(height);
    if (this.aimBlend > 0.001) target.lerp(this.tmp2.copy(this.aimPoint).setY(height), 0.42 * this.aimBlend);
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
    this.camera.position.copy(this.camPos);
    if (this.shake > 0) {
      this.camera.position.x += rand(-1, 1) * this.shake * 0.25;
      this.camera.position.y += rand(-1, 1) * this.shake * 0.25;
      this.camera.position.z += rand(-1, 1) * this.shake * 0.25;
    }
    const look = this.tmp.copy(this.camTarget).add(new THREE.Vector3(Math.sin(this.camYaw) * 1.2, 0, Math.cos(this.camYaw) * 1.2));
    this.camera.lookAt(look);
    this.shake = Math.max(0, this.shake - dt * 1.2);
    const speed = m ? m.speed : this.eddie.speedNow;
    const sprintFov = speed > 3.6 ? 5 : 0;
    this.fovKick = Math.max(0, this.fovKick - dt * 18);
    const fov = (this.compact ? 58 : 52) + sprintFov + this.fovKick;
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
      const f = this.focus();
      targets.push(new THREE.Vector3(f.x, 0.9, f.z), new THREE.Vector3(f.x, 0.15, f.z));
      for (const m of this.messers) {
        if (m === this.player || m.timeout > 0) continue;
        if (dist2D(m.position.x, m.position.z, f.x, f.z) < 7) targets.push(new THREE.Vector3(m.position.x, 0.9, m.position.z));
      }
      if (this.player && dist2D(this.eddie.position.x, this.eddie.position.z, f.x, f.z) < 9) {
        targets.push(new THREE.Vector3(this.eddie.position.x, 1.2, this.eddie.position.z));
      }
      if (this.aimSeat) targets.push(this.aimSeat.top.clone());
    }
    for (const occ of this.house.occluders) {
      let hidden = false;
      if (occ.follow) hidden = occ.follow.opacity < 0.9;
      else
        for (const t of targets) {
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
      for (const mat of occ.materials) {
        const base = (mat.userData.baseOpacity as number) ?? 1;
        const fading = occ.opacity < 0.999;
        mat.opacity = base * occ.opacity;
        const transparent = fading || Boolean(mat.userData.baseTransparent);
        if (mat.transparent !== transparent) {
          // The OPAQUE define is baked into the shader program, so it must be rebuilt.
          mat.transparent = transparent;
          mat.needsUpdate = true;
        }
        mat.depthWrite = occ.opacity > 0.6;
      }
    }
  }

  private updatePost(dt: number) {
    const u = this.gfx.uniforms;
    const m = this.player;
    const nausea = m && m.charging ? this.chargeLevel(m) * (m.id === 'theo' ? 1 : 0.4) : 0;
    u.uNausea.value = damp(u.uNausea.value, nausea, 8, dt);
    let danger = 0;
    if (m && (this.mode === 'playing' || this.mode === 'caught') && this.eddie.chasing && this.eddie.target?.id === m.id) {
      const d = dist2D(m.position.x, m.position.z, this.eddie.position.x, this.eddie.position.z);
      danger = clamp(1 - (d - 1) / 6, 0.15, 1);
    }
    if (m && m.emergency > 0 && this.mode === 'playing') danger = Math.max(danger, 0.25 + (1 - m.emergency / EMERGENCY_TIME) * 0.5);
    this.danger = damp(this.danger, danger, 4, dt);
    u.uDanger.value = this.danger;
    this.flash = Math.max(0, this.flash - dt * 1.5);
    u.uFlash.value = this.flash;
    u.uDim.value = damp(u.uDim.value, this.mode === 'paused' ? 0.55 : 0, 10, dt);
  }

  // ================================================================ misc

  private say(who: Speaker, text: string, mood: Mood, duration = 2.2) {
    this.worldUi.say(who, text, mood, duration);
    const syllables = Math.round(clamp(text.length / 4, 2, 12));
    if (who === 'eddie') {
      if (mood !== 'sleepy') this.sound.voice(syllables, { pitch: mood === 'sad' ? 150 : 118, angry: mood === 'shout' || mood === 'angry' });
    } else {
      const v = ROLES[who].voice;
      const m = who === 'theo' ? this.theo : this.zach;
      if (m.isPlayer || this.near(m.position)) this.sound.voice(Math.min(who === 'theo' ? 4 : 6, syllables), { pitch: v.pitch, speed: v.speed, angry: mood === 'shout' });
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
    const m = this.player;
    if (m && m.ammo < 30) {
      this.queueHint('ammoLow', m.id === 'zach' ? 'Sauce running low. Nuggets, drumsticks and mac & cheese are scattered around the house.' : 'Tummy getting low. Nuggets, drumsticks and mac & cheese are scattered around the house.');
    }
    this.hintCooldown -= dt;
    if (this.hintCooldown <= 0 && this.hintQueue.length > 0) {
      const text = this.hintQueue.shift() as string;
      this.hud.showHint(text, this.compact ? 4.5 : 5.5);
      this.hintCooldown = 6.2;
    }
  }

  private updateMusic() {
    let chasing: boolean;
    if (this.role === 'eddie') {
      const stains = this.seats.filter((s) => s.messed && !s.couch.ruined).length;
      chasing = this.clock < 30 || stains >= 4 || this.eddie.state === 'lunge';
    } else {
      chasing = this.eddie.chasing;
    }
    if (chasing !== this.chaseMusic) {
      this.chaseMusic = chasing;
      this.sound.setMusic(chasing ? 'chase' : 'calm');
    }
  }

  private allyStatus(m: Messer) {
    if (m.timeout > 0) return `${m.name}: time-out ${Math.ceil(m.timeout)}s`;
    if (m.toilet >= 0) return `${m.name}: on the toilet`;
    if (m.emergency > 0) return `${m.name}: gut emergency!`;
    if (m.frozen > 0) return `${m.name}: frozen`;
    return null;
  }

  private updateHud(dt: number) {
    const m = this.player;
    const eddieMode = this.role === 'eddie';
    const others = this.messers.filter((x) => x !== m).map((x) => this.allyStatus(x)).filter(Boolean) as string[];
    let actionLabel = ROLES[this.role].action;
    let ring = 0;
    if (eddieMode) {
      const spot = this.scrubSpot;
      if (spot) {
        actionLabel = spot.seat ? 'Scrub' : 'Mop';
        ring = this.scrubProgress.get(spot.seat ?? spot.puddle ?? spot) ?? 0;
      } else {
        ring = clamp(1 - this.eddie.lungeCooldown / 0.8, 0, 1);
      }
    }
    this.hud.update(dt, {
      role: this.role,
      couches: this.couches,
      targetCouch: this.aimSeat?.couch ?? null,
      score: this.score,
      combo: this.combo,
      lives: this.lives,
      maxLives: MAX_LIVES,
      ammo: m ? m.ammo : 100,
      stamina: m ? m.stamina : this.eddie.stamina,
      tired: m ? m.tired : this.eddie.tired,
      bloat: this.zach.bloat,
      emergency: m ? m.emergency : 0,
      eddie: this.eddie.status(m ? m.id : null),
      rage: this.rage,
      hasToy: m ? m.hasToy : false,
      burrito: m ? m.burrito : 0,
      zoomies: m ? m.zoomies : 0,
      hidden: m ? m.hidden : false,
      clock: this.clock,
      catches: this.stats.catches,
      ruinLimit: RUIN_LIMIT,
      actionLabel,
      ring,
      ally: others.length ? others.join(' · ') : null,
    });
    const urgent = Boolean(m && m.emergency > 0);
    this.minimap.draw({
      player: m
        ? { x: m.position.x, z: m.position.z, facing: m.facing, color: COLORS[m.id] }
        : { x: this.eddie.position.x, z: this.eddie.position.z, facing: this.eddie.facing, color: COLORS.eddie },
      cameraYaw: this.camYaw,
      eddie: m
        ? {
            x: this.eddie.position.x,
            z: this.eddie.position.z,
            facing: this.eddie.facing,
            chasing: this.eddie.chasing,
            asleep: this.eddie.state === 'sleep',
            range: 7.4 + this.rage * 0.55,
          }
        : null,
      others: this.messers.filter((x) => x !== m).map((x) => ({ x: x.position.x, z: x.position.z, color: COLORS[x.id], dim: x.timeout > 0 })),
      couches: this.couches,
      pickups: this.pickups.markers(),
      toilets: this.house.toilets.map((t) => ({ x: t.seat.x, z: t.seat.z, urgent })),
      puddles: this.puke.puddles,
      time: this.time,
    });
    if (this.mode === 'playing' || this.mode === 'intro') {
      let arrow: { at: THREE.Vector3; style: ArrowStyle } | null = null;
      if (m && m.emergency > 0) arrow = { at: this.nearestToilet(m.position).front.clone().setY(0.8), style: 'toilet' };
      else if (m && this.eddie.chasing && this.eddie.target?.id === m.id) arrow = { at: this.eddie.model.headTop.getWorldPosition(new THREE.Vector3()), style: 'danger' };
      else if (!m) {
        let best: Messer | null = null;
        let bestD = Infinity;
        for (const x of this.messers) {
          if (!x.active) continue;
          const d = dist2D(x.position.x, x.position.z, this.eddie.position.x, this.eddie.position.z);
          if (d < bestD) {
            bestD = d;
            best = x;
          }
        }
        if (best) arrow = { at: best.head(new THREE.Vector3()), style: 'target' };
      }
      const showMark = Boolean(m) && this.eddie.state !== 'sleep';
      this.worldUi.update(dt, this.heads(), this.eddie.suspicion, this.eddie.chasing && this.eddie.state === 'alert', showMark, arrow);
    }
    this.eddie.model.talking = this.worldUi.isTalking('eddie') ? 1 : 0;
  }
}
