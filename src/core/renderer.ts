import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

export type Quality = 'fancy' | 'fast';

const FxShader = {
  name: 'EddieFxShader',
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uTime: { value: 0 },
    uNausea: { value: 0 },
    uDanger: { value: 0 },
    uFlash: { value: 0 },
    uAspect: { value: 1 },
    uDim: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uNausea;
    uniform float uDanger;
    uniform float uFlash;
    uniform float uAspect;
    uniform float uDim;
    varying vec2 vUv;

    void main() {
      vec2 uv = vUv;
      float n = uNausea;
      uv += vec2(
        sin(uv.y * 11.0 + uTime * 5.3),
        cos(uv.x * 9.0 + uTime * 4.1)
      ) * 0.0065 * n;

      vec2 c = uv - 0.5;
      float r = length(c * vec2(uAspect, 1.0));
      float ca = (0.0018 + 0.006 * n + 0.003 * uDanger) * r;
      vec3 col;
      col.r = texture2D(tDiffuse, uv + c * ca * 2.0).r;
      col.g = texture2D(tDiffuse, uv).g;
      col.b = texture2D(tDiffuse, uv - c * ca * 2.0).b;

      // Queasy green tint while Theo winds up a hurl.
      col = mix(col, col * vec3(0.82, 1.16, 0.66), n * 0.4);

      // Gentle saturation boost.
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(l), col, 1.1);

      // Vignette.
      float vig = smoothstep(1.05, 0.32, r);
      col *= mix(0.58, 1.0, vig);

      // Pulsing red edges when Eddie is close.
      float pulse = 0.5 + 0.5 * sin(uTime * 9.0);
      vec3 red = vec3(1.0, 0.08, 0.05) * max(l, 0.25) * 1.6;
      col = mix(col, red, (1.0 - vig) * uDanger * (0.45 + 0.3 * pulse));

      col = mix(col, col * 0.25, uDim);
      col += uFlash * vec3(1.0, 0.96, 0.85);
      gl_FragColor = vec4(col, 1.0);
    }
  `,
};

export class GameRenderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly composer: EffectComposer;
  readonly bloom: UnrealBloomPass;
  readonly fx: ShaderPass;
  quality: Quality;
  private renderPass: RenderPass;

  constructor(
    canvas: HTMLCanvasElement,
    readonly scene: THREE.Scene,
    readonly camera: THREE.PerspectiveCamera,
    quality: Quality,
  ) {
    this.quality = quality;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = env;
    scene.environmentIntensity = 0.3;
    pmrem.dispose();

    const { width, height } = this.viewportSize();
    const target = new THREE.WebGLRenderTarget(width, height, {
      type: THREE.HalfFloatType,
      samples: quality === 'fancy' ? 4 : 0,
    });
    this.composer = new EffectComposer(this.renderer, target);
    this.renderPass = new RenderPass(scene, camera);
    this.composer.addPass(this.renderPass);

    this.bloom = new UnrealBloomPass(new THREE.Vector2(width, height), 0.3, 0.5, 1.15);
    this.composer.addPass(this.bloom);

    this.fx = new ShaderPass(FxShader);
    this.composer.addPass(this.fx);
    this.composer.addPass(new OutputPass());

    this.applyQuality();
    this.resize();
  }

  get uniforms() {
    return this.fx.uniforms as typeof FxShader.uniforms;
  }

  setQuality(quality: Quality) {
    if (quality === this.quality) return;
    this.quality = quality;
    this.composer.renderTarget1.samples = quality === 'fancy' ? 4 : 0;
    this.composer.renderTarget2.samples = quality === 'fancy' ? 4 : 0;
    this.applyQuality();
    this.resize();
  }

  private applyQuality() {
    const fancy = this.quality === 'fancy';
    this.bloom.enabled = fancy;
    this.renderer.shadowMap.needsUpdate = true;
  }

  pixelRatio() {
    const cap = this.quality === 'fancy' ? 2 : 1.25;
    return Math.min(window.devicePixelRatio || 1, cap);
  }

  private viewportSize() {
    return { width: Math.max(1, window.innerWidth), height: Math.max(1, window.innerHeight) };
  }

  resize() {
    const { width, height } = this.viewportSize();
    const ratio = this.pixelRatio();
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(width, height, false);
    this.composer.setPixelRatio(ratio);
    this.composer.setSize(width, height);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.uniforms.uAspect.value = width / height;
  }

  render(time: number) {
    this.uniforms.uTime.value = time;
    this.composer.render();
  }
}
