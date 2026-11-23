import { expect, test } from 'vitest'
import { DEFAULT_LOOK_OFF, lookFlags } from '../src/materials/stage-look.js'

test('the shipped look keeps round-3 light and grade with only bloom and the round-6 rim on', () => {
  expect(lookFlags()).toEqual({ grade: false, backlight: false, bounce: false, zones: false, haze: false,
    backdrop: false, dapple: false, bloom: true, rim: true })
})

test('an empty lookOff turns the full round-4 stage back on, and a list turns layers off', () => {
  expect(Object.values(lookFlags('?lookOff='))).toEqual(Array(9).fill(true))
  expect(lookFlags('?lookOff=bloom,haze')).toMatchObject({ grade: true, haze: false, bloom: false })
})

test('rim is a lookOff flag: the comparison URL is the default list plus rim', () => {
  expect(DEFAULT_LOOK_OFF).not.toContain('rim')
  const rimOff = lookFlags(`?lookOff=${DEFAULT_LOOK_OFF},rim`)
  expect(rimOff.rim).toBe(false)
  expect({ ...rimOff, rim: true }).toEqual(lookFlags())
  expect(lookFlags('?lookOff=rim').rim).toBe(false)
  expect(lookFlags('?lookOff=bloom').rim).toBe(true)
})
