import { NeutralToneMapping, PCFShadowMap, Vector3, WebGLRenderer } from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
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

  const composer = new EffectComposer(renderer)
  const tiltShift = new TiltShiftPass()
  composer.addPass(new RenderPass(scene, camera))
  composer.addPass(tiltShift)
  const focus = new Vector3()

  function resize() {
    const width = window.innerWidth
    const height = Math.max(window.innerHeight, 1)
    const dpr = window.devicePixelRatio
    renderer.setPixelRatio(dpr)
    renderer.setSize(width, height, false)
    composer.setPixelRatio(dpr)
    composer.setSize(width, height)
    camera.aspect = width / height
    camera.updateProjectionMatrix()
  }

  window.addEventListener('resize', resize)
  resize()

  return {
    canvas,
    // Compile every program once so first sight of a material doesn't stall a frame.
    compile: () => renderer.compileAsync(scene, camera),
    render(dt, position) {
      camera.updateMatrixWorld()
      focus.copy(position)
      focus.y += 0.3
      focus.project(camera)
      tiltShift.focusY = Math.min(0.99, Math.max(0.01, focus.y * 0.5 + 0.5))
      composer.render(dt)
    },
  }
}
