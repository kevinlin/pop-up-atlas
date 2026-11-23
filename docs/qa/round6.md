# Round 6 check (camera, folds, faces, squash, umbrella, steps, hum)

Run this after `node scripts/e2e.mjs` has produced its report. The Playwright gate measures every R6 scenario it
can (`tests/e2e/round6.feature`), and the older checks it moved (click-to-walk, the rise and fall of one tile,
VOX-02, VOX-07, DUO-02, DUO-25, DUO-26). This pass is for what only a person can judge: whether the camera
moves feel like a camera, whether the fold reads as anticipation and settle, whether the faces and the squash
look alive and not twitchy, and whether the sounds line up. It also covers the checks that need the round-6
GLBs (`@needs-round-6-glb`), which fail on the round-5 files until those are integrated.

## Setup

1. `npm run build && npm run preview`, then open http://localhost:4173/?debug&seed=236 in a fresh desktop
   Chromium tab at 1280x720 (and again at 1920x1080 for R6-CAM-08). Keep the tab focused. Use stereo headphones
   at a fixed, comfortable level.
2. Press any key once to unlock audio. WASD or the arrow keys walk; Space swaps the lead.
3. Seeds used by the gate's routes: 236 (a cupcake tree beside a straight corridor: hero beat, dance stage, bump),
   76 (a river 21 units east of the start, for B's umbrella), 935 (a first walk that is a skip, for the hum). The
   gate prints them in the `plan` of each route in its saved results.
4. `R6_RESULTS=path node scripts/e2e.mjs` also saves every session result (duo routes and round-6 routes). The
   saved file can be re-analysed without a browser: `node scripts/e2e-duo-round6-run.mjs --load path
   [--scenario R6-CAM]`. `node scripts/e2e-duo-round6-run.mjs [--only stage,river,hum,fixed-camera]
   [--viewports 1] [--save path]` runs only the round-6 routes. `DUO_TRACE=1` writes `duo-traces.json` next
   to the report.

Automated gate: `node scripts/e2e.mjs [--out PATH] [--url URL]`. It runs headed on the host GPU; `ATLAS_HEADLESS=1`
gives a quick headless smoke at small viewports and is not the acceptance run. Each line `PASS|FAIL R6-... <title>`
maps to the scenario with the same ID, and the failure lists up to 12 problems with the frame they happened on. A
`blocked by <route>/<step>:` problem means that route step could not set up its event (for example no hero beat
within 14 s); it fails only the scenarios that step serves. A `not reached:` failure means the browser could not
start. In the console, `__atlas.camera`, `__atlas.face`, `__atlas.umbrella`, `__atlas.foldLog` and
`__atlas.hingeTrace('i,j')` show the values the gate reads; `__atlas.events.addEventListener('contact', (e) =>
console.log(e.detail))` shows the events.

## Procedure

| Check | What to do | What to see/hear | Failure |
| --- | --- | --- | --- |
| R6-CAM-01 | Walk, stop and swap on open ground and read `__atlas.camera` once the view has been calm for 2 s. | `pitch` 35, `distance` 7.5 (a little more when a character would leave the frame). The troll is large in the frame, the page reads as a table seen from slightly above. | A different pitch, a distance under 7.5, or a view that drifts while nothing happens. |
| R6-CAM-02 | Stand still for 4 s next to a prop and watch the dance from its first frame to its last. | About 0.6 s after the dance starts the camera has glided in and down (distance 4.5, pitch 22), aimed just above the feet. It glides back out over about 0.8 s after both dances finish. No cut, no overshoot. | A cut instead of a glide, a camera that stays close after the dance, or one that jerks at the dance end. |
| R6-CAM-03, R6-CAM-04 | Walk towards a mushroom house, cupcake tree or yarn bridge and pass it, then turn and pass it again within 8 s. | When the prop folds up the camera pulls in a little (6.0, 30) for about 1.5 s and returns. The second fold-up inside 8 s does not trigger another pull-in. | No pull-in for a hero prop, a pull-in for an ordinary prop, a pull-in more often than every 8 s, or one that lasts much longer than 1.5 s. |
| R6-CAM-05 | Press Space while a hero or dance pull-in is under way, then jump the leader with a swap and a long walk so the follower hops during one. | The camera eases out of the beat in about 0.8 s and follows the new leader. No snap. | A snap back, the beat continuing after the swap or the hop take-off, or a beat starting while the follower is mid-hop. |
| R6-CAM-06 | Reload with `?cam=9,40`, pass a hero prop, swap and dance. | The camera never leaves distance 9, pitch 40: no pull-in for a hero prop, no dance beat. | Any beat with a fixed camera. |
| R6-CAM-07 | Walk, swap and dance anywhere. Read `__atlas.camera` or watch the page's edges. | The page never turns: the book's spine stays horizontal in the frame. | The view rotating, even by a few degrees. |
| R6-CAM-08 | At 1280x720 and 1920x1080, walk, turn, swap, hop and dance with the default camera. | Both trolls are always fully in frame under the walk, hero and dance cameras. Neither covers the other or hides behind a pop-up for more than half a second. | A troll cut off at the edge, hidden, or stacked on the other. Note the tolerance (0.5 s) when showing the owner (U5). |
| R6-FOLD-01 | Walk straight at a row of tiles on a clean page. Watch tiles ahead of you. | Tiles within about 4.5 units tilt up a third of the way (to -63°) with a small stagger and no sound at all. Tiles you leave beyond 5.5 units lie flat again, also silently. | A pop, a chime or a voice cue for the half-lift, or a half-lifted tile far behind you. |
| R6-FOLD-02 | Walk onto a half-lifted tile's radius (2 units). | A very small dip first (about 4°, a beat of anticipation), then the tile springs up. A tile that was flat holds for a moment and then springs up, without the dip. The pop and chime start with the dip. | No anticipation, a dip large enough to read as a glitch, or the sound late. |
| R6-FOLD-03 | Watch several tiles rise from the half-lift and from flat. | The tile crosses upright in under half a second, overshoots a little (about one sixth of its travel) and is still within 1.4 s. | A tile that wobbles for seconds, never overshoots, or arrives more slowly than before. |
| R6-FOLD-04 | Walk past a folded-up tile and keep going. | Beyond 3 units it folds down, but only to the half-lift while you are within 5.5 units; further away it settles flat. One pop, none for the second step. | A tile that goes flat at once beyond 3, a second pop, or a tile that stays half-lifted far away. |
| R6-FOLD-05 | Stand next to a flower, mushroom house or cupcake tree (within 1.8 units of either troll) until the dance starts. | The tiles beside the trolls fold down as the dance starts, with the usual pop for an upright one and silently for a half-lifted one. They stay flat for the whole dance, then come back by the normal rules. | A prop that stays up through the dance, one that pops back up during it, or a prop that folds down with no dance. |
| R6-CHR-01, R6-CHR-02 | Listen and watch the leader's face through `ooh`, `hmph`, `hm`, `hup`, `whee`, the lead line, a hum, the dance song and a giggle. Swap and repeat with B. | The mouth matches the sound: round for ooh/eep, a down-turned line for hmph, flat for hm, a wide "ee" for hup, open smile for whee and the lead line, the sing mouth for every sung note, a giggle that alternates open and grin about 8 times a second. It returns to rest a tenth of a second after the sound ends, and straight away when a swap cuts the voice. B's mouths come from B's own cues. | A mouth that stays open, a wrong shape, one that lags noticeably, or A's mouth on B's voice. |
| R6-CHR-03 | Stand still and watch both faces for 30 s. | Each troll blinks every few seconds, quick and soft. Between blinks A's eyes are fully open and B's slightly sleepy. | A blink faster than every 2.5 s, a lid that stays half-shut on A, or a twitch. |
| R6-CHR-04 | Walk, dance and make the follower hop. Watch the body. | A small squash on each footfall, a bigger squash when the dance jump lands, a stretch at hop take-off and a squash at the landing. Volume looks constant (wider when shorter) and the body settles in under a second. | A squash that does not spring back, a stretch that looks like a growth spurt, or no squash on a landing. |
| R6-CHR-05 | Lead with B (Space) into a river bank, keep the key down, then let B dance. | B's orange umbrella pops open on the collision and again at the dance's bow, and folds closed about a second later (or at once when the dance ends). A repeated collision re-opens it at most every 3 s. A has no umbrella. | An umbrella open for no reason, one that stays open, or one on A. |
| R6-CHR-06 | With A leading, stand 1 s, then walk (reload until a walk starts as a skip). | A walks with two hops (a skip), still read as walking: `__atlas.player.state` stays `'walk'`, never `'skip'`. | A state called `skip`, or the troll sliding during the skip. |
| R6-CHR-07 | Lead with A, stand about 4 s (B first walks to its side slot and has to stand there for 2 s), then walk. Watch B. | B turns to look around for about 0.6 s, standing still, then follows. A swap during the look cuts it and B takes over at once. | B walking while it looks, a look that ignores the swap, or a look while B leads. |
| R6-AUD-01 | Walk a straight line and listen. | One felt step per foot contact, at the left foot's contact (clip time 0) and half a clip later: 0.5 s apart for A, 0.4 s for B. Only the leader's feet make sound. | A late or doubled step, steps from the follower, or a cadence that does not match the legs. |
| R6-AUD-02 | Step in and out of one prop's fold distances (about 2 and 3 units) twelve times in a row, each fold-up within 6 s of the last, so the melody reaches the fourth note of its second phrase (the top note, above MIDI 78); then stand still for the hum. | The hum echoes the last notes of the melody. Notes above MIDI 78 are sung an octave lower, in A's comfortable range. | A hum note squeaking above the melody's register. |

Portrait and phone viewports are out of scope. For every finding, record the R6 ID, the viewport, the seed, the
action, what you saw or heard, and whether it repeated. Record the owner's listening and viewing verdict in
the Notes of the round-6 deliverable.
