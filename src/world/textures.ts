import * as THREE from 'three';
import { TAU, rand } from '../core/util';

export const DISPLAY_FONT = '"Luckiest Guy", "Arial Black", Impact, sans-serif';
export const BODY_FONT = '"Fredoka", "Trebuchet MS", system-ui, sans-serif';

let maxAnisotropy = 4;
export function setMaxAnisotropy(value: number) {
  maxAnisotropy = Math.min(8, value);
}

type Draw = (ctx: CanvasRenderingContext2D, w: number, h: number) => void;

export function canvasTexture(width: number, height: number, draw: Draw, options: { repeat?: [number, number]; srgb?: boolean } = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (ctx) draw(ctx, width, height);
  const texture = new THREE.CanvasTexture(canvas);
  if (options.srgb !== false) texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = maxAnisotropy;
  if (options.repeat) {
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(options.repeat[0], options.repeat[1]);
  }
  return texture;
}

function speckle(ctx: CanvasRenderingContext2D, w: number, h: number, count: number, alpha: number, size = 2) {
  for (let i = 0; i < count; i += 1) {
    const v = Math.random() < 0.5 ? 0 : 255;
    ctx.fillStyle = `rgba(${v},${v},${v},${Math.random() * alpha})`;
    ctx.fillRect(Math.random() * w, Math.random() * h, size, size);
  }
}

// ------------------------------------------------------------------ floors

export function woodFloorTexture() {
  return canvasTexture(
    1024,
    1024,
    (ctx, w, h) => {
      const rows = 8;
      const rowH = h / rows;
      const tones = ['#b77a45', '#c4864f', '#a96d3b', '#bd7f49', '#cf9259', '#b0743f'];
      for (let r = 0; r < rows; r += 1) {
        let x = -Math.random() * 300;
        while (x < w) {
          const len = 260 + Math.random() * 320;
          ctx.fillStyle = tones[Math.floor(Math.random() * tones.length)];
          ctx.fillRect(x, r * rowH, len, rowH);
          // Grain.
          for (let g = 0; g < 14; g += 1) {
            ctx.strokeStyle = `rgba(70,35,12,${0.05 + Math.random() * 0.12})`;
            ctx.lineWidth = 1 + Math.random() * 2;
            ctx.beginPath();
            const y0 = r * rowH + Math.random() * rowH;
            ctx.moveTo(x, y0);
            for (let s = 0; s <= 10; s += 1) {
              ctx.lineTo(x + (len * s) / 10, y0 + Math.sin(s * 0.9 + g) * 3);
            }
            ctx.stroke();
          }
          if (Math.random() < 0.35) {
            ctx.fillStyle = 'rgba(80,40,15,0.35)';
            ctx.beginPath();
            ctx.ellipse(x + Math.random() * len, r * rowH + rowH / 2, 10, 5, 0, 0, TAU);
            ctx.fill();
          }
          ctx.fillStyle = 'rgba(40,20,8,0.75)';
          ctx.fillRect(x, r * rowH, 3, rowH);
          x += len;
        }
        ctx.fillStyle = 'rgba(40,20,8,0.7)';
        ctx.fillRect(0, r * rowH, w, 3);
      }
      speckle(ctx, w, h, 4000, 0.06);
    },
    { repeat: [3, 3] },
  );
}

export function tileFloorTexture() {
  return canvasTexture(
    512,
    512,
    (ctx, w, h) => {
      const n = 4;
      const s = w / n;
      for (let i = 0; i < n; i += 1) {
        for (let j = 0; j < n; j += 1) {
          ctx.fillStyle = (i + j) % 2 === 0 ? '#f3ead7' : '#3f8f8a';
          ctx.fillRect(i * s, j * s, s, s);
          const g = ctx.createLinearGradient(i * s, j * s, i * s + s, j * s + s);
          g.addColorStop(0, 'rgba(255,255,255,0.12)');
          g.addColorStop(1, 'rgba(0,0,0,0.08)');
          ctx.fillStyle = g;
          ctx.fillRect(i * s, j * s, s, s);
        }
      }
      ctx.strokeStyle = '#cbbfa6';
      ctx.lineWidth = 5;
      for (let i = 0; i <= n; i += 1) {
        ctx.beginPath();
        ctx.moveTo(i * s, 0);
        ctx.lineTo(i * s, h);
        ctx.moveTo(0, i * s);
        ctx.lineTo(w, i * s);
        ctx.stroke();
      }
      speckle(ctx, w, h, 2500, 0.05);
    },
    { repeat: [5, 5] },
  );
}

export function carpetTexture(base: string, fleck: string) {
  return canvasTexture(
    256,
    256,
    (ctx, w, h) => {
      ctx.fillStyle = base;
      ctx.fillRect(0, 0, w, h);
      for (let i = 0; i < 9000; i += 1) {
        ctx.fillStyle = Math.random() < 0.5 ? fleck : `rgba(0,0,0,${Math.random() * 0.12})`;
        ctx.globalAlpha = Math.random() * 0.35;
        ctx.fillRect(Math.random() * w, Math.random() * h, 2, 2);
      }
      ctx.globalAlpha = 1;
    },
    { repeat: [8, 8] },
  );
}

export function grassTexture() {
  return canvasTexture(
    512,
    512,
    (ctx, w, h) => {
      ctx.fillStyle = '#6aa548';
      ctx.fillRect(0, 0, w, h);
      for (let i = 0; i < 300; i += 1) {
        ctx.fillStyle = `rgba(${Math.random() < 0.5 ? '40,90,30' : '150,200,90'},${0.08 + Math.random() * 0.1})`;
        ctx.beginPath();
        ctx.arc(Math.random() * w, Math.random() * h, 10 + Math.random() * 40, 0, TAU);
        ctx.fill();
      }
      for (let i = 0; i < 9000; i += 1) {
        const x = Math.random() * w;
        const y = Math.random() * h;
        ctx.strokeStyle = `rgba(${Math.random() < 0.5 ? '45,100,35' : '165,215,100'},${0.3 + Math.random() * 0.4})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + rand(-2, 2), y - rand(3, 7));
        ctx.stroke();
      }
    },
    { repeat: [14, 14] },
  );
}

// ------------------------------------------------------------------ walls

export type WallpaperKind = 'kitchen' | 'den' | 'hall' | 'living' | 'bedroom' | 'exterior';

export function wallpaperTexture(kind: WallpaperKind) {
  return canvasTexture(
    512,
    512,
    (ctx, w, h) => {
      switch (kind) {
        case 'living': {
          ctx.fillStyle = '#e9c98f';
          ctx.fillRect(0, 0, w, h);
          for (let x = 0; x < w; x += 64) {
            ctx.fillStyle = 'rgba(190,120,60,0.22)';
            ctx.fillRect(x, 0, 26, h);
            ctx.fillStyle = 'rgba(255,255,255,0.18)';
            ctx.fillRect(x + 30, 0, 4, h);
          }
          break;
        }
        case 'kitchen': {
          ctx.fillStyle = '#d9ecd9';
          ctx.fillRect(0, 0, w, h);
          for (let y = 0; y < h; y += 64) {
            for (let x = (y / 64) % 2 === 0 ? 0 : 32; x < w; x += 64) {
              // Tiny hotdog buns. Obviously.
              ctx.fillStyle = '#e7b56d';
              ctx.beginPath();
              ctx.ellipse(x + 16, y + 20, 12, 5, -0.4, 0, TAU);
              ctx.fill();
              ctx.strokeStyle = '#b57a3a';
              ctx.lineWidth = 1.5;
              ctx.beginPath();
              ctx.moveTo(x + 7, y + 24);
              ctx.lineTo(x + 25, y + 16);
              ctx.stroke();
            }
          }
          break;
        }
        case 'den': {
          ctx.fillStyle = '#8f5f73';
          ctx.fillRect(0, 0, w, h);
          ctx.strokeStyle = 'rgba(255,220,180,0.18)';
          ctx.lineWidth = 3;
          for (let y = -64; y < h + 64; y += 64) {
            for (let x = 0; x < w + 64; x += 64) {
              ctx.beginPath();
              ctx.moveTo(x, y + 32);
              ctx.lineTo(x + 32, y);
              ctx.lineTo(x + 64, y + 32);
              ctx.lineTo(x + 32, y + 64);
              ctx.closePath();
              ctx.stroke();
              ctx.fillStyle = 'rgba(255,220,180,0.22)';
              ctx.beginPath();
              ctx.arc(x + 32, y + 32, 4, 0, TAU);
              ctx.fill();
            }
          }
          break;
        }
        case 'hall': {
          ctx.fillStyle = '#2f5546';
          ctx.fillRect(0, 0, w, h);
          ctx.fillStyle = 'rgba(214,176,92,0.35)';
          for (let y = 0; y < h; y += 85) {
            for (let x = (y / 85) % 2 === 0 ? 0 : 42; x < w; x += 85) {
              // Little paw prints.
              ctx.beginPath();
              ctx.ellipse(x + 20, y + 28, 7, 6, 0, 0, TAU);
              ctx.fill();
              for (let k = 0; k < 4; k += 1) {
                ctx.beginPath();
                ctx.arc(x + 11 + k * 6, y + 18 - (k === 1 || k === 2 ? 4 : 0), 2.6, 0, TAU);
                ctx.fill();
              }
            }
          }
          break;
        }
        case 'bedroom': {
          ctx.fillStyle = '#b8c8e6';
          ctx.fillRect(0, 0, w, h);
          ctx.fillStyle = 'rgba(255,255,255,0.45)';
          for (let i = 0; i < 70; i += 1) {
            const x = Math.random() * w;
            const y = Math.random() * h;
            ctx.save();
            ctx.translate(x, y);
            ctx.rotate(Math.random());
            drawStar(ctx, 0, 0, 5, 7, 3);
            ctx.restore();
          }
          break;
        }
        case 'exterior': {
          ctx.fillStyle = '#e6dccb';
          ctx.fillRect(0, 0, w, h);
          ctx.fillStyle = 'rgba(120,100,80,0.18)';
          for (let y = 0; y < h; y += 32) ctx.fillRect(0, y, w, 4);
          break;
        }
      }
      speckle(ctx, w, h, 1500, 0.05);
    },
    { repeat: [1, 1] },
  );
}

function drawStar(ctx: CanvasRenderingContext2D, x: number, y: number, points: number, outer: number, inner: number) {
  ctx.beginPath();
  for (let i = 0; i < points * 2; i += 1) {
    const r = i % 2 === 0 ? outer : inner;
    const a = (i / (points * 2)) * TAU - Math.PI / 2;
    ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
  }
  ctx.closePath();
  ctx.fill();
}

// ------------------------------------------------------------------ fabrics

export function weaveTexture() {
  return canvasTexture(
    256,
    256,
    (ctx, w, h) => {
      ctx.fillStyle = '#e8e8e8';
      ctx.fillRect(0, 0, w, h);
      for (let y = 0; y < h; y += 4) {
        for (let x = 0; x < w; x += 4) {
          const v = 200 + Math.random() * 55;
          ctx.fillStyle = `rgb(${v},${v},${v})`;
          ctx.fillRect(x, y, (x / 4 + y / 4) % 2 === 0 ? 4 : 2, (x / 4 + y / 4) % 2 === 0 ? 2 : 4);
        }
      }
      speckle(ctx, w, h, 3000, 0.08, 1);
    },
    { repeat: [2, 2] },
  );
}

export function corduroyTexture() {
  return canvasTexture(
    256,
    256,
    (ctx, w, h) => {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, w, h);
      for (let x = 0; x < w; x += 8) {
        const g = ctx.createLinearGradient(x, 0, x + 8, 0);
        g.addColorStop(0, '#9c9c9c');
        g.addColorStop(0.5, '#ffffff');
        g.addColorStop(1, '#9c9c9c');
        ctx.fillStyle = g;
        ctx.fillRect(x, 0, 8, h);
      }
      speckle(ctx, w, h, 2000, 0.08, 1);
    },
    { repeat: [3, 3] },
  );
}

export function leatherTexture() {
  return canvasTexture(
    256,
    256,
    (ctx, w, h) => {
      ctx.fillStyle = '#f0f0f0';
      ctx.fillRect(0, 0, w, h);
      for (let i = 0; i < 500; i += 1) {
        ctx.strokeStyle = `rgba(0,0,0,${0.05 + Math.random() * 0.08})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        let x = Math.random() * w;
        let y = Math.random() * h;
        ctx.moveTo(x, y);
        for (let s = 0; s < 4; s += 1) {
          x += rand(-10, 10);
          y += rand(-10, 10);
          ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      speckle(ctx, w, h, 3000, 0.06, 2);
    },
    { repeat: [2, 2] },
  );
}

export function hawaiianTexture() {
  return canvasTexture(
    512,
    512,
    (ctx, w, h) => {
      ctx.fillStyle = '#1d8fb3';
      ctx.fillRect(0, 0, w, h);
      for (let i = 0; i < 40; i += 1) {
        const x = Math.random() * w;
        const y = Math.random() * h;
        ctx.fillStyle = '#2f9e57';
        for (let k = 0; k < 3; k += 1) {
          ctx.save();
          ctx.translate(x, y);
          ctx.rotate(Math.random() * TAU);
          ctx.beginPath();
          ctx.ellipse(28, 0, 30, 9, 0, 0, TAU);
          ctx.fill();
          ctx.restore();
        }
      }
      const petals = ['#ff5a7a', '#ffcc33', '#ff8a3d', '#ffffff'];
      for (let i = 0; i < 46; i += 1) {
        const x = Math.random() * w;
        const y = Math.random() * h;
        const r = 12 + Math.random() * 14;
        ctx.fillStyle = petals[i % petals.length];
        for (let p = 0; p < 5; p += 1) {
          const a = (p / 5) * TAU;
          ctx.beginPath();
          ctx.ellipse(x + Math.cos(a) * r * 0.7, y + Math.sin(a) * r * 0.7, r * 0.65, r * 0.42, a, 0, TAU);
          ctx.fill();
        }
        ctx.fillStyle = '#ffe680';
        ctx.beginPath();
        ctx.arc(x, y, r * 0.25, 0, TAU);
        ctx.fill();
      }
    },
    { repeat: [1, 1] },
  );
}

export function onesieTexture() {
  return canvasTexture(
    256,
    256,
    (ctx, w, h) => {
      ctx.fillStyle = '#7cc4ef';
      ctx.fillRect(0, 0, w, h);
      for (let y = 10; y < h; y += 42) {
        for (let x = (y / 42) % 2 === 0 ? 12 : 34; x < w; x += 46) {
          ctx.fillStyle = '#ffd84a';
          ctx.beginPath();
          ctx.ellipse(x, y + 8, 9, 6, 0, 0, TAU);
          ctx.fill();
          ctx.beginPath();
          ctx.arc(x + 7, y + 1, 5, 0, TAU);
          ctx.fill();
          ctx.fillStyle = '#ff9a2e';
          ctx.fillRect(x + 11, y, 4, 2);
        }
      }
    },
    { repeat: [2, 1] },
  );
}

export function bibTexture() {
  return canvasTexture(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#ff6b8a';
    ctx.lineWidth = 12;
    ctx.strokeRect(6, 6, w - 12, h - 12);
    ctx.fillStyle = '#d4384f';
    ctx.textAlign = 'center';
    ctx.font = `58px ${DISPLAY_FONT}`;
    ctx.fillText("BABY'S", w / 2, 92);
    ctx.fillText('FIRST', w / 2, 152);
    ctx.fillStyle = '#5aa82e';
    ctx.font = `70px ${DISPLAY_FONT}`;
    ctx.fillText('HURL', w / 2, 222);
  });
}

// ------------------------------------------------------------------ puke

export function pukeSplatTexture(seed: number) {
  return canvasTexture(256, 256, (ctx, w, h) => {
    const cx = w / 2;
    const cy = h / 2;
    const blobs: [number, number, number][] = [];
    blobs.push([cx, cy, 62]);
    const count = 14 + (seed % 5) * 2;
    for (let i = 0; i < count; i += 1) {
      const a = Math.random() * TAU;
      const d = 30 + Math.random() * 62;
      blobs.push([cx + Math.cos(a) * d, cy + Math.sin(a) * d, 10 + Math.random() * 26]);
    }
    for (let i = 0; i < 10; i += 1) {
      const a = Math.random() * TAU;
      const d = 90 + Math.random() * 25;
      blobs.push([cx + Math.cos(a) * d, cy + Math.sin(a) * d, 4 + Math.random() * 7]);
    }

    // Dark rim, then body, then glossy highlight.
    ctx.fillStyle = '#5f8a1d';
    for (const [x, y, r] of blobs) {
      ctx.beginPath();
      ctx.arc(x, y, r + 4, 0, TAU);
      ctx.fill();
    }
    for (const [x, y, r] of blobs) {
      const g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.1, x, y, r);
      g.addColorStop(0, '#d9ef6a');
      g.addColorStop(0.6, '#a8cf3a');
      g.addColorStop(1, '#86b42a');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, TAU);
      ctx.fill();
    }
    // Chunks: carrots, bun bits, mystery.
    const chunkColors = ['#ff8a2a', '#f2c46d', '#e86a2a', '#c9a14e', '#fff0b0'];
    for (let i = 0; i < 26; i += 1) {
      const a = Math.random() * TAU;
      const d = Math.random() * 70;
      ctx.fillStyle = chunkColors[i % chunkColors.length];
      ctx.save();
      ctx.translate(cx + Math.cos(a) * d, cy + Math.sin(a) * d);
      ctx.rotate(Math.random() * TAU);
      ctx.fillRect(-4, -3, 6 + Math.random() * 6, 4 + Math.random() * 4);
      ctx.restore();
    }
    ctx.fillStyle = 'rgba(255,255,230,0.55)';
    for (let i = 0; i < 18; i += 1) {
      const a = Math.random() * TAU;
      const d = Math.random() * 70;
      ctx.beginPath();
      ctx.ellipse(cx + Math.cos(a) * d, cy + Math.sin(a) * d, 2 + Math.random() * 5, 1.5 + Math.random() * 2, a, 0, TAU);
      ctx.fill();
    }
  });
}

// ------------------------------------------------------------------ misc

export function blobShadowTexture() {
  return canvasTexture(
    128,
    128,
    (ctx, w, h) => {
      const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
      g.addColorStop(0, 'rgba(0,0,0,0.55)');
      g.addColorStop(0.55, 'rgba(0,0,0,0.25)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    },
    { srgb: false },
  );
}

export function glowTexture(color = '255,240,200') {
  return canvasTexture(128, 128, (ctx, w, h) => {
    const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    g.addColorStop(0, `rgba(${color},1)`);
    g.addColorStop(0.35, `rgba(${color},0.45)`);
    g.addColorStop(1, `rgba(${color},0)`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  });
}

export function stinkTexture() {
  return canvasTexture(128, 256, (ctx, w, h) => {
    ctx.strokeStyle = 'rgba(160,210,60,0.95)';
    ctx.lineCap = 'round';
    ctx.lineWidth = 10;
    for (let k = 0; k < 3; k += 1) {
      ctx.beginPath();
      const x0 = 30 + k * 34;
      for (let y = h - 20; y > 20; y -= 6) {
        const x = x0 + Math.sin(y * 0.06 + k * 2) * 10;
        if (y === h - 20) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  });
}

export function starTexture() {
  return canvasTexture(128, 128, (ctx) => {
    ctx.fillStyle = '#ffe14a';
    ctx.strokeStyle = '#b8860b';
    ctx.lineWidth = 6;
    drawStar(ctx, 64, 64, 5, 56, 24);
    ctx.stroke();
    drawStar(ctx, 64, 64, 5, 56, 24);
    ctx.fill();
  });
}

export function textLabelTexture(
  lines: string[],
  options: { width?: number; height?: number; bg?: string; fg?: string; font?: string; size?: number; border?: string; rotate?: number },
) {
  const width = options.width ?? 256;
  const height = options.height ?? 128;
  return canvasTexture(width, height, (ctx, w, h) => {
    if (options.bg) {
      ctx.fillStyle = options.bg;
      ctx.fillRect(0, 0, w, h);
    }
    if (options.border) {
      ctx.strokeStyle = options.border;
      ctx.lineWidth = 8;
      ctx.strokeRect(4, 4, w - 8, h - 8);
    }
    ctx.fillStyle = options.fg ?? '#222';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const size = options.size ?? 34;
    ctx.font = `${size}px ${options.font ?? DISPLAY_FONT}`;
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.rotate(options.rotate ?? 0);
    lines.forEach((line, i) => {
      ctx.fillText(line, 0, (i - (lines.length - 1) / 2) * size * 1.15);
    });
    ctx.restore();
  });
}

export function rugTexture(primary: string, secondary: string, accent: string) {
  return canvasTexture(512, 512, (ctx, w, h) => {
    ctx.fillStyle = primary;
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = secondary;
    ctx.lineWidth = 18;
    ctx.strokeRect(24, 24, w - 48, h - 48);
    ctx.strokeStyle = accent;
    ctx.lineWidth = 6;
    ctx.strokeRect(52, 52, w - 104, h - 104);
    ctx.fillStyle = secondary;
    for (let i = 0; i < 12; i += 1) {
      ctx.beginPath();
      ctx.arc(w / 2, h / 2, 170 - i * 14, 0, TAU);
      ctx.strokeStyle = i % 2 === 0 ? secondary : accent;
      ctx.lineWidth = 4;
      ctx.stroke();
    }
    ctx.save();
    ctx.translate(w / 2, h / 2);
    for (let i = 0; i < 8; i += 1) {
      ctx.rotate(TAU / 8);
      ctx.fillStyle = accent;
      ctx.beginPath();
      ctx.ellipse(0, -110, 16, 46, 0, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
    // Fringe-ish speckle.
    speckle(ctx, w, h, 5000, 0.12, 2);
  });
}

// ------------------------------------------------------------------ dogs

export interface DogStyle {
  name: string;
  fur: string;
  ear: 'floppy' | 'pointy' | 'fluffy';
  outfit: 'ruff' | 'military' | 'crown' | 'pearls' | 'bowtie' | 'monocle' | 'halo';
  /** Hangs with a black mourning ribbon. */
  memorial?: boolean;
  bg: string;
  spot?: string;
}

/** Oil-painting style portrait. Returns the texture plus eye positions in UV space (0..1). */
export function dogPortraitTexture(dog: DogStyle) {
  const eyes: { u: number; v: number; r: number }[] = [];
  const texture = canvasTexture(320, 400, (ctx, w, h) => {
    const bg = ctx.createRadialGradient(w / 2, h * 0.4, 20, w / 2, h / 2, w * 0.9);
    bg.addColorStop(0, dog.bg);
    bg.addColorStop(1, '#120c08');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    // Brushy texture.
    for (let i = 0; i < 600; i += 1) {
      ctx.strokeStyle = `rgba(255,240,200,${Math.random() * 0.04})`;
      ctx.lineWidth = 2 + Math.random() * 6;
      ctx.beginPath();
      const x = Math.random() * w;
      const y = Math.random() * h;
      ctx.moveTo(x, y);
      ctx.lineTo(x + rand(-20, 20), y + rand(-20, 20));
      ctx.stroke();
    }

    const cx = w / 2;
    const headY = h * 0.4;

    // Body / outfit.
    if (dog.outfit === 'halo') {
      // Little angel wings.
      ctx.fillStyle = 'rgba(255,255,255,0.92)';
      for (const side of [-1, 1]) {
        for (let f = 0; f < 3; f += 1) {
          ctx.beginPath();
          ctx.ellipse(cx + side * (118 + f * 14), h * 0.8 - f * 22, 46 - f * 8, 20, side * (0.5 + f * 0.25), 0, TAU);
          ctx.fill();
        }
      }
    }
    ctx.fillStyle = dog.fur;
    ctx.beginPath();
    ctx.ellipse(cx, h * 0.92, 130, 110, 0, 0, TAU);
    ctx.fill();
    switch (dog.outfit) {
      case 'military': {
        ctx.fillStyle = '#1f3a6b';
        ctx.beginPath();
        ctx.ellipse(cx, h * 0.95, 132, 100, 0, Math.PI, TAU);
        ctx.fill();
        ctx.fillRect(cx - 132, h * 0.95, 264, 40);
        ctx.fillStyle = '#e8c35a';
        for (let i = 0; i < 4; i += 1) {
          ctx.beginPath();
          ctx.arc(cx - 50 + i * 16, h * 0.86, 7, 0, TAU);
          ctx.fill();
        }
        ctx.fillRect(cx + 60, h * 0.82, 50, 10);
        ctx.fillRect(cx - 120, h * 0.82, 50, 10);
        break;
      }
      case 'ruff': {
        ctx.fillStyle = '#f6f1e3';
        for (let i = 0; i < 14; i += 1) {
          const a = Math.PI + (i / 13) * Math.PI;
          ctx.beginPath();
          ctx.ellipse(cx + Math.cos(a) * 90, h * 0.8 + Math.sin(a) * 18 + 30, 22, 30, a, 0, TAU);
          ctx.fill();
        }
        break;
      }
      case 'pearls': {
        ctx.fillStyle = '#7a1f3d';
        ctx.beginPath();
        ctx.ellipse(cx, h * 0.98, 130, 80, 0, Math.PI, TAU);
        ctx.fill();
        ctx.fillStyle = '#fff8ee';
        for (let i = 0; i < 13; i += 1) {
          const a = 0.35 + (i / 12) * (Math.PI - 0.7);
          ctx.beginPath();
          ctx.arc(cx + Math.cos(a) * 70, h * 0.73 + Math.sin(a) * 40, 7, 0, TAU);
          ctx.fill();
        }
        break;
      }
      case 'bowtie': {
        ctx.fillStyle = '#d0302a';
        ctx.beginPath();
        ctx.moveTo(cx, h * 0.76);
        ctx.lineTo(cx - 45, h * 0.72);
        ctx.lineTo(cx - 45, h * 0.82);
        ctx.closePath();
        ctx.moveTo(cx, h * 0.76);
        ctx.lineTo(cx + 45, h * 0.72);
        ctx.lineTo(cx + 45, h * 0.82);
        ctx.closePath();
        ctx.fill();
        break;
      }
      default:
        break;
    }

    // Ears behind head.
    ctx.fillStyle = dog.spot ?? shade(dog.fur, -30);
    if (dog.ear === 'floppy') {
      ctx.beginPath();
      ctx.ellipse(cx - 70, headY + 20, 30, 70, 0.3, 0, TAU);
      ctx.ellipse(cx + 70, headY + 20, 30, 70, -0.3, 0, TAU);
      ctx.fill();
    } else if (dog.ear === 'pointy') {
      ctx.beginPath();
      ctx.moveTo(cx - 80, headY - 10);
      ctx.lineTo(cx - 60, headY - 110);
      ctx.lineTo(cx - 20, headY - 40);
      ctx.moveTo(cx + 80, headY - 10);
      ctx.lineTo(cx + 60, headY - 110);
      ctx.lineTo(cx + 20, headY - 40);
      ctx.fill();
    } else {
      for (let i = 0; i < 16; i += 1) {
        const side = i < 8 ? -1 : 1;
        ctx.beginPath();
        ctx.arc(cx + side * (70 + Math.random() * 20), headY + rand(-20, 60), 22, 0, TAU);
        ctx.fill();
      }
    }

    // Head.
    const headGrad = ctx.createRadialGradient(cx - 25, headY - 30, 10, cx, headY, 95);
    headGrad.addColorStop(0, shade(dog.fur, 30));
    headGrad.addColorStop(1, dog.fur);
    ctx.fillStyle = headGrad;
    ctx.beginPath();
    ctx.ellipse(cx, headY, 78, 84, 0, 0, TAU);
    ctx.fill();
    if (dog.spot) {
      ctx.fillStyle = dog.spot;
      ctx.beginPath();
      ctx.ellipse(cx + 30, headY - 25, 30, 26, 0.4, 0, TAU);
      ctx.fill();
    }
    // Snout.
    ctx.fillStyle = shade(dog.fur, 40);
    ctx.beginPath();
    ctx.ellipse(cx, headY + 42, 46, 34, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#1a1210';
    ctx.beginPath();
    ctx.ellipse(cx, headY + 26, 16, 11, 0, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = '#1a1210';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(cx, headY + 36);
    ctx.lineTo(cx, headY + 50);
    ctx.quadraticCurveTo(cx - 14, headY + 62, cx - 26, headY + 54);
    ctx.moveTo(cx, headY + 50);
    ctx.quadraticCurveTo(cx + 14, headY + 62, cx + 26, headY + 54);
    ctx.stroke();

    // Eye whites (pupils are real 3D objects that track Theo).
    for (const side of [-1, 1]) {
      const ex = cx + side * 30;
      const ey = headY - 14;
      ctx.fillStyle = '#fbf6ea';
      ctx.beginPath();
      ctx.ellipse(ex, ey, 17, 15, 0, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = 'rgba(30,15,5,0.6)';
      ctx.lineWidth = 3;
      ctx.stroke();
      eyes.push({ u: ex / w, v: 1 - ey / h, r: 15 / w });
    }
    // Judgmental eyebrows.
    ctx.strokeStyle = shade(dog.fur, -60);
    ctx.lineWidth = 7;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cx - 48, headY - 42);
    ctx.lineTo(cx - 14, headY - 36);
    ctx.moveTo(cx + 48, headY - 42);
    ctx.lineTo(cx + 14, headY - 36);
    ctx.stroke();

    if (dog.outfit === 'crown') {
      ctx.fillStyle = '#f2c94c';
      ctx.beginPath();
      ctx.moveTo(cx - 50, headY - 70);
      ctx.lineTo(cx - 50, headY - 120);
      ctx.lineTo(cx - 25, headY - 90);
      ctx.lineTo(cx, headY - 130);
      ctx.lineTo(cx + 25, headY - 90);
      ctx.lineTo(cx + 50, headY - 120);
      ctx.lineTo(cx + 50, headY - 70);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#d43c5a';
      ctx.beginPath();
      ctx.arc(cx, headY - 88, 7, 0, TAU);
      ctx.fill();
    }
    if (dog.outfit === 'halo') {
      ctx.strokeStyle = '#ffe27a';
      ctx.lineWidth = 9;
      ctx.shadowColor = '#fff3b0';
      ctx.shadowBlur = 18;
      ctx.beginPath();
      ctx.ellipse(cx, headY - 112, 54, 15, 0, 0, TAU);
      ctx.stroke();
      ctx.shadowBlur = 0;
    }
    if (dog.outfit === 'monocle') {
      ctx.strokeStyle = '#f2c94c';
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.arc(cx + 30, headY - 14, 22, 0, TAU);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cx + 50, headY - 4);
      ctx.quadraticCurveTo(cx + 70, headY + 60, cx + 60, headY + 120);
      ctx.stroke();
    }

    // Varnish glaze.
    const glaze = ctx.createLinearGradient(0, 0, w, h);
    glaze.addColorStop(0, 'rgba(255,220,150,0.12)');
    glaze.addColorStop(1, 'rgba(60,30,0,0.25)');
    ctx.fillStyle = glaze;
    ctx.fillRect(0, 0, w, h);
  });
  return { texture, eyes };
}

export function shade(hex: string, amount: number) {
  const c = new THREE.Color(hex);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  c.setHSL(hsl.h, hsl.s, Math.min(1, Math.max(0, hsl.l + amount / 255)));
  return `#${c.getHexString()}`;
}

export function nameplateTexture(name: string) {
  return canvasTexture(512, 96, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#f7dd85');
    g.addColorStop(0.5, '#c99a32');
    g.addColorStop(1, '#8a6418');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#3b2706';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `52px ${DISPLAY_FONT}`;
    ctx.fillText(name, w / 2, h / 2 + 4, w - 30);
  });
}
