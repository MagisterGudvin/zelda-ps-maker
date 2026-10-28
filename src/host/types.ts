import type { AABB, Facing } from "../core/math.ts";

/**
 * Boundary between the engine-agnostic toolkit and the host (PS Maker via
 * Phaser, or the fake host used by unit tests). Nothing outside `src/host`
 * touches Phaser directly.
 */
export interface HostAdapter {
  readonly input: InputSource;
  readonly renderer: Renderer;
  readonly hud: HudSink | null;
  readonly debug: DebugDraw | null;

  /** Writes the player's hurtbox (body or sprite bounds) into `out`. False if no player. */
  readPlayerBox(out: AABB): boolean;
  /** Writes the player's displayed sprite bounds (sword pivot, overlays). False if unknown. */
  readPlayerVisual(out: AABB): boolean;
  /** Optional: world y of the top of the player's drawn pixels (head), null when unknown. */
  readPlayerTop?(): number | null;
  /** Optional: pixel size of a loaded texture ("key" or "key#frame"), null when not loaded. */
  textureSize?(sprite: string): { w: number; h: number } | null;
  /** Optional: makes these toolkit solids stop the player in the engine's physics (called every tick). */
  syncSolids?(boxes: readonly AABB[]): void;
  /** Optional: sides on which the engine's physics stopped the player this frame. */
  readPlayerTouching?(): { up: boolean; down: boolean; left: boolean; right: boolean } | null;
  /** Draws animation frames over the player sprite (attack, weapon); null restores the sprite. */
  setPlayerOverlay(layers: OverlayLayer[] | null): void;
  /** Shows a sprite sheet full screen with frame numbers (null closes). Returns false if unknown. */
  previewSheet(sheetId: string | null): boolean;
  /** Optional: a project variable of the engine (PS Maker variables), undefined when unknown. */
  getVariable?(id: string): string | number | boolean | undefined;
  /** Optional: sets a project variable; the value is converted to the variable's type. False when unknown. */
  setVariable?(id: string, value: string | number | boolean): boolean;
  /** Optional: true while the engine shows a dialogue (combat pauses, see combat.pauseDuringDialogue). */
  isDialogueOpen?(): boolean;
  /** Host facts for the diagnostics panel (scene, camera, player). */
  describe(): string[];
  /** Plays a sound by audio key or URL (loaded on first use). */
  playSound(src: string, volume: number): void;
  /**
   * Optional facing hint (held movement keys, animation name). `current` lets
   * the host keep the current facing while two directions are held.
   */
  readPlayerFacingHint(current: Facing): Facing | null;
  /** Moves the player sprite by a delta; collision was already checked by the toolkit. */
  movePlayerBy(dx: number, dy: number): void;
  setPlayerPosition(x: number, y: number): void;
  /** While locked, the host cancels the engine's own player movement. */
  setPlayerLocked(locked: boolean): void;
  /** Visual feedback: invulnerability blink / hit flash. */
  setPlayerBlink(visible: boolean): void;
  setPlayerTint(color: number | null): void;

  /** True when the box overlaps map collision that the toolkit does not own. */
  isMapBlocked(box: AABB): boolean;
  /** Called once per fixed tick before systems run (cache refresh etc). */
  beginTick(tick: number): void;

  /** Releases every listener, view and texture reference owned by the adapter. */
  dispose(): void;
}

export type InputAction = "sword" | "useItem" | "shield" | "action" | "nextItem" | "prevItem" | "inventory" | "debug" | "diagnostics";

export const INPUT_ACTIONS: readonly InputAction[] = ["sword", "useItem", "shield", "action", "nextItem", "prevItem", "inventory", "debug", "diagnostics"];

/**
 * Edge-aware input. `latch()` is called once per fixed tick; presses that
 * happened between ticks are reported as `pressed` exactly once.
 */
export interface InputSource {
  latch(): void;
  isDown(action: InputAction): boolean;
  pressed(action: InputAction): boolean;
  released(action: InputAction): boolean;
  /** Clears held/pressed state (window blur, pause). */
  reset(): void;
}

/** One layer of a player overlay: a frame of an author sprite sheet. */
export interface OverlayLayer {
  sheet: string;
  frame: number;
  flipX: boolean;
  /** Drawn behind the body layer (e.g. weapon when facing up). */
  behind: boolean;
}

/** Visual description used to create a view; keeps systems asset-agnostic. */
export interface ViewSpec {
  /** Built-in procedural sprite id (see host/textures.ts) or a texture key. */
  sprite: string;
  /** Optional existing game object to adopt instead of creating one (NPC). */
  adopt?: unknown;
  width?: number;
  height?: number;
  tint?: number;
  /** Rendering layer offset added to the y-sorted depth. */
  layer?: number;
  /** Draw the view without y-sorting (above everything, e.g. explosions). */
  overlay?: boolean;
  /** Sprite drawn offset from the entity center (feet of 64x64 character frames). */
  offsetX?: number;
  offsetY?: number;
  scale?: number;
  originX?: number;
  originY?: number;
}

export interface EntityView {
  setPosition(x: number, y: number): void;
  setVisible(visible: boolean): void;
  setAlpha(alpha: number): void;
  setTint(color: number | null): void;
  setSprite(sprite: string): void;
  setRotation(radians: number): void;
  setScale(scale: number): void;
  setFlipX(flip: boolean): void;
  /** Optional: sort the view as if it stood at `y` (null = its own position), e.g. carried overhead in front of the player. */
  setDepthY?(y: number | null): void;
  /** Shows frame `frame` of an author sprite sheet (keeps the current look while it loads). */
  setAnimFrame(sheet: string, frame: number, flipX: boolean): void;
  destroy(): void;
}

export interface Renderer {
  createView(spec: ViewSpec): EntityView;
}

export interface DebugDraw {
  clear(): void;
  rect(box: AABB, color: number, alpha?: number): void;
  circle(x: number, y: number, r: number, color: number, alpha?: number): void;
  label(x: number, y: number, text: string): void;
  setVisible(visible: boolean): void;
}

export interface HudItemSlot {
  itemId: string;
  name: string;
  description: string;
  icon: string;
  count: number | null;
  selected: boolean;
}

export interface HudModel {
  visible: boolean;
  hp: number;
  maxHp: number;
  heartValue: number;
  magic: number;
  maxMagic: number;
  showHearts: boolean;
  showMagic: boolean;
  activeItem: HudItemSlot | null;
  counters: { id: string; label: string; icon: string; value: number; digits: number }[];
  messages: { text: string; remainingMs: number }[];
  inventoryOpen: boolean;
  inventoryTitle: string;
  inventory: HudItemSlot[];
  dead: boolean;
  deathText: string;
  lifeLabel: string;
  position: "top" | "bottom";
  scale: number;
  safeArea: { top: number; right: number; bottom: number; left: number };
  fontFamily: string;
  /** Own pictures by slot (config.ui.skin). */
  skin: Record<string, string>;
  barSlice: number;
  showLifeLabel: boolean;
  textColor: string;
}

/** Sheet shown full-screen with frame numbers (Zelda: Preview Sprite Sheet). */
export interface SheetPreview {
  textureKey: string;
  frameWidth: number;
  frameHeight: number;
  margin: number;
  spacing: number;
  title: string;
}

export interface HudSink {
  render(model: HudModel): void;
  setVisible(visible: boolean): void;
  /** Diagnostics text block (null hides it). */
  setDiagnostics(lines: string[] | null): void;
  /** Full-screen sprite-sheet viewer (null hides it). */
  setSheetPreview(preview: SheetPreview | null): void;
}
