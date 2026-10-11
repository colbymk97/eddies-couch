import type { CouchState } from '../game/types';
import type { Role } from '../actors/cast';
import { formatTime } from '../core/util';

const PEPPER = `<svg class="pepper" viewBox="0 0 24 32"><path d="M12 6c-2-4 2-6 4-4" fill="none" stroke="#2f7d32" stroke-width="3" stroke-linecap="round"/><path d="M7 9c3-3 9-3 11 1 3 6-1 16-8 20-3 1-5-1-4-4 2-5-2-11 1-17z" fill="#ff3b30" stroke="#241730" stroke-width="2.5"/><path d="M10 12c1-1 3-1 4 0" stroke="#fff" stroke-width="2" stroke-linecap="round" opacity=".6"/></svg>`;
const HEART = `<svg class="heart" viewBox="0 0 32 30"><path d="M16 28C6 20 2 15 2 9.5 2 5.4 5.3 2 9.4 2c2.7 0 5 1.4 6.6 3.6C17.6 3.4 19.9 2 22.6 2 26.7 2 30 5.4 30 9.5 30 15 26 20 16 28z" fill="#ff4d6d" stroke="#241730" stroke-width="3" stroke-linejoin="round"/><path d="M8 8c1-2 3-2.5 4.5-2" stroke="#fff" stroke-width="2.4" stroke-linecap="round" opacity=".7" fill="none"/></svg>`;

export interface HudState {
  role: Role;
  couches: CouchState[];
  targetCouch: CouchState | null;
  score: number;
  combo: number;
  lives: number;
  maxLives: number;
  ammo: number;
  stamina: number;
  tired: boolean;
  bloat: number;
  emergency: number;
  eddie: { label: string; tone: 'calm' | 'warn' | 'danger' | 'good' };
  rage: number;
  hasToy: boolean;
  burrito: number;
  zoomies: number;
  hidden: boolean;
  /** Eddie mode. */
  clock: number;
  catches: number;
  ruinLimit: number;
  /** Context word for the big touch button (Eddie: GRAB or SCRUB). */
  actionLabel: string;
  /** 0..1 fill for the touch button ring when not showing ammo. */
  ring: number;
  ally: string | null;
}

function el<T extends HTMLElement>(id: string) {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing #${id}`);
  return node as T;
}

export class Hud {
  readonly root = el<HTMLDivElement>('hud');
  private readonly couchCount = el<HTMLSpanElement>('couch-count');
  private readonly couchMax = el<HTMLElement>('couch-max');
  private readonly couchLabel = el<HTMLDivElement>('couch-label');
  private readonly couchIcons = el<HTMLDivElement>('couch-icons');
  private readonly eddieStatus = el<HTMLDivElement>('eddie-status');
  private readonly eddieLabel = el<HTMLDivElement>('eddie-label');
  private readonly eddieState = el<HTMLDivElement>('eddie-state');
  private readonly rage = el<HTMLDivElement>('rage');
  private readonly score = el<HTMLDivElement>('score');
  private readonly combo = el<HTMLDivElement>('combo');
  private readonly livesLabel = el<HTMLDivElement>('lives-label');
  private readonly lives = el<HTMLDivElement>('lives');
  private readonly tummyPanel = document.querySelector<HTMLDivElement>('.tummy-panel');
  private readonly tummyFill = document.getElementById('tummy-fill') as unknown as SVGRectElement;
  private readonly tummyWave = document.getElementById('tummy-wave') as unknown as SVGPathElement;
  private readonly tummyLabel = el<HTMLDivElement>('tummy-label');
  private readonly tummyText = el<HTMLDivElement>('tummy-text');
  private readonly staminaLabel = el<HTMLDivElement>('stamina-label');
  private readonly staminaFill = el<HTMLDivElement>('stamina-fill');
  private readonly gutFill = el<HTMLDivElement>('gut-fill');
  private readonly gutMini = el<HTMLDivElement>('gut-mini-fill');
  private readonly itemSlot = el<HTMLDivElement>('item-slot');
  private readonly hint = el<HTMLDivElement>('hint');
  private readonly hideIndicator = el<HTMLDivElement>('hide-indicator');
  private readonly banner = el<HTMLDivElement>('banner');
  private readonly toyButton = el<HTMLButtonElement>('toy-button');
  private readonly pukeButton = el<HTMLButtonElement>('puke-button');
  private readonly pukeLabel = el<HTMLElement>('hurl-label');
  private readonly hurlRing = document.getElementById('hurl-ring-fill') as unknown as SVGCircleElement;
  private readonly hurlTummy = el<HTMLElement>('hurl-tummy');
  private readonly hurlStamina = el<HTMLElement>('hurl-stamina-fill');
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

  /** Relabels everything for the chosen character. */
  setRole(role: Role, action: string, secondary: string) {
    this.last = {};
    document.body.classList.remove('role-theo', 'role-zach', 'role-eddie');
    document.body.classList.add(`role-${role}`);
    this.couchLabel.textContent = role === 'eddie' ? 'Ruined couches' : 'Couches ruined';
    this.eddieLabel.textContent = role === 'eddie' ? 'Bedtime in' : 'Eddie is';
    this.livesLabel.textContent = role === 'eddie' ? 'Caught' : 'Hearts';
    this.tummyLabel.textContent = role === 'zach' ? 'Sauce' : 'Tummy';
    this.staminaLabel.textContent = role === 'zach' ? 'Pre-workout' : role === 'eddie' ? 'Hustle' : 'Zoomies';
    this.pukeLabel.textContent = action;
    this.toyButton.textContent = secondary;
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
    const eddieMode = s.role === 'eddie';
    let ruined = 0;
    for (const icon of this.iconEls) {
      const messed = icon.couch.seats.filter((seat) => seat.messed);
      const pct = Math.round((messed.length / icon.couch.seats.length) * 100);
      const sauce = messed.length > 0 && messed.filter((seat) => seat.mess === 'sauce').length >= messed.length / 2;
      if (icon.couch.ruined) ruined += 1;
      const setting = icon.couch.setting > 0;
      this.set(`icon-${icon.couch.def.id}`, `${pct}-${icon.couch.ruined}-${s.targetCouch === icon.couch}-${sauce}-${setting}`, () => {
        icon.node.classList.toggle('is-setting', setting);
        icon.fill.style.height = `${pct}%`;
        icon.node.classList.toggle('is-ruined', icon.couch.ruined);
        icon.node.classList.toggle('is-target', s.targetCouch === icon.couch);
        icon.node.classList.toggle('is-sauce', sauce);
      });
    }
    this.set('count', `${ruined}/${eddieMode}`, () => {
      this.couchCount.textContent = String(ruined);
      this.couchMax.textContent = eddieMode ? `/${s.ruinLimit} max` : '/9';
    });

    if (eddieMode) {
      const tone = s.clock < 20 ? 'good' : s.clock < 60 ? 'calm' : 'warn';
      this.set('eddie', `clock|${Math.ceil(s.clock)}|${tone}`, () => {
        this.eddieState.textContent = formatTime(Math.ceil(s.clock));
        this.eddieStatus.className = `panel eddie-status tone-${tone}`;
      });
    } else {
      this.set('eddie', `${s.eddie.label}|${s.eddie.tone}`, () => {
        this.eddieState.textContent = s.eddie.label;
        this.eddieStatus.className = `panel eddie-status tone-${s.eddie.tone}`;
      });
    }
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
    if (eddieMode) {
      this.set('lives', `catches-${s.catches}`, () => (this.lives.innerHTML = `<div class="catch-count">${s.catches}</div>`));
    } else {
      this.set('lives', `${s.lives}/${s.maxLives}`, () => {
        this.lives.innerHTML = Array.from({ length: s.maxLives }, (_, i) => HEART.replace('class="heart"', `class="heart${i < s.lives ? '' : ' is-lost'}"`)).join('');
      });
    }

    // Ammo liquid with a sloshing wave.
    this.wave += dt;
    const level = 92 - (s.ammo / 100) * 84;
    this.tummyFill.setAttribute('y', String(level + 2));
    const offset = (this.wave * 30) % 50;
    this.tummyWave.setAttribute('transform', `translate(${-offset} ${level - 40})`);
    this.set('tummy', String(Math.round(s.ammo)), () => (this.tummyText.textContent = `${Math.round(s.ammo)}%`));
    this.tummyPanel?.classList.toggle('is-low', s.ammo < 18 && !eddieMode);
    this.tummyPanel?.classList.toggle('is-burrito', s.burrito > 0);

    this.staminaFill.style.width = `${Math.round(s.stamina * 100)}%`;
    this.staminaFill.classList.toggle('is-tired', s.tired);
    const gut = `${Math.round(s.emergency > 0 ? 100 : s.bloat)}%`;
    const gutDanger = s.bloat > 55 || s.emergency > 0;
    for (const fill of [this.gutFill, this.gutMini]) {
      fill.style.width = gut;
      fill.classList.toggle('is-danger', gutDanger);
    }

    // Touch: ammo is a ring around the action button, stamina a bar inside it.
    const ring = eddieMode ? s.ring : s.ammo / 100;
    this.set('ring', ring.toFixed(2), () => (this.hurlRing.style.strokeDashoffset = String(289 * (1 - ring))));
    const sub = eddieMode ? '' : s.burrito > 0 ? `BURRITO x${s.burrito}` : `${Math.round(s.ammo)}%`;
    this.set('hurlSub', sub, () => (this.hurlTummy.textContent = sub));
    this.set('actionLabel', s.actionLabel, () => (this.pukeLabel.textContent = s.actionLabel));
    this.set('burritoBtn', String(s.burrito), () => this.pukeButton.classList.toggle('is-burrito', s.burrito > 0));
    this.pukeButton.classList.toggle('is-low', !eddieMode && s.ammo < 18 && s.burrito <= 0);
    this.pukeButton.classList.toggle('is-blocked', s.emergency > 0);
    this.hurlStamina.style.width = `${Math.round(s.stamina * 100)}%`;
    this.hurlStamina.parentElement?.classList.toggle('is-tired', s.tired);

    const chips: string[] = [];
    if (s.emergency > 0) chips.push(`<div class="item-chip emergency">Gut emergency! Bidet ${Math.ceil(s.emergency)}s</div>`);
    if (s.hasToy) chips.push('<div class="item-chip toy">Squeaky toy</div>');
    if (s.burrito > 0) chips.push(`<div class="item-chip burrito">Burrito x${s.burrito}</div>`);
    if (s.zoomies > 0) chips.push(`<div class="item-chip juice">${s.role === 'zach' ? 'Pre-workout' : 'Zoomies'} ${Math.ceil(s.zoomies)}s</div>`);
    if (s.ally) chips.push(`<div class="item-chip ally">${s.ally}</div>`);
    const html = chips.join('');
    this.set('items', html, () => (this.itemSlot.innerHTML = html));
    this.set('toyBtn', `${s.hasToy}-${eddieMode}`, () => this.toyButton.classList.toggle('is-empty', !eddieMode && !s.hasToy));
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

  showBanner(title: string, sub = '', tone: 'puke' | 'danger' | 'gold' | 'info' | 'brown' = 'puke', duration = 2.6) {
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
