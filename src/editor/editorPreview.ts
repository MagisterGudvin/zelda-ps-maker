import { EnemyTemplateRegistry } from "../enemies/templates.ts";
import { isObjectType, resolveObjectConfig } from "../interactions/objectTypes.ts";
import { resolveTexture, type TextureManagerLike } from "../host/textures.ts";
import { characterFromParam, findStory, isStory, type PsAnimationSet, type PsCharacter, type PsStory } from "../host/psmakerAssets.ts";
import { areaOf, pathOf, pointOf, textOf } from "./fields.ts";

/**
 * Shows what the Zelda actions of a map will create, on the map in the PS Maker editor.
 *
 * The editor draws previews only for its own actions (NPCs, the player); plugins have no hook for
 * it. The plugin module is loaded into the editor window and the editor map is a Phaser scene with
 * `inEditorMode === true` and its data in `scene.map` (PS Maker 1.2.1 GameMap; ENGINE_AUDIT,
 * section 14). So the Toolkit draws its own overlay there and redraws it when the map's actions
 * change: a click selects a picture and scrolls the event list to its action, a double click opens
 * the action's settings (the editor's own route, as its trigger previews do), and collision boxes
 * follow the editor's collision toggle. It draws nothing in playtest or in an exported game.
 */

const PLUGIN_TYPE = "plugin:zelda-maker-toolkit:";
const REGISTRY_KEY = Symbol.for("zelda-maker-toolkit.editorPreview");
const LABEL_DEPTH = 999_000; // under the editor's collision boxes (1e6)
const COLLISION_DEPTH = 1_000_000; // the editor draws its collision boxes at this depth
const DOUBLE_CLICK_MS = 400;

/** Editor list a map action belongs to (route breadcrumb `root:<id>`); "" = inside an event. */
const ROOTS = { setupActions: "__map_setup__", initialActions: "__map_start__", enterActions: "__map_enter__", leaveActions: "__map_leave__" } as const;

export interface ActionRef {
  id: string;
  root: string;
}
interface Box {
  w: number;
  h: number;
}
export type PreviewItem =
  | { kind: "sprite"; sprite: string; x: number; y: number; w?: number; h?: number; alpha?: number; look?: PsCharacter; label?: string; box?: Box | null; ref?: ActionRef }
  | { kind: "area"; x: number; y: number; w: number; h: number; label: string; ref?: ActionRef }
  | { kind: "path"; points: { x: number; y: number }[] }
  | { kind: "link"; from: { x: number; y: number }; to: { x: number; y: number } }
  | { kind: "label"; x: number; y: number; label: string; ref?: ActionRef };

interface MapLike {
  id?: string;
  setupActions?: ActionLike[];
  initialActions?: ActionLike[];
  enterActions?: ActionLike[];
  leaveActions?: ActionLike[];
  storyEvents?: { actions?: ActionLike[] }[];
}
interface ActionLike {
  id?: string;
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

/** The Zelda actions of a map with the editor list they are in, in the order the editor lists them. */
export function zeldaActions(map: MapLike): { action: ActionLike; root: string }[] {
  const lists: [ActionLike[] | undefined, string][] = [
    ...(Object.entries(ROOTS) as [keyof typeof ROOTS, string][]).map(([k, root]) => [map[k], root] as [ActionLike[] | undefined, string]),
    ...(map.storyEvents ?? []).map((e) => [e.actions, ""] as [ActionLike[] | undefined, string]),
  ];
  return lists.flatMap(([l, root]) => (Array.isArray(l) ? l : []).filter((a) => typeof a?.type === "string" && a.type.startsWith(PLUGIN_TYPE)).map((action) => ({ action, root })));
}

/** Collision box of a character's default animation set, in frame pixels. */
function characterBox(ch: PsCharacter | undefined): { x: number; y: number; width: number; height: number } | null {
  const set: PsAnimationSet | undefined = ch?.animationSets?.find((s) => s.id === ch.defaultAnimationSetId) ?? ch?.animationSets?.[0];
  return set?.collision?.enabled !== false ? set?.collision?.box ?? null : null;
}

/** What to draw for a map's Zelda actions (pure: used by the overlay and the tests). */
export function previewItems(map: MapLike, story: PsStory | null): PreviewItem[] {
  const templates = new EnemyTemplateRegistry();
  const looks = new Map<string, PsCharacter>();
  const look = (v: unknown) => (story ? characterFromParam(story, v) ?? undefined : undefined);
  const items: PreviewItem[] = [];
  const actions = zeldaActions(map);
  // Define Enemy first: its types are used by enemies listed before or after it.
  for (const { action: a } of actions) {
    const p = a.pluginParams ?? {};
    if (a.actionName !== "Zelda: Define Enemy") continue;
    const slot = textOf(p.slot) || "custom_enemy_1";
    templates.define(slot, { extends: textOf(p.basedOn) || "soldier" });
    const ch = look(p.look);
    if (ch) looks.set(slot, ch);
  }
  const enemy = (template: string, at: { x: number; y: number }, character: unknown, label: string, ref: ActionRef | undefined, alpha = 0.9): PreviewItem => {
    const cfg = templates.resolve(template);
    const ch = look(character) ?? looks.get(template);
    const cb = characterBox(ch);
    // The enemy's body is its collision box: the character's box, or the type's size.
    return { kind: "sprite", sprite: cfg?.sprite ?? "enemy_slime", x: at.x, y: at.y, alpha, look: ch, label, ref, box: cb ? { w: cb.width, h: cb.height } : cfg ? { w: cfg.width, h: cfg.height } : null };
  };
  const npcs = new Map<string, { x: number; y: number }>();
  for (const l of [map.setupActions, map.initialActions, map.enterActions])
    for (const a of l ?? []) if (a?.type === "spawnNPCAction" && a.inGameCharacterId) { const at = pointOf(a.position); if (at) npcs.set(a.inGameCharacterId, at); }

  for (const { action: a, root } of actions) {
    const p = a.pluginParams ?? {};
    const at = pointOf(p.position);
    const group = textOf(p.group);
    const ref = a.id ? { id: a.id, root } : undefined;
    switch (a.actionName) {
      case "Zelda: Create Enemy": {
        if (!at) break;
        const template = textOf(p.template) || "slime";
        items.push(enemy(template, at, p.character, template.replace("custom_enemy_", "custom ") + (group ? ` G${group}` : ""), ref));
        const route = pathOf(p.patrol);
        if (route.length > 1) items.push({ kind: "path", points: route });
        break;
      }
      case "Zelda: Add Wave Enemy":
        if (at) items.push(enemy(textOf(p.template) || "slime", at, undefined, `wave ${Math.round(Number(p.wave) || 1)}`, ref, 0.6));
        break;
      case "Zelda: Enemy From NPC": {
        const npcAt = npcs.get(textOf(p.npc));
        if (npcAt) items.push({ kind: "label", x: npcAt.x, y: npcAt.y - 18, label: `→ ${textOf(p.template) || "soldier"}${group ? ` G${group}` : ""}`, ref });
        break;
      }
      case "Zelda: Create Object": {
        const type = textOf(p.type);
        if (at && isObjectType(type)) {
          const cfg = resolveObjectConfig(type);
          items.push({ kind: "sprite", sprite: cfg.sprite, x: at.x, y: at.y, alpha: type === "hidden_passage" ? 0.5 : 1, box: cfg.solid ? { w: cfg.width, h: cfg.height } : null, ref });
        }
        // "When used": the door it opens or the thing it reveals.
        if (at) for (const to of [pointOf(p.openDoorAt), pointOf(p.revealAt)]) if (to) items.push({ kind: "link", from: at, to });
        break;
      }
      case "Zelda: Create Chest": {
        const cfg = resolveObjectConfig("chest");
        if (at) items.push({ kind: "sprite", sprite: "obj_chest", x: at.x, y: at.y, alpha: p.hidden === true ? 0.5 : 1, label: textOf(p.item), box: { w: cfg.width, h: cfg.height }, ref });
        break;
      }
      case "Zelda: Create Door": {
        const w = Number(p.width) || 16;
        const h = Number(p.height) || 16;
        if (at) items.push({ kind: "sprite", sprite: "obj_door", x: at.x, y: at.y, w, h, label: textOf(p.lock) === "none" ? "" : textOf(p.lock) || "small_key", box: p.startOpen === true ? null : { w, h }, ref });
        break;
      }
      case "Zelda: Place Item": {
        const item = textOf(p.item) || "key";
        if (at) items.push(PICKUPS[item] ? { kind: "sprite", sprite: PICKUPS[item], x: at.x, y: at.y, ref } : { kind: "label", x: at.x, y: at.y, label: item, ref });
        break;
      }
      case "Zelda: Set Respawn Point":
        if (at) items.push({ kind: "label", x: at.x, y: at.y, label: "respawn", ref });
        break;
      case "Zelda: Create Wave Room": {
        const area = areaOf(p.area);
        if (area) items.push({ kind: "area", x: area.x, y: area.y, w: area.width, h: area.height, label: "wave room", ref });
        const spawnAt = pointOf(p.spawnAt);
        if (spawnAt && textOf(p.spawnEnemy)) items.push(enemy(textOf(p.spawnEnemy), spawnAt, undefined, "after the waves", ref, 0.6));
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
        order.forEach((o, i) => items.push({ kind: "label", x: o.x, y: o.y - 12, label: String(i + 1), ref }));
        break;
      }
    }
  }
  return items;
}

/**
 * The editor route that opens an action's settings (`openActionConfig` in PS Maker 1.2.1:
 * /editor/<project>/maps/<map>/<action>?bc=root:<list>), from the current editor address.
 */
export function actionRoute(pathname: string, mapId: string, ref: ActionRef): string | null {
  const m = /^(.*?)\/editor\/([^/]+)\/maps(?:\/|$)/.exec(pathname);
  if (!m || !ref.root) return null;
  return `${m[1]}/editor/${m[2]}/maps/${encodeURIComponent(mapId)}/${encodeURIComponent(ref.id)}?bc=${encodeURIComponent(`root:${ref.root}`)}`;
}

// ---- drawing ----------------------------------------------------------------------------------

interface Overlay {
  scene: any;
  sig: string;
  objects: any[];
  collisions: any;
  selection: any;
  /** Picture bounds per action id (for the selection outline). */
  bounds: Map<string, { x: number; y: number; w: number; h: number }[]>;
}

/** Starts watching for an editor map (browser only; a reloaded plugin replaces the old watcher). */
export function startEditorPreview(win: any = globalThis): void {
  if (!win || typeof win.document === "undefined" || typeof win.setInterval !== "function") return;
  win[REGISTRY_KEY]?.stop?.();
  let overlay: Overlay | null = null;
  let failed = false;
  let selected = "";
  let lastClick = { id: "", at: 0 };
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
  const select = (id: string) => {
    selected = id;
    if (overlay) outline(overlay, selected);
  };
  const onClick = (ref: ActionRef) => {
    const now = Date.now();
    const twice = lastClick.id === ref.id && now - lastClick.at < DOUBLE_CLICK_MS;
    lastClick = { id: ref.id, at: now };
    select(ref.id);
    // Like the editor's own trigger previews: a click shows the action in the list, a double click opens it.
    revealRow(win, ref.id);
    if (twice && overlay) openAction(win, overlay.scene.map.id, ref);
  };
  const tick = () => {
    const scenes: any[] = win.game?.scene?.getScenes?.(true) ?? [];
    const scene = scenes.find((s) => s?.inEditorMode === true && s.map && s.add && s.textures);
    if (!scene) return clear();
    // An action opened from the list (its route) is selected on the map too.
    const opened = /\/maps\/[^/]+\/([^/?#]+)/.exec(win.location?.pathname ?? "")?.[1];
    if (opened && decodeURIComponent(opened) !== selected && zeldaActions(scene.map).some(({ action }) => action.id === decodeURIComponent(opened))) select(decodeURIComponent(opened));
    const sig = signature(scene.map);
    if (!overlay || overlay.scene !== scene || overlay.sig !== sig) {
      clear();
      overlay = draw(scene, sig, previewItems(scene.map, storyOf(scene)), onClick);
      outline(overlay, selected);
    }
    overlay.collisions.setVisible(editorShowsCollisions(scene));
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
  return JSON.stringify([map.id, zeldaActions(map).map(({ action: a, root }) => [a.id, root, a.actionName, a.pluginParams]), npcs.map((a) => [a.inGameCharacterId, a.position])]);
}

function storyOf(scene: any): PsStory | null {
  if (isStory(scene.story)) return scene.story;
  return findStory([
    { label: "scene.data", value: scene.sys?.settings?.data },
    { label: "scene", value: scene },
  ])?.story ?? null;
}

/** The editor's collision toggle, read from its own collision boxes (shown or hidden together). */
function editorShowsCollisions(scene: any): boolean {
  const own = (scene.collisions ?? []).find((c: any) => c && typeof c.visible === "boolean");
  if (own) return own.visible;
  const objectBox = (scene.inGameMapObjects ?? []).find((o: any) => o?.collisionBoxVisual)?.collisionBoxVisual;
  return objectBox ? objectBox.visible !== false : true;
}

/** Scrolls the event list to an action's row (PS Maker rows carry `data-action-id`). */
function revealRow(win: any, actionId: string): void {
  const doc = win.document;
  const esc = win.CSS?.escape ? win.CSS.escape(actionId) : actionId.replace(/["\\]/g, "\\$&");
  doc?.querySelector?.(`[data-action-id="${esc}"]`)?.scrollIntoView?.({ block: "nearest" });
}

/**
 * Opens an action's settings through the editor's router: a link inside the app, as if the author
 * had clicked one. If the router does not take it, the click is cancelled (no page reload).
 */
function openAction(win: any, mapId: string, ref: ActionRef): void {
  const doc = win.document;
  const href = actionRoute(win.location?.pathname ?? "", mapId, ref);
  if (!href || !doc?.createElement) return;
  const container = doc.body?.querySelector?.(':scope > div[style*="contents"]') ?? doc.body;
  const a = doc.createElement("a");
  a.href = href;
  a.style.display = "none";
  const guard = (e: any) => {
    if (e.target === a && !e.defaultPrevented) {
      e.preventDefault();
      win.console?.warn?.("[ZeldaMakerToolkit] could not open the action from the map; open it from the event list.");
    }
  };
  win.addEventListener?.("click", guard);
  container.appendChild(a);
  try {
    a.click();
  } finally {
    a.remove();
    win.removeEventListener?.("click", guard);
  }
}

/** A character's first standing frame and where its centre sits relative to the body. */
function lookFrame(scene: any, story: PsStory | null, ch: PsCharacter): { key: string; frame: string; dx: number; dy: number } | null {
  if (!story) return null;
  const set = ch.animationSets?.find((s) => s.id === ch.defaultAnimationSetId) ?? ch.animationSets?.[0];
  const anims = set?.animations ?? {};
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
  // In the game the body (collision box) stands on the picked point and the picture is offset.
  const box = characterBox(ch);
  const dx = box ? Math.round(sheet.frameWidth / 2 - (box.x + box.width / 2)) : 0;
  const dy = box ? Math.round(sheet.frameHeight / 2 - (box.y + box.height / 2)) : 0;
  return { key, frame, dx, dy };
}

function outline(o: Overlay, id: string): void {
  const g = o.selection;
  g.clear();
  for (const b of o.bounds.get(id) ?? []) g.lineStyle(1, 0xffe14a, 1).strokeRect(b.x - 1, b.y - 1, b.w + 2, b.h + 2);
}

function draw(scene: any, sig: string, items: PreviewItem[], onClick: (ref: ActionRef) => void): Overlay {
  const objects: any[] = [];
  const bounds = new Map<string, { x: number; y: number; w: number; h: number }[]>();
  const story = storyOf(scene);
  const clickable = (obj: any, ref: ActionRef | undefined, b: { x: number; y: number; w: number; h: number }) => {
    if (!ref) return;
    bounds.set(ref.id, [...(bounds.get(ref.id) ?? []), b]);
    obj.setInteractive?.({ useHandCursor: true });
    obj.on?.("pointerdown", () => onClick(ref));
  };
  const label = (x: number, y: number, text: string, ref?: ActionRef) => {
    if (!text) return;
    const t = scene.add.text(x, y, text, { fontFamily: "monospace", fontSize: "32px", color: "#ffffff", stroke: "#000000", strokeThickness: 6 });
    t.setOrigin(0.5, 1).setScale(0.18).setDepth(LABEL_DEPTH);
    objects.push(t);
    clickable(t, ref, { x: x - (t.displayWidth ?? 0) / 2, y: y - (t.displayHeight ?? 0), w: t.displayWidth ?? 0, h: t.displayHeight ?? 0 });
  };
  const g = scene.add.graphics();
  g.setDepth(LABEL_DEPTH - 1);
  const collisions = scene.add.graphics();
  collisions.setDepth(COLLISION_DEPTH);
  const selection = scene.add.graphics();
  selection.setDepth(LABEL_DEPTH + 1);
  objects.push(g, collisions, selection);
  for (const it of items) {
    if (it.kind === "sprite") {
      const frame = it.look ? lookFrame(scene, story, it.look) : null;
      const key = frame?.key ?? resolveTexture(scene.textures as TextureManagerLike, it.sprite);
      if (!key) continue;
      const img = scene.add.image(it.x + (frame?.dx ?? 0), it.y + (frame?.dy ?? 0), key, frame?.frame);
      if (it.w || it.h) img.setDisplaySize(it.w ?? img.width, it.h ?? img.height);
      img.setAlpha(it.alpha ?? 1).setDepth(it.y);
      objects.push(img);
      const w = img.displayWidth ?? 16;
      const h = img.displayHeight ?? 16;
      clickable(img, it.ref, { x: img.x - w / 2, y: img.y - h / 2, w, h });
      if (it.box) collisions.fillStyle(0xff0000, 0.5).fillRect(it.x - it.box.w / 2, it.y - it.box.h / 2, it.box.w, it.box.h);
      label(it.x, frame ? img.y - 11 : it.y - h / 2 - 1, it.label ?? "", it.ref);
    } else if (it.kind === "area") {
      g.lineStyle(1, 0xffa030, 0.9).strokeRect(it.x, it.y, it.w, it.h);
      g.fillStyle(0xffa030, 0.08).fillRect(it.x, it.y, it.w, it.h);
      label(it.x + it.w / 2, it.y + 8, it.label, it.ref);
      if (it.ref) bounds.set(it.ref.id, [...(bounds.get(it.ref.id) ?? []), { x: it.x, y: it.y, w: it.w, h: it.h }]);
    } else if (it.kind === "path") {
      g.lineStyle(1, 0xffe14a, 0.9);
      g.beginPath();
      it.points.forEach((pt, i) => (i ? g.lineTo(pt.x, pt.y) : g.moveTo(pt.x, pt.y)));
      g.strokePath();
    } else if (it.kind === "link") {
      g.lineStyle(1, 0x5ad8ff, 0.8).lineBetween(it.from.x, it.from.y, it.to.x, it.to.y);
    } else {
      label(it.x, it.y, it.label, it.ref);
    }
  }
  return { scene, sig, objects, collisions, selection, bounds };
}
