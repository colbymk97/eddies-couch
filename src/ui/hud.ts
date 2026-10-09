import type { CouchState } from '../game/types';

const PEPPER = `<svg class="pepper" viewBox="0 0 24 32"><path d="M12 6c-2-4 2-6 4-4" fill="none" stroke="#2f7d32" stroke-width="3" stroke-linecap="round"/><path d="M7 9c3-3 9-3 11 1 3 6-1 16-8 20-3 1-5-1-4-4 2-5-2-11 1-17z" fill="#ff3b30" stroke="#241730" stroke-width="2.5"/><path d="M10 12c1-1 3-1 4 0" stroke="#fff" stroke-width="2" stroke-linecap="round" opacity=".6"/></svg>`;
const DIAPER = `<svg class="diaper" viewBox="0 0 40 32"><path d="M3 6h34l-3 10c-2 8-8 13-14 13S8 24 6 16z" fill="#fffaf0" stroke="#241730" stroke-width="3" stroke-linejoin="round"/><path d="M3 6h34v6H3z" fill="#8fd3ff" stroke="#241730" stroke-width="3" stroke-linejoin="round"/><circle cx="10" cy="9" r="1.6" fill="#241730"/><circle cx="30" cy="9" r="1.6" fill="#241730"/></svg>`;

export interface HudState {
  couches: CouchState[];
  targetCouch: CouchState | null;
  score: number;
  combo: number;
  lives: number;
  maxLives: number;
  tummy: number;
  stamina: number;
  tired: boolean;
  eddie: { label: string; tone: 'calm' | 'warn' | 'danger' | 'good' };
  rage: number;
  hasToy: boolean;
  burrito: number;
  zoomies: number;
  hidden: boolean;
}

function el<T extends HTMLElement>(id: string) {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing #${id}`);
  return node as T;
}

export class Hud {
  readonly root = el<HTMLDivElement>('hud');
  private readonly couchCount = el<HTMLSpanElement>('couch-count');
  private readonly couchIcons = el<HTMLDivElement>('couch-icons');
  private readonly eddieStatus = el<HTMLDivElement>('eddie-status');
  private readonly eddieState = el<HTMLDivElement>('eddie-state');
  private readonly rage = el<HTMLDivElement>('rage');
  private readonly score = el<HTMLDivElement>('score');
  private readonly combo = el<HTMLDivElement>('combo');
  private readonly lives = el<HTMLDivElement>('lives');
  private readonly tummyPanel = document.querySelector<HTMLDivElement>('.tummy-panel');
  private readonly tummyFill = document.getElementById('tummy-fill') as unknown as SVGRectElement;
  private readonly tummyWave = document.getElementById('tummy-wave') as unknown as SVGPathElement;
  private readonly tummyText = el<HTMLDivElement>('tummy-text');
  private readonly staminaFill = el<HTMLDivElement>('stamina-fill');
  private readonly itemSlot = el<HTMLDivElement>('item-slot');
  private readonly hint = el<HTMLDivElement>('hint');
  private readonly hideIndicator = el<HTMLDivElement>('hide-indicator');
  private readonly banner = el<HTMLDivElement>('banner');
  private readonly toyButton = el<HTMLButtonElement>('toy-button');
  private iconEls: { couch: CouchState; node: HTMLDivElement; fill: HTMLDivElement }[] = [];
  private bannerTimer = 0;
  private hintTimer = 0;
  private last: Record<string, string> = {};
  private wave = 0;
  private lastCombo = 0;

  constructor() {
    this.rage.innerHTML = PEPPER.repeat(4);
  }

  show(visible: boolean) {
    this.root.classList.toggle('is-hidden', !visible);
  }

  buildCouches(couches: CouchState[]) {
    this.couchIcons.innerHTML = '';
    this.iconEls = couches.map((couch) => {
      const node = document.createElement('div');
      node.className = 'couch-icon';
      node.title = couch.def.name;
      const fill = document.createElement('div');
      fill.className = 'fill';
      fill.style.height = '0%';
      node.appendChild(fill);
      this.couchIcons.appendChild(node);
      return { couch, node, fill };
    });
  }

  private set(key: string, value: string, apply: () => void) {
    if (this.last[key] === value) return;
    this.last[key] = value;
    apply();
  }

  update(dt: number, s: HudState) {
    let ruined = 0;
    for (const icon of this.iconEls) {
      const puked = icon.couch.seats.filter((seat) => seat.puked).length;
      const pct = Math.round((puked / icon.couch.seats.length) * 100);
      if (icon.couch.ruined) ruined += 1;
      this.set(`icon-${icon.couch.def.id}`, `${pct}-${icon.couch.ruined}-${s.targetCouch === icon.couch}`, () => {
        icon.fill.style.height = `${pct}%`;
        icon.node.classList.toggle('is-ruined', icon.couch.ruined);
        icon.node.classList.toggle('is-target', s.targetCouch === icon.couch);
      });
    }
    this.set('count', String(ruined), () => (this.couchCount.textContent = String(ruined)));

    this.set('eddie', `${s.eddie.label}|${s.eddie.tone}`, () => {
      this.eddieState.textContent = s.eddie.label;
      this.eddieStatus.className = `panel eddie-status tone-${s.eddie.tone}`;
    });
    this.set('rage', String(s.rage), () => {
      this.rage.querySelectorAll('.pepper').forEach((p, i) => p.classList.toggle('is-on', i < s.rage));
    });

    this.set('score', String(s.score), () => (this.score.textContent = s.score.toLocaleString()));
    this.set('combo', String(s.combo), () => {
      this.combo.textContent = s.combo > 1 ? `x${Math.min(4, 1 + (s.combo - 1) * 0.5).toFixed(1).replace('.0', '')} COMBO` : '';
      if (s.combo > this.lastCombo) {
        this.combo.classList.remove('is-pop');
        void this.combo.offsetWidth;
        this.combo.classList.add('is-pop');
      }
      this.lastCombo = s.combo;
    });
    this.set('lives', `${s.lives}/${s.maxLives}`, () => {
      this.lives.innerHTML = Array.from({ length: s.maxLives }, (_, i) => DIAPER.replace('class="diaper"', `class="diaper${i < s.lives ? '' : ' is-lost'}"`)).join('');
    });

    // Tummy liquid with a sloshing wave.
    this.wave += dt;
    const level = 92 - (s.tummy / 100) * 84;
    this.tummyFill.setAttribute('y', String(level + 2));
    const offset = (this.wave * 30) % 50;
    this.tummyWave.setAttribute('transform', `translate(${-offset} ${level - 40})`);
    this.set('tummy', String(Math.round(s.tummy)), () => (this.tummyText.textContent = `${Math.round(s.tummy)}%`));
    this.tummyPanel?.classList.toggle('is-low', s.tummy < 18);
    this.tummyPanel?.classList.toggle('is-burrito', s.burrito > 0);

    this.staminaFill.style.width = `${Math.round(s.stamina * 100)}%`;
    this.staminaFill.classList.toggle('is-tired', s.tired);

    const chips: string[] = [];
    if (s.hasToy) chips.push('<div class="item-chip toy">Squeaky toy</div>');
    if (s.burrito > 0) chips.push(`<div class="item-chip burrito">Burrito x${s.burrito}</div>`);
    if (s.zoomies > 0) chips.push(`<div class="item-chip juice">Zoomies ${Math.ceil(s.zoomies)}s</div>`);
    this.set('items', chips.join(''), () => (this.itemSlot.innerHTML = chips.join('')));
    this.set('toyBtn', String(s.hasToy), () => this.toyButton.classList.toggle('is-empty', !s.hasToy));
    this.set('hidden', String(s.hidden), () => this.hideIndicator.classList.toggle('is-visible', s.hidden));

    if (this.bannerTimer > 0) {
      this.bannerTimer -= dt;
      if (this.bannerTimer <= 0) this.banner.classList.remove('is-visible');
    }
    if (this.hintTimer > 0) {
      this.hintTimer -= dt;
      if (this.hintTimer <= 0) this.hint.classList.remove('is-visible');
    }
  }

  showBanner(title: string, sub = '', tone: 'puke' | 'danger' | 'gold' | 'info' = 'puke', duration = 2.6) {
    const titleEl = this.banner.querySelector('.banner-title');
    const subEl = this.banner.querySelector('.banner-sub');
    if (titleEl) titleEl.textContent = title;
    if (subEl) subEl.textContent = sub;
    this.banner.className = `banner tone-${tone}`;
    void this.banner.offsetWidth;
    this.banner.classList.add('is-visible');
    this.bannerTimer = duration;
  }

  hideBanner() {
    this.banner.classList.remove('is-visible');
    this.bannerTimer = 0;
  }

  showHint(text: string, duration = 5) {
    this.hint.textContent = text;
    this.hint.classList.add('is-visible');
    this.hintTimer = duration;
  }

  clearHint() {
    this.hint.classList.remove('is-visible');
    this.hintTimer = 0;
  }
}
