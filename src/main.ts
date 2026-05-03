import './styles.css';
import * as THREE from 'three';

type Vec3Tuple = [number, number, number];
type AudioContextConstructor = new () => AudioContext;

interface WallDefinition {
  position: Vec3Tuple;
  size: Vec3Tuple;
  color?: number;
}

interface CouchDefinition {
  id: string;
  position: Vec3Tuple;
  rotation: number;
  seats: number;
  color: number;
}

interface PropDefinition {
  position: Vec3Tuple;
  rotation?: number;
}

interface PortraitDefinition extends PropDefinition {
  dogColor: string;
  wall: 'north' | 'south' | 'east' | 'west';
}

interface LevelDefinition {
  walls: WallDefinition[];
  couches: CouchDefinition[];
  trashcans: PropDefinition[];
  portraits: PortraitDefinition[];
  eddieSpawn: Vec3Tuple;
}

interface Collider {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

interface Seat {
  id: string;
  couchId: string;
  index: number;
  position: THREE.Vector3;
  mesh: THREE.Mesh;
  vomited: boolean;
}

interface Couch {
  id: string;
  seats: Seat[];
  completed: boolean;
}

interface Player {
  position: THREE.Vector3;
  radius: number;
  speed: number;
  mesh: THREE.Group;
}

interface Eddie {
  position: THREE.Vector3;
  radius: number;
  speed: number;
  mesh: THREE.Group;
  active: boolean;
  nextShoutAt: number;
}

interface VomitStream {
  group: THREE.Group;
  particles: THREE.Mesh[];
  impactParticles: THREE.Mesh[];
  start: THREE.Vector3;
  end: THREE.Vector3;
  age: number;
  duration: number;
}

function requireElement<T extends Element>(selector: string) {
  const element = document.querySelector<T>(selector);
  if (!element) {
    throw new Error(`Missing required game element: ${selector}`);
  }
  return element;
}

const canvas = requireElement<HTMLCanvasElement>('#game-canvas');
const objectiveEl = requireElement<HTMLDivElement>('#objective');
const targetEl = requireElement<HTMLDivElement>('#target');
const cooldownEl = requireElement<HTMLDivElement>('#cooldown');
const shoutEl = requireElement<HTMLDivElement>('#shout');
const overlayEl = requireElement<HTMLDivElement>('#overlay');
const startButton = requireElement<HTMLButtonElement>('#start-button');
const mobileControlsEl = requireElement<HTMLDivElement>('#mobile-controls');
const joystickEl = requireElement<HTMLDivElement>('#joystick');
const joystickKnobEl = requireElement<HTMLDivElement>('#joystick-knob');
const vomitButton = requireElement<HTMLButtonElement>('#vomit-button');

const hasPhoneSizedViewport =
  (window.innerWidth <= 940 && window.innerHeight <= 520) ||
  (window.innerWidth <= 520 && window.innerHeight <= 940);
const isTouchDevice =
  window.matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0 || hasPhoneSizedViewport;
document.body.classList.toggle('is-touch', isTouchDevice);
mobileControlsEl.setAttribute('aria-hidden', String(!isTouchDevice));

const level: LevelDefinition = {
  walls: [
    { position: [0, 0.75, -7], size: [18.2, 1.5, 0.32] },
    { position: [0, 0.75, 7], size: [18.2, 1.5, 0.32] },
    { position: [-9, 0.75, 0], size: [0.32, 1.5, 14.2] },
    { position: [9, 0.75, 0], size: [0.32, 1.5, 14.2] },
    { position: [-2.3, 0.75, -4.6], size: [0.26, 1.5, 4.8], color: 0xc7d7b8 },
    { position: [-2.3, 0.75, 4.8], size: [0.26, 1.5, 4.4], color: 0xc7d7b8 },
    { position: [-6.1, 0.75, 1.45], size: [5.6, 1.5, 0.26], color: 0xd7c4b8 },
    { position: [4.5, 0.75, 1.45], size: [5.2, 1.5, 0.26], color: 0xd7c4b8 },
  ],
  couches: [
    { id: 'living-long', position: [4.2, 0, 5.25], rotation: Math.PI, seats: 3, color: 0x4b88c4 },
    { id: 'living-side', position: [7.0, 0, 2.9], rotation: -Math.PI / 2, seats: 2, color: 0xf08b52 },
    { id: 'den-long', position: [-5.8, 0, -5.15], rotation: 0, seats: 3, color: 0x7a5bb7 },
    { id: 'portrait-room', position: [-6.0, 0, 4.65], rotation: Math.PI, seats: 2, color: 0x3f9a6b },
    { id: 'bun-room', position: [1.15, 0, -4.95], rotation: 0, seats: 3, color: 0xd65757 },
  ],
  trashcans: [
    { position: [-7.55, 0, -1.65] },
    { position: [7.55, 0, -5.6] },
    { position: [0.2, 0, 5.75] },
  ],
  portraits: [
    { position: [-7.4, 1.85, -6.82], wall: 'north', dogColor: '#9b5b36' },
    { position: [-4.9, 1.86, -6.82], wall: 'north', dogColor: '#e6c77d' },
    { position: [-1.1, 1.85, -6.82], wall: 'north', dogColor: '#5d4635' },
    { position: [2.6, 1.9, -6.82], wall: 'north', dogColor: '#ffffff' },
    { position: [6.4, 1.84, -6.82], wall: 'north', dogColor: '#c48752' },
    { position: [-8.82, 1.8, -3.3], wall: 'west', dogColor: '#3d2b22' },
    { position: [-8.82, 1.9, 0.5], wall: 'west', dogColor: '#dab173' },
    { position: [-8.82, 1.84, 4.2], wall: 'west', dogColor: '#f2f0e6' },
    { position: [8.82, 1.85, -4.2], wall: 'east', dogColor: '#885038' },
    { position: [8.82, 1.9, -0.2], wall: 'east', dogColor: '#cbbda7' },
    { position: [8.82, 1.86, 4.4], wall: 'east', dogColor: '#694d38' },
    { position: [-6.2, 1.84, 6.82], wall: 'south', dogColor: '#f5d180' },
    { position: [-0.6, 1.9, 6.82], wall: 'south', dogColor: '#7c4a36' },
    { position: [5.5, 1.84, 6.82], wall: 'south', dogColor: '#eee8d7' },
  ],
  eddieSpawn: [-7.4, 0, 6.1],
};

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9dd6f2);
scene.fog = new THREE.Fog(0x9dd6f2, 16, 32);

const camera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.1, 80);
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  powerPreference: 'high-performance',
  preserveDrawingBuffer: true,
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;

const timer = new THREE.Timer();
timer.connect(document);
const colliders: Collider[] = [];
const couches: Couch[] = [];
const seats: Seat[] = [];
const splats: THREE.Mesh[] = [];
const vomitStreams: VomitStream[] = [];
const keys = new Set<string>();

const mobileMove = new THREE.Vector2();
const tempVector = new THREE.Vector3();
const tempVector2 = new THREE.Vector3();

let yaw = Math.PI * 0.12;
let pitch = 0.08;
let gameState: 'ready' | 'playing' | 'won' | 'lost' = 'ready';
let vomitCooldown = 0;
let shoutTimer = 0;
let elapsed = 0;
let audioContext: AudioContext | undefined;

const player: Player = {
  position: new THREE.Vector3(0, 0, 0.4),
  radius: 0.31,
  speed: 3.05,
  mesh: createToddler(),
};

const eddie: Eddie = {
  position: new THREE.Vector3(...level.eddieSpawn),
  radius: 0.38,
  speed: 1.78,
  mesh: createEddie(),
  active: false,
  nextShoutAt: 0,
};

scene.add(player.mesh);
scene.add(eddie.mesh);
eddie.mesh.visible = false;

buildScene();
updateHud();
updateCamera();

startButton.addEventListener('click', () => {
  if (gameState === 'won' || gameState === 'lost') {
    restartGame();
  }

  gameState = 'playing';
  overlayEl.classList.add('is-hidden');

  if (!isTouchDevice && document.pointerLockElement !== canvas) {
    requestPointerLockSafely();
  }
});

window.addEventListener('keydown', (event) => {
  keys.add(event.code);

  if ((event.code === 'KeyE' || event.code === 'Space') && gameState === 'playing') {
    event.preventDefault();
    tryVomit();
  }

  if (event.code === 'Enter' && gameState !== 'playing') {
    startButton.click();
  }
});

window.addEventListener('keyup', (event) => {
  keys.delete(event.code);
});

window.addEventListener('mousemove', (event) => {
  if (document.pointerLockElement !== canvas || isTouchDevice || gameState !== 'playing') {
    return;
  }

  yaw -= event.movementX * 0.0024;
  pitch = THREE.MathUtils.clamp(pitch - event.movementY * 0.002, -0.42, 0.55);
});

canvas.addEventListener('click', () => {
  if (gameState === 'playing' && !isTouchDevice && document.pointerLockElement !== canvas) {
    requestPointerLockSafely();
    return;
  }

  if (gameState === 'playing' && !isTouchDevice) {
    tryVomit();
  }
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

setupTouchControls();
renderer.setAnimationLoop(tick);

function buildScene() {
  const hemi = new THREE.HemisphereLight(0xfff8e7, 0x5c7f70, 1.8);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(0xffffff, 2.2);
  sun.position.set(4, 10, 6);
  sun.castShadow = true;
  sun.shadow.camera.near = 0.5;
  sun.shadow.camera.far = 30;
  sun.shadow.camera.left = -12;
  sun.shadow.camera.right = 12;
  sun.shadow.camera.top = 12;
  sun.shadow.camera.bottom = -12;
  scene.add(sun);

  const floor = new THREE.Mesh(
    new THREE.BoxGeometry(18, 0.18, 14),
    new THREE.MeshStandardMaterial({ color: 0xe6c285, roughness: 0.82 }),
  );
  floor.position.y = -0.09;
  floor.receiveShadow = true;
  scene.add(floor);

  const rug = new THREE.Mesh(
    new THREE.BoxGeometry(5.2, 0.025, 3.2),
    new THREE.MeshStandardMaterial({ color: 0x2f8e89, roughness: 0.9 }),
  );
  rug.position.set(4.6, 0.025, 3.8);
  rug.receiveShadow = true;
  scene.add(rug);

  for (const wall of level.walls) {
    addWall(wall);
  }

  for (const couch of level.couches) {
    addCouch(couch);
  }

  for (const trashcan of level.trashcans) {
    addTrashcan(trashcan);
  }

  for (const portrait of level.portraits) {
    addDogPortrait(portrait);
  }
}

function addWall(definition: WallDefinition) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(...definition.size),
    new THREE.MeshStandardMaterial({ color: definition.color ?? 0xf0d8c2, roughness: 0.88 }),
  );
  mesh.position.set(...definition.position);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);
  addColliderFromBox(definition.position, definition.size);
}

function addCouch(definition: CouchDefinition) {
  const group = new THREE.Group();
  group.position.set(...definition.position);
  group.rotation.y = definition.rotation;
  scene.add(group);

  const couchMaterial = new THREE.MeshStandardMaterial({ color: definition.color, roughness: 0.72 });
  const cushionMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color(definition.color).offsetHSL(0, 0.08, 0.1),
    roughness: 0.8,
  });
  const darkMaterial = new THREE.MeshStandardMaterial({ color: 0x47352b, roughness: 0.8 });

  const width = definition.seats * 1.08 + 0.48;
  const base = new THREE.Mesh(new THREE.BoxGeometry(width, 0.42, 1.12), couchMaterial);
  base.position.y = 0.38;
  group.add(base);

  const back = new THREE.Mesh(new THREE.BoxGeometry(width, 0.92, 0.28), couchMaterial);
  back.position.set(0, 0.77, 0.55);
  group.add(back);

  for (const x of [-width / 2 + 0.14, width / 2 - 0.14]) {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.68, 1.24), couchMaterial);
    arm.position.set(x, 0.58, 0);
    group.add(arm);
  }

  const couch: Couch = { id: definition.id, seats: [], completed: false };
  for (let i = 0; i < definition.seats; i += 1) {
    const x = (i - (definition.seats - 1) / 2) * 1.08;
    const seatMesh = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.18, 0.82), cushionMaterial.clone());
    seatMesh.position.set(x, 0.69, -0.18);
    seatMesh.castShadow = true;
    seatMesh.receiveShadow = true;
    group.add(seatMesh);

    const worldPosition = new THREE.Vector3(x, 0.76, -0.25).applyEuler(group.rotation).add(group.position);
    const seat: Seat = {
      id: `${definition.id}-${i}`,
      couchId: definition.id,
      index: i,
      position: worldPosition,
      mesh: seatMesh,
      vomited: false,
    };
    seatMesh.userData.seat = seat;
    couch.seats.push(seat);
    seats.push(seat);
  }

  const legGeometry = new THREE.BoxGeometry(0.15, 0.24, 0.15);
  for (const x of [-width / 2 + 0.35, width / 2 - 0.35]) {
    for (const z of [-0.43, 0.43]) {
      const leg = new THREE.Mesh(legGeometry, darkMaterial);
      leg.position.set(x, 0.05, z);
      group.add(leg);
    }
  }

  couches.push(couch);
  addRotatedCollider(definition.position, width, 1.32, definition.rotation);
}

function addTrashcan(definition: PropDefinition) {
  const group = new THREE.Group();
  group.position.set(...definition.position);
  group.rotation.y = definition.rotation ?? 0;
  scene.add(group);

  const can = new THREE.Mesh(
    new THREE.CylinderGeometry(0.36, 0.31, 0.7, 16),
    new THREE.MeshStandardMaterial({ color: 0x6f7a83, metalness: 0.1, roughness: 0.5 }),
  );
  can.position.y = 0.35;
  can.castShadow = true;
  can.receiveShadow = true;
  group.add(can);

  const bunMaterial = new THREE.MeshStandardMaterial({ color: 0xecc079, roughness: 0.72 });
  for (let i = 0; i < 9; i += 1) {
    const bun = new THREE.Mesh(new THREE.CapsuleGeometry(0.08, 0.34, 4, 8), bunMaterial);
    const angle = (i / 9) * Math.PI * 2;
    bun.position.set(Math.cos(angle) * 0.18, 0.8 + (i % 3) * 0.035, Math.sin(angle) * 0.18);
    bun.rotation.set(Math.PI / 2, angle, 0.35);
    bun.castShadow = true;
    group.add(bun);
  }

  addColliderFromBox([definition.position[0], 0.35, definition.position[2]], [0.9, 0.7, 0.9]);
}

function addDogPortrait(definition: PortraitDefinition) {
  const frame = new THREE.Group();
  frame.position.set(definition.position[0], 1.14, definition.position[2]);

  const rotations = {
    north: 0,
    south: Math.PI,
    west: Math.PI / 2,
    east: -Math.PI / 2,
  };
  frame.rotation.y = rotations[definition.wall];
  scene.add(frame);

  const backing = new THREE.Mesh(
    new THREE.BoxGeometry(0.92, 0.72, 0.05),
    new THREE.MeshStandardMaterial({ color: 0x5b3928, roughness: 0.7 }),
  );
  backing.castShadow = true;
  frame.add(backing);

  const portrait = new THREE.Mesh(
    new THREE.PlaneGeometry(0.72, 0.54),
    new THREE.MeshStandardMaterial({
      map: createDogTexture(definition.dogColor),
      roughness: 0.9,
      side: THREE.DoubleSide,
    }),
  );
  portrait.position.z = 0.031;
  frame.add(portrait);
}

function createToddler() {
  const group = new THREE.Group();
  const skin = new THREE.MeshStandardMaterial({ color: 0xf1b986, roughness: 0.68 });
  const shirt = new THREE.MeshStandardMaterial({ color: 0x4fa8db, roughness: 0.7 });
  const diaper = new THREE.MeshStandardMaterial({ color: 0xf5f4ef, roughness: 0.62 });
  const hair = new THREE.MeshStandardMaterial({ color: 0x5d3c2a, roughness: 0.74 });

  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.25, 0.34, 6, 12), shirt);
  body.position.y = 0.64;
  body.castShadow = true;
  group.add(body);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.26, 18, 14), skin);
  head.position.y = 1.08;
  head.castShadow = true;
  group.add(head);
  addFace(group, {
    y: 1.08,
    scale: 1,
    expression: 'queasy',
    skinColor: 0xf1b986,
  });

  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.265, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), hair);
  cap.position.y = 1.15;
  cap.castShadow = true;
  group.add(cap);

  const diaperMesh = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.23, 0.34), diaper);
  diaperMesh.position.y = 0.38;
  diaperMesh.castShadow = true;
  group.add(diaperMesh);

  for (const x of [-0.16, 0.16]) {
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.08, 0.26), skin);
    foot.position.set(x, 0.06, 0.05);
    foot.castShadow = true;
    group.add(foot);
  }

  return group;
}

function createEddie() {
  const group = new THREE.Group();
  const skin = new THREE.MeshStandardMaterial({ color: 0xb8794f, roughness: 0.7 });
  const shirt = new THREE.MeshStandardMaterial({ color: 0xf2cf64, roughness: 0.7 });
  const pants = new THREE.MeshStandardMaterial({ color: 0x2f4d5e, roughness: 0.7 });
  const hair = new THREE.MeshStandardMaterial({ color: 0x1f1715, roughness: 0.75 });

  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.34, 0.72, 8, 14), shirt);
  torso.position.y = 0.95;
  torso.castShadow = true;
  group.add(torso);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.28, 18, 14), skin);
  head.position.y = 1.55;
  head.castShadow = true;
  group.add(head);
  addFace(group, {
    y: 1.55,
    scale: 1.08,
    expression: 'angry',
    skinColor: 0xb8794f,
  });

  const hairMesh = new THREE.Mesh(new THREE.SphereGeometry(0.29, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), hair);
  hairMesh.position.y = 1.65;
  hairMesh.castShadow = true;
  group.add(hairMesh);

  for (const x of [-0.17, 0.17]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.62, 0.2), pants);
    leg.position.set(x, 0.31, 0);
    leg.castShadow = true;
    group.add(leg);
  }

  return group;
}

function addFace(
  group: THREE.Group,
  options: { y: number; scale: number; expression: 'queasy' | 'angry'; skinColor: number },
) {
  const eyeMaterial = new THREE.MeshStandardMaterial({ color: 0x191512, roughness: 0.55 });
  const mouthMaterial = new THREE.MeshStandardMaterial({ color: 0x331914, roughness: 0.5 });
  const browMaterial = new THREE.MeshStandardMaterial({ color: 0x2a1a14, roughness: 0.7 });
  const blushMaterial = new THREE.MeshStandardMaterial({ color: 0xef8c80, roughness: 0.8 });
  const noseMaterial = new THREE.MeshStandardMaterial({ color: options.skinColor, roughness: 0.72 });

  const s = options.scale;
  for (const x of [-0.085 * s, 0.085 * s]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.028 * s, 10, 8), eyeMaterial);
    eye.position.set(x, options.y + 0.035 * s, 0.232 * s);
    group.add(eye);
  }

  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.026 * s, 10, 8), noseMaterial);
  nose.position.set(0, options.y - 0.012 * s, 0.254 * s);
  nose.scale.set(0.72, 0.9, 1.2);
  group.add(nose);

  const mouth = new THREE.Mesh(new THREE.SphereGeometry(0.048 * s, 14, 8), mouthMaterial);
  mouth.position.set(0, options.y - 0.082 * s, 0.238 * s);
  mouth.scale.set(options.expression === 'queasy' ? 1.08 : 1.42, options.expression === 'queasy' ? 0.62 : 0.48, 0.18);
  group.add(mouth);

  if (options.expression === 'queasy') {
    for (const x of [-0.155 * s, 0.155 * s]) {
      const cheek = new THREE.Mesh(new THREE.SphereGeometry(0.032 * s, 10, 8), blushMaterial);
      cheek.position.set(x, options.y - 0.035 * s, 0.224 * s);
      cheek.scale.set(1.2, 0.55, 0.16);
      group.add(cheek);
    }
    return;
  }

  for (const side of [-1, 1]) {
    const brow = new THREE.Mesh(new THREE.BoxGeometry(0.095 * s, 0.018 * s, 0.018 * s), browMaterial);
    brow.position.set(side * 0.082 * s, options.y + 0.107 * s, 0.234 * s);
    brow.rotation.z = side * 0.46;
    group.add(brow);
  }
}

function createDogTexture(furColor: string) {
  const canvasTexture = document.createElement('canvas');
  canvasTexture.width = 256;
  canvasTexture.height = 192;
  const ctx = canvasTexture.getContext('2d');

  if (!ctx) {
    return null;
  }

  ctx.fillStyle = '#f4ddb8';
  ctx.fillRect(0, 0, 256, 192);
  ctx.fillStyle = '#73aabf';
  ctx.fillRect(0, 0, 256, 68);
  ctx.fillStyle = furColor;
  ctx.beginPath();
  ctx.ellipse(128, 104, 54, 47, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(84, 88, 24, 42, -0.45, 0, Math.PI * 2);
  ctx.ellipse(172, 88, 24, 42, 0.45, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#191512';
  ctx.beginPath();
  ctx.arc(111, 98, 7, 0, Math.PI * 2);
  ctx.arc(145, 98, 7, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(128, 118, 10, 7, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#191512';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(128, 126);
  ctx.quadraticCurveTo(118, 138, 105, 132);
  ctx.moveTo(128, 126);
  ctx.quadraticCurveTo(138, 138, 151, 132);
  ctx.stroke();

  const texture = new THREE.CanvasTexture(canvasTexture);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function tick(timestamp?: number) {
  timer.update(timestamp);
  const delta = Math.min(timer.getDelta(), 0.04);
  elapsed += delta;

  if (vomitCooldown > 0) {
    vomitCooldown = Math.max(0, vomitCooldown - delta);
  }

  if (shoutTimer > 0) {
    shoutTimer = Math.max(0, shoutTimer - delta);
    if (shoutTimer === 0) {
      shoutEl.classList.remove('is-visible');
    }
  }

  if (gameState === 'playing') {
    updatePlayer(delta);
    updateEddie(delta);
    updateTargetText();
  }

  animateSplats(delta);
  animateVomitStreams(delta);
  updateHud();
  updateCamera();
  renderer.render(scene, camera);
}

function updatePlayer(delta: number) {
  const input = getMovementInput();
  if (input.lengthSq() > 0.001) {
    input.normalize();
    const forward = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    const right = new THREE.Vector3(forward.z, 0, -forward.x);
    const move = forward.multiplyScalar(input.y).add(right.multiplyScalar(input.x));
    move.normalize().multiplyScalar(player.speed * delta);
    moveEntity(player.position, move, player.radius);
    player.mesh.rotation.y = Math.atan2(move.x, move.z);
  }

  player.mesh.position.copy(player.position);
}

function updateEddie(delta: number) {
  if (!eddie.active && completedCouchCount() >= 2) {
    eddie.active = true;
    eddie.mesh.visible = true;
    eddie.position.set(...level.eddieSpawn);
    showShout('¡Eddie oyó el sofá!');
  }

  if (!eddie.active) {
    return;
  }

  const toPlayer = tempVector.copy(player.position).sub(eddie.position);
  const distance = toPlayer.length();

  if (distance > 0.01) {
    toPlayer.normalize();
    const intended = tempVector2.copy(toPlayer).multiplyScalar(eddie.speed * delta);
    const before = eddie.position.clone();
    moveEntity(eddie.position, intended, eddie.radius);

    if (before.distanceToSquared(eddie.position) < 0.00002) {
      const sideStep = new THREE.Vector3(-toPlayer.z, 0, toPlayer.x).multiplyScalar(eddie.speed * delta);
      moveEntity(eddie.position, sideStep, eddie.radius);
      if (before.distanceToSquared(eddie.position) < 0.00002) {
        moveEntity(eddie.position, sideStep.multiplyScalar(-2), eddie.radius);
      }
    }

    eddie.mesh.rotation.y = Math.atan2(toPlayer.x, toPlayer.z);
  }

  eddie.mesh.position.copy(eddie.position);

  if (distance < 0.62) {
    loseGame();
  }

  if (elapsed >= eddie.nextShoutAt) {
    const shouts = ['¡No en el sofá!', '¡Ven acá!', '¡Mis panes!', '¡Ese cojín no!', '¡Ay, chico!'];
    showShout(shouts[Math.floor(Math.random() * shouts.length)]);
    eddie.nextShoutAt = elapsed + 3.4 + Math.random() * 1.8;
  }
}

function getMovementInput() {
  const input = new THREE.Vector2();
  const keyboardInput = new THREE.Vector2();

  if (keys.has('KeyA') || keys.has('ArrowLeft')) {
    keyboardInput.x += 1;
  }
  if (keys.has('KeyD') || keys.has('ArrowRight')) {
    keyboardInput.x -= 1;
  }
  if (keys.has('KeyW') || keys.has('ArrowUp')) {
    keyboardInput.y += 1;
  }
  if (keys.has('KeyS') || keys.has('ArrowDown')) {
    keyboardInput.y -= 1;
  }

  input.add(keyboardInput).add(mobileMove);
  return input;
}

function tryVomit() {
  if (vomitCooldown > 0 || gameState !== 'playing') {
    return;
  }

  const target = findTargetSeat();
  vomitCooldown = 0.78;

  if (!target) {
    addVomitStream(getFallbackVomitEnd());
    playVomitSplatSound(false);
    showShout('No clean couch seat in range.');
    return;
  }

  addVomitStream(target.position);
  playVomitSplatSound(true);
  target.vomited = true;
  const material = target.mesh.material;
  if (material instanceof THREE.MeshStandardMaterial) {
    material.color.set(0x8fd64d);
    material.emissive.set(0x223b16);
  }
  addSplat(target.position, target.mesh.parent?.rotation.y ?? 0);

  const couch = couches.find((candidate) => candidate.id === target.couchId);
  if (couch && couch.seats.every((seat) => seat.vomited)) {
    couch.completed = true;
    showShout(`Couch complete: ${couch.id.replaceAll('-', ' ')}`);
  }

  if (couches.every((couchItem) => couchItem.completed)) {
    winGame();
  }
}

function findTargetSeat() {
  const forward = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
  let best: Seat | undefined;
  let bestScore = -Infinity;

  for (const seat of seats) {
    if (seat.vomited) {
      continue;
    }

    const toSeat = seat.position.clone().sub(player.position);
    toSeat.y = 0;
    const distance = toSeat.length();
    if (distance > 1.85) {
      continue;
    }

    const direction = toSeat.normalize();
    const dot = direction.dot(forward);
    if (dot < 0.28 && distance > 0.78) {
      continue;
    }

    const score = dot * 2 - distance;
    if (score > bestScore) {
      best = seat;
      bestScore = score;
    }
  }

  return best;
}

function updateTargetText() {
  const target = findTargetSeat();
  if (!target) {
    targetEl.textContent = 'Find a clean seat';
    return;
  }

  const couch = couches.find((candidate) => candidate.id === target.couchId);
  const seatCount = couch?.seats.length ?? 1;
  targetEl.textContent = `${target.couchId.replaceAll('-', ' ')} seat ${target.index + 1}/${seatCount}`;
}

function updateHud() {
  objectiveEl.textContent = `${completedCouchCount()} / ${couches.length}`;
  cooldownEl.textContent = vomitCooldown > 0 ? `${vomitCooldown.toFixed(1)}s` : 'Ready';
}

function requestPointerLockSafely() {
  try {
    const lockRequest = canvas.requestPointerLock();
    lockRequest?.catch(() => undefined);
  } catch {
    // Some automated/headless browsers disallow pointer lock even when gameplay can continue.
  }
}

function completedCouchCount() {
  return couches.filter((couch) => couch.completed).length;
}

function addSplat(position: THREE.Vector3, rotation: number) {
  const splat = new THREE.Mesh(
    new THREE.CircleGeometry(0.34 + Math.random() * 0.14, 24),
    new THREE.MeshStandardMaterial({
      color: 0x8ed24c,
      emissive: 0x244a16,
      emissiveIntensity: 0.18,
      roughness: 0.92,
      side: THREE.DoubleSide,
    }),
  );
  splat.position.copy(position);
  splat.position.y += 0.015;
  splat.rotation.set(-Math.PI / 2, 0, rotation + Math.random() * 0.4 - 0.2);
  splat.scale.set(0.65, 1.25, 1);
  splat.castShadow = false;
  splat.receiveShadow = true;
  scene.add(splat);
  splats.push(splat);

  const blobMaterial = new THREE.MeshStandardMaterial({
    color: 0xa9e769,
    emissive: 0x315d1a,
    emissiveIntensity: 0.12,
    roughness: 0.86,
  });
  for (let i = 0; i < 9; i += 1) {
    const angle = (i / 9) * Math.PI * 2 + Math.random() * 0.45;
    const radius = 0.18 + Math.random() * 0.32;
    const blob = new THREE.Mesh(new THREE.SphereGeometry(0.035 + Math.random() * 0.035, 10, 8), blobMaterial.clone());
    blob.position.set(
      position.x + Math.cos(angle) * radius,
      position.y + 0.045 + Math.random() * 0.045,
      position.z + Math.sin(angle) * radius,
    );
    blob.scale.y = 0.32;
    scene.add(blob);
    splats.push(blob);
  }
}

function addVomitStream(end: THREE.Vector3) {
  const start = getTheoMouthWorldPosition();
  const streamEnd = end.clone();
  streamEnd.y += 0.18;

  const particles: THREE.Mesh[] = [];
  const impactParticles: THREE.Mesh[] = [];
  const group = new THREE.Group();
  scene.add(group);

  const material = new THREE.MeshStandardMaterial({
    color: 0x8ed24c,
    emissive: 0x2d5a18,
    emissiveIntensity: 0.22,
    roughness: 0.8,
    transparent: true,
    opacity: 0.92,
  });

  for (let i = 0; i < 34; i += 1) {
    const particle = new THREE.Mesh(new THREE.SphereGeometry(0.045 + (i % 5) * 0.012, 10, 8), material.clone());
    particle.castShadow = true;
    particles.push(particle);
    group.add(particle);
  }

  for (let i = 0; i < 18; i += 1) {
    const impact = new THREE.Mesh(new THREE.SphereGeometry(0.035 + (i % 4) * 0.012, 10, 8), material.clone());
    impact.castShadow = true;
    impact.visible = false;
    impactParticles.push(impact);
    group.add(impact);
  }

  vomitStreams.push({
    group,
    particles,
    impactParticles,
    start,
    end: streamEnd,
    age: 0,
    duration: 0.72,
  });
}

function animateVomitStreams(delta: number) {
  for (let i = vomitStreams.length - 1; i >= 0; i -= 1) {
    const stream = vomitStreams[i];
    stream.age += delta;
    const progress = THREE.MathUtils.clamp(stream.age / stream.duration, 0, 1);

    for (let j = 0; j < stream.particles.length; j += 1) {
      const particle = stream.particles[j];
      const particleProgress = THREE.MathUtils.clamp(progress * 1.45 - j * 0.024, 0, 1);
      const arc = Math.sin(particleProgress * Math.PI) * 0.34;
      particle.position.lerpVectors(stream.start, stream.end, particleProgress);
      particle.position.y += arc + Math.sin(elapsed * 24 + j) * 0.032;
      particle.position.x += Math.sin(j * 2.17) * 0.045;
      particle.position.z += Math.cos(j * 1.71) * 0.045;
      const scale = Math.sin(particleProgress * Math.PI);
      particle.scale.setScalar(THREE.MathUtils.clamp(scale * 1.75, 0.05, 1.6));

      const material = particle.material;
      if (material instanceof THREE.MeshStandardMaterial) {
        material.opacity = THREE.MathUtils.clamp(1 - progress * 0.18, 0, 1);
      }
    }

    for (let j = 0; j < stream.impactParticles.length; j += 1) {
      const particle = stream.impactParticles[j];
      const burst = THREE.MathUtils.clamp((progress - 0.58) / 0.42, 0, 1);
      particle.visible = burst > 0;
      const angle = (j / stream.impactParticles.length) * Math.PI * 2;
      const radius = burst * (0.16 + (j % 5) * 0.045);
      particle.position.set(
        stream.end.x + Math.cos(angle) * radius,
        stream.end.y - 0.1 + Math.sin(burst * Math.PI) * 0.2,
        stream.end.z + Math.sin(angle) * radius,
      );
      particle.scale.setScalar(THREE.MathUtils.clamp(Math.sin(burst * Math.PI) * 1.35, 0.05, 1.2));

      const material = particle.material;
      if (material instanceof THREE.MeshStandardMaterial) {
        material.opacity = THREE.MathUtils.clamp(1 - burst * 0.35, 0, 1);
      }
    }

    if (stream.age >= stream.duration) {
      stream.group.removeFromParent();
      vomitStreams.splice(i, 1);
    }
  }
}

function getTheoMouthWorldPosition() {
  const forward = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
  const right = new THREE.Vector3(forward.z, 0, -forward.x);
  return player.position
    .clone()
    .add(right.multiplyScalar(0))
    .add(forward.multiplyScalar(0.32))
    .add(new THREE.Vector3(0, 1.0, 0));
}

function getFallbackVomitEnd() {
  return getTheoMouthWorldPosition().add(new THREE.Vector3(Math.sin(yaw), -0.22, Math.cos(yaw)).multiplyScalar(1.25));
}

function playVomitSplatSound(hitSeat: boolean) {
  const context = getAudioContext();
  if (!context) {
    return;
  }

  const now = context.currentTime;
  const mainGain = context.createGain();
  mainGain.gain.setValueAtTime(0.0001, now);
  mainGain.gain.exponentialRampToValueAtTime(hitSeat ? 0.38 : 0.24, now + 0.018);
  mainGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.34);
  mainGain.connect(context.destination);

  const oscillator = context.createOscillator();
  oscillator.type = 'sawtooth';
  oscillator.frequency.setValueAtTime(150, now);
  oscillator.frequency.exponentialRampToValueAtTime(48, now + 0.23);
  oscillator.connect(mainGain);
  oscillator.start(now);
  oscillator.stop(now + 0.34);

  const noiseBuffer = context.createBuffer(1, Math.floor(context.sampleRate * 0.28), context.sampleRate);
  const data = noiseBuffer.getChannelData(0);
  for (let i = 0; i < data.length; i += 1) {
    data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
  }

  const noise = context.createBufferSource();
  noise.buffer = noiseBuffer;
  const filter = context.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(hitSeat ? 900 : 560, now);
  filter.frequency.exponentialRampToValueAtTime(160, now + 0.25);
  noise.connect(filter).connect(mainGain);
  noise.start(now + 0.025);
  noise.stop(now + 0.32);
}

function getAudioContext() {
  if (!audioContext) {
    const audioWindow = window as Window & { webkitAudioContext?: AudioContextConstructor };
    const AudioContextClass = window.AudioContext || audioWindow.webkitAudioContext;
    if (!AudioContextClass) {
      return undefined;
    }
    audioContext = new AudioContextClass();
  }

  if (audioContext.state === 'suspended') {
    audioContext.resume().catch(() => undefined);
  }

  return audioContext;
}

function animateSplats(delta: number) {
  for (const splat of splats) {
    splat.scale.x = Math.min(1, splat.scale.x + delta * 1.6);
  }
}

function moveEntity(position: THREE.Vector3, movement: THREE.Vector3, radius: number) {
  if (movement.lengthSq() === 0) {
    return;
  }

  const nextX = position.clone();
  nextX.x += movement.x;
  if (!isBlocked(nextX, radius)) {
    position.x = nextX.x;
  }

  const nextZ = position.clone();
  nextZ.z += movement.z;
  if (!isBlocked(nextZ, radius)) {
    position.z = nextZ.z;
  }
}

function isBlocked(position: THREE.Vector3, radius: number) {
  return colliders.some((collider) => circleIntersectsAabb(position.x, position.z, radius, collider));
}

function circleIntersectsAabb(x: number, z: number, radius: number, collider: Collider) {
  const closestX = THREE.MathUtils.clamp(x, collider.minX, collider.maxX);
  const closestZ = THREE.MathUtils.clamp(z, collider.minZ, collider.maxZ);
  const dx = x - closestX;
  const dz = z - closestZ;
  return dx * dx + dz * dz < radius * radius;
}

function addColliderFromBox(position: Vec3Tuple, size: Vec3Tuple) {
  colliders.push({
    minX: position[0] - size[0] / 2,
    maxX: position[0] + size[0] / 2,
    minZ: position[2] - size[2] / 2,
    maxZ: position[2] + size[2] / 2,
  });
}

function addRotatedCollider(position: Vec3Tuple, width: number, depth: number, rotation: number) {
  const cos = Math.abs(Math.cos(rotation));
  const sin = Math.abs(Math.sin(rotation));
  const worldWidth = width * cos + depth * sin;
  const worldDepth = width * sin + depth * cos;
  addColliderFromBox([position[0], 0, position[2]], [worldWidth, 1, worldDepth]);
}

function updateCamera() {
  const target = player.position.clone().add(new THREE.Vector3(0, 0.9, 0));
  const forward = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
  const distance = isTouchDevice ? 4.6 : 4.25;
  const cameraPosition = target
    .clone()
    .sub(forward.multiplyScalar(distance))
    .add(new THREE.Vector3(0, 1.65 + pitch * 2.2, 0));

  camera.position.lerp(cameraPosition, 0.18);
  camera.lookAt(target.add(new THREE.Vector3(Math.sin(yaw) * 1.2, pitch * 1.2, Math.cos(yaw) * 1.2)));
}

function showShout(text: string) {
  shoutEl.textContent = text;
  shoutEl.classList.add('is-visible');
  shoutTimer = 2.1;
}

function winGame() {
  gameState = 'won';
  document.exitPointerLock?.();
  overlayEl.classList.remove('is-hidden');
  overlayEl.querySelector('h1')!.textContent = 'Couches Complete';
  overlayEl.querySelector('p')!.textContent = 'Every seat is a masterpiece. Eddie needs a minute.';
  startButton.textContent = 'Play Again';
  showShout('¡Todos los sofás!');
}

function loseGame() {
  gameState = 'lost';
  document.exitPointerLock?.();
  overlayEl.classList.remove('is-hidden');
  overlayEl.querySelector('h1')!.textContent = 'Eddie Got You';
  overlayEl.querySelector('p')!.textContent = 'He caught Theo before the couch mission was complete.';
  startButton.textContent = 'Try Again';
  showShout('¡Te agarré!');
}

function restartGame() {
  gameState = 'ready';
  vomitCooldown = 0;
  shoutTimer = 0;
  player.position.set(0, 0, 0.4);
  eddie.position.set(...level.eddieSpawn);
  eddie.active = false;
  eddie.mesh.visible = false;
  yaw = Math.PI * 0.12;
  pitch = 0.08;
  shoutEl.classList.remove('is-visible');
  shoutEl.textContent = '';

  for (const couch of couches) {
    couch.completed = false;
  }

  for (const seat of seats) {
    seat.vomited = false;
    const material = seat.mesh.material;
    if (material instanceof THREE.MeshStandardMaterial) {
      material.color.set(new THREE.Color(level.couches.find((couch) => couch.id === seat.couchId)?.color ?? 0xffffff).offsetHSL(0, 0.08, 0.1));
      material.emissive.set(0x000000);
    }
  }

  for (const splat of splats) {
    splat.removeFromParent();
  }
  splats.length = 0;

  for (const stream of vomitStreams) {
    stream.group.removeFromParent();
  }
  vomitStreams.length = 0;

  overlayEl.querySelector('h1')!.textContent = "Eddie's Couch";
  overlayEl.querySelector('p')!.textContent =
    'Help Theo hit every couch seat before Eddie catches him. Watch the hotdog buns.';
  startButton.textContent = 'Start';
  targetEl.textContent = 'Find a clean seat';
  updateHud();
  player.mesh.position.copy(player.position);
  eddie.mesh.position.copy(eddie.position);
}

function setupTouchControls() {
  if (!isTouchDevice) {
    return;
  }

  let joystickPointerId: number | null = null;
  let joystickCenter = new THREE.Vector2();
  let lookPointerId: number | null = null;
  let lastLook = new THREE.Vector2();

  joystickEl.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    joystickPointerId = event.pointerId;
    joystickEl.setPointerCapture(event.pointerId);
    const rect = joystickEl.getBoundingClientRect();
    joystickCenter = new THREE.Vector2(rect.left + rect.width / 2, rect.top + rect.height / 2);
    updateJoystick(event.clientX, event.clientY);
  });

  joystickEl.addEventListener('pointermove', (event) => {
    if (event.pointerId === joystickPointerId) {
      updateJoystick(event.clientX, event.clientY);
    }
  });

  joystickEl.addEventListener('pointerup', (event) => {
    if (event.pointerId === joystickPointerId) {
      joystickPointerId = null;
      mobileMove.set(0, 0);
      joystickKnobEl.style.transform = 'translate(-50%, -50%)';
    }
  });

  joystickEl.addEventListener('pointercancel', () => {
    joystickPointerId = null;
    mobileMove.set(0, 0);
    joystickKnobEl.style.transform = 'translate(-50%, -50%)';
  });

  canvas.addEventListener('pointerdown', (event) => {
    const target = event.target as HTMLElement;
    if (target.closest('.mobile-controls') || event.clientX < window.innerWidth * 0.34) {
      return;
    }
    lookPointerId = event.pointerId;
    canvas.setPointerCapture(event.pointerId);
    lastLook.set(event.clientX, event.clientY);
  });

  canvas.addEventListener('pointermove', (event) => {
    if (event.pointerId !== lookPointerId || gameState !== 'playing') {
      return;
    }

    const dx = event.clientX - lastLook.x;
    const dy = event.clientY - lastLook.y;
    lastLook.set(event.clientX, event.clientY);
    yaw -= dx * 0.0043;
    pitch = THREE.MathUtils.clamp(pitch - dy * 0.0036, -0.42, 0.55);
  });

  canvas.addEventListener('pointerup', (event) => {
    if (event.pointerId === lookPointerId) {
      lookPointerId = null;
    }
  });

  canvas.addEventListener('pointercancel', () => {
    lookPointerId = null;
  });

  vomitButton.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    tryVomit();
  });

  function updateJoystick(clientX: number, clientY: number) {
    const delta = new THREE.Vector2(clientX, clientY).sub(joystickCenter);
    const limit = 44;
    const length = Math.min(delta.length(), limit);
    const direction = delta.length() > 0 ? delta.normalize() : delta;
    const knob = direction.clone().multiplyScalar(length);

    mobileMove.set(knob.x / limit, -knob.y / limit);
    joystickKnobEl.style.transform = `translate(calc(-50% + ${knob.x}px), calc(-50% + ${knob.y}px))`;
  }
}
