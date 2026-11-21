import { MathUtils, Vector3 } from 'three'

export function createCameraRig(camera, position) {
  const framing = new URLSearchParams(window.location.search).get('cam')?.split(',')
  const [requestedDistance, requestedPitch] = framing?.map(Number) ?? []
  const validFraming = framing?.length === 2 && framing.every((value) => value.trim())
    && Number.isFinite(requestedDistance) && requestedDistance > camera.near
    && Number.isFinite(requestedPitch) && requestedPitch > 0 && requestedPitch < 90
  const pitch = MathUtils.degToRad(validFraming ? requestedPitch : 45)
  const distance = validFraming ? requestedDistance : 10
  const offset = new Vector3(0, distance * Math.sin(pitch), distance * Math.cos(pitch))
  const target = position.clone()

  return (dt) => {
    target.lerp(position, 1 - Math.exp(-dt / 0.25))
    camera.position.copy(target).add(offset)
    camera.lookAt(target)
  }
}
