// Blind old-vs-new motion pairs for the round-6 motion critic (goal "Critic criteria": 6 old-vs-new motion pairs).
// Each pair is one moment of the two 30 s captures, as an 8-frame burst (every 6th frame, 0.1 s apart): the burst of one
// capture above the other, the side drawn by `blindPairs`. The key goes to a separate folder the critic never sees.
//   node scripts/motion-pairs.mjs --old deliverables/round-5/gameplay-30s.mp4 --new deliverables/round-6/gameplay-30s.mp4 \
//     --out deliverables/round-6/critic-inputs/motion --key deliverables/round-6/key [--seed N] [--same-route]
// `--same-route`: both captures follow the round-6 route (a C6 fix against the preceding candidate), so both use `new` frames.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { blindPairs } from './capture-audio.mjs'

// Start frames (60 fps) of matched moments, from each capture's route log: round 5 = .handoff/evidence/P0/round-5/
// capture-onsets.json (swap 897, dance 1559, fold-ups at 1.4/3.1/4.7/6.4 s), round 6 = the round-6 capture plan (swap 580,
// dance 1556, fold-ups at 2.8/4.1/4.5/6.0 s). Dance moments are offset from the dance start by the shared beat markers.
export const moments = [
  { name: 'lead-walk', old: 300, new: 330 },
  { name: 'fold-up', old: 279, new: 267 },
  { name: 'swap', old: 897, new: 580 },
  { name: 'companion-leads', old: 1000, new: 700 },
  // From 1.0 s: the end of the turn, the anticipation stretch (1.57 s) and the landing (1.67 s).
  { name: 'dance-turn', old: 1559 + 60, new: 1556 + 60 },
  { name: 'dance-bow', old: 1559 + 125, new: 1556 + 125 },
]

const ffmpeg = (args) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args])

function burst(video, frame, out) {
  ffmpeg(['-ss', (frame / 60).toFixed(4), '-i', video, '-vf', "select='not(mod(n\\,6))',scale=480:-1,tile=4x2:padding=4:color=white",
    '-frames:v', '1', out])
}

async function main() {
  const { values } = parseArgs({ options: { old: { type: 'string' }, new: { type: 'string' }, out: { type: 'string' }, key: { type: 'string' }, seed: { type: 'string' }, 'same-route': { type: 'boolean' } } })
  assert.ok(values.old && values.new && values.out && values.key, 'Usage: node scripts/motion-pairs.mjs --old VIDEO --new VIDEO --out DIR --key DIR [--seed N]')
  const seed = values.seed ? Number(values.seed) : randomBytes(4).readUInt32LE()
  const temp = await mkdtemp(join(tmpdir(), 'motion-pairs-'))
  try {
    await Promise.all([mkdir(values.out, { recursive: true }), mkdir(values.key, { recursive: true })])
    for (const { name, old, new: next } of moments) {
      burst(values.old, values['same-route'] ? next : old, join(temp, `${name}-old.png`))
      burst(values.new, next, join(temp, `${name}-new.png`))
    }
    const { pairs, key } = blindPairs(moments.map(({ name }) => ({ name, first: `${name}-old`, second: `${name}-new` })), { seed })
    for (const { pair, a, b } of pairs) {
      // A above, B below, a white band between.
      ffmpeg(['-i', join(temp, `${a}.png`), '-i', join(temp, `${b}.png`), '-filter_complex',
        '[0]pad=iw:ih+24:0:0:white[top];[top][1]vstack', join(values.out, `${pair}.png`)])
    }
    await writeFile(join(values.key, values['same-route'] ? 'motion-fix-key.json' : 'motion-key.json'), `${JSON.stringify(key, null, 2)}\n`)
    assert.equal(pairs.length, moments.length)
    console.log(`Wrote ${pairs.length} blind motion pairs to ${values.out} and the key to ${values.key}`)
  } finally {
    await rm(temp, { recursive: true, force: true })
  }
}

await main()
