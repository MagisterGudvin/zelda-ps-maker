import { test } from "node:test";
import assert from "node:assert/strict";
import { animFrame, framesFor, validateAnim } from "../../src/core/animation.ts";
import { createRig, type TestRig } from "../helpers/fakeHost.ts";
import { spawnEnemy } from "../../src/enemies/spawn.ts";
import type { FakeView } from "../helpers/fakeHost.ts";

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
