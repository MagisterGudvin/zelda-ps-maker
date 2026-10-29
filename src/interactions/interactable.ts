import { Entity } from "../core/entity.ts";
import { type Facing, FACING_VECTORS, makeBox } from "../core/math.ts";
import type { Session } from "../core/session.ts";
import { getDungeon, objectKey } from "../core/state.ts";
import type { Damageable, DamageInfo, HitResult } from "../core/types.ts";
import { spawnDrop } from "../items/pickup.ts";
import { spawnEffect } from "../items/effect.ts";
import type { ObjectConfig } from "./objectTypes.ts";

/** Generic state names; each type uses a subset. */
export type ObjectState = "idle" | "destroyed" | "on" | "off" | "opened" | "closed" | "locked" | "unlocked" | "lit" | "revealed" | "hidden" | "carried";

const BUTTON_COOLDOWN_MS = 300;
const MOVE_MS = 250;

/**
 * Interactive map object driven entirely by `ObjectConfig`. One class covers
 * every preset type so new combinations (a torch that is also breakable, a
 * button that only reacts to arrows) need configuration, not code.
 */
export class Interactable extends Entity implements Damageable {
  readonly cfg: ObjectConfig;
  objState: ObjectState;
  visible: boolean;
  durability: number;
  pushes = 0;
  /** Block movement animation. */
  moving = false;
  /** Pressure plate: currently held down. */
  pressed = false;
  readonly persistentKey: string | null;

  private readonly session: Session;
  private readonly initial: { x: number; y: number };
  private cooldownMs = 0;
  private moveFromX = 0;
  private moveFromY = 0;
  private moveToX = 0;
  private moveToY = 0;
  private moveMs = 0;
  private readonly probe = makeBox();

  constructor(session: Session, id: string, cfg: ObjectConfig, x: number, y: number, explicitId: boolean) {
    super(id, "object", x, y, cfg.width, cfg.height);
    this.session = session;
    this.cfg = cfg;
    this.initial = { x, y };
    this.durability = Math.max(1, cfg.durability);
    this.visible = !cfg.hidden;
    this.solid = cfg.solid && this.visible;
    this.objState = this.initialState();
    if (this.objState === "opened") this.solid = false;
    this.persistentKey = cfg.persistent && explicitId ? objectKey(session.mapId, id) : null;
    this.view = session.host.renderer.createView({ sprite: cfg.sprite, width: cfg.width, height: cfg.height, tint: cfg.tint ?? undefined, layer: cfg.solid ? 0 : -1000, offsetX: cfg.spriteOffsetX || undefined, offsetY: cfg.spriteOffsetY || undefined, scale: cfg.spriteScale || undefined });
    this.restoreFromState();
    this.applyVisual();
  }

  get type() {
    return this.cfg.type;
  }

  private initialState(): ObjectState {
    switch (this.cfg.type) {
      case "lever":
      case "button":
      case "pressure_plate":
        return "off";
      case "chest":
        return "closed";
      case "door":
        if (this.cfg.startOpen) return "opened";
        return this.cfg.lock === "small_key" || this.cfg.lock === "big_key" ? "locked" : "closed";
      case "hidden_passage":
        return "hidden";
      default:
        return this.cfg.hidden ? "hidden" : "idle";
    }
  }

  /** Re-applies persisted progress (opened chests, unlocked doors, moved blocks). */
  restoreFromState(): void {
    if (!this.persistentKey) return;
    const saved = this.session.state.objects[this.persistentKey];
    if (!saved) return;
    if (saved.startsWith("moved:")) {
      const [sx, sy] = saved.slice(6).split(",").map(Number);
      if (Number.isFinite(sx) && Number.isFinite(sy)) {
        this.x = sx;
        this.y = sy;
        this.pushes = this.cfg.pushLimit > 0 ? this.cfg.pushLimit : 0;
      }
      return;
    }
    this.setState(saved as ObjectState, { silent: true, persist: false });
  }

  /** True when this object is currently "active" (on/open/lit/destroyed...). */
  get isActive(): boolean {
    const s = this.objState;
    return s === "on" || s === "opened" || s === "unlocked" || s === "lit" || s === "destroyed" || s === "revealed";
  }

  isHittable(): boolean {
    return this.visible && this.objState !== "destroyed" && this.objState !== "carried" && !this.removed;
  }

  // ---- damage / tools -------------------------------------------------------------

  receiveHit(info: DamageInfo): HitResult {
    if (!this.isHittable()) return "ignored";
    if (!this.cfg.tools.includes(info.type)) return this.solid ? "immune" : "ignored";
    const s = this.session;
    s.bus.emit("zelda:object:damaged", { objectId: this.id, objectType: this.cfg.type, tool: info.type });
    switch (this.cfg.type) {
      case "button":
        if (this.cooldownMs > 0) return "immune";
        this.cooldownMs = BUTTON_COOLDOWN_MS;
        this.toggleOrActivate();
        return "damaged";
      case "torch":
      case "reactive":
        if (this.objState === "lit" || this.objState === "on") return "immune";
        if (--this.durability > 0) return "damaged";
        this.setState(this.cfg.type === "torch" ? "lit" : "on");
        return "damaged";
      case "hidden_passage":
        this.reveal();
        return "damaged";
      default:
        if (--this.durability > 0) return "damaged";
        this.destroy();
        return "killed";
    }
  }

  // ---- state machine ----------------------------------------------------------------

  setState(state: ObjectState, opts: { silent?: boolean; persist?: boolean } = {}): void {
    const prev = this.objState;
    this.objState = state;
    switch (state) {
      case "destroyed":
        this.solid = false;
        if (this.cfg.type !== "bombable_wall" && this.cfg.type !== "breakable" && !this.cfg.keepWhenDestroyed) this.visible = false;
        break;
      case "opened":
      case "unlocked":
        if (this.cfg.type === "door") this.solid = false;
        break;
      case "closed":
      case "locked":
        if (this.cfg.type === "door") this.solid = this.cfg.solid;
        break;
      case "revealed":
        this.visible = true;
        this.solid = this.cfg.type === "hidden_passage" ? false : this.cfg.solid;
        break;
      case "hidden":
        this.visible = false;
        this.solid = false;
        break;
      default:
        break;
    }
    if (opts.persist !== false && this.persistentKey) {
      if (this.isActive || state === "off" || state === "closed") this.session.state.objects[this.persistentKey] = state;
    }
    this.applyVisual();
    if (opts.silent || prev === state) return;
    const s = this.session;
    s.bus.emit("zelda:object:stateChanged", { objectId: this.id, objectType: this.cfg.type, state });
    if (this.cfg.type === "lever" || this.cfg.type === "button" || this.cfg.type === "pressure_plate") {
      s.bus.emit("zelda:switch:activated", { switchId: this.id, on: state === "on" });
    }
    if (this.isActive) this.runResults(true);
    else if (state === "off" || state === "closed") this.runResults(false);
  }

  private runResults(activated: boolean): void {
    const s = this.session;
    const cfg = this.cfg;
    if (activated) {
      if (cfg.setFlag) this.writeFlag(cfg.setFlag, true);
      if (cfg.emit) s.bus.emit(`zelda:custom:${cfg.emit}`, { objectId: this.id });
      if (cfg.message) s.bus.emit("zelda:message", { text: s.i18n.text(cfg.message), durationMs: s.config.ui.messageMs, kind: "sign" });
    } else if (cfg.setFlag && cfg.toggle) {
      this.writeFlag(cfg.setFlag, false);
    }
    const actions = activated ? cfg.onActivate : cfg.onDeactivate;
    if (actions.length > 0) {
      if (s.rules) s.rules.execute(actions, `object ${this.id}`);
      else s.logger.warnOnce(`obj-actions-${this.id}`, `Object "${this.id}" has actions but the "puzzles" feature is disabled.`);
    }
  }

  private writeFlag(flag: string, value: boolean): void {
    this.session.toolkit.setFlag(flag, value);
  }

  private toggleOrActivate(): void {
    if (this.cfg.toggle) this.setState(this.objState === "on" ? "off" : "on");
    else if (this.objState !== "on") this.setState("on");
  }

  destroy(): void {
    if (this.objState === "destroyed") return;
    const s = this.session;
    spawnEffect(s, "poof", this.x, this.y, 250, 1.3);
    const table = this.cfg.drops === "default" ? s.config.interactions.defaultDrops : this.cfg.drops;
    spawnDrop(s, this.x, this.y, table);
    this.setState("destroyed");
    s.bus.emit("zelda:object:destroyed", { objectId: this.id, objectType: this.cfg.type });
  }

  reveal(): void {
    if (this.visible && this.objState !== "hidden") return;
    this.setState("revealed");
  }

  hide(): void {
    this.setState("hidden");
  }

  // ---- action key -------------------------------------------------------------------

  /** Requirement check; shows the right message and returns false when unmet. */
  checkRequirements(): boolean {
    const s = this.session;
    const req = this.cfg.requires;
    if (req.item && !s.toolkit.inventory.has(req.item)) {
      s.bus.emit("zelda:message", { text: s.i18n.t("msg.need_item", { item: s.toolkit.inventory.displayName(req.item) }), durationMs: 1500, kind: "hint" });
      return false;
    }
    if (req.flag && !s.state.flags[req.flag]) {
      if (this.cfg.message) s.bus.emit("zelda:message", { text: s.i18n.text(this.cfg.message), durationMs: 1500, kind: "hint" });
      return false;
    }
    if (req.bigKey && !getDungeon(s.state, s.state.currentDungeon).bigKey) {
      s.bus.emit("zelda:message", { text: s.i18n.t("msg.need_big_key"), durationMs: 1500, kind: "hint" });
      return false;
    }
    return true;
  }

  /** Handles the action key; returns true if the press was consumed. */
  interact(playerFacing: Facing, playerY: number): boolean {
    const s = this.session;
    switch (this.cfg.type) {
      case "chest": {
        if (this.objState !== "closed") return false;
        if (s.config.interactions.chestOpenFrom === "below" && (playerFacing !== "up" || playerY < this.y)) return false;
        if (!this.checkRequirements()) return true;
        this.open();
        return true;
      }
      case "door":
        if (this.objState === "opened" || this.objState === "unlocked") return false;
        this.tryUnlock(true);
        return true;
      case "lever":
        if (!this.checkRequirements()) return true;
        this.toggleOrActivate();
        return true;
      case "sign":
        if (this.cfg.message) s.bus.emit("zelda:message", { text: s.i18n.text(this.cfg.message), durationMs: s.config.ui.messageMs, kind: "sign" });
        return true;
      case "reactive":
        if (!this.cfg.actionable) return false;
        if (!this.checkRequirements()) return true;
        this.toggleOrActivate();
        return true;
      default:
        return false;
    }
  }

  open(): void {
    if (this.cfg.type === "chest") {
      if (this.objState !== "closed") return;
      const s = this.session;
      const c = this.cfg.contents;
      this.setState("opened");
      s.bus.emit("zelda:chest:opened", { chestId: this.id, itemId: c?.item ?? null, count: c?.count ?? 0 });
      if (c && c.item) s.toolkit.inventory.give(c.item, c.count ?? 1);
      else s.bus.emit("zelda:message", { text: s.i18n.t("msg.chest_empty"), durationMs: 1500, kind: "hint" });
      return;
    }
    if (this.cfg.type === "door") {
      if (this.objState === "opened" || this.objState === "unlocked") return;
      this.setState("opened");
      this.session.bus.emit("zelda:door:opened", { doorId: this.id });
    }
  }

  close(): void {
    if (this.cfg.type !== "door" || (this.objState !== "opened" && this.objState !== "unlocked")) return;
    // Don't trap the player inside a closing door: wait until they step out.
    this.setState(this.cfg.lock === "small_key" || this.cfg.lock === "big_key" ? "locked" : "closed");
    this.session.bus.emit("zelda:door:closed", { doorId: this.id });
  }

  /** Door lock logic for both action and touch. Returns true if it opened. */
  tryUnlock(showMessages: boolean): boolean {
    const s = this.session;
    if (this.cfg.type !== "door" || (this.objState !== "locked" && this.objState !== "closed")) return false;
    const lock = this.cfg.lock;
    if (lock === "switch") return false;
    if (!this.checkRequirements()) return false;
    if (lock === "small_key") {
      if (!s.toolkit.inventory.spend("key", 1)) {
        if (showMessages) s.bus.emit("zelda:message", { text: s.i18n.t("msg.need_key"), durationMs: 1500, kind: "hint" });
        return false;
      }
    } else if (lock === "big_key" && !getDungeon(s.state, s.state.currentDungeon).bigKey) {
      if (showMessages) s.bus.emit("zelda:message", { text: s.i18n.t("msg.need_big_key"), durationMs: 1500, kind: "hint" });
      return false;
    }
    this.setState("unlocked");
    s.bus.emit("zelda:door:unlocked", { doorId: this.id, lock });
    s.bus.emit("zelda:door:opened", { doorId: this.id });
    return true;
  }

  // ---- pressure plates & blocks --------------------------------------------------------

  setPressed(pressed: boolean): void {
    if (this.pressed === pressed) return;
    this.pressed = pressed;
    if (pressed && this.objState !== "on") this.setState("on");
    else if (!pressed && this.cfg.plateMode === "hold" && this.objState === "on") this.setState("off");
  }

  canPush(dir: Facing): boolean {
    if (this.cfg.type !== "block" || this.moving) return false;
    if (this.cfg.pushLimit > 0 && this.pushes >= this.cfg.pushLimit) return false;
    if (!this.cfg.pushDirections.includes(dir)) return false;
    return true;
  }

  /** Starts sliding one step; returns false if the destination is blocked. */
  tryPush(dir: Facing): boolean {
    if (!this.canPush(dir)) return false;
    const s = this.session;
    const dist = this.cfg.pushDistance > 0 ? this.cfg.pushDistance : s.config.world.tileSize;
    const v = FACING_VECTORS[dir];
    const p = this.probe;
    p.x = this.x + v.x * dist;
    p.y = this.y + v.y * dist;
    p.hw = this.hw - 0.5;
    p.hh = this.hh - 0.5;
    if (s.world.isBlocked(p, this, true)) return false;
    // Do not slide onto enemies or other objects that occupy the tile.
    const found: Entity[] = [];
    s.world.query(p, found, (e) => e !== this && (e.kind === "enemy" || (e.kind === "object" && (e as Interactable).cfg.type === "block")) && e.alive);
    if (found.length > 0) return false;
    this.moving = true;
    this.moveMs = 0;
    this.moveFromX = this.x;
    this.moveFromY = this.y;
    this.moveToX = p.x;
    this.moveToY = p.y;
    return true;
  }

  tick(dtMs: number, s: Session): void {
    if (this.cooldownMs > 0) this.cooldownMs -= dtMs;
    if (!this.moving) return;
    this.moveMs += dtMs;
    const t = Math.min(1, this.moveMs / MOVE_MS);
    this.x = this.moveFromX + (this.moveToX - this.moveFromX) * t;
    this.y = this.moveFromY + (this.moveToY - this.moveFromY) * t;
    s.world.touch(this);
    if (t >= 1) {
      this.moving = false;
      this.pushes++;
      if (this.persistentKey) s.state.objects[this.persistentKey] = `moved:${this.x},${this.y}`;
      s.bus.emit("zelda:block:moved", { objectId: this.id, x: this.x, y: this.y });
    }
  }

  // ---- reset ---------------------------------------------------------------------------

  /** Restores the initial configuration and forgets persisted progress. */
  reset(): void {
    if (this.persistentKey) delete this.session.state.objects[this.persistentKey];
    this.restoreInitial();
    this.session.bus.emit("zelda:object:stateChanged", { objectId: this.id, objectType: this.cfg.type, state: this.objState });
  }

  /** Re-reads persisted progress after a save was loaded. */
  syncWithState(): void {
    if (!this.persistentKey) return;
    this.restoreInitial();
    this.restoreFromState();
    this.applyVisual();
  }

  private restoreInitial(): void {
    this.x = this.initial.x;
    this.y = this.initial.y;
    this.moving = false;
    this.pushes = 0;
    this.pressed = false;
    this.durability = Math.max(1, this.cfg.durability);
    this.visible = !this.cfg.hidden;
    this.solid = this.cfg.solid && this.visible;
    this.objState = this.initialState();
    if (this.objState === "opened") this.solid = false;
    this.session.world.touch(this);
    this.applyVisual();
  }

  applyVisual(): void {
    const v = this.view;
    if (!v) return;
    v.setVisible(this.visible);
    const useActive = this.isActive && this.cfg.type !== "hidden_passage";
    v.setSprite(useActive ? this.cfg.activeSprite : this.cfg.sprite);
    v.setAlpha(1);
  }
}
