import type { Session } from "../core/session.ts";
import { Enemy } from "../enemies/enemy.ts";
import { Interactable } from "../interactions/interactable.ts";
import { TOOLKIT_VERSION } from "../core/version.ts";

const COLORS = {
  player: 0x00ff00,
  hitbox: 0xff0000,
  enemy: 0xff8800,
  solid: 0x3399ff,
  object: 0x00ffff,
  projectile: 0xffff00,
  pickup: 0xff66ff,
};

/**
 * Hitbox/state overlay. Toggled with `debug.toggleKey` (F9) or the
 * `Zelda: Debug` action. Draws nothing (and costs nothing) when off.
 */
export class DebugSystem {
  readonly name = "debug";
  private readonly s: Session;
  private enabled: boolean;
  private diagnostics: boolean;
  private diagTimer = 0;

  constructor(session: Session) {
    this.s = session;
    this.enabled = session.config.debug.hitboxes;
    this.diagnostics = session.config.debug.diagnostics;
    session.host.debug?.setVisible(this.enabled);
  }

  get diagnosticsOn(): boolean {
    return this.diagnostics;
  }

  setDiagnostics(on: boolean): void {
    this.diagnostics = on;
    this.diagTimer = 0;
    if (!on) this.s.host.hud?.setDiagnostics(null);
  }

  /** Lines for the on-screen diagnostics panel (F10). */
  diagnosticsLines(): string[] {
    const s = this.s;
    const p = s.player;
    const r = (v: number) => Math.round(v);
    const lines = [`Zelda Maker Toolkit ${TOOLKIT_VERSION} — map "${s.mapId}" tick ${s.tick}${s.isPaused() ? " (paused)" : ""}  [F10 hides]`, ...s.host.describe()];
    lines.push(p.present ? `player body ${r(p.box.x)},${r(p.box.y)} ${r(p.box.hw * 2)}x${r(p.box.hh * 2)} facing ${p.facing} hp ${s.state.player.hp}/${s.state.player.maxHp}${p.isDead ? " DEAD" : ""}` : "player: NOT FOUND (ctx.player missing?)");
    const counts = (["enemy", "object", "projectile", "pickup"] as const).map((k) => `${k}s ${s.world.count(k)}`).join(", ");
    lines.push(`entities: ${counts}`);
    const near = [...s.world.list("enemy"), ...s.world.list("object")]
      .filter((e) => !e.removed)
      .sort((a, b) => Math.abs(a.x - p.box.x) + Math.abs(a.y - p.box.y) - (Math.abs(b.x - p.box.x) + Math.abs(b.y - p.box.y)))
      .slice(0, 6);
    for (const e of near) {
      const extra = e instanceof Enemy ? `${e.cfg.template} ${e.state} hp ${e.hp}` : e instanceof Interactable ? `${e.cfg.type} ${e.objState}${e.visible ? "" : " hidden"}` : "";
      lines.push(`  ${e.id} at ${r(e.x)},${r(e.y)} (${r(e.x - p.box.x)},${r(e.y - p.box.y)} from player) ${extra}`);
    }
    // Warnings and errors first: they explain why something did not appear.
    const problems = s.logger.history.filter((l) => l.level !== "info").slice(-4);
    const recent = s.logger.history.filter((l) => l.level === "info").slice(-4);
    const clip = (t: string) => (t.length > 110 ? `${t.slice(0, 107)}...` : t);
    if (problems.length) lines.push("problems:");
    for (const l of problems) lines.push(`  ${l.level.toUpperCase()} ${clip(l.text)}`);
    if (recent.length) lines.push("recent:");
    for (const l of recent) lines.push(`  ${clip(l.text)}`);
    return lines;
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    const d = this.s.host.debug;
    if (!d) return;
    d.clear();
    d.setVisible(on);
  }

  handleInput(): void {
    if (this.s.host.input.pressed("debug")) this.setEnabled(!this.enabled);
    if (this.s.host.input.pressed("diagnostics")) this.setDiagnostics(!this.diagnostics);
  }

  tick(_dtMs: number): void {
    if (this.diagnostics && this.diagTimer-- <= 0) {
      this.diagTimer = 15;
      this.s.host.hud?.setDiagnostics(this.diagnosticsLines());
    }
    const d = this.s.host.debug;
    if (!this.enabled || !d) return;
    d.clear();
    const p = this.s.player;
    if (p.present) d.rect(p.box, p.isInvulnerable ? 0x88ff88 : COLORS.player, 0.25);
    const sword = this.s.sword;
    if (sword?.hitboxActive) {
      if (sword.phase === "spin") d.circle(p.box.x, p.box.y, sword.spinRadius, COLORS.hitbox, 0.35);
      else d.rect(sword.hitbox, COLORS.hitbox, 0.45);
    }
    for (const e of this.s.world.all()) {
      if (e.removed) continue;
      if (e instanceof Enemy) {
        d.rect(e, e.alive ? COLORS.enemy : 0x666666, 0.3);
        d.label(e.x - e.hw, e.y - e.hh - 10, `${e.state} ${e.hp}/${e.maxHp}${e.guardUp ? " G" : ""}`);
      } else if (e instanceof Interactable) {
        if (!e.visible) continue;
        d.rect(e, e.solid ? COLORS.solid : COLORS.object, 0.2);
        d.label(e.x - e.hw, e.y - e.hh - 10, `${e.id}:${e.objState}`);
      } else if (e.kind === "projectile") {
        d.rect(e, COLORS.projectile, 0.4);
      } else if (e.kind === "pickup") {
        d.rect(e, COLORS.pickup, 0.3);
      }
    }
  }

  dispose(): void {
    if (this.diagnostics) this.s.host.hud?.setDiagnostics(null);
    const d = this.s.host.debug;
    d?.clear();
    d?.setVisible(false);
  }
}
