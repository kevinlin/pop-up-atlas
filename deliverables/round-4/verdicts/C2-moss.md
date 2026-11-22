# C2: MOSS listening audit, round 4

Local MOSS-Audio-8B-Instruct on the six blind audio pairs (`listen.py ab --repeats 3 --probe-all-defects`), three 10 s windows per pair. Raw answers per pair are in `moss/pair-N.json`.

This is an audit of what is audible, not a vote. In the L1 calibration MOSS could not tell a clean clip from one with a loud steady tone or +30 dB clipping, so its preferences and defect answers are not evidence.

## What it heard

- Voice lines are present on every side that has the voice ("hup", "ooh", a giggle, "whee") and absent on the sides without it: the old baseline and the voice-removed mix.
- The fold layers and footsteps read as "sharp clicks and clacks" and "a soft thud", with "a bright synthesized chime" for the melody.
- No defect was flagged on either side of any pair: steady tone, clipping, overbearing voice, harsh sound, repetition all answered "no".

## Where it is wrong

- Pair 3 (music only) and pair 5 (whole mix vs old baseline), 20-30 s window: MOSS describes "a sustained electronic tone at 110 Hz, buzzy". Both music stems are digital silence from 20 s on (no folds in the last 10 s of the route), so this caption is invented.

## Before this run

The capture's mix check found a click: the synth envelope left each gain node at its default of 1 until its first scheduled event, so a start time with float noise let one raw sample of the yarn-pluck buffer through at full gain on every bridge step (-15.5 dBFS). MOSS was not run on that build. Fixed in 5026951; steps now sit 19.7 dB under the voice.
