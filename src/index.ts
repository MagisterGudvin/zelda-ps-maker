import { definePlugin } from "@ps-maker/plugin-api";
import { ZELDA_ACTIONS } from "./editor/actions.ts";
import { withActionsAlias } from "./editor/pluginShape.ts";

// NOTE: the official CLI reads `name` and `version` from this call with a
// regular expression, so they must stay string literals placed before any `}`.
const plugin = definePlugin({
  name: "Zelda Maker Toolkit",
  description: "Real-time action-adventure toolkit (sword, items, enemies, puzzles, dungeons, HUD, saves) in the style of classic top-down adventures.",
  version: "0.5.2",
  events: ZELDA_ACTIONS,
});

export default withActionsAlias(plugin);
