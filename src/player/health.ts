import type { Toolkit } from "../core/toolkit.ts";

/**
 * Health/magic mutations live here (not in PlayerSystem) because they must
 * work without a bound map too: chests, rules and save loading change them.
 */
export function changeHealth(tk: Toolkit, delta: number): number {
  const p = tk.state.player;
  const before = p.hp;
  p.hp = clampInt(p.hp + delta, 0, p.maxHp);
  const applied = p.hp - before;
  if (applied !== 0) tk.bus.emit("zelda:player:healthChanged", { hp: p.hp, maxHp: p.maxHp, delta: applied });
  return applied;
}

export function setHealth(tk: Toolkit, value: number): void {
  changeHealth(tk, Math.round(value) - tk.state.player.hp);
}

export function setMaxHealth(tk: Toolkit, value: number, refill: boolean): void {
  const p = tk.state.player;
  const cap = Math.max(1, tk.config.player.maxHealthCap);
  p.maxHp = clampInt(value, 1, cap);
  const before = p.hp;
  p.hp = refill ? p.maxHp : Math.min(p.hp, p.maxHp);
  tk.bus.emit("zelda:player:healthChanged", { hp: p.hp, maxHp: p.maxHp, delta: p.hp - before });
}

export function changeMagic(tk: Toolkit, delta: number): number {
  const p = tk.state.player;
  const before = p.magic;
  p.magic = Math.max(0, Math.min(p.maxMagic, p.magic + delta));
  const applied = p.magic - before;
  if (applied !== 0) tk.bus.emit("zelda:player:magicChanged", { magic: p.magic, maxMagic: p.maxMagic, delta: applied });
  return applied;
}

function clampInt(v: number, min: number, max: number): number {
  const r = Math.round(v);
  return r < min ? min : r > max ? max : r;
}
