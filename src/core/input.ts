import * as THREE from 'three';

export interface TouchElements {
  zone: HTMLElement;
  joystick: HTMLElement;
  knob: HTMLElement;
  pukeButton: HTMLElement;
  toyButton: HTMLElement;
}

/**
 * Collects keyboard, mouse and touch input into a per-frame snapshot.
 * Movement is in camera space: x = right, y = forward.
 */
export class Input {
  readonly move = new THREE.Vector2();
  readonly look = new THREE.Vector2();
  zoom = 0;
  pukeHeld = false;
  pukePressed = false;
  pukeReleased = false;
  throwPressed = false;
  pausePressed = false;
  mutePressed = false;
  sprintHeld = false;
  enabled = false;
  pointerLocked = false;
  private hadPointerLock = false;
  /** Set when the browser refuses pointer lock; we fall back to right-drag look. */
  private lockFailed = false;
  private dragLook = false;
  onPointerLockLost?: () => void;

  private readonly keys = new Set<string>();
  private readonly touchMove = new THREE.Vector2();
  private touchSprint = false;
  private mousePuke = false;
  private keyPuke = false;
  private touchPuke = false;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    readonly isTouch: boolean,
    private readonly touch: TouchElements,
  ) {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', () => this.releaseAll());
    document.addEventListener('pointerlockchange', this.onLockChange);
    document.addEventListener('pointerlockerror', () => (this.lockFailed = true));

    if (isTouch) {
      this.setupTouch();
    } else {
      canvas.addEventListener('mousedown', this.onMouseDown);
      window.addEventListener('mouseup', this.onMouseUp);
      window.addEventListener('mousemove', this.onMouseMove);
      canvas.addEventListener('wheel', this.onWheel, { passive: false });
      canvas.addEventListener('contextmenu', (event) => event.preventDefault());
    }
  }

  /** Called once per frame after the game has read the snapshot. */
  endFrame() {
    this.look.set(0, 0);
    this.zoom = 0;
    this.pukePressed = false;
    this.pukeReleased = false;
    this.throwPressed = false;
    this.pausePressed = false;
    this.mutePressed = false;
  }

  /** Recomputes the continuous inputs; call at the start of each frame. */
  poll() {
    const keyboard = new THREE.Vector2();
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) keyboard.x -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) keyboard.x += 1;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) keyboard.y += 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) keyboard.y -= 1;
    if (keyboard.lengthSq() > 1) keyboard.normalize();

    this.move.copy(keyboard).add(this.touchMove);
    if (this.move.lengthSq() > 1) this.move.normalize();
    this.sprintHeld = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') || this.touchSprint;

    const held = this.mousePuke || this.keyPuke || this.touchPuke;
    if (!this.enabled) {
      this.pukeHeld = false;
      return;
    }
    if (held && !this.pukeHeld) this.pukePressed = true;
    if (!held && this.pukeHeld) this.pukeReleased = true;
    this.pukeHeld = held;
  }

  requestPointerLock() {
    if (this.isTouch || document.pointerLockElement === this.canvas) return;
    try {
      const request = this.canvas.requestPointerLock() as unknown as Promise<void> | undefined;
      request?.catch?.(() => (this.lockFailed = true));
    } catch {
      // Pointer lock can be refused (iframes, privacy settings): fall back to right-drag look.
      this.lockFailed = true;
    }
  }

  exitPointerLock() {
    if (document.pointerLockElement) {
      this.hadPointerLock = false;
      document.exitPointerLock?.();
    }
  }

  releaseAll() {
    this.keys.clear();
    this.mousePuke = false;
    this.keyPuke = false;
    this.touchPuke = false;
    this.dragLook = false;
    this.touchMove.set(0, 0);
    this.touchSprint = false;
  }

  private onLockChange = () => {
    this.pointerLocked = document.pointerLockElement === this.canvas;
    if (this.pointerLocked) {
      this.hadPointerLock = true;
    } else if (this.hadPointerLock) {
      this.hadPointerLock = false;
      this.mousePuke = false;
      this.onPointerLockLost?.();
    }
  };

  private onKeyDown = (event: KeyboardEvent) => {
    if (event.repeat) {
      if (event.code === 'Space') event.preventDefault();
      return;
    }
    this.keys.add(event.code);
    switch (event.code) {
      case 'Space':
        event.preventDefault();
        this.keyPuke = true;
        break;
      case 'KeyE':
        this.keyPuke = true;
        break;
      case 'KeyQ':
      case 'KeyF':
        this.throwPressed = true;
        break;
      case 'Escape':
      case 'KeyP':
        this.pausePressed = true;
        break;
      case 'KeyM':
        this.mutePressed = true;
        break;
      default:
        break;
    }
  };

  private onKeyUp = (event: KeyboardEvent) => {
    this.keys.delete(event.code);
    if (event.code === 'Space' || event.code === 'KeyE') {
      this.keyPuke = this.keys.has('Space') || this.keys.has('KeyE');
    }
  };

  private onMouseDown = (event: MouseEvent) => {
    if (!this.enabled) return;
    if (!this.pointerLocked && !this.lockFailed) {
      this.requestPointerLock();
      return;
    }
    if (event.button === 0) this.mousePuke = true;
    if (event.button === 2) {
      if (this.pointerLocked) this.throwPressed = true;
      else this.dragLook = true;
    }
  };

  private onMouseUp = (event: MouseEvent) => {
    if (event.button === 0) this.mousePuke = false;
    if (event.button === 2) this.dragLook = false;
  };

  private onMouseMove = (event: MouseEvent) => {
    if (!this.enabled || (!this.pointerLocked && !this.dragLook)) return;
    // Chrome occasionally reports a huge bogus delta right after locking.
    if (Math.abs(event.movementX) > 280 || Math.abs(event.movementY) > 280) return;
    this.look.x += event.movementX;
    this.look.y += event.movementY;
  };

  private onWheel = (event: WheelEvent) => {
    event.preventDefault();
    this.zoom += Math.sign(event.deltaY);
  };

  private setupTouch() {
    const { zone, joystick, knob, pukeButton, toyButton } = this.touch;
    let stickId: number | null = null;
    let lookId: number | null = null;
    const stickCenter = new THREE.Vector2();
    const lastLook = new THREE.Vector2();
    const radius = 54;

    const resetStick = () => {
      stickId = null;
      this.touchMove.set(0, 0);
      this.touchSprint = false;
      joystick.classList.remove('is-active', 'is-sprint');
      knob.style.transform = 'translate(-50%, -50%)';
    };

    zone.addEventListener('pointerdown', (event) => {
      if (!this.enabled) return;
      event.preventDefault();
      const leftSide = event.clientX < window.innerWidth * 0.45;
      if (leftSide && stickId === null) {
        stickId = event.pointerId;
        zone.setPointerCapture(event.pointerId);
        stickCenter.set(event.clientX, event.clientY);
        joystick.style.left = `${event.clientX}px`;
        joystick.style.top = `${event.clientY}px`;
        joystick.classList.add('is-active');
      } else if (!leftSide && lookId === null) {
        lookId = event.pointerId;
        zone.setPointerCapture(event.pointerId);
        lastLook.set(event.clientX, event.clientY);
      }
    });

    zone.addEventListener('pointermove', (event) => {
      if (event.pointerId === stickId) {
        const delta = new THREE.Vector2(event.clientX, event.clientY).sub(stickCenter);
        const length = Math.min(delta.length(), radius);
        if (delta.lengthSq() > 0) delta.normalize();
        const knobOffset = delta.clone().multiplyScalar(length);
        const strength = length / radius;
        this.touchMove.set(delta.x * strength, -delta.y * strength);
        this.touchSprint = strength > 0.96;
        joystick.classList.toggle('is-sprint', this.touchSprint);
        knob.style.transform = `translate(calc(-50% + ${knobOffset.x}px), calc(-50% + ${knobOffset.y}px))`;
      } else if (event.pointerId === lookId) {
        this.look.x += (event.clientX - lastLook.x) * 1.7;
        this.look.y += (event.clientY - lastLook.y) * 1.7;
        lastLook.set(event.clientX, event.clientY);
      }
    });

    const end = (event: PointerEvent) => {
      if (event.pointerId === stickId) resetStick();
      if (event.pointerId === lookId) lookId = null;
    };
    zone.addEventListener('pointerup', end);
    zone.addEventListener('pointercancel', end);

    pukeButton.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      pukeButton.setPointerCapture(event.pointerId);
      this.touchPuke = true;
      pukeButton.classList.add('is-held');
    });
    const releasePuke = () => {
      this.touchPuke = false;
      pukeButton.classList.remove('is-held');
    };
    pukeButton.addEventListener('pointerup', releasePuke);
    pukeButton.addEventListener('pointercancel', releasePuke);

    toyButton.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      this.throwPressed = true;
    });
  }
}
