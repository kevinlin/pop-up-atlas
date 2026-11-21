import { DirectionalLight, HemisphereLight, Vector3 } from 'three'

export function createLights(scene) {
  const key = new DirectionalLight(0xffecd6, 2.2)
  const keyOffset = new Vector3(-5, 9, 6)
  key.castShadow = true
  key.shadow.mapSize.set(2048, 2048)
  Object.assign(key.shadow.camera, {
    left: -11, right: 11, top: 11, bottom: -11, near: 0.5, far: 28,
  })
  key.shadow.camera.updateProjectionMatrix()
  key.shadow.normalBias = 0.006
  key.shadow.radius = 3.5

  const fill = new DirectionalLight(0xc58bff, 0.92)
  fill.position.set(5, 4, -6)
  const hemisphere = new HemisphereLight(0xffeef4, 0x6b4c8a, 0.52)
  scene.add(key, key.target, fill, hemisphere)

  return (position) => {
    key.position.copy(position).add(keyOffset)
    key.target.position.copy(position)
  }
}
