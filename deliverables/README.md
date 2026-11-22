# Pop-up Atlas: Troll Edition

A small original troll walks across an endless felt-and-paper pop-up scrapbook. Tiles fold up out of the page as it gets close, settle with a springy wobble, and fold flat again once it walks on. Each fold makes a soft pop with a papery layer on top. Fold-ups also ring a chime in D major pentatonic, so walking plays a short tune. The troll has its own voice. It says "hup" when it sets off and "ooh" at the big pop-ups, and it hums the last notes of the tune when it stops. At the end of its dance it sings a little "ta-da", and a tiny chorus answers. Glowing seed-pod lanterns, soft bokeh and drifting motes add a touch of magic to the scrapbook.

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
  - `?lookOff=&effects=5,7,9,10,11,13` turns on the full round-4 forest stage (see "Round 4" below). `?lookOff=<layers>` and `?effects=<items>` switch single layers.

Checks: `npm test` runs 220 unit tests. The browser checks run against `npm run preview`. `node scripts/e2e.mjs` runs the 21-check acceptance gate: 11 world and motion checks and 10 sound and voice checks. `node scripts/perf.mjs` runs the frame-time test, and `node scripts/look-stats.mjs` measures the look against `../docs/contracts.md`.

## Deliverables

| What | Where |
|---|---|
| Playable build | `npm run build`, then `npm run preview` |
| 30-second gameplay capture with game audio | `round-4/gameplay-30s.mp4` (1280×720, 60 fps, H.264 + AAC) |
| Every shipped sound, playable | `round-4/soundboard.html` |
| Round 3 vs round 4, same shots | `round-4/compare/round3-vs-round4.png` |
| Final blind look pairs and answer key | `round-4/critic/pair-01..06.png`, `round-4/key/key.json` |
| Final blind sound pairs and answer key | `round-4/critic-inputs/audio/` (spectrograms, `pairs.json`), `round-4/key/audio-key.json` |
| Sound stems, mix check, cue list | `round-4/audio/mix.json`, `round-4/audio/cues.json` |
| Critic verdicts, all rounds | `round-1/verdicts/` to `round-4/verdicts/` |
| Performance results | `round-4/perf.json` |
| Concept frames and reference photos | `../reference/` (licences in `../reference/LICENSES.md` and `../reference/research/README.md`) |
| Measurable targets | `../docs/contracts.md` |
| Production log (append-only) | `../docs/log.md` |

The WAV files (sound stems and blind sound pairs, about 150 MB) are not in git. `node scripts/capture.mjs --round 4 --stems` against `npm run preview` writes them again, with a new shuffle.

## Round 4: voice, sound and a touch of magic

**Sound.** The troll's voice, the chorus and the sung notes are original designs, made with ElevenLabs voice design and text-to-speech. Everything was generated once, cached, and played back from 90 short MP3 files (722 KB). On top of the procedural pops and chimes:
- Each tile type has its own chime timbre (bell, marimba, music box, glockenspiel), and folding two tiles at once adds a harmony note.
- The tune holds across slow walking and only restarts after 6 seconds without a fold.
- Footsteps change with the ground: felt, paper on paths, and a rising yarn pluck on bridges.
- Fold layers add a papery rustle to each pop. Their attacks are softened, because the first blind critic found them sharp.
- A reaction line never starts within 2.5 seconds of the last one, and voices never overlap.

ElevenLabs spend: 977 credits by the account balance, against a cap of 15,000. The pre-call guard's ledger counts 2,363, because it books calls without a cost header at a conservative estimate.

**Look.** I first built a full "magical forest" stage. It had a warmer grade, light from behind, a green tint per zone, haze, felt moss over the pages and dark fronds in the foreground. You rejected it: it "lost the handmade scrapbook feel" and looked "mushy". The shipped look keeps round 3's light, cream pages and wood table. It adds only glowing lanterns, bokeh, drifting motes and a sparkle when a tile folds up. The full stage is still in the code behind the URL flags above.

**Two bugs found by the round-4 checks.**
- The synth's volume envelope started each note at full volume instead of silence. A start time with a tiny rounding error then let one raw sample through. On the bridge pluck that was a click as loud as the voice. It had been there since the first build. Fixed.
- Under the full stage, the troll's red hair rendered near-black. A colour check on the troll now guards against it.

## Scores

Each round, separate blind critics judged the game. The look critic saw six A/B pairs (concept frame vs game, random order, no labels) and had to pick the concept. Rounds 1 to 3 compared against the earlier concept frames; round 4 compared against new round-4 concept frames, so treat the look trend as rough. Scores are out of 10.

| Area | Round 1 | Round 2 | Round 3 | Round 4 (final) |
|---|---|---|---|---|
| Look: average game score over the six pairs | 3.5 | 3.2 | 3.3 | 4.0 |
| Look: concept picked correctly | 6/6, 99 % confident | 6/6, 99 % | 6/6, 99 % | 6/6, 99 % |
| Fold motion and spring | 4 | 6 | 6 | not re-scored |
| Walk | 5 | 6 | 6 | not re-scored |
| Dance | 5 | 4 | 4 | not re-scored |
| Hair motion | 7 | 5 | 5 | not re-scored |
| Pop sound | 6 | 7 | 7 | see below |
| Chime | 7 | 7 | 7 | see below |
| Musicality | 4 | 5 | 5 | see below |
| Mix | 7 | 8 | 8 | see below |

Round 4's sound critic did blind A/B listening instead of per-category scores. It compared the full mix with the round-3 sound, and with versions missing one new feature each:

| Pair | First round | Second round (final) |
|---|---|---|
| New mix vs round-3 sound | new, 8 vs 4 | new, 8 vs 4 |
| With vs without the voice | with, 8 vs 5 | with, 8 vs 6 |
| With vs without the chorus | with, 8 vs 7 | with, 8 vs 7 |
| With vs without the fold layers, claps and spin | without, 9 vs 8 | with, 8 vs 7 (after softening the attacks) |
| New vs old tune | new, 5 vs 4 | new, 5 vs 4 |
| With vs without footsteps | with, 8 vs 7 | with, 8 vs 7 |

The local MOSS listening model confirmed the voice lines are audible where they should be, and flagged no defects. It also described a hum over plain silence, so it served as a record of what is audible, not as a judge.

Your verdict: the sound is "good as is"; the look is round 3 plus the accents.

## Performance

Measured in headed Chrome at 1280×720, over a 60-second walk crossing six chunks, on the shipped look:

| Pixel ratio | Median | p95 | p99 | Worst | Frames over 20 ms | Load |
|---|---|---|---|---|---|---|
| 1 | 8.3 ms | 9.6 ms | 10.2 ms | 10.4 ms | 0 | 0.41 s |
| 2 | 8.3 ms | 9.6 ms | 10.1 ms | 10.4 ms | 0 | 0.38 s |

These numbers come from a MacBook Pro with an Apple M5 Pro and a 120 Hz display. That machine is much faster than a mid-range laptop. I had no mid-range laptop to test on, so the brief's "steady 60 fps on a mid-range laptop" is not verified. The load time sits close to its 0.461 s ceiling: single cold loads ranged from 0.41 s to 0.48 s across runs.

## What met the brief, and what didn't

Met:
- Endless folding world. Wave function collapse matches every tile edge, also across chunk boundaries and on revisits. Tested on 20 seeds.
- Rivers can only be crossed on bridges.
- Spring folds rise in about 0.4 s, overshoot by about 16 % and settle. Fold-downs are damped. The pieces of one tile stagger, tallest first.
- The book is an accordion, with page edges, a cover lip and a table.
- Original troll, built and animated in Blender: walk, idle and dance clips, plus baked and runtime hair sway.
- An original voice that reacts, hums and sings in key, a tiny chorus, and sounds that follow what the troll does. The blind critic preferred every new sound feature, and you called it good as is.
- WASD and click-to-walk, with smooth camera follow.
- No on-screen UI. No film characters, names, logos, songs or music.

Not met:
- **"Critics can't reliably pick the original and are wowed."** After four rounds, the critic still picked the concept frame in all 6 pairs.
- **The magical forest stage as first specified.** It shipped only as accents, by your decision. Its measurable targets passed, but the result read worse than round 3.
- **Sound and motion feel need a human.** The critics judged sound from waveforms and spectrograms, not by listening, and motion from frames.

One thing to watch in the capture: a lantern that would cross the troll is hidden at once, string and all. While the troll walks, a lantern may visibly pop off and on.

## Next round

1. Show the book's construction. Keep the front page stack and the gutter in frame, add visible folded-card braces under the pop-ups, and show layered page edges. Of the look critic's asks, these are the ones that fit the scrapbook direction.
2. Fade the lanterns out near the troll instead of hiding them at once.
3. Sound polish from the final sound critic. Trim the two strongest paper-fizz bursts, near 18.99 s and 25.38 s in the capture, by 4 to 6 dB above 6 kHz. Stop one rustle from repeating sample-for-sample 2 seconds apart. Give the chime at 2.84 s room before the voice line that overlaps it.

## Assumptions

All assumptions are in `../docs/log.md`. The main ones:
- Image generation ran on the existing Codex subscription.
- Reference photos are openly licensed and not shipped in the build.
- Blender builds run on the host, because worker sandboxes couldn't start Blender.
- Look critic rounds were capped at three for rounds 1 to 3; round 4 ran one look round and two sound rounds.
- ElevenLabs spend was capped at 15,000 credits, set by you.
- The listening critic ran on the local MOSS model, at your request, so it cost nothing.
- Performance claims cover only this machine.
