import type { ToolkitConfig } from "./config.ts";

/**
 * Converts author-facing coordinates to world pixels. With
 * `world.positionUnits = "tiles"`, (2, 3) means the center of tile column 2,
 * row 3.
 */
export function toWorld(config: ToolkitConfig, v: number): number {
  if (config.world.positionUnits === "tiles") {
    const t = config.world.tileSize;
    return v * t + t / 2;
  }
  return v;
}
