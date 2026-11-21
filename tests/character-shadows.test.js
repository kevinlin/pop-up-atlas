import { Bone, Group, Scene } from 'three'
import { expect, test } from 'vitest'
import { createFootShadows } from '../src/character/foot-shadows.js'

test('each contact follows its own sole and fades when that foot lifts', () => {
  const scene = new Scene()
  const model = new Group()
  scene.add(model)
  const feet = ['L', 'R'].map((side, index) => {
    const foot = new Bone()
    foot.name = `foot_${side}`
    foot.position.set(index ? -0.073 : 0.073, 0.046, 1)
    foot.quaternion.set(0, Math.SQRT1_2, Math.SQRT1_2, 0)
    model.add(foot)
    return foot
  })
  const update = createFootShadows(scene, model)
  const [left, right] = ['L', 'R'].map((side) => scene.getObjectByName(`contact_foot_${side}`))
  const centerY = (shadow) => shadow.geometry.attributes.position.getY(24)

  update()
  expect(left.position.x).toBeCloseTo(0.073)
  expect(left.position.z).toBeCloseTo(1.032)
  expect(right.position.x).toBeCloseTo(-0.073)
  expect(left.material.opacity).toBeGreaterThan(0.5)
  expect(centerY(left)).toBeLessThan(-0.03)

  feet[0].position.set(0.8, 0.126, 1.3)
  update()
  expect(left.position.x).toBeCloseTo(0.8)
  expect(left.position.z).toBeCloseTo(1.332)
  expect(left.material.opacity).toBeLessThan(right.material.opacity)
  expect(centerY(left)).toBeCloseTo(0.006)
  expect(right.position.x).toBeCloseTo(-0.073)
})
