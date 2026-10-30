import type { Session } from "../core/session.ts";
import { isShown, layoutBoxes, nextButton, type ButtonElement, type UiLayout } from "./uiLayout.ts";

/**
 * UI screens: layouts with a name (Zelda: UI Layout) opened over the game by Zelda: Open UI
 * Screen, a button or the Menu key. Arrow keys move the selection between the buttons, the action
 * key or a click presses one, the sword or inventory key (or Menu, for the menu screen) goes back.
 * A screen opened from another goes back to it. Runs while the game is paused, like the
 * inventory panel. A screen that does not take the keys is a layer over the HUD (a boss bar, a
 * notice): the game plays on under it until it is closed by name.
 */
export class UiScreenSystem {
  readonly name = "screens";
  private readonly s: Session;
  private readonly stack: { name: string; focus: string }[] = [];
  private readonly layerNames: string[] = [];
  private readonly offPointer: () => void;

  constructor(session: Session) {
    this.s = session;
    this.offPointer = session.host.hud?.setScreenPointer?.((type, x, y) => this.pointer(type, x, y)) ?? (() => {});
  }

  /** The open screen (the top one), or null. */
  get current(): { name: string; layout: UiLayout; focus: string } | null {
    const top = this.stack.at(-1);
    const layout = top ? this.s.toolkit.uiScreens.get(top.name) : undefined;
    return top && layout ? { name: top.name, layout, focus: top.focus } : null;
  }

  /** Open layers (screens that do not take the keys), oldest first. */
  get layers(): { name: string; layout: UiLayout }[] {
    return this.layerNames.flatMap((name) => {
      const layout = this.s.toolkit.uiScreens.get(name);
      return layout ? [{ name, layout }] : [];
    });
  }

  open(name: string): boolean {
    const layout = this.s.toolkit.uiScreens.get(name);
    if (!layout) {
      this.s.logger.warnOnce(`screen-${name}`, `UI screen "${name}" is not defined (Zelda: UI Layout with this screen name, run before).`);
      return false;
    }
    if (!layout.screen.input) {
      if (!this.layerNames.includes(name)) this.layerNames.push(name);
      this.s.hud?.markDirty();
      this.s.bus.emit("zelda:ui:screen", { name, open: true });
      return true;
    }
    if (this.current?.name === name) return true;
    this.stack.push({ name, focus: this.buttons(layout)[0]?.id ?? "" });
    this.sound(layout.screen.soundOpen);
    this.changed(name, true);
    return true;
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
    let closed: string[];
    if (all) closed = this.stack.splice(0).map((t) => t.name);
    else if (name) {
      const i = this.stack.findIndex((t) => t.name === name);
      if (i < 0) return;
      closed = this.stack.splice(i).map((t) => t.name);
    } else closed = [this.stack.pop()!.name];
    this.sound(this.s.toolkit.uiScreens.get(closed[0])?.screen.soundClose ?? "");
    for (const n of closed.reverse()) this.changed(n, false);
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

  tick(): void {
    const input = this.s.host.input;
    const cur = this.current;
    if (!cur) {
      if (input.pressed("menu") && !this.s.isPaused()) {
        const menu = [...this.s.toolkit.uiScreens].find(([, l]) => l.screen.menuKey);
        if (menu) this.open(menu[0]);
      }
      return;
    }
    // PS Maker's dialogue (from a button's event) has the keys until it closes.
    if (this.s.host.isDialogueOpen?.()) return;
    const top = this.stack.at(-1)!;
    const ids = this.buttons(cur.layout).map((b) => b.id);
    if (!ids.includes(top.focus)) top.focus = ids[0] ?? "";
    for (const dir of ["up", "down", "left", "right"] as const) {
      if (!input.pressed(dir) || !top.focus) continue;
      const next = nextButton(this.boxes(cur.layout), ids, top.focus, dir);
      if (next !== top.focus) {
        top.focus = next;
        this.sound(cur.layout.screen.soundMove);
        this.s.hud?.markDirty();
      }
    }
    if (input.pressed("action") && top.focus) this.press(top.focus);
    else if (input.pressed("sword") || input.pressed("inventory") || (input.pressed("menu") && cur.layout.screen.menuKey)) this.close();
  }

  /** A pointer over the HUD (layout pixels of the open screen): hover selects, a click presses. */
  private pointer(type: "move" | "down", x: number, y: number): void {
    const cur = this.current;
    if (!cur || this.s.host.isDialogueOpen?.()) return;
    const boxes = this.boxes(cur.layout);
    const hit = this.buttons(cur.layout)
      .reverse()
      .find((b) => {
        const r = boxes[b.id];
        return r && x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
      });
    if (!hit) return;
    const top = this.stack.at(-1)!;
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
    this.layerNames.length = 0;
    if (this.stack.length) {
      this.stack.length = 0;
      this.s.setPaused("screen", false);
      this.s.player.unlock("screen");
    }
  }
}
