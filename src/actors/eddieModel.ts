import * as THREE from 'three';
import { cylGeo, glossy, mesh, roundedBoxGeo, sphereGeo, std } from '../world/kit';
import { hawaiianTexture } from '../world/textures';
import { clamp, damp, rand } from '../core/util';
import { keepSeparate, mergeRig } from '../world/batch';

export type EddieAnim =
  | 'idle'
  | 'walk'
  | 'run'
  | 'sleep'
  | 'wake'
  | 'look'
  | 'alert'
  | 'windup'
  | 'lunge'
  | 'recover'
  | 'scrub'
  | 'mourn'
  | 'slip'
  | 'lift'
  | 'pukedOn'
  | 'cry';

interface Pose {
  hipY: number;
  hipPitch: number;
  hipRoll: number;
  torsoPitch: number;
  torsoYaw: number;
  torsoRoll: number;
  headPitch: number;
  headYaw: number;
  headRoll: number;
  shLX: number;
  shLZ: number;
  shRX: number;
  shRZ: number;
  elL: number;
  elR: number;
  legL: number;
  legR: number;
  knL: number;
  knR: number;
  rootPitch: number;
  rootLift: number;
}

const ZERO: Pose = {
  hipY: 0.95,
  hipPitch: 0,
  hipRoll: 0,
  torsoPitch: 0,
  torsoYaw: 0,
  torsoRoll: 0,
  headPitch: 0,
  headYaw: 0,
  headRoll: 0,
  shLX: 0,
  shLZ: -0.12,
  shRX: 0,
  shRZ: 0.12,
  elL: -0.2,
  elR: -0.2,
  legL: 0,
  legR: 0,
  knL: 0,
  knR: 0,
  rootPitch: 0,
  rootLift: 0,
};

const SKIN = new THREE.Color(0xd09a6e);
const RAGE = new THREE.Color(0xe0453a);
const GREEN = new THREE.Color(0x9ccf5a);

/** Eddie, 35. Owns nine couches and four hundred hotdog buns. Zero hotdogs. */
export class EddieModel {
  readonly root = new THREE.Group();
  /** Pivot for whole-body tumbles (slips). */
  private readonly tumble = new THREE.Group();
  private readonly hips = new THREE.Group();
  private readonly torso = new THREE.Group();
  private readonly head = new THREE.Group();
  private readonly shL = new THREE.Group();
  private readonly shR = new THREE.Group();
  private readonly elL = new THREE.Group();
  private readonly elR = new THREE.Group();
  private readonly legL = new THREE.Group();
  private readonly legR = new THREE.Group();
  private readonly knL = new THREE.Group();
  private readonly knR = new THREE.Group();
  private readonly browL: THREE.Mesh;
  private readonly browR: THREE.Mesh;
  private readonly mouth: THREE.Mesh;
  private readonly eyes: THREE.Group[] = [];
  private readonly skin: THREE.MeshStandardMaterial;
  readonly handR = new THREE.Object3D();
  readonly handL = new THREE.Object3D();
  readonly headTop = new THREE.Object3D();
  readonly nozzle = new THREE.Object3D();
  readonly earL = new THREE.Object3D();
  readonly earR = new THREE.Object3D();
  private readonly pose: Pose = { ...ZERO };
  private phase = 0;
  private time = 0;
  private blink = 0;
  private nextBlink = 2;

  /** 0..1 how red Eddie's face is. */
  rage = 0;
  /** 0..1 talking mouth flap. */
  talking = 0;
  /** 0..1 green-faced after being puked on. */
  slimed = 0;

  constructor() {
    this.skin = std(SKIN, { roughness: 0.55 });
    const shirt = new THREE.MeshStandardMaterial({ map: hawaiianTexture(), roughness: 0.7 });
    const shorts = std(0xb39a6b, { roughness: 0.85 });
    const hair = std(0x1f1714, { roughness: 0.6 });
    const white = std(0xffffff, { roughness: 0.3 });
    const dark = std(0x140d0a, { roughness: 0.3 });
    const glove = glossy(0xffd23f, { roughness: 0.25, clearcoat: 0.8 });
    const sock = std(0xf5f5f0, { roughness: 0.9 });
    const sandal = std(0x5a3a22, { roughness: 0.7 });

    this.root.add(this.tumble);
    this.tumble.add(this.hips);

    // Hips / shorts.
    mesh(roundedBoxGeo(0.5, 0.28, 0.34, 0.1), shorts, 0, 0, 0, { parent: this.hips });
    this.torso.position.y = 0.1;
    this.hips.add(this.torso);
    const belly = mesh(sphereGeo(0.31, 24, 18), shirt, 0, 0.26, 0.05, { parent: this.torso });
    belly.scale.set(1, 1.05, 0.95);
    mesh(roundedBoxGeo(0.62, 0.4, 0.36, 0.14), shirt, 0, 0.5, -0.02, { parent: this.torso });
    for (const side of [-1, 1]) {
      mesh(roundedBoxGeo(0.14, 0.06, 0.12, 0.03), shirt, side * 0.09, 0.71, 0.13, { rz: side * 0.5, parent: this.torso, cast: false });
    }
    mesh(cylGeo(0.09, 0.1, 0.12, 12), this.skin, 0, 0.74, 0, { parent: this.torso });

    // Head.
    this.head.position.set(0, 0.92, 0.02);
    this.torso.add(this.head);
    const skull = mesh(sphereGeo(0.215, 24, 20), this.skin, 0, 0, 0, { parent: this.head });
    skull.scale.set(1, 1.12, 1.02);
    mesh(sphereGeo(0.16, 18, 14), this.skin, 0, -0.12, 0.06, { parent: this.head }).scale.set(1.15, 0.9, 1);
    mesh(sphereGeo(0.055, 12, 10), this.skin, 0, -0.01, 0.215, { parent: this.head }).scale.set(0.95, 1, 1.25);
    for (const side of [-1, 1]) {
      mesh(sphereGeo(0.055, 10, 8), this.skin, side * 0.215, 0, -0.01, { parent: this.head }).scale.set(0.6, 1, 1);
    }
    this.earL.position.set(-0.24, 0.02, 0);
    this.earR.position.set(0.24, 0.02, 0);
    this.head.add(this.earL, this.earR);
    // Flat-top.
    mesh(roundedBoxGeo(0.4, 0.14, 0.4, 0.04), hair, 0, 0.21, -0.02, { parent: this.head });
    mesh(roundedBoxGeo(0.44, 0.2, 0.2, 0.06), hair, 0, 0.1, -0.13, { parent: this.head });
    for (const side of [-1, 1]) mesh(roundedBoxGeo(0.06, 0.16, 0.22, 0.03), hair, side * 0.2, 0.08, -0.04, { parent: this.head });
    // Mustache.
    mesh(roundedBoxGeo(0.2, 0.05, 0.06, 0.025), hair, 0, -0.075, 0.2, { parent: this.head });
    // Eyes.
    for (const side of [-1, 1]) {
      const eye = new THREE.Group();
      eye.position.set(side * 0.08, 0.055, 0.18);
      this.head.add(eye);
      mesh(sphereGeo(0.045, 14, 10), white, 0, 0, 0, { parent: eye, cast: false }).scale.z = 0.6;
      mesh(sphereGeo(0.024, 10, 8), dark, 0, 0, 0.022, { parent: eye, cast: false }).scale.z = 0.5;
      this.eyes.push(eye);
    }
    this.browL = mesh(roundedBoxGeo(0.12, 0.032, 0.04, 0.012), hair, -0.085, 0.12, 0.19, { parent: this.head, cast: false });
    this.browR = mesh(roundedBoxGeo(0.12, 0.032, 0.04, 0.012), hair, 0.085, 0.12, 0.19, { parent: this.head, cast: false });
    this.mouth = mesh(sphereGeo(0.06, 14, 10), std(0x4a1212, { roughness: 0.5 }), 0, -0.135, 0.19, { parent: this.head, cast: false });
    this.mouth.scale.set(1.2, 0.25, 0.4);
    this.headTop.position.set(0, 0.42, 0);
    this.head.add(this.headTop);

    // Arms.
    for (const [sh, el, side, hand] of [
      [this.shL, this.elL, -1, this.handL],
      [this.shR, this.elR, 1, this.handR],
    ] as const) {
      sh.position.set(side * 0.36, 0.6, 0);
      this.torso.add(sh);
      mesh(sphereGeo(0.12, 14, 10), shirt, 0, -0.02, 0, { parent: sh });
      mesh(new THREE.CapsuleGeometry(0.085, 0.18, 4, 12), shirt, 0, -0.16, 0, { parent: sh });
      el.position.y = -0.32;
      sh.add(el);
      mesh(new THREE.CapsuleGeometry(0.068, 0.2, 4, 10), this.skin, 0, -0.14, 0, { parent: el });
      mesh(sphereGeo(0.088, 14, 10), glove, 0, -0.3, 0.01, { parent: el });
      mesh(cylGeo(0.075, 0.09, 0.09, 12), glove, 0, -0.22, 0, { parent: el });
      hand.position.set(0, -0.32, 0.06);
      el.add(hand);
    }
    // Spray bottle in right hand.
    const bottle = new THREE.Group();
    bottle.position.set(0, -0.36, 0.08);
    bottle.rotation.x = -Math.PI / 2;
    this.elR.add(bottle);
    mesh(cylGeo(0.05, 0.055, 0.2, 14), new THREE.MeshPhysicalMaterial({ color: 0x6ec6ff, roughness: 0.1, transparent: true, opacity: 0.75, clearcoat: 1 }), 0, 0, 0, {
      parent: bottle,
    });
    mesh(roundedBoxGeo(0.06, 0.09, 0.1, 0.02), std(0xf4f4f4, { roughness: 0.4 }), 0, 0.14, 0.02, { parent: bottle });
    mesh(cylGeo(0.012, 0.012, 0.06, 8), std(0xf4f4f4), 0, 0.15, 0.09, { rx: Math.PI / 2, parent: bottle });
    this.nozzle.position.set(0, 0.15, 0.13);
    bottle.add(this.nozzle);

    // Legs.
    for (const [leg, knee, side] of [
      [this.legL, this.knL, -1],
      [this.legR, this.knR, 1],
    ] as const) {
      leg.position.set(side * 0.13, -0.1, 0);
      this.hips.add(leg);
      mesh(new THREE.CapsuleGeometry(0.115, 0.16, 4, 12), shorts, 0, -0.14, 0, { parent: leg });
      knee.position.y = -0.38;
      leg.add(knee);
      mesh(new THREE.CapsuleGeometry(0.075, 0.24, 4, 10), this.skin, 0, -0.14, 0, { parent: knee });
      mesh(cylGeo(0.08, 0.075, 0.12, 12), sock, 0, -0.33, 0, { parent: knee });
      mesh(roundedBoxGeo(0.15, 0.06, 0.3, 0.025), sandal, 0, -0.42, 0.06, { parent: knee });
    }

    this.root.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = true;
    });
    keepSeparate(this.mouth);
    keepSeparate(this.browL);
    keepSeparate(this.browR);
    mergeRig([this.hips, this.torso, this.head, this.shL, this.shR, this.elL, this.elR, this.legL, this.legR, this.knL, this.knR, bottle, ...this.eyes]);
  }

  /** Called every frame with the current animation and its local time. */
  animate(dt: number, anim: EddieAnim, animTime: number, speed: number) {
    this.time += dt;
    const t = this.time;
    const target: Pose = { ...ZERO };
    let brow = 0.15 + this.rage * 0.35;
    let mouthOpen = 0.25;
    let eyeOpen = 1;
    let damping = 12;

    const gait = (amp: number, rate: number) => {
      this.phase += dt * rate;
      const s = Math.sin(this.phase);
      target.legL = s * amp;
      target.legR = -s * amp;
      target.knL = Math.max(0, -Math.cos(this.phase)) * amp * 1.2;
      target.knR = Math.max(0, Math.cos(this.phase)) * amp * 1.2;
      target.shLX = -s * amp * 0.9;
      target.shRX = s * amp * 0.9;
      target.elL = -0.3 - amp * 0.5;
      target.elR = -0.3 - amp * 0.5;
      target.hipY = ZERO.hipY - 0.02 + Math.abs(Math.cos(this.phase)) * 0.05 * amp;
      target.hipRoll = s * 0.06;
      target.torsoYaw = -s * 0.12 * amp;
    };

    switch (anim) {
      case 'idle':
        target.hipY += Math.sin(t * 1.8) * 0.01;
        target.headYaw = Math.sin(t * 0.7) * 0.3;
        break;
      case 'walk':
        gait(0.55, 4 + speed * 2.4);
        break;
      case 'run':
        gait(0.95, 5 + speed * 2.2);
        target.torsoPitch = 0.22;
        target.shLZ = -0.35;
        target.shRZ = 0.35;
        brow = 0.6;
        mouthOpen = 0.8;
        break;
      case 'look':
        target.headYaw = Math.sin(animTime * 2.4) * 0.9;
        target.torsoYaw = Math.sin(animTime * 2.4) * 0.25;
        target.shLX = -0.1;
        target.shRX = -0.1;
        target.shLZ = -0.6;
        target.shRZ = 0.6;
        target.elL = -1.6;
        target.elR = -1.6;
        brow = 0.35;
        break;
      case 'sleep':
        target.hipY = 0.55;
        target.hipPitch = -0.15;
        target.torsoPitch = -0.55;
        target.headPitch = -0.25;
        target.headRoll = 0.35 + Math.sin(t * 0.6) * 0.05;
        target.legL = -1.35;
        target.legR = -1.25;
        target.knL = 0.4;
        target.knR = 0.35;
        target.shLX = -0.5;
        target.shRX = -0.5;
        target.shLZ = -0.25;
        target.shRZ = 0.25;
        target.elL = -1.3;
        target.elR = -1.3;
        eyeOpen = 0.08;
        mouthOpen = 0.7 + Math.sin(t * 1.6) * 0.4;
        brow = -0.1;
        break;
      case 'wake': {
        const k = clamp(animTime / 1.4, 0, 1);
        target.hipY = 0.55 + k * 0.4;
        target.torsoPitch = -0.3 * (1 - k);
        target.shLZ = -2.6 * Math.sin(k * Math.PI);
        target.shRZ = 2.6 * Math.sin(k * Math.PI);
        target.legL = -1.3 * (1 - k);
        target.legR = -1.3 * (1 - k);
        target.knL = 1.3 * (1 - k);
        target.knR = 1.3 * (1 - k);
        mouthOpen = 1.6 * Math.sin(k * Math.PI);
        eyeOpen = 0.3 + k * 0.7;
        damping = 8;
        break;
      }
      case 'alert':
        target.hipY = ZERO.hipY + Math.max(0, Math.sin(animTime * 9)) * 0.12 * (animTime < 0.35 ? 1 : 0);
        target.shLZ = -1.2;
        target.shRZ = 1.2;
        target.elL = -0.6;
        target.elR = -0.6;
        target.torsoPitch = -0.1;
        brow = 0.9;
        mouthOpen = 1.4;
        eyeOpen = 1.35;
        damping = 20;
        break;
      case 'windup':
        target.hipY = 0.82;
        target.torsoPitch = 0.45;
        target.legL = -0.5;
        target.legR = 0.3;
        target.knL = 0.8;
        target.knR = 0.5;
        target.shLX = 0.9;
        target.shRX = 0.9;
        target.elL = -0.6;
        target.elR = -0.6;
        brow = 1;
        mouthOpen = 0.9;
        damping = 18;
        break;
      case 'lunge':
        target.hipY = 0.82;
        target.torsoPitch = 0.75;
        target.legL = 0.6;
        target.legR = -0.6;
        target.knR = 0.6;
        target.shLX = -2.4;
        target.shRX = -2.4;
        target.shLZ = -0.3;
        target.shRZ = 0.3;
        target.elL = 0;
        target.elR = 0;
        brow = 1;
        mouthOpen = 1.6;
        damping = 22;
        break;
      case 'recover':
        gait(0.4, 6);
        target.torsoPitch = 0.4;
        target.shLX = 0.4;
        target.shRX = 0.4;
        mouthOpen = 1.1;
        break;
      case 'scrub': {
        target.hipY = 0.86;
        target.torsoPitch = 0.62;
        target.headPitch = 0.2;
        target.legL = -0.25;
        target.legR = 0.15;
        target.knL = 0.4;
        target.knR = 0.2;
        const c = animTime * 11;
        target.shLX = -1.1 + Math.sin(c) * 0.25;
        target.shLZ = -0.4 + Math.cos(c) * 0.3;
        target.elL = -0.6;
        target.shRX = -1.3 + Math.sin(animTime * 4) * 0.1;
        target.shRZ = 0.3;
        target.elR = -0.5;
        brow = 0.1;
        mouthOpen = 0.3 + Math.abs(Math.sin(animTime * 5)) * 0.4;
        break;
      }
      case 'mourn': {
        const k = clamp(animTime / 0.35, 0, 1);
        target.hipY = ZERO.hipY - 0.5 * k;
        target.legL = -1.4 * k;
        target.legR = -1.4 * k;
        target.knL = 2.3 * k;
        target.knR = 2.3 * k;
        target.torsoPitch = -0.35 + Math.sin(animTime * 3) * 0.05;
        target.headPitch = -0.55;
        target.shLZ = -2.8;
        target.shRZ = 2.8;
        target.shLX = -0.3 + Math.sin(animTime * 14) * 0.08;
        target.shRX = -0.3 - Math.sin(animTime * 14) * 0.08;
        target.elL = -0.3;
        target.elR = -0.3;
        brow = -0.8;
        mouthOpen = 2.2 + Math.sin(animTime * 20) * 0.3;
        eyeOpen = 0.35;
        damping = 14;
        break;
      }
      case 'cry':
        target.hipY = ZERO.hipY - 0.5;
        target.legL = -1.4;
        target.legR = -1.4;
        target.knL = 2.3;
        target.knR = 2.3;
        target.torsoPitch = 0.45 + Math.sin(animTime * 9) * 0.06;
        target.headPitch = 0.4;
        target.shLX = -1.6;
        target.shRX = -1.6;
        target.elL = -1.9;
        target.elR = -1.9;
        brow = -0.8;
        mouthOpen = 1.1;
        eyeOpen = 0.1;
        break;
      case 'slip': {
        // 0-0.45: feet fly up; 0.45-2.0: flat on back; 2.0-2.6: get up.
        if (animTime < 0.45) {
          const k = animTime / 0.45;
          target.rootPitch = -1.45 * k;
          target.rootLift = Math.sin(k * Math.PI) * 0.7;
          target.legL = -1.2 * k;
          target.legR = -0.6 * k;
          target.shLZ = -2.2;
          target.shRZ = 2.2;
          target.shLX = Math.sin(animTime * 40) * 0.8;
          target.shRX = -Math.sin(animTime * 40) * 0.8;
          mouthOpen = 2.2;
          eyeOpen = 1.4;
          damping = 30;
        } else if (animTime < 2.0) {
          target.rootPitch = -1.5;
          target.rootLift = 0.18;
          target.hipY = 0.4;
          target.legL = -0.6 + Math.sin(animTime * 7) * 0.2;
          target.legR = -0.9 - Math.sin(animTime * 7) * 0.2;
          target.knL = 0.5;
          target.knR = 0.7;
          target.shLZ = -1.6;
          target.shRZ = 1.6;
          target.headRoll = Math.sin(animTime * 5) * 0.3;
          eyeOpen = 0.45;
          mouthOpen = 0.9;
          brow = -0.4;
          damping = 16;
        } else {
          target.hipY = 0.7;
          target.torsoPitch = 0.4;
          target.knL = 0.6;
          target.knR = 0.6;
          brow = 0.5;
          damping = 8;
        }
        break;
      }
      case 'lift':
        // Holding Theo out at arm's length like a leaking bag of trash.
        target.shLZ = -0.12;
        target.shRZ = 0.12;
        target.shLX = -1.45 + Math.sin(animTime * 9) * 0.06;
        target.shRX = -1.45 - Math.sin(animTime * 9) * 0.06;
        target.elL = -0.15;
        target.elR = -0.15;
        target.torsoPitch = -0.2;
        target.headPitch = 0.05;
        target.hipY = ZERO.hipY + Math.abs(Math.sin(animTime * 8)) * 0.04;
        brow = 1;
        mouthOpen = 1 + Math.sin(animTime * 16) * 0.6;
        break;
      case 'pukedOn':
        target.shLX = -2.0;
        target.shRX = -2.0;
        target.shLZ = -0.5;
        target.shRZ = 0.5;
        target.elL = -2.1;
        target.elR = -2.1;
        target.torsoPitch = 0.3 + Math.sin(animTime * 8) * 0.12;
        target.torsoRoll = Math.sin(animTime * 6) * 0.15;
        target.headPitch = 0.3;
        target.legL = Math.sin(animTime * 6) * 0.3;
        target.legR = -Math.sin(animTime * 6) * 0.3;
        eyeOpen = 0.1;
        mouthOpen = 0.2;
        break;
    }

    // Lerp current pose toward the target.
    const p = this.pose;
    for (const key of Object.keys(p) as (keyof Pose)[]) {
      p[key] = damp(p[key], target[key], damping, dt);
    }

    this.tumble.rotation.x = p.rootPitch;
    this.tumble.position.y = p.rootLift;
    this.hips.position.y = p.hipY;
    this.hips.rotation.set(p.hipPitch, 0, p.hipRoll);
    this.torso.rotation.set(p.torsoPitch, p.torsoYaw, p.torsoRoll);
    this.head.rotation.set(p.headPitch, p.headYaw, p.headRoll);
    this.shL.rotation.set(p.shLX, 0, p.shLZ);
    this.shR.rotation.set(p.shRX, 0, p.shRZ);
    this.elL.rotation.x = p.elL;
    this.elR.rotation.x = p.elR;
    this.legL.rotation.x = p.legL;
    this.legR.rotation.x = p.legR;
    this.knL.rotation.x = p.knL;
    this.knR.rotation.x = p.knR;

    // Face.
    if (this.talking > 0) mouthOpen = Math.max(mouthOpen, 0.4 + Math.abs(Math.sin(t * 22)) * 1.3 * this.talking);
    this.mouth.scale.y = damp(this.mouth.scale.y, 0.25 * mouthOpen, 20, dt);
    this.browL.rotation.z = damp(this.browL.rotation.z, -brow * 0.5, 14, dt);
    this.browR.rotation.z = damp(this.browR.rotation.z, brow * 0.5, 14, dt);
    this.browL.position.y = 0.12 - Math.max(0, brow) * 0.02;
    this.browR.position.y = this.browL.position.y;

    this.nextBlink -= dt;
    if (this.nextBlink <= 0) {
      this.blink = 0.12;
      this.nextBlink = rand(2.5, 5);
    }
    if (this.blink > 0) this.blink -= dt;
    const ey = (this.blink > 0 && eyeOpen > 0.5 ? 0.1 : 1) * eyeOpen;
    for (const e of this.eyes) e.scale.y = damp(e.scale.y, ey, 25, dt);

    this.skin.color.copy(SKIN).lerp(RAGE, clamp(this.rage, 0, 1) * 0.55).lerp(GREEN, clamp(this.slimed, 0, 1) * 0.8);
  }
}
