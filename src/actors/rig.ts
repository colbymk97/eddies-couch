import * as THREE from 'three';
import { cylGeo, glossy, mesh, roundedBoxGeo, sphereGeo, std } from '../world/kit';
import { clamp, damp, rand } from '../core/util';
import { keepSeparate, mergeRig } from '../world/batch';

export type Anim =
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
  | 'cry'
  | 'slip'
  | 'lift'
  | 'pukedOn'
  | 'charge'
  | 'hurl'
  | 'throw'
  | 'squeeze'
  | 'eat'
  | 'flex'
  | 'clench'
  | 'sit'
  | 'crawl'
  | 'carried'
  | 'celebrate'
  | 'sulk'
  | 'yell';

export interface RigSpec {
  id: 'theo' | 'zach' | 'eddie';
  thigh: number;
  shin: number;
  hipHalf: number;
  pelvis: [number, number, number];
  torsoLen: number;
  waistW: number;
  chest: [number, number, number];
  shoulderHalf: number;
  upperArm: number;
  foreArm: number;
  upperArmR: number;
  foreArmR: number;
  handR: number;
  thighR: number;
  shinR: number;
  neckLen: number;
  neckR: number;
  headR: number;
  headScale: [number, number, number];
  foot: [number, number, number];
  muscle: number;
  belly: number;
  eyeScale: number;
  skin: string;
  hair: string;
  hairStyle: 'kid' | 'textured' | 'slick';
  beard: 'none' | 'short' | 'full';
  beardColor: string;
  iris: string;
  glasses: 'none' | 'gold' | 'rainbow';
  shirt: () => THREE.Material;
  /** Optional graphic printed on the front of the shirt. */
  chestPrint?: () => THREE.Texture;
  /** Short sleeves, or long sleeves rolled up to the elbow. */
  sleeves: 'short' | 'rolled';
  collar: 'crew' | 'button' | 'open';
  pants: string;
  shorts: boolean;
  shoe: string;
  sole: string;
  gloves: boolean;
  prop: 'spray' | 'sauce' | 'none';
  cheeks: boolean;
}

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
  legLZ: number;
  legRZ: number;
  knL: number;
  knR: number;
  rootPitch: number;
  rootLift: number;
}

const RAGE = new THREE.Color(0xe0453a);
const GREEN = new THREE.Color(0x9ccf5a);
const PALE = new THREE.Color(0xb9c48f);

function rainbowRing(radius: number, tube: number) {
  const geo = new THREE.TorusGeometry(radius, tube, 8, 28);
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i += 1) {
    const a = Math.atan2(pos.getY(i), pos.getX(i));
    // Orange over the top, red down the sides, a flash of yellow and blue along the bottom.
    const t = (a / (Math.PI * 2) + 1) % 1;
    c.setHSL(0.02 + 0.13 * Math.sin(t * Math.PI * 2) ** 2, 0.95, 0.55);
    if (t > 0.68 && t < 0.82) c.setHSL(0.58, 0.8, 0.55);
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geo;
}

/** A stylized but properly proportioned person, shared by Theo, Zach and Eddie. */
export class HumanRig {
  readonly root = new THREE.Group();
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
  private readonly cheeks: THREE.Mesh[] = [];
  private readonly skin: THREE.MeshStandardMaterial;
  private readonly skinColor: THREE.Color;
  readonly handR = new THREE.Object3D();
  readonly handL = new THREE.Object3D();
  readonly headTop = new THREE.Object3D();
  readonly emitter = new THREE.Object3D();
  readonly earL = new THREE.Object3D();
  readonly earR = new THREE.Object3D();
  readonly hipHeight: number;
  readonly height: number;
  private readonly rest: Pose;
  private readonly pose: Pose;
  private phase = 0;
  private time = 0;
  private blink = 0;
  private nextBlink = 2;

  /** 0..1 how red the face is (Eddie's rage). */
  rage = 0;
  /** 0..1 talking mouth flap. */
  talking = 0;
  /** 0..1 green after being puked on. */
  slimed = 0;
  /** 0..1 queasy (Theo winding up). */
  queasy = 0;
  /** 0..1 pale with a gut emergency (Zach). */
  pale = 0;

  constructor(readonly spec: RigSpec) {
    const s = spec;
    this.skinColor = new THREE.Color(s.skin);
    this.skin = std(this.skinColor.clone(), { roughness: 0.55 });
    this.skin.emissive.set(0x2a0e04);
    this.skin.emissiveIntensity = 0.1;
    // Tinted every frame (rage, queasy, pale), so it must never be baked or shared.
    this.skin.userData.live = true;
    const shirt = s.shirt();
    const pants = std(s.pants, { roughness: 0.85 });
    const hair = std(s.hair, { roughness: 0.6 });
    const beard = std(s.beardColor, { roughness: 0.9 });
    const white = std(0xffffff, { roughness: 0.25 });
    const dark = std(0x120c0a, { roughness: 0.25 });
    const iris = std(s.iris, { roughness: 0.3 });
    const shoe = std(s.shoe, { roughness: 0.6 });
    const sole = std(s.sole, { roughness: 0.7 });
    const glove = glossy(0xffd23f, { roughness: 0.25, clearcoat: 0.8 });
    const hand = s.gloves ? glove : this.skin;

    this.hipHeight = s.thigh + s.shin + s.foot[1] + 0.02;
    const R = s.headR;
    this.height = this.hipHeight + 0.06 + s.torsoLen + s.neckLen + R * 2 * s.headScale[1];

    this.root.add(this.tumble);
    this.tumble.add(this.hips);

    // Pelvis + belt.
    mesh(roundedBoxGeo(s.pelvis[0], s.pelvis[1], s.pelvis[2], 0.06), pants, 0, 0.02, 0, { parent: this.hips });
    if (!s.shorts) mesh(roundedBoxGeo(s.pelvis[0] + 0.01, 0.035, s.pelvis[2] + 0.01, 0.015), std(0x4a2f1e, { roughness: 0.5 }), 0, s.pelvis[1] / 2, 0, { parent: this.hips });

    // Torso.
    this.torso.position.y = 0.06;
    this.hips.add(this.torso);
    const tl = s.torsoLen;
    mesh(roundedBoxGeo(s.waistW, tl * 0.5, s.chest[2] * 0.88, 0.08), shirt, 0, tl * 0.25, 0, { parent: this.torso });
    mesh(roundedBoxGeo(s.chest[0], s.chest[1], s.chest[2], Math.min(0.12, s.chest[2] * 0.4)), shirt, 0, tl - s.chest[1] / 2 - 0.01, 0, { parent: this.torso });
    if (s.belly > 0) {
      const b = mesh(sphereGeo(s.waistW * 0.47, 20, 14), shirt, 0, tl * 0.3, s.chest[2] * 0.14, { parent: this.torso });
      b.scale.set(1, 0.95, 0.6 + s.belly * 0.5);
    }
    if (s.chestPrint) {
      const print = std(0xffffff, { map: s.chestPrint(), roughness: 0.8, transparent: true });
      mesh(new THREE.PlaneGeometry(s.chest[0] * 0.62, s.chest[0] * 0.62), print, 0, tl - s.chest[1] * 0.75, s.chest[2] / 2 + 0.006, { parent: this.torso, cast: false });
    }
    if (s.muscle > 0) {
      for (const side of [-1, 1]) {
        const pec = mesh(sphereGeo(s.chest[0] * 0.25, 16, 12), shirt, side * s.chest[0] * 0.2, tl - s.chest[1] * 0.42, s.chest[2] * 0.36, { parent: this.torso });
        pec.scale.set(1.1, 0.75, 0.55);
      }
      const traps = mesh(sphereGeo(s.chest[0] * 0.3, 16, 12), shirt, 0, tl + 0.01, -0.01, { parent: this.torso });
      traps.scale.set(1.5, 0.45, 0.8);
    }
    // Collar.
    if (s.collar === 'crew') {
      mesh(new THREE.TorusGeometry(s.neckR * 1.25, s.neckR * 0.18, 6, 16), shirt, 0, tl - 0.012, 0, { rx: Math.PI / 2, parent: this.torso, cast: false });
    } else {
      for (const side of [-1, 1]) {
        const flap = mesh(roundedBoxGeo(s.neckR * 1.4, 0.03, s.neckR * 1.3, 0.012), shirt, side * s.neckR * 0.85, tl + 0.01, s.chest[2] * 0.3, {
          rz: side * (s.collar === 'open' ? 0.75 : 0.45),
          ry: side * 0.35,
          parent: this.torso,
          cast: false,
        });
        void flap;
      }
      const placket = std(0xffffff, { roughness: 0.6 });
      for (let i = 0; i < 4; i += 1) {
        mesh(sphereGeo(0.009, 6, 4), placket, 0, tl - 0.08 - i * (tl * 0.22), s.chest[2] / 2 + 0.005, { parent: this.torso, cast: false });
      }
    }
    mesh(cylGeo(s.neckR, s.neckR * 1.08, s.neckLen + 0.06, 14), this.skin, 0, tl + s.neckLen / 2, 0, { parent: this.torso });

    // Head.
    this.head.position.set(0, tl + s.neckLen + R * 0.92, 0.01);
    this.torso.add(this.head);
    const skull = mesh(sphereGeo(R, 26, 20), this.skin, 0, 0, 0, { parent: this.head });
    skull.scale.set(...s.headScale);
    mesh(sphereGeo(R * 0.78, 18, 14), this.skin, 0, -R * 0.42, R * 0.16, { parent: this.head }).scale.set(1.04, 0.86, 0.95);
    mesh(sphereGeo(R * 0.19, 12, 10), this.skin, 0, -R * 0.08, R * 0.95, { parent: this.head }).scale.set(0.85, 1, 1.25);
    for (const side of [-1, 1]) {
      mesh(sphereGeo(R * 0.24, 10, 8), this.skin, side * R * 0.97 * s.headScale[0], -R * 0.02, -R * 0.04, { parent: this.head }).scale.set(0.5, 1, 0.8);
    }
    this.earL.position.set(-R * 1.05, 0, 0);
    this.earR.position.set(R * 1.05, 0, 0);
    this.head.add(this.earL, this.earR);

    // Eyes.
    const eyeR = R * 0.15 * s.eyeScale;
    for (const side of [-1, 1]) {
      const eye = new THREE.Group();
      eye.position.set(side * R * 0.36, R * 0.12, R * 0.83);
      this.head.add(eye);
      mesh(sphereGeo(eyeR, 14, 10), white, 0, 0, 0, { parent: eye, cast: false }).scale.z = 0.55;
      mesh(sphereGeo(eyeR * 0.66, 12, 8), iris, 0, -eyeR * 0.05, eyeR * 0.36, { parent: eye, cast: false }).scale.z = 0.45;
      mesh(sphereGeo(eyeR * 0.36, 10, 8), dark, 0, -eyeR * 0.05, eyeR * 0.5, { parent: eye, cast: false }).scale.z = 0.4;
      mesh(sphereGeo(eyeR * 0.16, 6, 4), white, eyeR * 0.22, eyeR * 0.22, eyeR * 0.6, { parent: eye, cast: false });
      this.eyes.push(eye);
    }
    const browMat = s.hairStyle === 'kid' ? std(s.hair, { roughness: 0.8 }) : hair;
    this.browL = mesh(roundedBoxGeo(R * 0.46, R * 0.1, R * 0.12, R * 0.04), browMat, -R * 0.36, R * 0.38, R * 0.86, { parent: this.head, cast: false });
    this.browR = mesh(roundedBoxGeo(R * 0.46, R * 0.1, R * 0.12, R * 0.04), browMat, R * 0.36, R * 0.38, R * 0.86, { parent: this.head, cast: false });
    this.mouth = mesh(sphereGeo(R * 0.22, 14, 10), std(0x4a1212, { roughness: 0.5 }), 0, -R * 0.5, R * 0.87, { parent: this.head, cast: false });
    this.mouth.scale.set(1.2, 0.22, 0.4);
    if (s.cheeks) {
      for (const side of [-1, 1]) {
        const cheek = mesh(sphereGeo(R * 0.22, 12, 10), std(0xff9f94, { roughness: 0.7 }), side * R * 0.55, -R * 0.28, R * 0.7, { parent: this.head, cast: false });
        cheek.scale.set(1, 0.7, 0.45);
        this.cheeks.push(cheek);
      }
    }
    this.headTop.position.set(0, R * 1.9, 0);
    this.head.add(this.headTop);
    this.emitter.position.set(0, -R * 0.55, R * 1.2);
    this.head.add(this.emitter);

    this.buildHair(hair, R);
    this.buildBeard(beard, R);
    this.buildGlasses(R);

    // Arms.
    for (const [sh, el, side, anchor] of [
      [this.shL, this.elL, -1, this.handL],
      [this.shR, this.elR, 1, this.handR],
    ] as const) {
      sh.position.set(side * s.shoulderHalf, tl - 0.04, 0);
      this.torso.add(sh);
      mesh(sphereGeo(s.upperArmR * 1.32, 14, 10), shirt, 0, -0.01, 0, { parent: sh });
      if (s.sleeves === 'rolled') {
        mesh(new THREE.CapsuleGeometry(s.upperArmR * 1.12, s.upperArm * 0.85, 4, 12), shirt, 0, -s.upperArm * 0.5, 0, { parent: sh });
        mesh(new THREE.TorusGeometry(s.upperArmR * 1.12, s.upperArmR * 0.38, 6, 14), shirt, 0, -s.upperArm * 0.96, 0, { rx: Math.PI / 2, parent: sh });
      } else {
        mesh(new THREE.CapsuleGeometry(s.upperArmR * 1.14, s.upperArm * 0.35, 4, 12), shirt, 0, -s.upperArm * 0.25, 0, { parent: sh });
        mesh(new THREE.CapsuleGeometry(s.upperArmR, s.upperArm * 0.7, 4, 12), this.skin, 0, -s.upperArm * 0.55, 0, { parent: sh });
      }
      if (s.muscle > 0) {
        const bicep = mesh(sphereGeo(s.upperArmR * 1.1, 14, 10), this.skin, 0, -s.upperArm * 0.62, s.upperArmR * 0.35, { parent: sh });
        bicep.scale.set(0.95, 1.25, 1);
      }
      el.position.y = -s.upperArm;
      sh.add(el);
      mesh(new THREE.CapsuleGeometry(s.foreArmR, s.foreArm * 0.8, 4, 10), this.skin, 0, -s.foreArm * 0.48, 0, { parent: el });
      if (s.gloves) mesh(cylGeo(s.foreArmR * 1.1, s.foreArmR * 1.3, s.foreArm * 0.35, 12), glove, 0, -s.foreArm * 0.78, 0, { parent: el });
      const palm = mesh(sphereGeo(s.handR, 14, 10), hand, 0, -s.foreArm - s.handR * 0.5, 0.01, { parent: el });
      palm.scale.set(0.9, 1.15, 0.75);
      anchor.position.set(0, -s.foreArm - s.handR, s.handR * 0.6);
      el.add(anchor);
    }
    this.buildProps();

    // Legs.
    for (const [leg, knee, side] of [
      [this.legL, this.knL, -1],
      [this.legR, this.knR, 1],
    ] as const) {
      leg.position.set(side * s.hipHalf, -0.03, 0);
      this.hips.add(leg);
      mesh(new THREE.CapsuleGeometry(s.thighR, s.thigh * 0.75, 4, 12), pants, 0, -s.thigh * 0.48, 0, { parent: leg });
      knee.position.y = -s.thigh;
      leg.add(knee);
      mesh(new THREE.CapsuleGeometry(s.shinR, s.shin * 0.78, 4, 10), s.shorts ? this.skin : pants, 0, -s.shin * 0.48, 0, { parent: knee });
      if (s.shorts) mesh(cylGeo(s.shinR * 1.1, s.shinR * 1.05, 0.06, 10), std(0xffffff, { roughness: 0.9 }), 0, -s.shin + 0.02, 0, { parent: knee });
      const [fw, fh, fl] = s.foot;
      mesh(roundedBoxGeo(fw, fh, fl, Math.min(fw, fh) * 0.4), shoe, 0, -s.shin - fh * 0.35, fl * 0.22, { parent: knee });
      mesh(boxGeo(fw * 1.02, fh * 0.28, fl * 1.01), sole, 0, -s.shin - fh * 0.8, fl * 0.22, { parent: knee });
    }

    this.rest = {
      hipY: this.hipHeight,
      hipPitch: 0,
      hipRoll: 0,
      torsoPitch: 0,
      torsoYaw: 0,
      torsoRoll: 0,
      headPitch: 0,
      headYaw: 0,
      headRoll: 0,
      shLX: 0,
      shLZ: -0.1 - s.muscle * 0.12,
      shRX: 0,
      shRZ: 0.1 + s.muscle * 0.12,
      elL: -0.2,
      elR: -0.2,
      legL: 0,
      legR: 0,
      legLZ: 0,
      legRZ: 0,
      knL: 0,
      knR: 0,
      rootPitch: 0,
      rootLift: 0,
    };
    this.pose = { ...this.rest };

    keepSeparate(this.mouth);
    keepSeparate(this.browL);
    keepSeparate(this.browR);
    for (const c of this.cheeks) keepSeparate(c);
    mergeRig([this.hips, this.torso, this.head, this.shL, this.shR, this.elL, this.elR, this.legL, this.legR, this.knL, this.knR, ...this.eyes]);
  }

  private buildHair(hair: THREE.Material, R: number) {
    const s = this.spec;
    const hs = s.headScale;
    if (s.hairStyle === 'kid') {
      // Short brown kid cut with a soft fringe.
      const cap = mesh(new THREE.SphereGeometry(R * 1.05, 24, 14, 0, Math.PI * 2, 0, Math.PI * 0.52), hair, 0, R * 0.05, -R * 0.06, { parent: this.head });
      cap.scale.set(hs[0], hs[1], hs[2]);
      const fringe = mesh(roundedBoxGeo(R * 1.35, R * 0.26, R * 0.4, R * 0.1), hair, 0, R * 0.62, R * 0.62, { rx: 0.35, parent: this.head });
      void fringe;
      for (const side of [-1, 1]) mesh(roundedBoxGeo(R * 0.22, R * 0.5, R * 0.6, R * 0.08), hair, side * R * 0.9, R * 0.15, -R * 0.15, { parent: this.head });
      mesh(sphereGeo(R * 0.85, 16, 10), hair, 0, R * 0.2, -R * 0.4, { parent: this.head }).scale.set(1.15, 1, 0.9);
    } else if (s.hairStyle === 'textured') {
      // Eddie: short sides, a bit of messy height on top.
      const cap = mesh(new THREE.SphereGeometry(R * 1.04, 24, 14, 0, Math.PI * 2, 0, Math.PI * 0.5), hair, 0, R * 0.08, -R * 0.04, { parent: this.head });
      cap.scale.set(hs[0], hs[1] * 0.95, hs[2]);
      const crown = mesh(sphereGeo(R * 0.92, 18, 12), hair, 0, R * 0.42, -R * 0.02, { parent: this.head });
      crown.scale.set(hs[0] * 1.06, 0.72, hs[2] * 1.06);
      for (let i = 0; i < 11; i += 1) {
        const a = (i / 11) * Math.PI * 2;
        const r = i % 2 ? R * 0.5 : R * 0.28;
        mesh(sphereGeo(R * 0.24, 8, 6), hair, Math.cos(a) * r, R * 0.98 + rand(0, R * 0.1), Math.sin(a) * r + R * 0.1, {
          rx: rand(-0.5, 0.5),
          rz: rand(-0.5, 0.5),
          parent: this.head,
        }).scale.set(1, 0.7, 1.2);
      }
      mesh(roundedBoxGeo(R * 1.1, R * 0.22, R * 0.3, R * 0.1), hair, 0, R * 0.88, R * 0.7, { rx: -0.6, parent: this.head });
    } else {
      // Zach: tight faded sides, slicked-back volume on top.
      const fade = std(new THREE.Color(s.hair).lerp(new THREE.Color(s.skin), 0.35), { roughness: 0.8 });
      const cap = mesh(new THREE.SphereGeometry(R * 1.02, 24, 14, 0, Math.PI * 2, 0, Math.PI * 0.5), fade, 0, R * 0.02, -R * 0.06, { rx: -0.2, parent: this.head });
      cap.scale.set(hs[0], hs[1], hs[2]);
      // Combed-back volume hugging the top of the skull, fuller at the front.
      const top = mesh(sphereGeo(R * 0.98, 22, 14), hair, 0, R * 0.42, -R * 0.1, { rx: 0.12, parent: this.head });
      top.scale.set(hs[0] * 0.92, 0.62, hs[2] * 1.06);
      const quiff = mesh(sphereGeo(R * 0.52, 16, 10), hair, 0, R * 0.82, R * 0.38, { rx: -0.35, parent: this.head });
      quiff.scale.set(1.5, 0.6, 1.0);
    }
  }

  private buildBeard(beard: THREE.Material, R: number) {
    const s = this.spec;
    if (s.beard === 'none') return;
    const thick = s.beard === 'full' ? 1.09 : 1.04;
    // A shell over the lower face; the mouth sits just in front of it.
    const shell = mesh(new THREE.SphereGeometry(R * 0.8 * thick, 20, 12, 0, Math.PI * 2, Math.PI * 0.42, Math.PI * 0.58), beard, 0, -R * 0.38, R * 0.17, {
      parent: this.head,
    });
    shell.scale.set(1.06, 0.92, 1);
    for (const side of [-1, 1]) {
      mesh(roundedBoxGeo(R * 0.18, R * 0.6, R * 0.3, R * 0.06), beard, side * R * 0.86, -R * 0.12, R * 0.05, { parent: this.head });
    }
    const stache = mesh(roundedBoxGeo(R * 0.62, R * (s.beard === 'full' ? 0.16 : 0.12), R * 0.18, R * 0.06), beard, 0, -R * 0.34, R * 0.9, {
      parent: this.head,
    });
    void stache;
    this.mouth.position.z = R * (s.beard === 'full' ? 1.05 : 1.01);
    this.mouth.position.y = -R * 0.52;
  }

  private buildGlasses(R: number) {
    const s = this.spec;
    if (s.glasses === 'none') return;
    const rainbow = s.glasses === 'rainbow';
    const ringR = R * (rainbow ? 0.24 : 0.21);
    const tube = rainbow ? R * 0.055 : R * 0.032;
    const frame = rainbow
      ? new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.3 })
      : new THREE.MeshStandardMaterial({ color: 0xd4af37, metalness: 1, roughness: 0.25 });
    const geo = rainbow ? rainbowRing(ringR, tube) : new THREE.TorusGeometry(ringR, tube, 8, 28);
    const lens = new THREE.MeshPhysicalMaterial({ color: 0xffffff, transparent: true, opacity: 0.12, roughness: 0.05, clearcoat: 1, depthWrite: false });
    for (const side of [-1, 1]) {
      const rim = mesh(geo, frame, side * R * 0.37, R * 0.12, R * 0.98, { parent: this.head, cast: false });
      if (rainbow) keepSeparate(rim);
      mesh(new THREE.CircleGeometry(ringR, 20), lens, side * R * 0.37, R * 0.12, R * 0.975, { parent: this.head, cast: false });
      mesh(cylGeo(tube * 0.6, tube * 0.6, R * 1.0, 6), rainbow ? std(0xff7a1f) : frame, side * R * 0.9, R * 0.14, R * 0.45, {
        rx: Math.PI / 2,
        parent: this.head,
        cast: false,
      });
    }
    mesh(cylGeo(tube * 0.7, tube * 0.7, R * 0.24, 6), rainbow ? std(0xff7a1f) : frame, 0, R * 0.16, R * 1.0, { rz: Math.PI / 2, parent: this.head, cast: false });
  }

  private buildProps() {
    const s = this.spec;
    if (s.prop === 'spray') {
      const bottle = new THREE.Group();
      bottle.position.set(0, -s.foreArm - s.handR * 1.2, s.handR * 0.9);
      bottle.rotation.x = -Math.PI / 2;
      this.elR.add(bottle);
      mesh(cylGeo(0.05, 0.055, 0.2, 14), new THREE.MeshPhysicalMaterial({ color: 0x6ec6ff, roughness: 0.1, transparent: true, opacity: 0.75, clearcoat: 1 }), 0, 0, 0, {
        parent: bottle,
      });
      mesh(roundedBoxGeo(0.06, 0.09, 0.1, 0.02), std(0xf4f4f4, { roughness: 0.4 }), 0, 0.14, 0.02, { parent: bottle });
      mesh(cylGeo(0.012, 0.012, 0.06, 8), std(0xf4f4f4), 0, 0.15, 0.09, { rx: Math.PI / 2, parent: bottle });
      this.emitter.position.set(0, 0.15, 0.13);
      bottle.add(this.emitter);
      mergeRig([bottle]);
    } else if (s.prop === 'sauce') {
      // Squeeze bottle of BBQ sauce (right) and a chicken drumstick (left).
      const bottle = new THREE.Group();
      bottle.position.set(0, -s.foreArm - s.handR * 1.3, s.handR * 0.7);
      bottle.rotation.x = -Math.PI / 2 - 0.3;
      this.elR.add(bottle);
      mesh(cylGeo(0.045, 0.05, 0.2, 14), glossy(0x8e2b14, { roughness: 0.3 }), 0, 0, 0, { parent: bottle });
      mesh(cylGeo(0.02, 0.045, 0.06, 12), std(0xf2c230, { roughness: 0.4 }), 0, 0.13, 0, { parent: bottle });
      mesh(cylGeo(0.006, 0.014, 0.05, 8), std(0xf2c230), 0, 0.18, 0, { parent: bottle });
      this.emitter.position.set(0, 0.21, 0);
      bottle.add(this.emitter);
      const leg = new THREE.Group();
      leg.position.set(0, -s.foreArm - s.handR * 1.1, s.handR * 0.8);
      leg.rotation.x = -0.6;
      this.elL.add(leg);
      mesh(sphereGeo(0.06, 12, 10), std(0x9a4f1c, { roughness: 0.55 }), 0, 0.06, 0, { parent: leg }).scale.set(1, 1.5, 1);
      mesh(cylGeo(0.012, 0.012, 0.07, 6), std(0xf3ead8), 0, -0.04, 0, { parent: leg });
      mergeRig([bottle, leg]);
    }
  }

  /** Called every frame with the current animation, its local time, ground speed and an optional 0..1 amount. */
  animate(dt: number, anim: Anim, animTime: number, speed: number, amount = 0) {
    this.time += dt;
    const t = this.time;
    const H = this.hipHeight;
    const L = this.spec.thigh + this.spec.shin;
    const target: Pose = { ...this.rest };
    let brow = 0.15 + this.rage * 0.35;
    let mouthOpen = 0.25;
    let eyeOpen = 1;
    let damping = 12;
    let cheekPuff = 1;

    const gait = (amp: number, rate: number) => {
      // Short legs take quicker steps.
      this.phase += dt * rate * (0.9 / Math.max(0.4, L));
      const sn = Math.sin(this.phase);
      target.legL = sn * amp;
      target.legR = -sn * amp;
      target.knL = Math.max(0, -Math.cos(this.phase)) * amp * 1.2;
      target.knR = Math.max(0, Math.cos(this.phase)) * amp * 1.2;
      target.shLX = -sn * amp * 0.9;
      target.shRX = sn * amp * 0.9;
      target.elL = -0.3 - amp * 0.5;
      target.elR = -0.3 - amp * 0.5;
      target.hipY = H * (0.98 + Math.abs(Math.cos(this.phase)) * 0.05 * amp);
      target.hipRoll = sn * 0.06;
      target.torsoYaw = -sn * 0.12 * amp;
    };

    switch (anim) {
      case 'idle':
        target.hipY = H * (1 + Math.sin(t * 1.8) * 0.01);
        target.headYaw = Math.sin(t * 0.7) * 0.3;
        break;
      case 'walk':
        gait(0.55, 4 + speed * 2.4);
        break;
      case 'run':
        gait(0.95, 5 + speed * 2.2);
        target.torsoPitch = 0.22;
        target.shLZ = this.rest.shLZ - 0.25;
        target.shRZ = this.rest.shRZ + 0.25;
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
        target.hipY = H * 0.58;
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
        target.hipY = H * (0.58 + k * 0.42);
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
        target.hipY = H * (1 + Math.max(0, Math.sin(animTime * 9)) * 0.12 * (animTime < 0.35 ? 1 : 0));
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
      case 'yell':
        target.torsoPitch = -0.15 + Math.sin(animTime * 30) * 0.03;
        target.headPitch = -0.2;
        target.shLX = -0.4;
        target.shRX = -0.4;
        target.shLZ = -1.0;
        target.shRZ = 1.0;
        target.elL = -1.4;
        target.elR = -1.4;
        brow = 1;
        mouthOpen = 2.4;
        eyeOpen = 1.3;
        damping = 20;
        break;
      case 'windup':
        target.hipY = H * 0.86;
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
        target.hipY = H * 0.86;
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
        target.hipY = H * 0.9;
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
        target.hipY = H * (1 - 0.52 * k);
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
        target.hipY = H * 0.48;
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
        if (animTime < 0.45) {
          const k = animTime / 0.45;
          target.rootPitch = -1.45 * k;
          target.rootLift = Math.sin(k * Math.PI) * 0.7 * (H / 0.95);
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
          target.rootLift = 0.18 * (H / 0.95);
          target.hipY = H * 0.42;
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
          target.hipY = H * 0.74;
          target.torsoPitch = 0.4;
          target.knL = 0.6;
          target.knR = 0.6;
          brow = 0.5;
          damping = 8;
        }
        break;
      }
      case 'lift':
        target.shLZ = -0.12;
        target.shRZ = 0.12;
        target.shLX = -1.45 + Math.sin(animTime * 9) * 0.06;
        target.shRX = -1.45 - Math.sin(animTime * 9) * 0.06;
        target.elL = -0.15;
        target.elR = -0.15;
        target.torsoPitch = -0.2;
        target.headPitch = 0.05;
        target.hipY = H * (1 + Math.abs(Math.sin(animTime * 8)) * 0.04);
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
      case 'charge': {
        const c = amount;
        if (speed > 0.2) gait(0.3, 4);
        target.torsoPitch = -0.3 * c;
        target.hipY = H * (1 + Math.sin(t * 60) * 0.008 * c);
        target.torsoRoll = Math.sin(t * 47) * 0.05 * c;
        target.shLZ = -0.6 - c * 0.6;
        target.shLX = -0.4;
        if (this.spec.prop === 'sauce') {
          // Rear back with the sauce bottle.
          target.shRX = 0.6 + c * 1.2;
          target.shRZ = 0.4;
          target.elR = -1.2;
          brow = 0.9;
          mouthOpen = 0.4;
        } else {
          target.shRZ = 0.6 + c * 0.6;
          target.shRX = -0.4;
          target.headPitch = -0.2 * c;
          cheekPuff = 1 + c * 1.1;
          eyeOpen = 1 - c * 0.6;
          mouthOpen = 0.2;
        }
        damping = 16;
        break;
      }
      case 'hurl':
        target.torsoPitch = 0.45;
        target.headPitch = 0.35;
        target.shLZ = -1.1;
        target.shRZ = 1.1;
        target.shLX = 0.4;
        target.shRX = 0.4;
        mouthOpen = 3.2;
        cheekPuff = 1.3;
        eyeOpen = 0.3;
        damping = 18;
        break;
      case 'throw': {
        // Overhand nugget fling.
        const k = clamp(animTime / 0.35, 0, 1);
        target.torsoPitch = -0.2 + k * 0.55;
        target.torsoYaw = 0.4 - k * 0.8;
        target.shRX = -2.6 + k * 2.2;
        target.shRZ = 0.3;
        target.elR = -1.4 + k * 1.3;
        target.shLX = -0.6;
        mouthOpen = 1.2;
        brow = 0.6;
        damping = 24;
        break;
      }
      case 'squeeze':
        target.torsoPitch = 0.2 + Math.sin(animTime * 30) * 0.03;
        target.shRX = -1.5 + Math.sin(animTime * 34) * 0.12;
        target.shRZ = 0.15;
        target.elR = -0.15;
        target.shLX = -1.2;
        target.shLZ = -0.2;
        target.elL = -1.0;
        target.legL = -0.35;
        target.legR = 0.25;
        target.knL = 0.4;
        mouthOpen = 1.4;
        brow = 1;
        damping = 22;
        break;
      case 'eat': {
        if (speed > 0.2) gait(0.5, 4 + speed * 2);
        const bite = Math.abs(Math.sin(animTime * 7));
        target.shLX = -1.6 - bite * 0.3;
        target.shLZ = -0.2;
        target.elL = -2.2;
        mouthOpen = 0.3 + bite * 1.4;
        brow = -0.2;
        break;
      }
      case 'flex':
        target.shLZ = -1.6;
        target.shRZ = 1.6;
        target.shLX = -0.2;
        target.shRX = -0.2;
        target.elL = -2.3;
        target.elR = -2.3;
        target.torsoPitch = -0.15;
        target.hipY = H * (1 + Math.abs(Math.sin(animTime * 10)) * 0.03);
        target.headPitch = -0.15;
        brow = 0.8;
        mouthOpen = 1.6;
        damping = 20;
        break;
      case 'clench': {
        // Emergency waddle: knees together, tiny urgent steps, hand on stomach.
        this.phase += dt * (8 + speed * 3);
        const sn = Math.sin(this.phase);
        target.legL = sn * 0.25;
        target.legR = -sn * 0.25;
        target.legLZ = 0.12;
        target.legRZ = -0.12;
        target.knL = 0.25 + Math.max(0, -Math.cos(this.phase)) * 0.2;
        target.knR = 0.25 + Math.max(0, Math.cos(this.phase)) * 0.2;
        target.hipY = H * 0.95;
        target.torsoPitch = 0.25;
        target.hipRoll = sn * 0.08;
        target.shLX = -0.9;
        target.elL = -1.6;
        target.shLZ = -0.1;
        target.shRX = 0.5;
        target.shRZ = 0.3;
        target.elR = -0.4;
        brow = -0.6;
        eyeOpen = 1.3;
        mouthOpen = 0.6 + Math.sin(t * 20) * 0.2;
        break;
      }
      case 'sit':
        target.hipY = H * 0.6;
        target.legL = -1.45;
        target.legR = -1.45;
        target.knL = 1.5;
        target.knR = 1.5;
        target.legLZ = 0.15;
        target.legRZ = -0.15;
        target.torsoPitch = 0.2 + (amount > 0 ? Math.sin(t * 25) * 0.04 : 0);
        target.shLX = -0.9;
        target.shRX = -0.9;
        target.elL = -1.0;
        target.elR = -1.0;
        brow = amount > 0 ? -0.7 : 0.1;
        eyeOpen = amount > 0 ? 0.2 : 1;
        mouthOpen = amount > 0 ? 0.9 : 0.4;
        break;
      case 'crawl':
        gait(0.4, 3 + speed * 2);
        target.torsoPitch = 1.15;
        target.hipY = H * 0.62;
        target.headPitch = -0.95;
        target.shLX = -1.6 + target.shLX * 0.5;
        target.shRX = -1.6 + target.shRX * 0.5;
        target.legL = -1.2 + target.legL * 0.5;
        target.legR = -1.2 + target.legR * 0.5;
        target.knL = 1.6;
        target.knR = 1.6;
        break;
      case 'carried':
        target.legL = Math.sin(t * 22) * 0.9;
        target.legR = -Math.sin(t * 22) * 0.9;
        target.shLZ = -2.4 + Math.sin(t * 18) * 0.3;
        target.shRZ = 2.4 - Math.sin(t * 18) * 0.3;
        mouthOpen = 1.6;
        brow = -0.5;
        break;
      case 'celebrate':
        target.hipY = H * (1 + Math.abs(Math.sin(t * 9)) * 0.18);
        target.shLZ = -2.6;
        target.shRZ = 2.6;
        target.knL = Math.abs(Math.sin(t * 9)) * 0.6;
        target.knR = target.knL;
        mouthOpen = 1.5;
        brow = 0.2;
        break;
      case 'sulk':
        target.shLX = -1.0;
        target.shRX = -1.0;
        target.shLZ = 0.35;
        target.shRZ = -0.35;
        target.elL = -1.9;
        target.elR = -1.9;
        target.headPitch = 0.4;
        target.torsoPitch = 0.1;
        brow = -0.5;
        mouthOpen = 0.15;
        break;
    }

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
    this.legL.rotation.set(p.legL, 0, p.legLZ);
    this.legR.rotation.set(p.legR, 0, p.legRZ);
    this.knL.rotation.x = p.knL;
    this.knR.rotation.x = p.knR;

    if (this.talking > 0) mouthOpen = Math.max(mouthOpen, 0.4 + Math.abs(Math.sin(t * 22)) * 1.3 * this.talking);
    this.mouth.scale.y = damp(this.mouth.scale.y, 0.22 * mouthOpen, 20, dt);
    this.browL.rotation.z = damp(this.browL.rotation.z, -brow * 0.5, 14, dt);
    this.browR.rotation.z = damp(this.browR.rotation.z, brow * 0.5, 14, dt);
    for (const cheek of this.cheeks) {
      const sc = damp(cheek.scale.x, cheekPuff, 14, dt);
      cheek.scale.set(sc, 0.7 * sc, 0.45 * sc);
    }

    this.nextBlink -= dt;
    if (this.nextBlink <= 0) {
      this.blink = 0.12;
      this.nextBlink = rand(2.5, 5);
    }
    if (this.blink > 0) this.blink -= dt;
    const ey = (this.blink > 0 && eyeOpen > 0.5 ? 0.1 : 1) * eyeOpen;
    for (const e of this.eyes) e.scale.y = damp(e.scale.y, ey, 25, dt);

    this.skin.color
      .copy(this.skinColor)
      .lerp(RAGE, clamp(this.rage, 0, 1) * 0.55)
      .lerp(GREEN, clamp(Math.max(this.slimed * 0.8, this.queasy * 0.6), 0, 1))
      .lerp(PALE, clamp(this.pale, 0, 1) * 0.5);
  }

  setVisible(visible: boolean) {
    this.root.visible = visible;
  }
}

function boxGeo(w: number, h: number, d: number) {
  return new THREE.BoxGeometry(w, h, d);
}
