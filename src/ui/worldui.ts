import * as THREE from 'three';
import type { Mood } from '../game/types';

interface Bubble {
  anchor: HTMLDivElement;
  bubble: HTMLDivElement;
  time: number;
}

interface Pop {
  anchor: HTMLDivElement;
  position: THREE.Vector3;
  time: number;
}

const tmp = new THREE.Vector3();

/** DOM elements pinned to 3D positions: speech bubbles, score pops, Eddie's "?!" meter. */
export class WorldUi {
  private readonly bubbles: Record<'eddie' | 'theo', Bubble>;
  private readonly pops: Pop[] = [];
  private readonly mark: HTMLDivElement;
  private readonly markAnchor: HTMLDivElement;
  private readonly arrow: HTMLDivElement;
  private width = window.innerWidth;
  private height = window.innerHeight;

  constructor(
    private readonly layer: HTMLElement,
    private readonly camera: THREE.PerspectiveCamera,
  ) {
    this.bubbles = { eddie: this.makeBubble(), theo: this.makeBubble() };
    this.markAnchor = document.createElement('div');
    this.markAnchor.className = 'anchor';
    this.mark = document.createElement('div');
    this.mark.className = 'alert-mark';
    this.markAnchor.appendChild(this.mark);
    this.markAnchor.style.display = 'none';
    layer.appendChild(this.markAnchor);
    this.arrow = document.createElement('div');
    this.arrow.className = 'edge-arrow';
    layer.appendChild(this.arrow);
    window.addEventListener('resize', () => {
      this.width = window.innerWidth;
      this.height = window.innerHeight;
    });
  }

  private makeBubble(): Bubble {
    const anchor = document.createElement('div');
    anchor.className = 'anchor';
    anchor.style.display = 'none';
    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    anchor.appendChild(bubble);
    this.layer.appendChild(anchor);
    return { anchor, bubble, time: 0 };
  }

  private project(position: THREE.Vector3) {
    tmp.copy(position).project(this.camera);
    return {
      x: (tmp.x * 0.5 + 0.5) * this.width,
      y: (-tmp.y * 0.5 + 0.5) * this.height,
      behind: tmp.z > 1,
    };
  }

  say(who: 'eddie' | 'theo', text: string, mood: Mood, duration: number) {
    const b = this.bubbles[who];
    b.bubble.textContent = text;
    b.bubble.className = `bubble mood-${mood}${who === 'theo' ? ' theo' : ''}`;
    // Restart the entry animation.
    void b.bubble.offsetWidth;
    b.time = duration;
    b.anchor.style.display = '';
  }

  isTalking(who: 'eddie' | 'theo') {
    return this.bubbles[who].time > 0;
  }

  pop(position: THREE.Vector3, text: string, style: '' | 'small' | 'gold' | 'red' | 'blue' = '') {
    const anchor = document.createElement('div');
    anchor.className = 'anchor';
    const label = document.createElement('div');
    label.className = `pop-text ${style}`;
    label.textContent = text;
    anchor.appendChild(label);
    this.layer.appendChild(anchor);
    this.pops.push({ anchor, position: position.clone(), time: 1.15 });
  }

  clear() {
    for (const p of this.pops) p.anchor.remove();
    this.pops.length = 0;
    for (const b of Object.values(this.bubbles)) {
      b.time = 0;
      b.anchor.style.display = 'none';
    }
    this.markAnchor.style.display = 'none';
    this.arrow.classList.remove('is-visible');
  }

  update(
    dt: number,
    eddieHead: THREE.Vector3,
    theoHead: THREE.Vector3,
    suspicion: number,
    alerted: boolean,
    showMark: boolean,
    chasing: boolean,
  ) {
    for (const [who, b] of Object.entries(this.bubbles) as ['eddie' | 'theo', Bubble][]) {
      if (b.time <= 0) continue;
      b.time -= dt;
      if (b.time <= 0.2 && !b.bubble.classList.contains('is-leaving')) b.bubble.classList.add('is-leaving');
      if (b.time <= 0) {
        b.anchor.style.display = 'none';
        continue;
      }
      const head = who === 'eddie' ? eddieHead : theoHead;
      const p = this.project(head);
      // Keep bubbles on screen without sliding them under the HUD panels.
      const compact = document.body.classList.contains('is-compact');
      const margin = compact ? 80 : 110;
      const top = compact ? 50 : this.height > 600 ? 150 : 110;
      const x = Math.min(this.width - margin, Math.max(margin, p.x));
      const y = Math.min(this.height - 20, Math.max(top, p.y - (who === 'eddie' && showMark ? (compact ? 28 : 40) : 0)));
      b.anchor.style.transform = `translate(${x}px, ${y}px)`;
      b.anchor.style.visibility = p.behind ? 'hidden' : 'visible';
    }

    for (let i = this.pops.length - 1; i >= 0; i -= 1) {
      const pop = this.pops[i];
      pop.time -= dt;
      if (pop.time <= 0) {
        pop.anchor.remove();
        this.pops.splice(i, 1);
        continue;
      }
      const p = this.project(pop.position);
      pop.anchor.style.transform = `translate(${p.x}px, ${p.y}px)`;
      pop.anchor.style.visibility = p.behind ? 'hidden' : 'visible';
    }

    // Suspicion meter / alert mark over Eddie.
    if (showMark && (suspicion > 0.08 || alerted)) {
      const p = this.project(eddieHead);
      this.markAnchor.style.display = p.behind ? 'none' : '';
      this.markAnchor.style.transform = `translate(${p.x}px, ${p.y - 6}px)`;
      this.mark.textContent = alerted ? '!' : '?';
      this.mark.classList.toggle('is-alert', alerted);
      this.mark.style.setProperty('--fill', suspicion.toFixed(2));
    } else {
      this.markAnchor.style.display = 'none';
    }

    // Off-screen arrow toward a chasing Eddie.
    const p = this.project(eddieHead);
    const offscreen = p.behind || p.x < 0 || p.x > this.width || p.y < 0 || p.y > this.height;
    if (chasing && offscreen) {
      let dx = p.x - this.width / 2;
      let dy = p.y - this.height / 2;
      if (p.behind) {
        dx = -dx;
        dy = -dy;
      }
      const angle = Math.atan2(dy, dx);
      const r = Math.min(this.width, this.height) * 0.42;
      const ax = this.width / 2 + Math.cos(angle) * r;
      const ay = this.height / 2 + Math.sin(angle) * r;
      this.arrow.style.transform = `translate(${ax - 18}px, ${ay - 17}px) rotate(${angle + Math.PI / 2}rad)`;
      this.arrow.classList.add('is-visible');
    } else {
      this.arrow.classList.remove('is-visible');
    }
  }
}
