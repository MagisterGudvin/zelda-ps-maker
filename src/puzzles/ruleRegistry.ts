import type { Session } from "../core/session.ts";
import type { Condition, RuleAction } from "./ruleTypes.ts";
import { registerBuiltinRules } from "./builtinRules.ts";

export interface RuleContext {
  session: Session;
  evaluate(condition: Condition): boolean;
  execute(actions: RuleAction[]): void;
}

export type ConditionHandler = (arg: unknown, ctx: RuleContext) => boolean;
export type ActionHandler = (arg: unknown, ctx: RuleContext) => void;

/**
 * Extensible vocabulary of conditions and actions. Lives on the Toolkit (not
 * the session) so extension plugins can register types before any map loads.
 */
export class RuleRegistry {
  private readonly conditions = new Map<string, ConditionHandler>();
  private readonly actions = new Map<string, ActionHandler>();

  constructor() {
    registerBuiltinRules(this);
  }

  registerCondition(name: string, handler: ConditionHandler): void {
    this.conditions.set(name, handler);
  }

  registerAction(name: string, handler: ActionHandler): void {
    this.actions.set(name, handler);
  }

  condition(name: string): ConditionHandler | undefined {
    return this.conditions.get(name);
  }

  action(name: string): ActionHandler | undefined {
    return this.actions.get(name);
  }

  conditionNames(): string[] {
    return [...this.conditions.keys()];
  }

  actionNames(): string[] {
    return [...this.actions.keys()];
  }
}
