# Sound and voice listening check

Use stereo headphones at a comfortable level. Open the built game in a fresh
desktop Chromium tab with `?seed=0` and keep it focused. Use the arrow keys
or WASD. Start with no input and keep the volume fixed while comparing surfaces,
voices and chimes.

| Check | What to do | What to hear | Failure |
| --- | --- | --- | --- |
| VOX-01 | Let the first idle dance finish without pressing a key or clicking. Then press a movement key and walk. | Silence before input. Footsteps and nearby fold sounds after input. | A sound before input, persistent silence after input, or a sample that cuts in with a click. Use the Playwright report to confirm the files come from the manifest. |
| VOX-02 | From the starting area, hold Up for several seconds through the felt. | A soft step about twice a second, alternating slightly left and right, with changing takes. | A missed or doubled step, hard or erratic panning, or a repeated identical take. |
| VOX-03 | On seed 0, follow the north page edge to the first paper trail, turn down onto its eastward branch and follow it to the yarn bridge. Walk along the bridge, turn before the far end, and leave from the entry side. Re-enter. | A drier paper tap, then at least four rising yarn notes if you stay on the bridge long enough. The first notes are D5, E5, F#5, A5, B5, D6. A short whee on an eligible exit, and D5 again on re-entry. | Felt steps in place of paper taps, incorrect or out-of-order pluck pitches, a climb that carries over from the last visit, or repeated whees. Let a prior voice finish and wait 2.5 seconds from its start and 15 seconds from a prior exit whee to hear another eligible exit. |
| VOX-04 | Walk north up the open starting column until the page edge blocks you. For a quiet approach, back away for about five seconds and walk straight back. Keep holding Up for two seconds on contact. | One soft bump and a grumpy hmph close together. | A missing or delayed line on an eligible hit, rattling against the edge, repeated grunts, or a startling impact. |
| VOX-05 | Pass several different pop-ups and keep walking until they fold flat behind you. | A short material sound riding each pop. Upright layers vary by tile and the closing layer is quieter. | Extra layers without a pop, a pop missing its layer, a doubled or late layer, or a closing sound that dominates. |
| VOX-06 | Walk past props, start and stop, then listen to a bridge exit and an idle dance. Keep playing for at least a minute. | One intelligible troll line at a time, with room between reactions. Dance sounds can follow each other more quickly. | Lines overlap, reactions chatter, or the troll voice becomes tiring or scary. |
| VOX-07 | Walk until several chimes have sounded, then release the keys without touching the mouse. | A hum after about 1.5 seconds. It repeats up to the last three melody notes in order at roughly 0.31-second intervals. | Silence with a recent chime, a late hum, a wrong note, or a long tail that masks the next note. |
| VOX-08 | Keep waiting after the hum so the troll finishes a full dance. | At four seconds idle, two claps, then a giggle. Hear the spin and whee together, A4 on the bow, D5 after it, then a quieter village answer. | A missing sound, a cue visibly out of sync, off-pitch singing, or the chorus drowning out the troll. |
| VOX-09 | Start another dance. Tap a movement key just after the spin and listen through the time the bow would have ended. | The dance stops before the bow, and its last two sung notes and village answer are absent. | A bow note or chorus plays after the key press. |
| VOX-10 | Walk across several folds. Wait about 2 to 3 seconds after a fold-up, then walk to the next one. Repeat with a pause longer than 6 seconds. Walk where two different tiles rise together. | The short pause keeps the melody on its next note, on a grid aligned to the new fold. The long pause starts the phrase again on D. When harmony sounds it starts with the melody and sits two pentatonic steps below it, or above it at the range floor. Listen for different tile timbres. | A short pause restarts the tune, a long pause carries on the old phrase, or harmony starts late, clashes, or masks the melody. |

Listen for crackling, clipping, harsh peaks, voice fatigue, and anything that
sounds scary across the whole session. Record the VOX ID, seed, location or
action, what you heard, and whether it repeated. Use the Playwright JSON report
for exact cue times, file provenance, intervals and pitch. Listen in the live
game to judge the mix and character of the sounds.
