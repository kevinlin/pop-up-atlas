import {
  BufferGeometry, Color, Float32BufferAttribute, Group, Mesh, MeshLambertMaterial,
  PlaneGeometry, RepeatWrapping, SRGBColorSpace, TextureLoader,
} from 'three'
import { GUTTER_INTERVAL, PAGE_MAX_Z, PAGE_MIN_Z, TILE_SIZE } from './tiles.js'

const PANEL_LENGTH = GUTTER_INTERVAL * TILE_SIZE
const COVER_LIP = 0.54
const TABLE_Y = -0.68
const gutterMarks = [0, 0.025, 0.06, 0.10, 0.14, 0.18, 0.22, 0.26]
const marks = [
  ...gutterMarks,
  ...Array.from({ length: PANEL_LENGTH * 4 - 3 }, (_, i) => (i + 2) / 4),
  ...gutterMarks.toReversed().map((x) => PANEL_LENGTH - x),
]

function texture(path, colorSpace) {
  if (typeof document === 'undefined') return null
  const map = new TextureLoader().load(new URL(path, document.baseURI).href)
  map.colorSpace = colorSpace
  map.wrapS = map.wrapT = RepeatWrapping
  map.anisotropy = 4
  return map
}

function edgeGeometry(profiles) {
  const positions = []
  const colors = []
  const uvs = []
  const indices = []
  for (const side of [-1, 1]) {
    const edge = side === -1 ? PAGE_MIN_Z : PAGE_MAX_Z
    for (const [layer, profile] of profiles) {
      for (let face = 1; face < profile.length; face += 1) {
        const start = positions.length / 3
        const color = new Color(profile[face][2])
        for (const x of marks) {
          const gutter = Math.min(x, PANEL_LENGTH - x)
          // Match the authored valley at the cut edge, then let the lower sheets bow more gently.
          const dip = -0.069 * Math.max(0, 1 - (gutter / 0.22) ** 2) ** 2
          const phase = x * 2 * Math.PI / PANEL_LENGTH
          const wave = layer ? Math.sin(phase * (3 + layer) + layer + side) * 0.035 : 0
          const bow = layer ? Math.sin(phase * 2 + layer) * 0.014 : 0
          for (const [lip, y] of [profile[face - 1], profile[face]]) {
            positions.push(x, y + bow + dip / (1 + layer * 0.23), edge + side * (lip + wave))
            colors.push(color.r, color.g, color.b)
            uvs.push(x / 1.7, (lip - y * 2) * 1.7)
          }
        }
        for (let i = 0; i < marks.length - 1; i += 1) {
          const a = start + i * 2
          const b = a + 2
          if (side === 1) indices.push(a, a + 1, b, b, a + 1, b + 1)
          else indices.push(a, b, a + 1, b, b + 1, a + 1)
        }
      }
    }
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2))
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
}

function makeTable() {
  const material = new MeshLambertMaterial({ color: 0xa26d49 })
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = `varying vec2 tableXZ;\n${shader.vertexShader}`.replace(
      '#include <project_vertex>',
      '#include <project_vertex>\ntableXZ = (modelMatrix * vec4(transformed, 1.0)).xz;',
    )
    shader.fragmentShader = `varying vec2 tableXZ;
float woodHash(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}
float woodNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = smoothstep(0.0, 1.0, fract(p));
  return mix(mix(woodHash(i), woodHash(i + vec2(1, 0)), f.x),
             mix(woodHash(i + vec2(0, 1)), woodHash(i + 1.0), f.x), f.y);
}
${shader.fragmentShader}`.replace('#include <color_fragment>', `#include <color_fragment>
  float plank = (tableXZ.y + 0.35) / 2.8;
  float seam = min(fract(plank), 1.0 - fract(plank));
  float bow = woodNoise(tableXZ * vec2(0.23, 0.55));
  float grain = woodNoise(vec2(tableXZ.x * 0.55, tableXZ.y * 23.0 + 10.0 * bow));
  float pore = woodNoise(tableXZ * vec2(2.2, 61.0));
  float variation = woodHash(vec2(floor(plank), 7.0));
  float distanceToCover = abs(tableXZ.y - ${(PAGE_MIN_Z + PAGE_MAX_Z) / 2}.0)
    - ${(PAGE_MAX_Z - PAGE_MIN_Z) / 2 + COVER_LIP};
  float contact = mix(0.58, 1.0, smoothstep(-0.15, 0.8, distanceToCover));
  diffuseColor.rgb *= (0.64 + 0.28 * grain + 0.13 * pore + 0.20 * variation + 0.19 * bow)
    * mix(0.54, 1.0, smoothstep(0.004, 0.023, seam)) * contact;
`)
  }
  const geometry = new PlaneGeometry(320, 120).rotateX(-Math.PI / 2)
  const table = new Mesh(geometry, material)
  table.name = 'atlas/table'
  table.position.y = TABLE_Y
  table.renderOrder = 1
  table.receiveShadow = true
  return table
}

export function createBook(scene) {
  const paper = new MeshLambertMaterial({
    vertexColors: true,
    map: texture('models/tiles/textures/cutpaper-edge_albedo-c2c3382938c1.png', SRGBColorSpace),
  })
  const felt = new MeshLambertMaterial({
    vertexColors: true,
    map: texture('models/tiles/textures/felt-base_albedo-7ec1a3f63acb.png', SRGBColorSpace),
  })
  const sheets = [
    [0, [[0, 0], [0.004, -0.014, 0xfff4dc], [0.016, -0.067, 0xecd7b5], [-0.01, -0.080, 0xa57b5c]]],
    [1, [[-0.22, -0.079], [0.087, -0.088, 0xf2dfbf], [0.092, -0.142, 0xffe8c7], [0.053, -0.161, 0x977050]]],
    [2, [[-0.22, -0.153], [0.048, -0.169, 0xf4dbb8], [0.057, -0.235, 0xe8caa3], [0.018, -0.250, 0xa68260]]],
    [3, [[-0.22, -0.241], [0.132, -0.254, 0xffedcf], [0.146, -0.329, 0xf5dcb6], [0.102, -0.347, 0xa57855]]],
    [4, [[-0.22, -0.335], [0.104, -0.350, 0xffe5c6], [0.098, -0.431, 0xeaca9e], [0.065, -0.449, 0xa17a56]]],
  ]
  const cover = [[5, [
    [-0.24, -0.438], [0.28, -0.454, 0xb55768], [COVER_LIP - 0.04, -0.471, 0xa94b62],
    [COVER_LIP, -0.508, 0x984056], [COVER_LIP, -0.594, 0x82334b], [0.48, -0.647, 0x672a3d],
  ]]]
  const layers = [
    ['atlas/page-stack', edgeGeometry(sheets), paper],
    ['atlas/felt-cover', edgeGeometry(cover), felt],
  ]
  const panels = new Group()
  const table = makeTable()
  scene.add(table, panels)

  return function placeBook(firstColumn, lastColumn) {
    const first = Math.floor((firstColumn - 0.5) / GUTTER_INTERVAL)
    const last = Math.floor((lastColumn + 0.5) / GUTTER_INTERVAL)
    table.position.x = Math.floor((first + last) / 2) * PANEL_LENGTH
    for (let i = 0; i <= last - first; i += 1) {
      let panel = panels.children[i]
      if (!panel) {
        panel = new Group()
        for (const [name, geometry, material] of layers) {
          const mesh = new Mesh(geometry, material)
          mesh.name = name
          mesh.receiveShadow = true
          panel.add(mesh)
        }
        panels.add(panel)
      }
      panel.visible = true
      panel.position.x = (first + i) * PANEL_LENGTH
    }
    for (let i = last - first + 1; i < panels.children.length; i += 1) panels.children[i].visible = false
  }
}
