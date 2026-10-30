import type { Toolkit } from "./toolkit.ts";
import { PAD_ACTIONS, type PadAction } from "../host/gamepadBridge.ts";

/**
 * Keys and pad buttons the player chose in the game (a key bindings screen made in the UI
 * Designer). They are the player's, not the project's: kept in the browser (localStorage, per
 * project) and laid over the project's controls (Start Toolkit, Set Controls) whenever those are
 * set, so a map's Set Controls does not undo them. "Reset" goes back to the project's controls.
 */
export interface PlayerControls {
  keys: Partial<Record<PadAction, string[]>>;
  pad: Partial<Record<PadAction, number>>;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function storage(): StorageLike | null {
  try {
    return (globalThis as { localStorage?: StorageLike }).localStorage ?? null;
  } catch {
    return null;
  }
}

const key = (tk: Toolkit) => `zelda-maker-toolkit:controls:${tk.projectKey || "game"}`;

export function loadPlayerControls(tk: Toolkit): PlayerControls {
  const out: PlayerControls = { keys: {}, pad: {} };
  try {
    const raw = JSON.parse(storage()?.getItem(key(tk)) ?? "null") as Partial<PlayerControls> | null;
    for (const a of PAD_ACTIONS) {
      const k = raw?.keys?.[a];
      if (Array.isArray(k) && k.every((x) => typeof x === "string") && k.length) out.keys[a] = k;
      const b = raw?.pad?.[a];
      if (typeof b === "number" && Number.isInteger(b) && b >= 0 && b < 32) out.pad[a] = b;
    }
  } catch {
    // Unreadable: the project's controls.
  }
  return out;
}

function save(tk: Toolkit, pc: PlayerControls): void {
  try {
    storage()?.setItem(key(tk), JSON.stringify(pc));
  } catch {
    // Storage off (private mode): the choice lasts this session only.
  }
}

/** The project's controls as set now (Start Toolkit, Set Controls), before the player's choices. */
export function rememberProjectControls(tk: Toolkit): void {
  tk.projectControls = JSON.parse(JSON.stringify(tk.config.controls));
}

/** Lays the player's choices over the project's controls. */
export function applyPlayerControls(tk: Toolkit): void {
  const pc = loadPlayerControls(tk);
  const controls: Record<string, unknown> = { ...pc.keys };
  if (Object.keys(pc.pad).length) controls.gamepad = { ...pc.pad };
  if (Object.keys(controls).length) tk.configure({ controls }, "player controls");
  tk.session?.host.input.rebind?.();
}

/**
 * The player binds an action to a key (or mouse button) or a pad button. The action that had it
 * gets this action's old one (a swap), so no two actions share a key by accident.
 */
export function bindAction(tk: Toolkit, action: PadAction, to: { key: string } | { button: number }): void {
  const pc = loadPlayerControls(tk);
  const c = tk.config.controls;
  if ("key" in to) {
    const old = c[action][0];
    for (const other of PAD_ACTIONS) {
      if (other === action || c[other][0] !== to.key) continue;
      pc.keys[other] = [old, ...c[other].slice(1).filter((k) => k !== old)];
    }
    pc.keys[action] = [to.key, ...c[action].slice(1).filter((k) => k !== to.key)];
  } else {
    const old = c.gamepad[action];
    for (const other of PAD_ACTIONS) if (other !== action && c.gamepad[other] === to.button) pc.pad[other] = old;
    pc.pad[action] = to.button;
  }
  save(tk, pc);
  applyPlayerControls(tk);
}

/** Forgets the player's choices: the project's controls again. */
export function resetPlayerControls(tk: Toolkit): void {
  try {
    storage()?.removeItem(key(tk));
  } catch {
    // Nothing kept.
  }
  if (tk.projectControls) tk.configure({ controls: JSON.parse(JSON.stringify(tk.projectControls)) }, "controls reset");
  tk.session?.host.input.rebind?.();
}
