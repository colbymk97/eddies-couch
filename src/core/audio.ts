import { safeStorageGet, safeStorageSet } from './util';

type AudioContextConstructor = new () => AudioContext;
type MusicMode = 'off' | 'calm' | 'chase' | 'title';

const VOWELS: [number, number][] = [
  [800, 1200],
  [420, 2000],
  [320, 2300],
  [520, 900],
  [360, 760],
  [650, 1700],
];

function midi(note: number) {
  return 440 * Math.pow(2, (note - 69) / 12);
}

export interface ChargeHandle {
  update(level: number): void;
  stop(): void;
}

/** Fully synthesized sound effects and music. Nothing is loaded from disk. */
export class Sound {
  private ctx?: AudioContext;
  private master?: GainNode;
  private sfxBus?: GainNode;
  private musicBus?: GainNode;
  private calmBus?: GainNode;
  private chaseBus?: GainNode;
  private noiseBuffer?: AudioBuffer;
  muted = safeStorageGet('eddie.muted') === '1';

  private musicMode: MusicMode = 'off';
  private schedulerId: number | undefined;
  private nextStepTime = 0;
  private step = 0;

  /** Must be called from a user gesture. */
  unlock() {
    if (!this.ctx) {
      const audioWindow = window as Window & { webkitAudioContext?: AudioContextConstructor };
      const Ctor = window.AudioContext || audioWindow.webkitAudioContext;
      if (!Ctor) return;
      const ctx = new Ctor();
      this.ctx = ctx;
      this.master = ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.8;
      const compressor = ctx.createDynamicsCompressor();
      compressor.threshold.value = -14;
      compressor.ratio.value = 4;
      this.master.connect(compressor).connect(ctx.destination);
      this.sfxBus = ctx.createGain();
      this.sfxBus.gain.value = 0.9;
      this.sfxBus.connect(this.master);
      this.musicBus = ctx.createGain();
      this.musicBus.gain.value = 0.32;
      this.musicBus.connect(this.master);
      this.calmBus = ctx.createGain();
      this.calmBus.gain.value = 0;
      this.calmBus.connect(this.musicBus);
      this.chaseBus = ctx.createGain();
      this.chaseBus.gain.value = 0;
      this.chaseBus.connect(this.musicBus);

      const length = ctx.sampleRate * 2;
      this.noiseBuffer = ctx.createBuffer(1, length, ctx.sampleRate);
      const data = this.noiseBuffer.getChannelData(0);
      for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => undefined);
  }

  toggleMute() {
    this.muted = !this.muted;
    safeStorageSet('eddie.muted', this.muted ? '1' : '0');
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(this.muted ? 0 : 0.8, this.ctx.currentTime, 0.05);
    }
    return this.muted;
  }

  // ---------------------------------------------------------------- primitives

  private get ready() {
    return Boolean(this.ctx && this.sfxBus && this.noiseBuffer);
  }

  private tone(
    freq: number,
    duration: number,
    options: {
      type?: OscillatorType;
      gain?: number;
      delay?: number;
      slideTo?: number;
      attack?: number;
      vibrato?: number;
      vibratoRate?: number;
      filter?: number;
      bus?: AudioNode;
    } = {},
  ) {
    if (!this.ctx || !this.sfxBus) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + (options.delay ?? 0);
    const osc = ctx.createOscillator();
    osc.type = options.type ?? 'sine';
    osc.frequency.setValueAtTime(freq, t);
    if (options.slideTo) osc.frequency.exponentialRampToValueAtTime(options.slideTo, t + duration);

    const gain = ctx.createGain();
    const peak = options.gain ?? 0.2;
    const attack = options.attack ?? 0.008;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(peak, t + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);

    let node: AudioNode = osc;
    if (options.filter) {
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = options.filter;
      node.connect(filter);
      node = filter;
    }
    node.connect(gain).connect(options.bus ?? this.sfxBus);

    if (options.vibrato) {
      const lfo = ctx.createOscillator();
      const lfoGain = ctx.createGain();
      lfo.frequency.value = options.vibratoRate ?? 6;
      lfoGain.gain.value = options.vibrato;
      lfo.connect(lfoGain).connect(osc.frequency);
      lfo.start(t);
      lfo.stop(t + duration + 0.05);
    }
    osc.start(t);
    osc.stop(t + duration + 0.05);
  }

  private noise(
    duration: number,
    options: {
      gain?: number;
      delay?: number;
      type?: BiquadFilterType;
      freq?: number;
      freqTo?: number;
      q?: number;
      attack?: number;
      bus?: AudioNode;
    } = {},
  ) {
    if (!this.ctx || !this.sfxBus || !this.noiseBuffer) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + (options.delay ?? 0);
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = options.type ?? 'lowpass';
    filter.frequency.setValueAtTime(options.freq ?? 1000, t);
    if (options.freqTo) filter.frequency.exponentialRampToValueAtTime(options.freqTo, t + duration);
    filter.Q.value = options.q ?? 0.8;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(options.gain ?? 0.2, t + (options.attack ?? 0.01));
    gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    src.connect(filter).connect(gain).connect(options.bus ?? this.sfxBus);
    src.start(t, Math.random() * 1.5);
    src.stop(t + duration + 0.05);
  }

  // ---------------------------------------------------------------- effects

  puke(power: number) {
    if (!this.ready || !this.ctx || !this.sfxBus) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const duration = 0.45 + power * 0.5;

    // Throaty "BLEHHH": a buzzing source pushed through moving vowel formants.
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(150 + power * 30, t);
    osc.frequency.exponentialRampToValueAtTime(80, t + duration);
    const wobble = ctx.createOscillator();
    const wobbleGain = ctx.createGain();
    wobble.frequency.value = 23;
    wobbleGain.gain.value = 28;
    wobble.connect(wobbleGain).connect(osc.frequency);

    const formantA = ctx.createBiquadFilter();
    formantA.type = 'bandpass';
    formantA.Q.value = 5;
    formantA.frequency.setValueAtTime(900, t);
    formantA.frequency.exponentialRampToValueAtTime(380, t + duration);
    const formantB = ctx.createBiquadFilter();
    formantB.type = 'bandpass';
    formantB.Q.value = 6;
    formantB.frequency.setValueAtTime(1500, t);
    formantB.frequency.exponentialRampToValueAtTime(700, t + duration);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.5 + power * 0.25, t + 0.04);
    gain.gain.setValueAtTime(0.5 + power * 0.25, t + duration * 0.6);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);

    osc.connect(formantA).connect(gain);
    osc.connect(formantB).connect(gain);
    gain.connect(this.sfxBus);
    osc.start(t);
    wobble.start(t);
    osc.stop(t + duration + 0.05);
    wobble.stop(t + duration + 0.05);

    // Wet gurgle on top.
    this.noise(duration, { type: 'bandpass', freq: 600, freqTo: 250, q: 4, gain: 0.35 + power * 0.2 });
  }

  splat(big = false) {
    this.noise(big ? 0.45 : 0.28, { freq: big ? 1600 : 1200, freqTo: 180, gain: big ? 0.55 : 0.4 });
    this.tone(big ? 110 : 140, 0.25, { slideTo: 38, gain: big ? 0.5 : 0.35 });
    this.noise(0.12, { type: 'highpass', freq: 3000, gain: 0.08, delay: 0.03 });
  }

  pickup() {
    this.noise(0.06, { type: 'bandpass', freq: 1800, q: 2, gain: 0.25 });
    this.tone(480, 0.16, { slideTo: 960, type: 'triangle', gain: 0.22, delay: 0.04 });
    this.tone(720, 0.14, { slideTo: 1440, type: 'sine', gain: 0.12, delay: 0.1 });
  }

  chomp() {
    for (let i = 0; i < 3; i += 1) {
      this.noise(0.07, { type: 'bandpass', freq: 900 + i * 200, q: 3, gain: 0.3, delay: i * 0.11 });
    }
  }

  ding() {
    this.tone(1568, 1.4, { gain: 0.28 });
    this.tone(2349, 1.0, { gain: 0.12 });
    this.tone(3136, 0.6, { gain: 0.06 });
  }

  microwaveHum(duration: number) {
    this.tone(120, duration, { type: 'sawtooth', gain: 0.025, filter: 400, attack: 0.2 });
  }

  alert() {
    this.tone(660, 0.12, { type: 'square', gain: 0.18, filter: 3000 });
    this.tone(1320, 0.35, { type: 'square', gain: 0.18, delay: 0.1, filter: 3500 });
    this.noise(0.25, { type: 'highpass', freq: 2500, gain: 0.15 });
  }

  question() {
    this.tone(500, 0.18, { slideTo: 760, type: 'triangle', gain: 0.18 });
  }

  slip() {
    this.tone(380, 0.55, { slideTo: 1500, type: 'sine', gain: 0.28, vibrato: 30, vibratoRate: 9 });
    this.thud(0.62);
    this.tone(180, 0.6, { slideTo: 120, type: 'sine', gain: 0.25, delay: 0.75, vibrato: 40, vibratoRate: 14 });
  }

  thud(delay = 0) {
    this.tone(120, 0.3, { slideTo: 35, gain: 0.6, delay });
    this.noise(0.25, { freq: 500, freqTo: 80, gain: 0.45, delay });
  }

  whoosh() {
    this.noise(0.35, { type: 'bandpass', freq: 400, freqTo: 2400, q: 1.5, gain: 0.2, attack: 0.1 });
  }

  squeak() {
    this.tone(1100, 0.12, { slideTo: 1900, type: 'square', gain: 0.1, filter: 4000 });
    this.tone(1900, 0.16, { slideTo: 1000, type: 'square', gain: 0.1, filter: 4000, delay: 0.14 });
  }

  heave() {
    this.tone(110, 0.25, { type: 'sawtooth', slideTo: 70, gain: 0.25, filter: 700 });
    this.noise(0.2, { type: 'bandpass', freq: 500, q: 3, gain: 0.2 });
  }

  pop() {
    this.tone(600, 0.08, { slideTo: 1200, gain: 0.15 });
  }

  click() {
    this.tone(900, 0.05, { type: 'triangle', gain: 0.12 });
  }

  zoomies() {
    for (let i = 0; i < 5; i += 1) {
      this.tone(500 + i * 160, 0.08, { type: 'square', gain: 0.07, delay: i * 0.05, filter: 3000 });
    }
  }

  ruined() {
    const notes = [60, 64, 67, 72];
    notes.forEach((n, i) => this.tone(midi(n), 0.22, { type: 'sawtooth', gain: 0.12, delay: i * 0.08, filter: 2400 }));
    [72, 76, 79].forEach((n) => this.tone(midi(n), 0.7, { type: 'square', gain: 0.07, delay: 0.34, filter: 2600 }));
    this.noise(0.6, { type: 'highpass', freq: 5000, gain: 0.06, delay: 0.34 });
  }

  caught() {
    [43, 42, 41, 40].forEach((n, i) =>
      this.tone(midi(n + 12), i === 3 ? 1.1 : 0.42, {
        type: 'sawtooth',
        gain: 0.2,
        delay: i * 0.45,
        filter: 900,
        vibrato: i === 3 ? 7 : 0,
        vibratoRate: 6,
      }),
    );
  }

  fanfare() {
    const seq = [60, 64, 67, 72, 67, 72, 76, 79];
    seq.forEach((n, i) => this.tone(midi(n), 0.2, { type: 'square', gain: 0.09, delay: i * 0.11, filter: 3200 }));
    [72, 76, 79, 84].forEach((n) => this.tone(midi(n), 1.4, { type: 'sawtooth', gain: 0.06, delay: 0.9, filter: 2600 }));
  }

  snore() {
    this.noise(1.4, { freq: 380, gain: 0.12, attack: 0.9 });
    this.tone(62, 1.2, { type: 'sawtooth', gain: 0.05, filter: 260, attack: 0.8 });
    this.noise(0.9, { type: 'highpass', freq: 1800, gain: 0.03, delay: 1.5, attack: 0.3 });
  }

  /** Gibberish voice, Animal-Crossing style. */
  voice(syllables: number, opts: { pitch: number; angry?: boolean; speed?: number }) {
    if (!this.ctx || !this.sfxBus) return;
    const ctx = this.ctx;
    const count = Math.max(1, Math.min(syllables, 14));
    const step = (opts.angry ? 0.075 : 0.095) / (opts.speed ?? 1);
    for (let i = 0; i < count; i += 1) {
      const t = ctx.currentTime + i * step;
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      const base = opts.pitch * (0.85 + Math.random() * 0.35) * (opts.angry ? 1.15 : 1);
      osc.frequency.setValueAtTime(base, t);
      osc.frequency.linearRampToValueAtTime(base * (0.9 + Math.random() * 0.25), t + step);
      const [f1, f2] = VOWELS[Math.floor(Math.random() * VOWELS.length)];
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(opts.angry ? 0.32 : 0.22, t + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + step * 0.92);
      for (const f of [f1, f2]) {
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = f * (opts.pitch > 250 ? 1.3 : 1);
        bp.Q.value = 7;
        osc.connect(bp).connect(gain);
      }
      gain.connect(this.sfxBus);
      osc.start(t);
      osc.stop(t + step);
    }
  }

  chargeStart(): ChargeHandle {
    if (!this.ctx || !this.sfxBus) return { update: () => undefined, stop: () => undefined };
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = 60;
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    lfo.frequency.value = 14;
    lfoGain.gain.value = 10;
    lfo.connect(lfoGain).connect(osc.frequency);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 300;
    filter.Q.value = 6;
    const gain = ctx.createGain();
    gain.gain.value = 0.0001;
    osc.connect(filter).connect(gain).connect(this.sfxBus);
    osc.start();
    lfo.start();
    let stopped = false;
    return {
      update: (level: number) => {
        if (stopped) return;
        const now = ctx.currentTime;
        osc.frequency.setTargetAtTime(60 + level * 90, now, 0.05);
        filter.frequency.setTargetAtTime(300 + level * 900, now, 0.05);
        gain.gain.setTargetAtTime(0.05 + level * 0.18, now, 0.05);
        lfo.frequency.setTargetAtTime(14 + level * 20, now, 0.05);
      },
      stop: () => {
        if (stopped) return;
        stopped = true;
        const now = ctx.currentTime;
        gain.gain.setTargetAtTime(0.0001, now, 0.03);
        osc.stop(now + 0.2);
        lfo.stop(now + 0.2);
      },
    };
  }

  // ---------------------------------------------------------------- music

  setMusic(mode: MusicMode) {
    if (!this.ctx || !this.calmBus || !this.chaseBus) {
      this.musicMode = mode;
      return;
    }
    if (mode === this.musicMode && this.schedulerId !== undefined) return;
    const now = this.ctx.currentTime;
    const calm = mode === 'calm' || mode === 'title';
    this.calmBus.gain.setTargetAtTime(calm ? (mode === 'title' ? 0.8 : 1) : 0, now, 0.4);
    this.chaseBus.gain.setTargetAtTime(mode === 'chase' ? 1 : 0, now, 0.25);
    this.musicMode = mode;
    if (mode === 'off') return;
    if (this.schedulerId === undefined) {
      this.nextStepTime = now + 0.08;
      this.step = 0;
      this.schedulerId = window.setInterval(() => this.schedule(), 25);
    }
  }

  private schedule() {
    if (!this.ctx) return;
    const chase = this.musicMode === 'chase';
    const bpm = chase ? 152 : 104;
    const stepDur = 60 / bpm / 4;
    while (this.nextStepTime < this.ctx.currentTime + 0.12) {
      this.playStep(this.step, this.nextStepTime, stepDur);
      this.nextStepTime += stepDur;
      this.step = (this.step + 1) % 64;
    }
  }

  private playStep(step: number, t: number, stepDur: number) {
    if (!this.ctx || !this.calmBus || !this.chaseBus) return;
    const bar = Math.floor(step / 16) % 4;
    const s = step % 16;

    // Calm "sneaky" layer: pizzicato walking bass + marimba plinks.
    const calmRoots = [50, 48, 46, 45];
    const walk = [0, 7, 3, 7];
    if (s % 4 === 0) {
      this.pluck(midi(calmRoots[bar] - 12 + walk[s / 4]), t, 0.3, 0.42, this.calmBus, 'triangle');
    }
    if (s === 6 || s === 14) {
      this.pluck(midi(calmRoots[bar] - 12 + 12), t, 0.16, 0.18, this.calmBus, 'triangle');
    }
    const melody = [62, -1, 65, -1, 69, -1, 67, 65, -1, -1, 62, -1, 64, -1, 60, -1];
    const melodyB = [69, -1, 67, -1, 65, -1, 64, -1, 62, -1, -1, 65, 64, -1, 62, -1];
    const line = bar % 2 === 0 ? melody : melodyB;
    if (line[s] > 0 && (bar < 2 || s % 2 === 0)) {
      this.marimba(midi(line[s] + 12), t, this.calmBus);
    }
    if (s % 4 === 2) this.hat(t, 0.025, this.calmBus);

    // Chase layer: driving bass, drums, stabs.
    const chaseRoots = [38, 34, 36, 33];
    const root = chaseRoots[bar];
    if (s % 2 === 0) {
      const octave = s % 4 === 2 ? 12 : 0;
      this.pluck(midi(root + octave), t, stepDur * 1.8, 0.32, this.chaseBus, 'sawtooth', 900);
    }
    if (s === 0 || s === 8 || s === 10) this.kick(t, this.chaseBus);
    if (s === 4 || s === 12) this.snare(t, this.chaseBus);
    if (s % 2 === 1) this.hat(t, 0.05, this.chaseBus);
    if (s === 0 || s === 6 || s === 12) {
      for (const interval of [12, 15, 19]) {
        this.pluck(midi(root + interval + 12), t, 0.12, 0.06, this.chaseBus, 'square', 2600);
      }
    }
    const lead = [74, 72, 74, 77, 76, 74, 72, 69];
    if (bar >= 2 && s % 2 === 0) {
      this.pluck(midi(lead[s / 2] + (bar === 3 ? -2 : 0)), t, 0.1, 0.05, this.chaseBus, 'square', 3000);
    }
  }

  private pluck(
    freq: number,
    t: number,
    duration: number,
    gainValue: number,
    bus: AudioNode,
    type: OscillatorType,
    filterFreq = 1400,
  ) {
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(filterFreq, t);
    filter.frequency.exponentialRampToValueAtTime(Math.max(120, filterFreq * 0.25), t + duration);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(gainValue, t + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    osc.connect(filter).connect(gain).connect(bus);
    osc.start(t);
    osc.stop(t + duration + 0.02);
  }

  private marimba(freq: number, t: number, bus: AudioNode) {
    this.pluck(freq, t, 0.4, 0.16, bus, 'sine', 5000);
    this.pluck(freq * 4, t, 0.08, 0.04, bus, 'sine', 8000);
  }

  private hat(t: number, gainValue: number, bus: AudioNode) {
    if (!this.ctx || !this.noiseBuffer) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 7000;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(gainValue, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    src.connect(filter).connect(gain).connect(bus);
    src.start(t, Math.random());
    src.stop(t + 0.06);
  }

  private kick(t: number, bus: AudioNode) {
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    osc.frequency.setValueAtTime(140, t);
    osc.frequency.exponentialRampToValueAtTime(40, t + 0.14);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.6, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
    osc.connect(gain).connect(bus);
    osc.start(t);
    osc.stop(t + 0.22);
  }

  private snare(t: number, bus: AudioNode) {
    if (!this.ctx || !this.noiseBuffer) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 1800;
    filter.Q.value = 0.7;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.32, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    src.connect(filter).connect(gain).connect(bus);
    src.start(t, Math.random());
    src.stop(t + 0.18);
  }
}
