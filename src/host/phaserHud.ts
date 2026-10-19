import type { ToolkitConfig } from "../core/config.ts";
import type { Logger } from "../core/logger.ts";
import type { HudModel, HudSink } from "./types.ts";
import { resolveTexture } from "./textures.ts";

export const HUD_SCENE_KEY = "ZeldaMakerToolkitHUD";

const PAD = 4;
const HUDS = new WeakMap<object, PhaserHud>();

/** One HUD per Phaser game, reused across maps (avoids duplicate HUD objects). */
export function getHud(game: any, cfg: ToolkitConfig, logger: Logger): PhaserHud {
  let hud = HUDS.get(game);
  if (!hud) {
    hud = new PhaserHud(game, cfg, logger);
    HUDS.set(game, hud);
  }
  return hud;
}
const HEARTS_PER_ROW = 10;

/**
 * HUD drawn in its own small Phaser scene on top of PS Maker's scenes, so map
 * camera zoom/effects do not affect it (PS Maker 0.20 also moved its UI to a
 * separate scene). Uses the same Phaser renderer; objects are pooled and only
 * updated when the model changes.
 */
export class PhaserHud implements HudSink {
  private readonly game: any;
  private readonly cfg: ToolkitConfig;
  private readonly logger: Logger;
  private scene: any = null;
  private pending: HudModel | null = null;
  private visible = true;
  private hearts: any[] = [];
  private magicBar: any = null;
  private slotBg: any = null;
  private slotIcon: any = null;
  private slotCount: any = null;
  private counterIcons: any[] = [];
  private counterTexts: any[] = [];
  private messageTexts: any[] = [];
  private panelBg: any = null;
  private panelTitle: any = null;
  private panelIcons: any[] = [];
  private panelDesc: any = null;
  private deathText: any = null;

  /** Use getHud(); direct construction would duplicate the HUD scene. */
  constructor(game: any, cfg: ToolkitConfig, logger: Logger) {
    this.game = game;
    this.cfg = cfg;
    this.logger = logger;
    this.ensureScene();
  }

  private ensureScene(): void {
    const mgr = this.game.scene;
    if (mgr.getScene?.(HUD_SCENE_KEY)) {
      this.logger.warn(`A scene named "${HUD_SCENE_KEY}" already exists; the toolkit HUD is disabled.`);
      return;
    }
    const self = this;
    try {
      mgr.add(
        HUD_SCENE_KEY,
        {
          key: HUD_SCENE_KEY,
          active: true,
          create(this: any) {
            self.scene = this;
            self.build();
            if (self.pending) self.render(self.pending);
            self.applyVisible();
          },
        },
        true,
      );
      mgr.bringToTop?.(HUD_SCENE_KEY);
    } catch (err) {
      this.logger.error("Could not create the HUD scene:", err);
    }
  }

  private build(): void {
    const s = this.scene;
    for (const list of [this.hearts, this.counterIcons, this.counterTexts, this.messageTexts, this.panelIcons]) {
      for (const o of list) o.destroy?.();
      list.length = 0;
    }
    for (const o of [this.magicBar, this.slotBg, this.slotIcon, this.slotCount, this.panelBg, this.panelTitle, this.panelDesc, this.deathText]) o?.destroy?.();
    this.magicBar = s.add.graphics();
    this.slotBg = s.add.image(0, 0, resolveTexture(s.textures, "hud_slot")).setOrigin(0, 0);
    this.slotIcon = s.add.image(0, 0, resolveTexture(s.textures, "icon_generic")).setOrigin(0.5, 0.5);
    this.slotCount = this.text("", 8);
    this.panelBg = s.add.graphics();
    this.panelTitle = this.text("", 10);
    this.panelDesc = this.text("", 8);
    this.deathText = this.text("", 12);
  }

  private text(value: string, size: number): any {
    return this.scene.add
      .text(0, 0, value, {
        fontFamily: this.cfg.ui.fontFamily,
        fontSize: `${size}px`,
        color: "#ffffff",
        stroke: "#000000",
        strokeThickness: 2,
      })
      .setOrigin(0, 0);
  }

  private scale(model: HudModel): number {
    if (model.scale > 0) return model.scale;
    const h = this.game.scale?.height ?? this.game.config?.height ?? 240;
    return Math.max(1, Math.round(h / 240));
  }

  render(model: HudModel): void {
    this.pending = model;
    if (!this.scene || !this.scene.sys?.displayList) return;
    const s = this.scene;
    const k = this.scale(model);
    const W = this.game.scale?.width ?? 320;
    const H = this.game.scale?.height ?? 240;
    const right = model.position.endsWith("right");
    const bottom = model.position.startsWith("bottom");
    const ox = right ? W - PAD * k : PAD * k;
    const oy = bottom ? H - 60 * k : PAD * k;
    const dir = right ? -1 : 1;
    let cursorY = oy;

    // Item slot.
    const slot = model.activeItem;
    this.slotBg.setVisible(!!slot).setScale(k).setPosition(right ? ox - 20 * k : ox, cursorY);
    this.slotIcon.setVisible(!!slot);
    this.slotCount.setVisible(!!slot && slot.count !== null);
    let x0 = ox;
    if (slot) {
      const key = resolveTexture(s.textures, slot.icon) ?? resolveTexture(s.textures, "icon_generic");
      this.slotIcon.setTexture(key).setScale(k).setPosition((right ? ox - 10 * k : ox + 10 * k), cursorY + 10 * k);
      if (slot.count !== null) this.slotCount.setText(String(slot.count)).setScale(k).setPosition(right ? ox - 20 * k : ox + 12 * k, cursorY + 13 * k);
      x0 = ox + dir * 24 * k;
    }

    // Hearts.
    const heartCount = Math.ceil(model.maxHp / model.heartValue);
    for (let i = 0; i < Math.max(heartCount, this.hearts.length); i++) {
      let img = this.hearts[i];
      if (i >= heartCount || !model.showHearts) {
        img?.setVisible(false);
        continue;
      }
      if (!img) {
        img = s.add.image(0, 0, resolveTexture(s.textures, "hud_heart_full")).setOrigin(right ? 1 : 0, 0);
        this.hearts.push(img);
      }
      const value = Math.max(0, Math.min(model.heartValue, model.hp - i * model.heartValue));
      const tex = value >= model.heartValue ? "hud_heart_full" : value > 0 ? "hud_heart_half" : "hud_heart_empty";
      img.setTexture(resolveTexture(s.textures, tex)).setScale(k).setVisible(true);
      img.setPosition(x0 + dir * (i % HEARTS_PER_ROW) * 9 * k, cursorY + Math.floor(i / HEARTS_PER_ROW) * 9 * k);
    }
    let rowY = cursorY + (model.showHearts ? (Math.floor((heartCount - 1) / HEARTS_PER_ROW) + 1) * 9 * k + 2 * k : 0);

    // Magic bar.
    this.magicBar.clear();
    if (model.showMagic) {
      const w = 48 * k;
      const bx = right ? x0 - w : x0;
      this.magicBar.fillStyle(0x000000, 0.8).fillRect(bx, rowY, w, 4 * k);
      this.magicBar.fillStyle(0x3ad16b, 1).fillRect(bx + k, rowY + k, (w - 2 * k) * (model.maxMagic > 0 ? model.magic / model.maxMagic : 0), 2 * k);
      rowY += 6 * k;
    }

    // Counters.
    for (let i = 0; i < Math.max(model.counters.length, this.counterIcons.length); i++) {
      const c = model.counters[i];
      if (!c) {
        this.counterIcons[i]?.setVisible(false);
        this.counterTexts[i]?.setVisible(false);
        continue;
      }
      if (!this.counterIcons[i]) {
        this.counterIcons[i] = s.add.image(0, 0, resolveTexture(s.textures, "icon_generic")).setOrigin(0, 0);
        this.counterTexts[i] = this.text("", 8);
      }
      const cx = right ? x0 - (i + 1) * 26 * k : x0 + i * 26 * k;
      this.counterIcons[i].setTexture(resolveTexture(s.textures, c.icon) ?? resolveTexture(s.textures, "icon_generic")).setScale(k * 0.7).setPosition(cx, rowY).setVisible(true);
      this.counterTexts[i].setText(String(c.value)).setScale(k).setPosition(cx + 10 * k, rowY).setVisible(true);
    }
    rowY += 12 * k;

    // Messages (bottom center).
    for (let i = 0; i < Math.max(model.messages.length, this.messageTexts.length); i++) {
      const m = model.messages[i];
      if (!m) {
        this.messageTexts[i]?.setVisible(false);
        continue;
      }
      if (!this.messageTexts[i]) this.messageTexts[i] = this.text("", 9).setOrigin(0.5, 1);
      const t = this.messageTexts[i];
      t.setText(m.text).setScale(k).setVisible(true);
      t.setPosition(W / 2, H - PAD * k - (model.messages.length - 1 - i) * 12 * k);
      t.setAlpha(Math.min(1, m.remainingMs / 300));
    }

    this.deathText.setVisible(model.dead).setText(model.deathText).setScale(k).setOrigin(0.5, 0.5).setPosition(W / 2, H / 2);
    this.renderPanel(model, k, W, H);
  }

  private renderPanel(model: HudModel, k: number, W: number, H: number): void {
    const s = this.scene;
    const open = model.inventoryOpen;
    this.panelBg.clear();
    this.panelTitle.setVisible(open);
    this.panelDesc.setVisible(open);
    for (const icon of this.panelIcons) icon.setVisible(false);
    if (!open) return;
    const pw = Math.min(W - 16 * k, 200 * k);
    const ph = 110 * k;
    const px = (W - pw) / 2;
    const py = (H - ph) / 2;
    this.panelBg.fillStyle(0x10102a, 0.92).fillRect(px, py, pw, ph);
    this.panelBg.lineStyle(k, 0xf0e6c8, 1).strokeRect(px, py, pw, ph);
    this.panelTitle.setText(model.inventoryTitle).setScale(k).setPosition(px + 6 * k, py + 4 * k);
    const perRow = Math.max(1, Math.floor((pw - 12 * k) / (22 * k)));
    let desc = "";
    model.inventory.forEach((slot, i) => {
      let icon = this.panelIcons[i];
      if (!icon) {
        icon = s.add.image(0, 0, resolveTexture(s.textures, "icon_generic")).setOrigin(0, 0);
        this.panelIcons.push(icon);
      }
      const ix = px + 6 * k + (i % perRow) * 22 * k;
      const iy = py + 18 * k + Math.floor(i / perRow) * 22 * k;
      icon.setTexture(resolveTexture(s.textures, slot.icon) ?? resolveTexture(s.textures, "icon_generic")).setScale(k).setPosition(ix, iy).setVisible(true);
      if (slot.selected) {
        this.panelBg.lineStyle(k, 0xffd23a, 1).strokeRect(ix - k, iy - k, 18 * k, 18 * k);
        desc = `${slot.name}${slot.count !== null ? ` (${slot.count})` : ""}\n${slot.description}`;
      }
    });
    this.panelDesc.setText(desc).setScale(k).setPosition(px + 6 * k, py + ph - 30 * k).setWordWrapWidth((pw - 12 * k) / k);
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    if (visible) this.game.scene?.bringToTop?.(HUD_SCENE_KEY);
    this.applyVisible();
  }

  private applyVisible(): void {
    this.scene?.sys?.setVisible?.(this.visible);
  }
}
