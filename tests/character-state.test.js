import { AnimationClip, Group, NumberKeyframeTrack } from 'three'
import { expect, test } from 'vitest'
import { createAnimation } from '../src/character/animation.js'
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

test.each([2.875, 5])('idle resumes when the %.3f s dance clip ends', (duration) => {
  const clip = (name, seconds) => new AnimationClip(name, seconds, [
    new NumberKeyframeTrack('.position[x]', [0, seconds], [0, 1]),
  ])
  const animation = createAnimation(new Group(), [clip('idle', 2), clip('walk', 1), clip('dance', duration)])
  const update = createCharacterState()
  const frame = (dt) => {
    const state = update(dt, false, false, animation.danceFinished)
    animation.update(state, 0, dt)
    return state
  }

  expect(frame(3.875)).toBe('idle')
  expect(frame(0.125)).toBe('dance')
  for (let time = 0.125; time < duration; time += 0.125) {
    expect(animation.danceFinished).toBe(false)
    expect(frame(0.125)).toBe('dance')
  }
  expect(animation.danceFinished).toBe(true)
  expect(frame(0.125)).toBe('idle')
})
