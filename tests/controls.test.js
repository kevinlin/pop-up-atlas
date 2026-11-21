import { PerspectiveCamera, Vector3 } from 'three'
import { expect, test } from 'vitest'
import { createMovement, createPlayer } from '../src/controls/movement.js'

const open = () => false

function setup(cameraPosition = [0, 10, 8]) {
  const camera = new PerspectiveCamera()
  camera.position.set(...cameraPosition)
  camera.lookAt(0, 0, 0)
  const player = createPlayer()
  return { player, movement: createMovement(player, camera) }
}

test('keyboard movement follows camera yaw and normalizes diagonals', () => {
  const { player, movement } = setup([8, 10, 0])
  movement.update(0.5, 0, 1, open)
  expect(player.position.x).toBeCloseTo(-0.6)
  expect(player.position.y).toBe(0)
  expect(player.position.z).toBeCloseTo(0)
  expect(player.heading).toBeCloseTo(-Math.PI / 2)
  expect(player.state).toBe('walk')

  movement.update(0.5, 1, 1, open)
  expect(player.velocity.length()).toBeCloseTo(1.2)
  expect(player.position.z).toBeCloseTo(-0.6 / Math.sqrt(2))

  movement.update(0.5, 0, 0, open)
  expect(player.state).toBe('idle')
  expect(player.velocity.length()).toBe(0)
})

test('click-walk arrives without overshooting and stops', () => {
  const { player, movement } = setup()
  const destination = new Vector3(0, 0, 0.35)
  movement.walkTo(destination)
  movement.update(0.25, 0, 0, open)
  expect(player.position.z).toBeCloseTo(0.3)
  expect(player.state).toBe('walk')

  movement.update(0.25, 0, 0, open)
  expect(player.position).toEqual(destination)
  expect(player.state).toBe('idle')
  expect(player.velocity.length()).toBe(0)
  movement.update(0.25, 0, 0, open)
  expect(player.position).toEqual(destination)
})

test('a blocked step stops and clears the click target', () => {
  const { player, movement } = setup()
  movement.walkTo(new Vector3(0, 0, 1))
  movement.update(0.25, 0, 0, open)
  movement.update(0.25, 0, 0, (_, z) => z > 0.5)
  expect(player.position.z).toBeCloseTo(0.3)
  expect(player.state).toBe('idle')
  expect(player.velocity.length()).toBe(0)

  movement.update(0.25, 0, 0, open)
  expect(player.position.z).toBeCloseTo(0.3)
})

test('cancelling a click target stops movement on the next step', () => {
  const { player, movement } = setup()
  movement.walkTo(new Vector3(1, 0, 0))
  movement.update(0.25, 0, 0, open)
  movement.cancelWalk()
  movement.update(0.25, 0, 0, open)
  expect(player.position.x).toBeCloseTo(0.3)
  expect(player.state).toBe('idle')
  expect(player.velocity.length()).toBe(0)
})
