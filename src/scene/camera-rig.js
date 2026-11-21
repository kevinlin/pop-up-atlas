import { MathUtils, Vector3 } from 'three'

export function createCameraRig(camera, position) {
  const pitch = MathUtils.degToRad(45)
  const distance = 10 // close enough that the 0.6-unit troll reads as the subject
  const offset = new Vector3(0, distance * Math.sin(pitch), distance * Math.cos(pitch))
  const target = position.clone()

  return (dt) => {
    target.lerp(position, 1 - Math.exp(-dt / 0.25))
    camera.position.copy(target).add(offset)
    camera.lookAt(target)
  }
}
