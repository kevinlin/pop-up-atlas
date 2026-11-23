import { expect, test } from 'vitest'
import { SURFACE_TAGS, surfaceTag } from '../src/materials/stage-surfaces.js'
import { trollSurfaces } from '../src/materials/stage-look.js'

const heroOrFlat = new Set([SURFACE_TAGS.heroProp, SURFACE_TAGS.flatProp])
const tag = (object, material) => surfaceTag({ objectName: object, materialName: material })

test('hero props and flat props keep their round-5 tag values', () => {
  expect(tag('atlas/flower/felt_pink', 'felt_pink')).toBe(0.4)
  expect(tag('atlas/mushroom_house/felt_red', 'felt_red')).toBe(0.4)
  expect(tag('atlas/cupcake_tree/felt_lime', 'felt_lime')).toBe(0.4)
  expect(tag('atlas/meadow/felt_leaf', 'felt_leaf')).toBe(0.7)
  expect(tag('atlas/meadow_b/felt_leaf', 'felt_leaf')).toBe(0.7)
})

test('bridge rails are not hero or flat props, and neither are rivers, lanterns, page, gutter or table', () => {
  const others = [
    tag('atlas/yarn_bridge/yarn_hot_pink.001', 'yarn_hot_pink'),
    tag('atlas/yarn_bridge/yarn_orange', 'yarn_orange'),
    tag('atlas/river_straight/glitter_river', 'glitter_river'),
    tag('atlas/river_corner/felt_mint', 'felt_mint'),
    tag('atlas/lantern/body', 'card_lantern_core'),
    tag('atlas/page_a/card_page', 'card_page'),
    tag('atlas/gutter/card_page', 'card_page'),
    tag('atlas/gutter/felt_butter', 'felt_butter'),
    tag('atlas/table', 'wood'),
  ]
  for (const value of others) expect(heroOrFlat.has(value)).toBe(false)
  expect(tag('atlas/yarn_bridge/yarn_orange', 'yarn_orange')).toBe(SURFACE_TAGS.bridgeRail)
  expect(tag('atlas/page_a/card_page', 'card_page')).toBe(0.2)
  expect(tag('atlas/table', 'wood')).toBe(0.6)
})

test('every tag is distinct from the others by more than the probe tolerance and from the probe diagnostics', () => {
  const values = Object.values(SURFACE_TAGS).sort((a, b) => a - b)
  for (let index = 1; index < values.length; index++) expect(values[index] - values[index - 1]).toBeGreaterThan(0.012)
  for (const diagnostic of [0.43, 0.72]) {
    for (const value of values) expect(Math.abs(value - diagnostic)).toBeGreaterThan(0.012)
  }
})

test('characters are tagged by their root object, whatever their material names are', () => {
  const body = (materialName) => surfaceTag({ objectName: 'body', materialName, character: true })
  expect(body('felt_a_orange')).toBe(trollSurfaces.body)
  expect(body('felt_b_mint')).toBe(trollSurfaces.body)
  expect(body('felt_mouth')).toBe(trollSurfaces.body)
  expect(body('yarn_a_sky')).toBe(trollSurfaces.hair)
  expect(body('yarn_b_tomato')).toBe(trollSurfaces.hair)
  // Old names keep working, and a name that merely looks like a prop is still a character.
  expect(body('yarn_sunset_fibres')).toBe(trollSurfaces.hair)
  expect(surfaceTag({ objectName: 'atlas/flower/hat', materialName: 'felt_pink', character: true })).toBe(trollSurfaces.body)
  // Without the root mark a yarn_a_ material is not a character.
  expect(tag('anything', 'yarn_a_sky')).toBe(SURFACE_TAGS.other)
})
