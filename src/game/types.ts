import type * as THREE from 'three';
import type { CouchDef } from '../world/layout';

export interface CouchState {
  def: CouchDef;
  seats: Seat[];
  ruined: boolean;
  center: THREE.Vector3;
  vibrator?: THREE.Object3D;
  ruinedAt: number;
}

export interface Seat {
  id: string;
  index: number;
  couch: CouchState;
  cushion: THREE.Mesh;
  material: THREE.MeshStandardMaterial;
  baseColor: THREE.Color;
  plastic: THREE.Mesh | null;
  top: THREE.Vector3;
  front: THREE.Vector3;
  facing: number;
  puked: boolean;
  /** Eddie is napping on it. */
  occupied: boolean;
  decals: THREE.Mesh[];
}

export interface Puddle {
  position: THREE.Vector3;
  radius: number;
  active: boolean;
  mesh: THREE.Mesh;
  age: number;
  fade: number;
}

export type Mood = 'angry' | 'calm' | 'sad' | 'sleepy' | 'shout';
