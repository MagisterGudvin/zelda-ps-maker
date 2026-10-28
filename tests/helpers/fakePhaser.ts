/**
 * Just enough of Phaser's surface to drive PhaserHost/actions without a
 * browser: event emitters with listener counting and chainable no-op game
 * objects. Real-Phaser behavior is covered by tests/integration (Chromium).
 */
export class FakeEmitter {
  private readonly map = new Map<string, Set<(...a: any[]) => void>>();
  on(event: string, fn: (...a: any[]) => void): this {
    if (!this.map.has(event)) this.map.set(event, new Set());
    this.map.get(event)!.add(fn);
    return this;
  }
  once(event: string, fn: (...a: any[]) => void): this {
    const wrap = (...a: any[]) => {
      this.off(event, wrap);
      fn(...a);
    };
    (wrap as any).inner = fn;
    return this.on(event, wrap);
  }
  off(event: string, fn: (...a: any[]) => void): this {
    const set = this.map.get(event);
    if (!set) return this;
    for (const f of set) if (f === fn || (f as any).inner === fn) set.delete(f);
    return this;
  }
  emit(event: string, ...args: any[]): void {
    for (const f of [...(this.map.get(event) ?? [])]) f(...args);
  }
  count(event?: string): number {
    if (event) return this.map.get(event)?.size ?? 0;
    let n = 0;
    for (const s of this.map.values()) n += s.size;
    return n;
  }
}

/** Universal chainable stub: any method returns the stub itself. */
export function chainable(extra: Record<string, unknown> = {}): any {
  const target: Record<string, unknown> = { visible: true, ...extra };
  const proxy: any = new Proxy(target, {
    get(t, k: string) {
      if (k in t) return t[k];
      if (k === "then") return undefined;
      return (..._args: unknown[]) => proxy;
    },
    set(t, k: string, v) {
      t[k] = v;
      return true;
    },
  });
  return proxy;
}

export function createFakeScene() {
  const created: any[] = [];
  const textures = new Set<string>();
  const make = () => {
    const o = chainable({ destroyed: false });
    o.destroy = () => {
      o.destroyed = true;
    };
    created.push(o);
    return o;
  };
  const events = new FakeEmitter();
  const keyboard = new FakeEmitter();
  const gameEvents = new FakeEmitter();
  const scenes = new Map<string, any>();
  const player = chainable({ x: 100, y: 100, displayWidth: 16, displayHeight: 16, active: true, body: null });
  const scene: any = {
    sys: { settings: { key: "GameMap" } },
    events,
    input: { keyboard },
    textures: {
      exists: (k: string) => textures.has(k),
      createCanvas: (k: string) => {
        textures.add(k);
        return { context: chainable(), refresh: () => {} };
      },
    },
    add: { image: make, graphics: make, text: make },
    children: { list: [] as any[] },
    // GameMap.NPCs: the map's NPC sprites (each with its inGameCharacterId).
    NPCs: [] as any[],
    physics: null,
  };
  const game: any = {
    events: gameEvents,
    scale: { width: 320, height: 240 },
    scene: {
      getScene: (k: string) => scenes.get(k) ?? null,
      add: (k: string, cfg: any) => {
        const hudScene: any = { sys: { displayList: {}, setVisible: () => {} }, add: scene.add, textures: scene.textures };
        scenes.set(k, hudScene);
        cfg.create.call(hudScene);
        return hudScene;
      },
      bringToTop: () => {},
    },
  };
  scene.game = game;
  return { scene, game, player, events, keyboard, gameEvents, created, textures };
}
