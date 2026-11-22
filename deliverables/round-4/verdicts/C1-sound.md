# C1: blind sound critic, round 4

Read-only data critic (deep_reasoner, job job-2026-11-22T00-27-17-89020-C1) on six anonymised pairs of 30 s renders (A = pair-N-x, B = pair-N-y), wavs and spectrograms only. Turn 1, preferences, verbatim:

| Pair | Preferred | Confidence | A / 10 | B / 10 | Audible reason |
|---|---|---|---:|---:|---|
| 1 | A | Medium | 8 | 7 | A gives the final reaction a playful falling reply at 27.15–28.00 s. B goes silent at 27.15 s. |
| 2 | B | Medium | 8 | 9 | The pop at 5.99 s has about 15 dB less energy in the 2.5–5 kHz band in B, giving it a softer attack. |
| 3 | A | Medium | 5 | 4 | At 16.29 s, A rings on a lower note and stays audible through 16.64 s. B's higher note fades by about 16.45 s. A gives the phrase more of a landing. |
| 4 | A | High | 8 | 5 | The pitch-bending voice reaction at 18.91–19.70 s gives A a clear character beat. A is about 21 dB louder than B over that interval. |
| 5 | A | High | 8 | 4 | A has another expressive rising-and-falling reaction at 25.27–26.27 s. B has already gone silent by 18.78 s. |
| 6 | B | Medium | 7 | 8 | B's soft, step-like taps at 7.02 and 7.52 s give the walk a pulse between chimes. A is silent at both moments. |

- **Pair 1** A adds a second pitched contour under the shared closing sound from about 26.96 s.
- **Pair 2** A also has two isolated clacks at 24.32 and 24.64 s, before the next voice reaction.
- **Pair 3** A changes the chime pitches as well as the sustain. At 14.78 s, A is near 440 Hz and B is near 660 Hz.
- **Pair 4** A carries the voice reactions over the pops and chimes. The held hum-like tone at 21.84–22.84 s is also absent in B.
- **Pair 5** B is a sparse sequence of pops and chimes, with just over 11 seconds of silence at the end.
- **Pair 6** B adds low, short taps at roughly half-second intervals from 5.52 to 8.07 s.

**Lesson learned.** Whole-clip RMS was effectively identical in pairs 1, 2, and 6. Comparing matched moments exposed changes in phrasing, attack, and rhythm.

## Key (added by the driver after turn 1)

| Pair | A | B | Preference means |
|---|---|---|---|
| 1 | full mix | without chorus | keep the chorus |
| 2 | full mix | without sfx | prefers without the sfx layer (borderline: 8 vs 9, medium) |
| 3 | new music (folds) | old music (folds-baseline) | keep the new music |
| 4 | full mix | without voice | keep the voice |
| 5 | new whole mix | old whole mix (baseline 7b6489c) | new mix wins |
| 6 | without steps | full mix | keep the steps |

## Turn 2: diagnosis

Job job-2026-11-22T00-27-17-89020-C1-r2, verbatim:

### Pair 1

**Change B.** Keep the closing reaction and add a falling reply that carries from 27.15 to about 28.00 s. A’s reply descends from roughly 660 to 460 Hz and averages −31 dBFS RMS over that interval. Use that level as a starting point.

**Defects.** B goes effectively silent at 27.15 s, leaving the closing phrase shorter. In both sides, the held tone around 22.83 s drops from −15 to −68 dBFS RMS in about 20 ms, giving it a hard stop.

### Pair 2

**Change A.** Soften the texture attacks with the cuts below. Apply them to the added texture around each peak, usually over 10–30 ms, and ease back to full level through the decay. Keep the low body of the taps, especially the thud at 20.08 s and the two clacks before the voice at 24.32 and 24.65 s.

**Defects.** The table lists the sharper A events from a full-file scan using 21 ms stereo RMS windows stepped every 5 ms. It includes bursts with at least 3 dB of excess in an affected band and captures added energy down to about −68 dBFS. The quietest rows are lower-priority edges. B loses the low thud at 20.06–20.11 s, where it is 20 dB quieter overall, and is digitally silent at both 24 s clacks.

| Peak time (s) | Band (kHz) | A above B (dB) | Cut on A’s texture (dB) |
|---|---:|---:|---:|
| 0.080 | 5–10 / 10–20 | 4.7 / 9.1 | 5 / 8 |
| 1.005 | 2.5–20 | 27.7 | 12 |
| 1.625 | 1–10 | 35.9 | 6 |
| 1.750 | 1–2.5 | 55.1 | 4 |
| 2.665, 2.725, 2.790, 2.840 | 2.5–10 | 12.3, 18.3, 13.2, 8.6 | 6 each |
| 3.355 | 2.5–10 | 5.3 | 5 |
| 4.350 | 2.5–10 | 45.2 | 16 |
| 4.955 | 2.5–10 | 31.0 | 5 |
| 6.005 | 1–5 | 19.4 | 16 |
| 6.690 | 2.5–10 | 54.5 | 5 |
| 8.295 | 2.5–10 | 39.0 | 5 |
| 8.415 | 1–2.5 | 68.4 | 4 |
| 9.955 | 2.5–10 | 32.0 | 5 |
| 10.110 | 1–2.5 | 37.1 | 3 |
| 11.100, 11.125 | 5–20 | 32.1, 33.8 | 4 each |
| 11.195 | 2.5–10 | 61.3 | 12 |
| 12.790 | 2.5–10 | 51.2 | 8 |
| 12.920 | 5–20 | 18.7 | 3 |
| 14.505 / 14.530 | 2.5–10 / 10–20 | 9.0 / 4.1 | 3 each |
| 14.585, 14.610 | 5–20 | 11.6, 12.3 | 4 each |
| 14.680 | 1–10 | 52.2 | 12 |
| 15.390 | 2.5–10 | 43.9 | 5 |
| 16.175 | 2.5–10 | 9.9 | 3 |
| 16.235 | 1–10 | 40.0 | 12 |
| 16.995 | 2.5–10 | 14.2 | 6 |
| 17.115 | 1–2.5 | 14.5 | 4 |
| 17.835, 17.905 | 2.5–10 | 22.5, 37.0 | 5 each |
| 18.040 | 1–10 | 23.5 | 10 |
| 18.655 | 1–10 | 15.7 | 6 |
| 18.990, 19.025 | 5–10 / 10–20 | 6.0 / 20.3, then 3.0 / 20.6 | 4 / 12 each |
| 20.065 | 2.5–10 | 18.6 | 7 |
| 24.320, 24.645 | 2.5–10 | B silent. A at −45.9, −40.6 dBFS | 5, 7 |
| 25.400 | 5–10 / 10–20 | 11.4 / 19.0 | 10 / 12 |

### Pair 3

**Change B.** Try the lower 440 Hz note at 14.78 s and a 587 Hz landing at 16.32 s. Lengthen the landing so its 16.38–16.50 s tail is near A’s −31 dBFS RMS. B’s tail is about −49 dBFS there.

**Defects.** B repeats the 660/740 Hz pitches from 4.43 and 6.33 s at 14.78 and 16.32 s. Both sides are digitally silent from 18.78 s to the end, an 11.22 s gap.

### Pair 4

**Change B.** Restore the pitch-bending reaction at 18.91–19.70 s and aim for about −20 dBFS RMS in the mix, close to A. Add the held, hum-like accent at 21.84–22.84 s, where A averages −15 dBFS and B is silent.

**Defects.** B’s remaining sound is about 21 dB quieter over the 18.91–19.70 s reaction. A has a possible masking spot at 16.29 s. The shared chime is about 17 dB above the added reaction over a 40 ms window, so the start of that reaction can get crowded.

### Pair 5

**Change B.** Bring back the early voice beat at 2.64–3.96 s, where A averages −21 dBFS RMS and B averages −36. Restore the late reaction at 25.27–26.27 s around A’s −20 dBFS RMS, and add a soft step near 7.03 s at roughly A’s −28 dBFS peak.

**Defects.** B is silent after 18.78 s, leaving the final 11.22 s empty. A has a sharp burst over the late reaction at 25.40 s that reaches −29 dBFS RMS in the 5–10 kHz band.

### Pair 6

**Change A.** Add soft steps at 7.03, 7.53, and 8.08 s. B’s taps peak around −28 dBFS and average around −42 dBFS RMS over their short attack windows. Vary the tap samples slightly to keep the movement from sounding mechanical.

**Defects.** A is nearly silent from 6.74–8.25 s at −90 dBFS RMS. B’s isolated taps at 6.08 and 8.08 s have nearly identical waveforms after alignment, and the roughly half-second cadence exposes the repetition.

**Lesson learned.** Short-window band levels locate sharp attacks that whole-clip RMS misses. Waveform subtraction helps distinguish an added texture from the voice or chime underneath it.
