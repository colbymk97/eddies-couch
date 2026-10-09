import * as THREE from 'three';

export const MASK_THEO = 1;
export const MASK_EDDIE = 2;
export const MASK_ALL = 3;

export interface Box {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  mask: number;
  /** Blocks Eddie's line of sight (walls, tall furniture). */
  sight: boolean;
  tag?: string;
}

export interface BoxOptions {
  mask?: number;
  sight?: boolean;
  rot?: number;
  tag?: string;
}

function segmentBoxT(ax: number, az: number, bx: number, bz: number, b: Box): number | null {
  let tmin = 0;
  let tmax = 1;
  const dx = bx - ax;
  const dz = bz - az;
  if (Math.abs(dx) < 1e-9) {
    if (ax < b.minX || ax > b.maxX) return null;
  } else {
    const t1 = (b.minX - ax) / dx;
    const t2 = (b.maxX - ax) / dx;
    tmin = Math.max(tmin, Math.min(t1, t2));
    tmax = Math.min(tmax, Math.max(t1, t2));
    if (tmin > tmax) return null;
  }
  if (Math.abs(dz) < 1e-9) {
    if (az < b.minZ || az > b.maxZ) return null;
  } else {
    const t1 = (b.minZ - az) / dz;
    const t2 = (b.maxZ - az) / dz;
    tmin = Math.max(tmin, Math.min(t1, t2));
    tmax = Math.min(tmax, Math.max(t1, t2));
    if (tmin > tmax) return null;
  }
  return tmin;
}

class MinHeap {
  private items: number[] = [];
  constructor(private readonly score: Float32Array) {}
  get size() {
    return this.items.length;
  }
  clear() {
    this.items.length = 0;
  }
  push(index: number) {
    const items = this.items;
    items.push(index);
    let i = items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.score[items[parent]] <= this.score[items[i]]) break;
      [items[parent], items[i]] = [items[i], items[parent]];
      i = parent;
    }
  }
  pop(): number {
    const items = this.items;
    const top = items[0];
    const last = items.pop() as number;
    if (items.length > 0) {
      items[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let smallest = i;
        if (l < items.length && this.score[items[l]] < this.score[items[smallest]]) smallest = l;
        if (r < items.length && this.score[items[r]] < this.score[items[smallest]]) smallest = r;
        if (smallest === i) break;
        [items[smallest], items[i]] = [items[i], items[smallest]];
        i = smallest;
      }
    }
    return top;
  }
}

export class Collision {
  readonly boxes: Box[] = [];
  readonly hideZones: Box[] = [];

  // Navigation grid (for Eddie).
  private cell = 0.2;
  private originX = 0;
  private originZ = 0;
  private cols = 0;
  private rows = 0;
  private walkable = new Uint8Array(0);
  private gScore = new Float32Array(0);
  private fScore = new Float32Array(0);
  private cameFrom = new Int32Array(0);
  private visited = new Uint32Array(0);
  private closed = new Uint32Array(0);
  private generation = 1;
  private heap = new MinHeap(this.fScore);

  addBox(cx: number, cz: number, w: number, d: number, options: BoxOptions = {}): Box {
    let width = w;
    let depth = d;
    if (options.rot) {
      const c = Math.abs(Math.cos(options.rot));
      const s = Math.abs(Math.sin(options.rot));
      width = w * c + d * s;
      depth = w * s + d * c;
    }
    const box: Box = {
      minX: cx - width / 2,
      maxX: cx + width / 2,
      minZ: cz - depth / 2,
      maxZ: cz + depth / 2,
      mask: options.mask ?? MASK_ALL,
      sight: options.sight ?? false,
      tag: options.tag,
    };
    this.boxes.push(box);
    return box;
  }

  addHideZone(cx: number, cz: number, w: number, d: number) {
    this.hideZones.push({ minX: cx - w / 2, maxX: cx + w / 2, minZ: cz - d / 2, maxZ: cz + d / 2, mask: 0, sight: false });
  }

  isHidden(x: number, z: number) {
    return this.hideZones.some((b) => x > b.minX && x < b.maxX && z > b.minZ && z < b.maxZ);
  }

  blocked(x: number, z: number, radius: number, mask: number) {
    const r2 = radius * radius;
    for (const b of this.boxes) {
      if ((b.mask & mask) === 0) continue;
      const cx = x < b.minX ? b.minX : x > b.maxX ? b.maxX : x;
      const cz = z < b.minZ ? b.minZ : z > b.maxZ ? b.maxZ : z;
      const dx = x - cx;
      const dz = z - cz;
      if (dx * dx + dz * dz < r2) return true;
    }
    return false;
  }

  /** Axis-separated sliding movement. Returns true if anything blocked the move. */
  move(position: THREE.Vector3, dx: number, dz: number, radius: number, mask: number) {
    const length = Math.hypot(dx, dz);
    const steps = Math.max(1, Math.ceil(length / 0.08));
    const sx = dx / steps;
    const sz = dz / steps;
    let hit = false;
    for (let i = 0; i < steps; i += 1) {
      if (!this.blocked(position.x + sx, position.z, radius, mask)) position.x += sx;
      else hit = true;
      if (!this.blocked(position.x, position.z + sz, radius, mask)) position.z += sz;
      else hit = true;
    }
    return hit;
  }

  /** Nudges a point out of any overlapping colliders. */
  pushOut(position: THREE.Vector3, radius: number, mask: number) {
    if (!this.blocked(position.x, position.z, radius, mask)) return;
    for (let ring = 1; ring <= 30; ring += 1) {
      const d = ring * 0.1;
      for (let a = 0; a < 16; a += 1) {
        const angle = (a / 16) * Math.PI * 2;
        const x = position.x + Math.cos(angle) * d;
        const z = position.z + Math.sin(angle) * d;
        if (!this.blocked(x, z, radius, mask)) {
          position.x = x;
          position.z = z;
          return;
        }
      }
    }
  }

  lineOfSight(ax: number, az: number, bx: number, bz: number) {
    for (const b of this.boxes) {
      if (!b.sight) continue;
      if (segmentBoxT(ax, az, bx, bz, b) !== null) return false;
    }
    return true;
  }

  /** Distance along a ray until it hits a sight-blocking box (walls). */
  rayDistance(ax: number, az: number, dirX: number, dirZ: number, maxDist: number) {
    const bx = ax + dirX * maxDist;
    const bz = az + dirZ * maxDist;
    let best = 1;
    for (const b of this.boxes) {
      if (!b.sight) continue;
      const t = segmentBoxT(ax, az, bx, bz, b);
      if (t !== null && t < best) best = t;
    }
    return best * maxDist;
  }

  // ------------------------------------------------------------------ navigation

  buildNav(minX: number, minZ: number, maxX: number, maxZ: number, radius: number, cell = 0.2) {
    this.cell = cell;
    this.originX = minX;
    this.originZ = minZ;
    this.cols = Math.ceil((maxX - minX) / cell);
    this.rows = Math.ceil((maxZ - minZ) / cell);
    const total = this.cols * this.rows;
    this.walkable = new Uint8Array(total);
    this.gScore = new Float32Array(total);
    this.fScore = new Float32Array(total);
    this.cameFrom = new Int32Array(total);
    this.visited = new Uint32Array(total);
    this.closed = new Uint32Array(total);
    this.heap = new MinHeap(this.fScore);
    for (let r = 0; r < this.rows; r += 1) {
      for (let c = 0; c < this.cols; c += 1) {
        const x = this.originX + (c + 0.5) * cell;
        const z = this.originZ + (r + 0.5) * cell;
        this.walkable[r * this.cols + c] = this.blocked(x, z, radius, MASK_EDDIE) ? 0 : 1;
      }
    }
  }

  private cellOf(x: number, z: number): [number, number] {
    return [Math.floor((x - this.originX) / this.cell), Math.floor((z - this.originZ) / this.cell)];
  }

  private isWalkableCell(c: number, r: number) {
    return c >= 0 && r >= 0 && c < this.cols && r < this.rows && this.walkable[r * this.cols + c] === 1;
  }

  isWalkable(x: number, z: number) {
    const [c, r] = this.cellOf(x, z);
    return this.isWalkableCell(c, r);
  }

  nearestWalkable(x: number, z: number): THREE.Vector2 | null {
    const [c0, r0] = this.cellOf(x, z);
    if (this.isWalkableCell(c0, r0)) return new THREE.Vector2(x, z);
    for (let ring = 1; ring < 40; ring += 1) {
      let best: THREE.Vector2 | null = null;
      let bestD = Infinity;
      for (let dc = -ring; dc <= ring; dc += 1) {
        for (let dr = -ring; dr <= ring; dr += 1) {
          if (Math.abs(dc) !== ring && Math.abs(dr) !== ring) continue;
          const c = c0 + dc;
          const r = r0 + dr;
          if (!this.isWalkableCell(c, r)) continue;
          const px = this.originX + (c + 0.5) * this.cell;
          const pz = this.originZ + (r + 0.5) * this.cell;
          const d = (px - x) ** 2 + (pz - z) ** 2;
          if (d < bestD) {
            bestD = d;
            best = new THREE.Vector2(px, pz);
          }
        }
      }
      if (best) return best;
    }
    return null;
  }

  walkableLine(ax: number, az: number, bx: number, bz: number) {
    const length = Math.hypot(bx - ax, bz - az);
    const steps = Math.max(1, Math.ceil(length / (this.cell * 0.5)));
    for (let i = 0; i <= steps; i += 1) {
      const t = i / steps;
      if (!this.isWalkable(ax + (bx - ax) * t, az + (bz - az) * t)) return false;
    }
    return true;
  }

  findPath(sx: number, sz: number, tx: number, tz: number): THREE.Vector2[] | null {
    const start = this.nearestWalkable(sx, sz);
    const goal = this.nearestWalkable(tx, tz);
    if (!start || !goal) return null;
    if (this.walkableLine(start.x, start.y, goal.x, goal.y)) return [goal];

    const [sc, sr] = this.cellOf(start.x, start.y);
    const [gc, gr] = this.cellOf(goal.x, goal.y);
    const cols = this.cols;
    const startIdx = sr * cols + sc;
    const goalIdx = gr * cols + gc;

    this.generation += 1;
    const gen = this.generation;
    const heuristic = (c: number, r: number) => {
      const dx = Math.abs(c - gc);
      const dy = Math.abs(r - gr);
      return dx + dy + (Math.SQRT2 - 2) * Math.min(dx, dy);
    };

    this.heap.clear();
    this.gScore[startIdx] = 0;
    this.fScore[startIdx] = heuristic(sc, sr);
    this.cameFrom[startIdx] = -1;
    this.visited[startIdx] = gen;
    this.heap.push(startIdx);

    const closed = this.closed;
    let found = false;
    let iterations = 0;

    while (this.heap.size > 0 && iterations < 20000) {
      iterations += 1;
      const current = this.heap.pop();
      if (current === goalIdx) {
        found = true;
        break;
      }
      if (closed[current] === gen) continue;
      closed[current] = gen;
      const cc = current % cols;
      const cr = (current - cc) / cols;
      for (let dc = -1; dc <= 1; dc += 1) {
        for (let dr = -1; dr <= 1; dr += 1) {
          if (dc === 0 && dr === 0) continue;
          const nc = cc + dc;
          const nr = cr + dr;
          if (!this.isWalkableCell(nc, nr)) continue;
          if (dc !== 0 && dr !== 0 && (!this.isWalkableCell(cc + dc, cr) || !this.isWalkableCell(cc, cr + dr))) continue;
          const ni = nr * cols + nc;
          if (closed[ni] === gen) continue;
          const tentative = this.gScore[current] + (dc !== 0 && dr !== 0 ? Math.SQRT2 : 1);
          if (this.visited[ni] !== gen || tentative < this.gScore[ni]) {
            this.visited[ni] = gen;
            this.gScore[ni] = tentative;
            this.fScore[ni] = tentative + heuristic(nc, nr);
            this.cameFrom[ni] = current;
            this.heap.push(ni);
          }
        }
      }
    }
    if (!found) return null;

    const cells: THREE.Vector2[] = [];
    let node = goalIdx;
    while (node !== -1 && node !== startIdx) {
      const c = node % cols;
      const r = (node - c) / cols;
      cells.push(new THREE.Vector2(this.originX + (c + 0.5) * this.cell, this.originZ + (r + 0.5) * this.cell));
      node = this.cameFrom[node];
    }
    cells.reverse();
    if (cells.length > 0) cells[cells.length - 1] = goal;

    // String-pull to remove grid zig-zags.
    const smooth: THREE.Vector2[] = [];
    let anchor = start;
    let i = 0;
    while (i < cells.length) {
      let furthest = i;
      for (let j = cells.length - 1; j > i; j -= 1) {
        if (this.walkableLine(anchor.x, anchor.y, cells[j].x, cells[j].y)) {
          furthest = j;
          break;
        }
      }
      smooth.push(cells[furthest]);
      anchor = cells[furthest];
      i = furthest + 1;
    }
    return smooth;
  }
}
