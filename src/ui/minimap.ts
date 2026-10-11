import { HOUSE, ROOMS, WALLS } from '../world/layout';
import type { CouchState, Puddle } from '../game/types';
import type { PickupKind } from '../game/pickups';

const ROOM_COLORS: Record<string, string> = {
  kitchen: '#3f6f6b',
  den: '#5c4053',
  hall: '#3d4f45',
  living: '#6b5338',
  bedroom: '#46557a',
  bath1: '#3a6f8a',
  bath2: '#3a6f8a',
};

export interface MinimapState {
  player: { x: number; z: number; facing: number; color: string };
  cameraYaw: number;
  /** Null when the player is Eddie (he is drawn as the player arrow). */
  eddie: { x: number; z: number; facing: number; chasing: boolean; asleep: boolean; range: number } | null;
  others: { x: number; z: number; color: string; dim: boolean }[];
  couches: CouchState[];
  pickups: { kind: PickupKind; x: number; z: number }[];
  toilets: { x: number; z: number; urgent: boolean }[];
  puddles: Puddle[];
  time: number;
}

export class Minimap {
  private readonly ctx: CanvasRenderingContext2D | null;
  private cssW = 240;
  private cssH = 168;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d');
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width > 0) {
      this.cssW = rect.width;
      this.cssH = rect.height;
    }
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(this.cssW * dpr);
    this.canvas.height = Math.round(this.cssH * dpr);
  }

  draw(s: MinimapState) {
    const ctx = this.ctx;
    if (!ctx) return;
    const w = this.canvas.width;
    const h = this.canvas.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const houseW = HOUSE.maxX - HOUSE.minX;
    const houseD = HOUSE.maxZ - HOUSE.minZ;
    const scale = Math.min((w - 16) / houseW, (h - 16) / houseD);
    ctx.translate(w / 2, h / 2);
    ctx.scale(scale, scale);
    const px = 1 / scale;

    // Bathrooms are listed first but sit inside bigger rooms, so paint them last.
    for (const room of [...ROOMS].reverse()) {
      ctx.fillStyle = ROOM_COLORS[room.id] ?? '#444';
      ctx.fillRect(room.minX, room.minZ, room.maxX - room.minX, room.maxZ - room.minZ);
    }

    // Walls (with door gaps).
    ctx.strokeStyle = '#fff6e0';
    ctx.lineWidth = 2.2 * px;
    ctx.lineCap = 'round';
    for (const wall of WALLS) {
      const doors = [...(wall.doors ?? [])].sort((a, b) => a[0] - b[0]);
      let cursor = wall.from;
      const segs: [number, number][] = [];
      for (const [d0, d1] of doors) {
        segs.push([cursor, d0]);
        cursor = d1;
      }
      segs.push([cursor, wall.to]);
      ctx.beginPath();
      for (const [a, b] of segs) {
        if (wall.axis === 'x') {
          ctx.moveTo(a, wall.at);
          ctx.lineTo(b, wall.at);
        } else {
          ctx.moveTo(wall.at, a);
          ctx.lineTo(wall.at, b);
        }
      }
      ctx.stroke();
    }

    // Toilets (all with bidets).
    for (const t of s.toilets) {
      const r = t.urgent ? 0.45 + Math.sin(s.time * 8) * 0.12 : 0.32;
      ctx.fillStyle = t.urgent ? '#8fd3ff' : '#e8f4fb';
      ctx.strokeStyle = '#241730';
      ctx.lineWidth = 1.2 * px;
      ctx.beginPath();
      ctx.arc(t.x, t.z, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      if (t.urgent) {
        ctx.strokeStyle = 'rgba(143, 211, 255, 0.7)';
        ctx.lineWidth = 2 * px;
        ctx.beginPath();
        ctx.arc(t.x, t.z, 0.9 + ((s.time * 1.5) % 1) * 1.2, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    // Puddles.
    for (const p of s.puddles) {
      if (!p.active) continue;
      ctx.fillStyle = p.style === 'sauce' ? 'rgba(170, 60, 25, 0.65)' : 'rgba(155, 209, 59, 0.6)';
      ctx.beginPath();
      ctx.arc(p.position.x, p.position.z, p.radius, 0, Math.PI * 2);
      ctx.fill();
    }

    // Couches.
    for (const couch of s.couches) {
      for (const seat of couch.seats) {
        ctx.fillStyle = seat.messed ? (couch.ruined ? (seat.mess === 'sauce' ? '#c0532a' : '#9bd13b') : '#ffc93c') : '#f4efe6';
        ctx.strokeStyle = '#241730';
        ctx.lineWidth = 1.2 * px;
        ctx.beginPath();
        ctx.arc(seat.top.x, seat.top.z, 0.38, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    }

    // Pickups.
    for (const p of s.pickups) {
      const pulse = 0.22 + Math.sin(s.time * 5) * 0.05;
      ctx.fillStyle = p.kind === 'food' || p.kind === 'feast' ? '#e2a65a' : p.kind === 'juice' ? '#ff9f1c' : p.kind === 'toy' ? '#ff5d8f' : '#ffd23f';
      ctx.beginPath();
      ctx.arc(p.x, p.z, p.kind === 'burrito' || p.kind === 'feast' ? pulse * 2 : pulse, 0, Math.PI * 2);
      ctx.fill();
    }

    // Other people.
    for (const o of s.others) {
      ctx.globalAlpha = o.dim ? 0.45 : 1;
      ctx.fillStyle = o.color;
      ctx.strokeStyle = '#241730';
      ctx.lineWidth = 1.5 * px;
      ctx.beginPath();
      ctx.arc(o.x, o.z, 0.45, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // Eddie's vision cone.
    const e = s.eddie;
    if (e && !e.asleep) {
      const half = (62 * Math.PI) / 180;
      const base = Math.PI / 2 - e.facing;
      ctx.fillStyle = e.chasing ? 'rgba(255, 90, 78, 0.45)' : 'rgba(255, 90, 78, 0.22)';
      ctx.beginPath();
      ctx.moveTo(e.x, e.z);
      ctx.arc(e.x, e.z, e.range, base - half, base + half);
      ctx.closePath();
      ctx.fill();
    }
    if (e) {
      ctx.fillStyle = e.asleep ? '#b9a6ff' : '#ff5a4e';
      ctx.strokeStyle = '#241730';
      ctx.lineWidth = 1.5 * px;
      ctx.beginPath();
      ctx.arc(e.x, e.z, 0.55, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      if (e.asleep) {
        ctx.fillStyle = '#fff';
        ctx.font = `${1.1}px sans-serif`;
        ctx.fillText('z', e.x + 0.5, e.z - 0.5);
      }
    }

    // Camera wedge + the player.
    const t = s.player;
    const camAngle = Math.PI / 2 - s.cameraYaw;
    ctx.fillStyle = 'rgba(143, 211, 255, 0.18)';
    ctx.beginPath();
    ctx.moveTo(t.x, t.z);
    ctx.arc(t.x, t.z, 4, camAngle - 0.5, camAngle + 0.5);
    ctx.closePath();
    ctx.fill();
    ctx.save();
    ctx.translate(t.x, t.z);
    ctx.rotate(Math.PI / 2 - t.facing);
    ctx.fillStyle = t.color;
    ctx.strokeStyle = '#241730';
    ctx.lineWidth = 1.5 * px;
    ctx.beginPath();
    ctx.moveTo(0.7, 0);
    ctx.lineTo(-0.45, 0.45);
    ctx.lineTo(-0.25, 0);
    ctx.lineTo(-0.45, -0.45);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
}
