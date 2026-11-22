# C1b: blind sound critic, round 4, second round (after the softened fold-layer attacks)

Read-only data critic (deep_reasoner, job job-2026-11-22T09-17-28-66080-C1b) on six freshly captured, reshuffled pairs of 30 s renders at bda4a19 (A = pair-N-x, B = pair-N-y), wavs and spectrograms only. Turn 1, preferences, verbatim:

| Pair | Preferred | Confidence | A /10 | B /10 | Audible reason |
|---|---|---|---:|---:|---|
| 1 | B | High | 4 | 8 | The rising and falling vocal reaction at 2.7–3.9 s gives the troll personality. A has a brief chime and pop in that span. |
| 2 | B | High | 6 | 8 | The pitched, hum-like phrase at 21.84–22.84 s gives B a musical beat in a gap that is silent in A. |
| 3 | B | Medium | 7 | 8 | B’s soft descending flourish at 27.2–28.0 s gives the ending a more playful finish. |
| 4 | B | Medium | 7 | 8 | Two short, papery shuffles at 24.30 and 24.62 s give the next voice reaction a tactile lead-in. |
| 5 | A | Medium | 5 | 4 | A’s chime at 16.28 s has stronger overtones and rings through about 16.7 s, giving it a fuller, bell-like sound. |
| 6 | A | Medium | 8 | 7 | Soft, footstep-like taps around 7.01, 7.51 and 8.06 s keep a walking pulse through a quiet stretch. |

**Pair 1.** At 3.05–3.13 s, B’s pitched reaction measures −18 dBFS RMS. A’s chime has faded to −89 dBFS RMS.

**Pair 2.** Around 18.94–19.02 s, B also carries a pitched vocal glide over the bright rustle that dominates A.

**Pair 3.** A goes quiet just after 27.15 s. B’s final tone falls from about 650 Hz at 27.4 s to about 440 Hz near 28.0 s.

**Pair 4.** B also gives the pop at 20.03–20.11 s more low-end weight. It measures about 18 dB louder than A in that window.

**Pair 5.** A also changes the tune. The notes near 14.73 and 16.29 s go from 440 to 587 Hz in A and from 660 to 740 Hz in B.

**Pair 6.** A’s low taps recur near 9.01 and 9.51 s. B is silent at both taps.

**Lesson learned.** Check apparent silence against the WAV. Pair 6 B’s PNG omits the late pitched passages present in its audio.

## Key (added by the driver after turn 1)

| Pair | A | B | Preference means | Round 1 (C1-sound.md) |
|---|---|---|---|---|
| 1 | old whole mix (baseline 7b6489c) | new whole mix | new mix wins, 8 vs 4 (high) | new mix wins, 8 vs 4 |
| 2 | without voice | full mix | keep the voice, 8 vs 6 (high) | keep, 8 vs 5 |
| 3 | without chorus | full mix | keep the chorus, 8 vs 7 | keep, 8 vs 7 |
| 4 | without sfx | full mix | keep the softened sfx layer, 8 vs 7 | preferred without, 9 vs 8 |
| 5 | new music (folds) | old music (folds-baseline) | keep the new music, 5 vs 4 | keep, 5 vs 4 |
| 6 | full mix | without steps | keep the steps, 8 vs 7 | keep, 8 vs 7 |

Revert rule: no pair prefers "without" a round-4 feature, so nothing is reverted. This was sound critic round 2 of 2.

## Turn 2: diagnosis

Job job-2026-11-22T09-17-28-66080-C1b-r2, verbatim:

### Pair 1

**Change A.** Add short voiced reactions around 2.7–3.9 s and 21.84–22.84 s. Use B’s −18 dBFS RMS at 3.05–3.13 s as a level reference. Give the 2.84 s chime time to speak before the reaction peaks.

**Defects.** A averages −99.5 dBFS RMS from 18.70 s to the end. In B, the voice and chime are both about −24 to −25 dBFS RMS at 2.84–2.98 s, creating a masking risk where they overlap.

### Pair 2

**Change A.** Keep the chimes and paper effects, and restore the pitched body around them. Start with the 21.84–22.84 s phrase, which is silent in A and −14.9 dBFS RMS in B. Then try the local cuts below on the effects alone if their edges still stand out.

**Attack comparison.** Across the full clip, no 21 ms window above −65 dBFS in the measured 3–20 kHz bands had A at least 0.5 dB louder than B. A’s attacks mostly sound more exposed because there is less energy below them. The table lists every burst meeting the exposure screen of at least 3 dB more high-band energy *relative to the lower band*, with the high band at −65 dBFS or above.

| Time (s) | Band (kHz) | A minus B, absolute | A’s extra relative brightness | Starting cut on A’s effect |
|---|---:|---:|---:|---:|
| 0.045–0.085 | 6–20 | −1.3 dB | +7.3 dB | 2 dB |
| 2.700–2.845 | 6–20 | −0.2 dB | +19.7 dB | 2–3 dB |
| 3.355–3.360 | 3–6 | −1.2 dB | +21.6 dB | 2 dB |
| 3.525–3.535 | 3–6 and 6–20 | −1.1 and −0.5 dB | +13.6 and +13.9 dB | 2 dB |
| 16.210–16.245 | 3–6 and 6–20 | 0.0 and −0.1 dB | +3.9 and +3.5 dB | 1 dB |
| 16.420–16.435 | 3–6 | −1.1 dB | +3.4 dB | 1 dB |
| 16.535–16.545 | 6–20 | −2.5 dB | +11.8 dB | 2 dB |
| 16.960–17.040 | 3–6 and 6–20 | −1.4 and −0.1 dB | +21.3 and +15.2 dB | 2 dB |
| 17.110–17.125 | 3–6 | −1.8 dB | +15.5 dB | 1 dB |
| 18.640–18.675 | 3–6 | −0.5 dB | +4.3 dB | 1 dB |
| 18.935–19.160 | 6–20 | −0.6 dB | +21.6 dB | 4–6 dB |
| 25.235–25.540 | 3–6 and 6–20 | −0.9 and 0.0 dB | +22.8 and +4.0 dB | 3 dB at 3–6 kHz, 4–6 dB at 6–20 kHz |
| 27.065–27.070 | 6–20 | −3.0 dB | +5.9 dB | 1 dB |
| 27.145–27.150 | 6–20 | −3.4 dB | +8.5 dB | 1 dB |

In 5.3 ms windows, A also briefly exceeds B by at least 1 dB at **2.862, 16.210, 16.962 and 25.294–25.376 s** in 3–6 kHz (+3.6, +1.2, +1.3 and up to +1.8 dB), **25.502 s** in 15–20 kHz (+1.4 dB), and **27.068 s** in 6–10 kHz (+1.1 dB). Carry the local trims through those peaks. At 2.862 s, start with 2 dB on the 3–6 kHz noise alone.

**Defects.** Both sides have their strongest paper fizz near 18.99 and 25.38 s, around −32 and −31 dBFS in 6–20 kHz. The rustle at 12.00–12.15 s repeats sample-for-sample at 14.00–14.15 s. A also has a near-empty stretch from 20.20–24.29 s at −78 dBFS RMS.

### Pair 3

**Change A.** Add a descending tail starting just before 27.15 s. Use B’s −30 dBFS RMS over 27.20–27.80 s as the level target, then fade toward 28.0 s.

**Defects.** A drops from −20 dBFS RMS at 27.142 s to below −97 dBFS at 27.150 s in 1 ms windows, making the ending abrupt. Both sides have a sharp paper burst around 25.38 s at about −31 dBFS in 6–20 kHz.

### Pair 4

**Change A.** Restore the two short paper shuffles at 24.30 and 24.62 s. A is silent in both windows. B gives level references of −40 and −38 dBFS RMS over 80 ms.

**Defects.** B’s 6–20 kHz burst at 25.38 s is 24 dB above A in that band, while the level below 3 kHz is unchanged. The extra fizz risks obscuring consonant detail. B has a smaller version of the same issue at 18.99 s, with an 11 dB increase in 6–20 kHz.

### Pair 5

**Change B.** Give the 16.28 s chime a lower, fuller ring. Try A’s 587 Hz note in place of B’s 740 Hz, with an overtone near 1.17 kHz about 8 dB below the fundamental. Aim for a decay around −40 dBFS RMS over 16.44–16.71 s. B is already down to −75 dBFS there.

**Defects.** A’s 6.29 s attack peaks about 8 dB higher than B in 3–6 kHz, giving it a sharper edge. Both sides average −99.5 dBFS RMS from 18.70 s onward, leaving the last 11.3 s effectively silent.

### Pair 6

**Change B.** Bring back low, soft taps around 7.01, 7.51, 8.06, 9.01 and 9.51 s. B is silent at those events. Match A’s roughly −44 to −42 dBFS RMS over each 60–70 ms tap, with most of the energy below 1 kHz.

**Defects.** B is digitally silent from 8.57–9.90 s, interrupting the walking pulse. A repeats the same 150 ms effect sample-for-sample at 12.00 and 14.00 s, which can make the movement sound looped.

**Lesson learned.** Compare absolute high-band level with its level relative to the body of the sound. A shared rustle can stand out more when the voice drops away.
