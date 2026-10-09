import * as THREE from 'three';
import { glowTexture, starTexture, stinkTexture } from '../world/textures';
import { TAU, rand } from '../core/util';

interface SpriteParticle {
  sprite: THREE.Sprite;
  vel: THREE.Vector3;
  life: number;
  maxLife: number;
  spin: number;
  grow: number;
  baseScale: number;
  gravity: number;
}

interface Confetti {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  spin: THREE.Vector3;
  life: number;
}

interface Stink {
  center: THREE.Vector3;
  sprites: THREE.Sprite[];
  flies: THREE.Mesh[];
  seed: number;
}

/** Cartoon flourishes: stink lines, flies, dizzy stars, steam, tears, confetti. */
export class Effects {
  private readonly particles: SpriteParticle[] = [];
  private readonly confetti: Confetti[] = [];
  private readonly stinks: Stink[] = [];
  private readonly stinkMat: THREE.SpriteMaterial;
  private readonly starMat: THREE.SpriteMaterial;
  private readonly steamMat: THREE.SpriteMaterial;
  private readonly sparkleMat: THREE.SpriteMaterial;
  private readonly tearMat: THREE.SpriteMaterial;
  private readonly flyMat = new THREE.MeshBasicMaterial({ color: 0x111111 });
  private readonly flyGeo = new THREE.SphereGeometry(0.025, 6, 4);
  private readonly confettiGeo = new THREE.PlaneGeometry(0.08, 0.05);
  private readonly confettiMats = [0xff4d6d, 0xffd23f, 0x3ec1d3, 0x9bd13b, 0xb07cff].map(
    (c) => new THREE.MeshBasicMaterial({ color: c, side: THREE.DoubleSide, toneMapped: false }),
  );
  private readonly stars: THREE.Sprite[] = [];
  private time = 0;

  constructor(private readonly scene: THREE.Scene) {
    this.stinkMat = new THREE.SpriteMaterial({ map: stinkTexture(), transparent: true, depthWrite: false, opacity: 0.8 });
    this.starMat = new THREE.SpriteMaterial({ map: starTexture(), transparent: true, depthWrite: false, toneMapped: false });
    this.steamMat = new THREE.SpriteMaterial({ map: glowTexture('255,255,255'), transparent: true, depthWrite: false, opacity: 0.8 });
    this.sparkleMat = new THREE.SpriteMaterial({ map: glowTexture('255,240,150'), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
    this.tearMat = new THREE.SpriteMaterial({ map: glowTexture('120,190,255'), transparent: true, depthWrite: false });
    for (let i = 0; i < 5; i += 1) {
      const s = new THREE.Sprite(this.starMat);
      s.scale.setScalar(0.18);
      s.visible = false;
      scene.add(s);
      this.stars.push(s);
    }
  }

  private emit(mat: THREE.SpriteMaterial, at: THREE.Vector3, vel: THREE.Vector3, life: number, scale: number, grow = 0, gravity = 0) {
    const sprite = new THREE.Sprite(mat.clone());
    sprite.position.copy(at);
    sprite.scale.setScalar(scale);
    this.scene.add(sprite);
    this.particles.push({ sprite, vel, life, maxLife: life, spin: rand(-2, 2), grow, baseScale: scale, gravity });
  }

  steam(at: THREE.Vector3, side: number) {
    this.emit(this.steamMat, at, new THREE.Vector3(side * rand(0.4, 0.8), rand(0.8, 1.4), rand(-0.2, 0.2)), 0.7, 0.12, 0.5);
  }

  tear(at: THREE.Vector3, side: number) {
    this.emit(this.tearMat, at, new THREE.Vector3(side * rand(0.8, 1.4), rand(0.6, 1.2), rand(-0.3, 0.3)), 0.8, 0.09, 0, 6);
  }

  sparkle(at: THREE.Vector3, count = 10) {
    for (let i = 0; i < count; i += 1) {
      const a = rand(0, TAU);
      this.emit(this.sparkleMat, at.clone().add(new THREE.Vector3(0, rand(0, 0.3), 0)), new THREE.Vector3(Math.cos(a) * rand(0.5, 1.6), rand(0.8, 2.2), Math.sin(a) * rand(0.5, 1.6)), rand(0.4, 0.8), rand(0.12, 0.24), -0.2, 3);
    }
  }

  confettiBurst(at: THREE.Vector3, count = 70) {
    for (let i = 0; i < count; i += 1) {
      const mesh = new THREE.Mesh(this.confettiGeo, this.confettiMats[i % this.confettiMats.length]);
      mesh.position.copy(at);
      mesh.position.y += 0.6;
      this.scene.add(mesh);
      const a = rand(0, TAU);
      this.confetti.push({
        mesh,
        vel: new THREE.Vector3(Math.cos(a) * rand(0.8, 3), rand(3, 6), Math.sin(a) * rand(0.8, 3)),
        spin: new THREE.Vector3(rand(-10, 10), rand(-10, 10), rand(-10, 10)),
        life: rand(1.8, 2.8),
      });
    }
  }

  addStink(center: THREE.Vector3) {
    const stink: Stink = { center: center.clone(), sprites: [], flies: [], seed: rand(0, 100) };
    for (let i = 0; i < 3; i += 1) {
      const s = new THREE.Sprite(this.stinkMat.clone());
      s.scale.set(0.35, 0.7, 1);
      this.scene.add(s);
      stink.sprites.push(s);
    }
    for (let i = 0; i < 5; i += 1) {
      const f = new THREE.Mesh(this.flyGeo, this.flyMat);
      this.scene.add(f);
      stink.flies.push(f);
    }
    this.stinks.push(stink);
  }

  /** Dizzy stars orbiting Eddie's head; pass null to hide. */
  dizzy(head: THREE.Vector3 | null) {
    for (let i = 0; i < this.stars.length; i += 1) {
      const s = this.stars[i];
      if (!head) {
        s.visible = false;
        continue;
      }
      s.visible = true;
      const a = this.time * 5 + (i / this.stars.length) * TAU;
      s.position.set(head.x + Math.cos(a) * 0.35, head.y + 0.05 + Math.sin(a * 2) * 0.05, head.z + Math.sin(a) * 0.35);
      s.material.rotation = this.time * 4 + i;
    }
  }

  reset() {
    for (const p of this.particles) p.sprite.removeFromParent();
    this.particles.length = 0;
    for (const c of this.confetti) c.mesh.removeFromParent();
    this.confetti.length = 0;
    for (const s of this.stinks) {
      s.sprites.forEach((x) => x.removeFromParent());
      s.flies.forEach((x) => x.removeFromParent());
    }
    this.stinks.length = 0;
    this.dizzy(null);
  }

  update(dt: number) {
    this.time += dt;
    for (let i = this.particles.length - 1; i >= 0; i -= 1) {
      const p = this.particles[i];
      p.life -= dt;
      if (p.life <= 0) {
        p.sprite.removeFromParent();
        p.sprite.material.dispose();
        this.particles.splice(i, 1);
        continue;
      }
      p.vel.y -= p.gravity * dt;
      p.sprite.position.addScaledVector(p.vel, dt);
      const k = p.life / p.maxLife;
      p.sprite.material.opacity = Math.min(1, k * 2);
      p.sprite.material.rotation += p.spin * dt;
      p.sprite.scale.setScalar(Math.max(0.01, p.baseScale * (1 + (1 - k) * p.grow * 4)));
    }
    for (let i = this.confetti.length - 1; i >= 0; i -= 1) {
      const c = this.confetti[i];
      c.life -= dt;
      c.vel.y -= 7 * dt;
      c.vel.multiplyScalar(1 - dt * 1.2);
      c.mesh.position.addScaledVector(c.vel, dt);
      if (c.mesh.position.y < 0.02) {
        c.mesh.position.y = 0.02;
        c.vel.set(0, 0, 0);
      } else {
        c.mesh.rotation.x += c.spin.x * dt;
        c.mesh.rotation.y += c.spin.y * dt;
        c.mesh.rotation.z += c.spin.z * dt;
      }
      if (c.life <= 0) {
        c.mesh.removeFromParent();
        this.confetti.splice(i, 1);
      }
    }
    for (const s of this.stinks) {
      s.sprites.forEach((sprite, i) => {
        const phase = (this.time * 0.45 + i / 3 + s.seed) % 1;
        sprite.position.set(s.center.x + Math.sin(i * 2.1 + s.seed) * 0.4, s.center.y + 0.25 + phase * 1.1, s.center.z + Math.cos(i * 1.7 + s.seed) * 0.4);
        sprite.material.opacity = Math.sin(phase * Math.PI) * 0.85;
      });
      s.flies.forEach((fly, i) => {
        const t = this.time * (2.2 + i * 0.3) + i * 1.7 + s.seed;
        fly.position.set(
          s.center.x + Math.cos(t) * (0.45 + Math.sin(t * 3.1) * 0.15),
          s.center.y + 0.45 + Math.sin(t * 2.3) * 0.25,
          s.center.z + Math.sin(t * 1.3) * (0.45 + Math.cos(t * 2.7) * 0.15),
        );
      });
    }
  }
}
