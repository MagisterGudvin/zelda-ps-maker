import { definePlugin } from "@ps-maker/plugin-api";
import { ZELDA_ACTIONS } from "./editor/actions.ts";
import { withActionsAlias } from "./editor/pluginShape.ts";
import { startEditorPreview } from "./editor/editorPreview.ts";
import { startRestoreWatcher } from "./editor/saveRestore.ts";

// NOTE: the official CLI reads `name` and `version` from this call with a
// regular expression, so they must stay string literals placed before any `}`.
const plugin = definePlugin({
  name: "Zelda Maker Toolkit",
  description: "Real-time action-adventure toolkit (sword, items, enemies, puzzles, dungeons, HUD, saves) in the style of classic top-down adventures.",
  version: "0.24.0",
  events: ZELDA_ACTIONS,
});

// In the PS Maker editor window: show what the Zelda actions create on the map (browser only).
startEditorPreview();
// In the game: a map restored from a PS Maker save does not run "Map start"; the Toolkit starts it.
startRestoreWatcher(ZELDA_ACTIONS);

export default withActionsAlias(plugin);
