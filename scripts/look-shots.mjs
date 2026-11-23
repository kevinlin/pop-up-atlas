import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { createSteppedPage, launchChromium, previewURL } from './capture.mjs'
import { shots, shotViewport, takeShot } from './sbs.mjs'

// The walk camera of docs/contracts.md "Round 6" → Camera (distance 7.5, pitch 35). `?cam=` pins it and turns the beats off, so
// a hero fold-up or a dance never swaps the pose of a look-stats shot.
export const walkCamera = [7.5, 35]

// The six pinned look-stats shots (docs/contracts.md "Round 6" → Light, ground and props): seed, pose and staging are recorded
// here, each shot is a duo shot (both characters in frame, the per-character checks need both) at the walk camera. The
// poses are the round-5 and round-6 sbs poses, which are known to stage cleanly (`planShot`), re-projected at the walk
// camera instead of their own lenses (tests/look-stats.test.js stages every one of them and checks the hero tile ids).
// `heroProp` names the hero tile a fold shot springs up.
export const lookShots = [
  // 1 walk: A skips ahead down the felt path, B a body length behind.
  { name: 'walk', seed: 0, x: -0.48, z: -5.25, heading: Math.PI / 4, state: 'walk', keys: ['KeyD', 'KeyS'], frames: 39, duo: true, followerState: 'walk', anchor: [0.5, 0.64] },
  // 2 mushroom house springing up beside the pair.
  { name: 'fold-mushroom', seed: 0, x: 0.65, z: -2.7, heading: 0.95, state: 'idle', frames: 17, fold: { dir: 'up', i: 1, j: -2 }, duo: true, anchor: [0.4, 0.68], heroProp: 'mushroom_house' },
  // 3 cupcake tree springing up beside the pair.
  { name: 'fold-cupcake', seed: 0, x: 9, z: 3.2, heading: 0.95, state: 'idle', frames: 17, fold: { dir: 'up', i: 5, j: 1 }, duo: true, anchor: [0.4, 0.64], heroProp: 'cupcake_tree' },
  // 4 bridge: B leads over the yarn bridge, A right behind.
  { name: 'bridge', seed: 42, x: 23.2, z: 8, heading: Math.PI / 2, state: 'walk', keys: ['KeyD'], frames: 40, model: 'yarn_bridge', duo: true, swap: true, followerState: 'walk', anchor: [0.5, 0.66] },
  // 5 dance on the clearing: the leader about a second into the dance, the follower behind its canon.
  { name: 'dance', seed: 167, x: -4, z: 5.4, heading: 0.1, state: 'dance', followerState: 'dance', frames: 150, model: 'flower', duo: true, anchor: [0.5, 0.62] },
  // 6 river bank: B leads east toward the river bank on seed 0, short of the collision.
  { name: 'river', seed: 0, x: 38.2, z: 2.4, heading: Math.PI / 2, state: 'walk', keys: ['KeyD'], frames: 40, duo: true, swap: true, followerState: 'walk', anchor: [0.5, 0.66] },
].map((shot) => ({ ...shot, cam: walkCamera }))

const names = lookShots.map(({ name }) => name)
const focusPoints = [[22, 2], [0.8, -5.25], [2, -3.9], [24, 8.28], [-4, 8], [-2, -3.8]]

// The round-3 before/after stills (`--before`) keep their own six shots.
async function main() {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: { before: { type: 'boolean' } },
  })
  assert(positionals.length <= 1,
    'Usage: node scripts/look-shots.mjs [URL] [--before]')
  const baseURL = positionals[0] ?? previewURL
  const variant = values.before ? 'before' : 'after'
  const out = resolve('.handoff/evidence/T7/r3')
  const stillNames = ['establishing', 'walking', 'fold-up', 'river-bridge', 'dance', 'fold-back']

  await mkdir(out, { recursive: true })
  const browser = await launchChromium()
  try {
    const capture = await createSteppedPage(browser, shotViewport)
    for (const [index, shot] of shots.entries()) {
      const url = new URL(baseURL)
      // The before capture uses the prior renderer's default focus at the same camera pose.
      if (!values.before) url.searchParams.set('focus', focusPoints[index].join(','))
      const number = String(index + 1).padStart(2, '0')
      await takeShot(capture, url.href, shot, resolve(out, `${number}-${stillNames[index]}-${variant}.png`))
    }
  } finally {
    await browser.close()
  }
}

export { names as lookShotNames }

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main()
