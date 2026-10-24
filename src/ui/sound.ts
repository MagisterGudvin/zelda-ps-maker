import type { Session } from "../core/session.ts";

/** Moments that can have a sound (names used by `Zelda: Set Sound`). */
export const SOUND_EVENTS = [
  "swordSwing",
  "spinAttack",
  "enemyHurt",
  "enemyDefeated",
  "playerHurt",
  "playerDie",
  "shieldBlock",
  "bombExplode",
  "objectBreak",
  "pickup",
  "itemGet",
  "chestOpen",
  "doorUnlock",
  "puzzleSolved",
] as const;

export type SoundEvent = (typeof SOUND_EVENTS)[number];

const SMALL_PICKUPS = new Set(["heart", "rupees", "magic", "bombs", "arrows"]);

/**
 * Plays author sounds for toolkit moments. Purely event-driven: it only
 * listens to the bus, so gameplay code never deals with audio.
 */
export class SoundSystem {
  private readonly s: Session;
  private readonly offs: (() => void)[] = [];

  constructor(session: Session) {
    this.s = session;
    const bus = session.bus;
    const on = (off: () => void) => {
      this.offs.push(off);
    };
    on(bus.on("zelda:player:attack", (e) => this.play(e.kind === "spin" ? "spinAttack" : "swordSwing")));
    on(bus.on("zelda:enemy:damaged", () => this.play("enemyHurt")));
    on(bus.on("zelda:enemy:defeated", () => this.play("enemyDefeated")));
    on(bus.on("zelda:player:takeDamage", () => this.play("playerHurt")));
    on(bus.on("zelda:player:died", () => this.play("playerDie")));
    on(bus.on("zelda:player:blocked", () => this.play("shieldBlock")));
    on(bus.on("zelda:enemy:blocked", () => this.play("shieldBlock")));
    on(bus.on("zelda:bomb:exploded", () => this.play("bombExplode")));
    on(bus.on("zelda:object:destroyed", () => this.play("objectBreak")));
    on(bus.on("zelda:item:collected", (e) => this.play(SMALL_PICKUPS.has(e.itemId) ? "pickup" : "itemGet")));
    on(bus.on("zelda:chest:opened", () => this.play("chestOpen")));
    on(bus.on("zelda:door:unlocked", () => this.play("doorUnlock")));
    on(bus.on("zelda:puzzle:solved", () => this.play("puzzleSolved")));
  }

  play(event: SoundEvent): void {
    const a = this.s.config.audio;
    const snd = a.sounds[event];
    if (!a.enabled || !snd || !snd.src) return;
    this.s.host.playSound(snd.src, Math.max(0, Math.min(1, (snd.volume ?? 1) * a.volume)));
  }

  dispose(): void {
    for (const off of this.offs) off();
    this.offs.length = 0;
  }
}
