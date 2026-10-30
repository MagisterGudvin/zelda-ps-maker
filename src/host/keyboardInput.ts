import type { ToolkitConfig } from "../core/config.ts";
import { HOTBAR_ACTIONS, INPUT_ACTIONS, type InputAction, type InputDevice, type InputSource } from "./types.ts";
import type { Facing } from "../core/math.ts";

/** Minimal event-emitter surface (Phaser's KeyboardPlugin / Game events). */
export interface EmitterLike {
  on(event: string, fn: (...args: any[]) => void, context?: unknown): unknown;
  off(event: string, fn: (...args: any[]) => void, context?: unknown): unknown;
}

/** PS Maker's names of the mouse buttons (features/controls: mouseButtonKeys), usable as keys. */
export const MOUSE_CODES = ["MouseLeft", "MouseMiddle", "MouseRight"] as const;

/**
 * Normalizes a binding or a KeyboardEvent.code: "x" -> "KeyX", "5" -> "Digit5",
 * "ShiftLeft"/"ShiftRight" -> "Shift" so either side matches.
 */
export function normalizeKey(code: string): string {
  const c = code.trim();
  if (/^[a-z]$/i.test(c)) return `Key${c.toUpperCase()}`;
  if (/^[0-9]$/.test(c)) return `Digit${c}`;
  const m = /^(Shift|Control|Alt|Meta)(Left|Right)$/.exec(c);
  if (m) return m[1];
  return KEY_NAMES[c.toLowerCase()] ?? c;
}

/** Friendly names typed in editor fields (case-insensitive). */
const KEY_NAMES: Record<string, string> = {
  space: "Space",
  enter: "Enter",
  return: "Enter",
  tab: "Tab",
  shift: "Shift",
  ctrl: "Control",
  control: "Control",
  alt: "Alt",
  esc: "Escape",
  escape: "Escape",
  backspace: "Backspace",
  up: "ArrowUp",
  down: "ArrowDown",
  left: "ArrowLeft",
  right: "ArrowRight",
};

/**
 * Listens to raw key events instead of creating Phaser Key objects, so the
 * toolkit never steals or removes keys that PS Maker itself registered.
 * Presses between two fixed ticks are latched and reported exactly once.
 */
export class KeyboardInput implements InputSource {
  private readonly bindings = new Map<string, InputAction[]>();
  private readonly moveKeys = new Map<string, Facing>();
  /** Held movement directions, most recent last. */
  private readonly heldDirs: Facing[] = [];
  private readonly down = new Set<string>();
  private readonly pendingPress = new Set<string>();
  private readonly pendingRelease = new Set<string>();
  private readonly isDownMap = new Map<InputAction, boolean>();
  private readonly pressedMap = new Map<InputAction, boolean>();
  private readonly releasedMap = new Map<InputAction, boolean>();
  private readonly keyboard: EmitterLike | null;
  private readonly blurSource: EmitterLike | null;
  private readonly mouse: EmitterLike | null;
  private readonly config: ToolkitConfig;
  /** The device the player used last (key prompts follow it); the gamepad bridge sets it too. */
  device: InputDevice = { kind: "keyboard", family: "xbox" };
  private capture: ((code: string) => void) | null = null;

  /** While PS Maker pauses the game (options or load menu), Phaser queues key events and delivers them after. */
  private pausedAt: number | null = null;
  private pausedUntil = -1;

  private readonly onDown = (event: KeyboardEvent) => {
    if (!event || typeof event.code !== "string") return;
    // A real key (not one the gamepad bridge sent): the keyboard is the device now.
    if (event.isTrusted !== false) {
      if (this.device.kind !== "keyboard") this.device = { kind: "keyboard", family: this.device.family };
      if (this.capture) {
        const cb = this.capture;
        this.capture = null;
        cb(normalizeKey(event.code));
        return;
      }
    }
    // A key pressed in the menu does not swing the sword once the menu closes.
    const t = typeof event.timeStamp === "number" ? event.timeStamp : -1;
    if (t >= 0 && (this.pausedAt !== null ? t >= this.pausedAt : t <= this.pausedUntil)) return;
    const code = normalizeKey(event.code);
    if (!this.down.has(code)) {
      this.pendingPress.add(code);
      const dir = this.moveKeys.get(code);
      if (dir) {
        const i = this.heldDirs.indexOf(dir);
        if (i >= 0) this.heldDirs.splice(i, 1);
        this.heldDirs.push(dir);
      }
    }
    this.down.add(code);
  };

  private readonly onUp = (event: KeyboardEvent) => {
    if (!event || typeof event.code !== "string") return;
    const code = normalizeKey(event.code);
    this.down.delete(code);
    this.pendingRelease.add(code);
    const dir = this.moveKeys.get(code);
    if (dir && !this.isDirHeld(dir)) this.heldDirs.splice(this.heldDirs.indexOf(dir), 1);
  };

  private isDirHeld(dir: Facing): boolean {
    for (const [code, d] of this.moveKeys) if (d === dir && this.down.has(code)) return true;
    return false;
  }

  private readonly onBlur = () => this.reset();
  private readonly onPause = () => {
    this.pausedAt = now();
    this.reset();
  };
  private readonly onResume = () => {
    this.pausedAt = null;
    this.pausedUntil = now();
  };

  /** Mouse buttons are keys too ("MouseLeft", "MouseRight", "MouseMiddle"), as in PS Maker's controls. */
  private readonly onPointerDown = (pointer: { button?: number; event?: { timeStamp?: number } }) => {
    const code = MOUSE_CODES[pointer?.button ?? 0];
    if (code) this.onDown({ code, timeStamp: pointer.event?.timeStamp ?? -1 } as KeyboardEvent);
  };

  private readonly onPointerUp = (pointer: { button?: number }) => {
    const code = MOUSE_CODES[pointer?.button ?? 0];
    if (code) this.onUp({ code } as KeyboardEvent);
  };

  constructor(config: ToolkitConfig, keyboard: EmitterLike | null, blurSource: EmitterLike | null, mouse: EmitterLike | null = null) {
    this.config = config;
    this.keyboard = keyboard;
    this.blurSource = blurSource;
    this.mouse = mouse;
    this.rebind();
    keyboard?.on("keydown", this.onDown);
    keyboard?.on("keyup", this.onUp);
    mouse?.on("pointerdown", this.onPointerDown);
    mouse?.on("pointerup", this.onPointerUp);
    blurSource?.on("blur", this.onBlur);
    blurSource?.on("pause", this.onPause);
    blurSource?.on("resume", this.onResume);
  }

  /**
   * A key press the toolkit took from the page before Phaser saw it (Phaser skips key events whose
   * default was prevented); counted like any other press.
   */
  inject(event: KeyboardEvent): void {
    this.onDown(event);
  }

  /** True when this key code is bound to the action. */
  isBound(code: string, action: InputAction): boolean {
    return this.bindings.get(normalizeKey(code))?.includes(action) ?? false;
  }

  /** Rebuilds the key map from configuration (called on Configure). */
  rebind(): void {
    this.bindings.clear();
    const c = this.config.controls;
    const add = (action: InputAction, keys: string[]) => {
      for (const k of keys) {
        const code = normalizeKey(k);
        const list = this.bindings.get(code) ?? [];
        if (!list.includes(action)) list.push(action);
        this.bindings.set(code, list);
      }
    };
    add("sword", c.sword);
    add("useItem", c.useItem);
    add("useItem2", c.useItem2);
    add("shield", c.shield);
    add("action", c.action);
    add("nextItem", c.nextItem);
    add("prevItem", c.prevItem);
    add("inventory", c.inventory);
    add("menu", c.menu);
    HOTBAR_ACTIONS.forEach((a, i) => add(a, c.hotbar[i] ? [c.hotbar[i]] : []));
    add("up", c.move.up);
    add("down", c.move.down);
    add("left", c.move.left);
    add("right", c.move.right);
    add("debug", [this.config.debug.toggleKey]);
    add("diagnostics", [this.config.debug.diagnosticsKey]);
    this.moveKeys.clear();
    const m = c.move;
    for (const [dir, keys] of [["up", m.up], ["down", m.down], ["left", m.left], ["right", m.right]] as [Facing, string[]][]) {
      for (const k of keys) this.moveKeys.set(normalizeKey(k), dir);
    }
  }

  /**
   * Facing from held movement keys: keeps `current` while it is still held
   * (diagonal strafing), otherwise the most recently pressed direction.
   */
  directionHint(current: Facing): Facing | null {
    if (this.heldDirs.length === 0) return null;
    if (this.heldDirs.includes(current)) return current;
    return this.heldDirs[this.heldDirs.length - 1];
  }

  latch(): void {
    for (const a of INPUT_ACTIONS) {
      this.isDownMap.set(a, false);
      this.pressedMap.set(a, false);
      this.releasedMap.set(a, false);
    }
    for (const code of this.down) for (const a of this.bindings.get(code) ?? []) this.isDownMap.set(a, true);
    for (const code of this.pendingPress) for (const a of this.bindings.get(code) ?? []) this.pressedMap.set(a, true);
    for (const code of this.pendingRelease) for (const a of this.bindings.get(code) ?? []) this.releasedMap.set(a, true);
    this.pendingPress.clear();
    this.pendingRelease.clear();
  }

  /** The next real key or mouse button goes to `cb` instead of the game (rebinding a key); null cancels. */
  captureNext(cb: ((code: string) => void) | null): void {
    this.capture = cb;
  }

  /** True while the next key is being captured. */
  get capturing(): boolean {
    return this.capture !== null;
  }

  /** Any key bound to a toolkit action (for prompts): the action's keys, normalized. */
  keysOf(action: InputAction): string[] {
    const out: string[] = [];
    for (const [code, actions] of this.bindings) if (actions.includes(action)) out.push(code);
    return out;
  }

  isDown(action: InputAction): boolean {
    return this.isDownMap.get(action) ?? false;
  }

  pressed(action: InputAction): boolean {
    return this.pressedMap.get(action) ?? false;
  }

  released(action: InputAction): boolean {
    return this.releasedMap.get(action) ?? false;
  }

  reset(): void {
    this.heldDirs.length = 0;
    this.down.clear();
    this.pendingPress.clear();
    this.pendingRelease.clear();
    this.isDownMap.clear();
    this.pressedMap.clear();
    this.releasedMap.clear();
  }

  dispose(): void {
    this.keyboard?.off("keydown", this.onDown);
    this.keyboard?.off("keyup", this.onUp);
    this.mouse?.off("pointerdown", this.onPointerDown);
    this.mouse?.off("pointerup", this.onPointerUp);
    this.capture = null;
    this.blurSource?.off("blur", this.onBlur);
    this.blurSource?.off("pause", this.onPause);
    this.blurSource?.off("resume", this.onResume);
    this.reset();
  }
}

/** Same clock as KeyboardEvent.timeStamp in the browser. */
function now(): number {
  return typeof performance !== "undefined" && typeof performance.now === "function" ? performance.now() : Date.now();
}
