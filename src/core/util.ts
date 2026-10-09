import * as THREE from 'three';

export const TAU = Math.PI * 2;

export function clamp(value: number, min: number, max: number) {
  return value < min ? min : value > max ? max : value;
}

export function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

/** Frame-rate independent exponential approach. */
export function damp(current: number, target: number, lambda: number, dt: number) {
  return lerp(current, target, 1 - Math.exp(-lambda * dt));
}

export function wrapAngle(angle: number) {
  let a = angle % TAU;
  if (a > Math.PI) a -= TAU;
  if (a < -Math.PI) a += TAU;
  return a;
}

export function dampAngle(current: number, target: number, lambda: number, dt: number) {
  return current + wrapAngle(target - current) * (1 - Math.exp(-lambda * dt));
}

export function smoothstep(edge0: number, edge1: number, x: number) {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

export function rand(min = 0, max = 1) {
  return min + Math.random() * (max - min);
}

export function pick<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

/** Picks a random item, avoiding the most recent pick when possible. */
export class LineDeck<T> {
  private last = -1;
  constructor(private readonly items: readonly T[]) {}
  next(): T {
    if (this.items.length === 1) return this.items[0];
    let index = Math.floor(Math.random() * this.items.length);
    if (index === this.last) index = (index + 1) % this.items.length;
    this.last = index;
    return this.items[index];
  }
}

export function easeOutBack(t: number) {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

export function easeOutCubic(t: number) {
  return 1 - Math.pow(1 - t, 3);
}

export function dist2D(ax: number, az: number, bx: number, bz: number) {
  const dx = ax - bx;
  const dz = az - bz;
  return Math.sqrt(dx * dx + dz * dz);
}

export function yawTo(fromX: number, fromZ: number, toX: number, toZ: number) {
  return Math.atan2(toX - fromX, toZ - fromZ);
}

export function forwardFromYaw(yaw: number, target = new THREE.Vector3()) {
  return target.set(Math.sin(yaw), 0, Math.cos(yaw));
}

export function formatTime(seconds: number) {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function safeStorageGet(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function safeStorageSet(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Storage can be unavailable (private mode); the game works without it.
  }
}
