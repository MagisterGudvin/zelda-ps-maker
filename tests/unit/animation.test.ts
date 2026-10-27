import { test } from "node:test";
import assert from "node:assert/strict";
import { animFrame, framesFor, validateAnim } from "../../src/core/animation.ts";
import { createRig, type TestRig } from "../helpers/fakeHost.ts";
import { spawnEnemy } from "../../src/enemies/spawn.ts";
import type { FakeView } from "../helpers/fakeHost.ts";
import { createObject } from "../../src/interactions/spawnObject.ts";

const SHEETS = { hero: { image: "hero.png", frameWidth: 64, frameHeight: 64 }, sword: { image: "sword.png", frameWidth: 64, frameHeight: 64 } };

test("frames per direction, left mirrored from right, stretch and fps timing", () => {
  const def = { sheet: "hero", frames: { down: [0, 1, 2, 3], right: [8, 9, 10, 11] } };
  assert.deepEqual(framesFor(def, "left"), { frames: [8, 9, 10, 11], flipX: true });
  assert.deepEqual(framesFor(def, "up"), { frames: [0, 1, 2, 3], flipX: false }, "missing direction falls back");
  assert.equal(animFrame(def, "down", 0, 400)!.frame, 0);
  assert.equal(animFrame(def, "down", 150, 400)!.frame, 1);
  assert.equal(animFrame(def, "down", 399, 400)!.frame, 3);
  assert.equal(animFrame(def, "down", 5000, 400)!.frame, 3, "non-looping holds the last frame");
  assert.equal(animFrame({ ...def, fps: 10, loop: true }, "down", 450)!.frame, 0, "loops at 10 fps");
  assert.deepEqual(validateAnim({ sheet: "nope", frames: [1, -1] }, SHEETS), ['sheet "nope" is not defined (use Zelda: Define Sprite Sheet first)', "frame numbers must be whole numbers ≥ 0"]);
});

function faceRight(rig: TestRig): void {
  rig.step();
  rig.host.walk(1, 0);
  rig.step();
}

test("attack animation is drawn over the player across the whole swing, weapon behind when facing up", () => {
  const rig = createRig({
    sprites: {
      sheets: SHEETS,
      animations: {
        slash: { sheet: "hero", frames: { right: [10, 11, 12, 13], up: [20, 21, 22, 23] } },
        blade: { sheet: "sword", frames: { right: [10, 11, 12, 13], up: [20, 21, 22, 23] } },
      },
    },
    player: { sprites: { attack: "slash", weaponAttack: "blade" } },
  });
  faceRight(rig);
  rig.host.overlayLog.length = 0;
  rig.host.input.tap("sword");
  rig.run(320);
  const frames = rig.host.overlayLog.filter(Boolean).map((l) => l!.find((x) => x.sheet === "hero")!.frame);
  assert.deepEqual([...new Set(frames)], [10, 11, 12, 13], "all frames shown in order over windup+active+recovery");
  const anyLayers = rig.host.overlayLog.find(Boolean)!;
  assert.deepEqual(anyLayers.map((l) => [l.sheet, l.behind]), [["hero", false], ["sword", false]]);
  rig.run(200);
  assert.equal(rig.host.overlay, null, "sprite restored after the swing");
  const swordView = rig.host.views.find((v) => v.sprite === "sword");
  assert.ok(!swordView || !swordView.visible, "built-in blade hidden when an attack animation exists");
  // Facing up: weapon layer first (behind the body).
  rig.step();
  rig.host.walk(0, -1);
  rig.step();
  rig.host.input.tap("sword");
  rig.step(3);
  assert.deepEqual(rig.host.overlay!.map((l) => [l.sheet, l.behind]), [["sword", true], ["hero", false]]);
});

test("the built-in blade starts at the body edge in every phase (no drift toward the player)", () => {
  const rig = createRig({ sword: { sweep: false } });
  faceRight(rig);
  rig.host.input.press("sword");
  rig.run(120);
  const blade = rig.host.views.find((v) => v.sprite === "sword") as FakeView;
  const during = { x: blade.x, y: blade.y };
  rig.run(400); // now charging (button held)
  assert.equal(rig.session.sword!.phase, "charging");
  assert.deepEqual({ x: blade.x, y: blade.y }, during);
  const p = rig.session.player;
  assert.equal(blade.x, p.pivotX + p.box.hw, "hilt at the body edge");
});

test("enemies play sprite-sheet animations per state", () => {
  const rig = createRig({
    sprites: {
      sheets: SHEETS,
      animations: { s_walk: { sheet: "hero", frames: [1, 2], fps: 8, loop: true }, s_hurt: { sheet: "hero", frames: [5] } },
    },
  });
  const e = spawnEnemy(rig.session, "slime", 300, 300, { overrides: { animations: { walk: "s_walk", hurt: "s_hurt" } as never, detectRange: 0 } })!;
  rig.run(1500);
  const view = rig.host.views.find((v) => (v as FakeView).animFrame?.sheet === "hero") as FakeView;
  assert.ok(view, "enemy view received sheet frames");
  assert.ok([1, 2].includes(view.animFrame!.frame));
  e.receiveHit({ amount: 1, type: "sword", team: "player", sourceId: "p", originX: 290, originY: 300, knockback: 100, stunMs: 0, blockable: false });
  rig.step();
  assert.equal(view.animFrame!.frame, 5);
});

/** One sheet with a 4-frame animation per player moment (frames 0-3, 10-13, 20-23...). */
function poseRig(extra: Record<string, unknown> = {}, sprites: Record<string, string> = {}) {
  const names = ["slash", "walkSword", "shieldUp", "shoot", "throwB", "use", "liftUp", "carryWalk", "toss", "pushing", "getItem", "dying"];
  const animations = Object.fromEntries(names.map((n, i) => [n, { sheet: "hero", frames: [i * 10, i * 10 + 1, i * 10 + 2, i * 10 + 3], ...(["walkSword", "shieldUp", "carryWalk", "pushing"].includes(n) ? { fps: 8, loop: true } : {}) }]));
  return createRig({ sprites: { sheets: SHEETS, animations }, player: { sprites: { attack: "slash", ...sprites } }, ...extra });
}
const bodyFrame = (rig: TestRig) => rig.host.overlay?.find((l) => l.sheet === "hero")?.frame ?? null;

test("charging while walking: no frozen frame — own animation, or PS Maker's walk with the built-in blade", () => {
  // Without a "walking while charging" animation the PS Maker sprite walks and the blade shows.
  const rig = poseRig();
  faceRight(rig);
  rig.host.input.press("sword");
  rig.run(500);
  assert.equal(rig.session.sword!.phase, "charging");
  assert.equal(bodyFrame(rig), 3, "standing: last attack frame (sword forward)");
  for (let i = 0; i < 10; i++) {
    rig.host.walk(1, 0);
    rig.step();
  }
  assert.equal(rig.host.overlay, null, "walking: PS Maker's own walk animation");
  assert.ok(rig.host.views.find((v) => v.sprite === "sword")?.visible, "with the built-in blade");

  const rig2 = poseRig({}, { chargeWalk: "walkSword" });
  faceRight(rig2);
  rig2.host.input.press("sword");
  rig2.run(500);
  const seen = new Set<number | null>();
  for (let i = 0; i < 40; i++) {
    rig2.host.walk(1, 0);
    rig2.step();
    seen.add(bodyFrame(rig2));
  }
  assert.deepEqual([...seen].sort(), [10, 11, 12, 13], "walking: the charge-walk animation loops");
});

test("item animations: bow, boomerang, other items fall back to Use item; lift, carry, throw, push", () => {
  const rig = poseRig({}, { bow: "shoot", item: "use", lift: "liftUp", carry: "carryWalk", throw: "toss", push: "pushing" });
  faceRight(rig);
  rig.tk.inventory.give("boomerang", 1, { silent: true });
  assert.ok(rig.session.items!.use("boomerang").ok);
  rig.step();
  assert.equal(bodyFrame(rig), 50, "boomerang has no own animation: Use item");
  rig.run(400);
  assert.equal(rig.host.overlay, null, "one-shot animation ends");
  rig.session.player.playPose("", 300);
  rig.step();
  assert.equal(rig.host.overlay, null, "empty animation: nothing");

  // Lift a pot in front, carry it while walking, throw it.
  const p = rig.host.player!;
  createObject(rig.session, "pot", p.x + 14, p.y, { id: "pot1" });
  rig.host.input.tap("action");
  rig.step();
  assert.ok(rig.session.interactions!.isCarrying());
  assert.equal(bodyFrame(rig), 60, "lift");
  rig.run(300);
  assert.equal(bodyFrame(rig), 70, "carry, standing: first frame");
  const carried = new Set<number | null>();
  for (let i = 0; i < 40; i++) {
    rig.host.walk(0, 1);
    rig.step();
    carried.add(bodyFrame(rig));
  }
  assert.deepEqual([...carried].sort(), [70, 71, 72, 73], "carry, walking: loops");
  rig.host.input.tap("action");
  rig.step();
  assert.equal(bodyFrame(rig), 80, "throw");
  rig.run(400);

  // Lean on a block: push animation.
  faceRight(rig);
  createObject(rig.session, "block", rig.host.player!.x + 16, rig.host.player!.y, { id: "blk" });
  for (let i = 0; i < 6; i++) {
    rig.host.walk(1, 0);
    rig.step();
  }
  assert.ok([90, 91, 92, 93].includes(bodyFrame(rig)!), `push (${bodyFrame(rig)})`);
});

test("item get holds the player still for a second; shield up on its button; death holds its last frame", () => {
  const rig = poseRig({ shield: { mode: "hold" } }, { itemGet: "getItem", shield: "shieldUp", death: "dying" });
  faceRight(rig);
  const p = rig.host.player!;
  createObject(rig.session, "chest", p.x + 14, p.y, { id: "c1", overrides: { contents: { item: "arrows", count: 5 } } });
  rig.host.input.tap("action");
  rig.step();
  assert.equal(bodyFrame(rig), 100, "item get");
  assert.ok(rig.session.player.isLocked("pose"), "stands still");
  rig.run(1100);
  assert.ok(!rig.session.player.isLocked("pose"));
  assert.equal(rig.host.overlay, null);

  rig.tk.inventory.give("shield", 1, { silent: true });
  rig.host.input.press("shield");
  rig.step(2);
  assert.equal(bodyFrame(rig), 20, "shield up");
  rig.host.input.release("shield");
  rig.step(2);
  assert.equal(rig.host.overlay, null);

  rig.session.player.applyDamage(999, { type: "script", sourceId: "test", originX: 0, originY: 0, knockback: 0 });
  rig.step();
  assert.equal(bodyFrame(rig), 110, "death");
  rig.run(1050);
  assert.equal(bodyFrame(rig), 113, "death: last frame until respawn (1.2 s)");
  rig.run(400);
  assert.equal(rig.host.overlay, null, "respawned: the PS Maker sprite again");
});

test("walking is still walking when PS Maker moves the player only every other tick", () => {
  const rig = poseRig({}, { chargeWalk: "walkSword" });
  faceRight(rig);
  rig.host.input.press("sword");
  rig.run(500);
  const frames: (number | null)[] = [];
  for (let i = 0; i < 40; i++) {
    if (i % 2 === 0) rig.host.walk(2, 0);
    rig.step();
    frames.push(bodyFrame(rig));
  }
  assert.ok(frames.every((f) => f !== null && f >= 10 && f <= 13), `only charge-walk frames: ${frames.join(",")}`);
  rig.run(300);
  assert.equal(bodyFrame(rig), 3, "standing again: the charge pose");
});
