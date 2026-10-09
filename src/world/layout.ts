import type { DogStyle, WallpaperKind } from './textures';

export const HOUSE = {
  minX: -13,
  maxX: 13,
  minZ: -9,
  maxZ: 9,
  wallHeight: 2.4,
  wallThickness: 0.24,
};

export type FloorKind = 'wood' | 'tile' | 'carpetDen' | 'carpetBed';

export interface RoomDef {
  id: string;
  name: string;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  floor: FloorKind;
  wall: WallpaperKind;
}

export const ROOMS: RoomDef[] = [
  { id: 'kitchen', name: 'Kitchen', minX: -13, maxX: -3, minZ: -9, maxZ: 0.5, floor: 'tile', wall: 'kitchen' },
  { id: 'den', name: 'The Den', minX: -13, maxX: -3, minZ: 0.5, maxZ: 9, floor: 'carpetDen', wall: 'den' },
  { id: 'hall', name: 'Hall of Dogs', minX: -3, maxX: 2, minZ: -9, maxZ: 9, floor: 'wood', wall: 'hall' },
  { id: 'living', name: 'Living Room', minX: 2, maxX: 13, minZ: -9, maxZ: 1, floor: 'wood', wall: 'living' },
  { id: 'bedroom', name: 'Bedroom', minX: 2, maxX: 13, minZ: 1, maxZ: 9, floor: 'carpetBed', wall: 'bedroom' },
];

export function roomAt(x: number, z: number): RoomDef | undefined {
  return ROOMS.find((r) => x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ);
}

export interface WallDef {
  /** 'x' = wall runs along X at z = at. 'z' = wall runs along Z at x = at. */
  axis: 'x' | 'z';
  at: number;
  from: number;
  to: number;
  doors?: [number, number][];
  exterior?: boolean;
}

export const WALLS: WallDef[] = [
  { axis: 'x', at: -9, from: -13.12, to: 13.12, exterior: true },
  { axis: 'x', at: 9, from: -13.12, to: 13.12, exterior: true },
  { axis: 'z', at: -13, from: -9, to: 9, exterior: true },
  { axis: 'z', at: 13, from: -9, to: 9, exterior: true },
  { axis: 'z', at: -3, from: -8.88, to: 8.88, doors: [[-5.6, -3.8], [3.6, 5.4]] },
  { axis: 'z', at: 2, from: -8.88, to: 8.88, doors: [[-3.4, -1.6], [4.4, 6.2]] },
  { axis: 'x', at: 0.5, from: -12.88, to: -3.12, doors: [[-9.4, -7.6]] },
  { axis: 'x', at: 1, from: 2.12, to: 12.88, doors: [[6.6, 8.4]] },
];

export interface WindowDef {
  side: 'north' | 'south' | 'west' | 'east';
  center: number;
  width: number;
  curtains?: string;
}

export const WINDOWS: WindowDef[] = [
  { side: 'north', center: -8.6, width: 1.6 },
  { side: 'north', center: 4.0, width: 1.5, curtains: '#c0392b' },
  { side: 'north', center: 11.4, width: 1.5, curtains: '#c0392b' },
  { side: 'south', center: -10.6, width: 1.5, curtains: '#6c3483' },
  { side: 'south', center: 10.8, width: 1.5, curtains: '#2e86c1' },
  { side: 'south', center: -0.5, width: 1.2 },
  { side: 'west', center: -7.3, width: 1.1 },
  { side: 'west', center: 7.6, width: 1.3, curtains: '#6c3483' },
  { side: 'east', center: -5.0, width: 1.5, curtains: '#c0392b' },
  { side: 'east', center: 2.6, width: 1.2, curtains: '#2e86c1' },
];

export type CouchStyle =
  | 'sectional'
  | 'recliner'
  | 'loveseat'
  | 'futon'
  | 'plastic'
  | 'white'
  | 'massage'
  | 'chesterfield'
  | 'beanbag';

export interface CouchSegment {
  x: number;
  z: number;
  /** Yaw the couch faces: 0 = +Z (south), PI = -Z (north). */
  rot: number;
  seats: number;
}

export interface CouchDef {
  id: string;
  name: string;
  flavor: string;
  style: CouchStyle;
  color: string;
  segments: CouchSegment[];
  bonus: number;
  /** Eddie's breakdown when this couch is ruined. */
  mourn: string;
}

const N = Math.PI;
const E = Math.PI / 2;
const W = -Math.PI / 2;
const S = 0;

export const COUCHES: CouchDef[] = [
  {
    id: 'sectional',
    name: 'The Sectional',
    flavor: 'Seven cupholders. Zero self-control.',
    style: 'sectional',
    color: '#3f6f8f',
    segments: [
      { x: 7.6, z: -3.1, rot: N, seats: 3 },
      { x: 9.88, z: -4.78, rot: W, seats: 2 },
    ],
    bonus: 600,
    mourn: 'MY SECTIONAL! It had SEVEN CUPHOLDERS!',
  },
  {
    id: 'recliner',
    name: "Eddie's Throne",
    flavor: "He's napped here four thousand times.",
    style: 'recliner',
    color: '#8a5a32',
    segments: [{ x: 3.75, z: -6.55, rot: 2.05, seats: 1 }],
    bonus: 400,
    mourn: 'MY THRONE! Where will I nap now?!',
  },
  {
    id: 'loveseat',
    name: 'The Unloved Loveseat',
    flavor: 'Never sat on. Until now. Sort of.',
    style: 'loveseat',
    color: '#b05a7a',
    segments: [{ x: 4.45, z: 0.3, rot: N, seats: 2 }],
    bonus: 300,
    mourn: 'It was never loved... and now it never will be.',
  },
  {
    id: 'futon',
    name: 'The Futon of Regret',
    flavor: 'Folds out into a mistake.',
    style: 'futon',
    color: '#5d7a3a',
    segments: [{ x: -12.3, z: 4.6, rot: E, seats: 3 }],
    bonus: 300,
    mourn: '...Honestly I hated that futon. But STILL!',
  },
  {
    id: 'plastic',
    name: "Grandma's Plastic Loveseat",
    flavor: 'Shrink-wrapped since 1983. Two hurls per seat.',
    style: 'plastic',
    color: '#d98fa8',
    segments: [{ x: -7.0, z: 8.32, rot: N, seats: 2 }],
    bonus: 500,
    mourn: 'Abuela kept that plastic on for FORTY YEARS!',
  },
  {
    id: 'white',
    name: 'THE WHITE COUCH',
    flavor: 'Nobody sits on the white couch.',
    style: 'white',
    color: '#f3efe6',
    segments: [{ x: 6.5, z: 8.32, rot: N, seats: 3 }],
    bonus: 1000,
    mourn: 'NOT THE WHITE COUCH!! NOBODY SITS ON THE WHITE COUCH!!',
  },
  {
    id: 'massage',
    name: 'Massage Chair 3000',
    flavor: 'Vibrates. Now with extra splash.',
    style: 'massage',
    color: '#242424',
    segments: [{ x: 12.1, z: 1.95, rot: -Math.PI * 0.75, seats: 1 }],
    bonus: 400,
    mourn: 'That chair cost more than my CAR!',
  },
  {
    id: 'chesterfield',
    name: 'The Chesterfield of Judgment',
    flavor: 'The dogs are watching.',
    style: 'chesterfield',
    color: '#6b3a22',
    segments: [{ x: -0.5, z: -8.32, rot: S, seats: 3 }],
    bonus: 500,
    mourn: 'The dogs... the dogs SAW it!',
  },
  {
    id: 'beanbag',
    name: 'The Kitchen Beanbag',
    flavor: "Nobody knows why it's in the kitchen.",
    style: 'beanbag',
    color: '#d6452f',
    segments: [{ x: -4.5, z: -0.9, rot: W, seats: 1 }],
    bonus: 300,
    mourn: 'It was a beanbag. Now it is a bean-BARF.',
  },
];

export const TOTAL_SEATS = COUCHES.reduce((sum, c) => sum + c.segments.reduce((s, seg) => s + seg.seats, 0), 0);

export const THEO_SPAWN = { x: -0.5, z: 7.3 };
export const EDDIE_BED = { x: 3.75, z: -6.55 };

export const PATROL_POINTS: [number, number][] = [
  [5.0, -4.6],
  [11.2, -1.2],
  [11.4, -7.0],
  [4.6, -1.6],
  [-6.2, -6.4],
  [-10.6, -2.4],
  [-5.6, -1.8],
  [-7.6, 3.0],
  [-6.0, 6.6],
  [-10.2, 7.2],
  [-0.5, -5.0],
  [-0.5, 0.0],
  [-0.5, 4.8],
  [4.8, 4.2],
  [8.6, 2.6],
  [8.4, 6.4],
];

export const BUN_SPOTS: [number, number][] = [
  [-6.9, -6.7],
  [-10.6, -6.6],
  [-6.4, 3.0],
  [-10.2, 7.4],
  [0.9, -4.8],
  [-1.7, 2.6],
  [11.7, -3.4],
  [4.4, -3.6],
  [4.2, 5.6],
  [9.2, 2.6],
];

export const JUICE_SPOTS: [number, number][] = [
  [-1.8, -1.2],
  [11.9, 7.9],
  [-11.6, 1.6],
];

export const TOY_SPOTS: [number, number][] = [
  [3.1, 7.7],
  [-9.6, 6.6],
];

export const TRASH_CANS: [number, number][] = [
  [-5.15, -8.35],
  [-12.35, -0.25],
  [12.4, -2.3],
  [-3.65, 1.3],
  [2.55, 3.1],
];

export const MICROWAVE = { x: -6.3, z: -8.55, drop: { x: -6.3, z: -7.25 } };

export const PORTRAITS: (DogStyle & { wall: 'hallWest' | 'hallEast'; z: number })[] = [
  { wall: 'hallWest', z: -7.0, name: 'SIR BARKSALOT', fur: '#c58a4a', ear: 'floppy', outfit: 'military', bg: '#6b3b2a' },
  { wall: 'hallWest', z: -1.9, name: 'LADY BISCUIT', fur: '#f1d6a0', ear: 'fluffy', outfit: 'pearls', bg: '#3b4e6b' },
  { wall: 'hallWest', z: 1.5, name: 'DUKE OF DROOL', fur: '#8a5a3a', ear: 'floppy', outfit: 'ruff', bg: '#4b5e3a' },
  { wall: 'hallWest', z: 7.2, name: 'GENERAL WAGS', fur: '#2e2622', ear: 'pointy', outfit: 'military', bg: '#6b2a2a', spot: '#d8c4a0' },
  { wall: 'hallEast', z: -6.3, name: 'PRINCESS NOODLE', fur: '#fff4e0', ear: 'fluffy', outfit: 'crown', bg: '#5b3b6b' },
  { wall: 'hallEast', z: -0.2, name: 'MR. PANCAKES', fur: '#d9a066', ear: 'floppy', outfit: 'bowtie', bg: '#2a4b5b' },
  { wall: 'hallEast', z: 2.8, name: 'BEANS, ESQ.', fur: '#6b4a2e', ear: 'pointy', outfit: 'monocle', bg: '#3a3a2a' },
  { wall: 'hallEast', z: 7.6, name: 'BISCUIT (R.I.P.)', fur: '#c98f52', ear: 'floppy', outfit: 'halo', bg: '#4a3a6b', memorial: true },
];
