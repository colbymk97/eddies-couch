import * as THREE from 'three';
import { HumanRig, type Anim } from '../actors/rig';
import { SPECS, type Role } from '../actors/cast';

const POSES: Record<Role, Anim> = { theo: 'idle', zach: 'flex', eddie: 'look' };

/**
 * Renders a waist-up portrait of each character for the character-select cards.
 * Uses a throwaway renderer so the game's renderer and post-processing are untouched.
 */
export function renderPortraits(width = 240, height = 280): Partial<Record<Role, string>> {
  const out: Partial<Record<Role, string>> = {};
  let renderer: THREE.WebGLRenderer | null = null;
  try {
    const canvas = document.createElement('canvas');
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(1);
    renderer.setSize(width, height, false);
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;

    for (const role of ['theo', 'zach', 'eddie'] as Role[]) {
      const scene = new THREE.Scene();
      scene.add(new THREE.HemisphereLight(0xfff4e0, 0x5a4a6a, 1.5));
      const key = new THREE.DirectionalLight(0xffffff, 2.6);
      key.position.set(1.5, 2.5, 3);
      scene.add(key);
      const rim = new THREE.DirectionalLight(0xffc38a, 1.6);
      rim.position.set(-2.5, 1.5, -2);
      scene.add(rim);

      const rig = new HumanRig(SPECS[role]);
      scene.add(rig.root);
      for (let i = 0; i < 8; i += 1) rig.animate(0.2, POSES[role], 0, 0);

      const waist = rig.hipHeight + 0.05;
      const top = rig.height + 0.04;
      const span = top - waist;
      const camera = new THREE.PerspectiveCamera(30, width / height, 0.05, 20);
      const dist = (span * 1.35) / (2 * Math.tan(THREE.MathUtils.degToRad(15)));
      const target = new THREE.Vector3(0, (waist + top) / 2, 0);
      camera.position.set(Math.sin(0.42) * dist, target.y + dist * 0.1, Math.cos(0.42) * dist);
      camera.lookAt(target);
      renderer.render(scene, camera);
      out[role] = canvas.toDataURL('image/png');

      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) m.geometry.dispose();
      });
    }
  } catch {
    // Portraits are decoration; the cards still work without them.
  } finally {
    renderer?.dispose();
    renderer?.forceContextLoss();
  }
  return out;
}
