import * as THREE from 'three';
import type { RigSpec } from './rig';
import { std } from '../world/kit';
import { ginghamTexture, kidTeeTexture, waffleTexture } from '../world/textures';

export type Role = 'theo' | 'zach' | 'eddie';
export type MesserId = 'theo' | 'zach';

/** Theo: four years old, rainbow glasses, short brown hair, white dino tee. */
export const THEO_SPEC: RigSpec = {
  id: 'theo',
  thigh: 0.2,
  shin: 0.19,
  hipHalf: 0.065,
  pelvis: [0.2, 0.12, 0.14],
  torsoLen: 0.28,
  waistW: 0.2,
  chest: [0.23, 0.16, 0.15],
  shoulderHalf: 0.115,
  upperArm: 0.14,
  foreArm: 0.13,
  upperArmR: 0.03,
  foreArmR: 0.026,
  handR: 0.032,
  thighR: 0.046,
  shinR: 0.037,
  neckLen: 0.04,
  neckR: 0.035,
  headR: 0.12,
  headScale: [1, 1.05, 1.02],
  foot: [0.075, 0.06, 0.15],
  muscle: 0,
  belly: 0.08,
  eyeScale: 1.25,
  skin: '#eab896',
  hair: '#6b4226',
  hairStyle: 'kid',
  beard: 'none',
  beardColor: '#6b4226',
  iris: '#5a3b22',
  glasses: 'rainbow',
  shirt: () => std(0xf7f7f2, { roughness: 0.85 }),
  chestPrint: kidTeeTexture,
  sleeves: 'short',
  collar: 'crew',
  pants: '#3b6ea5',
  shorts: true,
  shoe: '#e74c3c',
  sole: '#ffffff',
  gloves: false,
  prop: 'none',
  cheeks: true,
};

/** Zach: shorter, very buff, slicked-back hair, full beard, cream waffle-knit shirt. Always has a drumstick. */
export const ZACH_SPEC: RigSpec = {
  id: 'zach',
  thigh: 0.36,
  shin: 0.35,
  hipHalf: 0.11,
  pelvis: [0.36, 0.2, 0.24],
  torsoLen: 0.47,
  waistW: 0.36,
  chest: [0.52, 0.3, 0.3],
  shoulderHalf: 0.3,
  upperArm: 0.27,
  foreArm: 0.25,
  upperArmR: 0.068,
  foreArmR: 0.054,
  handR: 0.055,
  thighR: 0.088,
  shinR: 0.066,
  neckLen: 0.07,
  neckR: 0.075,
  headR: 0.135,
  headScale: [0.96, 1.08, 1.0],
  foot: [0.11, 0.08, 0.27],
  muscle: 1,
  belly: 0,
  eyeScale: 1,
  skin: '#a86f48',
  hair: '#15100d',
  hairStyle: 'slick',
  beard: 'full',
  beardColor: '#17110e',
  iris: '#2b1a10',
  glasses: 'none',
  shirt: () => std(0xffffff, { map: waffleTexture(), roughness: 0.9 }),
  sleeves: 'short',
  collar: 'open',
  pants: '#3a3f4a',
  shorts: false,
  shoe: '#f2f2f2',
  sole: '#cfcfcf',
  gloves: false,
  prop: 'sauce',
  cheeks: false,
};

/** Eddie: tall, round gold glasses, textured hair, short beard, navy gingham. Big house. Many couches. */
export const EDDIE_SPEC: RigSpec = {
  id: 'eddie',
  thigh: 0.42,
  shin: 0.41,
  hipHalf: 0.1,
  pelvis: [0.34, 0.2, 0.24],
  torsoLen: 0.5,
  waistW: 0.34,
  chest: [0.44, 0.28, 0.26],
  shoulderHalf: 0.24,
  upperArm: 0.3,
  foreArm: 0.28,
  upperArmR: 0.05,
  foreArmR: 0.042,
  handR: 0.05,
  thighR: 0.075,
  shinR: 0.06,
  neckLen: 0.08,
  neckR: 0.055,
  headR: 0.14,
  headScale: [0.96, 1.1, 1.0],
  foot: [0.1, 0.085, 0.29],
  muscle: 0,
  belly: 0.08,
  eyeScale: 1,
  skin: '#b07a52',
  hair: '#1d1612',
  hairStyle: 'textured',
  beard: 'short',
  beardColor: '#211813',
  iris: '#3a2416',
  glasses: 'gold',
  shirt: () => std(0xffffff, { map: ginghamTexture(), roughness: 0.8 }),
  sleeves: 'rolled',
  collar: 'button',
  pants: '#bfa77a',
  shorts: false,
  shoe: '#5a3b25',
  sole: '#2a1d14',
  gloves: true,
  prop: 'spray',
  cheeks: false,
};

export const SPECS: Record<Role, RigSpec> = { theo: THEO_SPEC, zach: ZACH_SPEC, eddie: EDDIE_SPEC };

export interface RoleInfo {
  name: string;
  tagline: string;
  blurb: string;
  action: string;
  secondary: string;
  color: string;
  voice: { pitch: number; speed?: number };
}

export const ROLES: Record<Role, RoleInfo> = {
  theo: {
    name: 'Theo',
    tagline: 'Age 4. Rainbow glasses. Weak stomach.',
    blurb: 'Hurl on every seat. Hold to charge a MEGA HURL. Small enough to hide under the table and the bed.',
    action: 'Hurl',
    secondary: 'Toy',
    color: '#8fd3ff',
    voice: { pitch: 360, speed: 1.3 },
  },
  zach: {
    name: 'Zach',
    tagline: 'Short. Swole. Never without a drumstick.',
    blurb: 'Fling saucy nuggets and leave crumbs everywhere. Eat enough and your gut becomes a power-up: hold to unleash it, then race to a bidet. Flexes out of one grab per life.',
    action: 'Fling',
    secondary: 'Toy',
    color: '#ffb347',
    voice: { pitch: 150, speed: 1.05 },
  },
  eddie: {
    name: 'Eddie',
    tagline: 'Big house. Nine couches. One spray bottle.',
    blurb: 'Keep the house clean until bedtime. Grab the mess-makers, scrub the stains, and YELL.',
    action: 'Grab',
    secondary: 'Yell',
    color: '#ff6b5e',
    voice: { pitch: 118 },
  },
};

/** Where the mess-makers start, and where they get sent to think about what they did. */
export function timeoutSeat(id: MesserId) {
  return id === 'theo' ? new THREE.Vector3(-1.1, 0, 8.3) : new THREE.Vector3(0.1, 0, 8.3);
}
