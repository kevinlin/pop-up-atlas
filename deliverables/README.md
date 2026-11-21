# Pop-up Atlas: Troll Edition

A small original troll walks across an endless felt-and-paper pop-up scrapbook. Tiles fold up out of the page as it gets close, settle with a springy wobble, and fold flat again once it walks on. Each fold makes a soft pop, and fold-ups also ring a chime in D major pentatonic, so walking plays a short phrase. If you stop for 4 seconds, the troll dances.

## Run it

```bash
npm install
npm run dev        # dev server with hot reload
npm run build      # production build into dist/
npm run preview    # serve dist/ at http://localhost:4173
```

- **Walk:** WASD or the arrow keys. Click the page to walk to that spot.
- **Dance:** stop for 4 seconds.
- **Sound** starts on your first click or key press, because browsers block audio until you interact.
- **Optional URL flags:**
  - `?debug` shows frame time.
  - `?seed=<n>` picks a different world.
  - `?cam=<distance>,<pitchDeg>` changes the camera.
  - `?focus=<x>,<z>` sets the focus point.

Checks: `npm test` runs 109 unit tests. Against `npm run preview`, `node scripts/e2e.mjs` runs the 11-check acceptance gate and `node scripts/perf.mjs` runs the frame-time test.

## Deliverables

| What | Where |
|---|---|
| Playable build | `npm run build`, then `npm run preview` |
| 30-second gameplay capture with game audio | `round-3/gameplay-30s.mp4` (1280×720, 60 fps, H.264 + AAC) |
| Final side-by-sides, labelled | `round-3/side-by-side-labelled.png` (reference on the left, game on the right) |
| Final blind pairs and answer key | `round-3/critic/pair-01..06.png`, `round-3/key/key.json` |
| Critic verdicts, all rounds | `round-1/verdicts/`, `round-2/verdicts/`, `round-3/verdicts/` |
| Performance results | `round-3/perf.json` |
| Concept frames and reference photos | `../reference/` (licences in `../reference/LICENSES.md` and `../reference/research/README.md`) |
| Measurable targets | `../docs/contracts.md` |
| Production log (append-only) | `../docs/log.md` |

## Scores

Each round, separate blind critics judged the game. The look critic saw six A/B pairs (reference vs game, random order, no labels) and had to pick the reference. The motion and sound critics scored against the brief. Scores are out of 10.

| Area | Round 1 | Round 2 | Round 3 (final) |
|---|---|---|---|
| Look: average game score over the six pairs | 3.5 | 3.2 | 3.3 |
| Look: reference picked correctly | 6/6, 99 % confident | 6/6, 99 % | 6/6, 99 % |
| Fold motion and spring | 4 | 6 | 6 |
| Walk | 5 | 6 | 6 |
| Dance | 5 | 4 | 4 |
| Hair motion | 7 | 5 | 5 |
| Pop sound | 6 | 7 | 7 |
| Chime | 7 | 7 | 7 |
| Musicality | 4 | 5 | 5 |
| Mix | 7 | 8 | 8 |
| "Wowed"? | no | no | no |

All three rounds used the same critic model (`gpt-6.2-astra`) and a fresh session per round, so the rounds compare directly.

## Performance

Measured in headed Chrome at 1280×720, over a 60-second walk crossing several chunks, with every effect on including glitter:

| Pixel ratio | Median | p95 | p99 | Worst | Frames over 20 ms | Load |
|---|---|---|---|---|---|---|
| 1 | 8.3 ms | 9.3 ms | 10.1 ms | 10.4 ms | 0 | 0.41 s |
| 2 | 8.3 ms | 9.4 ms | 10.1 ms | 10.4 ms | 0 | 0.38 s |

These numbers come from a MacBook Pro with an Apple M5 Pro and a 120 Hz display. That machine is much faster than a mid-range laptop. I had no mid-range laptop to test on, so the brief's "steady 60 fps on a mid-range laptop" is not verified.

## What met the brief, and what didn't

Met:
- Endless folding world. Wave function collapse matches every tile edge, also across chunk boundaries and on revisits. Tested on 20 seeds.
- Rivers can only be crossed on bridges.
- Spring folds rise in about 0.4 s, overshoot by about 16 % and settle. Fold-downs are damped. The pieces of one tile stagger, tallest first.
- The book is an accordion, with page edges, a cover lip and a table.
- Original troll, built and animated in Blender: walk, idle and dance clips, plus baked and runtime hair sway.
- Procedural audio in one key, playing a composed eight-note phrase.
- WASD and click-to-walk, with smooth camera follow.
- No on-screen UI. No film characters, names, logos or music.

Not met:
- **"Critics can't reliably pick the original and are wowed."** After three rounds, the critics still picked the reference in all 6 pairs. They were not wowed. The cap of three rounds was my assumption A4, logged at the start.
  - The references are AI-generated "photographs" of a dense handmade diorama.
  - The game is real-time and less dense. The critics' remaining tells: smooth hair silhouettes, exposed cream page, repeated plant shapes, and the fold mechanism visible in only some shots.
- **Dance and hair motion regressed from round 1** (dance 5 to 4, hair 7 to 5). Reverting the round-2 hair-spring change did not bring the score back.
- **The tune is sparse in the final capture.** Folds trigger 2 units from the troll so that they happen on screen. The 30-second capture got only 9 fold-ups. The round-3 sound critic's top fix: reset the phrase only after 6 seconds without a fold, so the walker can finish it.
- **Sound and motion feel need a human.** Critics judged them from frames, spectrograms and data, not by listening or playing. Final judgement is yours.

## Top remaining fixes, from the round-3 critics

1. Build each shot around the visible folding mechanism (gutter or page edge, glued foot, an open V-fold) and two large landmarks at different depths.
2. Rework the troll's materials for close-ups: fraying swept hair, visibly twisted scarf yarn, a soft fibre rim on the felt.
3. Make the dance's back-facing pose and the troll's planted-boot weight shift readable at game camera distance.
4. Audio: hold the phrase across slow walking (reset after 6 s of no folds), and re-anchor timing without restarting the melody.

## Assumptions

All assumptions are in `../docs/log.md`. The main ones:
- Image generation ran on the existing Codex subscription.
- Reference photos are openly licensed and not shipped in the build.
- Blender builds run on the host, because worker sandboxes couldn't start Blender.
- Critic rounds were capped at three.
- Performance claims cover only this machine.
