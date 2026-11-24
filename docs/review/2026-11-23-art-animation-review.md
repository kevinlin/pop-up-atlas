# Art and animation review: round-5 build

- Date: 2026-11-23.
- Build: `main` at 05ef136 (round 5 plus the controls guide).
- Reviewer: Claude Code, in the role of art and animation director.
- Readers: the project owner, and the agents that implement round 6.

## Scope
- The request was to recapture Princess Poppy and Branch with the art direction of the clip "Trolls - Poppy In The Forest Scene" (`docs/research/trolls-stage-design.md`).
- This review does not move the characters toward the film designs. They are copyrighted characters, the brief requires original characters, and the owner chose an original duo in round 5 (`docs/log.md`, 2026-11-22).
- The review judges the art direction of the clip: fibre world, light, colour, staging and performance. It treats troll A and troll B as an original pair with a similar role split: a sunny lead and a wary companion.
- Earlier owner decisions stay in force. The scrapbook look is the base (cream pages, wood table). The full round-4 stage, the bokeh discs and the frame-wide zone tint stay out.

## Method
- I played the production build in Chrome at 1280x720, DPR 1. I used the default camera and a close camera (`?cam=3.5,22`) for the walk, the fold-ups and the idle dance.
- I stepped through `deliverables/round-5/gameplay-30s.mp4` frame by frame. That capture matches `main`, except for the controls guide, which the game hides under automation.
- I compared both against the clip keyframes (`reference/trolls-film/`, gitignored, style only) and `reference/concept-r5/`.
- Not reviewed: sound, perf and a live lead swap.

Evidence frames are in [2026-11-23-frames/](2026-11-23-frames/). All of them are game frames; none comes from the film.

## Scores
| Axis | This review | Last critic (C5) |
|---|---|---|
| Look | 5 | 5.31 (toy mean) |
| Fold motion | 6 | not scored in C5 |
| Walk | 5 | 7 (B walk and hair) |
| Dance | 6 | 9 (duo dance) |
| Hair | 6 | 7 (B walk and hair) |
| Character appeal | 4 | part of the look mean |

My motion scores are lower than C5 because this review judges acting and appeal at gameplay distance. C5 judged the mechanics: gap, delay and timing.

## Verdict
The pop-up mechanic works, and the knit and crochet details read as handmade at close range. At gameplay distance the build still looks like a tech toy. The largest gaps are the camera, the faces and the lack of squash and stretch. The models need less work than those three.

## What works
- The knit sweater, the crochet scarf and the red satchel read as handmade at close range ([live-close-idle.jpg](2026-11-23-frames/live-close-idle.jpg)).
- Each fold starts with the tallest piece and shows a visible overshoot. The mushroom cap leads, and the house body follows about 180 ms later ([fold-mushroom-15fps.jpg](2026-11-23-frames/fold-mushroom-15fps.jpg)).
- The rainbow yarn bridge, the glitter river and the violet cast shadows are good scrapbook moments.
- In the dance, the follower copies the leader 0.31 s later, and the hair of troll A whips in the turn. This is the best acting in the build ([dance-10fps.jpg](2026-11-23-frames/dance-10fps.jpg), rows 3-4).

## Look notes
### L1. The default camera frames a map of the page.
- At the default camera, the troll bodies fill about 10 % of the frame height, and the faces are dots ([live-default-walk.jpg](2026-11-23-frames/live-default-walk.jpg)).
- The capture route stays on the page edge. So the book edge and the wood table fill about 40 % of each frame (at 3.5, 8.5 and 26.9 s in [capture-overview-1fps.jpg](2026-11-23-frames/capture-overview-1fps.jpg)).
- The clip uses low macro shots, where the flora towers over the hero.
- Fix: keep a high angle for walks, as the brief asks, but move the camera to 7-8 units at a pitch of about 35°.
- Fix: add a lower, closer beat camera for the dance and for hero fold-ups.
- Fix: show the book edge once, as an establishing shot, and keep the rest of the capture route on the page.
- Owner decision: the beat camera departs from the "high-angle" camera in the brief. Contract section: "Camera and light".

### L2. The tilt-shift blur is too strong.
- The sharp band is thin and the blur is heavy. A flower that folded up at the depth of the troll was already soft.
- In close-camera frames, blurred foreground shapes cover up to a third of the frame ([live-close-idle.jpg](2026-11-23-frames/live-close-idle.jpg)).
- Fix: widen the sharp band, and cut the maximum blur by about a third. Contract numbers: band 30 %, maximum blur 1.5 % of the image width.

### L3. Flat front light gives the felt a vinyl look.
- The white dots on the mushroom cap render grey.
- The signature light of the clip is a backlit fuzz rim. The owner rejected a global rear key in round 4 because it bleached the cream page.
- Fix: add a rim light or a fuzz boost only on the trolls and the hero props. The trolls are already tagged in the surface buffer (log, V2c review pass 2), so the cream page does not change.

### L4. The ground reads as separate stickers.
- The meadow islands float apart on the cream page. Each island carries the same pink rectangles, and they read as price tags.
- Fix, without the round-4 moss: make the appliqué shapes bigger, and layer them 2-3 deep so that they interlock.
- Fix: replace the rectangles with mixed, sparser details, such as French knots, sequins and small buttons.

### L5. The props are flat cards, and the trolls are stuffed.
- The two material languages do not match. In mid-fold, the mushroom cap is one card seen edge-on, and the cupcake tree reads as a purple umbrella.
- The production rule of the clip is "everything rounded" (`docs/research/trolls-stage-design.md`).
- Fix: give the hero caps stuffed felt, or a dome of 2-3 cards (V-fold or box fold), so that they have volume.

### L6. Each screen carries the full rainbow.
- The clip keeps one hue family per beat: 69-98 % of saturated pixels sit in one 60° hue window (research doc).
- The owner rejected the frame-wide zone tint in round 4.
- Fix: give each zone a prop colour set, for example mostly pinks and violets in one grove. Keep the page and the grade as they are.

## Animation notes
### A1. The faces never act. This is the largest gap in appeal.
- Neither troll has a mouth, but both say "ooh", giggle, "hmph" and sing a "ta-da".
- Fix: add 4-5 stitched mouth shapes as a texture flipbook, plus felt eyelid blinks.
- Fix: drive the shapes from events that the cue director already sends. For example, `voice_ooh` gives a round "o" and `voice_hmph` gives a flat line. A sung cue opens the mouth. No rig change is necessary.

### A2. The bodies have no squash and stretch.
- The bodies stay rigid ovoids through the steps, the turn and the bow.
- Fix: add a runtime scale layer on the root or spine, the same way the hair spring works. Use about 5 % squash on each foot contact, about 12 % on the dance landing, and a stretch on the hop.

### A3. Both trolls move the same way.
- Troll B uses the walk and dance clips of troll A through the retarget (log, round 5). So the wary troll walks like the sunny one.
- The walk of troll A is mostly a vertical bob, with no forward lean and a small arm swing ([walk-20fps.jpg](2026-11-23-frames/walk-20fps.jpg)).
- Fix for A: a forward lean, a bigger arm swing and a skip variant.
- Fix for B: shorter steps, a slight hunch, and a look around before it starts to walk.
- A duo reads through contrast. This fix needs Blender.

### A4. The hair does not show emotion.
- On the walk, the plume of troll A moves as a bundle of stiff quills. The rope column of troll B barely moves.
- Fix: make the hair stand taller on "ooh" and droop on "hmph", with offsets on the hair chain that the cues drive.
- Fix: give the coil of troll B a spring bounce on each step.

### A5. The umbrella of troll B is invisible at gameplay distance.
- The umbrella is the key silhouette prop of troll B.
- Fix: use it in an action. Troll B opens it on the river "eep", or bows with it at the end of the dance.

### A6. The dance has no stage.
- At gameplay size the bow barely reads. A blue blade prop crosses troll B in mid-dance (capture 26-29 s, [dance-10fps.jpg](2026-11-23-frames/dance-10fps.jpg)).
- Fix: when the dance starts, fold down the props within about 1 unit to clear a small stage.
- Fix: cut to the beat camera (L1), and make the arm arcs bigger ([live-close-dance-turn.jpg](2026-11-23-frames/live-close-dance-turn.jpg) shows the turn pose at close range).

### A7. The folds are clear but mechanical.
- Each piece swings up as a rigid rotation on its hinge.
- Fix: add a 3-5° dip before the release (anticipation).
- Fix: bend the card a little with its speed, then let it straighten (a vertex-shader bend).
- Fix: let doors and petals settle 60-100 ms after the main card.

### A8. The pop-up mechanic is rare on screen.
- The fold-up radius is 2 units. A 5.3-unit walk east from the spawn point gave one new fold-up, a flower (measured twice in Chrome). Three meadows had folded up at load.
- The 30 s capture logs 10 fold-up layer cues: 5 hero props and 5 path tiles.
- Fix: use a two-stage fold. Tiles at 3-5 units lift to about 30 %, and complete at 2 units. This keeps the round-1 fix for missed folds. Contract section: "Fold behaviour".

## Priority
Cheapest high-impact fixes come first.
1. Camera distance and pitch, the beat camera, and a capture route away from the table (L1).
2. Mouth flipbook and blinks (A1).
3. Rim light on the trolls only (L3).
4. Squash and stretch, and hair that the cues drive (A2, A4).
5. Two-stage fold, plus anticipation and follow-through (A7, A8).
6. Separate walk, idle and dance acting for troll B (A3, A5; needs Blender).
7. Volume for the hero props and interlocked ground appliqué (L4, L5; needs Blender, highest cost).

Items L1, L2, A8 change numbers in `docs/contracts.md`. Change the contract, the code and the tests together, and add a line to `docs/log.md`.
