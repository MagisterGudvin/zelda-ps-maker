// Builds tools/param-probe into a standalone .ps-maker.js with the same esbuild
// settings as the official CLI (which only builds src/index.ts).
import * as esbuild from "esbuild";
await esbuild.build({
  entryPoints: [new URL("../tools/param-probe/index.ts", import.meta.url).pathname],
  bundle: true,
  outfile: new URL("../tools/param-probe/zelda-param-probe.ps-maker.js", import.meta.url).pathname,
  format: "esm",
  platform: "browser",
  target: "es2020",
  minify: true,
});
console.log("Built tools/param-probe/zelda-param-probe.ps-maker.js");
