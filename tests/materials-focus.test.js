import { expect, test } from 'vitest'
import { parseFocusPoint } from '../src/scene/focus.js'

test('accepts a fixed world point on the page', () => {
  expect(parseFocusPoint(' -2.75, 8 ').toArray()).toEqual([-2.75, 0, 8])
  expect(parseFocusPoint('0,0').toArray()).toEqual([0, 0, 0])
})

test('keeps the default troll focus for missing or invalid coordinates', () => {
  for (const value of [null, '', ' ,2', '5,', '1,2,3', 'NaN,4', '1,Infinity']) {
    expect(parseFocusPoint(value)).toBeNull()
  }
})
