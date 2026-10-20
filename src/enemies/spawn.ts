import type { Session } from "../core/session.ts";
import { objectKey } from "../core/state.ts";
import { Enemy } from "./enemy.ts";
import type { EnemyConfig } from "./templates.ts";

export interface SpawnEnemyOptions {
  id?: string;
  group?: string;
  overrides?: Partial<EnemyConfig>;
  /** Existing PS Maker NPC game object to use as the enemy's visual. */
  adopt?: unknown;
}

/**
 * Creates an enemy from a template. Returns null (with a logged reason) when
 * the enemies feature is off, the template is unknown, the cap is reached or a
 * persistent enemy was already defeated.
 */
export function spawnEnemy(s: Session, template: string, x: number, y: number, opts: SpawnEnemyOptions = {}): Enemy | null {
  if (!s.feature("enemies")) {
    s.logger.warn(`Enemy "${template}" not spawned: the "enemies" feature is disabled.`);
    return null;
  }
  const cfg = s.toolkit.enemyTemplates.resolve(template, opts.overrides);
  if (!cfg) {
    s.logger.warn(`Unknown enemy template "${template}". Known: ${s.toolkit.enemyTemplates.names().join(", ")}`);
    return null;
  }
  let alive = 0;
  for (const e of s.world.list("enemy")) if (e.alive) alive++;
  if (alive >= s.config.enemies.maxActive) {
    s.logger.warn(`Enemy "${template}" not spawned: enemies.maxActive (${s.config.enemies.maxActive}) reached.`);
    return null;
  }
  resolvePatrol(s, cfg);
  const explicitId = !!opts.id;
  const id = opts.id || s.world.nextId(template);
  if (s.world.has(id)) {
    s.logger.warn(`Enemy id "${id}" already exists on this map; spawn skipped.`);
    return null;
  }
  const persistent = cfg.persistent && explicitId;
  if (persistent && s.state.objects[objectKey(s.mapId, id)] === "defeated") return null;
  const enemy = new Enemy(s, id, cfg, x, y, { group: opts.group, adopt: opts.adopt, persistent });
  s.world.add(enemy);
  s.logger.info(`Enemy "${id}" (${template}) spawned at ${Math.round(x)}, ${Math.round(y)}${opts.adopt ? " using an NPC sprite" : ""}.`);
  s.bus.emit("zelda:enemy:spawned", { enemyId: id, template, group: enemy.group });
  return enemy;
}

/** Patrol points given as marker ids (or {at}) become pixel positions; a path implies mode "path". */
function resolvePatrol(s: Session, cfg: EnemyConfig): void {
  const raw = cfg.patrol.points as unknown[];
  if (!Array.isArray(raw) || raw.length === 0) return;
  const pts = [];
  let hadMarker = false;
  for (const p of raw) {
    if (typeof p === "string" || (p && typeof p === "object" && "at" in p)) hadMarker = true;
    const pt = s.resolvePoint(p, `enemy ${cfg.template} patrol`);
    if (pt) pts.push(pt);
  }
  cfg.patrol.points = pts;
  if (hadMarker && pts.length > 0) cfg.patrol.mode = "path";
}

export function aliveInGroup(s: Session, group: string): number {
  let n = 0;
  for (const e of s.world.list("enemy")) if (e.alive && e.group === group) n++;
  return n;
}
