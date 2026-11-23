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
- Spring on the hinge angle θ toward 0: up = ω 6 rad/s, ζ 0.5 → first crosses upright at ≈ 0.40 s, overshoot 12-20 % of the travel from the release angle, settle to within ±2° of target in < 1.4 s; all three measured from the release (the end of the round-6 anticipation dip). (Round 6: the travel starts at the stage-1 angle -63° or at -90°, see "Round 6" → Folds; was the 90° travel from flat.) Down = ω 7, ζ 0.85, no visible overshoot. (Round 3: critic asked for 0.40-0.45 s to upright; was ω 8, before that ω 14.)
- Hinges in one tile stagger by 180 ms, tallest piece first.
- Event `fold` {dir: 'up'|'down', id, i, j, t, cause?} fired at start of motion (for a fold-up: the start of the anticipation dip). `cause: 'stage'` marks a round-6 dance-stage fold-down; stage-1 lifts and drops fire no event.

## Troll (`public/models/troll.glb`)
- Original design, no film or toy likeness, logos or text. (Round 6: the model is the new lead A, see "Round 6" → Characters; was a mint felt troll with a sunset plume, scarf and satchel.)
- Body height 0.5-0.6 units, hair tip ≤ 1.05 (round 6; was 0.6 / 0.95), faces +Z, origin between the feet.
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
- Perspective FOV 30°, pitch 35° down (round 6, review L1; was 45°), distance 7.5 units (round 6; was 10, before that 14), follow with exponential smoothing τ = 0.25 s. Round 6 adds the beat camera ("Round 6" → Camera).
- Tilt-shift: sharp band ≈ 40 % of frame height centred on the troll (round 6, review L2; was 30 %), smooth falloff over ≈ 22 % each side, max blur ≈ 1.0 % of image width (≈ 13 px at 1280 wide; round 6, was 1.5 % / 19 px), saturation +25 %.
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

- Characters (round 6: both models replaced by the new duo, see "Round 6" → Characters; the rules below for roles, trail, follow, swap and audio still hold): A = `troll.glb`, B = `troll_b.glb`: body height 0.5-0.6, hair tip ≤ 1.05 (round 6; was 0.95), faces +Z, origin between the feet, ≤ 20k triangles, textures ≤ 1024 px, material prefixes per the tile contract. (Round 6: per-rig bones and clips in "Round 6" → Characters, checked by `blender/duo/inspect_duo.py`; the B5 inspector and its copied-rotation and spine-prop checks are retired.)
- Roles: the leader is player-controlled; `player` (object identity never changes) always holds the leader's pose. A second controller `follower` holds the follower's pose. Start: A leads, B starts 1.1 units behind A's heading on an unblocked point (else beside).
- Trail: leader positions sampled every ≤ 0.05 units, ≤ 8 units kept; at start and on every swap the trail is reset to the straight segment follower → leader.
- Follow: the follower moves along the trail toward the point 1.1 units of path length behind the leader; speed ≤ 1.6 units/s (catch-up when the gap > 1.4), easing to 0 inside the last 0.3 units; walk clip time scale = speed / 1.2, clamped 0.6-1.4. If the trail is shorter than 1.1, the follower holds still.
- Precedence (highest first): (1) never enter a blocked cell (every move, recovery included, is checked with `isBlocked`); (2) separation ≥ 0.45 from the leader: when the leader closes in, the follower steps sideways (perpendicular to the leader's heading, unblocked side) at ≤ 1.6 units/s; if neither side is free it holds and the leader passes through (the leader is never blocked by the follower); (3) trail follow; (4) idle slot.
- Targets (while the leader walks straight at 1.2 units/s for ≥ 2 s in ordinary following; a separation yield or pass-through and the follower's rejoin of the trail after it are excluded; round 6: so are B's `look` and the catch-up after it): median leader-follower distance 0.9-1.4, max ≤ 2.2; separation ≥ 0.45 on ≥ 99 % of frames of the e2e duo route.
- Idle: once the leader is stationary (displacement < 0.02 units over the last 0.5 s) the idle slot replaces the trail target; the follower walks a straight, collision-checked (samples every 0.05 units) path to a side slot 0.75 units to the screen left or right of the leader (along the camera's right vector on the page, so the pair stands side by side in frame whatever their heading) (nearer unblocked side with a clear path; if neither, it keeps the trail target) and turns to the leader's heading ±30°.
- Dance: the leader dances after 4 s idle (unchanged); the follower starts its own rig's `dance` clip 0.3125 ± 0.05 s later (round 6: each rig plays its own clip; was the same clip); leader input (movement key, click-walk) or leader displacement > 0.02 units over the last 0.25 s ends both.
- Recovery: if the follower is > 2.6 units from the leader for 0.5 s, it hops to the trail point 1.1 units behind (parabolic, apex 0.25, duration 0.35 s + 0.1 s per unit of the hop's horizontal ground travel (take-off to landing) beyond 1.5; exempt from the speed cap). The hop's ground path is checked before take-off (samples every 0.05 units, landing included); if any sample is blocked it walks the trail instead. Blocking is static during a hop, so a started hop always lands.
- Swap: Space, or a click/tap inside the follower's projected bounds (+8 px), at any time. At most one swap is pending: a request becomes eligible at max(last swap + 0.5 s, landing of an active hop) and is applied then; a second request while one is pending cancels it (the result matches the parity of the presses). Applying: poses (position, heading, velocity, state) are exchanged by value between `player` and `follower`, each character model rebinds to its new controller, the trail resets (the recovery timer keeps running: the gap is between the pair), click-walk is cancelled, `blockedBy` is cleared, held movement keys keep driving the new leader, an active dance ends for both, audio switches leader (below). A click on the follower never starts a click-walk.
- Camera: follows the leader with τ 0.25 (unchanged); after a swap with both standing, the camera rig's target point (`__atlas.camera.target`, XZ distance) is within 0.15 units (2 % of distance 7.5; round 6, was 0.2 at distance 10, measured at the ground intersection) of the new leader within 1.0 s.
- On screen: the camera keeps tracking the leader; the follow bounds (≤ 2.2 walking, recovery at 2.6) keep the follower in frame. From `ready` on, on every rendered frame of the headed e2e duo route at 1280x720 and 1920x1080 and of the 1280x720 capture (walks, turns, swaps, hops, dance), default camera: both characters' projected bounds inside the frame; the follower's bounds overlap the leader's by > 50 % of its area for ≤ 0.5 s at a stretch; a character with both {body centre, hair tip} occluded by tiles (raycast) for ≤ 0.5 s at a stretch (tolerance shown to the owner at U5). Portrait and phone viewports are not covered.
- Focus: tilt-shift centre at the point 30 % of the way from leader to follower.
- Folds: driven by the leader only, both stages (radii 2/3 for stage 2, 4.5/5.5 for stage 1, round 6).
- Audio: only the leader drives character audio. Leader-bank cues: `voice_*`, `sing_*` (B: `b_voice_*`, `b_sing_*`). Shared samples played at the leader's position: steps, hair swish/settle, bumps, plip, claps, spin. World sounds unchanged: folds, pops, chimes, harmony, chorus. Every character cue logs `who: 'a'|'b'`; the follower logs none. On swap: the active voice is cut with a 20 ms fade, logged as that cue's `end` (the offline render honours `end`, so live and capture match for either bank); pending hum, dance and reaction state is cleared; the new leader's `voice_lead` / `b_voice_lead` starts when the fade ends, unless the cut voice started < 0.3 s before the swap (then no swap line). Runtime: a missing B sample is skipped without error; shipping gate: `generate.mjs --check` fails if any required B cue or A `voice_lead` is missing.
- Voice B sings in its own lower register (driver, 2026-11-22, after V5h: B's sung takes measured MIDI 57-63 against A's A4-D5 targets): `b_sing_ta` on D4 at the bow and `b_sing_da` on A3 (a small falling ta-da), `b_sing_hum` hums the melody notes one octave down; coverage within 4 semitones of D4, A3 and MIDI 57-69 (pentatonic), same retune rules.
- Voice B: one ElevenLabs-designed original voice (never a clone, no actor or character resemblance), dry and cautious, warm underneath; median f0 (YIN, voiced frames) of all non-sung B takes 220-380 Hz; lines are original non-verbal sounds or 1-2 word exclamations; sung coverage rules as for A.
- Debug: `__atlas.duo` = {leader: 'a'|'b', follower: {x, z, state}, swaps, pendingSwap, swap()}; `__atlas.player` stays the leader.
- Perf: existing targets with both characters; p95 ≤ PB0 baseline (06da353, same host/route/DPR) + 1.5 ms at DPR 1 and 2. (Round 6: PB6 replaces PB0, see "Performance".)

## Round 6: forest-clip direction, new duo
Sources: `docs/review/2026-11-23-art-animation-review.md` (items L1-L6, A1-A8), the forest clip study `docs/research/trolls-stage-design.md` (style only; its "Do not copy" list applies), owner request 2026-11-23 (a new original duo in the troll-doll style, "adorable and cute"; no film character, likeness, name or signature trait). Concept target `reference/concept-r6/`. Where a bullet here names an older section, it replaces that section's number.

### Characters
- Style: original troll-doll-style felt creatures: one soft rounded head-body mass, head ≥ 50 % of body height, big glossy button eyes, cheeks, small nose, tall upswept yarn hair, stubby limbs. Steer away (plus `docs/research/trolls-character-design.md` §3): no pink-on-pink lead, no flower, crown or headband, no grey, blue-grey or lavender body, no vest, no matching outfits, no film faces, names, lines or songs; no likeness to any existing character from any franchise (for example no green big-eyed creature with wide pointed side ears and a robe-like collar).
- A, lead, the bubbly one (`troll.glb`): orange `#F59A3C` felt apple body, butter `#F7DC6F` tummy patch, hot-pink `#E8478F` cheek circles, glossy black button eyes set wide and low, tomato `#D9453B` nose, small stitched smile, small rounded ears low on the sides of the head, very tall sky `#7EC8E8` yarn hair cloud tied at the root with a lime `#A7D84A` band, lime knit pinafore with a butter button.
- B, companion, the wary one (`troll_b.glb`): shorter, wider mint `#9EE0B8` felt pear body, violet `#7A52C7` chunky knit crew-neck sweater (no high collar), button eyes under half-lowered mint lids, pink `#F4A6C8` nose, flat stitched mouth, no visible ears (the mop covers them), heavy tomato `#D9453B` yarn mop that flops to one side, small sky felt umbrella in the right hand (Blender-built, not part of the Tripo mesh).
- GLBs (both): Tripo mesh rigged in Blender; static checks (bones, nodes, clip metrics and markers, sizes) by `blender/duo/inspect_duo.py` and `scripts/e2e-duo-assets.mjs`; runtime behaviour (skip selection, look interruptions, umbrella trigger, face and hair response) by unit tests and the e2e gate; the troll bone set incl. `root` and `hair_0`..`hair_3`, plus `head` and `hand_r`; body height 0.5-0.6, hair tip ≤ 1.05, faces +Z, origin between the feet ±0.02, ≤ 20k triangles, textures ≤ 1024 px; materials `felt_a_*`, `yarn_a_*` (A) and `felt_b_*`, `yarn_b_*` (B), plus `felt_mouth`.
- Face nodes (both): `eye_l`, `eye_r` (glossy domes); `lid_l`, `lid_r` under `head`, closed by node `scale.y` from the authored open value to 1 (the GLB stores the open scale in `extras.lidOpen`); `mouth` with material `felt_mouth` on an 8-cell 4x2 atlas, cell order smile, open_smile, o, flat, frown, sing, ee, grin (row-major from the top left), picked at runtime by texture offset.
- Clips per rig. A: `walk`, `idle`, `dance`, `skip`. B: `walk`, `idle`, `dance`, `look`. Inspector requirements are per rig; no rig is required to carry the other's extra clip.
  - A `walk`: 1.0 s per 2 steps at 1.2 units/s, forward lean 6-10°, shoulder swing ≥ ±30°, bob 0.09, foot plant ≤ 0.012 high and slip ≤ 0.02 per plant.
  - A `skip`: 1.0 s, two hops, matches 1.2 units/s, contacts at 0 and 0.5 s. The state stays `walk`; the mixer plays `skip` instead of `walk` for 2 cycles on 1 in 4 walk starts by hash after ≥ 1 s standing, leader only.
  - B `walk`: 0.8 s per 2 steps at 1.2 units/s, spine hunch 8-12°, shoulder swing ≤ ±15°, bob 0.06, same plant and slip limits.
  - B `look`: 0.6 s, head yaw ≥ 25° each way. Follower only: plays before B sets off after ≥ 2 s standing; separation (precedence 2), recovery, a dance start or a swap interrupts it. As leader B never plays it.
  - `dance` (both): 3.0 ± 0.05 s with shared beat markers (turn start 0.92 s, low landing 1.67 s, bow 2.19 s held 0.35 s; each ±0.03 s, checked from the pose curves), so the cue director's fixed dance times hold for either leader; wrist path spans ≥ 0.35 units vertically.
- Umbrella (B): `umbrella_closed` and `umbrella_open` under `hand_r`; `umbrella_open` authored at scale 0. The runtime pops it open (scale spring 0 → 1, ω 14, ζ 0.45; `umbrella_closed` hidden) when B, leading, collides with a river (the collision, not the voice line, which the reaction gap may drop; ≤ 1 per 3 s) and at the dance bow; it closes 1.2 s later or at the dance end. Clips never animate the umbrella.

### Face and secondary motion
- Blinks: interval 2.5-5.5 s (seeded per character), 0.15 s close and open, 1 in 5 doubled; rest lid closure A 0, B 0.35.
- Mouth, leader only, from `cue` events of either bank (`voice_*` or `b_voice_*`, `sing_*` or `b_sing_*`): ooh, eep → o; hmph → frown; hm → flat; hup → ee; whee, lead (swap line) → open_smile; giggle → open_smile and grin alternating at 8 Hz; sing → sing. The shape holds from the cue's `t` to its effective `end` (after any cut), then returns to the rest shape (A smile, B flat) 0.1 s later. The follower shows its rest shape and blinks.
- Hair emotion: ooh, whee and a hero fold-up within 2.5 units of the leader (from `onFold` in `src/world/index.js`, the gameplay signal, so it works with audio locked or the line dropped) make the hair chain stand 0.25 rad taller; hmph and hm make it droop 0.35 rad; spring-blended over the cue, layered on the existing hair spring. B: each of its own foot contacts kicks its hair spring (tip bounce ≥ 0.02 units).
- Squash and stretch: volume-preserving scale (sx = sz = 1/√sy) on `root`: each foot contact sy 0.95 (walk and skip contacts alike), dance landing marker (1.67 s) 0.88, recovery-hop take-off 1.10 and landing 0.88; when two triggers fall in the same frame the larger deformation wins; spring back ω 18, ζ 0.5.
- Contacts are computed per character from its own clip time, so the follower's contacts drive its hair and squash; only the leader's contacts play footsteps.

### Camera
- Walk camera: distance 7.5, pitch 35° (see "Camera and light").
- Beat camera. Dance: distance 4.5, pitch 22°, aim point +0.25 y, 0.6 s ease in at dance start, 0.8 s ease out at dance end or input. Hero: when a mushroom_house, cupcake_tree or yarn_bridge folds up (`onFold`, dir 'up') within 2.5 units of the walking leader, distance 6.0 and pitch 30° for 1.5 s, ≤ 1 per 8 s. Yaw never changes. The dance beat eases in at `duo-dance-start` and out at `duo-dance-end`.
- Fit (every shipped camera, blends included): each character is a sphere centred 0.5 above its current-frame controller position, radius 0.6 (covers hair tip and open umbrella); the camera distance rises (τ 0.25) until both spheres project inside the frame with a 6 % margin, up to 10 (the round-5 distance at which the recovery fixtures held). A beat that would need more than 7.5 is skipped. The camera updates after both controllers and character poses in the frame loop.
- Priority: dance beat > hero beat > walk. A swap or a recovery hop cancels any beat (0.8 s ease out) and a hop blocks a new hero beat. `?cam=` turns beats off.
- Debug: `__atlas.camera` = {distance, pitch, target {x, y, z}, beat: null | 'dance' | 'hero'}.
- The round-5 on-screen, overlap and occlusion rules hold under every shipped camera (walk, both beats, blends, fit); diagnostic `?cam=` values are exempt. Duo checks run in the duo runner at 1280x720 and 1920x1080; other new checks at 1280x720.

### Light, ground and props
- Rim: warm `#FFE9A8` Fresnel fuzz rim on the characters and hero props (flower, mushroom_house, cupcake_tree) only, flag `rim` in `lookOff`. Per character (surface-tag mask ≥ 1,500 px at the walk camera): mean luma of mask pixels within 3 px of its edge ≥ 1.15x the mean of pixels ≥ 6 px inside. Hero props (tag hero prop, mask ≥ 800 px): edge mean ≥ 1.10x interior and ≥ 1.05x the same pixels with rim off. Cream page pixels against the same URL with `rim` added to the default `lookOff` list: mean |Δluma| ≤ 1.
- Export naming (TIL6, read by the inspector): appliqué pieces are mesh nodes `appl_<k>` with `extras.layer` 1-3; decorations `deco_<motif>_<k>`; dome cards `dome_<k>` under their hinge. Layers are counted as distinct `extras.layer` values covering a sample point, never faces.
- Appliqué (review L4): meadow and page-decoration piece area ≥ 1.5x the fa6d96b mean (measured by the tile inspector, both numbers recorded in `docs/log.md`); ≥ 2 overlapping layers on ≥ 40 % of each appliqué footprint (64x64 samples per tile); the pink rectangles replaced by ≥ 4 decoration motifs (French knots, sequins on `glitter_`, small buttons, stitched shapes), no motif on > 40 % of decorated cells over 64x64 cells on 20 seeds.
- Hero volume (L5): the upright mushroom cap and cupcake crown are domes: ≥ 3 card planes whose outward normals span ≥ 60° around the vertical, or one stuffed mesh with front-to-back depth ≥ 40 % of its width. Their flat pose may reach 0.08 above the page (as petals and rails).
- Secondary pivots: tiles export follow-through parts (at least the mushroom door and ≥ 3 flower petals) under empties `sec_<k>` nested in their parent `hinge_<n>`, local X = their own fold axis.
- Zone colour sets (L6): each grove or clearing zone picks one prop felt family (pink-violet, orange-butter, sky-mint, lime-mint); page, characters, river, bridges and lanterns keep their colours, and so does near-white felt (linear luminance > 0.78: cream, white dots, highlights) on the props; no frame-wide tint. On ≥ 5 of the 6 look-stats shots that have ≥ 2,000 eligible pixels (saturated s > 0.35, v > 0.2, tagged hero or flat prop; bridges, rivers, characters, lanterns, page, gutter and table excluded), ≥ 60 % of them lie in one 60° hue window.
- Look-stats, shipped profile: required verdicts are motes (#10), lanterns (#11 emitters, halos, two-troll clearance), bloom (#12), fold flash (#13), prop fidelity, troll fidelity (hair and body per character), rim, page unchanged and zone hue; grade, rear key, bounce, zones-as-tint, moss, haze, backdrop, fronds and dapple are not evaluated in this profile. Six pinned shots (seed and pose recorded in `scripts/look-shots.mjs`), each check with its minimum sample; a check without its sample on a shot excludes that shot, and fewer eligible shots than the check needs fails it. `look-stats.mjs` exits non-zero on any failed required verdict.
- Shot counts (T10r6, driver-accepted): rim on characters and per-character troll fidelity need ≥ 4 eligible shots and rim on hero props ≥ 3, every eligible shot passing; prop fidelity, page unchanged and lantern clearance all 6; motes, lit emitters and halos, bloom and zone hue ≥ 5 of 6.
- Look-stats shots are re-projected at the walk camera; the fold-flash witness is anchored to the upright crossing in `hingeTrace`; the lantern bullet (#11, halo 1.5-3 %) is re-verified with the new blur.

### Folds (supersedes "Fold behaviour" where they differ)
- Stage 1: a tile lifts to θ = -63° (30 % of the travel) when its cell centre is within 4.5 units of the leader and drops back to -90° beyond 5.5 (spring ω 5, ζ 0.8; same 180 ms tallest-first stagger). Silent: no `fold` event, pop, chime or cue.
- Stage 2 is the fold in "Fold behaviour": up within 2 from the current angle; down beyond 3 to -63° if within 5.5, else to -90°.
- Anticipation: at the stage-2 fold-up the hinge first dips toward flat over 80 ms to max(θ − 4°, −90°) (from flat or within 1° of it, an 80 ms hold; never below the page); the `fold` event fires at the start of the dip; the up spring starts at its end. A fold-down trigger during the dip cancels it and the down spring starts from the current angle.
- Bend: every instanced hinge batch carries an `InstancedBufferAttribute` `instanceBend` (Float32, itemSize 1, radians) and its material the define `USE_INSTANCE_BEND`; WLD6 writes slot k together with that instance's pose matrix: bend = clamp(−0.04 s · θ', ±8°) (θ' in rad/s; positive bends the part's top toward the flat side), 0 once settled. The craft shader bends the part in its local frame about local X, scaled by local y over the part height. Two copies of the same tile bend independently; a settled copy reads 0. No per-frame allocation.
- Follow-through: each `sec_<k>` angle relative to its parent is φ = s − θ_parent, where s is a spring (ω 9, ζ 0.4) tracking θ_parent delayed by 80 ± 20 ms; at rest φ = 0, so authored poses hold.
- Dance stage: at `duo-dance-start`, prop tiles (flower, mushroom_house, cupcake_tree) whose cell centre is within 1.8 units of either character go flat: a tile in stage 2 folds down with a down event marked `cause: 'stage'`; a tile in stage 1 drops silently; a flat tile stays flat. They stay flat until `duo-dance-end`, then the normal rules apply (a stage-2 fold-up there fires the usual event and chime). Blocking stays static (`isBlocked` from the layout).

### Events (frozen interface)
- `src/scene/runtime.js` exports `events`, an `EventTarget`. Producers dispatch `CustomEvent`s with these `detail`s: `dance-start` {who, t}, `dance-end` {who, t, interrupted}, `contact` {who, foot: 'l'|'r', t}, `cue` {who, cue, t, end}, `cue-end` {who, cue, end} (a cut moved `end` earlier), `bump` {who, reason: 'prop'|'edge'|'river', t}, `hop` {who, phase: 'takeoff'|'land', t}, `swap` {leader, t}, `duo-dance-start` {t} (the leader's dance start), `duo-dance-end` {t, interrupted} (both characters' dances finished, the follower's canon included, or the dance interrupted). Fold signals for consumers come from `onFold` in `src/world/index.js`, not from audio. `who` is 'a' or 'b'; `t` is in the clock of `elapsed` passed to `registerUpdate`, except cue times, which are in the fold-event clock like `cueLog`.

### Capture
- The first 4 s establish the book edge (book edge or table ≥ 5 % of the frame in at least one frame); from 6 s on the leader stays ≥ 4 units inside the page-band edges and book edge plus table cover ≤ 10 % of every frame. The route includes, with observed witnesses in the capture log: a hero beat, a lead swap, B leading into a river collision with the umbrella pop, and the full duo dance: the dance beat active from `duo-dance-start` + 0.6 s to `duo-dance-end`, with the canon offset. Kept from round 5: ≥ 4 fold-ups with chimes, the framing check on every frame, and `mix.pass`. The route planner models both fold stages and the runtime's meadow hinges.

### Release
- `package.json` and `package-lock.json` at 0.2.0, `CHANGELOG.md` (Keep a Changelog) and the round's `docs/log.md` lines on the candidate before its final gate; the owner's approval names the candidate commit and its capture; the merge to main changes nothing else.

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
- Kinds: `voice` (troll), `chorus` (residents), `sfx` (fold layers, hair, bumps, claps, spin), `step` (incl. bridge plucks). The 8-voice cap covers scheduler voices only (pops, chimes, harmony); sample kinds have their own caps instead: one `voice` and one `chorus` at a time, one fold layer per frame and direction, one step per contact. Coverage: `sing_ta` must have a take within 4 semitones of A4, `sing_da` of D5, `sing_hum` takes must cover MIDI 69-78 within 4 semitones (round 6: the new voice A hums melody notes above MIDI 78 one octave down, as voice B does with its register; was 69-81), checked by rendering each retuned take and re-detecting its pitch (±25 cents).
- Chime timbre by tile (F4, procedural, same pitch rules as today): flower glass bell (today's partials), mushroom_house marimba, cupcake_tree music box, river tiles glockenspiel, yarn_bridge plucked yarn (Karplus-Strong), meadow and path tiles today's bell. Each timbre's peak within ±1.5 dB of today's chime at the same note; energy above 8 kHz ≤ -40 dB relative to total (4096-point Hann FFT over the first 200 ms).
- Harmony (F4): when one frame's up-folds include ≥ 2 distinct tile ids and the melody chime sounds, add one harmony chime 2 pentatonic degrees below the melody note (above, if that leaves D4-D6), in the second tile's timbre, -6 dB, same start and length. It counts toward the 8-voice cap and is the first voice dropped. Logged in `audioLog` with `harmony: true`.
- Fold layers (F1, F2): one sample per frame and direction, riding with the pop (plays only if its pop played), onset = pop `t` ±10 ms. Fold-up cue by tile: `fold_flower`, `fold_mushroom_house`, `fold_cupcake_tree`, `fold_yarn_bridge`, `fold_river`, `fold_path`, `fold_meadow`; fold-down `fold_down` 6 dB under. Pan = clamp((tile x - troll x) / 4, -0.6, 0.6). Attack (round-4 critic, owner decision 2026-11-22): over the capture's fold-up events, each layer's 2.5-10 kHz energy in its first 30 ms is at least 6 dB lower (median) than at de3aaee, its < 1 kHz energy within ±1 dB, and claps, spin and bumps are unchanged.
- Footsteps (F3): one per walk foot contact (clip time 0 and half the playing `walk` or `skip` clip's length: A 0 / 0.5 s, B 0 / 0.4 s, round 6; so 2 per cycle), ±40 ms, scaled by the clip time scale; only the leader's contacts play. Cell under the troll picks the sound: path tiles `step_paper`, `yarn_bridge` a procedural yarn pluck rising D5 E5 F#5 A5 B5 D6 (restarting at D5 on each bridge entry) over `step_felt` at -6 dB, everything else `step_felt`. Alternating pan ±0.15; never the same take twice in a row.
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
`window.__atlas` exposes: `player` {x, z, state}, `events` (the round-6 event bus), `foldLog` (array of fold events), `hingeTrace(id)` (sampled angles), `hairBones` (world positions), `audioLog` (scheduled notes), `cueLog` (played samples, round 4), `setSeed(n)`.

## Performance (final build, this machine)
- Headed Chrome, 1280x720 viewport, DPR 1 and DPR 2, all effects on, 60 s scripted route crossing ≥ 6 chunks.
- Targets after 3 s warm-up: median frame ≤ 16.7 ms, p95 ≤ 18 ms, p99 ≤ 25 ms, ≤ 2 % of frames over 20 ms, 0 frames over 50 ms.
- Report machine model, GPU, display refresh rate. Claims cover only this machine.
- Round 6: "all effects on" means the shipped default flags (`DEFAULT_EFFECTS`, `DEFAULT_LOOK_OFF`), recorded in the perf JSON. p95 ≤ PB6 baseline (fa6d96b, same host, route and DPR) + 1.5 ms at DPR 1 and 2; PB6 replaces PB0.
