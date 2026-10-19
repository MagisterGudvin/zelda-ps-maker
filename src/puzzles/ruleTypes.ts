/**
 * Conditions and actions are plain JSON objects keyed by their type, e.g.
 *   { "switchOn": "plate_1" }            (condition)
 *   { "all": [ {...}, {...} ] }           (condition)
 *   { "openDoor": "door_1" }              (action)
 *   { "spawnEnemy": { "template": "slime", "x": 100, "y": 80 } }
 * A condition object with several keys requires all of them (implicit AND).
 * New types are registered on the RuleRegistry.
 */
export type Condition = Record<string, unknown>;
export type RuleAction = Record<string, unknown>;

export interface RuleSpec {
  id: string;
  when: Condition;
  then: RuleAction[];
  /** Runs when the condition becomes false again (non-once rules). */
  else?: RuleAction[];
  /** Fire only the first time (default true). */
  once?: boolean;
  /** Remember that a once-rule fired across map reloads and saves (default true). */
  persist?: boolean;
}
