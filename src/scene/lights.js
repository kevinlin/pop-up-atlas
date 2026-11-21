import { Color, DirectionalLight, HemisphereLight, Vector3 } from 'three'
import { look, updateStage } from '../materials/stage-look.js'

export function createLights(scene) {
  const key = new DirectionalLight(look.backlight ? 0xffe9a8 : 0xffe2bd, look.backlight ? 1.45 : 2.65)
  const keyOffset = look.backlight ? new Vector3(-4.5, 7.6, -9.1) : new Vector3(-8.4, 6.6, 5.1)
  key.castShadow = true
  key.shadow.mapSize.set(2048, 2048)
  Object.assign(key.shadow.camera, {
    left: -11, right: 11, top: 11, bottom: -11, near: 0.5, far: 28,
  })
  key.shadow.camera.updateProjectionMatrix()
  key.shadow.bias = -0.00012
  key.shadow.normalBias = 0.003
  key.shadow.radius = 5.25

  const fill = new DirectionalLight(0xc58bff, 2.65 * 2 ** -2.3)
  const dayFill = new Color(0xffe2bd)
  const duskFill = fill.color.clone()
  // A broad front-side bounce lights the cutouts where the rear key grazes them.
  if (look.bounce) fill.position.set(-8.4, 6.6, 5.1)
  else fill.position.set(5, 4, -6)
  const hemisphere = new HemisphereLight(0xffe8f0, look.bounce ? 0x2f5a50 : 0x6b4c8a, look.bounce ? 0.62 : 0.44)
  scene.add(key, key.target, fill, hemisphere)
  scene.addEventListener('childadded', ({ child }) => {
    if (child.material?.userData?.craftBridgeDeck) child.castShadow = true
  })

  return (position) => {
    const dusk = updateStage(position)
    if (look.bounce) {
      fill.color.copy(dayFill).lerp(duskFill, dusk)
      fill.intensity = 2.05 - 0.28 * dusk
    }
    key.position.copy(position).add(keyOffset)
    key.target.position.copy(position)
  }
}
