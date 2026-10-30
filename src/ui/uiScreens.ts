import type { Session } from "../core/session.ts";
import { isShown, layoutBoxes, moveInGrid, nextButton, type ButtonElement, type InventoryElement, type ScreenRole, type UiLayout } from "./uiLayout.ts";

/** A message shown in the message screen: its pages, the page on screen and when it began typing. */
interface MessageState {
  pages: string[];
  page: number;
  startedAt: number;
  /** The page shows whole (a key pressed while it typed). */
  whole: boolean;
  done: () => void;
}

interface Open {
  name: string;
  focus: string;
  /** Inventory screens: the cell under the cursor. */
  cursor: number;
  message: MessageState | null;
}

/**
 * UI screens: layouts with a name (Zelda: UI Layout) opened over the game by Zelda: Open UI
 * Screen, a button or by their role. A screen's role says what opens it: the pause menu opens and
 * closes with the Menu key (Escape), the inventory with the inventory key (I), the message screen
 * shows toolkit messages, the title screen hides the HUD and no key closes it. Arrow keys move the
 * selection between the buttons (on an inventory screen, the cursor in the item grid), the action
 * key or a click presses one, the sword or inventory key (or Menu) goes back. A screen opened from
 * another goes back to it. Runs while the game is paused, like the inventory panel. A screen that
 * does not take the keys is a layer over the HUD (a boss bar, a notice): the game plays on under it
 * until it is closed by name.
 */
export class UiScreenSystem {
  readonly name = "screens";
  private readonly s: Session;
  private readonly stack: Open[] = [];
  private readonly layerNames: string[] = [];
  private readonly offPointer: () => void;
  private readonly offMenuKeys: () => void;

  constructor(session: Session) {
    this.s = session;
    this.offPointer = session.host.hud?.setScreenPointer?.((type, x, y) => this.pointer(type, x, y)) ?? (() => {});
    // Escape (the Menu key) belongs to PS Maker's options menu unless a screen wants it.
    this.offMenuKeys = session.host.claimMenuKeys?.(() => this.wantsMenuKey()) ?? (() => {});
  }

  /** The open screen (the top one), or null. */
  get current(): { name: string; layout: UiLayout; focus: string; cursor: number } | null {
    const top = this.stack.at(-1);
    const layout = top ? this.s.toolkit.uiScreens.get(top.name) : undefined;
    return top && layout ? { name: top.name, layout, focus: top.focus, cursor: top.cursor } : null;
  }

  /** Open layers (screens that do not take the keys), oldest first. */
  get layers(): { name: string; layout: UiLayout }[] {
    return this.layerNames.flatMap((name) => {
      const layout = this.s.toolkit.uiScreens.get(name);
      return layout ? [{ name, layout }] : [];
    });
  }

  /** The project's screen with this role (the first one made), or null. */
  withRole(role: ScreenRole): string | null {
    for (const [name, layout] of this.s.toolkit.uiScreens) if (layout.screen.role === role) return name;
    return null;
  }

  /** True while a title screen is open (the HUD is hidden). */
  get titleOpen(): boolean {
    return this.stack.some((t) => this.s.toolkit.uiScreens.get(t.name)?.screen.role === "title");
  }

  /**
   * The Menu key is the toolkit's now: a screen is open (it goes back), or the pause menu can open
   * (the game runs, no dialogue). Otherwise PS Maker opens its options menu on Escape as usual.
   */
  wantsMenuKey(): boolean {
    const cur = this.current;
    if (cur) return cur.layout.screen.role !== "title";
    return this.withRole("menu") !== null && !this.s.isPaused() && !this.s.host.isDialogueOpen?.();
  }

  open(name: string): boolean {
    const layout = this.s.toolkit.uiScreens.get(name);
    if (!layout) {
      this.s.logger.warnOnce(`screen-${name}`, `UI screen "${name}" is not defined (Zelda: UI Layout with this screen name, run before).`);
      return false;
    }
    if (!layout.screen.input && layout.screen.role === "none") {
      if (!this.layerNames.includes(name)) this.layerNames.push(name);
      this.s.hud?.markDirty();
      this.s.bus.emit("zelda:ui:screen", { name, open: true });
      return true;
    }
    if (this.current?.name === name) return true;
    this.stack.push({ name, focus: this.buttons(layout)[0]?.id ?? "", cursor: this.startCursor(layout), message: null });
    this.sound(layout.screen.soundOpen);
    this.changed(name, true);
    return true;
  }

  /**
   * Shows a message in a message screen: one page per paragraph (a blank line), typed out at the
   * screen's speed. Resolves when the player closed the last page.
   */
  showMessage(name: string, text: string): Promise<void> | null {
    const layout = this.s.toolkit.uiScreens.get(name);
    if (!layout) return null;
    const pages = text.split(/\n\s*\n/).map((p) => p.trim()).filter((p) => p);
    return new Promise<void>((resolve) => {
      const message: MessageState = { pages: pages.length ? pages : [""], page: 0, startedAt: this.now(), whole: false, done: resolve };
      const i = this.stack.findIndex((t) => t.name === name);
      if (i >= 0) {
        this.stack[i].message?.done();
        this.stack[i].message = message;
        this.s.hud?.markDirty();
        return;
      }
      this.stack.push({ name, focus: "", cursor: 0, message });
      this.sound(layout.screen.soundOpen);
      this.changed(name, true);
    });
  }

  /** The message screen's text as shown now (typed so far), and whether it waits for a key. */
  messageView(): { text: string; ready: boolean; more: boolean } {
    const top = [...this.stack].reverse().find((t) => t.message);
    const m = top?.message;
    if (!m) return { text: "", ready: false, more: false };
    const page = m.pages[m.page];
    const typing = this.s.toolkit.uiScreens.get(top.name)?.screen.typing ?? 0;
    const shown = m.whole || typing <= 0 ? page.length : Math.floor(((this.now() - m.startedAt) / 1000) * typing);
    const ready = shown >= page.length;
    return { text: ready ? page : page.slice(0, shown), ready, more: m.page < m.pages.length - 1 };
  }

  /** Closes a screen or layer by name, else the top screen (back to the one under it); `all` closes every screen and layer. */
  close(all = false, name = ""): void {
    if (all) {
      for (const n of this.layerNames.splice(0)) this.s.bus.emit("zelda:ui:screen", { name: n, open: false });
      this.s.hud?.markDirty();
    } else if (name && this.layerNames.includes(name)) {
      this.layerNames.splice(this.layerNames.indexOf(name), 1);
      this.s.hud?.markDirty();
      this.s.bus.emit("zelda:ui:screen", { name, open: false });
      return;
    }
    if (this.stack.length === 0) return;
    let closed: Open[];
    if (all) closed = this.stack.splice(0);
    else if (name) {
      const i = this.stack.findIndex((t) => t.name === name);
      if (i < 0) return;
      closed = this.stack.splice(i);
    } else closed = [this.stack.pop()!];
    this.sound(this.s.toolkit.uiScreens.get(closed[0].name)?.screen.soundClose ?? "");
    for (const t of closed.reverse()) {
      t.message?.done();
      this.changed(t.name, false);
    }
  }

  private now(): number {
    return this.s.tick * (1000 / this.s.config.world.fixedStepHz);
  }

  private sound(id: string): void {
    if (id) this.s.host.playSound(id, 1);
  }

  private changed(name: string, open: boolean): void {
    const pause = this.stack.some((t) => this.s.toolkit.uiScreens.get(t.name)?.screen.pause !== false);
    this.s.setPaused("screen", pause);
    if (pause) this.s.player.lock("screen");
    else this.s.player.unlock("screen");
    // The key that opened or closed the screen must not also swing the sword or open a chest.
    this.s.host.input.reset();
    this.s.hud?.markDirty();
    this.s.bus.emit("zelda:ui:screen", { name, open });
  }

  /** Buttons of a layout a player can press now (shown), in layout order. */
  private buttons(layout: UiLayout): ButtonElement[] {
    const values = this.s.hud?.values(layout) ?? {};
    return layout.elements.filter((e): e is ButtonElement => e.type === "button" && isShown(e, values));
  }

  private boxes(layout: UiLayout) {
    const view = this.s.host.hud?.viewSize?.(layout) ?? { w: 320, h: 180 };
    return layoutBoxes(layout, view.w, view.h);
  }

  /** The first item grid of a layout (an inventory screen's), or null. */
  private grid(layout: UiLayout): InventoryElement | null {
    return layout.elements.find((e): e is InventoryElement => e.type === "inventory") ?? null;
  }

  /** The items an inventory grid shows: the owned items the toolkit knows, in the order they were got. */
  gridItems(): string[] {
    return this.s.state.inventory.owned.filter((id) => this.s.toolkit.items.has(id));
  }

  /** The item under the inventory cursor of the open screen, or null. */
  cursorItem(): string | null {
    const cur = this.current;
    if (!cur || !this.grid(cur.layout)) return null;
    return this.gridItems()[cur.cursor] ?? null;
  }

  private startCursor(layout: UiLayout): number {
    if (!this.grid(layout)) return 0;
    return Math.max(0, this.gridItems().indexOf(this.s.state.inventory.activeItem ?? ""));
  }

  tick(): void {
    const input = this.s.host.input;
    const cur = this.current;
    if (!cur) {
      if (input.pressed("menu") && !this.s.isPaused()) {
        const menu = this.withRole("menu");
        if (menu) this.open(menu);
      }
      return;
    }
    // PS Maker's dialogue (from a button's event) has the keys until it closes.
    if (this.s.host.isDialogueOpen?.()) return;
    const top = this.stack.at(-1)!;
    const role = cur.layout.screen.role;
    if (top.message) {
      if (this.s.tick % 2 === 0) this.s.hud?.markDirty();
      if (input.pressed("action") || input.pressed("sword") || input.pressed("menu")) this.nextPage(top);
      return;
    }
    const grid = this.grid(cur.layout);
    const ids = this.buttons(cur.layout).map((b) => b.id);
    if (!ids.includes(top.focus)) top.focus = ids[0] ?? "";
    for (const dir of ["up", "down", "left", "right"] as const) {
      if (!input.pressed(dir)) continue;
      if (grid) {
        const next = moveInGrid(top.cursor, this.gridItems().length, grid.cols, dir);
        if (next !== top.cursor) this.moved(cur.layout, () => (top.cursor = next));
        continue;
      }
      if (!top.focus) continue;
      const next = nextButton(this.boxes(cur.layout), ids, top.focus, dir);
      if (next !== top.focus) this.moved(cur.layout, () => (top.focus = next));
    }
    if (input.pressed("action") && grid) this.takeItem(top.cursor);
    else if (input.pressed("action") && top.focus) this.press(top.focus);
    else if (role !== "title" && (input.pressed("sword") || input.pressed("inventory") || input.pressed("menu"))) this.close();
  }

  private moved(layout: UiLayout, apply: () => void): void {
    apply();
    this.sound(layout.screen.soundMove);
    this.s.hud?.markDirty();
  }

  /** A key on a message page: shows the whole page, else the next page, else closes the message. */
  private nextPage(top: Open): void {
    const m = top.message!;
    if (!this.messageView().ready) m.whole = true;
    else if (m.page < m.pages.length - 1) {
      m.page++;
      m.startedAt = this.now();
      m.whole = false;
    } else {
      this.close(false, top.name);
      return;
    }
    this.s.host.input.reset();
    this.s.hud?.markDirty();
  }

  /** Takes the item of an inventory cell in hand (items used from the item button only). */
  private takeItem(index: number): void {
    const cur = this.current!;
    const id = this.gridItems()[index];
    if (!id) return;
    if (this.s.toolkit.inventory.equip(id)) this.sound(cur.layout.screen.soundPress);
    this.s.hud?.markDirty();
  }

  /** A pointer over the HUD (layout pixels of the open screen): hover selects, a click presses. */
  private pointer(type: "move" | "down", x: number, y: number): void {
    const cur = this.current;
    if (!cur || this.s.host.isDialogueOpen?.()) return;
    const top = this.stack.at(-1)!;
    if (top.message) {
      if (type === "down") this.nextPage(top);
      return;
    }
    const boxes = this.boxes(cur.layout);
    const inside = (r: { x: number; y: number; w: number; h: number } | undefined) => !!r && x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
    const grid = this.grid(cur.layout);
    if (grid && inside(boxes[grid.id])) {
      const r = boxes[grid.id];
      const step = grid.cell + grid.gap;
      const col = Math.floor((x - r.x) / step);
      const row = Math.floor((y - r.y) / step);
      const i = row * grid.cols + col;
      if (col >= grid.cols || (x - r.x) % step >= grid.cell || (y - r.y) % step >= grid.cell || i >= this.gridItems().length) return;
      if (top.cursor !== i) this.moved(cur.layout, () => (top.cursor = i));
      if (type === "down") this.takeItem(i);
      return;
    }
    const hit = this.buttons(cur.layout)
      .reverse()
      .find((b) => inside(boxes[b.id]));
    if (!hit) return;
    if (top.focus !== hit.id) {
      top.focus = hit.id;
      if (type === "move") this.sound(cur.layout.screen.soundMove);
      this.s.hud?.markDirty();
    }
    if (type === "down") this.press(hit.id);
  }

  /** Does what a button says. */
  press(id: string): void {
    const cur = this.current;
    const b = cur?.layout.elements.find((e): e is ButtonElement => e.id === id && e.type === "button");
    if (!cur || !b) return;
    this.s.bus.emit("zelda:ui:button", { screen: cur.name, id });
    this.sound(cur.layout.screen.soundPress);
    const a = b.action;
    switch (a.kind) {
      case "event":
        if (!a.id || !this.s.host.runStoryEvent?.(a.id)) this.s.logger.warnOnce(`event-${a.id}`, `Button "${id}": the PS Maker event "${a.id}" could not be run.`);
        break;
      case "open":
        this.open(a.id);
        break;
      case "close":
        this.close();
        break;
      case "variable":
        if (!a.id || !this.s.host.setVariable?.(a.id, a.value)) this.s.logger.warnOnce(`var-${a.id}`, `Button "${id}": no project variable "${a.id}".`);
        this.s.hud?.markDirty();
        break;
    }
  }

  dispose(): void {
    this.offPointer();
    this.offMenuKeys();
    this.layerNames.length = 0;
    for (const t of this.stack) t.message?.done();
    if (this.stack.length) {
      this.stack.length = 0;
      this.s.setPaused("screen", false);
      this.s.player.unlock("screen");
    }
  }
}
