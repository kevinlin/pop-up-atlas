import { readFileSync } from 'node:fs'

const definitions = JSON.parse(readFileSync(new URL('../../../audio/cues.json', import.meta.url))).cues
const pitches = { sing_hum: [69, 74, 78, 81], sing_ta: [65, 67, 75, 81], sing_da: [65, 72, 78, 81] }

export function fixtureManifest() {
  const cues = Object.fromEntries(definitions.map(({ cue, kind, gain, keep }) => [cue, {
    kind,
    gain,
    files: Array.from({ length: keep }, (_, i) => ({
      src: `/audio/${cue}-${i + 1}.mp3`,
      duration: kind === 'voice' ? 0.8 : kind === 'chorus' ? 0.65 : 0.16,
      ...(pitches[cue] && { baseMidi: pitches[cue][i] }),
    })),
  }]))
  return { version: 1, cues }
}
