/**
 * The toolkit is set up once for the whole project, not on every map:
 * - its settings come from the project's actions wherever they are: the first Start Toolkit, Set
 *   Player Sprites, Set Item Sprites and Set Controls in map order, and every Set Sound, Define
 *   Item and Define Enemy. They run when the toolkit first starts on any map of the game (a map's
 *   own copy of a "first" action wins on its map, and runs itself in its Map start);
 * - it runs on every map of a project that has a Start Toolkit (saveRestore.ts watches the game),
 *   except where "Zelda: Stop Toolkit" turned it off.
 */

interface ActionLike {
  id?: string;
  type?: string;
  actionName?: string;
  pluginParams?: Record<string, unknown>;
}
interface MapLike {
  id?: string;
  setupActions?: ActionLike[];
  initialActions?: ActionLike[];
  enterActions?: ActionLike[];
}
export interface ProjectLike {
  maps?: MapLike[];
}

/** One per project: the first one in map order counts. */
const FIRST_ONLY = ["Zelda: Start Toolkit", "Zelda: Set Player Sprites", "Zelda: Set Item Sprites", "Zelda: Set Controls"];
/** Each one counts (each sets its own moment, item or enemy type). */
const EVERY = ["Zelda: Set Sound", "Zelda: Define Item", "Zelda: Define Enemy"];

const mapActions = (m: MapLike): ActionLike[] => [m.setupActions, m.initialActions, m.enterActions].flatMap((l) => (Array.isArray(l) ? l : [])).filter((a) => typeof a?.actionName === "string");

/** The project's Start Toolkit (the first by map order), or null: then the toolkit starts only where an action of it runs. */
export function projectStartAction(story: ProjectLike | null | undefined): ActionLike | null {
  for (const m of story?.maps ?? []) for (const a of mapActions(m)) if (a.actionName === "Zelda: Start Toolkit") return a;
  return null;
}

/**
 * The project's settings actions to run for the toolkit's first start on map `hereId`: Start
 * Toolkit first, then the others in map order. The map's own actions are left out (they run in its
 * Map start), and a "first" action the map has of its own is not taken from another map.
 */
export function projectSettingsActions(story: ProjectLike | null | undefined, hereId: string): { actionName: string; pluginParams: Record<string, unknown> }[] {
  const maps = story?.maps ?? [];
  const here = maps.find((m) => m.id === hereId);
  const own = new Set(here ? mapActions(here).map((a) => a.actionName!) : []);
  const firsts = new Map<string, ActionLike>();
  const every: ActionLike[] = [];
  for (const m of maps) {
    if (m === here) continue;
    for (const a of mapActions(m)) {
      const name = a.actionName!;
      if (FIRST_ONLY.includes(name) && !own.has(name) && !firsts.has(name)) firsts.set(name, a);
      if (EVERY.includes(name)) every.push(a);
    }
  }
  return [...FIRST_ONLY.flatMap((n) => (firsts.has(n) ? [firsts.get(n)!] : [])), ...every].map((a) => ({ actionName: a.actionName!, pluginParams: a.pluginParams ?? {} }));
}

const off = new WeakSet<object>();

/** "Zelda: Stop Toolkit" on a map: the toolkit does not start there by itself (a Start Toolkit there starts it again). */
export function setToolkitOff(scene: unknown, isOff: boolean): void {
  if (!scene || typeof scene !== "object") return;
  if (isOff) off.add(scene);
  else off.delete(scene);
}

export function isToolkitOff(scene: unknown): boolean {
  return !!scene && typeof scene === "object" && off.has(scene);
}
