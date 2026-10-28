# Third-party notices

## Bundled into `dist/zelda-maker-toolkit.ps-maker.js`

### @ps-maker/plugin-api 0.0.3 — MIT License
Copyright (c) 2026 Pixel Stories. Only the runtime stubs `defineEvent`/`definePlugin` (identity functions) are inlined by the official build; type definitions are used at compile time.

> Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions: The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software. THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

## Demo project assets (not in the plugin)

### Pixelify Sans — SIL Open Font License 1.1
Copyright 2021 The Pixelify Sans Project Authors (https://github.com/eifetx/Pixelify-Sans). `scripts/demo-assets/PixelifySans.ttf` (the variable font as published, renamed), license text in `scripts/demo-assets/PixelifySans-OFL.txt`. `make-demo-project.mjs` copies both into the demo project. Used because PixelOperator, the font of a new PS Maker project, has no Cyrillic.

## Development only (not distributed with the plugin)

| Package | License | Why |
|---|---|---|
| @ps-maker/plugin-cli 0.1.7 | MIT | official PS Maker build tool (esbuild bundling) |
| typescript 5.9.3 | Apache-2.0 | type checking |
| @types/node | MIT | test typings |
| phaser 3.90.0 | MIT | demo harness and integration tests (PS Maker provides its own Phaser at runtime) |
| playwright-core 1.56.1 | Apache-2.0 | headless Chromium for integration tests |

`npm audit` reports a moderate advisory for esbuild ≤ 0.24.2 (GHSA-67mh-4wv8-2f99) pulled in by `@ps-maker/plugin-cli`. It affects esbuild's development *server*, which this project never starts (the CLI only calls `esbuild.build`).

## References (no code or assets copied)

- **snesrev/zelda3** (MIT, © 2022 snesrev, © 2021 elzo_d) — read as a technical reference for game-mechanics behavior (invulnerability frames, sword charge, hit timers, bomb fuse, staggered collision checks). No source code was ported and no assets are used; the toolkit never asks for or reads a ROM.
- **Sang Hendrix — RPG Maker Action Combat (RPG Maker MZ)** — only publicly visible forum answers were consulted for general design ideas (enemies as tagged map objects, contact damage with a cooldown). No code, assets or API from that plugin are used.
- *The Legend of Zelda* is a trademark of Nintendo. This project is not affiliated with or endorsed by Nintendo; all names, sprites and texts in it are original.
