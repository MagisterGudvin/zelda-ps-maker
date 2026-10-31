import type { Toolkit } from "./toolkit.ts";
import type { ToolkitConfig } from "./config.ts";
import { PAD_ACTIONS, type PadAction } from "../host/gamepadBridge.ts";
import { normalizeKey } from "../host/keyboardInput.ts";

/**
 * Keys and pad buttons the player chose in the game (a key bindings screen made in the UI
 * Designer). They are the player's, not the project's: kept in the browser (localStorage, per
 * project) and laid over the project's controls (Start Toolkit, Set Controls) whenever those are
 * set, so a map's Set Controls does not undo them. "Reset" goes back to the project's controls.
 */
export interface PlayerControls {
  keys: Partial<Record<KeyRow, string[]>>;
  pad: Partial<Record<PadAction, number>>;
}

/** Walking: PS Maker's own movement keys, which the player can change too (keys only; the pad moves with the d-pad and stick). */
export const MOVE_DIRS = ["up", "down", "left", "right"] as const;
export type MoveDir = (typeof MOVE_DIRS)[number];
/** The rows of a key bindings screen: walking, then the toolkit's actions. */
export type KeyRow = MoveDir | PadAction;
export const KEY_ROWS: readonly KeyRow[] = [...MOVE_DIRS, ...PAD_ACTIONS];

export const isMoveDir = (a: string): a is MoveDir => (MOVE_DIRS as readonly string[]).includes(a);

/** The keys of a row now (the first is the one shown and changed). */
export function rowKeys(c: ToolkitConfig["controls"], row: KeyRow): string[] {
  return isMoveDir(row) ? c.move[row] : c[row];
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
    for (const a of KEY_ROWS) {
      const k = raw?.keys?.[a];
      if (Array.isArray(k) && k.every((x) => typeof x === "string") && k.length) out.keys[a] = k;
    }
    for (const a of PAD_ACTIONS) {
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
  const controls: Record<string, unknown> = {};
  for (const a of PAD_ACTIONS) if (pc.keys[a]) controls[a] = pc.keys[a];
  const move = Object.fromEntries(MOVE_DIRS.filter((d) => pc.keys[d]).map((d) => [d, pc.keys[d]]));
  if (Object.keys(move).length) controls.move = move;
  if (Object.keys(pc.pad).length) controls.gamepad = { ...pc.pad };
  if (Object.keys(controls).length) tk.configure({ controls }, "player controls");
  tk.session?.host.input.rebind?.();
  applyGameKeys(tk, pc);
}

/**
 * PS Maker's own controls the player changed: walking (the up/down/left/right rows) and Interact
 * (the toolkit's Action row: one key opens, lifts and talks). The host hands PS Maker its own keys
 * for the player's (phaserHost.ts, setPlayerGameKeys); none changed = PS Maker's keys as they are.
 */
export function applyGameKeys(tk: Toolkit, pc: PlayerControls = loadPlayerControls(tk)): void {
  tk.session?.host.setPlayerGameKeys?.({ moveUp: pc.keys.up, moveDown: pc.keys.down, moveLeft: pc.keys.left, moveRight: pc.keys.right, interact: pc.keys.action });
}

/**
 * The player binds an action to a key (or mouse button) or a pad button. The action that had it
 * gets this action's old one (a swap), so no two actions share a key by accident.
 */
export function bindAction(tk: Toolkit, action: KeyRow, to: { key: string } | { button: number }): void {
  const pc = loadPlayerControls(tk);
  const c = tk.config.controls;
  if ("key" in to) {
    const key = normalizeKey(to.key);
    const same = (k: string) => normalizeKey(k) === key;
    const old = rowKeys(c, action)[0];
    for (const other of KEY_ROWS) {
      const list = rowKeys(c, other);
      if (other === action || !list.some(same)) continue;
      // Its main key goes over to the old key of this row; a second key of it is just dropped.
      const rest = list.filter((k) => !same(k));
      pc.keys[other] = same(list[0]) && old ? [old, ...rest.filter((k) => k !== old)] : rest;
    }
    pc.keys[action] = [key, ...rowKeys(c, action).slice(1).filter((k) => !same(k))];
  } else {
    if (isMoveDir(action)) return;
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
  applyGameKeys(tk, { keys: {}, pad: {} });
}
