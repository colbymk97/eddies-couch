import './styles.css';
import { Game } from './game/game';
import { setMaxAnisotropy } from './world/textures';

const canvas = document.querySelector<HTMLCanvasElement>('#game-canvas');
if (!canvas) throw new Error('Missing #game-canvas');

const isTouch =
  window.matchMedia('(pointer: coarse)').matches ||
  ('ontouchstart' in window && navigator.maxTouchPoints > 0 && !window.matchMedia('(pointer: fine)').matches);
document.body.classList.toggle('is-touch', isTouch);

async function waitForFonts() {
  if (!('fonts' in document)) return;
  const fonts = Promise.all([document.fonts.load('40px "Luckiest Guy"'), document.fonts.load('600 20px "Fredoka"')]);
  // Fonts are drawn into canvas textures, so give them a moment, but never block the game on them.
  await Promise.race([fonts, new Promise((resolve) => setTimeout(resolve, 2500))]).catch(() => undefined);
}

async function boot() {
  await waitForFonts();
  // Let the loading text paint before the heavy world build.
  await new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 30)));
  setMaxAnisotropy(8);
  try {
    const game = new Game(canvas as HTMLCanvasElement, isTouch);
    (window as unknown as { __eddie?: Game }).__eddie = game;
  } catch (error) {
    const loading = document.getElementById('loading');
    if (loading) {
      loading.innerHTML = '<div class="loading-text">Eddie’s couch needs WebGL.<br/><small>Try another browser?</small></div>';
    }
    throw error;
  }
  document.getElementById('loading')?.classList.add('is-done');
}

void boot();
