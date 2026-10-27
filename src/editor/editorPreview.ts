import { EnemyTemplateRegistry } from "../enemies/templates.ts";
import { isObjectType, resolveObjectConfig } from "../interactions/objectTypes.ts";
import { resolveTexture, type TextureManagerLike } from "../host/textures.ts";
import { characterFromParam, findStory, isStory, type PsCharacter, type PsStory } from "../host/psmakerAssets.ts";
import { areaOf, pathOf, pointOf, textOf } from "./fields.ts";

/**
 * Shows what the Zelda actions of a map will create, on the map in the PS Maker editor.
 *
 * The editor draws previews only for its own actions (NPCs, the player); plugins have no hook for
 * it. The plugin module is loaded into the editor window and the editor map is a Phaser scene with
 * `inEditorMode === true` and its data in `scene.map` (PS Maker 1.2.1 GameMap; ENGINE_AUDIT,
 * section 14). So the Toolkit draws its own, non-interactive overlay there and redraws it when the
 * map's actions change. It draws nothing in playtest or in an exported game.
 */

const PLUGIN_TYPE = "plugin:zelda-maker-toolkit:";
const REGISTRY_KEY = Symbol.for("zelda-maker-toolkit.editorPreview");
const LABEL_DEPTH = 999_000; // under the editor's collision boxes (1e6)

export type PreviewItem =
  | { kind: "sprite"; sprite: string; x: number; y: number; w?: number; h?: number; alpha?: number; look?: PsCharacter; label?: string }
  | { kind: "area"; x: number; y: number; w: number; h: number; label: string }
  | { kind: "path"; points: { x: number; y: number }[] }
  | { kind: "link"; from: { x: number; y: number }; to: { x: number; y: number } }
  | { kind: "label"; x: number; y: number; label: string };

interface MapLike {
  id?: string;
  setupActions?: ActionLike[];
  initialActions?: ActionLike[];
  enterActions?: ActionLike[];
  leaveActions?: ActionLike[];
  storyEvents?: { actions?: ActionLike[] }[];
}
interface ActionLike {
  type?: string;
  actionName?: string;
  pluginParams?: Record<string, unknown>;
  inGameCharacterId?: string;
  position?: unknown;
}

const PICKUPS: Record<string, string> = {
  key: "pickup_key",
  big_key: "pickup_bigkey",
  heart: "pickup_heart",
  heart_container: "pickup_container",
  rupees: "pickup_rupee",
  bombs: "pickup_bomb",
  arrows: "pickup_arrow",
  magic: "pickup_magic",
};

/** The Zelda actions of a map, in the order the editor lists them. */
export function zeldaActions(map: MapLike): ActionLike[] {
  const lists = [map.setupActions, map.initialActions, map.enterActions, map.leaveActions, ...(map.storyEvents ?? []).map((e) => e.actions)];
  return lists.flatMap((l) => (Array.isArray(l) ? l : [])).filter((a) => typeof a?.type === "string" && a.type.startsWith(PLUGIN_TYPE));
}

/** What to draw for a map's Zelda actions (pure: used by the overlay and the tests). */
export function previewItems(map: MapLike, story: PsStory | null): PreviewItem[] {
  const templates = new EnemyTemplateRegistry();
  const looks = new Map<string, PsCharacter>();
  const look = (v: unknown) => (story ? characterFromParam(story, v) ?? undefined : undefined);
  const items: PreviewItem[] = [];
  const actions = zeldaActions(map);
  // Define Enemy first: its types are used by enemies listed before or after it.
  for (const a of actions) {
    const p = a.pluginParams ?? {};
    if (a.actionName !== "Zelda: Define Enemy") continue;
    const slot = textOf(p.slot) || "custom_enemy_1";
    templates.define(slot, { extends: textOf(p.basedOn) || "soldier" });
    const ch = look(p.look);
    if (ch) looks.set(slot, ch);
  }
  const enemy = (template: string, at: { x: number; y: number }, character: unknown, label: string, alpha = 0.9): PreviewItem => ({
    kind: "sprite",
    sprite: templates.resolve(template)?.sprite ?? "enemy_slime",
    x: at.x,
    y: at.y,
    alpha,
    look: look(character) ?? looks.get(template),
    label,
  });
  const npcs = new Map<string, { x: number; y: number }>();
  for (const l of [map.setupActions, map.initialActions, map.enterActions])
    for (const a of l ?? []) if (a?.type === "spawnNPCAction" && a.inGameCharacterId) { const at = pointOf(a.position); if (at) npcs.set(a.inGameCharacterId, at); }

  for (const a of actions) {
    const p = a.pluginParams ?? {};
    const at = pointOf(p.position);
    const group = textOf(p.group);
    switch (a.actionName) {
      case "Zelda: Create Enemy": {
        if (!at) break;
        const template = textOf(p.template) || "slime";
        items.push(enemy(template, at, p.character, template.replace("custom_enemy_", "custom ") + (group ? ` G${group}` : "")));
        const route = pathOf(p.patrol);
        if (route.length > 1) items.push({ kind: "path", points: route });
        break;
      }
      case "Zelda: Add Wave Enemy":
        if (at) items.push(enemy(textOf(p.template) || "slime", at, undefined, `wave ${Math.round(Number(p.wave) || 1)}`, 0.6));
        break;
      case "Zelda: Enemy From NPC": {
        const npcAt = npcs.get(textOf(p.npc));
        if (npcAt) items.push({ kind: "label", x: npcAt.x, y: npcAt.y - 18, label: `→ ${textOf(p.template) || "soldier"}${group ? ` G${group}` : ""}` });
        break;
      }
      case "Zelda: Create Object": {
        const type = textOf(p.type);
        if (at && isObjectType(type)) items.push({ kind: "sprite", sprite: resolveObjectConfig(type).sprite, x: at.x, y: at.y, alpha: type === "hidden_passage" ? 0.5 : 1 });
        // "When used": the door it opens or the thing it reveals.
        if (at) for (const to of [pointOf(p.openDoorAt), pointOf(p.revealAt)]) if (to) items.push({ kind: "link", from: at, to });
        break;
      }
      case "Zelda: Create Chest":
        if (at) items.push({ kind: "sprite", sprite: "obj_chest", x: at.x, y: at.y, alpha: p.hidden === true ? 0.5 : 1, label: textOf(p.item) });
        break;
      case "Zelda: Create Door":
        if (at) items.push({ kind: "sprite", sprite: "obj_door", x: at.x, y: at.y, w: Number(p.width) || 16, h: Number(p.height) || 16, label: textOf(p.lock) === "none" ? "" : textOf(p.lock) || "small_key" });
        break;
      case "Zelda: Place Item": {
        const item = textOf(p.item) || "key";
        if (at) items.push(PICKUPS[item] ? { kind: "sprite", sprite: PICKUPS[item], x: at.x, y: at.y } : { kind: "label", x: at.x, y: at.y, label: item });
        break;
      }
      case "Zelda: Set Respawn Point":
        if (at) items.push({ kind: "label", x: at.x, y: at.y, label: "respawn" });
        break;
      case "Zelda: Create Wave Room": {
        const area = areaOf(p.area);
        if (area) items.push({ kind: "area", x: area.x, y: area.y, w: area.width, h: area.height, label: "wave room" });
        const spawnAt = pointOf(p.spawnAt);
        if (spawnAt && textOf(p.spawnEnemy)) items.push(enemy(textOf(p.spawnEnemy), spawnAt, undefined, "after the waves", 0.6));
        break;
      }
      case "Zelda: Add Rule": {
        const from = [pointOf(p.whenObjectAt), pointOf(p.whenObjectAt2)].filter((v): v is { x: number; y: number } => !!v);
        const to = [pointOf(p.openDoorAt), pointOf(p.revealAt), pointOf(p.spawnAt)].filter((v): v is { x: number; y: number } => !!v);
        for (const f of from) for (const t of to) items.push({ kind: "link", from: f, to: t });
        break;
      }
      case "Zelda: Create Switch Sequence": {
        const order = pathOf(p.order);
        if (order.length > 1) items.push({ kind: "path", points: order });
        order.forEach((o, i) => items.push({ kind: "label", x: o.x, y: o.y - 12, label: String(i + 1) }));
        break;
      }
    }
  }
  return items;
}

// ---- drawing ----------------------------------------------------------------------------------

interface Overlay {
  scene: any;
  sig: string;
  objects: any[];
}

/** Starts watching for an editor map (browser only; a reloaded plugin replaces the old watcher). */
export function startEditorPreview(win: any = globalThis): void {
  if (!win || typeof win.document === "undefined" || typeof win.setInterval !== "function") return;
  win[REGISTRY_KEY]?.stop?.();
  let overlay: Overlay | null = null;
  let failed = false;
  const clear = () => {
    for (const o of overlay?.objects ?? []) {
      try {
        o.destroy();
      } catch {
        /* the scene is gone */
      }
    }
    overlay = null;
  };
  const tick = () => {
    const scenes: any[] = win.game?.scene?.getScenes?.(true) ?? [];
    const scene = scenes.find((s) => s?.inEditorMode === true && s.map && s.add && s.textures);
    if (!scene) return clear();
    const sig = signature(scene.map);
    if (overlay && overlay.scene === scene && overlay.sig === sig) return;
    clear();
    overlay = { scene, sig, objects: draw(scene, previewItems(scene.map, storyOf(scene))) };
  };
  const timer = win.setInterval(() => {
    try {
      tick();
    } catch (err) {
      if (!failed) win.console?.warn?.("[ZeldaMakerToolkit] editor map preview failed:", err);
      failed = true;
    }
  }, 300);
  win[REGISTRY_KEY] = {
    stop() {
      win.clearInterval(timer);
      clear();
    },
  };
}

function signature(map: MapLike): string {
  const npcs = [map.setupActions, map.initialActions].flatMap((l) => l ?? []).filter((a) => a?.type === "spawnNPCAction");
  return JSON.stringify([map.id, zeldaActions(map).map((a) => [a.actionName, a.pluginParams]), npcs.map((a) => [a.inGameCharacterId, a.position])]);
}

function storyOf(scene: any): PsStory | null {
  if (isStory(scene.story)) return scene.story;
  return findStory([
    { label: "scene.data", value: scene.sys?.settings?.data },
    { label: "scene", value: scene },
  ])?.story ?? null;
}

/** A character's first standing frame as { key, frame }, if its sheet is loaded in the editor. */
function lookFrame(scene: any, story: PsStory | null, ch: PsCharacter): { key: string; frame: string } | null {
  if (!story) return null;
  const set = ch.animationSets?.find((s) => s.id === ch.defaultAnimationSetId) ?? ch.animationSets?.[0];
  const anims = (set as { animations?: Record<string, unknown> } | undefined)?.animations ?? {};
  const animId = textOf(anims.idleDown) || textOf(anims.down);
  if (!animId) return null;
  const key = `${animId}frames`;
  if (!scene.textures.exists(key)) return null;
  const sheet = story.spritesheetAnimations.find((s) => s.animations?.some((a) => a.id === animId));
  const range = sheet?.animations?.find((a) => a.id === animId);
  if (!sheet || !range) return null;
  const tex = scene.textures.get(key);
  const cols = Math.max(1, Math.floor((tex.getSourceImage?.().width ?? sheet.frameWidth) / sheet.frameWidth));
  const index = range.startRow * cols + range.startCol;
  const frame = `zmt_editor_${index}`;
  if (!tex.has(frame)) tex.add(frame, 0, range.startCol * sheet.frameWidth, range.startRow * sheet.frameHeight, sheet.frameWidth, sheet.frameHeight);
  return { key, frame };
}

function draw(scene: any, items: PreviewItem[]): any[] {
  const out: any[] = [];
  const story = storyOf(scene);
  const label = (x: number, y: number, text: string) => {
    if (!text) return;
    const t = scene.add.text(x, y, text, { fontFamily: "monospace", fontSize: "32px", color: "#ffffff", stroke: "#000000", strokeThickness: 6 });
    t.setOrigin(0.5, 1).setScale(0.18).setDepth(LABEL_DEPTH);
    out.push(t);
  };
  const g = scene.add.graphics();
  g.setDepth(LABEL_DEPTH - 1);
  out.push(g);
  for (const it of items) {
    if (it.kind === "sprite") {
      const frame = it.look ? lookFrame(scene, story, it.look) : null;
      const key = frame?.key ?? resolveTexture(scene.textures as TextureManagerLike, it.sprite);
      if (!key) continue;
      const img = scene.add.image(it.x, it.y, key, frame?.frame);
      if (it.w || it.h) img.setDisplaySize(it.w ?? img.width, it.h ?? img.height);
      img.setAlpha(it.alpha ?? 1).setDepth(it.y);
      out.push(img);
      label(it.x, it.y - (frame ? 10 : img.displayHeight / 2) - 1, it.label ?? "");
    } else if (it.kind === "area") {
      g.lineStyle(1, 0xffa030, 0.9).strokeRect(it.x, it.y, it.w, it.h);
      g.fillStyle(0xffa030, 0.08).fillRect(it.x, it.y, it.w, it.h);
      label(it.x + it.w / 2, it.y + 8, it.label);
    } else if (it.kind === "path") {
      g.lineStyle(1, 0xffe14a, 0.9);
      g.beginPath();
      it.points.forEach((pt, i) => (i ? g.lineTo(pt.x, pt.y) : g.moveTo(pt.x, pt.y)));
      g.strokePath();
    } else if (it.kind === "link") {
      g.lineStyle(1, 0x5ad8ff, 0.8).lineBetween(it.from.x, it.from.y, it.to.x, it.to.y);
    } else {
      label(it.x, it.y, it.label);
    }
  }
  return out;
}
