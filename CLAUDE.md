# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

"Pop-up Atlas: Troll Edition": a Three.js browser walking toy. A felt troll walks an endless felt-and-paper pop-up scrapbook; tiles fold up near it on a spring and fold flat behind it, each fold plays a pop (+ a pentatonic chime on fold-up). The brief is `Trolls-pop-up-atlas.md` (`Pop-up-atlas.md` is the earlier paper-only brief). Results, scores and run instructions for humans are in `deliverables/README.md`.

## Commands

```bash
npm run dev                      # Vite dev server
npm run build && npm run preview # production build, served at http://localhost:4173
npm test                         # vitest run (all unit tests)
npx vitest run tests/world-layout.test.js   # one file
npx vitest run -t "<test name>"             # one test by name
```

Browser checks (Playwright, need `npm run preview` running; they launch headed Chromium on the host GPU, `ATLAS_HEADLESS=1` switches to headless software GL):

- `node scripts/e2e.mjs [--url URL]`: acceptance gate (WASD, click-to-walk, fold trace, hair, dance, fold audio).
- `npm run perf` / `node scripts/perf.mjs [URL] [--out PATH]`: frame-time test at 1280x720, DPR 1 and 2.
- `node scripts/capture.mjs [URL] --round N`: 30 s gameplay capture with offline-rendered game audio (needs ffmpeg).
- `node scripts/sbs.mjs [URL] --round N`: blind A/B side-by-sides vs `reference/concept-claude/` plus answer key.
- `node scripts/inspect-glb.mjs`: checks every tile GLB against the asset contract.

Blender assets (Blender 5.2, run on the host, outputs are committed GLBs under `public/models/`):

```bash
Blender -b --factory-startup --python-exit-code 1 -P blender/build_tiles.py   # -> public/models/tiles/*.glb
Blender -b --python-exit-code 1 -P blender/troll/build_troll.py               # -> public/models/troll.glb
```

`build_troll.py` never overwrites: it fails if the output exists, so pass a new path after `--` (or move the old GLB aside first); `blender/troll/inspect_troll.py` checks the troll contract.

## Contracts are the source of truth

`docs/contracts.md` holds every measurable target: grid/units, socket table, glTF node naming (`hinge_N`, `base`, material prefixes `felt_`/`card_`/`glitter_`/`yarn_`), fold radii and spring constants, troll bones/clips, palette, camera, audio key/tempo, perf. Code mirrors it, e.g. `src/world/tiles.js` mirrors the socket table, `scripts/capture.mjs` exports `foldContract`. When a number changes, change it in the contract, the code and the tests together, and append a line to `docs/log.md`.

`docs/log.md` is append-only: add entries, never edit or delete old ones. Tests may not be deleted or weakened to make a change pass.

## Architecture

`src/main.js` wires everything and runs one rAF loop. Shared singletons (`scene`, `camera`, `player`, `isBlocked`, `registerUpdate`) live in `src/scene/runtime.js`; modules register per-frame callbacks via `registerUpdate(fn(dt, elapsed))` instead of being called from main.

- `src/world/`: deterministic, seed-driven world. `layout.js` does the WFC-style chunk solve (borders constrained by already-generated neighbours, so revisits are identical and seams match regardless of generation order); `stream.js` loads/unloads tiles around the player; `book.js` builds the accordion book band (page rows, gutter every 8 columns, cover lip, table); `index.js` runs the fold logic and emits `fold` events through `onFold`. `setIsBlocked` is set from here (props, rivers except bridges, page band edges).
- `src/lib/spring.js`: the one damped-spring implementation, shared by hinges and character secondary motion.
- `src/character/`: loads `troll.glb`, state machine walk/idle/dance (dance after 4 s idle), runtime hair spring layered on the baked clips, foot contact shadows.
- `src/controls/`: WASD relative to camera, click-to-walk on the page plane.
- `src/scene/`: renderer, camera follow rig, lights (shadow frustum follows the troll), tilt-shift post pass (`tilt-shift.js`), `?focus=` parsing.
- `src/materials/`: runtime shader patches keyed off material name prefixes (felt sheen, glitter pinpoints, stitch shading, per-cell colour jitter).
- `src/audio/`: Web Audio. `music.js` is pure (phrase/scheduler/random, unit-tested); `sounds.js` synthesises pop and chime; `renderOffline(events)` renders the same sounds for the capture. The AudioContext is created suspended at load and only resumed on first input (creating it on input caused a ~120 ms hitch).
- `src/debug/`: defines `window.__atlas` (player, state, `worldReady`, `ready`, `loadMs`, fold log). All Playwright scripts drive and read the game through this object, so keep its shape stable. `?debug`, `?seed=`, `?cam=dist,pitch`, `?focus=x,z` URL flags.
- `scripts/capture.mjs` is also the shared helper module for the other browser scripts (`previewURL`, `launchChromium`, `roundOptions`, route planning from `createLayout`).

## Working setup

The project was built by a driver agent (Claude Code) delegating tasks to worker CLIs through the agent-handoff skill; `.handoff/` (gitignored) holds the goal, job records and evidence. Per-round critic inputs, blind pairs, verdicts and perf JSON go in `deliverables/round-N/`. Worker sandboxes could not run Blender or a GPU browser, so Blender builds, perf and capture have always been re-run on the host.
