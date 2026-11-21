import { expect, test } from 'vitest'
import { lookFlags } from '../src/materials/stage-look.js'

test('the shipped look keeps round-3 light and grade with only bloom on', () => {
  expect(lookFlags()).toEqual({ grade: false, backlight: false, bounce: false, zones: false, haze: false,
    backdrop: false, dapple: false, bloom: true })
})

test('an empty lookOff turns the full round-4 stage back on, and a list turns layers off', () => {
  expect(Object.values(lookFlags('?lookOff='))).toEqual(Array(8).fill(true))
  expect(lookFlags('?lookOff=bloom,haze')).toMatchObject({ grade: true, haze: false, bloom: false })
})
