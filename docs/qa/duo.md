# Duo check (Round 5)

Run this after `node scripts/e2e.mjs` has produced its report. The Playwright gate measures every DUO
scenario it can (`tests/e2e/duo.feature`). This pass is for what only a person can judge: whether the pair
reads as two characters walking together, whether swaps feel immediate and fair, and whether voice B sounds
original and in character. It also covers the items tagged @manual and @external.

## Setup

1. `npm run build && npm run preview`, then open http://localhost:4173/?seed=216 in a fresh desktop Chromium
   tab at 1280x720 (and again at 1920x1080 for DUO-34 to DUO-36). Keep the tab focused. Use stereo headphones
   at a fixed, comfortable level.
2. Press any key once to unlock audio. Use WASD or the arrow keys to walk. Space swaps the lead, and so does a
   click on the follower.
3. Keep the e2e report open (`deliverables/round-5/e2e.json` or the `--out` path). With `DUO_TRACE=1`
   the gate also writes `duo-traces.json` next to it, holding every sampled frame of every duo route.
   Use it for exact frames, cue times and distances.

Automated gate: `node scripts/e2e.mjs [--out PATH] [--url URL]`. It runs headed on the host GPU;
`ATLAS_HEADLESS=1` gives a quick headless smoke at small viewports and is not the acceptance run. Each line
`PASS|FAIL DUO-NN ...` maps to the scenario with the same ID. A `not reached:` failure means the browser
part of the gate stopped before that scenario could be judged. The first such message names the cause, for
example a missing `__atlas.duo`.

## Procedure

| Check | What to do | What to see/hear | Failure |
| --- | --- | --- | --- |
| DUO-01 | Open with `?debug`, run `__atlas.duo` and `__atlas.player` in the console, swap once and repeat. | `leader` flips between `'a'` and `'b'`, and `swaps` counts up. `__atlas.player.x/z` always match the troll you steer. | A missing field, `player` tracking the follower, or a model left behind on a swap. |
| DUO-02 | Run `Blender -b --python-exit-code 1 -P blender/troll/inspect_troll.py -- public/models/troll_b.glb`, then open the GLB in a viewer. | The inspector passes. Troll B faces +Z with its origin between the feet: butter felt bean body, violet rope-twist hair column, sky knit sweater, orange umbrella on the back. | An inspector failure, the wrong facing, or anything that reads as a film character. |
| DUO-03 | Reload and do not touch anything. | A leads. B stands about one troll-and-a-half behind A, or beside A if that point is blocked. | B starts inside a prop, in front of A, or overlapping A. |
| DUO-04, DUO-37 | Swap, then immediately walk away from the follower. | The follower waits a beat until you are about 1.1 units ahead, then walks exactly where you walked. | The follower moves at once, cuts corners, or walks a different line. |
| DUO-05, DUO-06, DUO-07 | Walk straight east for several seconds, stop, then walk again. | The gap stays steady at roughly one body-length. On a start the follower catches up a little faster, and its legs speed up to match. It eases into place without overshooting. | The gap stretches past two body-lengths, the follower skates (legs too slow or too fast), or it jerks or overshoots on a stop. |
| DUO-08, DUO-09 | Stand still until the follower takes its side slot, then walk straight into it. Repeat on a yarn bridge with the follower on the deck. | On open ground it steps aside. On the bridge it holds and you pass through. You are never slowed. | The follower pushes you, blocks you, or ends up on top of you on open ground. |
| DUO-10 | Lead past props, river banks and the page edge, and make tight turns. | The follower never stands inside a prop, the river or the page margin. | Any frame with the follower clipping into a blocked cell. |
| DUO-11, DUO-12 | Stop in the open and wait 1 s. Then stop with props on both sides (a narrow gap). | In the open: a straight walk to the nearer side, turning to face roughly your heading. In the gap: it waits on your path behind you. | A curved or blocked path to the slot, facing away, or squeezing into a blocked slot. |
| DUO-13, DUO-14 | Idle 4 s. Watch the dance, then press a key mid-dance. Repeat, ending with a click on the page. | The follower starts the same dance about a third of a second after the leader, a canon, not unison. Both stop together on input. | Unison, a late or missing follower dance, or one troll dancing on alone. |
| DUO-15, DUO-16 | Walk the follower into a dead end behind a prop, then quickly walk away from it (or swap twice to get it stuck). | Once it is far behind it hops once in a low arc to just behind you. Where the straight line crosses a prop, it walks round instead. | Several hops, a hop through a prop, a hop that lands somewhere odd, or a follower left behind for long. |
| DUO-17 to DUO-24 | Swap with Space while standing, walking (key held), dancing, and while the follower is mid-hop. Click the follower while walking and while standing. Press Space three times quickly, then twice quickly. | Each swap is instant: the camera glides to the new leader, the held key keeps walking it, and the dance stops. A swap requested mid-hop applies on landing. Three quick presses swap twice in total, half a second apart. Two quick presses after a swap do nothing more. A click on the follower never makes anyone walk to the click. | A swap that is lost, doubled, or happens mid-air. The old leader keeps walking. A click on the follower starts a walk. |
| Click margin | Click just outside the follower's silhouette (within about 8 px) and then well outside it. | The near-miss still swaps. The far click walks the leader to that point. | A near-miss walks instead of swapping, or a far click swaps. |
| DUO-25 | Swap with both standing and count one second. | The camera is centred on the new leader within a second, with no snap. | A snap, a drift lasting longer than a second, or the camera staying on the old leader. |
| DUO-26 | Let the follower trail you past tiles you only skirt. | Tiles pop up and fold down around the leader only. | Tiles reacting to the follower. |
| DUO-27 to DUO-30 | Listen through walks, dances and swaps in both directions, with and without a voice playing. Swap right as a dance giggle starts. | Steps, swishes, bumps and voice come from the leader's side. A swap cuts the old voice with a quick fade and the new leader says its short lead line. A swap right after a line starts gives no extra line. No hum or dance sound carries over a swap. | Both voices at once, the follower making steps or lines, a hard click on the cut, a lead line on top of a just-started voice, or a leftover hum. |
| DUO-31, DUO-32 | Run `node audio/generate.mjs --check`. | The check fails if any required B cue or A `voice_lead` is missing, and passes on the shipping bank. The game itself skips a missing B sample silently. | `--check` passes with a cue missing, or the game errors on a missing sample. |
| DUO-33, DUO-42 | Play every B take (the e2e report lists the median f0), then swap back and forth during play. | One original voice: dry, cautious, warm underneath. Non-verbal sounds or 1-2 word exclamations, pitched clearly apart from A. Nothing resembling an actor, a film character or film lines. | Any resemblance, more than two words, an unpleasant or scary sound, or B indistinguishable from A. |
| DUO-34 to DUO-36 | At 1280x720 and 1920x1080, walk, turn, swap, hop and dance with the default camera. | Both trolls are always fully in frame. Neither covers the other or hides behind a pop-up for more than half a second. | A troll cut off at the edge, hidden, or stacked on the other. Note the tolerance (0.5 s) when showing the owner (U5). |
| DUO-38 | Walk with the follower behind, then swap. | The sharpest band sits between the two, nearer the leader, about 30 % of the way to the follower. | Either troll noticeably blurred, or the band locked to one troll. |
| DUO-39 | `npm run perf` on the host, plus the same run at commit 06da353. | p95 at DPR 1 and DPR 2 is at most the baseline plus 1.5 ms, and the existing perf targets hold. | Any target missed. Report it as unmet, never re-run until it passes. |
| DUO-40 | `node scripts/capture.mjs --round 5` with a route that includes a lead swap and a duo dance. Watch every frame and listen. | The DUO-34 to DUO-36 limits hold in the capture, and the live and captured audio match for either bank (the voice cut `end` is honoured). | A framing breach in the capture, or a missing or uncut voice in the rendered audio. |

Portrait and phone viewports are out of scope. For every finding, record the DUO ID, the viewport, the seed,
the action, what you saw or heard, and whether it repeated. Record the owner's listening and viewing verdict in
the Notes of the round-5 deliverable.
