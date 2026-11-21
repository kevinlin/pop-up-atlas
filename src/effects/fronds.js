import {
  BufferGeometry, Color, DoubleSide, Float32BufferAttribute, Group, Mesh, Vector3,
} from 'three'
import { craft, craftMap, palette } from './craft.js'

// Cut felt leaflets with a raised midrib, in normalized view coordinates.
function fern(side) {
  const positions = []
  const uvs = []
  const colors = []
  const lime = new Color(palette.lime)
  const mint = new Color(palette.mint)
  function blade(x, y, tipX, tipY, width, shade) {
    const dx = tipX - x
    const dy = tipY - y
    const length = Math.hypot(dx, dy)
    const crossX = -dy / length * width
    const crossY = dx / length * width
    const color = mint.clone().lerp(lime, 0.68 + 0.28 * shade)
    function point(t, edge) {
      const taper = Math.sin(Math.PI * t) ** 0.70 * (1 - t * 0.28)
      const bend = Math.sin(Math.PI * t) * width * 0.24
      const px = x + t * dx + crossX * edge * taper
      const py = y + t * dy + crossY * edge * taper + bend
      positions.push(side * (1 - (1 - px) * 0.83), (1 + py) * 0.88 - 1, edge === 0 ? taper * 0.016 : 0)
      uvs.push(t, (edge + 1) * 0.5)
      const gain = edge === 0 ? 0.48 : edge < 0 ? 0.31 : 0.38
      colors.push(color.r * gain, color.g * gain, color.b * gain)
    }
    for (let i = 0; i < 8; i += 1) {
      const t = i / 8
      const next = (i + 1) / 8
      for (const edge of [-1, 1]) {
        point(t, 0)
        point(t, edge)
        point(next, 0)
        point(t, edge)
        point(next, edge)
        point(next, 0)
      }
    }
  }

  const lean = side === 1 ? 0.03 : -0.03
  blade(0.79, -1.15, 0.97, -0.24 + lean, 0.047, 0.5)
  blade(0.82, -1.05, 0.39, -0.83 + lean, 0.17, 0.05)
  blade(0.85, -0.91, 0.45, -0.59 + lean, 0.15, 0.4)
  blade(0.89, -0.72, 0.60, -0.43 + lean, 0.13, 0.22)
  blade(0.91, -0.56, 0.77, -0.29 + lean, 0.095, 0.55)
  blade(0.86, -0.86, 1.19, -0.68, 0.17, 0.1)
  blade(0.92, -0.59, 1.18, -0.39, 0.15, 0.35)

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2))
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3))
  geometry.computeVertexNormals()
  return geometry
}

export function makeFronds(scene, camera) {
  const group = new Group()
  group.name = 'atlas/foreground-fronds'
  const material = craft('felt_fern', {
    vertexColors: true, side: DoubleSide, map: craftMap('felt-base_albedo-7ec1a3f63acb.png'),
    color: palette.cream,
  }, (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>', `
      // Vary the cut edge with the felt fibres and keep the raised veins legible in shade.
      float edge = min(vMapUv.y, 1.0 - vMapUv.y);
      float fibre = texture2D(map, vec2(fract(vMapUv.x * 4.0), vMapUv.y)).r;
      if (edge < 0.016 + 0.030 * fibre) discard;
      outgoingLight = diffuseColor.rgb * (0.125 + 0.045 * fibre);
      #include <opaque_fragment>
    `)
  })
  const left = new Mesh(fern(-1), material)
  const right = new Mesh(fern(1), material)
  left.frustumCulled = right.frustumCulled = false
  group.add(left, right)
  scene.add(group)
  const actor = new Vector3()
  const depth = 1.3

  return (position) => {
    group.position.set(0, 0, -depth).applyMatrix4(camera.matrixWorld)
    group.quaternion.copy(camera.quaternion)
    const sx = camera.projectionMatrix.elements[0]
    const sy = camera.projectionMatrix.elements[5]
    group.scale.set(depth / sx, depth / sy, 1)

    // Cull a corner conservatively if the projected actor or its blur could enter it.
    actor.copy(position)
    actor.y += 0.46
    actor.applyMatrix4(camera.matrixWorldInverse)
    const nearest = -actor.z - 0.90
    if (nearest <= camera.near) {
      left.visible = right.visible = false
      return
    }
    actor.applyMatrix4(camera.projectionMatrix)
    const radiusX = 0.90 * (sx + Math.abs(actor.x)) / nearest + 0.10
    const radiusY = 0.90 * (sy + Math.abs(actor.y)) / nearest + 0.16
    left.visible = actor.y - radiusY > -0.19 || actor.x - radiusX > -0.43
    right.visible = actor.y - radiusY > -0.19 || actor.x + radiusX < 0.43
  }
}
