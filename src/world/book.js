import {
  BufferGeometry, Color, Float32BufferAttribute, Group, Mesh, MeshLambertMaterial,
  PlaneGeometry, RepeatWrapping, SRGBColorSpace, TextureLoader,
} from 'three'
import { GUTTER_INTERVAL, PAGE_MAX_Z, PAGE_MIN_Z, TILE_SIZE } from './tiles.js'

const PANEL_LENGTH = GUTTER_INTERVAL * TILE_SIZE
const COVER_LIP = 0.37
const COVER_LAYER = 4
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

function edgePoint(side, layer, x, lip, height) {
  const edge = side === -1 ? PAGE_MIN_Z : PAGE_MAX_Z
  const gutter = Math.min(x, PANEL_LENGTH - x)
  const phase = x * 2 * Math.PI / PANEL_LENGTH
  // The top rim joins the authored valley. Deeper sheets compress over a broader crease.
  const valley = -0.069 * Math.max(0, 1 - (gutter / 0.22) ** 2) ** 2
  const fold = Math.exp(-((gutter / 0.83) ** 2))
  const depth = Math.min(1, -height / 0.34)
  const dip = valley * (1 - depth) - 0.144 * fold * depth
  const undulation = Math.sin(phase * (3 + layer) + layer + side)
  const wave = Math.min(1, Math.abs(lip) / 0.12) * (0.045 * undulation - 0.10 * fold)
  const bow = depth * (0.016 * Math.sin(phase * 2 + layer) + 0.012 * undulation)
  return [x, Math.max(TABLE_Y, height + bow + dip), edge + side * (lip + wave)]
}

function edgeGeometry(profiles) {
  const positions = []
  const colors = []
  const uvs = []
  const indices = []
  for (const side of [-1, 1]) {
    for (const [layer, profile] of profiles) {
      for (let face = 1; face < profile.length; face += 1) {
        const start = positions.length / 3
        const color = new Color(profile[face][2])
        for (const x of marks) {
          for (const [lip, y] of [profile[face - 1], profile[face]]) {
            positions.push(...edgePoint(side, layer, x, lip, y))
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

function coverStitches() {
  const positions = []
  for (const side of [-1, 1]) {
    for (let x = 0.034; x < PANEL_LENGTH - 0.027; x += 0.058) {
      const points = [[-0.024, 0.292], [-0.020, 0.308], [0.024, 0.322], [0.020, 0.306]]
        .map(([dx, lip]) => edgePoint(side, COVER_LAYER, x + dx, lip, -0.384 - (lip - 0.25) * 0.25 + 0.007))
      const order = side === 1 ? [0, 1, 3, 1, 2, 3] : [0, 3, 1, 1, 3, 2]
      for (const index of order) positions.push(...points[index])
    }
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
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
    [0, [[0, 0], [0.04, -0.023, 0xfff8e9], [0.058, -0.065, 0xf8e9d0], [0.012, -0.091, 0xb39474]]],
    [1, [[-0.24, -0.075], [0.122, -0.096, 0xfff3de], [0.143, -0.159, 0xf7e9d0], [0.076, -0.181, 0xa88365]]],
    [2, [[-0.22, -0.166], [0.091, -0.187, 0xf7e6ca], [0.102, -0.246, 0xffefda], [0.055, -0.271, 0xb28a70]]],
    [3, [[-0.24, -0.247], [0.185, -0.272, 0xfff2d7], [0.203, -0.343, 0xeee0c6], [0.119, -0.391, 0x967258]]],
  ]
  const cover = [[COVER_LAYER, [
    [-0.24, -0.366], [0.25, -0.384, 0xe3a0b1], [COVER_LIP - 0.02, -0.409, 0xd97e9b],
    [COVER_LIP, -0.439, 0xc76588], [0.338, -0.491, 0xb75979], [0.06, -0.533, 0x944760],
    [-0.09, TABLE_Y, 0x6e3e46],
  ]]]
  const layers = [
    ['atlas/page-stack', edgeGeometry(sheets), paper],
    ['atlas/felt-cover', edgeGeometry(cover), felt],
    ['atlas/cover-stitches', coverStitches(), new MeshLambertMaterial({ color: 0xffdec8 })],
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
