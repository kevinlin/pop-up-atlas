import { Color } from 'three'
import { ZONE_KEYS, zoneKeyAt } from '../world/layout.js'

// Round-6 zone colour sets (contract "Round 6" -> Light, ground and props, L6): every zone picks one prop felt family.
// The zone function is the existing one (zoneKeyAt, mirrored in cell-jitter.js as craftZoneKey), so the mapping needs
// no new randomness: one family per zone key.
const FAMILY_OF_KEY = Object.freeze({
  'green-gold': 'lime-mint',
  amber: 'orange-butter',
  'pink-lavender': 'pink-violet',
  teal: 'sky-mint',
})

// Primary is the deeper, saturated colour; secondary the light one that the palest felts of the prop take.
const FAMILY_PIGMENTS = Object.freeze({
  'pink-violet': [0x7a52c7, 0xf4a6c8],
  'orange-butter': [0xf59a3c, 0xf7dc6f],
  'sky-mint': [0x7ec8e8, 0x9ee0b8],
  'lime-mint': [0xa7d84a, 0x9ee0b8],
})

export const ZONE_FAMILIES = Object.freeze(Object.keys(FAMILY_PIGMENTS))

export function zoneFamilyForKey(key) {
  const family = FAMILY_OF_KEY[key]
  if (!family) throw new Error(`No colour family for zone key "${key}"`)
  return family
}

export const zoneFamilyAt = (seed, i, j) => zoneFamilyForKey(zoneKeyAt(seed, i, j))

// Uniform array for the shader: index = zone key index * 2 + slot, in ZONE_KEYS order.
export const FAMILY_COLORS = ZONE_KEYS.flatMap((key) => FAMILY_PIGMENTS[zoneFamilyForKey(key)].map((hex) => new Color(hex)))

// Felts lighter than this (linear luminance of their source colour) take the secondary colour.
export const LIGHT_FELT = 0.62
export const familySlot = ({ r, g, b }) => (0.2126 * r + 0.7152 * g + 0.0722 * b > LIGHT_FELT ? 1 : 0)
