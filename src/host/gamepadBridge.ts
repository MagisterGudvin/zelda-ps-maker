/**
 * Gamepads through the browser's Gamepad API (navigator.getGamepads), with no Phaser plugin:
 * PS Maker 1.2.1 has no gamepad support of its own (no getGamepads in its source), but it reads the
 * keyboard from window key events. So every pad button and the left stick are turned into key
 * presses of the keys they stand for — the toolkit's own keys (sword, items, shield...), PS Maker's
 * movement keys, and any key mapped to a button (controls.gamepad.extra) — and the game, PS Maker's
 * keyboard triggers included, plays with the pad as with the keyboard.
 */

import type { ToolkitConfig } from "../core/config.ts";
import { normalizeKey } from "./keyboardInput.ts";

/** Toolkit actions a pad button can press (their first key). */
export const PAD_ACTIONS = ["sword", "useItem", "useItem2", "shield", "action", "nextItem", "prevItem", "inventory", "menu"] as const;
export type PadAction = (typeof PAD_ACTIONS)[number];

/**
 * Which keys each pad button presses: the toolkit actions' first keys, the d-pad and the stick the
 * movement keys (PS Maker's own, `moveKeys`), and the extra button → key pairs.
 */
export function gamepadMapping(cfg: ToolkitConfig, moveKeys: { up: string; down: string; left: string; right: string }): Map<number, string[]> {
  const out = new Map<number, string[]>();
  const add = (button: number, key: string | undefined) => {
    if (!Number.isInteger(button) || button < 0 || !key) return;
    const code = normalizeKey(key);
    const list = out.get(button) ?? [];
    if (!list.includes(code)) list.push(code);
    out.set(button, list);
  };
  const g = cfg.controls.gamepad;
  for (const a of PAD_ACTIONS) add(g[a], cfg.controls[a][0]);
  add(12, moveKeys.up);
  add(13, moveKeys.down);
  add(14, moveKeys.left);
  add(15, moveKeys.right);
  for (const e of g.extra ?? []) add(e.button, e.key);
  return out;
}

/** What a connected pad shows, read once a frame. */
export interface PadSnapshot {
  id: string;
  buttons: readonly boolean[];
  axes: readonly number[];
}

export type PadFamily = "xbox" | "playstation" | "nintendo";

/** The kind of pad by its id (vendor ids: Sony 054c, Nintendo 057e); everything else reads as Xbox-like. */
export function padFamily(id: string): PadFamily {
  if (/054c|playstation|dualshock|dualsense|wireless controller/i.test(id)) return "playstation";
  if (/057e|nintendo|pro controller|joy-con/i.test(id)) return "nintendo";
  return "xbox";
}

/** Button names of the standard mapping (0 = the bottom face button ... 12-15 the d-pad, 16 the home button). */
const LABELS: Record<PadFamily, readonly string[]> = {
  xbox: ["A", "B", "X", "Y", "LB", "RB", "LT", "RT", "View", "Menu", "LS", "RS", "Up", "Down", "Left", "Right", "Xbox"],
  playstation: ["Cross", "Circle", "Square", "Triangle", "L1", "R1", "L2", "R2", "Share", "Options", "L3", "R3", "Up", "Down", "Left", "Right", "PS"],
  nintendo: ["B", "A", "Y", "X", "L", "R", "ZL", "ZR", "Minus", "Plus", "LS", "RS", "Up", "Down", "Left", "Right", "Home"],
};

export function padButtonLabel(button: number, family: PadFamily): string {
  return LABELS[family][button] ?? `Button ${button}`;
}

/** Pseudo buttons for the left stick (they map like the d-pad). */
const STICK = { up: 12, down: 13, left: 14, right: 15 } as const;

export interface BridgeOptions {
  readPads: () => PadSnapshot[];
  /** Sends a key event to the page (the host dispatches it on window). */
  send: (type: "keydown" | "keyup", code: string) => void;
  /** Button → the key codes it presses, read every poll (the configuration can change). */
  mapping: () => ReadonlyMap<number, readonly string[]>;
  deadzone: () => number;
  /** A pad was used (a button or the stick): the last device is the gamepad, of this family. */
  onUse?: (family: PadFamily) => void;
}

export class GamepadBridge {
  private readonly o: BridgeOptions;
  private readonly prev = new Set<number>();
  /** How many held buttons press each key (a key is let go when none does). */
  private readonly held = new Map<string, number>();
  private capture: ((button: number) => void) | null = null;
  private captured = -1;

  constructor(options: BridgeOptions) {
    this.o = options;
  }

  /** The next newly pressed button goes to `cb` instead of the game (rebinding a gamepad button). */
  captureNext(cb: ((button: number) => void) | null): void {
    this.capture = cb;
  }

  /** Reads the pads and sends the key changes. Call once a frame. */
  poll(): void {
    const pads = this.o.readPads();
    const now = new Set<number>();
    let family: PadFamily | null = null;
    const dz = this.o.deadzone();
    for (const pad of pads) {
      pad.buttons.forEach((down, i) => down && now.add(i));
      const [x = 0, y = 0] = pad.axes;
      if (x <= -dz) now.add(STICK.left);
      if (x >= dz) now.add(STICK.right);
      if (y <= -dz) now.add(STICK.up);
      if (y >= dz) now.add(STICK.down);
      if (now.size && !family) family = padFamily(pad.id);
    }
    const map = this.o.mapping();
    for (const b of now) {
      if (this.prev.has(b)) continue;
      if (this.capture) {
        const cb = this.capture;
        this.capture = null;
        this.captured = b;
        cb(b);
        continue;
      }
      for (const code of map.get(b) ?? []) this.press(code);
    }
    for (const b of this.prev) {
      if (now.has(b)) continue;
      if (b === this.captured) {
        this.captured = -1;
        continue;
      }
      for (const code of map.get(b) ?? []) this.release(code);
    }
    this.prev.clear();
    for (const b of now) this.prev.add(b);
    if (family && now.size) this.o.onUse?.(family);
  }

  private press(code: string): void {
    const n = this.held.get(code) ?? 0;
    this.held.set(code, n + 1);
    if (n === 0) this.o.send("keydown", code);
  }

  private release(code: string): void {
    const n = this.held.get(code) ?? 0;
    if (n <= 1) {
      this.held.delete(code);
      if (n === 1) this.o.send("keyup", code);
    } else this.held.set(code, n - 1);
  }

  /** Lets go of every key a button holds (the map is left, the toolkit stops). */
  releaseAll(): void {
    for (const code of this.held.keys()) this.o.send("keyup", code);
    this.held.clear();
    this.prev.clear();
    this.capture = null;
  }
}
