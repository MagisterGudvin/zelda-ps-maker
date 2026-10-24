import type { AABB, Facing } from "../../src/core/math.ts";
import { overlaps } from "../../src/core/math.ts";
import type { DebugDraw, EntityView, HostAdapter, HudModel, HudSink, InputAction, InputSource, OverlayLayer, Renderer, ViewSpec } from "../../src/host/types.ts";
import { Toolkit } from "../../src/core/toolkit.ts";
import type { Session } from "../../src/core/session.ts";
import { createMemoryStorage } from "../../src/save/save.ts";

/** Scriptable input: tests press/hold/release actions between ticks. */
export class FakeInput implements InputSource {
  private readonly held = new Set<InputAction>();
  private readonly queuedPress = new Set<InputAction>();
  private readonly queuedRelease = new Set<InputAction>();
  private pressedNow = new Set<InputAction>();
  private releasedNow = new Set<InputAction>();
  private downNow = new Set<InputAction>();

  press(a: InputAction): void {
    this.queuedPress.add(a);
    this.held.add(a);
  }
  /** Press and release before the next tick (a tap). */
  tap(a: InputAction): void {
    this.queuedPress.add(a);
    this.queuedRelease.add(a);
  }
  release(a: InputAction): void {
    this.held.delete(a);
    this.queuedRelease.add(a);
  }
  latch(): void {
    this.pressedNow = new Set(this.queuedPress);
    this.releasedNow = new Set(this.queuedRelease);
    this.downNow = new Set(this.held);
    for (const a of this.queuedPress) if (!this.queuedRelease.has(a)) this.downNow.add(a);
    this.queuedPress.clear();
    this.queuedRelease.clear();
  }
  isDown(a: InputAction): boolean {
    return this.downNow.has(a);
  }
  pressed(a: InputAction): boolean {
    return this.pressedNow.has(a);
  }
  released(a: InputAction): boolean {
    return this.releasedNow.has(a);
  }
  reset(): void {
    this.held.clear();
    this.queuedPress.clear();
    this.queuedRelease.clear();
    this.pressedNow.clear();
    this.releasedNow.clear();
    this.downNow.clear();
  }
}

export class FakeView implements EntityView {
  x = 0;
  y = 0;
  visible = true;
  alpha = 1;
  tint: number | null = null;
  sprite: string;
  destroyed = false;
  constructor(spec: ViewSpec) {
    this.sprite = spec.sprite;
  }
  setPosition(x: number, y: number): void {
    this.x = x;
    this.y = y;
  }
  setVisible(v: boolean): void {
    this.visible = v;
  }
  setAlpha(a: number): void {
    this.alpha = a;
  }
  setTint(c: number | null): void {
    this.tint = c;
  }
  setSprite(s: string): void {
    this.sprite = s;
  }
  setRotation(): void {}
  setScale(): void {}
  setFlipX(): void {}
  animFrame: { sheet: string; frame: number; flipX: boolean } | null = null;
  setAnimFrame(sheet: string, frame: number, flipX: boolean): void {
    this.animFrame = { sheet, frame, flipX };
  }
  destroy(): void {
    this.destroyed = true;
  }
}

export class FakeHud implements HudSink {
  last: HudModel | null = null;
  renders = 0;
  visible = false;
  render(model: HudModel): void {
    this.last = model;
    this.renders++;
  }
  setVisible(v: boolean): void {
    this.visible = v;
  }
  diagnostics: string[] | null = null;
  setDiagnostics(lines: string[] | null): void {
    this.diagnostics = lines;
  }
  preview: unknown = null;
  setSheetPreview(p: unknown): void {
    this.preview = p;
  }
}

export class FakeDebug implements DebugDraw {
  rects = 0;
  visible = false;
  clear(): void {
    this.rects = 0;
  }
  rect(): void {
    this.rects++;
  }
  circle(): void {
    this.rects++;
  }
  label(): void {}
  setVisible(v: boolean): void {
    this.visible = v;
  }
}

/**
 * Deterministic host: the "player" is a box the test moves by hand (as PS
 * Maker's controller would), walls are plain boxes.
 */
export class FakeHost implements HostAdapter {
  readonly input = new FakeInput();
  readonly views: FakeView[] = [];
  readonly renderer: Renderer = {
    createView: (spec: ViewSpec) => {
      const v = new FakeView(spec);
      this.views.push(v);
      return v;
    },
  };
  readonly hud = new FakeHud();
  readonly debug = new FakeDebug();
  readonly walls: AABB[] = [];
  player: AABB | null = { x: 100, y: 100, hw: 7, hh: 7 };
  locked = false;
  blinkVisible = true;
  tint: number | null = null;
  disposed = false;
  facingHint: Facing | null = null;

  readPlayerBox(out: AABB): boolean {
    if (!this.player) return false;
    out.x = this.player.x;
    out.y = this.player.y;
    out.hw = this.player.hw;
    out.hh = this.player.hh;
    return true;
  }
  /** Sprite drawn 16px taller than the body (feet collision box), like many PS Maker characters. */
  readPlayerVisual(out: AABB): boolean {
    if (!this.player) return false;
    out.x = this.player.x;
    out.y = this.player.y - 8;
    out.hw = this.player.hw;
    out.hh = this.player.hh + 8;
    return true;
  }
  overlay: OverlayLayer[] | null = null;
  overlayLog: (OverlayLayer[] | null)[] = [];
  setPlayerOverlay(layers: OverlayLayer[] | null): void {
    this.overlay = layers;
    this.overlayLog.push(layers);
  }
  previewed: string | null = null;
  previewSheet(id: string | null): boolean {
    this.previewed = id;
    return true;
  }
  describe(): string[] {
    return ["fake host"];
  }
  sounds: { src: string; volume: number }[] = [];
  playSound(src: string, volume: number): void {
    this.sounds.push({ src, volume });
  }
  readPlayerFacingHint(_current: Facing): Facing | null {
    return this.facingHint;
  }
  movePlayerBy(dx: number, dy: number): void {
    if (!this.player) return;
    this.player.x += dx;
    this.player.y += dy;
  }
  setPlayerPosition(x: number, y: number): void {
    if (!this.player) return;
    this.player.x = x;
    this.player.y = y;
  }
  setPlayerLocked(locked: boolean): void {
    this.locked = locked;
  }
  setPlayerBlink(visible: boolean): void {
    this.blinkVisible = visible;
  }
  setPlayerTint(color: number | null): void {
    this.tint = color;
  }
  isMapBlocked(box: AABB): boolean {
    for (const w of this.walls) if (overlaps(w, box)) return true;
    return false;
  }
  beginTick(): void {}
  dispose(): void {
    this.disposed = true;
  }

  /** Simulates PS Maker moving the player (ignored while the toolkit locks it). */
  walk(dx: number, dy: number): void {
    if (this.locked || !this.player) return;
    this.player.x += dx;
    this.player.y += dy;
  }
}

export interface TestRig {
  tk: Toolkit;
  host: FakeHost;
  session: Session;
  storage: ReturnType<typeof createMemoryStorage>;
  logs: { level: string; args: unknown[] }[];
  /** Runs n fixed ticks (16.67 ms each). */
  step(n?: number): void;
  /** Runs ticks for at least `ms` milliseconds. */
  run(ms: number): void;
}

export function createRig(config: unknown = {}, opts: { mapId?: string; storage?: ReturnType<typeof createMemoryStorage> } = {}): TestRig {
  const logs: { level: string; args: unknown[] }[] = [];
  const sink = {
    debug: (...args: unknown[]) => logs.push({ level: "debug", args }),
    info: (...args: unknown[]) => logs.push({ level: "info", args }),
    warn: (...args: unknown[]) => logs.push({ level: "warn", args }),
    error: (...args: unknown[]) => logs.push({ level: "error", args }),
  };
  const storage = opts.storage ?? createMemoryStorage();
  const tk = new Toolkit({ storage, logSink: sink });
  // Deterministic baseline for tests: no random drops unless a test enables them.
  tk.configure({ publicApi: false, debug: { logLevel: "debug" }, enemies: { defaultDrops: { chance: 0 } }, interactions: { defaultDrops: { chance: 0 } }, save: { autoSave: false } });
  tk.configure(config);
  const host = new FakeHost();
  const session = tk.start(host, opts.mapId ?? "test_map", { seed: 1234 });
  const dt = 1000 / 60;
  return {
    tk,
    host,
    session,
    storage,
    logs,
    step(n = 1) {
      for (let i = 0; i < n; i++) session.step(dt);
    },
    run(ms: number) {
      const n = Math.ceil(ms / dt);
      for (let i = 0; i < n; i++) session.step(dt);
    },
  };
}

export function errors(rig: TestRig): unknown[][] {
  return rig.logs.filter((l) => l.level === "error").map((l) => l.args);
}
