import { BoxGeometry, Group, Mesh, MeshLambertMaterial, Scene } from 'three'
import { expect, it, vi } from 'vitest'

// Every math object the fold path could create per frame is counted at construction.
const counts = vi.hoisted(() => ({ created: 0 }))
vi.mock('three', async (importOriginal) => {
  const three = await importOriginal()
  const counting = (Base) => class extends Base {
    constructor(...args) {
      super(...args)
      counts.created += 1
    }
  }
  return {
    ...three,
    Vector2: counting(three.Vector2),
    Vector3: counting(three.Vector3),
    Matrix4: counting(three.Matrix4),
    Quaternion: counting(three.Quaternion),
    Euler: counting(three.Euler),
    Box3: counting(three.Box3),
    Sphere: counting(three.Sphere),
    Color: counting(three.Color),
  }
})

const { events } = await import('../src/scene/runtime.js')
const { createArt } = await import('../src/world/art.js')
const { createTileStream } = await import('../src/world/stream.js')
const { VARIANTS } = await import('../src/world/tiles.js')

function fixtureTile(id) {
  const root = new Group()
  root.name = id
  const hinge = new Group()
  hinge.name = 'hinge_0'
  root.add(hinge)
  const card = new Mesh(new BoxGeometry(0.6, 1, 0.01).translate(0, 0.5, 0), new MeshLambertMaterial({ name: 'card_fixture' }))
  card.name = 'card_part'
  hinge.add(card)
  const sec = new Group()
  sec.name = 'sec_0'
  sec.position.set(0, 1, 0)
  hinge.add(sec)
  const door = new Mesh(new BoxGeometry(0.2, 0.2, 0.01).translate(0, 0.1, 0), new MeshLambertMaterial({ name: 'felt_fixture' }))
  door.name = 'door_part'
  sec.add(door)
  return root
}

it('creates no math objects across 600 fold updates with folds, bends, secs and a dance stage in play', () => {
  const flower = VARIANTS.find(({ id }) => id === 'flower')
  const scene = new Scene()
  const layout = { getCell: () => flower }
  const art = createArt(scene, undefined, layout)
  art.addTile('flower', fixtureTile('flower'))
  const folds = []
  const stream = createTileStream(scene, layout, (fold) => folds.push(fold), undefined, { art })
  const leader = { x: 0, z: 0 }
  const frame = (n) => {
    leader.x = 0.9 * Math.sin(n * 0.011)
    leader.z = 3 * Math.sin(n * 0.037)
    stream.update(0.01, n * 0.01, leader, 16 / 9)
  }
  for (let n = 0; n < 100; n += 1) frame(n)

  // Events dispatch outside the measured calls; every update() call is measured on its own.
  let allocated = 0
  let live = 0
  for (let n = 100; n < 700; n += 1) {
    if (n === 300) events.dispatchEvent(new CustomEvent('duo-dance-start', { detail: { t: n * 0.01 } }))
    if (n === 500) events.dispatchEvent(new CustomEvent('duo-dance-end', { detail: { t: n * 0.01, interrupted: false } }))
    const before = counts.created
    frame(n)
    allocated += counts.created - before
    for (const mesh of scene.children) {
      const bend = mesh.isInstancedMesh && mesh.geometry.attributes.instanceBend
      if (bend && bend.array.some((value) => value !== 0)) live += 1
    }
  }
  stream.dispose()

  expect(allocated).toBe(0)
  expect(live).toBeGreaterThan(100)
  expect(folds.some(({ cause }) => cause === 'stage')).toBe(true)
  expect(folds.filter(({ dir }) => dir === 'up').length).toBeGreaterThan(3)
})
