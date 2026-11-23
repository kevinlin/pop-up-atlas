import { Color, MeshLambertMaterial, ShaderLib } from 'three'
import { expect, test } from 'vitest'
import { applyCraftMaterial, craftTreatment } from '../src/materials/index.js'

const on = { rim: true, zones: false }
const treat = (name, options = {}, flags = on) => craftTreatment(name, options, flags)
const compile = (name, { color, ...options } = {}) => {
  const source = Object.assign(new MeshLambertMaterial(), { name })
  if (color) source.color.copy(color)
  const material = applyCraftMaterial(source, options)
  const shader = { uniforms: {}, vertexShader: ShaderLib.lambert.vertexShader, fragmentShader: ShaderLib.lambert.fragmentShader }
  material.onBeforeCompile(shader, {})
  return { material, shader, source }
}

test('character materials with the round-6 prefixes get felt or yarn treatment', () => {
  for (const name of ['felt_a_orange', 'felt_a_butter', 'felt_b_mint', 'felt_mouth']) {
    expect(treat(name, { character: true })).toMatchObject({ kind: 'felt', fibre: true })
  }
  for (const name of ['yarn_a_sky', 'yarn_a_lime', 'yarn_b_tomato']) {
    expect(treat(name, { character: true })).toMatchObject({ kind: 'yarn', fibre: true })
  }
  for (const name of ['felt_a_orange', 'yarn_b_tomato', 'felt_mouth']) {
    const { material, source } = compile(name, { character: true })
    expect(material).not.toBe(source)
    expect(material.isMeshLambertMaterial).toBe(true)
  }
  expect(applyCraftMaterial(Object.assign(new MeshLambertMaterial(), { name: 'eye_gloss' }), { character: true }).name).toBe('eye_gloss')
})

test('the rim goes on characters and moving hero props only', () => {
  expect(treat('felt_a_orange', { character: true }).rim).toBe(true)
  expect(treat('yarn_b_tomato', { character: true }).rim).toBe(true)
  for (const tile of ['flower', 'mushroom_house', 'cupcake_tree']) {
    expect(treat('felt_pink', { moving: true, tile }).rim).toBe(true)
    expect(treat('felt_pink', { moving: false, tile }).rim).toBe(false)
  }
  for (const tile of ['meadow', 'meadow_a', 'yarn_bridge', 'river_straight', 'river_corner', 'path_straight', 'page_deco_a', 'page_a', 'gutter']) {
    expect(treat('felt_pink', { moving: true, tile }).rim).toBe(false)
  }
  expect(treat('card_core', { character: true }).rim).toBe(false)
  expect(treat('felt_a_orange', { character: true }, { rim: false, zones: false }).rim).toBe(false)
  expect(treat('felt_pink', { moving: true, tile: 'flower' }, { rim: false, zones: false }).rim).toBe(false)
})

test('the rim shader is the warm fuzz term and only present when the treatment asks for it', () => {
  const character = compile('felt_a_orange_rimtest', { character: true }).shader.fragmentShader
  expect(character).toContain('fuzzRim')
  expect(character).toMatch(/vec3\(1\.0, 0\.8\d*, 0\.3\d*\)/)
  expect(compile('felt_leaf_rimtest', { moving: true, tile: 'river_straight' }).shader.fragmentShader).not.toContain('fuzzRim')
  expect(compile('felt_leaf_rimtest', { moving: true, tile: 'flower' }).shader.fragmentShader).toContain('fuzzRim')
})

test('zone families tint prop felt only', () => {
  const family = (name, options, flags) => treat(name, options, flags).family
  for (const tile of ['flower', 'mushroom_house', 'cupcake_tree', 'meadow', 'meadow_a', 'meadow_c']) {
    expect(family('felt_leaf', { moving: true, tile })).toBe(true)
    expect(family('felt_fringe_pink', { moving: true, tile })).toBe(true)
    expect(family('card_core', { moving: true, tile })).toBe(false)
    expect(family('yarn_cream', { moving: true, tile })).toBe(false)
    expect(family('glitter_flake', { moving: true, tile })).toBe(false)
  }
  expect(family('felt_pink', { moving: false, tile: 'page_deco_b' })).toBe(true)
  // Ground felt under the props, the page, bridges, rivers, paths and characters keep their colours.
  expect(family('felt_leaf', { moving: false, tile: 'meadow' })).toBe(false)
  expect(family('felt_leaf', { moving: false, tile: 'flower' })).toBe(false)
  for (const tile of ['yarn_bridge', 'river_straight', 'river_corner', 'path_straight', 'path_corner', 'page_a', 'gutter']) {
    expect(family('felt_pink', { moving: true, tile })).toBe(false)
  }
  expect(family('felt_a_orange', { character: true })).toBe(false)
  expect(family('felt_pink', { moving: true, tile: 'flower' }, { rim: true, zones: true })).toBe(false)
})

test('the family shader reads the zone key of the cell and keeps the felt shading', () => {
  const { shader } = compile('felt_leaf_familytest', { moving: true, tile: 'flower' })
  expect(shader.vertexShader).toContain('craftZoneKey(')
  expect(shader.fragmentShader).toContain('craftFamilyTint')
  expect(shader.uniforms.craftFamilyColors.value).toHaveLength(8)
  expect(shader.uniforms.craftFamilySlot.value).toBeTypeOf('number')
  const dark = compile('felt_deep_familytest', { moving: true, tile: 'flower', color: new Color(0.1, 0.05, 0.2) })
  expect(dark.shader.uniforms.craftFamilySlot.value).toBe(0)
})

test('the shipped page and plain materials are untouched by the round-6 treatments', () => {
  for (const name of ['card_page', 'card_core', 'card_cream']) {
    expect(treat(name, { moving: false, tile: 'page_a' })).toMatchObject({ rim: false, family: false })
  }
})
