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

## Look round 4: magical forest stage
Source: `docs/research/trolls-stage-design.md` (items #1-#17 there; the forest scene of the first film and its visual development, style only). Its "Do not copy" list applies: no film characters, faces on props, shot recreations, signature props, names, song or logos; nothing from `reference/trolls-film/` is copied into assets, the build or a commit; asset colours come from the palette above. Supersedes "Camera and light" where they differ. Frame statistics are measured on 1280x720 game frames at the default camera, Rec.709 luma 0-255.

- Shipped look (owner decision 2026-11-22, after seeing the full stage: "lost the handmade scrapbook feel", "mushy"): "Camera and light" stays as in round 3 (light, grade, cream pages, wood table). Only the accents ship by default: motes (#10), lanterns with lit insides and emissive-only bloom (#11, #12) and the fold-up response (#13). Items #1-#8 and #17 stay in the code behind flags, off by default (`?lookOff=` empty and `?effects=5,7,10,11,13` turn the full stage on); their bullets below apply only when they are switched on. The troll and prop colour-fidelity checks apply to the shipped look.
- Grade (#1): luma mean 120-140, p95 ≤ 215, ≤ 3 % of pixels > 230, 3-8 % < 40, saturation mean 0.50-0.58.
- Backlight (#2): key moves to the far side of the page (top of screen), elevation 30-45°, colour `#FFE9A8`; felt sheen rims visible on ≥ 50 % of prop silhouettes in the sharp band; highlight tint (mean of the brightest 5 %) lime-butter, not cream: hue 50-80°, saturation 0.25-0.50, luma ≥ 205 (round-4 re-derivation of the film's `#E0E8A0`-`#F2E6A8` for our felt palette).
- Bounce (#3): hemisphere ground colour green-teal `#2F5A50`; shadow tint (mean of the darkest 10 %) green to teal, never red-brown: hue 90-180°, luma 35-70 (re-derived from `#2E3A34`-`#3A3F3A`).
- Colour fidelity (#2, #3): the new light never turns felt black. Props vs `?lookOff=backlight,bounce` at the same pose: median hue shift ≤ 15°, median luma ratio ≥ 0.6, no desaturated region ≥ 9 px. The troll keeps its own palette under every stage layer (zone keys and grade included): hair and body measured separately against the render with every `lookOff` flag off and the same `?effects=` at the same pose (the check is about light and grade, so particles appear in both), same three limits, on every default-camera shot.
- One hue family per zone (#4): each grove/clearing zone gets a key (green-gold default, amber, pink-lavender, teal) that biases prop colours and a zone tint in the composite, blended over 2 cells; ≥ 65 % of saturated pixels (s > 0.35, v > 0.2) inside one 60° hue window per screen.
- Felt-carpet ground (#5): grove cells get felt moss appliqué in three tiers (tight short fuzz, bumped longer fuzz, loose long fuzz) with pink, blue and butter flecks; cream stays at page edges, gutters and clearings; exposed cream ≤ 10 % of frame in groves; sunlit moss 1.5-1.8x shade luma.
- Depth haze and backdrop (#6, #17): beyond the sharp band blend toward the zone haze (day `#E9F0C0`, amber `#F6DE9A`, pink `#F2D0DA`) up to 30-35 % at the far edge; top-third luma ≥ bottom-third + 15; far props ≥ 30 % less saturated than the focus band; background beyond the book a gradient, top luma ≥ bottom + 30, measured on a staged shot that shows the backdrop in both the top and bottom thirds.
- Dark foreground (#7): 1-3 oversized felt fronds or bell-flower stems enter the bottom corners, blurred by the tilt-shift; 5-12 % of frame, luma 30-70; never overlap the troll.
- Dappled light (#8): in groves a world-space noise (blobs 0.6-1.5 units) modulates the key's shadow term, patch contrast 1.4-1.8x.
- Bokeh (#9): removed (owner decision 2026-11-22: "don't look like bokeh at all", blocked the view). Not in the code.
- Motes (#10): 80-150 drifting fuzz tufts and pollen on screen, 2-5 px, 0.05-0.2 units/s, alpha 20-50 %; 20 % twinkle like glitter.
- Glowing props and bloom (#11, #12): original card seed-pod lanterns on yarn strings between grove props, plus lit insides on mushroom houses and flower cores; 3-8 lit emitters per screen, emitter luma 200-235, halo radius 1.5-3 % of frame width, colours butter, mint, hot pink, sky from the palette; ground glow faked with an additive decal (no real point lights); emissive-only bloom from the tilt-shift's half-res blur, touching ≤ 4 % of pixels; none on the cream page. Clearance (owner decision 2026-11-22): no lantern, string or stalk pixel inside the troll's projected bounds, and no lantern element in the bottom quarter of the frame, on every default-camera shot.
- The world answers the walker (#13): on fold-up, 0-0.3 s after upright, a burst of 24-48 glitter particles and an emissive flash at 1.5x the settled glow; settled glow 0.3-0.5 while the troll is within 3 units, fading over 0.6 s on fold-down; ≤ 2 bursts at once, pooled, ≤ 200 particles, zero allocations per fold.
- Perf: every item stays inside "Performance"; each is added and measured with `npm run perf` on the host; total p95 increase over round 3 ≤ 3 ms at DPR 1 and 2.

## Round 5: duo
Sources: owner request 2026-11-22 (two characters on screen, lead swap, voice follows the leader), `docs/research/trolls-character-design.md` (design language in spirit only; its steer-away list and the round-4 "Do not copy" lists apply), concept target `reference/concept-r5/` (troll B sheet + 4 duo frames). Troll B: butter felt bean body, violet rope-twist hair column, sky knit sweater, orange umbrella strapped on the back; original, no film character or likeness.

- Characters: A = `troll.glb` (unchanged), B = `troll_b.glb`: same bone and clip names as A, body height 0.5-0.6, hair tip ≤ 0.95, faces +Z, origin between the feet, ≤ 20k triangles, textures ≤ 1024 px, material prefixes per the tile contract; B5's inspector checks are part of the contract.
- Roles: the leader is player-controlled; `player` (object identity never changes) always holds the leader's pose. A second controller `follower` holds the follower's pose. Start: A leads, B starts 1.1 units behind A's heading on an unblocked point (else beside).
- Trail: leader positions sampled every ≤ 0.05 units, ≤ 8 units kept; at start and on every swap the trail is reset to the straight segment follower → leader.
- Follow: the follower moves along the trail toward the point 1.1 units of path length behind the leader; speed ≤ 1.6 units/s (catch-up when the gap > 1.4), easing to 0 inside the last 0.3 units; walk clip time scale = speed / 1.2, clamped 0.6-1.4. If the trail is shorter than 1.1, the follower holds still.
- Precedence (highest first): (1) never enter a blocked cell (every move, recovery included, is checked with `isBlocked`); (2) separation ≥ 0.45 from the leader: when the leader closes in, the follower steps sideways (perpendicular to the leader's heading, unblocked side) at ≤ 1.6 units/s; if neither side is free it holds and the leader passes through (the leader is never blocked by the follower); (3) trail follow; (4) idle slot.
- Targets (while the leader walks straight at 1.2 units/s for ≥ 2 s): median leader-follower distance 0.9-1.4, max ≤ 2.2; separation ≥ 0.45 on ≥ 99 % of frames of the e2e duo route.
- Idle: once the leader is stationary (displacement < 0.02 units over the last 0.5 s) the idle slot replaces the trail target; the follower walks a straight, collision-checked (samples every 0.05 units) path to a side slot 0.75 units left or right of the leader (nearer unblocked side with a clear path; if neither, it keeps the trail target) and turns to the leader's heading ±30°.
- Dance: the leader dances after 4 s idle (unchanged); the follower starts the same clip 0.3125 ± 0.05 s later; leader input (movement key, click-walk) or leader displacement > 0.02 units over the last 0.25 s ends both.
- Recovery: if the follower is > 2.6 units from the leader for 0.5 s, it hops to the trail point 1.1 units behind (parabolic, apex 0.25, duration 0.35 s + 0.1 s per unit beyond 1.5; exempt from the speed cap). The hop's ground path is checked before take-off (samples every 0.05 units, landing included); if any sample is blocked it walks the trail instead. Blocking is static during a hop, so a started hop always lands.
- Swap: Space, or a click/tap inside the follower's projected bounds (+8 px), at any time. At most one swap is pending: a request becomes eligible at max(last swap + 0.5 s, landing of an active hop) and is applied then; a second request while one is pending cancels it (the result matches the parity of the presses). Applying: poses (position, heading, velocity, state) are exchanged by value between `player` and `follower`, each character model rebinds to its new controller, the trail resets, click-walk is cancelled, `blockedBy` is cleared, held movement keys keep driving the new leader, an active dance ends for both, audio switches leader (below). A click on the follower never starts a click-walk.
- Camera: follows the leader with τ 0.25 (unchanged); after a swap with both standing, the camera target is within 0.2 units (2 % of distance 10) of the new leader within 1.0 s.
- On screen: the camera keeps tracking the leader; the follow bounds (≤ 2.2 walking, recovery at 2.6) keep the follower in frame. From `ready` on, on every rendered frame of the headed e2e duo route at 1280x720 and 1920x1080 and of the 1280x720 capture (walks, turns, swaps, hops, dance), default camera: both characters' projected bounds inside the frame; the follower's bounds overlap the leader's by > 50 % of its area for ≤ 0.5 s at a stretch; a character with both {body centre, hair tip} occluded by tiles (raycast) for ≤ 0.5 s at a stretch (tolerance shown to the owner at U5). Portrait and phone viewports are not covered.
- Focus: tilt-shift centre at the point 30 % of the way from leader to follower.
- Folds: driven by the leader only (radii 2/3 unchanged).
- Audio: only the leader drives character audio. Leader-bank cues: `voice_*`, `sing_*` (B: `b_voice_*`, `b_sing_*`). Shared samples played at the leader's position: steps, hair swish/settle, bumps, plip, claps, spin. World sounds unchanged: folds, pops, chimes, harmony, chorus. Every character cue logs `who: 'a'|'b'`; the follower logs none. On swap: the active voice is cut with a 20 ms fade, logged as that cue's `end` (the offline render honours `end`, so live and capture match for either bank); pending hum, dance and reaction state is cleared; the new leader's `voice_lead` / `b_voice_lead` starts when the fade ends, unless the cut voice started < 0.3 s before the swap (then no swap line). Runtime: a missing B sample is skipped without error; shipping gate: `generate.mjs --check` fails if any required B cue or A `voice_lead` is missing.
- Voice B: one ElevenLabs-designed original voice (never a clone, no actor or character resemblance), dry and cautious, warm underneath; median f0 (YIN, voiced frames) of all non-sung B takes 220-380 Hz; lines are original non-verbal sounds or 1-2 word exclamations; sung coverage rules as for A.
- Debug: `__atlas.duo` = {leader: 'a'|'b', follower: {x, z, state}, swaps, pendingSwap, swap()}; `__atlas.player` stays the leader.
- Perf: existing targets with both characters; p95 ≤ PB0 baseline (06da353, same host/route/DPR) + 1.5 ms at DPR 1 and 2.

## Controls
- WASD / arrows move at 1.2 units/s relative to the camera. Click/tap on the page: walk to that point (straight line, stops at blocked props or river). Any key cancels click-walk.
- Idle 4 s with no input → `dance`, then back to `idle`.
- Space, or click/tap on the follower: swap the lead (round 5, see "Round 5: duo").

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
- Fold layers (F1, F2): one sample per frame and direction, riding with the pop (plays only if its pop played), onset = pop `t` ±10 ms. Fold-up cue by tile: `fold_flower`, `fold_mushroom_house`, `fold_cupcake_tree`, `fold_yarn_bridge`, `fold_river`, `fold_path`, `fold_meadow`; fold-down `fold_down` 6 dB under. Pan = clamp((tile x - troll x) / 4, -0.6, 0.6). Attack (round-4 critic, owner decision 2026-11-22): over the capture's fold-up events, each layer's 2.5-10 kHz energy in its first 30 ms is at least 6 dB lower (median) than at de3aaee, its < 1 kHz energy within ±1 dB, and claps, spin and bumps are unchanged.
- Footsteps (F3): one per walk foot contact (walk clip time 0 and 0.5 s, so 2 per cycle at 1.2 units/s), ±40 ms. Cell under the troll picks the sound: path tiles `step_paper`, `yarn_bridge` a procedural yarn pluck rising D5 E5 F#5 A5 B5 D6 (restarting at D5 on each bridge entry) over `step_felt` at -6 dB, everything else `step_felt`. Alternating pan ±0.15; never the same take twice in a row.
- Walk start (after ≥ 0.5 s standing, ≤ 1 per 1.5 s): `sfx_hair_swish`; plus `voice_hup` on 1 in 3 starts by hash, only after ≥ 2 s standing, ≤ 1 per 8 s. Walk stop (after ≥ 1 s walking): `sfx_hair_settle`; plus `voice_hm` on 1 in 4 by hash, ≤ 1 per 10 s.
- Bumps (never scary; the layout reports what blocked the move): blocked prop or page edge → `sfx_bump` + grumpy `voice_hmph`; river → `sfx_plip` + `voice_eep`; ≤ 1 bump reaction per 3 s.
- Hero fold-up of `mushroom_house`, `cupcake_tree` or `yarn_bridge` within 2.5 units → `voice_ooh`, ≤ 1 per 10 s. Leaving a bridge → `voice_whee`, ≤ 1 per 15 s. Mushroom_house fold-up → `chorus_ooh` on 1 in 3 by cell hash, ≤ 1 per 8 s.
- Reaction gap: ≥ 2.5 s between the starts of any two reaction lines (hup, hm, hmph, eep, ooh, bridge-exit whee). A reaction that would break a gap or overlap a playing voice is dropped, never queued. Inside the idle hum and the dance, each new voice cue stops the previous voice with a 20 ms fade that ends at the new cue's start (both cues are scheduled ahead, so the fade begins 20 ms early); voices never overlap, so `end` ≤ the next voice's `t`.
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
