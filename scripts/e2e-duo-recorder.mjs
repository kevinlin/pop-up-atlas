// In-page recorder for the round-6 gate (R6-*, tests/e2e/round6.feature). It sits beside the duo probe (which it cannot
// change) and records what the probe's per-frame sample does not carry:
//   events   every event on `__atlas.events` (docs/contracts.md "Round 6" → Events), stamped with the frame being stepped;
//   frames   per stepped frame, keyed by frame number: [look active, look catch-up, A scale.y, B scale.y, A scale.x, B scale.x]
//            (the follower-look flags, and the `root` bone's scale of each rig as a ratio of its rest scale: squash);
//   hinges   `hingeTrace` samples (time, angle) of every tile within 9 units of the leader, read every <= 90 frames (the
//            ring buffer holds 200 samples) and kept only where the angle changes.
// `capture()` runs at the start of each stepped frame (for the frame before it, after its microtasks flushed) and at
// the end of every driver run; `dump()` returns plain JSON.
const eventTypes = [
  'dance-start', 'dance-end', 'duo-dance-start', 'duo-dance-end', 'contact', 'cue', 'cue-end', 'bump', 'hop', 'swap',
]

// Runs in the page. Free of closures so Playwright can serialise it.
function recorder({ types }) {
  const atlas = window.__atlas
  const shots = window.__atlasLookShots
  if (!atlas?.events || !shots?.scene) throw new Error('The round-6 recorder needs __atlas.events and ?look-shots&look-probe')
  const { scene } = shots
  const rec = { frame: 0, events: [], frames: {}, hinges: {}, lastRead: -Infinity }

  // The same rig discovery as the probe: a rig is the ancestor of one `hair_3` bone that holds no other tip; A leads at
  // install time, so the rig standing on the leader is A.
  const tips = []
  scene.traverse((node) => { if (node.isBone && node.name === 'hair_3') tips.push(node) })
  const contains = (node, target) => {
    let found = false
    node.traverse((child) => { if (child === target) found = true })
    return found
  }
  const rigs = tips.map((tip) => {
    let root = tip
    while (root.parent && root.parent !== scene && !tips.some((other) => other !== tip && contains(root.parent, other))) root = root.parent
    let hips
    root.traverse((node) => { if (!hips && node.isBone && node.name === 'root') hips = node })
    hips ??= root
    const position = root.getWorldPosition(root.position.clone())
    return { root, hips, base: hips.scale.clone(), away: Math.hypot(position.x - atlas.player.x, position.z - atlas.player.z) }
  })
  if (rigs.length !== 2) throw new Error(`Expected two troll rigs in the scene, found ${rigs.length}`)
  rigs.sort((a, b) => a.away - b.away)
  const [a, b] = rigs

  for (const type of types) {
    atlas.events.addEventListener(type, (event) => {
      rec.events.push({ type, f: rec.frame, detail: { ...event.detail } })
    })
  }

  function readHinges(frame) {
    rec.lastRead = frame
    const { x, z } = atlas.player
    for (let i = Math.floor((x - 9) / 2); i <= Math.ceil((x + 9) / 2); i++) {
      for (let j = Math.max(-5, Math.floor((z - 9) / 2)); j <= Math.min(4, Math.ceil((z + 9) / 2)); j++) {
        const samples = atlas.hingeTrace(`${i},${j}`)
        if (!samples.length) continue
        const cell = rec.hinges[`${i},${j}`] ??= { last: -Infinity, samples: [] }
        for (const sample of samples) {
          if (sample.t <= cell.last) continue
          cell.samples.push([sample.t, sample.angle])
          cell.last = sample.t
        }
      }
    }
  }

  function capture() {
    const frame = rec.frame
    if (frame <= 0) return
    const look = atlas.duo?.look
    rec.frames[frame] = [look?.active ? 1 : 0, look?.catchUp ? 1 : 0, a.hips.scale.y / a.base.y, b.hips.scale.y / b.base.y,
      a.hips.scale.x / a.base.x, b.hips.scale.x / b.base.x]
    if (frame - rec.lastRead >= 90) readHinges(frame)
  }

  // Keep a sample when its angle differs from a neighbour's: motion stays contiguous, rest collapses to its edges.
  const compress = (samples) => samples.filter((sample, k) => k === 0 || k === samples.length - 1
    || sample[1] !== samples[k - 1][1] || sample[1] !== samples[k + 1][1])

  const step = window.__atlasStep
  window.__atlasStep = (frame, fps, count = 1) => {
    capture()
    rec.frame = frame + count - 1
    return step(frame, fps, count)
  }

  window.__r6rec = {
    capture,
    dump() {
      readHinges(rec.frame)
      const hinges = {}
      for (const [key, cell] of Object.entries(rec.hinges)) hinges[key] = compress(cell.samples)
      return { events: rec.events, frames: rec.frames, hinges }
    },
  }
}

export const installRecorder = (page) => page.evaluate(recorder, { types: eventTypes })
export const readRecorder = (page) => page.evaluate(() => window.__r6rec.dump())
