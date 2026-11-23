import { expect, test } from 'vitest'
import { PerspectiveCamera, Vector3 } from 'three'
import { BLOOM_RADIUS, defocusBands, gaussianTaps, TILT_SHIFT, TiltShiftPass } from '../src/scene/tilt-shift.js'

test('tilt-shift constants follow the round-6 contract', () => {
  expect(TILT_SHIFT).toEqual({ sharpBand: 0.40, falloff: 0.22, maxBlur: 0.010 })
  // The emissive bloom keeps its round-5 radius so the lantern halo (1.5-3 % of frame width) holds.
  expect(BLOOM_RADIUS).toBe(0.015)
})

test('the colour blur is 1.0 % of the image width and the bloom blur stays at 1.5 %', () => {
  const pass = new TiltShiftPass(new PerspectiveCamera(30, 16 / 9, 0.1, 160))
  for (const width of [1280, 1920, 2560]) {
    pass.setSize(width, Math.round(width * 9 / 16))
    const half = Math.round(Math.min(0.5, Math.floor(2 * 16 / BLOOM_RADIUS) / width) * width)
    const uniforms = pass.blur.uniforms
    expect(uniforms.tapCount.value).toBe(Math.ceil(Math.max(1, Math.round(half * 0.010)) / 2))
    expect(uniforms.bloomTapCount.value).toBe(Math.ceil(Math.max(1, Math.round(half * 0.015)) / 2))
    expect(uniforms.bloomTapCount.value).toBeGreaterThan(uniforms.tapCount.value)
  }
  // 1280 wide: 640 px half-res, bloom radius 10 as before the round-6 change, colour radius 6 (about 13 px at full size).
  pass.setSize(1280, 720)
  expect(pass.blur.uniforms.bloomTapCount.value).toBe(5)
  expect(pass.blur.uniforms.tapCount.value).toBe(3)
})

test('gaussian taps are normalised', () => {
  for (const radius of [1, 6, 10, 32]) {
    const taps = new Float32Array(32)
    const { centerWeight, tapCount } = gaussianTaps(radius, taps)
    let total = centerWeight
    for (let i = 0; i < tapCount; i += 1) total += 2 * taps[i * 2 + 1]
    expect(total).toBeCloseTo(1, 5)
  }
})

// Ground points at the focus height seen by the walk camera: the sharp band and falloffs are fractions of frame height.
test('the sharp band spans 40 % of the frame height with 22 % falloffs each side', () => {
  const pitch = 35
  const distance = 7.5
  const camera = new PerspectiveCamera(30, 16 / 9, 0.1, 160)
  const focus = new Vector3(0, 0.38, 0)
  const rad = pitch * Math.PI / 180
  camera.position.copy(focus).add(new Vector3(0, distance * Math.sin(rad), distance * Math.cos(rad)))
  camera.lookAt(focus)
  camera.updateMatrixWorld()
  const viewDepth = (z) => -new Vector3(0, 0.38, z).applyMatrix4(camera.matrixWorldInverse).z
  const screenY = (z) => new Vector3(0, 0.38, z).project(camera).y / 2
  const zAtDepth = (depth) => {
    let low = -40
    let high = 40
    for (let i = 0; i < 60; i += 1) {
      const middle = (low + high) / 2
      // Depth grows as z falls (the camera sits at +z).
      if (viewDepth(middle) > depth) low = middle
      else high = middle
    }
    return low
  }
  const bands = defocusBands({
    fov: 30, pitch, height: camera.position.y - 0.38, near: 0.1, far: 160,
  }, distance, distance)
  expect(screenY(zAtDepth(bands.sharpFar))).toBeCloseTo(0.20, 2)
  expect(screenY(zAtDepth(bands.sharpNear))).toBeCloseTo(-0.20, 2)
  expect(screenY(zAtDepth(bands.sharpFar + bands.falloffFar))).toBeCloseTo(0.42, 2)
  expect(screenY(zAtDepth(bands.sharpNear - bands.falloffNear))).toBeCloseTo(-0.42, 2)
})
