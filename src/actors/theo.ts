import * as THREE from 'three';
import { boxGeo, mesh, roundedBoxGeo, sphereGeo, std } from '../world/kit';
import { bibTexture, onesieTexture } from '../world/textures';
import { clamp, damp, rand } from '../core/util';
import { keepSeparate, mergeRig } from '../world/batch';

const SKIN = new THREE.Color(0xf6c39b);
const QUEASY = new THREE.Color(0x9fd86a);

export interface TheoAnimState {
  speed: number;
  sprinting: boolean;
  charge: number;
  puking: number;
  crawling: boolean;
  carried: boolean;
  dizzy: boolean;
  happy: number;
}

/** Theo, age 2. Big head, tiny legs, iron stomach (eventually). */
export class TheoModel {
  readonly root = new THREE.Group();
  private readonly body = new THREE.Group();
  private readonly head = new THREE.Group();
  private readonly armL = new THREE.Group();
  private readonly armR = new THREE.Group();
  private readonly legL = new THREE.Group();
  private readonly legR = new THREE.Group();
  private readonly cheeks: THREE.Mesh[] = [];
  private readonly eyes: THREE.Group[] = [];
  private readonly mouth: THREE.Mesh;
  private readonly skin: THREE.MeshStandardMaterial;
  private phase = 0;
  private blink = 0;
  private nextBlink = 2;
  private lookYaw = 0;
  private lookTimer = 0;
  private time = 0;
  readonly mouthAnchor = new THREE.Object3D();

  constructor() {
    this.skin = std(SKIN, { roughness: 0.55 });
    this.skin.emissive.set(0x3a1408);
    this.skin.emissiveIntensity = 0.12;
    const onesie = std(0xffffff, { map: onesieTexture(), roughness: 0.75 });
    const diaper = std(0xfdfcf7, { roughness: 0.6 });
    const hair = std(0x7a4a26, { roughness: 0.7 });
    const dark = std(0x1d1410, { roughness: 0.3 });
    const white = std(0xffffff, { roughness: 0.25 });
    const pink = std(0xff8f8f, { roughness: 0.7 });

    this.root.add(this.body);
    this.body.position.y = 0.3;

    // Torso + diaper.
    const torso = mesh(sphereGeo(0.22, 20, 16), onesie, 0, 0.17, 0, { parent: this.body });
    torso.scale.set(1, 1.08, 0.88);
    const diaperMesh = mesh(sphereGeo(0.2, 20, 14), diaper, 0, 0.01, -0.01, { parent: this.body });
    diaperMesh.scale.set(1.12, 0.78, 1.05);
    const bib = mesh(new THREE.CircleGeometry(0.13, 24), std(0xffffff, { map: bibTexture(), roughness: 0.8 }), 0, 0.2, 0.19, {
      rx: -0.18,
      parent: this.body,
      cast: false,
    });
    bib.scale.set(1, 1.05, 1);

    // Head.
    this.head.position.set(0, 0.5, 0.02);
    this.body.add(this.head);
    mesh(sphereGeo(0.26, 28, 22), this.skin, 0, 0, 0, { parent: this.head });
    for (const side of [-1, 1]) mesh(sphereGeo(0.055, 12, 10), this.skin, side * 0.255, -0.01, 0, { parent: this.head });
    const curl = mesh(new THREE.TorusGeometry(0.05, 0.022, 8, 16, Math.PI * 1.6), hair, 0.02, 0.27, 0.02, { ry: 0.4, parent: this.head });
    curl.rotation.x = 0.3;
    for (let i = 0; i < 7; i += 1) {
      const a = (i / 7) * Math.PI * 2;
      mesh(sphereGeo(0.07, 10, 8), hair, Math.cos(a) * 0.14, 0.2, Math.sin(a) * 0.14 - 0.04, { parent: this.head });
    }
    mesh(sphereGeo(0.17, 16, 10), hair, 0, 0.13, -0.08, { parent: this.head }).scale.set(1.35, 0.8, 1.2);

    for (const side of [-1, 1]) {
      const eye = new THREE.Group();
      eye.position.set(side * 0.095, 0.03, 0.215);
      this.head.add(eye);
      const sclera = mesh(sphereGeo(0.058, 16, 12), white, 0, 0, 0, { parent: eye, cast: false });
      sclera.scale.z = 0.55;
      mesh(sphereGeo(0.036, 12, 10), dark, 0, -0.004, 0.024, { parent: eye, cast: false }).scale.z = 0.5;
      mesh(sphereGeo(0.012, 8, 6), white, 0.012, 0.014, 0.042, { parent: eye, cast: false });
      this.eyes.push(eye);
      const cheek = mesh(sphereGeo(0.062, 12, 10), pink, side * 0.155, -0.075, 0.17, { parent: this.head, cast: false });
      cheek.scale.set(1, 0.7, 0.5);
      this.cheeks.push(cheek);
    }
    mesh(sphereGeo(0.03, 10, 8), this.skin, 0, -0.03, 0.255, { parent: this.head, cast: false });
    this.mouth = mesh(sphereGeo(0.045, 14, 10), std(0x5a1a1a, { roughness: 0.5 }), 0, -0.115, 0.225, { parent: this.head, cast: false });
    this.mouth.scale.set(1, 0.35, 0.4);
    this.mouthAnchor.position.set(0, -0.12, 0.3);
    this.head.add(this.mouthAnchor);

    // Arms (pivot at shoulder).
    for (const [group, side] of [
      [this.armL, -1],
      [this.armR, 1],
    ] as const) {
      group.position.set(side * 0.21, 0.27, 0);
      this.body.add(group);
      const arm = mesh(new THREE.CapsuleGeometry(0.052, 0.14, 4, 10), onesie, 0, -0.1, 0, { parent: group });
      void arm;
      mesh(sphereGeo(0.058, 12, 10), this.skin, 0, -0.21, 0.01, { parent: group });
    }
    // Legs (pivot at hip, in root space).
    for (const [group, side] of [
      [this.legL, -1],
      [this.legR, 1],
    ] as const) {
      group.position.set(side * 0.095, 0.24, 0);
      this.root.add(group);
      mesh(new THREE.CapsuleGeometry(0.062, 0.1, 4, 10), this.skin, 0, -0.1, 0, { parent: group });
      mesh(roundedBoxGeo(0.12, 0.07, 0.17, 0.03), this.skin, 0, -0.205, 0.035, { parent: group });
    }
    mesh(boxGeo(0.001, 0.001, 0.001), dark, 0, 0, 0, { parent: this.root, cast: false });

    this.root.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = true;
    });
    keepSeparate(this.mouth);
    for (const cheek of this.cheeks) keepSeparate(cheek);
    mergeRig([this.root, this.body, this.head, this.armL, this.armR, this.legL, this.legR, ...this.eyes]);
  }

  animate(dt: number, s: TheoAnimState) {
    this.time += dt;
    const t = this.time;
    const moving = s.speed > 0.2;
    const sprint = s.sprinting && moving;

    // Gait.
    this.phase += dt * (moving ? 5 + s.speed * 3.2 : 0);
    const swing = moving ? clamp(s.speed / 3, 0.4, 1.4) : 0;
    const sinP = Math.sin(this.phase);
    let legL = sinP * 0.75 * swing;
    let legR = -sinP * 0.75 * swing;
    let armLX = -sinP * 0.6 * swing;
    let armRX = sinP * 0.6 * swing;
    let armLZ = -0.25 - (sprint ? 0.9 : 0);
    let armRZ = 0.25 + (sprint ? 0.9 : 0);
    let bodyY = 0.3 + Math.abs(Math.cos(this.phase)) * 0.045 * swing + (moving ? 0 : Math.sin(t * 2.2) * 0.008);
    let bodyRoll = sinP * 0.14 * swing;
    let bodyPitch = moving ? 0.08 + (sprint ? 0.15 : 0) : 0;
    let headPitch = 0;
    let headYaw = 0;

    // Idle glance around.
    this.lookTimer -= dt;
    if (this.lookTimer <= 0) {
      this.lookTimer = rand(1.5, 3.5);
      this.lookYaw = moving ? 0 : rand(-0.6, 0.6);
    }
    headYaw = this.lookYaw;

    let cheekPuff = 1;
    let mouthOpen = 0.35;
    let eyeSquint = 1;
    let queasy = 0;

    if (s.charge > 0) {
      const c = s.charge;
      bodyPitch = -0.3 * c;
      bodyY += Math.sin(t * 60) * 0.008 * c;
      bodyRoll = Math.sin(t * 47) * 0.05 * c;
      cheekPuff = 1 + c * 1.1;
      eyeSquint = 1 - c * 0.6;
      mouthOpen = 0.2;
      queasy = 0.35 + c * 0.6;
      armLZ = -0.6 - c * 0.6;
      armRZ = 0.6 + c * 0.6;
      armLX = -0.4;
      armRX = -0.4;
      headPitch = -0.2 * c;
      headYaw = 0;
    }
    if (s.puking > 0) {
      bodyPitch = 0.45;
      headPitch = 0.35;
      mouthOpen = 3.2;
      cheekPuff = 1.3;
      eyeSquint = 0.3;
      queasy = 0.5;
      armLZ = -1.1;
      armRZ = 1.1;
      armLX = 0.4;
      armRX = 0.4;
      headYaw = 0;
    }
    if (s.crawling) {
      bodyPitch = 1.15;
      bodyY = 0.24;
      headPitch = -0.95;
      armLX = -1.6 + sinP * 0.5 * swing;
      armRX = -1.6 - sinP * 0.5 * swing;
      armLZ = -0.15;
      armRZ = 0.15;
      legL = -1.2 + sinP * 0.4 * swing;
      legR = -1.2 - sinP * 0.4 * swing;
      bodyRoll = sinP * 0.06;
    }
    if (s.carried) {
      legL = Math.sin(t * 22) * 0.9;
      legR = -Math.sin(t * 22) * 0.9;
      armLZ = -2.4 + Math.sin(t * 18) * 0.3;
      armRZ = 2.4 - Math.sin(t * 18) * 0.3;
      armLX = 0;
      armRX = 0;
      bodyPitch = 0;
      mouthOpen = 1.6;
    }
    if (s.happy > 0) {
      bodyY += Math.abs(Math.sin(t * 12)) * 0.12 * s.happy;
      armLZ = -2.6;
      armRZ = 2.6;
      mouthOpen = 1.5;
    }
    if (s.dizzy) {
      headYaw = Math.sin(t * 6) * 0.4;
      bodyRoll = Math.sin(t * 6) * 0.15;
    }

    const k = 18;
    this.body.position.y = damp(this.body.position.y, bodyY, k, dt);
    this.body.rotation.x = damp(this.body.rotation.x, bodyPitch, 12, dt);
    this.body.rotation.z = damp(this.body.rotation.z, bodyRoll, k, dt);
    this.head.rotation.x = damp(this.head.rotation.x, headPitch, 10, dt);
    this.head.rotation.y = damp(this.head.rotation.y, headYaw, 6, dt);
    this.legL.rotation.x = damp(this.legL.rotation.x, legL, k, dt);
    this.legR.rotation.x = damp(this.legR.rotation.x, legR, k, dt);
    this.armL.rotation.x = damp(this.armL.rotation.x, armLX, k, dt);
    this.armR.rotation.x = damp(this.armR.rotation.x, armRX, k, dt);
    this.armL.rotation.z = damp(this.armL.rotation.z, armLZ, 12, dt);
    this.armR.rotation.z = damp(this.armR.rotation.z, armRZ, 12, dt);
    this.legL.position.y = s.crawling ? 0.2 : 0.24;
    this.legR.position.y = this.legL.position.y;

    for (const cheek of this.cheeks) {
      const sc = damp(cheek.scale.x, cheekPuff, 14, dt);
      cheek.scale.set(sc, 0.7 * sc, 0.5 * sc);
    }
    this.mouth.scale.y = damp(this.mouth.scale.y, mouthOpen * 0.35, 16, dt);

    // Blink.
    this.nextBlink -= dt;
    if (this.nextBlink <= 0) {
      this.blink = 0.14;
      this.nextBlink = rand(2, 4.5);
    }
    if (this.blink > 0) this.blink -= dt;
    const eyeY = (this.blink > 0 ? 0.1 : 1) * eyeSquint;
    for (const eye of this.eyes) eye.scale.y = damp(eye.scale.y, eyeY, 30, dt);

    this.skin.color.copy(SKIN).lerp(QUEASY, clamp(queasy, 0, 1));
  }

  setBlink(visible: boolean) {
    this.root.visible = visible;
  }
}
