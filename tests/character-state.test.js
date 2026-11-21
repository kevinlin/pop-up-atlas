import { expect, test } from 'vitest'
import { createCharacterState } from '../src/character/state.js'

test('dancing starts after four idle seconds and returns to idle when the clip finishes', () => {
  const update = createCharacterState()
  expect(update(3.75, false, false)).toBe('idle')
  expect(update(0.25, false, false)).toBe('dance')
  expect(update(4, false, false)).toBe('dance')
  expect(update(1, false, false, true)).toBe('idle')
  expect(update(3.75, false, false)).toBe('idle')
  expect(update(0.25, false, false)).toBe('dance')
})

test('stationary input resets the timer and interrupts the dance', () => {
  const update = createCharacterState()
  expect(update(3.75, false, false)).toBe('idle')
  expect(update(0.25, false, true)).toBe('idle')
  expect(update(3.75, false, false)).toBe('idle')
  expect(update(0.25, false, false)).toBe('dance')
  expect(update(0.02, false, true)).toBe('idle')
  expect(update(3.75, false, false)).toBe('idle')
})

test('movement interrupts the dance and keeps the idle timer at zero', () => {
  const update = createCharacterState()
  expect(update(4, false, false)).toBe('dance')
  expect(update(5, true, false)).toBe('walk')
  expect(update(3.75, false, false)).toBe('idle')
  expect(update(0.25, false, false)).toBe('dance')
})
