import { expect, test } from 'vitest'
import { ZONE_KEYS, zoneKeyAt } from '../src/world/layout.js'
import { cellZoneGLSL } from '../src/materials/cell-jitter.js'
import { FAMILY_COLORS, ZONE_FAMILIES, familySlot, zoneFamilyAt, zoneFamilyForKey } from '../src/materials/zone-family.js'

test('the four families are the contract names, one per zone key, all different', () => {
  expect([...ZONE_FAMILIES].sort()).toEqual(['lime-mint', 'orange-butter', 'pink-violet', 'sky-mint'])
  const mapped = ZONE_KEYS.map(zoneFamilyForKey)
  expect(new Set(mapped).size).toBe(ZONE_KEYS.length)
  for (const family of mapped) expect(ZONE_FAMILIES).toContain(family)
})

test('the family follows the existing zone function and is deterministic', () => {
  for (const seed of [0, 1, 7, 12345]) {
    for (let i = -40; i < 40; i += 3) {
      for (let j = -40; j < 40; j += 3) {
        const family = zoneFamilyAt(seed, i, j)
        expect(family).toBe(zoneFamilyForKey(zoneKeyAt(seed, i, j)))
        expect(zoneFamilyAt(seed, i, j)).toBe(family)
      }
    }
  }
})

test('every zone key and so every family turns up over a world', () => {
  const seen = new Set()
  for (let i = -80; i < 80; i += 2) for (let j = -80; j < 80; j += 2) seen.add(zoneFamilyAt(3, i, j))
  expect([...seen].sort()).toEqual([...ZONE_FAMILIES].sort())
})

test('an unknown zone key is an error, not a silent default', () => {
  expect(() => zoneFamilyForKey('mauve')).toThrow()
})

test('family colours are two per zone key in ZONE_KEYS order, primary then secondary', () => {
  expect(FAMILY_COLORS).toHaveLength(ZONE_KEYS.length * 2)
  const hex = (index) => FAMILY_COLORS[index].getHex()
  const byFamily = (key) => ZONE_KEYS.indexOf(key) * 2
  expect([hex(byFamily('pink-lavender')), hex(byFamily('pink-lavender') + 1)]).toEqual([0x7a52c7, 0xf4a6c8])
  expect([hex(byFamily('amber')), hex(byFamily('amber') + 1)]).toEqual([0xf59a3c, 0xf7dc6f])
  expect([hex(byFamily('teal')), hex(byFamily('teal') + 1)]).toEqual([0x7ec8e8, 0x9ee0b8])
  expect([hex(byFamily('green-gold')), hex(byFamily('green-gold') + 1)]).toEqual([0xa7d84a, 0x9ee0b8])
})

test('light felts take the secondary colour, deeper ones the primary', () => {
  expect(familySlot({ r: 0.9, g: 0.9, b: 0.7 })).toBe(1)
  expect(familySlot({ r: 0.2, g: 0.1, b: 0.4 })).toBe(0)
})

test('the shader mirrors the key roll of the CPU zone function', () => {
  expect(cellZoneGLSL).toContain('uint craftZoneKey(vec2 cell)')
  expect(cellZoneGLSL).toContain('craftZoneHash(craftZone(cell), 22u) % 12u')
  expect(cellZoneGLSL).toContain('roll < 6u ? 0u : 1u + (roll - 6u) % 3u')
})
