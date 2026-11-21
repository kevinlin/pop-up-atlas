import { CapsuleGeometry, Mesh, MeshStandardMaterial, PlaneGeometry } from 'three'

export function addPlaceholders(scene) {
  const page = new Mesh(new PlaneGeometry(256, 256), new MeshStandardMaterial({ color: 0xe6cfa8 }))
  page.name = 'placeholder-page'
  page.rotation.x = -Math.PI / 2
  page.position.y = -0.005
  page.receiveShadow = true
  scene.add(page)

  const geometry = new CapsuleGeometry(0.18, 0.24, 6, 16)
  geometry.translate(0, 0.3, 0)
  const capsule = new Mesh(geometry, new MeshStandardMaterial({ color: 0x9a57b7 }))
  capsule.name = 'placeholder-troll'
  capsule.castShadow = true
  scene.add(capsule)
  return capsule
}
