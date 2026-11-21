import { DataTexture, LinearFilter, MathUtils, Mesh, MeshBasicMaterial, PlaneGeometry, Vector3 } from 'three'
import { TILE_SIZE } from '../world/tiles.js'

const gutterInterval = 8 * TILE_SIZE
const gutterWidth = 0.22
const gutterDepth = 0.069
const pageBias = 0.006

function makeFalloff() {
  const size = 32
  const pixels = new Uint8Array(size * size * 4).fill(255)
  for (let row = 0; row < size; row += 1) {
    for (let col = 0; col < size; col += 1) {
      const radius = Math.hypot(2 * col / (size - 1) - 1, 2 * row / (size - 1) - 1)
      pixels[4 * (row * size + col) + 3] = Math.round(255 * (1 - MathUtils.smoothstep(radius, 0.18, 1)) ** 2)
    }
  }
  const texture = new DataTexture(pixels, size, size)
  texture.magFilter = texture.minFilter = LinearFilter
  texture.needsUpdate = true
  return texture
}

export function createFootShadows(scene, model) {
  const falloff = makeFalloff()
  const center = new Vector3()
  const contacts = []
  for (const name of ['foot_L', 'foot_R']) {
    const bone = model.getObjectByName(name)
    if (!bone?.isBone) continue
    const geometry = new PlaneGeometry(0.18, 0.25, 6, 6).rotateX(-Math.PI / 2).translate(0, pageBias, 0)
    const material = new MeshBasicMaterial({
      color: 0x322129, map: falloff, transparent: true, depthWrite: false, toneMapped: false,
    })
    const shadow = new Mesh(geometry, material)
    shadow.name = `contact_${name}`
    scene.add(shadow)
    contacts.push({ bone, shadow, draped: false })
  }

  return () => {
    for (const contact of contacts) {
      const { bone, shadow } = contact
      // The rig's foot axes point down the sole (+Y) and up from it (+Z).
      bone.localToWorld(center.set(0, 0.032, -0.041))
      const { elements } = bone.matrixWorld
      const yaw = Math.atan2(elements[4], elements[6])
      shadow.rotation.y = yaw
      shadow.position.set(center.x, 0, center.z)
      shadow.material.opacity = 0.54 * (1 - MathUtils.smoothstep(center.y, 0.012, 0.12))

      // Match the page gutter's cross-section so the blob lies on the paper at spawn.
      const offset = center.x - gutterInterval * Math.round(center.x / gutterInterval)
      const nearGutter = Math.abs(offset) < gutterWidth + 0.16
      if (nearGutter || contact.draped) {
        const { position } = shadow.geometry.attributes
        const sin = Math.sin(yaw)
        const cos = Math.cos(yaw)
        for (let i = 0; i < position.count; i += 1) {
          const x = offset + position.getX(i) * cos + position.getZ(i) * sin
          const valley = Math.max(0, 1 - (x / gutterWidth) ** 2)
          position.setY(i, pageBias - gutterDepth * valley * valley)
        }
        position.needsUpdate = true
      }
      contact.draped = nearGutter
    }
  }
}
