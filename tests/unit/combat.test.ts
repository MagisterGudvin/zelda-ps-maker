import { test } from "node:test";
import assert from "node:assert/strict";
import { createRig, errors } from "../helpers/fakeHost.ts";
import { spawnEnemy } from "../../src/enemies/spawn.ts";
import type { Enemy } from "../../src/enemies/enemy.ts";
import { Projectile } from "../../src/items/projectile.ts";

/** Enemy that stands still (huge cooldowns, no detection) so hits are easy to count. */
const DUMMY = { hp: 20, speed: 0, chaseSpeed: 0, detectRange: 0, contactDamage: false, knockbackResist: 1 };

/** PS Maker moves the player; the toolkit derives facing from the movement delta. */
function faceRight(rig: ReturnType<typeof createRig>): void {
  rig.step();
  rig.host.walk(1, 0);
  rig.step();
  assert.equal(rig.session.player.facing, "right");
}

test("one sword swing damages a target at most once even if it overlaps for many frames", () => {
  const rig = createRig();
  faceRight(rig);
  const enemy = spawnEnemy(rig.session, "slime", rig.host.player!.x + 18, rig.host.player!.y, { overrides: DUMMY }) as Enemy;
  let damageEvents = 0;
  rig.tk.bus.on("zelda:enemy:damaged", () => damageEvents++);
  rig.host.input.tap("sword");
  // Run through the whole swing (windup 50 + active 130 + recovery 120 ms) and beyond.
  rig.run(600);
  assert.equal(damageEvents, 1, "exactly one damage event per swing");
  assert.equal(enemy.hp, 20 - rig.tk.config.sword.damage);
  assert.equal(errors(rig).length, 0);
});

test("a second swing after recovery hits again; presses during the swing are ignored", () => {
  const rig = createRig({ combat: { enemyHitCooldownMs: 0 } });
  faceRight(rig);
  const enemy = spawnEnemy(rig.session, "slime", rig.host.player!.x + 18, rig.host.player!.y, { overrides: DUMMY }) as Enemy;
  rig.host.input.tap("sword");
  rig.step(3);
  rig.host.input.tap("sword"); // during the swing: must not start a new attack
  rig.run(400);
  assert.equal(enemy.hp, 18);
  rig.host.input.tap("sword");
  rig.run(400);
  assert.equal(enemy.hp, 16);
});

test("hitbox is only active during the active phase", () => {
  const rig = createRig();
  faceRight(rig);
  const sword = rig.session.sword!;
  rig.host.input.tap("sword");
  rig.step(1);
  assert.equal(sword.phase, "windup");
  assert.equal(sword.hitboxActive, false);
  rig.run(60);
  assert.equal(sword.phase, "active");
  assert.equal(sword.hitboxActive, true);
  rig.run(200);
  assert.notEqual(sword.phase, "active");
  assert.equal(sword.hitboxActive, false);
});

test("hit enemies are knocked back away from the player", () => {
  const rig = createRig();
  faceRight(rig);
  const x0 = rig.host.player!.x + 18;
  const enemy = spawnEnemy(rig.session, "slime", x0, rig.host.player!.y, { overrides: { ...DUMMY, knockbackResist: 0 } }) as Enemy;
  rig.host.input.tap("sword");
  rig.run(400);
  assert.ok(enemy.x > x0 + 4, `enemy moved right (x=${enemy.x})`);
});

test("holding the sword charges a spin attack with multiplied damage", () => {
  const rig = createRig({ sword: { charge: { pokeWhileCharging: false } } });
  faceRight(rig);
  const enemy = spawnEnemy(rig.session, "slime", rig.host.player!.x - 20, rig.host.player!.y, { overrides: DUMMY }) as Enemy;
  let charged = 0;
  let spins = 0;
  rig.tk.bus.on("zelda:player:charged", () => charged++);
  rig.tk.bus.on("zelda:player:attack", (e) => {
    if (e.kind === "spin") spins++;
  });
  rig.host.input.press("sword");
  rig.run(300 + 900);
  assert.equal(charged, 1);
  assert.equal(enemy.hp, 20, "enemy behind the player is not hit by the normal swing");
  rig.host.input.release("sword");
  rig.run(400);
  assert.equal(spins, 1);
  assert.equal(enemy.hp, 20 - rig.tk.config.sword.damage * rig.tk.config.sword.charge.spinDamageMultiplier);
});

test("contact damage is applied once, then the player is invulnerable for invulnerableMs", () => {
  const rig = createRig({ player: { knockbackSpeed: 0 } });
  const p = rig.host.player!;
  const e = spawnEnemy(rig.session, "slime", p.x, p.y, { overrides: { speed: 0, chaseSpeed: 0, detectRange: 0, damage: 1 } })!;
  let hits = 0;
  rig.tk.bus.on("zelda:player:takeDamage", () => hits++);
  rig.run(500);
  assert.equal(hits, 1, "no per-frame damage while touching");
  assert.equal(rig.tk.state.player.hp, rig.tk.config.player.maxHealth - 1);
  // Back on the player while it still blinks: pushed out, no damage.
  e.x = p.x;
  e.y = p.y;
  rig.run(100);
  assert.equal(hits, 1);
  rig.run(500); // invulnerability (970 ms) has expired
  e.x = p.x;
  e.y = p.y;
  rig.run(50);
  assert.equal(hits, 2);
});

test("a lunging enemy bumps the player instead of passing through; knockback points away from it", () => {
  const rig = createRig();
  const p = rig.host.player!;
  const startPX = p.x;
  // Slime 30 px to the left, close enough to lunge right away.
  const e = spawnEnemy(rig.session, "slime", p.x - 30, p.y, { overrides: { detectRange: 200, attackRange: 40, windupMs: 50 } })!;
  let maxX = -Infinity;
  let hitAt = -1;
  rig.tk.bus.on("zelda:player:takeDamage", () => (hitAt = e.x));
  for (let t = 0; t < 60; t++) {
    rig.run(17);
    maxX = Math.max(maxX, e.x);
  }
  assert.ok(hitAt > -Infinity && hitAt !== -1, "the lunge reached the player");
  assert.ok(maxX < p.x, `the enemy never got past the player (max x ${maxX.toFixed(1)}, player ${p.x.toFixed(1)})`);
  assert.ok(p.x > startPX + 5, "the player was knocked away from the enemy (to the right)");
  assert.ok(e.x < hitAt, "the enemy bounced back after the bump");
});

test("while the player blinks, an enemy walking into it is pushed out", () => {
  const rig = createRig();
  const p = rig.host.player!;
  rig.session.player.applyDamage(1, { type: "script", sourceId: "t", originX: p.x, originY: p.y, knockback: 0 });
  const e = spawnEnemy(rig.session, "soldier", p.x + 3, p.y, { overrides: { attackRange: 0 } })!;
  rig.run(34);
  const box = rig.session.player.hurtbox;
  const overlapX = e.hw + box.hw - Math.abs(e.x - box.x);
  const overlapY = e.hh + box.hh - Math.abs(e.y - box.y);
  assert.ok(overlapX <= 0.01 || overlapY <= 0.01, "no overlap with the blinking player");
});

test("shield: none at the start; once picked up it blocks a frontal projectile only while held up, never one from behind", () => {
  const rig = createRig();
  const p = rig.host.player!;
  faceRight(rig);
  const shoot = (fromX: number) =>
    rig.session.world.add(
      new Projectile(rig.session, { team: "enemy", ownerId: "e", x: fromX, y: p.y, dirX: Math.sign(p.x - fromX), dirY: 0, speed: 200, range: 200, sprite: "enemy_shot", damage: 2, damageType: "projectile", blockable: true }),
    );
  let blocked = 0;
  rig.tk.bus.on("zelda:player:blocked", () => blocked++);
  const max = rig.tk.config.player.maxHealth;
  assert.ok(!rig.tk.state.inventory.owned.includes("shield"), "no shield at the start");
  rig.host.input.press("shield");
  shoot(p.x + 40);
  rig.run(400);
  assert.equal(blocked, 0, "no shield to hold up");
  assert.equal(rig.tk.state.player.hp, max - 2);
  rig.run(1500); // invulnerability ends
  rig.tk.inventory.give("shield", 1, { silent: true });
  rig.host.input.release("shield");
  rig.step();
  shoot(p.x + 40);
  rig.run(400);
  assert.equal(blocked, 0, "not held up: the shot hits");
  assert.equal(rig.tk.state.player.hp, max - 4);
  rig.run(1500);
  rig.host.input.press("shield");
  shoot(p.x + 40);
  rig.run(400);
  assert.equal(blocked, 1, "held up, from the front");
  assert.equal(rig.tk.state.player.hp, max - 4);
  shoot(p.x - 40);
  rig.run(400);
  assert.equal(rig.tk.state.player.hp, max - 6, "from behind it hits");
});

test("shield: always up (Start Toolkit) blocks frontal shots without its key", () => {
  const rig = createRig({ shield: { mode: "passive" } });
  rig.tk.inventory.give("shield", 1, { silent: true });
  const p = rig.host.player!;
  faceRight(rig);
  let blocked = 0;
  rig.tk.bus.on("zelda:player:blocked", () => blocked++);
  rig.session.world.add(new Projectile(rig.session, { team: "enemy", ownerId: "e", x: p.x + 40, y: p.y, dirX: -1, dirY: 0, speed: 200, range: 200, sprite: "enemy_shot", damage: 2, damageType: "projectile", blockable: true }));
  rig.run(400);
  assert.equal(blocked, 1);
});

test("shield held up: the built-in shield is drawn in front of the player, hidden when lowered", () => {
  const rig = createRig();
  rig.tk.inventory.give("shield", 1, { silent: true });
  faceRight(rig);
  const before = rig.host.views.length;
  rig.host.input.press("shield");
  rig.step(2);
  const view = rig.host.views.find((v) => v.sprite === "icon_shield");
  assert.ok(view && rig.host.views.length > before, "a shield view");
  if (!view) return;
  assert.equal(view.visible, true);
  assert.ok(view.x > rig.host.player!.x, "on the side the player faces");
  rig.host.input.release("shield");
  rig.step(2);
  assert.equal(view.visible, false);
});

test("player death triggers respawn with configured health", () => {
  const rig = createRig({ player: { respawnDelayMs: 200, respawnHealth: 4 } });
  const start = { x: rig.host.player!.x, y: rig.host.player!.y };
  let died = 0;
  let respawned = 0;
  rig.tk.bus.on("zelda:player:died", () => died++);
  rig.tk.bus.on("zelda:player:respawned", () => respawned++);
  rig.host.player!.x += 50;
  rig.session.player.applyDamage(100, { type: "script", sourceId: "t", originX: 0, originY: 0, knockback: 0 });
  rig.step();
  assert.equal(rig.session.player.isDead, true);
  assert.equal(rig.host.locked, true, "player is locked while dead");
  rig.run(300);
  assert.equal(died, 1);
  assert.equal(respawned, 1);
  assert.equal(rig.tk.state.player.hp, 4);
  assert.deepEqual({ x: rig.host.player!.x, y: rig.host.player!.y }, start);
  assert.equal(rig.host.locked, false);
});

test("the sword poke while charging cancels the charge", () => {
  const rig = createRig({ combat: { enemyHitCooldownMs: 0 } });
  faceRight(rig);
  rig.host.input.press("sword");
  rig.run(400); // swing finished, charging
  assert.equal(rig.session.sword!.phase, "charging");
  const enemy = spawnEnemy(rig.session, "slime", rig.host.player!.x + 16, rig.host.player!.y, { overrides: DUMMY }) as Enemy;
  rig.run(100);
  assert.equal(enemy.hp, 20 - rig.tk.config.sword.charge.pokeDamage);
  assert.equal(rig.session.sword!.phase, "idle");
});
