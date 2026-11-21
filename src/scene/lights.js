import { DirectionalLight, HemisphereLight, Vector3 } from 'three'

export function createLights(scene) {
  const key = new DirectionalLight(0xffe2bd, 2.65)
  const keyOffset = new Vector3(-8.4, 6.6, 5.1)
  key.castShadow = true
  key.shadow.mapSize.set(2048, 2048)
  Object.assign(key.shadow.camera, {
    left: -11, right: 11, top: 11, bottom: -11, near: 0.5, far: 28,
  })
  key.shadow.camera.updateProjectionMatrix()
  key.shadow.bias = -0.00012
  key.shadow.normalBias = 0.004
  key.shadow.radius = 5

  const fill = new DirectionalLight(0xc58bff, key.intensity * 2 ** -1.5)
  fill.position.set(5, 4, -6)
  const hemisphere = new HemisphereLight(0xffe8f0, 0x6b4c8a, 0.44)
  scene.add(key, key.target, fill, hemisphere)

  return (position) => {
    key.position.copy(position).add(keyOffset)
    key.target.position.copy(position)
  }
}
