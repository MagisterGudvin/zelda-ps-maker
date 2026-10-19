import type { Session } from "../core/session.ts";
import type { FlagValue } from "../core/events.ts";
import type { RuleContext } from "./ruleRegistry.ts";
import type { Condition, RuleAction, RuleSpec } from "./ruleTypes.ts";
import { Interactable } from "../interactions/interactable.ts";

interface RuleEntry {
  spec: RuleSpec;
  last: boolean;
  fired: boolean;
}

export interface SequenceSpec {
  id: string;
  switches: string[];
  resetOnWrong?: boolean;
  onSolved?: RuleAction[];
  /** Optional message when solved (key, text or {en,ru}). */
  message?: string;
}

interface SequenceEntry {
  spec: SequenceSpec;
  step: number;
  solved: boolean;
  resetting: boolean;
}

/** Hard cap so a rule that keeps changing state cannot spin forever within one tick. */
const MAX_PASSES = 8;

/**
 * Event-driven rule evaluation. Any toolkit event marks rules dirty; they are
 * evaluated once at the end of the tick (not every frame). Rules fire on the
 * rising edge of their condition; `once` rules are retired after firing.
 */
export class RulesEngine {
  readonly name = "rules";
  private readonly s: Session;
  private readonly rules = new Map<string, RuleEntry>();
  private readonly sequences = new Map<string, SequenceEntry>();
  private readonly spawnedGroups = new Map<string, number>();
  private dirty = true;
  private readonly ctx: RuleContext;
  private readonly offAny: () => void;
  private readonly offSpawn: () => void;
  private readonly offSwitch: () => void;

  constructor(session: Session) {
    this.s = session;
    this.ctx = {
      session,
      evaluate: (c) => this.evaluate(c),
      execute: (a) => this.execute(a, "nested"),
    };
    this.offAny = session.bus.onAny(() => {
      this.dirty = true;
    });
    this.offSpawn = session.bus.on("zelda:enemy:spawned", (e) => {
      if (e.group) this.spawnedGroups.set(e.group, (this.spawnedGroups.get(e.group) ?? 0) + 1);
    });
    this.offSwitch = session.bus.on("zelda:switch:activated", (e) => this.onSwitch(e.switchId, e.on));
  }

  spawnedInGroup(group: string): number {
    return this.spawnedGroups.get(group) ?? 0;
  }

  setFlag(name: string, value: FlagValue): void {
    this.s.toolkit.setFlag(name, value);
  }

  addRule(spec: RuleSpec): void {
    if (!spec || !spec.id) throw new Error('Rule needs an "id"');
    if (!spec.when || typeof spec.when !== "object") throw new Error(`Rule "${spec.id}" needs a "when" condition object`);
    if (!Array.isArray(spec.then)) throw new Error(`Rule "${spec.id}" needs a "then" array of actions`);
    const done = spec.once !== false && spec.persist !== false && !!this.s.state.flags[`rule:${spec.id}`];
    this.rules.set(spec.id, { spec, last: false, fired: done });
    this.dirty = true;
  }

  removeRule(id: string): boolean {
    return this.rules.delete(id);
  }

  hasRule(id: string): boolean {
    return this.rules.has(id);
  }

  ruleCount(): number {
    return this.rules.size;
  }

  /** Evaluates a condition object; unknown condition types are logged and false. */
  evaluate(condition: Condition): boolean {
    if (!condition || typeof condition !== "object") return false;
    const keys = Object.keys(condition);
    if (keys.length === 0) return true;
    for (const key of keys) {
      const handler = this.s.toolkit.ruleRegistry.condition(key);
      if (!handler) {
        this.s.logger.warnOnce(`cond-${key}`, `Unknown condition "${key}". Known: ${this.s.toolkit.ruleRegistry.conditionNames().join(", ")}`);
        return false;
      }
      try {
        if (!handler(condition[key], this.ctx)) return false;
      } catch (err) {
        this.s.logger.error(`Condition "${key}" threw:`, err);
        return false;
      }
    }
    return true;
  }

  /** Runs actions in order; a failing action is logged and the rest still run. */
  execute(actions: RuleAction[], source: string): void {
    if (!Array.isArray(actions)) return;
    for (const action of actions) {
      if (!action || typeof action !== "object") continue;
      for (const key of Object.keys(action)) {
        const handler = this.s.toolkit.ruleRegistry.action(key);
        if (!handler) {
          this.s.logger.warn(`${source}: unknown action "${key}". Known: ${this.s.toolkit.ruleRegistry.actionNames().join(", ")}`);
          continue;
        }
        try {
          handler(action[key], this.ctx);
        } catch (err) {
          this.s.logger.error(`${source}: action "${key}" threw:`, err);
        }
      }
    }
  }

  tick(_dtMs: number): void {
    let passes = 0;
    while (this.dirty && passes < MAX_PASSES) {
      this.dirty = false;
      passes++;
      this.evaluateAll();
    }
  }

  private evaluateAll(): void {
    for (const entry of this.rules.values()) {
      if (entry.fired) continue;
      const value = this.evaluate(entry.spec.when);
      if (value && !entry.last) {
        entry.last = true;
        if (entry.spec.once !== false) {
          entry.fired = true;
          if (entry.spec.persist !== false) this.s.toolkit.setFlag(`rule:${entry.spec.id}`, true);
        }
        this.s.bus.emit("zelda:rule:fired", { ruleId: entry.spec.id, branch: "then" });
        this.execute(entry.spec.then, `rule ${entry.spec.id}`);
      } else if (!value && entry.last) {
        entry.last = false;
        if (entry.spec.else && entry.spec.else.length > 0) {
          this.s.bus.emit("zelda:rule:fired", { ruleId: entry.spec.id, branch: "else" });
          this.execute(entry.spec.else, `rule ${entry.spec.id} (else)`);
        }
      }
    }
  }

  // ---- switch sequences --------------------------------------------------------------

  addSequence(spec: SequenceSpec): void {
    if (!spec.id || !Array.isArray(spec.switches) || spec.switches.length === 0) throw new Error("Sequence needs an id and a non-empty switches list");
    const solved = !!this.s.state.flags[`puzzle:${spec.id}`];
    this.sequences.set(spec.id, { spec, step: solved ? spec.switches.length : 0, solved, resetting: false });
  }

  private onSwitch(id: string, on: boolean): void {
    for (const seq of this.sequences.values()) {
      if (seq.solved || seq.resetting || !on) continue;
      const idx = seq.spec.switches.indexOf(id);
      if (idx < 0) continue;
      if (seq.spec.switches[seq.step] === id) {
        seq.step++;
        this.s.bus.emit("zelda:puzzle:progress", { puzzleId: seq.spec.id, step: seq.step, total: seq.spec.switches.length });
        if (seq.step >= seq.spec.switches.length) this.solve(seq);
      } else if (seq.spec.resetOnWrong !== false) {
        this.failSequence(seq);
      }
    }
  }

  private solve(seq: SequenceEntry): void {
    seq.solved = true;
    this.s.toolkit.setFlag(`puzzle:${seq.spec.id}`, true);
    this.s.bus.emit("zelda:puzzle:solved", { puzzleId: seq.spec.id });
    const msg = seq.spec.message ?? "msg.puzzle_solved";
    this.s.bus.emit("zelda:message", { text: this.s.i18n.text(msg), durationMs: this.s.config.ui.messageMs });
    if (seq.spec.onSolved) this.execute(seq.spec.onSolved, `sequence ${seq.spec.id}`);
  }

  private failSequence(seq: SequenceEntry): void {
    seq.step = 0;
    seq.resetting = true;
    for (const id of seq.spec.switches) {
      const o = this.s.world.get(id);
      if (o instanceof Interactable && o.objState === "on") o.setState("off");
    }
    seq.resetting = false;
    this.s.bus.emit("zelda:puzzle:failed", { puzzleId: seq.spec.id });
    this.s.bus.emit("zelda:message", { text: this.s.i18n.t("msg.puzzle_failed"), durationMs: 1500 });
  }

  dispose(): void {
    this.offAny();
    this.offSpawn();
    this.offSwitch();
    this.rules.clear();
    this.sequences.clear();
    this.spawnedGroups.clear();
  }
}
