import { MeshLambertMaterial, ShaderChunk, ShaderLib } from 'three'
import { expect, test } from 'vitest'
import { BEND_DEFINE, BEND_REFERENCE_HEIGHT, applyBend, bendGLSL } from '../src/materials/bend.js'
import { applyCraftMaterial } from '../src/materials/index.js'

const resolveIncludes = (source) => source.replace(/#include <(\w+)>/g, (_, name) => resolveIncludes(ShaderChunk[name]))
const lambertShader = () => ({ uniforms: {}, vertexShader: ShaderLib.lambert.vertexShader, fragmentShader: ShaderLib.lambert.fragmentShader })

// Evaluates only the bend's own #ifdef blocks, which do not nest.
function preprocess(source, defines) {
  const block = new RegExp('#ifdef (' + BEND_DEFINE + ')\\n([\\s\\S]*?)#endif\\n?', 'g')
  return source.replace(block, (_, name, body) => (defines.has(name) ? body : ''))
}
const balanced = (source) => {
  let depth = 0
  for (const char of source) {
    if (char === '{') depth++
    if (char === '}') depth--
    if (depth < 0) return false
  }
  return depth === 0
}
const conditionals = (source) => [...source.matchAll(/^\s*#(if|ifdef|ifndef|endif)\b/gm)]
  .reduce((depth, [, word]) => (word === 'endif' ? depth - 1 : depth + 1), 0)

test('the contract names are used verbatim', () => {
  expect(BEND_DEFINE).toBe('USE_INSTANCE_BEND')
  expect(BEND_REFERENCE_HEIGHT).toBe(1.0)
  expect(bendGLSL.header).toContain('attribute float instanceBend;')
})

test('the bend chunk is inert without the define and bends about local X with it', () => {
  const patched = applyBend(lambertShader())
  const vertex = resolveIncludes(patched.vertexShader)
  expect(vertex).toContain('instanceBend')
  expect(conditionals(vertex)).toBe(0)
  expect(balanced(vertex)).toBe(true)

  const without = preprocess(vertex, new Set())
  expect(without).not.toContain('instanceBend')
  expect(without).not.toContain('craftBend')

  const withDefine = preprocess(vertex, new Set([BEND_DEFINE]))
  expect(withDefine).toContain('attribute float instanceBend;')
  expect(withDefine).toContain('transformed.yz')
  expect(withDefine).toContain('objectNormal.yz')
  expect(withDefine).toMatch(/clamp\(\s*(transformed|position)\.y \/ 1\.0, 0\.0, 1\.0\)/)
})

test('the bend leaves the rest of the vertex shader as it was', () => {
  const original = ShaderLib.lambert.vertexShader
  const stripped = preprocess(applyBend(lambertShader()).vertexShader, new Set())
  expect(stripped.replace(/\s+/g, ' ').trim()).toBe(original.replace(/\s+/g, ' ').trim())
})

test('the bend sits before the projection so the bent vertex is what is drawn', () => {
  const { vertexShader } = applyBend(lambertShader())
  expect(vertexShader.indexOf('transformed.yz')).toBeLessThan(vertexShader.indexOf('#include <project_vertex>'))
  expect(vertexShader.indexOf('objectNormal.yz')).toBeLessThan(vertexShader.indexOf('#include <defaultnormal_vertex>'))
})

test('moving craft materials carry the chunk, page and flat materials do not', () => {
  const build = (moving) => {
    const material = applyCraftMaterial(Object.assign(new MeshLambertMaterial(), { name: `felt_leaf_${moving}` }), { moving, tile: 'flower' })
    const shader = lambertShader()
    material.onBeforeCompile(shader, {})
    return shader.vertexShader
  }
  expect(build(true)).toContain('instanceBend')
  expect(build(false)).not.toContain('instanceBend')
  const card = applyCraftMaterial(Object.assign(new MeshLambertMaterial(), { name: 'card_core' }), { moving: true, tile: 'flower' })
  const shader = lambertShader()
  card.onBeforeCompile(shader, {})
  expect(shader.vertexShader).toContain('instanceBend')
})
