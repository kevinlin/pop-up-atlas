# Trolls forest: stage design notes

Research for an original "magical forest" pass on Pop-up Atlas: Troll Edition. Compiled 2026-11-21.

Inputs: the clip "Trolls - Poppy In The Forest Scene" (Trolls, 2016; 184 s, 36 keyframes), 18 visual development images, and five press and interview sources. Everything is listed in `reference/trolls-film/SOURCES.md`. That folder is gitignored and never ships. We borrow the setting's language (light, colour, haze, set dressing, how the world reacts). We do not use its characters, shots or song (see "Do not copy").

Frame refs like `f26` are `reference/trolls-film/forest-scene/frames/f26_t127.59.jpg`. Contact sheets: `forest-scene/contact-sheet-1.jpg` (f01-f12), `-2` (f13-f24), `-3` (f25-f36). Concept refs like `geller-camp` are `reference/trolls-film/concept/geller-camp.jpg`. Text refs T1-T6 are in SOURCES.md.

Tags: [M] measured by script, [S] sourced, [O] observed by eye in frames, [I] my inference. Perf numbers marked [I] are estimates. Check each one with `npm run perf`.

## Top findings

1. **Our frames are overexposed and the page dominates them.** [M] Round-3 game frames average luma 157 against 119 for the film's day forest. 17.8 % of our pixels sit above 230, against 2.2 % in the film. The largest colour cluster in our frames is cream page `#F3E3CE` at 25 %, while the film's ground is green "carpet" [S T3]. Renderer exposure is 1.35 (`src/scene/renderer.js`). A lower exposure plus felt moss over the page in groves is the cheapest large change.
2. **Each beat has one hue family.** [M] Inside a 60° hue window the film keeps 69 % (day forest), 92 % (pink dusk) and 98 % (golden) of its saturated pixels. VFX supervisor: "Each beat had a different color", "only one or two colors for a simple read" [S T1]. Our frames spread the full candy rainbow over every screen, and their dominant hue is the cream and wood (40-60°).
3. **Depth comes from backlight, haze, dark foregrounds and bokeh.** [M] In the film the top third is 25 luma brighter than the bottom third. 6 % of film pixels are below luma 40. Our frames run the other way (-8 luma) and have almost no deep shadow (1.7 %). [O] 9 of 36 keyframes show large bokeh discs, and most forest shots frame the troll with blurred dark leaves or trunks.
4. **The world answers the walker with light.** [S] Geller's effect sheet shows a flower in three beats: bud, "initial burst glitter + light", then "only light" (`geller-glitter_cannon_ag`). The troll houses were designed to "illuminate from the inside" [S T2]. Spore pods puff clouds as the hero bounces past (f10, `geller-geyser_visdev_03_ag`). All of this fits our existing fold-up event.
5. **In this clip, dark + acid glow means danger.** [O] The night-like shots are a lime-lit cave, a red thorn forest and a magenta monster (f20, f22, f27, f28). Cosy night magic only appears in concept art (`geller-camp`): cool blue-violet ambient with warm glowing flowers and firefly halos. If we add dusk or night, copy that recipe and do not put lime glow on black.

## What makes the forest read as magical

- **Light from behind.** [O] The sun sits behind or above the subject in f06, f08, f25, f26, f31. Fuzz silhouettes get a bright rim, and the far background goes pale gold-green. Shafts slant through trunks (f06, `geller-bunker_approach_A_ag`).
- **Dappled ground.** [O] f07: canopy shadow breaks the grass into sunlit pools about 1.5-1.8x brighter than the shade. The ground never reads as one flat value.
- **Three depth planes in almost every shot.** [O] Dark, out-of-focus foreground at the frame edges (f06, f08, f33, f34, `dreamworks-artcenter-forest-village`), a sharp midground with the hero, and a bright hazy background. Distant trunks lose contrast and saturation (f06, f33).
- **Bokeh as decoration.** [O] f08, f10, f16, f17, f19, f24, f26, f31, f32: soft discs about 40-150 px across in 1280 px (3-12 % of frame width), 15-40 % opacity, tinted with the highlight colour, mostly in the upper half.
- **Air that holds things.** [O] Pink spore clouds (f10), lime fog (f28), drifting felt-flower confetti (f32), falling flecks (`geller-vines_monsters_lo`), white motes in the light (`geller-Look_of_Pic_ag`), glitter specks set into dark cave rock (f28, `geller-crystal_cave__rainbow_02`).
- **Everything is soft and rounded.** [O] Felt pads with scalloped cream rims and appliqué flames (f25), round felt leaves with pale rims and stitched veins (f29), crochet-textured mounds (f12), shag hills (f31), flocked trunks (f33). [S T2] "everything ... is rounded, there are no sharp edges."
- **Scale through tiny hero, huge flora.** [O] The troll is about 1/10 of frame height on a giant flower (f02, f03) or a moss dome (f26). [S T2] Wong: "think in macro lens"; "if we have too much detail in an image, suddenly we lose the sense of scale."
- **The world reacts.** [O] Flower petals bend under the landing (f02-f04), pods puff (f10), pads catch the fall (f25). Some reactions are creepy (eyeball pods f24, spiders f33). We don't want those.
- **Colour changes per beat.** [O] The sequence moves through teal-dark (f01), sky meadow (f02-f04), green forest (f05-f09), amber yarn and spore fields (f10-f15), pink-lavender dusk (f31-f36), with one hue family per stretch (see palettes).

## Concept art and production design findings

- **Fibre forest.** [S T1] Production designer Kendal Cronkhite: "What if we fiber-art the entire trolls forest?"; the crew "flocked the forest" and made it "more colorful and crazy". The journey is "not dark and creepy".
- **Materials list.** [S T1, T3] Director Mike Mitchell: a tree "surfaced in felt, and the ground, instead of grass, it's carpet". VFX supervisor Philippe Denis: "Our grass was felt"; dust "a little piece of fuzz"; roots from "gauze-like fabric"; the light "still responds to the world, and the world feels tangible"; "Almost like a stop-motion world."
- **Scrapbook DNA.** [S T2] Visual development artist Priscilla Wong found the look on a scrapbook page with "the right mix of felt, paper, and unconventional material". Glitter and trims went on the heroes' world, cruder lumpy materials on the antagonists'. Our book already follows this.
- **Colour roots.** [S T2, T4] Wong: Scandinavian design, "a lot of blue, greens and oranges, yellows". Cronkhite researched '70s Scandinavian design and the forests of Denmark and Norway.
- **Glow from inside.** [S T2] Pod houses shaped to "illuminate from the inside" for "really pretty lighting scenarios". [O] `geller-pods_surfacing_variations_ag`, `dreamworks-artcenter-forest-village`: pods hang on strings as lanterns and add a mid-air layer.
- **Cheap tricks were the plan.** [S T1] Shallow depth of field and matte paintings were used "to reduce rendering load". This backs our tilt-shift and a painted or gradient backdrop.
- **Ground cover spec.** [O] `geller-ground_cover_A_txt`: three tiers. Low ground has a "soft bump, shorter, tighter layer of fuzz"; mid ground a stronger bump and longer fuzz; high ground a "strong bump" with "loose long fuzz cover". Layers are base, bump, fuzz, with pink, blue and yellow flecks.
- **Plant index.** [O] `geller-plant_index_01/02`: mushrooms, sprouts, flowers, paddles and fronds drawn at 1-6x troll height; paired-leaf sprouts repeat as ground dressing.
- **Day palette.** [M] Concept day forest: teal shadow `#1B4A45` / `#4C7F75`, lime-cream light `#E2E880` / `#D5EBB3`. Greens shift teal in shade and yellow in light, about 60° of hue between them.
- **Night palette.** [M] `geller-camp`, `geller-crystal_cave`: ambient `#1C354B` navy and `#484A77` violet, glow accents `#E0C852`, `#A84A61`. [O] Firefly halos are 2-4x the emitter size.
- **Influences.** [S T3] Mitchell wanted the Miyazaki "fever dream" fairy-tale feeling, plus Adventure Time.
- **Glitter.** [S T1, T5] The 2016 film needed "a whole new system just for glitter" (procedural glitter map). On World Tour, review notes asked for "more glitter or more sparkle" so often it became a joke. Ground glitter there was animated "on ones and twos" for a stop-motion feel.

## Measured palettes

Method [M]: frames cropped to the 1280x544 picture area and downsampled to 320 px wide. Luma is Rec.709 on 0-255 sRGB. k-means with k = 8 on pooled pixels, shares in %. Highlight / mid / shadow tint is the mean colour of the brightest 5 %, the middle 10 % and the darkest 10 % of pixels. "Hue 60°" is the share of saturated pixels (s > 0.35, v > 0.2) inside the best 60° hue window. Film frames are YouTube H.264. Game frames are lossless 1672x941 PNGs from `deliverables/round-3/game/`. Scripts were run from the scratchpad and are not committed.

### Dominant colours (top clusters, % of pixels)

| Group (frames) | Clusters |
|---|---|
| Film day forest (10) | `#3C6A41` 25, `#2B352D` 24, `#9FC358` 17, `#6D9648` 13, `#DDE97C` 6, `#AF4553` 6, `#5EAC95` 5, `#9FDECD` 4 |
| Film bright meadow (6) | `#E4DA93` 20, `#47BDE9` 17, `#C1B071` 14, `#A2DFDB` 13, `#A25D57` 13, `#4F3731` 10, `#CDA3A9` 10, `#F5BB14` 4 |
| Film golden glow (6) | `#873613` 17, `#EAC851` 16, `#A54C22` 15, `#C5712D` 15, `#E0993B` 14, `#64220D` 13, `#F3DB84` 8 |
| Film pink dusk (6) | `#DCAEBE` 17, `#82878F` 16, `#6E626C` 14, `#503946` 14, `#211927` 12, `#ACA0A9` 12, `#E0D7D7` 11, `#B25A6F` 5 |
| Film dark glow (5) | `#11110C` 38, `#2D3F2B` 18, `#430A19` 15, `#8A193E` 11, `#4E6971` 5, `#DC3E6A` 5, `#C8E006` 5, `#7D9718` 3 |
| Concept day forest (6) | `#4C7F75` 20, `#1B4A45` 14, `#BEC062` 13, `#79B698` 13, `#E2E880` 12, `#D5EBB3` 11, `#A0834C` 9, `#636B1A` 8 |
| Concept night glow (2) | `#1E1515` 22, `#1C354B` 21, `#542D30` 14, `#484A77` 13, `#3C7669` 12, `#A84A61` 8, `#799FB4` 7, `#E0C852` 3 |
| **Our game, round 3 (6)** | `#F3E3CE` 25, `#A99F87` 17, `#A19B47` 13, `#D6B99D` 12, `#424E36` 11, `#925F0E` 10, `#6C6280` 7, `#D62458` 4 |

### Light statistics

| Group | Luma mean | p5-p95 | Sat mean | Sat > 0.6 | > 230 | < 40 | Top − bottom third | Hue 60° | Highlight / mid / shadow tint |
|---|---|---|---|---|---|---|---|---|---|
| Film day forest | 119 | 49-191 | 0.53 | 27 % | 2.2 % | 6.0 % | +25 | 69 % (80-150°) | `#B5D879` / `#5D834D` / `#362E2A` |
| Film bright meadow | 166 | 67-224 | 0.47 | 28 % | 3.5 % | 2.4 % | +26 | 63 % | `#ECEAB1` / `#9CBEAA` / `#643442` |
| Film golden glow | 124 | 56-198 | 0.75 | 85 % | 2.2 % | 2.6 % | +13 | 98 % (20-40°) | `#ECCE67` / `#B7692F` / `#6F2810` |
| Film pink dusk | 127 | 66-199 | 0.24 | 5 % | 1.5 % | 10.5 % | +36 | 92 % (320-340°) | `#DDD2C9` / `#947685` / `#453C4A` |
| Film dark glow | 49 | 11-121 | 0.69 | 65 % | 0.4 % | 56 % | -15 | 92 % | `#BD9855` / `#332120` / `#0F0A0B` |
| Concept day forest | 145 | 64-229 | 0.49 | 24 % | 7.0 % | 1.9 % | +30 | n/a | `#EAF5AE` / `#7E9C71` / `#393F39` |
| Concept night glow | 69 | 11-156 | 0.58 | 46 % | 0.6 % | 29 % | -1 | n/a | `#B5CF92` / `#393B4D` / `#160712` |
| **Our game, round 3** | 157 | 62-233 | 0.42 | 25 % | 17.8 % | 1.7 % | -8 | 61 % (40-60°) | `#F6E7D1` / `#A99F72` / `#6D2C38` |
| `concept-claude` refs | 138 | 59-213 | 0.53 | 38 % | 0.5 % | 1.6 % | -3 | 69 % (0-20°) | `#FBD9B7` / `#C47D6E` / `#78232F` |

Readings:
- [M] The film keeps highlights rare (≤ 3.5 % above 230) and gives them to foliage and light (lime-butter tints). In our frames the cream page takes most of them.
- [M] Film shadows sit near `#2B352D`-`#362E2A` (dark green-brown) by day and `#453C4A` (plum-grey) at dusk. Ours are maroon `#6D2C38`, which probably comes from the violet hemisphere ground colour `#6B4C8A` on cream.
- [M] Pink dusk is the least saturated group (0.24) and still reads as magical. Haze and a single hue carry that look.
- [I] Note on camera: the film mostly shoots at eye level, so the bright top third is sky and backlit haze. At our 45° pitch the top third is the far page. There the equivalent cue is aerial perspective: far things lighter and hazier.
- [O] Code vs contract drift, for the driver: `src/scene/lights.js` has key `#FFE2BD` at 2.65; `docs/contracts.md` says `#FFD9A0` at 2.2.

## Translation table: film language to our scrapbook

Budget: p95 ≤ 18 ms at 1280x720; today p95 ≈ 9.3 ms (DPR 1 and 2), so about 8 ms headroom. The renderer already draws into a HalfFloat target with a depth texture, and the tilt-shift pass already makes a half-res blurred copy. Most items below can live inside that existing pass.

| # | Element | Original version in our world | Measurable target | Perf cost |
|---|---|---|---|---|
| 1 | Exposure and grade | Lower exposure from 1.35; keep the Neutral tone map | Luma mean 120-140; p95 ≤ 215; ≤ 3 % of pixels > 230; 3-8 % < 40; sat mean 0.50-0.58 | ~0 |
| 2 | Time of day | Late-afternoon backlight: key moves from upper-left-front to the far side of the page (top of screen), elevation 30-45°, butter `#FFE9A8`. Shadows fall toward the camera and the felt sheen rims get bright | Rim highlight visible on ≥ 50 % of prop silhouettes in frame; highlight tint lime-butter (`#E0E8A0`-`#F2E6A8`), not cream | ~0 (same light; shadow frustum unchanged) |
| 3 | Shadow and bounce colour | Hemisphere ground from violet `#6B4C8A` to green-teal bounce (`#2F5A50`); pink-violet fill kept only in dusk zones | Shadow tint (darkest 10 %) within `#2E3A34`-`#3A3F3A` by day, `#453C4A` at dusk | ~0 |
| 4 | One colour per beat | Each grove/clearing zone gets a key: green-gold (default), amber, pink-lavender, teal. Props in a zone draw 60-70 % from that family plus 1-2 accents from the contract palette; a zone tint (lift/gain) blends over 2 cells in the composite | ≥ 65 % of saturated pixels inside one 60° hue window per screen (film 63-98 %; ours 61 %, mostly cream and wood) | < 0.05 ms (uniforms in the existing composite) |
| 5 | Ground as carpet | Felt moss appliqué on page cells in groves, in Geller's three tiers (low: tight short fuzz; mid: bump + longer fuzz; high: loose long fuzz), with pink, blue and butter flecks. Cream stays visible at page edges, gutters and clearings so the book still reads | Exposed cream ≤ 10 % of frame in groves (now 25 %); sunlit moss 1.5-1.8x shade luma | Texture/normal map ~0. Shell fuzz: 2-3 shells on visible moss, ~0.3-0.8 ms [I]; prefer alpha-fuzz texture |
| 6 | Depth haze | Depth-based haze in the composite: beyond the sharp band, blend toward a haze colour (day `#E9F0C0`, dusk `#F2D0DA`, amber `#F6DE9A`) up to 30-35 % at the far edge; contrast and saturation drop with it | Top-third luma ≥ bottom-third + 15 (film +25, ours -8); far props ≥ 30 % lower saturation than focus band | ~0.05-0.1 ms (one depth read already in the pass) |
| 7 | Dark foreground layer | 1-3 oversized fronds or bell-flower stems near the camera entering the bottom corners, blurred by the existing tilt-shift | 5-12 % of frame, luma 30-70; never overlaps the troll | A few extra draws, < 0.1 ms; overdraw small |
| 8 | Dappled light and shafts | World-space noise multiplies the key's shadow term in groves (blobs 0.6-1.5 units across). 2-4 additive light-shaft cards slanted along the key direction | Patch contrast 1.4-1.8x; shaft opacity 8-15 %; shafts only in grove zones | ~0.05 ms (existing material patch); shaft cards ~0.05 ms |
| 9 | Bokeh | 15-30 soft disc sprites in the defocused far band, tinted with the zone highlight colour (day `#E9F0A8`, dusk `#F6D6E4`, amber `#F7DE8A`), slow drift; never in the sharp band | Disc diameter 3-10 % of frame width (40-130 px at 1280); opacity 15-35 %; ≥ 70 % of discs in the top 40 % of frame | 1 instanced draw; overdraw ~0.1-0.2 ms at DPR 2 [I] |
| 10 | Floating motes | Fuzz tufts and pollen ("dust is a little piece of fuzz") drifting in light shafts and around the troll; 20 % of them glitter and twinkle | 80-150 on screen; 2-5 px; drift 0.05-0.2 units/s; alpha 20-50 % | 1 instanced draw, motion in the vertex shader, ~0.05 ms |
| 11 | Glowing props | Original lantern pods: translucent card seed pods hung on yarn strings between grove props; felt bell flowers and glitter-cored mushroom caps with lit insides. Strings add a mid-air layer | 3-8 lit emitters per screen; emitter luma 200-235; halo radius 1.5-3 % of frame width; colours butter `#F7DC6F`, mint `#9EE0B8`, hot pink `#E8478F`, sky `#7EC8E8` | Emissive ~0. No real point lights (each adds cost to every lit fragment); fake ground glow with an additive decal (~0.02 ms each) |
| 12 | Bloom | Threshold bloom taken from the tilt-shift's half-res HalfFloat blur, emissive-only threshold | Bloom touches ≤ 4 % of pixels in day zones; no bloom on cream page | ~0.2-0.4 ms reusing the pass [I]; ~0.6-1.2 ms as a standalone UnrealBloomPass [I] |
| 13 | Reactive bloom on fold-up | Geller's three beats on our existing fold: folded bud, then a burst 0-0.3 s after upright (glitter particles plus an emissive flash), then a steady glow while the troll is within 3 units, fading over 0.6 s on fold-down | 24-48 particles per burst; flash 1.5x settled emissive; settled emissive 0.3-0.5; ≤ 2 bursts at once; pooled, ≤ 200 particles total | ~0.05-0.1 ms; zero allocations per fold |
| 14 | Puff pods | Felt puffball tiles that release 8-12 soft puffs when the troll passes within 0.4 units | Puffs rise 0.6-1.0 units over 1.2 s, alpha 0.4 → 0, peach `#F2B48A` or lavender `#B79AE0` | Shares the particle pool, ~0.02 ms |
| 15 | Glitter placement | Move glitter onto darker felt (violet, teal, river) where pinpoints read, as in the cave walls of f28 | Keep the contract rule ≤ 1 % of glitter pixels lit; ≥ 70 % of glitter area on surfaces with luma < 120 | 0 |
| 16 | Scale | Fewer, bigger hero pieces: one landmark per grove at 2-3 units tall (3x troll with hair), plus small repeated sprouts as dressing | Landmark covers 25-40 % of frame height at the default camera; ≤ 3 distinct plant silhouettes per screen at full size | Within the 15k-triangle tile budget |
| 17 | Backdrop ("sky") | No sky is visible at 45° pitch. The background beyond the book becomes a gradient: warm wood at the bottom of the frame, hazy golden-cream toward the top/far side, matching the zone haze | Background top luma ≥ bottom + 30 | ~0 |
| 18 | Optional dusk / night zone | Cosy recipe from `geller-camp`: ambient navy `#1C354B` / violet `#484A77`, key dimmed to a cool 0.3, glow props carry the highlights, fireflies with halos | Luma mean 60-80; < 40 luma ≤ 30 %; ≥ 60 % of pixels above luma 180 come from emissives; no lime `#C8E006` on near-black | Same as items 10-12; more bloom pixels, ~+0.1-0.2 ms [I] |

Perf roll-up [I]: items 1-18 together add roughly 0.8-1.8 ms on the M5 Pro at DPR 1. At DPR 2 the fill-rate items (bloom, bokeh, shells) cost 2-3x more. My estimate for p95 is 10.5-12.5 ms against the 18 ms target. These are estimates. Add items one at a time and run `npm run perf` after each.

Suggested order (largest look change per ms first): 1, 3, 6, 4, 2, 5, 9, 10, 11 + 12, 13, then the rest.

## Do not copy

- No film characters or likenesses: Poppy, Branch, Bergens, Cooper, Smidge, the Snack Pack, the forest critters, spiders, eyeball pods, the sunglasses "hill monster", the yarn cocoon.
- No faces or eyes on plants and props. The film's forest creatures have them; ours stay plants.
- No shot recreations: troll on a moss dome against bokeh (f26), troll on a giant yellow flower against blue sky (f02), troll on a scalloped flower pad (f25), troll dangling over lime fog (f28).
- No signature props as designed: the pod houses, the flower headband, the glitter-cannon flower as drawn (we borrow only its three-beat timing), the cowbell, the caterpillar bus, Bergen Town.
- No names from the films ("Troll Village", "Bergen Town", "Happy Forest"), no song, score or voice lines, no DreamWorks or Trolls logos, fonts or title treatments.
- No tracing, texture sampling or colour-picking from downloaded images into assets. The measured hexes set grade targets; asset colours still come from our contract palette.
- No file from `reference/trolls-film/` is copied to `public/`, the build, or a commit.

## Method and limits

- Clip downloaded video-only at 720p (yt-dlp format 136); audio never fetched. Keyframes: ffmpeg scene score > 0.25, cuts < 2 s apart merged, one mid-shot frame per shot, 2-3 for long shots, end card dropped: 36 frames.
- Palettes and statistics come from small numpy/Pillow scripts run in a scratch environment (k-means k = 8, fixed seed). Film numbers include H.264 smoothing, so the film's fine specks and glitter are undercounted.
- The clip is a song montage through several biomes, not one continuous forest. Groups are mine.
- Bokeh size, dapple contrast, motes and halo sizes were judged by eye from frames [O]. The perf costs are estimates [I].
- Not reached: the art book itself (only the images the artist and fan wiki reproduce), Post Magazine's Trolls feature (404), AWN's director interview (403). I found no interview with the lighting department, so this doc does not say how DreamWorks lit the forest shot by shot.
