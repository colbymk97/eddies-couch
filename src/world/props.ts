import * as THREE from 'three';
import { Collision, MASK_ALL, MASK_EDDIE } from './collision';
import { blobShadow, boxGeo, cylGeo, glossy, makeBun, mesh, roundedBoxGeo, shared, sphereGeo, std } from './kit';
import {
  BODY_FONT,
  DISPLAY_FONT,
  canvasTexture,
  dogPortraitTexture,
  nameplateTexture,
  rugTexture,
  textLabelTexture,
  type DogStyle,
} from './textures';
import { TAU, rand } from '../core/util';
import { keepSeparate, mergeStatic } from './batch';

export interface Animated {
  update(dt: number, time: number): void;
}

export interface Portrait {
  group: THREE.Group;
  pupils: THREE.Mesh[];
  centers: THREE.Vector3[];
  radius: number;
}

export class PropBuilder {
  readonly animated: Animated[] = [];
  readonly portraits: Portrait[] = [];
  readonly lampLights: THREE.Vector3[] = [];
  readonly occluders: THREE.Object3D[] = [];
  /** Things hung on walls; they fade along with their wall. */
  readonly wallDecor: THREE.Object3D[] = [];
  private bunTexture?: THREE.Texture;

  constructor(
    readonly root: THREE.Object3D,
    readonly collision: Collision,
    readonly shadow: THREE.Texture,
  ) {}

  private group(x: number, z: number, rot = 0) {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.rotation.y = rot;
    this.root.add(g);
    return g;
  }

  // ---------------------------------------------------------------- living room

  coffeeTable(x: number, z: number) {
    const g = this.group(x, z);
    const w = 1.7;
    const d = 0.85;
    mesh(roundedBoxGeo(w, 0.07, d, 0.03), shared.midWood, 0, 0.44, 0, { parent: g });
    mesh(roundedBoxGeo(w - 0.2, 0.04, d - 0.2, 0.02), shared.midWood, 0, 0.14, 0, { parent: g });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) mesh(cylGeo(0.03, 0.025, 0.42, 8), shared.darkWood, sx * (w / 2 - 0.1), 0.21, sz * (d / 2 - 0.1), { parent: g });
    // Bowl of buns.
    mesh(new THREE.SphereGeometry(0.22, 24, 12, 0, TAU, Math.PI / 2, Math.PI / 2), glossy(0xe8e2d4, { roughness: 0.2 }), 0.35, 0.7, 0, { rx: Math.PI, parent: g });
    for (let i = 0; i < 4; i += 1) {
      const bun = makeBun(0.85);
      bun.position.set(0.35 + Math.cos(i * 1.6) * 0.08, 0.58 + (i % 2) * 0.05, Math.sin(i * 1.6) * 0.08);
      bun.rotation.y = i * 0.9;
      g.add(bun);
    }
    const mag = textLabelTexture(['BUNS', 'MONTHLY'], { width: 256, height: 320, bg: '#f2c94c', fg: '#7a2d10', size: 58 });
    mesh(boxGeo(0.3, 0.012, 0.38), std(0xffffff, { map: mag }), -0.4, 0.484, 0.05, { ry: 0.3, parent: g });
    mesh(roundedBoxGeo(0.2, 0.025, 0.06, 0.01), shared.black, -0.05, 0.49, -0.2, { ry: -0.4, parent: g });
    g.add(blobShadow(this.shadow, w + 0.3, d + 0.3, 0.35));
    this.collision.addBox(x, z, w, d);
  }

  tvConsole(x: number, z: number, rot: number) {
    const g = this.group(x, z, rot);
    mesh(roundedBoxGeo(2.6, 0.5, 0.48, 0.03), shared.darkWood, 0, 0.27, 0, { parent: g });
    for (const sx of [-0.65, 0, 0.65]) mesh(boxGeo(0.8, 0.36, 0.01), shared.midWood, sx, 0.27, 0.245, { parent: g });
    mesh(boxGeo(0.4, 0.04, 0.24), shared.black, 0, 0.54, 0, { parent: g });
    mesh(boxGeo(0.08, 0.2, 0.06), shared.black, 0, 0.64, 0, { parent: g });
    const frame = mesh(roundedBoxGeo(2.2, 1.26, 0.07, 0.02), shared.black, 0, 1.36, 0, { parent: g });
    void frame;
    const channel = new TvChannel();
    const screen = mesh(new THREE.PlaneGeometry(2.08, 1.14), new THREE.MeshBasicMaterial({ map: channel.texture, toneMapped: false }), 0, 1.36, 0.037, {
      parent: g,
      cast: false,
    });
    void screen;
    this.animated.push(channel);
    g.add(blobShadow(this.shadow, 3.0, 0.9, 0.35));
    this.collision.addBox(x, z, 2.6, 0.5, { rot });
    return channel;
  }

  floorLamp(x: number, z: number) {
    const g = this.group(x, z);
    mesh(cylGeo(0.18, 0.2, 0.04, 20), shared.brass, 0, 0.02, 0, { parent: g });
    mesh(cylGeo(0.018, 0.018, 1.55, 8), shared.brass, 0, 0.8, 0, { parent: g });
    mesh(new THREE.CylinderGeometry(0.2, 0.3, 0.36, 24, 1, true), shared.lampShade, 0, 1.62, 0, { parent: g, cast: false });
    mesh(sphereGeo(0.07, 12, 10), std(0xffffff, { emissive: 0xffd9a0, emissiveIntensity: 3 }), 0, 1.55, 0, { parent: g, cast: false });
    g.add(blobShadow(this.shadow, 0.7, 0.7, 0.4));
    this.collision.addBox(x, z, 0.36, 0.36);
    this.lampLights.push(new THREE.Vector3(x, 1.5, z));
  }

  plant(x: number, z: number, scale = 1) {
    const g = this.group(x, z, rand(0, TAU));
    g.scale.setScalar(scale);
    mesh(cylGeo(0.22, 0.16, 0.4, 16), shared.terracotta, 0, 0.2, 0, { parent: g });
    mesh(cylGeo(0.2, 0.2, 0.02, 16), std(0x3b2a1c), 0, 0.39, 0, { parent: g });
    const leafGeo = new THREE.SphereGeometry(0.2, 12, 8);
    leafGeo.scale(1, 0.12, 0.55);
    leafGeo.translate(0.2, 0, 0);
    for (let i = 0; i < 11; i += 1) {
      const a = (i / 11) * TAU + rand(-0.2, 0.2);
      const h = 0.55 + rand(0, 0.7);
      const stem = mesh(cylGeo(0.008, 0.008, h, 5), shared.leafDark, Math.cos(a) * 0.04, 0.38 + h / 2, Math.sin(a) * 0.04, {
        rz: Math.cos(a) * 0.25,
        rx: -Math.sin(a) * 0.25,
        parent: g,
        cast: false,
      });
      void stem;
      mesh(leafGeo, i % 2 ? shared.leaf : shared.leafDark, Math.cos(a) * 0.15, 0.38 + h, Math.sin(a) * 0.15, {
        ry: -a,
        rz: rand(-0.6, -0.2),
        parent: g,
      });
    }
    g.add(blobShadow(this.shadow, 0.8, 0.8, 0.4));
    this.collision.addBox(x, z, 0.46 * scale, 0.46 * scale);
  }

  sideTable(x: number, z: number, withLamp = true) {
    const g = this.group(x, z);
    mesh(cylGeo(0.26, 0.26, 0.04, 24), shared.midWood, 0, 0.62, 0, { parent: g });
    mesh(cylGeo(0.03, 0.05, 0.6, 10), shared.darkWood, 0, 0.31, 0, { parent: g });
    mesh(cylGeo(0.16, 0.18, 0.03, 20), shared.darkWood, 0, 0.015, 0, { parent: g });
    if (withLamp) {
      mesh(sphereGeo(0.09, 14, 10), glossy(0x2a7a8c, { roughness: 0.2 }), 0, 0.72, 0, { parent: g });
      mesh(new THREE.CylinderGeometry(0.1, 0.15, 0.18, 18, 1, true), shared.lampShade, 0, 0.92, 0, { parent: g, cast: false });
    }
    g.add(blobShadow(this.shadow, 0.65, 0.65, 0.35));
    this.collision.addBox(x, z, 0.5, 0.5);
  }

  rug(x: number, z: number, w: number, d: number, colors: [string, string, string], rot = 0) {
    const tex = rugTexture(...colors);
    const m = mesh(new THREE.PlaneGeometry(w, d), std(0xffffff, { map: tex, roughness: 0.95 }), x, 0.008, z, {
      rx: -Math.PI / 2,
      rz: rot,
      cast: false,
    });
    this.root.add(m);
  }

  wallSign(x: number, y: number, z: number, rot: number, lines: string[], bg: string, fg: string, w = 1.2, h = 0.4) {
    const tex = textLabelTexture(lines, { width: 512, height: Math.round((512 * h) / w), bg, fg, size: Math.round(150 * h), border: shade(fg) });
    const g = this.group(x, z, rot);
    this.wallDecor.push(g);
    mesh(roundedBoxGeo(w + 0.06, h + 0.06, 0.04, 0.015), shared.darkWood, 0, y, 0, { parent: g });
    mesh(new THREE.PlaneGeometry(w, h), std(0xffffff, { map: tex, roughness: 0.8 }), 0, y, 0.022, { parent: g, cast: false });
  }

  bunClock(x: number, y: number, z: number, rot: number) {
    const tex = canvasTexture(256, 256, (ctx, w, h) => {
      ctx.fillStyle = '#fff8e7';
      ctx.beginPath();
      ctx.arc(w / 2, h / 2, 120, 0, TAU);
      ctx.fill();
      ctx.fillStyle = '#b5652a';
      ctx.font = `22px ${DISPLAY_FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (let i = 0; i < 12; i += 1) {
        const a = (i / 12) * TAU - Math.PI / 2;
        ctx.fillText('BUN', w / 2 + Math.cos(a) * 92, h / 2 + Math.sin(a) * 92);
      }
    });
    const g = this.group(x, z, rot);
    this.wallDecor.push(g);
    mesh(cylGeo(0.3, 0.3, 0.05, 32), shared.darkWood, 0, y, 0, { rx: Math.PI / 2, parent: g });
    mesh(new THREE.CircleGeometry(0.27, 32), std(0xffffff, { map: tex }), 0, y, 0.027, { parent: g, cast: false });
    keepSeparate(g);
    const hourHand = mesh(boxGeo(0.02, 0.14, 0.01), shared.black, 0, y, 0.035, { parent: g, cast: false });
    const minuteHand = mesh(boxGeo(0.014, 0.21, 0.01), shared.black, 0, y, 0.04, { parent: g, cast: false });
    hourHand.geometry = hourHand.geometry.clone().translate(0, 0.06, 0);
    minuteHand.geometry = minuteHand.geometry.clone().translate(0, 0.09, 0);
    hourHand.position.y = y;
    minuteHand.position.y = y;
    this.animated.push({
      update: (_dt, time) => {
        minuteHand.rotation.z = -time * 0.6;
        hourHand.rotation.z = -time * 0.05;
      },
    });
  }

  // ---------------------------------------------------------------- kitchen

  counters(x0: number, x1: number, zWall: number, sinkX: number, stoveX: number) {
    const depth = 0.66;
    const z = zWall + depth / 2;
    const w = x1 - x0;
    const cx = (x0 + x1) / 2;
    const g = this.group(cx, z);
    const cabinet = std(0x5e8c7a, { roughness: 0.55 });
    mesh(boxGeo(w, 0.86, depth - 0.04), cabinet, 0, 0.47, -0.02, { parent: g });
    mesh(boxGeo(w, 0.08, depth - 0.08), shared.black, 0, 0.04, -0.06, { parent: g });
    const doors = Math.round(w / 0.6);
    for (let i = 0; i < doors; i += 1) {
      const dx = -w / 2 + (i + 0.5) * (w / doors);
      mesh(roundedBoxGeo(w / doors - 0.04, 0.74, 0.03, 0.01), std(0x6da08c, { roughness: 0.5 }), dx, 0.47, depth / 2 - 0.03, { parent: g });
      mesh(boxGeo(0.12, 0.02, 0.03), shared.chrome, dx, 0.78, depth / 2 - 0.005, { parent: g, cast: false });
    }
    mesh(roundedBoxGeo(w + 0.04, 0.05, depth + 0.02, 0.015), glossy(0xf3f0ea, { roughness: 0.15, clearcoat: 0.8 }), 0, 0.925, 0, { parent: g });
    // Sink.
    mesh(boxGeo(0.7, 0.02, 0.42), shared.steel, sinkX - cx, 0.952, 0.02, { parent: g, cast: false });
    mesh(boxGeo(0.6, 0.02, 0.34), std(0x55606a, { metalness: 0.7, roughness: 0.3 }), sinkX - cx, 0.955, 0.02, { parent: g, cast: false });
    const faucet = new THREE.TubeGeometry(
      new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0, -0.2), new THREE.Vector3(0, 0.32, -0.2), new THREE.Vector3(0, 0.36, -0.05), new THREE.Vector3(0, 0.26, 0.02)]),
      16,
      0.018,
      8,
    );
    mesh(faucet, shared.chrome, sinkX - cx, 0.95, 0, { parent: g });
    // Stove.
    mesh(boxGeo(0.76, 0.02, 0.56), glossy(0x15151a, { roughness: 0.15, clearcoat: 1 }), stoveX - cx, 0.955, 0, { parent: g, cast: false });
    for (const [bx, bz] of [
      [-0.18, -0.13],
      [0.18, -0.13],
      [-0.18, 0.13],
      [0.18, 0.13],
    ]) {
      mesh(new THREE.TorusGeometry(0.08, 0.01, 6, 20), shared.steel, stoveX - cx + bx, 0.97, bz, { rx: Math.PI / 2, parent: g, cast: false });
    }
    // A pot with a single sad bun in it.
    mesh(cylGeo(0.15, 0.14, 0.18, 20), shared.steel, stoveX - cx + 0.18, 1.05, 0.13, { parent: g });
    // Backsplash + upper cabinets (skipping the window).
    const tiles = canvasTexture(
      256,
      128,
      (ctx, cw, ch) => {
        ctx.fillStyle = '#f7f4ee';
        ctx.fillRect(0, 0, cw, ch);
        ctx.strokeStyle = '#c9c2b4';
        ctx.lineWidth = 3;
        for (let yy = 0; yy <= ch; yy += 32) {
          ctx.beginPath();
          ctx.moveTo(0, yy);
          ctx.lineTo(cw, yy);
          ctx.stroke();
          for (let xx = (yy / 32) % 2 ? 0 : 32; xx <= cw; xx += 64) {
            ctx.beginPath();
            ctx.moveTo(xx, yy);
            ctx.lineTo(xx, yy + 32);
            ctx.stroke();
          }
        }
      },
      { repeat: [w / 1.2, 1] },
    );
    mesh(new THREE.PlaneGeometry(w, 0.55), std(0xffffff, { map: tiles, roughness: 0.25 }), 0, 1.24, -depth / 2 + 0.005, { parent: g, cast: false });
    const upper = std(0x6da08c, { roughness: 0.5 });
    for (const [ux0, ux1] of [
      [x0, sinkX - 0.95],
      [sinkX + 0.95, x1],
    ]) {
      const uw = ux1 - ux0;
      if (uw < 0.4) continue;
      mesh(boxGeo(uw, 0.66, 0.36), upper, (ux0 + ux1) / 2 - cx, 1.86, -depth / 2 + 0.18, { parent: g });
      const n = Math.max(1, Math.round(uw / 0.6));
      for (let i = 0; i < n; i += 1) {
        const dx = ux0 + (i + 0.5) * (uw / n) - cx;
        mesh(boxGeo(0.02, 0.12, 0.03), shared.chrome, dx + (uw / n) * 0.35, 1.66, -depth / 2 + 0.375, { parent: g, cast: false });
      }
    }
    this.collision.addBox(cx, z, w, depth);
  }

  fridge(x: number, z: number) {
    const g = this.group(x, z);
    const body = glossy(0xdfe4e8, { roughness: 0.22, clearcoat: 0.8, metalness: 0.2 });
    mesh(roundedBoxGeo(0.95, 2.0, 0.84, 0.05), body, 0, 1.0, 0, { parent: g });
    mesh(boxGeo(0.92, 0.012, 0.01), shared.black, 0, 1.38, 0.425, { parent: g, cast: false });
    for (const y of [1.0, 1.7]) mesh(roundedBoxGeo(0.04, 0.42, 0.05, 0.015), shared.chrome, -0.36, y, 0.45, { parent: g });
    const notes: [string[], string, number, number, number][] = [
      [['DO NOT', 'EAT MY', 'BUNS', '- E'], '#fff59d', 0.05, 1.1, 0.12],
      [['BUY:', 'BUNS', 'BUNS', 'BUNS'], '#ffcdd2', 0.24, 0.72, -0.1],
      [['NO', 'PUKE', 'ZONE'], '#c8e6c9', 0.12, 1.65, 0.06],
    ];
    for (const [lines, color, nx, ny, r] of notes) {
      const tex = textLabelTexture(lines, { width: 192, height: 192, bg: color, fg: '#333', size: 34, font: BODY_FONT });
      mesh(new THREE.PlaneGeometry(0.2, 0.2), std(0xffffff, { map: tex, roughness: 0.9 }), nx, ny, 0.427, { rz: r, parent: g, cast: false });
    }
    const magnetColors = [0xe74c3c, 0x3498db, 0xf1c40f, 0x2ecc71];
    magnetColors.forEach((c, i) => mesh(sphereGeo(0.025, 10, 8), glossy(c, { roughness: 0.3 }), -0.1 + i * 0.12, 1.25 + (i % 2) * 0.3, 0.43, { parent: g, cast: false }));
    g.add(blobShadow(this.shadow, 1.3, 1.2, 0.45));
    this.collision.addBox(x, z, 0.95, 0.84, { sight: true });
    this.occluders.push(g);
  }

  microwave(x: number, z: number) {
    const g = this.group(x, z);
    keepSeparate(g);
    g.position.y = 0.95;
    mesh(roundedBoxGeo(0.62, 0.36, 0.42, 0.03), shared.steel, 0, 0.18, 0, { parent: g });
    const windowMat = std(0x111111, { emissive: 0xffc860, emissiveIntensity: 0, roughness: 0.1 });
    mesh(boxGeo(0.38, 0.24, 0.01), windowMat, -0.08, 0.18, 0.212, { parent: g, cast: false });
    const displayTex = canvasTexture(128, 48, () => undefined);
    const displayMat = new THREE.MeshBasicMaterial({ map: displayTex, toneMapped: false });
    mesh(new THREE.PlaneGeometry(0.12, 0.045), displayMat, 0.2, 0.28, 0.212, { parent: g, cast: false });
    for (let i = 0; i < 3; i += 1) for (let j = 0; j < 3; j += 1) mesh(boxGeo(0.025, 0.02, 0.01), shared.black, 0.17 + i * 0.03, 0.2 - j * 0.03, 0.212, { parent: g, cast: false });
    const plate = mesh(cylGeo(0.13, 0.13, 0.01, 20), glossy(0xffffff, { roughness: 0.2 }), -0.08, 0.08, 0, { parent: g, cast: false });
    let running = 0;
    let lastText = '';
    const drawDisplay = (text: string) => {
      if (text === lastText) return;
      lastText = text;
      const canvas = displayTex.image as HTMLCanvasElement;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.fillStyle = '#051208';
      ctx.fillRect(0, 0, 128, 48);
      ctx.fillStyle = '#44ff7a';
      ctx.font = `34px ${DISPLAY_FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, 64, 26);
      displayTex.needsUpdate = true;
    };
    drawDisplay('BUN');
    this.animated.push({
      update: (dt) => {
        if (running > 0) {
          running = Math.max(0, running - dt);
          plate.rotation.y += dt * 2;
          windowMat.emissiveIntensity = 1.6;
          drawDisplay(`0:${String(Math.ceil(running)).padStart(2, '0')}`);
        } else {
          windowMat.emissiveIntensity = 0;
          drawDisplay('BUN');
        }
      },
    });
    return {
      run: (seconds: number) => {
        running = seconds;
      },
      get running() {
        return running > 0;
      },
      group: g,
    };
  }

  diningTable(x: number, z: number) {
    const g = this.group(x, z);
    const w = 2.2;
    const d = 1.2;
    mesh(roundedBoxGeo(w, 0.07, d, 0.03), shared.lightWood, 0, 0.78, 0, { parent: g });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) mesh(cylGeo(0.04, 0.03, 0.76, 10), shared.midWood, sx * (w / 2 - 0.12), 0.38, sz * (d / 2 - 0.12), { parent: g });
    // Tablecloth runner + a ketchup bottle with no hotdogs in sight.
    mesh(boxGeo(w * 0.8, 0.005, 0.36), std(0xc0392b, { roughness: 0.9 }), 0, 0.818, 0, { parent: g, cast: false });
    mesh(cylGeo(0.04, 0.045, 0.2, 12), glossy(0xd62d20, { roughness: 0.25 }), 0.3, 0.92, 0.05, { parent: g });
    mesh(cylGeo(0.04, 0.045, 0.2, 12), glossy(0xf2c200, { roughness: 0.25 }), 0.42, 0.92, -0.03, { parent: g });
    const chairMat = shared.midWood;
    for (const sz of [-1, 1]) {
      for (const sx of [-0.55, 0.55]) {
        const c = new THREE.Group();
        c.position.set(sx, 0, sz * 0.92);
        c.rotation.y = sz > 0 ? Math.PI : 0;
        g.add(c);
        mesh(roundedBoxGeo(0.46, 0.05, 0.44, 0.02), chairMat, 0, 0.47, 0, { parent: c });
        mesh(roundedBoxGeo(0.46, 0.5, 0.05, 0.02), chairMat, 0, 0.74, 0.2, { parent: c });
        for (const lx of [-0.19, 0.19]) for (const lz of [-0.18, 0.18]) mesh(cylGeo(0.022, 0.02, 0.46, 8), shared.darkWood, lx, 0.23, lz, { parent: c });
        this.collision.addBox(x + sx, z + sz * 0.95, 0.46, 0.4);
      }
    }
    g.add(blobShadow(this.shadow, w + 0.6, d + 1.4, 0.4));
    // Eddie can't fit under the table. Theo absolutely can.
    this.collision.addBox(x, z, w, d, { mask: MASK_EDDIE });
    this.collision.addHideZone(x, z, w - 0.25, d - 0.3);
  }

  pantry(x: number, z0: number, z1: number, xWall: number) {
    const depth = 0.48;
    const len = z1 - z0;
    const cz = (z0 + z1) / 2;
    const cx = xWall + depth / 2;
    const g = this.group(cx, cz);
    const wood = shared.lightWood;
    for (const side of [-1, 1]) mesh(boxGeo(depth, 2.1, 0.05), wood, 0, 1.05, (side * len) / 2, { parent: g });
    mesh(boxGeo(0.03, 2.1, len), wood, -depth / 2 + 0.015, 1.05, 0, { parent: g });
    const label = textLabelTexture(['BUNZ'], { width: 128, height: 96, bg: '#f5f0e0', fg: '#c0392b', size: 52 });
    const bagMat = std(0xffffff, { map: label, roughness: 0.4 });
    const bagMat2 = std(0xfff3d6, { map: label, roughness: 0.4 });
    for (let s = 0; s < 5; s += 1) {
      const y = 0.08 + s * 0.48;
      mesh(boxGeo(depth, 0.03, len), wood, 0, y, 0, { parent: g });
      if (s === 4) continue;
      const n = Math.floor(len / 0.32);
      for (let i = 0; i < n; i += 1) {
        const bz = -len / 2 + 0.2 + i * ((len - 0.4) / (n - 1));
        const bag = mesh(roundedBoxGeo(0.3, 0.2, 0.26, 0.06, 2), i % 3 ? bagMat : bagMat2, 0.02, y + 0.12, bz, { ry: Math.PI / 2 + rand(-0.15, 0.15), parent: g });
        bag.scale.y = rand(0.9, 1.15);
        if (Math.random() < 0.5) {
          const top = mesh(roundedBoxGeo(0.3, 0.2, 0.26, 0.06, 2), bagMat, 0.02, y + 0.31, bz + rand(-0.04, 0.04), { ry: Math.PI / 2 + rand(-0.3, 0.3), parent: g });
          top.scale.y = 0.9;
        }
      }
    }
    void x;
    this.collision.addBox(cx, cz, depth, len, { sight: true });
    this.occluders.push(g);
  }

  trashCan(x: number, z: number) {
    const g = this.group(x, z, rand(0, TAU));
    mesh(cylGeo(0.3, 0.25, 0.66, 24), shared.steel, 0, 0.33, 0, { parent: g });
    mesh(new THREE.TorusGeometry(0.3, 0.02, 8, 24), shared.steel, 0, 0.66, 0, { rx: Math.PI / 2, parent: g, cast: false });
    const lid = mesh(cylGeo(0.31, 0.31, 0.03, 24), shared.steel, 0, 0.92, -0.3, { rx: -1.25, parent: g });
    void lid;
    mesh(boxGeo(0.14, 0.03, 0.1), shared.black, 0, 0.03, 0.3, { parent: g });
    // Two batches of buns: the bottom layer always stays, the top layer gets eaten.
    const base = new THREE.Group();
    const extra = new THREE.Group();
    for (let i = 0; i < 9; i += 1) {
      const bun = makeBun(1);
      const a = (i / 9) * TAU;
      bun.position.set(Math.cos(a) * 0.12, 0.68 + (i % 3) * 0.05, Math.sin(a) * 0.12);
      bun.rotation.set(rand(-0.5, 0.5), a, rand(-0.4, 0.4));
      bun.traverse((o) => (o.castShadow = false));
      (i % 3 === 0 ? base : extra).add(bun);
    }
    g.add(base, extra);
    mergeStatic(base);
    mergeStatic(extra);
    keepSeparate(extra);
    g.add(blobShadow(this.shadow, 0.9, 0.9, 0.45));
    this.collision.addBox(x, z, 0.62, 0.62);
    return { group: g, extra };
  }

  // ---------------------------------------------------------------- den

  bookshelf(x: number, z: number, rot: number, w = 1.9) {
    const g = this.group(x, z, rot);
    const d = 0.42;
    const h = 2.0;
    const wood = shared.darkWood;
    for (const side of [-1, 1]) mesh(boxGeo(0.05, h, d), wood, (side * w) / 2, h / 2, 0, { parent: g });
    mesh(boxGeo(w, h, 0.03), wood, 0, h / 2, -d / 2 + 0.015, { parent: g });
    const colors = [0xc0392b, 0x2980b9, 0x27ae60, 0xf39c12, 0x8e44ad, 0xecf0f1, 0x2c3e50, 0xd35400];
    const bookGeo = new THREE.BoxGeometry(1, 1, 1);
    const count = 5 * 26;
    const books = new THREE.InstancedMesh(bookGeo, std(0xffffff, { roughness: 0.7 }), count);
    books.castShadow = true;
    books.receiveShadow = true;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const color = new THREE.Color();
    let idx = 0;
    for (let s = 0; s < 5; s += 1) {
      const y = 0.05 + s * 0.4;
      mesh(boxGeo(w, 0.03, d), wood, 0, y, 0, { parent: g });
      let bx = -w / 2 + 0.06;
      while (bx < w / 2 - 0.08 && idx < count) {
        const bw = rand(0.04, 0.08);
        const bh = rand(0.22, 0.32);
        const lean = Math.random() < 0.08 ? 0.25 : 0;
        q.setFromEuler(new THREE.Euler(0, 0, lean));
        m.compose(new THREE.Vector3(bx + bw / 2, y + 0.015 + bh / 2, 0.02), q, new THREE.Vector3(bw, bh, rand(0.24, 0.3)));
        books.setMatrixAt(idx, m);
        books.setColorAt(idx, color.setHex(colors[Math.floor(Math.random() * colors.length)]).offsetHSL(0, 0, rand(-0.1, 0.05)));
        idx += 1;
        bx += bw + 0.005;
      }
    }
    books.count = idx;
    g.add(books);
    g.add(blobShadow(this.shadow, w + 0.3, 0.8, 0.4));
    this.collision.addBox(x, z, w + 0.05, d, { rot, sight: true });
    this.occluders.push(g);
  }

  crtTv(x: number, z: number, rot: number) {
    const g = this.group(x, z, rot);
    mesh(roundedBoxGeo(0.9, 0.5, 0.5, 0.03), shared.midWood, 0, 0.25, 0, { parent: g });
    mesh(roundedBoxGeo(0.72, 0.56, 0.56, 0.06), std(0x3b3530, { roughness: 0.6 }), 0, 0.78, -0.02, { parent: g });
    const staticTex = canvasTexture(
      128,
      96,
      (ctx, w, h) => {
        const img = ctx.createImageData(w, h);
        for (let i = 0; i < img.data.length; i += 4) {
          const v = Math.random() * 255;
          img.data[i] = v;
          img.data[i + 1] = v;
          img.data[i + 2] = v;
          img.data[i + 3] = 255;
        }
        ctx.putImageData(img, 0, 0);
      },
      { repeat: [0.5, 0.5] },
    );
    const screen = mesh(new THREE.PlaneGeometry(0.54, 0.4), new THREE.MeshBasicMaterial({ map: staticTex, color: 0xb8c8d8, toneMapped: false }), 0, 0.8, 0.265, {
      parent: g,
      cast: false,
    });
    void screen;
    mesh(cylGeo(0.005, 0.005, 0.5, 4), shared.chrome, -0.15, 1.25, -0.05, { rz: 0.5, parent: g, cast: false });
    mesh(cylGeo(0.005, 0.005, 0.5, 4), shared.chrome, 0.15, 1.25, -0.05, { rz: -0.5, parent: g, cast: false });
    this.animated.push({
      update: () => {
        staticTex.offset.set(Math.random(), Math.random());
      },
    });
    g.add(blobShadow(this.shadow, 1.2, 0.9, 0.4));
    this.collision.addBox(x, z, 0.9, 0.55, { rot });
  }

  // ---------------------------------------------------------------- bedroom / hall

  bed(x: number, z: number) {
    const g = this.group(x, z);
    const len = 2.5;
    const w = 2.0;
    const frame = shared.midWood;
    mesh(roundedBoxGeo(len, 0.12, w, 0.03), frame, 0, 0.52, 0, { parent: g });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) mesh(cylGeo(0.05, 0.04, 0.5, 10), frame, sx * (len / 2 - 0.08), 0.25, sz * (w / 2 - 0.08), { parent: g });
    mesh(roundedBoxGeo(len - 0.08, 0.24, w - 0.08, 0.08, 3), std(0xfbf8f2, { roughness: 0.85 }), 0, 0.7, 0, { parent: g });
    mesh(roundedBoxGeo(len * 0.68, 0.12, w + 0.04, 0.06, 3), std(0x3d6fb6, { roughness: 0.9 }), -len * 0.15, 0.82, 0, { parent: g });
    mesh(roundedBoxGeo(0.1, 1.2, w + 0.1, 0.04), shared.darkWood, len / 2 + 0.02, 0.85, 0, { parent: g });
    for (const sz of [-0.45, 0.45]) mesh(roundedBoxGeo(0.4, 0.14, 0.7, 0.07, 3), std(0xffffff, { roughness: 0.9 }), len / 2 - 0.32, 0.88, sz, { rz: 0.2, parent: g });
    // Bedside dog plushie.
    mesh(sphereGeo(0.12, 14, 10), std(0xb0814a), len / 2 - 0.6, 0.92, 0.1, { parent: g });
    g.add(blobShadow(this.shadow, len + 0.4, w + 0.4, 0.5));
    this.collision.addBox(x, z, len, w, { mask: MASK_EDDIE });
    this.collision.addBox(x + len / 2 + 0.02, z, 0.12, w + 0.1);
    this.collision.addHideZone(x - 0.1, z, len - 0.5, w - 0.4);
  }

  dresser(x: number, z: number, rot: number) {
    const g = this.group(x, z, rot);
    mesh(roundedBoxGeo(1.6, 1.0, 0.5, 0.03), std(0xe8e0d0, { roughness: 0.5 }), 0, 0.52, 0, { parent: g });
    for (let r = 0; r < 3; r += 1) {
      for (const dx of [-0.4, 0.4]) {
        mesh(boxGeo(0.74, 0.27, 0.02), std(0xf4eee2, { roughness: 0.5 }), dx, 0.24 + r * 0.31, 0.255, { parent: g });
        mesh(sphereGeo(0.022, 8, 6), shared.brass, dx, 0.24 + r * 0.31, 0.275, { parent: g, cast: false });
      }
    }
    const photo = textLabelTexture(['ME +', 'COUCH', '4EVER'], { width: 192, height: 192, bg: '#d6eaf8', fg: '#2c3e50', size: 40 });
    mesh(roundedBoxGeo(0.3, 0.36, 0.03, 0.01), shared.gold, 0.45, 1.2, -0.05, { rx: -0.15, parent: g });
    mesh(new THREE.PlaneGeometry(0.24, 0.3), std(0xffffff, { map: photo }), 0.45, 1.2, -0.03, { rx: -0.15, parent: g, cast: false });
    this.collision.addBox(x, z, 1.6, 0.5, { rot });
  }

  dogBed(x: number, z: number) {
    const g = this.group(x, z);
    mesh(new THREE.TorusGeometry(0.42, 0.14, 12, 28), std(0x8c5a3c, { roughness: 0.95 }), 0, 0.12, 0, { rx: Math.PI / 2, parent: g });
    mesh(cylGeo(0.42, 0.42, 0.08, 28), std(0xd8c2a4, { roughness: 0.95 }), 0, 0.06, 0, { parent: g });
    const tag = textLabelTexture(['BISCUIT'], { width: 256, height: 64, bg: '#c0392b', fg: '#fff', size: 40 });
    mesh(new THREE.PlaneGeometry(0.4, 0.1), std(0xffffff, { map: tag }), 0, 0.2, 0.56, { parent: g, cast: false });
    g.add(blobShadow(this.shadow, 1.3, 1.3, 0.35));
  }

  playpen(x: number, z: number) {
    const g = this.group(x, z);
    const s = 1.5;
    const net = canvasTexture(
      128,
      128,
      (ctx, w, h) => {
        ctx.clearRect(0, 0, w, h);
        ctx.strokeStyle = 'rgba(255,255,255,0.9)';
        ctx.lineWidth = 3;
        for (let i = 0; i <= w; i += 16) {
          ctx.beginPath();
          ctx.moveTo(i, 0);
          ctx.lineTo(i, h);
          ctx.moveTo(0, i);
          ctx.lineTo(w, i);
          ctx.stroke();
        }
      },
      { repeat: [4, 2] },
    );
    const netMat = new THREE.MeshStandardMaterial({ map: net, transparent: true, side: THREE.DoubleSide, roughness: 0.9, alphaTest: 0.3 });
    const rail = std(0x5dade2, { roughness: 0.5 });
    for (const [px, pz] of [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ]) {
      mesh(cylGeo(0.04, 0.04, 0.7, 10), rail, (px * s) / 2, 0.35, (pz * s) / 2, { parent: g });
    }
    for (let i = 0; i < 4; i += 1) {
      const a = (i * Math.PI) / 2;
      const side = new THREE.Group();
      side.rotation.y = a;
      g.add(side);
      // Front side left open: Theo escaped long ago.
      if (i === 0) continue;
      mesh(cylGeo(0.03, 0.03, s, 8), rail, 0, 0.7, s / 2, { rz: Math.PI / 2, parent: side });
      mesh(new THREE.PlaneGeometry(s, 0.62), netMat, 0, 0.36, s / 2, { parent: side, cast: false });
    }
    mesh(boxGeo(s, 0.05, s), std(0xaed6f1, { roughness: 0.9 }), 0, 0.025, 0, { parent: g, cast: false });
    const blocks = [0xe74c3c, 0xf1c40f, 0x2ecc71];
    blocks.forEach((c, i) => mesh(roundedBoxGeo(0.14, 0.14, 0.14, 0.02), std(c), -0.4 + i * 0.18, 0.12, -0.45 + (i % 2) * 0.15, { ry: i, parent: g }));
  }

  portrait(dog: DogStyle, x: number, z: number, rot: number) {
    const g = this.group(x, z, rot);
    this.wallDecor.push(g);
    const y = 1.55;
    const { texture, eyes } = dogPortraitTexture(dog);
    const pw = 0.64;
    const ph = 0.8;
    const frameW = 0.1;
    for (const [fx, fy, w, h] of [
      [0, ph / 2 + frameW / 2, pw + frameW * 2, frameW],
      [0, -ph / 2 - frameW / 2, pw + frameW * 2, frameW],
      [-pw / 2 - frameW / 2, 0, frameW, ph],
      [pw / 2 + frameW / 2, 0, frameW, ph],
    ]) {
      mesh(roundedBoxGeo(w, h, 0.06, 0.02), shared.gold, fx, y + fy, 0.03, { parent: g });
    }
    mesh(new THREE.PlaneGeometry(pw, ph), std(0xffffff, { map: texture, roughness: 0.55 }), 0, y, 0.012, { parent: g, cast: false });
    const plate = nameplateTexture(dog.name);
    mesh(boxGeo(0.46, 0.08, 0.012), std(0xffffff, { map: plate, metalness: 0.6, roughness: 0.35 }), 0, y - ph / 2 - frameW - 0.08, 0.012, { parent: g, cast: false });
    // Picture light.
    mesh(cylGeo(0.025, 0.025, 0.4, 10), shared.brass, 0, y + ph / 2 + frameW + 0.1, 0.12, { rz: Math.PI / 2, parent: g, cast: false });
    mesh(boxGeo(0.38, 0.015, 0.03), std(0xffffff, { emissive: 0xfff0c0, emissiveIntensity: 2 }), 0, y + ph / 2 + frameW + 0.08, 0.12, { parent: g, cast: false });

    const pupilMat = std(0x0e0a08, { roughness: 0.2 });
    const pupils: THREE.Mesh[] = [];
    const centers: THREE.Vector3[] = [];
    for (const e of eyes) {
      const cx = (e.u - 0.5) * pw;
      const cy = y + (e.v - 0.5) * ph;
      const pupil = keepSeparate(mesh(sphereGeo(0.022, 10, 8), pupilMat, cx, cy, 0.018, { parent: g, cast: false })) as THREE.Mesh;
      pupil.scale.z = 0.3;
      pupils.push(pupil);
      centers.push(new THREE.Vector3(cx, cy, 0.018));
    }
    this.portraits.push({ group: g, pupils, centers, radius: eyes[0] ? eyes[0].r * pw * 0.55 : 0.02 });
  }

  /** Small framed cross-stitch on a wall. */
  crossStitch(x: number, y: number, z: number, rot: number, lines: string[]) {
    const tex = canvasTexture(256, 200, (ctx, w, h) => {
      ctx.fillStyle = '#f8f1dc';
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = '#d98fa8';
      ctx.setLineDash([4, 4]);
      ctx.lineWidth = 4;
      ctx.strokeRect(14, 14, w - 28, h - 28);
      ctx.fillStyle = '#7d3c98';
      ctx.font = `34px ${DISPLAY_FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      lines.forEach((l, i) => ctx.fillText(l, w / 2, h / 2 + (i - (lines.length - 1) / 2) * 40));
    });
    const g = this.group(x, z, rot);
    this.wallDecor.push(g);
    mesh(roundedBoxGeo(0.62, 0.5, 0.03, 0.01), shared.midWood, 0, y, 0, { parent: g });
    mesh(new THREE.PlaneGeometry(0.54, 0.42), std(0xffffff, { map: tex, roughness: 0.95 }), 0, y, 0.017, { parent: g, cast: false });
  }

  register(x: number, z: number, w: number, d: number, sight = false) {
    this.collision.addBox(x, z, w, d, { mask: MASK_ALL, sight });
  }
}

function shade(color: string) {
  return color;
}

/** "Pasión de Sofás", Eddie's favorite telenovela, plus commercial breaks. */
export class TvChannel implements Animated {
  readonly texture: THREE.CanvasTexture;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D | null;
  private accumulator = 0;
  private time = 0;
  private readonly subtitles = [
    '—¡Nunca me sentaste, Ricardo!',
    '—Eres solo un futón para mí...',
    '—¡Mi cojín te pertenece!',
    '—¿Quién manchó el sofá? ¿¡QUIÉN!?',
    '—Nuestro amor... es de cuero sintético.',
  ];

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = 512;
    this.canvas.height = 288;
    this.ctx = this.canvas.getContext('2d');
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.draw();
  }

  update(dt: number) {
    this.time += dt;
    this.accumulator += dt;
    if (this.accumulator < 1 / 12) return;
    this.accumulator = 0;
    this.draw();
  }

  private draw() {
    const ctx = this.ctx;
    if (!ctx) return;
    const w = this.canvas.width;
    const h = this.canvas.height;
    const t = this.time;
    const segment = Math.floor(t / 14) % 3;
    if (segment === 2) {
      this.drawAd(ctx, w, h, t);
    } else {
      const bg = ctx.createLinearGradient(0, 0, 0, h);
      bg.addColorStop(0, '#5b1f6b');
      bg.addColorStop(0.6, '#d9536f');
      bg.addColorStop(1, '#f7b267');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);
      const approach = Math.sin(t * 0.8) * 0.5 + 0.5;
      this.drawCouch(ctx, 120 + approach * 60, 190, '#2e86c1', 1);
      this.drawCouch(ctx, 392 - approach * 60, 190, '#e84393', -1);
      for (let i = 0; i < 5; i += 1) {
        const hy = 150 - ((t * 40 + i * 37) % 130);
        const hx = 256 + Math.sin(t * 2 + i) * 30;
        ctx.fillStyle = `rgba(255,80,120,${Math.max(0, hy / 150)})`;
        this.heart(ctx, hx, hy, 10);
      }
      ctx.fillStyle = '#ffe9a8';
      ctx.font = `38px ${DISPLAY_FONT}`;
      ctx.textAlign = 'center';
      ctx.fillText('PASIÓN DE SOFÁS', w / 2, 48);
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(0, h - 44, w, 44);
      ctx.fillStyle = '#fff';
      ctx.font = `22px ${BODY_FONT}`;
      ctx.fillText(this.subtitles[Math.floor(t / 3.5) % this.subtitles.length], w / 2, h - 16);
    }
    ctx.fillStyle = 'rgba(255,255,255,0.04)';
    for (let y = 0; y < h; y += 4) ctx.fillRect(0, y, w, 2);
    this.texture.needsUpdate = true;
  }

  private drawAd(ctx: CanvasRenderingContext2D, w: number, h: number, t: number) {
    ctx.fillStyle = '#0b3d91';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#ffd400';
    ctx.fillRect(0, 0, w, 50);
    ctx.fillStyle = '#0b3d91';
    ctx.font = `30px ${DISPLAY_FONT}`;
    ctx.textAlign = 'center';
    ctx.fillText('COUCH SHOPPING NETWORK', w / 2, 36);
    this.drawCouch(ctx, w / 2, 170, '#f3efe6', 1, 1.5);
    ctx.fillStyle = '#ffffff';
    ctx.font = `26px ${DISPLAY_FONT}`;
    ctx.fillText('STAIN-PROOF SECTIONAL', w / 2, 92);
    ctx.fillStyle = Math.floor(t * 3) % 2 ? '#ff4757' : '#ffd400';
    ctx.font = `34px ${DISPLAY_FONT}`;
    ctx.fillText('$1,999!!', w / 2, 248);
    ctx.fillStyle = '#c8d6e5';
    ctx.font = `14px ${BODY_FONT}`;
    ctx.fillText('*not vomit-proof. not toddler-proof. not Theo-proof.', w / 2, 276);
  }

  private drawCouch(ctx: CanvasRenderingContext2D, x: number, y: number, color: string, facing: number, scale = 1) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(scale * facing, scale);
    ctx.fillStyle = color;
    ctx.fillRect(-50, -30, 100, 40);
    ctx.fillRect(-60, -10, 20, 30);
    ctx.fillRect(40, -10, 20, 30);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(-40, 0, 80, 10);
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(10, -15, 7, 0, TAU);
    ctx.arc(28, -15, 7, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.arc(12, -15, 3, 0, TAU);
    ctx.arc(30, -15, 3, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  private heart(ctx: CanvasRenderingContext2D, x: number, y: number, s: number) {
    ctx.beginPath();
    ctx.moveTo(x, y + s * 0.6);
    ctx.bezierCurveTo(x - s * 1.4, y - s * 0.4, x - s * 0.5, y - s * 1.4, x, y - s * 0.5);
    ctx.bezierCurveTo(x + s * 0.5, y - s * 1.4, x + s * 1.4, y - s * 0.4, x, y + s * 0.6);
    ctx.fill();
  }
}
