import type { SheetDef } from "../core/animation.ts";
import type { Logger } from "../core/logger.ts";

export interface FrameRef {
  key: string;
  frame: string;
}

/**
 * Turns author images into sprite-sheet frames. An image that is already a
 * loaded texture (e.g. a PS Maker asset) is sliced in place by adding named
 * frames; a URL / data URI is loaded first. Frames are named
 * `zmt_<w>x<h>_<index>` so one image can be cut with different grids.
 */
export class SheetLibrary {
  private readonly scene: any;
  private readonly logger: Logger;
  private readonly loading = new Set<string>();
  private readonly failed = new Set<string>();
  private readonly sliced = new Set<string>();

  constructor(scene: any, logger: Logger) {
    this.scene = scene;
    this.logger = logger;
  }

  static frameName(def: SheetDef, index: number): string {
    return `zmt_${def.frameWidth}x${def.frameHeight}_${index}`;
  }

  /** Texture key for a sheet, or null while it is loading / unavailable. */
  textureKey(id: string, def: SheetDef): string | null {
    const textures = this.scene.textures;
    if (textures.exists(def.image)) return def.image;
    const key = `zmt_sheet_${id}`;
    if (textures.exists(key)) return key;
    this.load(id, def, key);
    return null;
  }

  private load(id: string, def: SheetDef, key: string): void {
    if (this.loading.has(key) || this.failed.has(key)) return;
    const url = def.image;
    if (!/^(data:|blob:|https?:|\/|\.{0,2}\/)|\.(png|webp|gif|jpe?g)(\?.*)?$/i.test(url)) {
      this.failed.add(key);
      this.logger.warn(`Sprite sheet "${id}": "${url}" is neither a loaded texture key nor an image URL.`);
      return;
    }
    const loader = this.scene.load;
    if (!loader) return;
    this.loading.add(key);
    loader.once(`filecomplete-image-${key}`, () => {
      this.loading.delete(key);
      this.logger.info(`Sprite sheet "${id}" loaded.`);
    });
    loader.once("loaderror", (file: { key?: string }) => {
      if (file?.key !== key) return;
      this.loading.delete(key);
      this.failed.add(key);
      this.logger.warn(`Sprite sheet "${id}": could not load "${url}".`);
    });
    loader.image(key, url);
    if (!loader.isLoading?.()) loader.start();
  }

  /** Frame reference for `index`, slicing the texture on first use. */
  frame(id: string, def: SheetDef, index: number): FrameRef | null {
    const key = this.textureKey(id, def);
    if (!key) return null;
    const texture = this.scene.textures.get(key);
    const name = SheetLibrary.frameName(def, index);
    const gridKey = `${key}|${def.frameWidth}x${def.frameHeight}|${def.margin ?? 0}|${def.spacing ?? 0}`;
    if (!this.sliced.has(gridKey)) {
      this.slice(texture, def);
      this.sliced.add(gridKey);
    }
    if (!texture.has(name)) {
      this.logger.warnOnce(`frame-${id}-${index}`, `Sprite sheet "${id}" has no frame ${index} (check frame size and numbers with Zelda: Preview Sprite Sheet).`);
      return null;
    }
    return { key, frame: name };
  }

  private slice(texture: any, def: SheetDef): void {
    const src = texture.getSourceImage();
    const margin = def.margin ?? 0;
    const spacing = def.spacing ?? 0;
    const cols = Math.floor((src.width - 2 * margin + spacing) / (def.frameWidth + spacing));
    const rows = Math.floor((src.height - 2 * margin + spacing) / (def.frameHeight + spacing));
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const name = SheetLibrary.frameName(def, r * cols + c);
        if (!texture.has(name)) texture.add(name, 0, margin + c * (def.frameWidth + spacing), margin + r * (def.frameHeight + spacing), def.frameWidth, def.frameHeight);
      }
    }
  }
}
