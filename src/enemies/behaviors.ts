import type { Session } from "../core/session.ts";
import { FACING_VECTORS, normalize, type Vec2 } from "../core/math.ts";
import type { Enemy } from "./enemy.ts";
import type { BehaviorId } from "./templates.ts";
import { spawnEnemy } from "./spawn.ts";

/**
 * Behavior = perception/decisions (`think`, staggered) + motion (`act`, every
 * tick). Shared states (hurt, stunned, dead) are handled by `Enemy` itself, so
 * a dead enemy never reaches a behavior and can never attack again.
 */
export interface Behavior {
  think(e: Enemy, s: Session): void;
  act(e: Enemy, s: Session, dtMs: number): void;
}

const RECOVER_MS = 350;
const tmp: Vec2 = { x: 0, y: 0 };

function speedMul(e: Enemy): number {
  return e.phase >= 0 ? (e.cfg.phases[e.phase]?.speedMultiplier ?? 1) : 1;
}

function cooldownMul(e: Enemy): number {
  return e.phase >= 0 ? (e.cfg.phases[e.phase]?.cooldownMultiplier ?? 1) : 1;
}

/** Idle/patrol perception shared by all chasing behaviors. */
function detect(e: Enemy, s: Session): void {
  if ((e.state === "idle" || e.state === "patrol") && e.canSeePlayer(s, e.cfg.detectRange)) {
    e.faceToward(s.player.box.x, s.player.box.y);
    e.setState("alert");
  }
}

function loseTrack(e: Enemy, s: Session): boolean {
  const player = s.player;
  if (!player.present || player.isDead || e.distanceToPlayer(s) > e.cfg.loseRange) {
    e.setState(e.cfg.behavior === "patroller" ? "patrol" : "idle");
    return true;
  }
  return false;
}

/** Random walk around the spawn point (or along explicit path points). */
function wander(e: Enemy, s: Session, dtMs: number): void {
  const patrol = e.cfg.patrol;
  if (patrol.mode === "path" && patrol.points.length > 0) {
    const target = patrol.points[e.patrolIndex % patrol.points.length];
    if (e.stateMs < patrol.pauseMs && e.hasWanderTarget === false) return;
    e.hasWanderTarget = true;
    const blocked = e.moveToward(s, target.x, target.y, e.cfg.speed * speedMul(e), dtMs);
    if (blocked || (Math.abs(target.x - e.x) < 2 && Math.abs(target.y - e.y) < 2)) {
      e.patrolIndex = (e.patrolIndex + 1) % patrol.points.length;
      e.hasWanderTarget = false;
      e.stateMs = 0;
    }
    return;
  }
  if (!e.hasWanderTarget) {
    if (e.stateMs < patrol.pauseMs) return;
    const a = s.rng.next() * Math.PI * 2;
    const r = s.rng.range(0.3, 1) * patrol.radius;
    e.wanderTarget.x = e.homeX + Math.cos(a) * r;
    e.wanderTarget.y = e.homeY + Math.sin(a) * r;
    e.hasWanderTarget = true;
  }
  const blocked = e.moveToward(s, e.wanderTarget.x, e.wanderTarget.y, e.cfg.speed * speedMul(e), dtMs);
  if (blocked || (Math.abs(e.wanderTarget.x - e.x) < 2 && Math.abs(e.wanderTarget.y - e.y) < 2)) {
    e.hasWanderTarget = false;
    e.stateMs = 0;
  }
}

function startLunge(e: Enemy, s: Session): void {
  normalize(tmp, s.player.box.x - e.x, s.player.box.y - e.y);
  e.vx = tmp.x * e.cfg.lungeSpeed;
  e.vy = tmp.y * e.cfg.lungeSpeed;
  e.setState("attack");
}

function finishAttack(e: Enemy): void {
  e.vx = 0;
  e.vy = 0;
  e.attackCooldownMs = e.cfg.attackCooldownMs * cooldownMul(e);
  e.setState("recover");
}

/** Common act() part for alert/windup/attack/recover timing. */
function actCommon(e: Enemy, s: Session, dtMs: number, onWindupDone: () => void): boolean {
  switch (e.state) {
    case "alert":
      if (e.stateMs >= s.config.enemies.alertMs) e.setState("chase");
      return true;
    case "windup":
      e.faceToward(s.player.box.x, s.player.box.y);
      if (e.stateMs >= e.cfg.windupMs) onWindupDone();
      return true;
    case "attack": {
      const blocked = e.integrateVelocity(dtMs, 1);
      if (blocked || e.stateMs >= e.cfg.attackMs) finishAttack(e);
      return true;
    }
    case "recover":
      // Moves only after a bump (recoilFrom sets the velocity; a finished lunge leaves it 0).
      if (e.vx !== 0 || e.vy !== 0) e.integrateVelocity(dtMs, 0.8);
      if (e.stateMs >= RECOVER_MS) e.setState("chase");
      return true;
    default:
      return false;
  }
}

const melee: Behavior = {
  think(e, s) {
    detect(e, s);
    if (e.state !== "chase") return;
    if (loseTrack(e, s)) return;
    if (e.attackCooldownMs <= 0 && e.distanceToPlayer(s) <= e.cfg.attackRange) e.setState("windup");
  },
  act(e, s, dtMs) {
    if (actCommon(e, s, dtMs, () => startLunge(e, s))) return;
    if (e.state === "idle" || e.state === "patrol") wander(e, s, dtMs);
    else if (e.state === "chase") e.moveToward(s, s.player.box.x, s.player.box.y, e.cfg.chaseSpeed * speedMul(e), dtMs);
  },
};

const shooter: Behavior = {
  think(e, s) {
    detect(e, s);
    if (e.state !== "chase") return;
    if (loseTrack(e, s)) return;
    if (e.attackCooldownMs <= 0 && e.canSeePlayer(s, e.cfg.attackRange)) e.setState("windup");
  },
  act(e, s, dtMs) {
    if (
      actCommon(e, s, dtMs, () => {
        // Cardinal shots (as classic top-down shooters do) when roughly aligned, aimed otherwise.
        const p = s.player.box;
        e.faceToward(p.x, p.y);
        const v = FACING_VECTORS[e.facing];
        const aligned = Math.abs(v.x !== 0 ? p.y - e.y : p.x - e.x) < 12;
        if (e.cfg.projectile.count > 1) e.fireBurst(s, e.cfg.projectile.count);
        else if (aligned) e.fireAt(s, e.x + v.x * 100, e.y + v.y * 100);
        else e.fireAt(s, p.x, p.y);
        finishAttack(e);
      })
    )
      return;
    if (e.state === "idle" || e.state === "patrol") {
      wander(e, s, dtMs);
      return;
    }
    if (e.state !== "chase") return;
    const d = e.distanceToPlayer(s);
    const pref = e.cfg.preferredDistance;
    const p = s.player.box;
    if (d < pref - 12) e.moveToward(s, e.x - (p.x - e.x), e.y - (p.y - e.y), e.cfg.speed, dtMs);
    else if (d > pref + 12) e.moveToward(s, p.x, p.y, e.cfg.chaseSpeed, dtMs);
    else e.faceToward(p.x, p.y);
  },
};

const guardian: Behavior = {
  think(e, s) {
    melee.think(e, s);
  },
  act(e, s, dtMs) {
    const g = e.cfg.guard;
    e.guardMs += dtMs;
    const engaged = e.state === "chase" || e.state === "recover";
    if (engaged) {
      if (e.guardUp && e.guardMs >= g.upMs) {
        e.guardUp = false;
        e.guardMs = 0;
      } else if (!e.guardUp && e.guardMs >= g.downMs) {
        e.guardUp = true;
        e.guardMs = 0;
      }
    } else if (e.state !== "windup") {
      e.guardUp = false;
    }
    if (e.state === "windup" || e.state === "attack") e.guardUp = false;
    if (e.guardUp && e.state === "chase") {
      // Advance slowly behind the shield, always facing the player.
      e.moveToward(s, s.player.box.x, s.player.box.y, e.cfg.speed * 0.5, dtMs);
      e.faceToward(s.player.box.x, s.player.box.y);
      return;
    }
    melee.act(e, s, dtMs);
  },
};

const patroller: Behavior = {
  think(e, s) {
    if (e.cfg.patrol.chase) melee.think(e, s);
  },
  act(e, s, dtMs) {
    if (e.state === "patrol" || e.state === "idle") {
      wander(e, s, dtMs);
      return;
    }
    melee.act(e, s, dtMs);
  },
};

function updatePhase(e: Enemy, s: Session): void {
  const frac = e.hp / e.maxHp;
  let phase = -1;
  for (let i = 0; i < e.cfg.phases.length; i++) if (frac < e.cfg.phases[i].hpBelow) phase = i;
  if (phase !== e.phase) {
    e.phase = phase;
    s.bus.emit("zelda:enemy:phaseChanged", { enemyId: e.id, phase: phase + 1 });
  }
}

const miniboss: Behavior = {
  think(e, s) {
    updatePhase(e, s);
    melee.think(e, s);
    // Bosses engage at a distance: start attacks from further away in burst phases.
    if (e.state === "chase" && e.attackCooldownMs <= 0 && e.phase >= 0 && e.distanceToPlayer(s) <= e.cfg.detectRange) e.setState("windup");
  },
  act(e, s, dtMs) {
    const done = actCommon(e, s, dtMs, () => {
      const phase = e.phase >= 0 ? e.cfg.phases[e.phase] : null;
      e.attackCounter++;
      if (phase && phase.pattern === "summon" && phase.summonTemplate) {
        for (const id of e.summoned) if (!s.world.has(id)) e.summoned.delete(id);
        if (e.summoned.size < phase.summonMax && e.attackCounter % 2 === 0) {
          const a = s.rng.next() * Math.PI * 2;
          const minion = spawnEnemy(s, phase.summonTemplate, e.x + Math.cos(a) * 30, e.y + Math.sin(a) * 30, { group: e.group ? `${e.group}:minions` : "" });
          if (minion) e.summoned.add(minion.id);
          finishAttack(e);
          return;
        }
      }
      if (phase && (phase.pattern === "burst" || phase.pattern === "summon") && e.attackCounter % 2 === 1) {
        e.fireBurst(s, phase.burstCount);
        finishAttack(e);
        return;
      }
      startLunge(e, s);
    });
    if (done) return;
    if (e.state === "idle" || e.state === "patrol") wander(e, s, dtMs);
    else if (e.state === "chase") e.moveToward(s, s.player.box.x, s.player.box.y, e.cfg.chaseSpeed * speedMul(e), dtMs);
  },
};

export const BEHAVIORS: Record<BehaviorId, Behavior> = { melee, shooter, guardian, patroller, miniboss };
