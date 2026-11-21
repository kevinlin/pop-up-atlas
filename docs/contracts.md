# Contracts and targets

Source of truth for every component. Change only through the driver; log changes in `docs/log.md`.

## World units and grid
- Y up, glTF convention. 1 unit ≈ 10 cm of real craft.
- Tile = 2.0 x 2.0 units on XZ. Cell (i, j) centre = (2i, 0, 2j).
- Edges: N = -Z, E = +X, S = +Z, W = -X.
- Tile rotation r in 0..3 = r x 90° about +Y, applied by the runtime. Models are authored at r = 0.

## Sockets and tile set (rot 0)
Socket labels per edge: `g` grass/meadow, `p` path, `r` river. Two neighbours connect when their touching edge labels are equal.

| id | N E S W | walkable | rotations | weight |
|----|---------|----------|-----------|--------|
| meadow | g g g g | yes | 1 | 9 |
| flower | g g g g | yes (prop blocks centre 0.8 radius) | 4 | 3 |
| mushroom_house | g g g g | yes (prop blocks centre 0.9 radius) | 4 | 2 |
| cupcake_tree | g g g g | yes (prop blocks centre 0.7 radius) | 4 | 3 |
| path_straight | p g p g | yes | 2 | 0.5 |
| path_corner | p p g g | yes | 4 | 0.25 |
| river_straight | r g r g | no (river band) | 2 | 0.4 |
| river_corner | r r g g | no (river band) | 4 | 0.25 |
| yarn_bridge | r p r p | yes along E-W | 2 | 0.3 |

`src/world/tiles.js` mirrors this table and is the code source of truth. Rivers are crossable only on `yarn_bridge`.

Layout density (target, measured over a 64x64-cell area on 20 seeds): grass-socket tiles (meadow + props) ≥ 70 % of cells, path tiles ≤ 15 %, river tiles ≤ 10 %. A river crosses at most 1 in 3 chunk columns; every river crossing a chunk has ≥ 2 bridges per 8 cells of river length on average. The world must not show a visible regular grid of roads/rivers.

## Tile glTF (`public/models/tiles/<id>.glb`)
- Root node named `<id>`, origin at tile centre on the page surface (y = 0).
- Foldable parts are children of empties named `hinge_0`, `hinge_1`, … Each hinge empty sits on y = 0, its local X axis is the fold axis.
- Authored pose = upright (hinge rotation 0). Flat pose = hinge.rotation.x = -π/2 (part lies toward -Z). The runtime animates between these; no baked fold clips.
- Non-folding base (page-level relief, river glitter strip) goes under a node named `base`.
- Footprint within ±1.0 on X/Z when upright; height ≤ 1.8.
- ≤ 15k triangles per tile, textures ≤ 1024 px, embedded.
- Material name prefixes tell the runtime the material class: `felt_`, `card_`, `glitter_`, `yarn_`.

## Book bounds (round 2)
- The scrapbook is an endless accordion (concertina) book running along X: a page band j ∈ [-5, 4] (z ∈ [-11, 9]) with page-stack edges, a felt cover lip and a warm wood table beyond both Z edges; a valley fold (gutter) every 8 columns. The troll cannot leave the page band.
- Composition: low-frequency zones (≈ 6-10 cells) alternate groves (dense, tall props) and clearings (meadow / flat appliqué), so views group into scenes instead of wallpaper; prop height varies ≈ 3:1 within a grove.

## Scrapbook page (`public/models/tiles/page_a.glb`, `page_b.glb`, `gutter.glb`)
- `page_a` / `page_b`: flat 2x2 page tile variants (felt or paper, stitched border pieces, slight layered edges), drawn under every cell.
- `gutter.glb`: 2-unit strip along Z marking the book spine, placed on every cell whose i is a multiple of 8, with a shallow valley (≤ 0.08 deep) the troll walks over.
- Folded-flat tiles must read as printed/appliqué shapes on the page, not z-fighting: flat parts sit 0.005-0.02 above y = 0, stacked by hinge index. Exception (round 3): cupped flower petals and twisted bridge rails have real thickness, so their flat pose may reach 0.08 above the page.

## Fold behaviour
- Fold up when cell centre is within 2 units of the troll; fold down when beyond 3 units (hysteresis), so both happen right beside the troll. (Was 7/9 → 5/6.5 → 3/4.5; round-2 critic: fold-down easy to miss.)
- Spring on the hinge angle θ from -90° to 0: up = ω 6 rad/s, ζ 0.5 → first crosses upright at ≈ 0.40 s, overshoot 12-20 % of the 90° travel, settle to within ±2° of target in < 1.4 s. Down = ω 7, ζ 0.85, no visible overshoot. (Round 3: critic asked for 0.40-0.45 s to upright; was ω 8, before that ω 14.)
- Hinges in one tile stagger by 180 ms, tallest piece first.
- Event `fold` {dir: 'up'|'down', id, i, j, t} fired at start of motion.

## Troll (`public/models/troll.glb`)
- Original design: round fuzzy felt body, tall upswept bright hair, stubby limbs, small satchel. No film or toy likeness, logos or text.
- Height 0.6 units (hair tip up to 0.95), faces +Z, origin between the feet.
- Bones: `root`, … , hair chain `hair_0`..`hair_3` (base to tip).
- Clips: `walk` loop, 1.0 s per cycle = 2 steps, root-in-place, matches 1.2 units/s, body bob 0.09 with the low point just after contact and hips shifting over the planted foot, each support foot planted ≈ 0.25 s, swing foot lifted half a boot-height; `idle` loop 2.0 s; `dance` ≈ 3 s, non-loop: sideways step with one arm above the head, a 0.75 s turn with distinct front / profile / back / finish poses, low landing, crooked one-foot bow held 0.35 s. (Round 2: bob was 0.03, dance 5 s.)
- ≤ 20k triangles, textures ≤ 1024 px.

## Look targets (from reference/concept, reference/concept-claude, reference/research)
- Palette (felt, saturated candy rainbow): hot pink #E8478F, pink #F4A6C8, lavender #B79AE0, violet #7A52C7, sky #7EC8E8, mint #9EE0B8, lime #A7D84A, butter #F7DC6F, orange #F59A3C, tomato #D9453B. Pages cream #F6EAD2, cut-edge core #FFF8EC, table/background warm wood #8A5A3B → #C9956A.
- Felt: diffuse only, no specular lobe; sheen/Fresnel rim (fuzz halo) brightest at grazing angles; silhouette edges soft (alpha-fuzz or shell), stitch floss in a contrasting palette colour, spacing 0.04-0.06 units.
- Cardstock: matte, visible fibre, cut edge 1 lighter line; contact shadows darkest at hinges.
- Glitter: sparse pinpoint highlights 1-3 px, view-dependent, hard threshold, flicker as camera moves; base colour stays saturated; ≤ 1 % of glitter-surface pixels lit at any moment. Used on edges of flowers/cupcake sprinkles, river surface, bridge.
- Scrapbook dressing: stitched felt page borders, skewed washi tape strips (0.15 units wide, semi-translucent), torn white-cored edges.

## Camera and light
- Perspective FOV 30°, pitch 45° down (research: 35-50°, concept frames ≈ 45°), distance 10 units (was 14; troll too small), follow with exponential smoothing τ = 0.25 s.
- Tilt-shift: sharp band ≈ 30 % of frame height centred on the troll, smooth falloff over ≈ 22 % each side, max blur ≈ 1.5 % of image width (≈ 19 px at 1280 wide), saturation +25 %.
- Key: warm #FFD9A0, intensity 2.2, from upper-left-front. Fill: pink-violet #C58BFF, 0.6, opposite side. Hemisphere sky #FFE8F0 / ground #6B4C8A, 0.4.
- Soft shadows: PCFSoftShadowMap, 2048 map on key only, frustum follows the troll.

## Controls
- WASD / arrows move at 1.2 units/s relative to the camera. Click/tap on the page: walk to that point (straight line, stops at blocked props or river). Any key cancels click-walk.
- Idle 4 s with no input → `dance`, then back to `idle`.

## Audio
- Key: D major pentatonic (D E F# A B), range D4-D6. Tempo 96 bpm, chimes quantized to the next eighth note (312.5 ms grid).
- Fold-up: soft pop (filtered noise ≤ 40 ms + low thump) + bell chime. Fold-down: quieter pop, no chime.
- Melody: each chime moves ±1 or ±2 scale degrees from the last, never the same note more than twice in a row, bounded to range.
- ≤ 8 simultaneous voices; extra events are dropped (pops) or merged onto the same grid slot (chimes).
- AudioContext resumes on first pointer/key input.
- Phrase hold (round 4): the phrase restarts only after 6 s with no fold-up (was 6 empty eighths). After a gap longer than 6 eighths but under 6 s, the grid re-anchors on the new fold-up and the melody continues from its next note.

## Audio round 4: sound effects and voices
- Sources: style research `docs/research/trolls-sound-and-voice.md` (findings F1-F5 below refer to it); generation input `audio/cues.json` is the single source of cue names, prompts, takes, kinds and gains.
- Originality: one voice designed from a text description (ElevenLabs voice design), never a clone, no resemblance to any actor or existing character. Lines are original non-verbal sounds or 1-2 word exclamations. Nothing from the research doc's "Do not copy" list.
- Assets: `public/audio/<cue>-<n>.mp3`, mono, 44.1 kHz, ≤ 96 kbps; measured on the decoded MP3: first sample above -40 dBFS within 10 ms of the start, peak -1 dBFS ±0.5 dB; per-cue gain in `public/audio/manifest.json` (also: cue, kind, file, duration, `baseMidi` for sung takes). All shipped audio ≤ 2 MB. No manifest → procedural sounds only, no errors.
- Kinds: `voice` (troll), `chorus` (residents), `sfx` (fold layers, hair, bumps, claps, spin), `step` (incl. bridge plucks). The 8-voice cap covers scheduler voices only (pops, chimes, harmony); sample kinds have their own caps instead: one `voice` and one `chorus` at a time, one fold layer per frame and direction, one step per contact. Coverage: `sing_ta` must have a take within 4 semitones of A4, `sing_da` of D5, `sing_hum` takes must cover MIDI 69-81 within 4 semitones, checked by rendering each retuned take and re-detecting its pitch (±25 cents).
- Chime timbre by tile (F4, procedural, same pitch rules as today): flower glass bell (today's partials), mushroom_house marimba, cupcake_tree music box, river tiles glockenspiel, yarn_bridge plucked yarn (Karplus-Strong), meadow and path tiles today's bell. Each timbre's peak within ±1.5 dB of today's chime at the same note; energy above 8 kHz ≤ -40 dB relative to total (4096-point Hann FFT over the first 200 ms).
- Harmony (F4): when one frame's up-folds include ≥ 2 distinct tile ids and the melody chime sounds, add one harmony chime 2 pentatonic degrees below the melody note (above, if that leaves D4-D6), in the second tile's timbre, -6 dB, same start and length. It counts toward the 8-voice cap and is the first voice dropped. Logged in `audioLog` with `harmony: true`.
- Fold layers (F1, F2): one sample per frame and direction, riding with the pop (plays only if its pop played), onset = pop `t` ±10 ms. Fold-up cue by tile: `fold_flower`, `fold_mushroom_house`, `fold_cupcake_tree`, `fold_yarn_bridge`, `fold_river`, `fold_path`, `fold_meadow`; fold-down `fold_down` 6 dB under. Pan = clamp((tile x - troll x) / 4, -0.6, 0.6).
- Footsteps (F3): one per walk foot contact (walk clip time 0 and 0.5 s, so 2 per cycle at 1.2 units/s), ±40 ms. Cell under the troll picks the sound: path tiles `step_paper`, `yarn_bridge` a procedural yarn pluck rising D5 E5 F#5 A5 B5 D6 (restarting at D5 on each bridge entry) over `step_felt` at -6 dB, everything else `step_felt`. Alternating pan ±0.15; never the same take twice in a row.
- Walk start (after ≥ 0.5 s standing, ≤ 1 per 1.5 s): `sfx_hair_swish`; plus `voice_hup` on 1 in 3 starts by hash, only after ≥ 2 s standing, ≤ 1 per 8 s. Walk stop (after ≥ 1 s walking): `sfx_hair_settle`; plus `voice_hm` on 1 in 4 by hash, ≤ 1 per 10 s.
- Bumps (never scary; the layout reports what blocked the move): blocked prop or page edge → `sfx_bump` + grumpy `voice_hmph`; river → `sfx_plip` + `voice_eep`; ≤ 1 bump reaction per 3 s.
- Hero fold-up of `mushroom_house`, `cupcake_tree` or `yarn_bridge` within 2.5 units → `voice_ooh`, ≤ 1 per 10 s. Leaving a bridge → `voice_whee`, ≤ 1 per 15 s. Mushroom_house fold-up → `chorus_ooh` on 1 in 3 by cell hash, ≤ 1 per 8 s.
- Reaction gap: ≥ 2.5 s between the starts of any two reaction lines (hup, hm, hmph, eep, ooh, bridge-exit whee). A reaction that would break a gap or overlap a playing voice is dropped, never queued. Inside the idle hum and the dance, each new voice cue stops the previous voice with a 20 ms fade.
- Idle hum: 1.5 s into standing still, if a melody chime sounded in the last 10 s, `sing_hum` hums the last 3 melody notes (fewer if fewer), one per eighth (0.3125 s). Movement stops it.
- Dance (clip time from dance start): `sfx_clap` at 0 and 0.3125 s, `voice_giggle` at 0.45 s; `sfx_spin` + `voice_whee` at the turn (0.92 s); `sing_ta` on A4 at the bow (2.19 s) and `sing_da` on D5 at 2.50 s; `chorus_yay` answers at 2.65 s. Each ±50 ms. Dance lines skip the reaction gap; reactions wait for the dance to end; an interrupted dance plays no further dance cues.
- Sung takes (hum, ta, da): play the take whose `baseMidi` is nearest the target with rate 2^((target - baseMidi) / 12), shift ≤ 4 semitones (skip the note otherwise), landing within ±25 cents.
- Determinism: every choice (take, chance, pan) comes from seeded or hashed values, so the same events replay the same cues.
- Mix (30 s capture): each group's peak is measured on its stem rendered alone through the full chain from the capture's logs; voice peaks 3-6 dB above chime peaks; footsteps ≥ 12 dB under voice peaks; chorus ≥ 6 dB under voice; on the decoded final AAC, master peak ≤ -1 dBFS and no clipped samples.
- Debug: `__atlas.cueLog` holds `{t, end, cue, kind, cause, file, gain, pan, rate}` per played sample or synthesized step pluck (`file: null`, plus `midi`), in fold-event time; `end` is the effective stop (after any cut); `cause` names the trigger (`fold`, `step`, `walk-start`, `walk-stop`, `bump`, `hero`, `bridge-exit`, `hum`, `dance`, `chorus`). `__atlas.popLog` holds `{t, dir, id}` per scheduled pop. `__atlas.audioReadyMs` = ms from load start until every sample is decoded. `renderOffline(events, duration, {cues, sampleRate, manifestURL})` replays `cueLog` (honouring `end`) with no dependency on Vite (`import.meta.env`), so the capture carries the same cues; filtering `cues` renders stems.
- Load: samples fetch and decode without delaying `ready`; `loadMs` ≤ 461 ms at DPR 1 and ≤ 428 ms at DPR 2 (round 3 + 50 ms); perf targets unchanged.

## Debug hooks
`window.__atlas` exposes: `player` {x, z, state}, `foldLog` (array of fold events), `hingeTrace(id)` (sampled angles), `hairBones` (world positions), `audioLog` (scheduled notes), `cueLog` (played samples, round 4), `setSeed(n)`.

## Performance (final build, this machine)
- Headed Chrome, 1280x720 viewport, DPR 1 and DPR 2, all effects on, 60 s scripted route crossing ≥ 6 chunks.
- Targets after 3 s warm-up: median frame ≤ 16.7 ms, p95 ≤ 18 ms, p99 ≤ 25 ms, ≤ 2 % of frames over 20 ms, 0 frames over 50 ms.
- Report machine model, GPU, display refresh rate. Claims cover only this machine.
