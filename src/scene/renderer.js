import {
  DepthTexture, HalfFloatType, NeutralToneMapping, PCFShadowMap, UnsignedIntType,
  Vector2, Vector3, WebGLRenderer, WebGLRenderTarget,
} from 'three'
import { TiltShiftPass } from './tilt-shift.js'

export function createRenderer(scene, camera) {
  const renderer = new WebGLRenderer({ powerPreference: 'high-performance' })
  renderer.toneMapping = NeutralToneMapping
  renderer.toneMappingExposure = 1.35
  renderer.shadowMap.enabled = true
  // Recent Three.js releases implement soft PCF through PCFShadowMap and shadow.radius.
  renderer.shadowMap.type = PCFShadowMap
  const canvas = renderer.domElement
  document.body.append(canvas)

  const image = new WebGLRenderTarget(1, 1, {
    type: HalfFloatType,
    depthTexture: new DepthTexture(1, 1, UnsignedIntType),
  })
  const tiltShift = new TiltShiftPass(camera)
  const focus = new Vector3()
  const renderSize = new Vector2()

  function resize() {
    const width = window.innerWidth
    const height = Math.max(window.innerHeight, 1)
    renderer.setPixelRatio(window.devicePixelRatio)
    renderer.setSize(width, height, false)
    renderer.getDrawingBufferSize(renderSize)
    image.setSize(renderSize.x, renderSize.y)
    tiltShift.setSize(renderSize.x, renderSize.y)
    camera.aspect = width / height
    camera.updateProjectionMatrix()
  }

  window.addEventListener('resize', resize)
  resize()

  return {
    canvas,
    // Compile every program once so first sight of a material doesn't stall a frame.
    compile: () => renderer.compileAsync(scene, camera),
    render(_dt, position) {
      camera.updateMatrixWorld()
      focus.copy(position)
      focus.y += 0.38
      tiltShift.focusDepth = -focus.applyMatrix4(camera.matrixWorldInverse).z

      renderer.setRenderTarget(image)
      renderer.render(scene, camera)
      tiltShift.render(renderer, image)
    },
  }
}
