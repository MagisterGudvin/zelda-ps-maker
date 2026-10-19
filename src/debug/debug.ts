import type { Session } from "../core/session.ts";
import { Enemy } from "../enemies/enemy.ts";
import { Interactable } from "../interactions/interactable.ts";

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
 * `Zelda: Toggle Debug` action. Draws nothing (and costs nothing) when off.
 */
export class DebugSystem {
  readonly name = "debug";
  private readonly s: Session;
  private enabled: boolean;

  constructor(session: Session) {
    this.s = session;
    this.enabled = session.config.debug.hitboxes;
    session.host.debug?.setVisible(this.enabled);
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
  }

  tick(_dtMs: number): void {
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
    const d = this.s.host.debug;
    d?.clear();
    d?.setVisible(false);
  }
}
