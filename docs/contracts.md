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
- Folded-flat tiles must read as printed/appliqué shapes on the page, not z-fighting: flat parts sit 0.005-0.02 above y = 0, stacked by hinge index.

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

## Debug hooks
`window.__atlas` exposes: `player` {x, z, state}, `foldLog` (array of fold events), `hingeTrace(id)` (sampled angles), `hairBones` (world positions), `audioLog` (scheduled notes), `setSeed(n)`.

## Performance (final build, this machine)
- Headed Chrome, 1280x720 viewport, DPR 1 and DPR 2, all effects on, 60 s scripted route crossing ≥ 6 chunks.
- Targets after 3 s warm-up: median frame ≤ 16.7 ms, p95 ≤ 18 ms, p99 ≤ 25 ms, ≤ 2 % of frames over 20 ms, 0 frames over 50 ms.
- Report machine model, GPU, display refresh rate. Claims cover only this machine.
