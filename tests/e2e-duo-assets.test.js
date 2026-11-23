import { describe, expect, it } from 'vitest'
import { checkRig, checkTrollB, rigContract, summarizeGlb } from '../scripts/e2e-duo-assets.mjs'

// Synthetic glTF rigs (JSON + one binary buffer) that satisfy the round-6 character contract; each test breaks one thing.
function buildRig(rig, tweak = {}) {
  const chunks = []
  const accessors = []
  const bufferViews = []
  let offset = 0
  const accessor = (values, type, extra = {}) => {
    const floats = Float32Array.from(values.flat())
    chunks.push(Buffer.from(floats.buffer))
    bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: floats.byteLength })
    offset += floats.byteLength
    const size = { SCALAR: 1, VEC3: 3, VEC4: 4 }[type]
    accessors.push({ bufferView: bufferViews.length - 1, componentType: 5126, count: floats.length / size, type, ...extra })
    return accessors.length - 1
  }
  const sampler = (times, values, type) => ({
    input: accessor(times, 'SCALAR', { min: [times[0]], max: [times.at(-1)] }),
    output: accessor(values, type),
    interpolation: 'LINEAR',
  })
  const rotY = (angle) => [0, Math.sin(angle / 2), 0, Math.cos(angle / 2)]

  const names = ['root', 'foot_L', 'foot_R', 'head', 'hair_0', 'hair_1', 'hair_2', 'hair_3', 'hand_r', 'hand_l',
    'eye_l', 'eye_r', 'lid_l', 'lid_r', 'mouth', ...(rig === 'b' ? ['umbrella_closed', 'umbrella_open'] : [])]
  const index = (name) => names.indexOf(name)
  const parentOf = { foot_L: 'root', foot_R: 'root', head: 'root', hand_r: 'root', hand_l: 'root', hair_0: 'head', hair_1: 'head',
    hair_2: 'head', hair_3: 'head', eye_l: 'head', eye_r: 'head', lid_l: 'head', lid_r: 'head', mouth: 'head',
    umbrella_closed: 'hand_r', umbrella_open: 'hand_r' }
  const nodes = names.map((name) => ({ name }))
  Object.assign(nodes[index('foot_L')], { translation: [-0.1, 0, 0] })
  Object.assign(nodes[index('foot_R')], { translation: [0.1, 0, 0] })
  Object.assign(nodes[index('head')], { translation: [0, 0.5, 0] })
  Object.assign(nodes[index('hand_r')], { translation: [0.2, 0.6, 0] })
  Object.assign(nodes[index('hand_l')], { translation: [-0.2, 0.3, 0] })
  for (const lid of ['lid_l', 'lid_r']) nodes[index(lid)].extras = { lidOpen: 0.8 }
  if (rig === 'b') {
    nodes[index('umbrella_closed')].scale = [1, 1, 1]
    nodes[index('umbrella_open')].scale = [0, 0, 0]
  }
  for (const [child, parent] of Object.entries(parentOf)) (nodes[index(parent)].children ??= []).push(index(child))

  const materials = [
    { name: `felt_${rig}_body` }, { name: `yarn_${rig}_hair` }, { name: 'felt_mouth' },
  ]
  const position = accessor([[0, 0, 0]], 'VEC3', { min: [-0.1, 0, -0.1], max: [0.1, tweak.top ?? 1.0, 0.1] })
  const mouthPosition = accessor([[0, 0, 0]], 'VEC3', { min: [0, 0, 0], max: [0.1, 0.1, 0.1] })
  const meshes = [
    { primitives: [{ attributes: { POSITION: position }, material: 0 }] },
    { primitives: [{ attributes: { POSITION: mouthPosition }, material: tweak.mouthMaterial ?? 2 }] },
  ]
  accessors[position].count = tweak.triangles ?? 3000 // non-indexed: count / 3 triangles
  nodes.push({ name: 'body', mesh: 0 })
  nodes[index('mouth')].mesh = 1
  accessors[mouthPosition].count = 3

  // Dance pose curves: head y keys give landing 1.67 and a 0.35 s slow stretch from 2.19; heading yaw turns from 0.92 to 1.67.
  const danceEnd = tweak.danceSeconds ?? 3
  const markers = { turnStart: 0.92, landing: 1.67, bow: 2.19, ...tweak.markers }
  const headY = [[0, 0.5], [markers.landing, 0.5 - 0.19 * (markers.bow - markers.landing)], [markers.bow, 0.5], [markers.bow + 0.35, 0.5], [markers.bow + 0.45, 0.7], [danceEnd, 0.5]]
  const channels = []
  const samplers = []
  const track = (node, path, times, values, type) => {
    samplers.push(sampler(times, values, type))
    channels.push({ sampler: samplers.length - 1, target: { node, path } })
  }
  track(index('head'), 'translation', headY.map(([t]) => t), headY.map(([, y]) => [0, y, 0]), 'VEC3')
  track(index('head'), 'rotation', [0, markers.turnStart, markers.landing, danceEnd],
    [rotY(0), rotY(0), rotY(1.5), rotY(1.5)], 'VEC4')
  const lift = tweak.wristLift ?? 0.4
  track(index('hand_r'), 'translation', [0, 1.5, danceEnd], [[0.2, 0.6, 0], [0.2, 0.6 + lift, 0], [0.2, 0.6, 0]], 'VEC3')
  const animations = [{ name: 'dance', samplers, channels }]
  const clipTimes = { walk: rig === 'a' ? 1.0 : 0.8, idle: 2, ...(rig === 'a' ? { skip: 1.0 } : { look: 0.6 }) }
  for (const [name, seconds] of Object.entries(clipTimes)) {
    const spec = tweak.clipSeconds?.[name] ?? seconds
    const s = sampler([0, spec], [[0, 0, 0], [0, 0, 0]], 'VEC3')
    animations.push({ name, samplers: [s], channels: [{ sampler: 0, target: { node: index('root'), path: 'translation' } }] })
  }
  for (const name of tweak.dropClips ?? []) animations.splice(animations.findIndex((clip) => clip.name === name), 1)

  const joints = names.map((_, i) => i).filter((i) => !(tweak.dropBones ?? []).includes(names[i]) && !/^(eye|lid|mouth|umbrella)/.test(names[i]))
  const json = {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [index('root'), nodes.length - 1] }],
    nodes, meshes,
    materials: tweak.materials ?? materials,
    skins: [{ joints }],
    animations, accessors, bufferViews,
    buffers: [{ byteLength: offset }],
  }
  tweak.edit?.(json, index)
  return { json, bin: Buffer.concat(chunks) }
}

const summarize = (rig, tweak) => summarizeGlb(buildRig(rig, tweak))
const check = async (rig, tweak) => checkRig(rig, await summarize(rig, tweak))

describe('round 6 per-rig static checks', () => {
  it('passes a rig that meets the contract, for A and for B', async () => {
    expect(await check('a')).toEqual([])
    expect(await check('b')).toEqual([])
  })

  it('does not ask A for look or B for skip', async () => {
    const a = await summarize('a')
    const b = await summarize('b')
    expect(a.clips).toEqual(['dance', 'idle', 'skip', 'walk'])
    expect(b.clips).toEqual(['dance', 'idle', 'look', 'walk'])
    expect(checkRig('a', a)).toEqual([])
    expect(checkRig('b', b)).toEqual([])
    expect(checkRig('a', b).join('\n')).toMatch(/lacks clips skip/)
    expect(checkRig('b', a).join('\n')).toMatch(/lacks clips look/)
  })

  it('requires the shared bones, head and hand_r included', async () => {
    expect((await check('a', { dropBones: ['hand_r'] })).join('\n')).toMatch(/lacks bones hand_r/)
    expect((await check('b', { dropBones: ['head', 'hair_3'] })).join('\n')).toMatch(/lacks bones head, hair_3/)
  })

  it('requires the face nodes, lids under head with lidOpen, and the felt_mouth mesh', async () => {
    const nodeMissing = await check('a', { edit: (json) => { json.nodes.find((n) => n.name === 'eye_r').name = 'eye_x' } })
    expect(nodeMissing.join('\n')).toMatch(/face nodes eye_r/)
    const lid = await check('b', { edit: (json) => { delete json.nodes.find((n) => n.name === 'lid_l').extras } })
    expect(lid.join('\n')).toMatch(/lid_l has no extras.lidOpen/)
    const moved = await check('b', {
      edit: (json, index) => {
        const head = json.nodes[index('head')]
        head.children = head.children.filter((child) => child !== index('lid_r'))
        json.nodes[index('root')].children.push(index('lid_r'))
      },
    })
    expect(moved.join('\n')).toMatch(/lid_r is under root, not head/)
    expect((await check('a', { mouthMaterial: 0 })).join('\n')).toMatch(/mouth must be a mesh with material felt_mouth/)
  })

  it('requires B to carry the umbrella nodes under hand_r, the open one at scale 0, and does not ask A for them', async () => {
    expect((await check('b', { edit: (json) => { json.nodes.find((n) => n.name === 'umbrella_open').name = 'umbrella_x' } })).join('\n'))
      .toMatch(/lacks umbrella nodes umbrella_open/)
    expect((await check('b', { edit: (json) => { json.nodes.find((n) => n.name === 'umbrella_open').scale = [1, 1, 1] } })).join('\n'))
      .toMatch(/umbrella_open is authored at scale \[1, 1, 1\]/)
    expect((await check('b', {
      edit: (json, index) => {
        const hand = json.nodes[index('hand_r')]
        hand.children = hand.children.filter((child) => child !== index('umbrella_closed'))
        json.nodes[index('root')].children.push(index('umbrella_closed'))
      },
    })).join('\n')).toMatch(/umbrella_closed is under root, not hand_r/)
    expect((await summarize('a')).nodes.umbrella_closed).toBeUndefined()
  })

  it('checks clip lengths per rig and the dance length', async () => {
    expect((await check('b', { clipSeconds: { walk: 1.0 } })).join('\n')).toMatch(/walk lasts 1.000 s \(need 0.8/)
    expect((await check('a', { clipSeconds: { walk: 0.8 } })).join('\n')).toMatch(/walk lasts 0.800 s \(need 1/)
    expect((await check('a', { danceSeconds: 3.2 })).join('\n')).toMatch(/dance lasts 3.200 s/)
    expect(await check('a', { danceSeconds: 3.04 })).toEqual([])
  })

  it('reads the dance markers off the pose curves and holds them to ±0.03 s', async () => {
    const dance = (await summarize('a')).clipInfo.dance
    expect(dance.source).toBe('pose curves')
    expect(dance.markers.landing).toBeCloseTo(1.67, 1)
    expect(Math.abs(dance.markers.landing - 1.67)).toBeLessThanOrEqual(0.03)
    expect(Math.abs(dance.markers.turnStart - 0.92)).toBeLessThanOrEqual(0.03)
    expect(Math.abs(dance.markers.bow - 2.19)).toBeLessThanOrEqual(0.03)
    expect(Math.abs(dance.markers.bowHold - 0.35)).toBeLessThanOrEqual(0.05)
    expect((await check('a', { markers: { landing: 1.5 } })).join('\n')).toMatch(/dance marker landing is at 1\.5\d* s/)
    expect((await check('b', { markers: { bow: 2.4 } })).join('\n')).toMatch(/dance marker bow is at 2\.4\d* s/)
  })

  it('prefers markers carried in the clip extras', async () => {
    const good = await check('a', { edit: (json) => { json.animations[0].extras = { markers: { turnStart: 0.92, landing: 1.67, bow: 2.19, bowHold: 0.35 } } } })
    expect(good).toEqual([])
    const bad = await check('a', { edit: (json) => { json.animations[0].extras = { markers: { turnStart: 0.92, landing: 1.75, bow: 2.19, bowHold: 0.35 } } } })
    expect(bad.join('\n')).toMatch(/landing is at 1.750 s .*extras/)
  })

  it('requires the wrist path to span 0.35 units vertically', async () => {
    expect((await summarize('a')).clipInfo.dance.wristSpan).toBeCloseTo(0.4, 2)
    expect((await check('a', { wristLift: 0.2 })).join('\n')).toMatch(/wrist path spans 0\.2\d* units/)
  })

  it('holds the hair tip to 1.05 and the origin between the feet to 0.02', async () => {
    expect(await check('a', { top: 1.05 })).toEqual([])
    expect((await check('b', { top: 1.2 })).join('\n')).toMatch(/exceeds the 1.05 hair tip/)
    // 0.95 (the round-5 B limit) no longer applies.
    expect(await check('b', { top: 1.0 })).toEqual([])
    const shifted = await check('a', { edit: (json, index) => { json.nodes[index('foot_L')].translation = [0.05, 0, 0]; json.nodes[index('foot_R')].translation = [0.15, 0, 0] } })
    expect(shifted.join('\n')).toMatch(/origin is not between the feet \(> 0.02/)
    expect(rigContract.originTolerance).toBe(0.02)
  })

  it('holds triangles and rig-specific materials', async () => {
    expect((await check('a', { triangles: 60_000 })).join('\n')).toMatch(/has 20001 triangles/)
    expect((await check('a', { materials: [{ name: 'felt_b_body' }, { name: 'yarn_a_hair' }, { name: 'felt_mouth' }] })).join('\n'))
      .toMatch(/material felt_b_body of the other rig/)
    expect((await check('b', { materials: [{ name: 'felt_b_body' }, { name: 'felt_mouth' }] })).join('\n')).toMatch(/no yarn_b_\* material/)
    expect((await check('b', { materials: [{ name: 'felt_b_body' }, { name: 'yarn_b_hair' }, { name: 'plain' }, { name: 'felt_mouth' }] })).join('\n'))
      .toMatch(/material "plain" has no felt_/)
  })

  it('keeps checkTrollB(a, b, contract) working for the e2e gate and applies the B rig contract', async () => {
    const a = await summarize('a')
    const b = await summarize('b')
    expect(checkTrollB(a, b, { hairTip: 0.95, bodyHeight: [0.5, 0.6], maxTriangles: 20000, maxTexture: 1024 })).toEqual([])
    expect(checkTrollB(a, await summarize('b', { dropClips: ['look'] }), {})).toEqual(expect.arrayContaining([expect.stringMatching(/lacks clips look/)]))
  })
})
