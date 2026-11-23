import { Color, HalfFloatType, Vector2, Vector3, WebGLRenderTarget } from 'three'
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js'
import { CopyShader } from 'three/examples/jsm/shaders/CopyShader.js'
import { look, referenceExposure, stage, stageExposure, surfaceBuffer, trollSurfaces } from '../materials/stage-look.js'

// docs/contracts.md "Camera and light": sharp band 40 % of frame height centred on the troll, smooth falloff over
// 22 % each side, max blur 1.0 % of image width (round 6; was 30 % / 1.5 %).
export const TILT_SHIFT = { sharpBand: 0.40, falloff: 0.22, maxBlur: 0.010 }
// The emissive bloom shares the half-res blur but keeps its round-5 radius (lantern halo 1.5-3 % of frame width).
export const BLOOM_RADIUS = 0.015
const BLUR_RADIUS = TILT_SHIFT.maxBlur
const MAX_TAP_PAIRS = 16
const FOCUS_HEIGHT = 0.38
const MIN_RAY_ANGLE = Math.PI / 180

// Screen vertical position (fraction of frame height from the centre, up positive) <-> view depth of the plane at
// the focus height, for a camera `height` above that plane pitched `pitch` radians down.
const depthAtFraction = (fraction, height, pitch, tanHalf) => {
  const angle = Math.atan(2 * fraction * tanHalf)
  const ray = Math.max(MIN_RAY_ANGLE, pitch - angle)
  return height * Math.cos(angle) / Math.sin(ray)
}
const fractionAtDepth = (depth, height, pitch, tanHalf) =>
  (depth * Math.sin(pitch) - height) / (depth * Math.cos(pitch)) / (2 * tanHalf)

// Depth range kept sharp (the band around the focus range) and the depth width of each falloff, so the band and
// falloffs hold as fractions of the frame height at any pitch and distance.
export function defocusBands({ fov, pitch, height, near, far }, focusNear, focusFar, band = TILT_SHIFT) {
  const tanHalf = Math.tan(fov * Math.PI / 360)
  const rad = pitch * Math.PI / 180
  const low = fractionAtDepth(focusNear, height, rad, tanHalf)
  const high = fractionAtDepth(focusFar, height, rad, tanHalf)
  const half = band.sharpBand / 2
  const sharpNear = Math.max(near, Math.min(focusNear, depthAtFraction(low - half, height, rad, tanHalf)))
  const sharpFar = Math.min(far, Math.max(focusFar, depthAtFraction(high + half, height, rad, tanHalf)))
  const fallNear = depthAtFraction(low - half - band.falloff, height, rad, tanHalf)
  const fallFar = depthAtFraction(high + half + band.falloff, height, rad, tanHalf)
  return {
    sharpNear, sharpFar,
    falloffNear: Math.max(0.05, sharpNear - Math.max(near, fallNear)),
    falloffFar: Math.max(0.05, Math.min(far, fallFar) - sharpFar),
  }
}

// Linear-filter Gaussian taps for `radius` texels: fills `taps` ([offset, weight] pairs), returns the centre weight
// and the number of pairs in use.
export function gaussianTaps(radius, taps) {
  const sigma = radius / 2
  const weight = (offset) => Math.exp(-0.5 * (offset / sigma) ** 2)
  const tapCount = Math.ceil(radius / 2)
  let total = 1
  for (let i = 0; i < tapCount; i++) {
    const offset = i * 2 + 1
    const near = weight(offset)
    const far = offset < radius ? weight(offset + 1) : 0
    const combined = near + far
    taps[i * 2] = offset + far / combined
    taps[i * 2 + 1] = combined
    total += 2 * combined
  }
  for (let i = 0; i < tapCount; i++) taps[i * 2 + 1] /= total
  return { centerWeight: 1 / total, tapCount }
}
const bloomDefine = look.bloom ? { ATLAS_BLOOM: 1 } : {}
const emissionOutput = /* glsl */ `
  #ifdef ATLAS_BLOOM
    uniform sampler2D emission;
    layout(location = 1) out vec4 blurredEmission;
  #endif
`

const depthFocus = /* glsl */ `
#include <packing>
uniform sampler2D sceneDepth;
uniform float nearPlane;
uniform float farPlane;
uniform vec2 focusRange;
uniform vec2 sharpRange;
uniform vec2 falloffRange;

float depthAt(float rawDepth) {
  return -perspectiveDepthToViewZ(rawDepth, nearPlane, farPlane);
}

float defocus(float depth) {
  float offset = depth - clamp(depth, sharpRange.x, sharpRange.y);
  return smoothstep(0.0, offset < 0.0 ? falloffRange.x : falloffRange.y, abs(offset));
}
`

class GaussianPass extends ShaderPass {
  constructor() {
    super({
      name: 'Separable Gaussian',
      defines: bloomDefine,
      uniforms: {
        tDiffuse: { value: null },
        emission: { value: null },
        texelStep: { value: new Vector2() },
        centerWeight: { value: 1 },
        tapCount: { value: 0 },
        taps: { value: new Float32Array(MAX_TAP_PAIRS * 2) },
        bloomCenterWeight: { value: 1 },
        bloomTapCount: { value: 0 },
        bloomTaps: { value: new Float32Array(MAX_TAP_PAIRS * 2) },
      },
      vertexShader: CopyShader.vertexShader,
      fragmentShader: `
        uniform sampler2D tDiffuse;
        uniform vec2 texelStep;
        uniform float centerWeight;
        uniform int tapCount;
        uniform vec2 taps[${MAX_TAP_PAIRS}];
        uniform float bloomCenterWeight;
        uniform int bloomTapCount;
        uniform vec2 bloomTaps[${MAX_TAP_PAIRS}];
        varying vec2 vUv;
        ${emissionOutput}

        void main() {
          gl_FragColor = texture2D(tDiffuse, vUv) * centerWeight;
          for (int i = 0; i < ${MAX_TAP_PAIRS}; i++) {
            if (i >= tapCount) break;
            vec2 offset = taps[i].x * texelStep;
            gl_FragColor += (texture2D(tDiffuse, vUv + offset)
                           + texture2D(tDiffuse, vUv - offset)) * taps[i].y;
          }
          #ifdef ATLAS_BLOOM
            blurredEmission = texture2D(emission, vUv) * bloomCenterWeight;
            for (int i = 0; i < ${MAX_TAP_PAIRS}; i++) {
              if (i >= bloomTapCount) break;
              vec2 offset = bloomTaps[i].x * texelStep;
              blurredEmission += (texture2D(emission, vUv + offset)
                                 + texture2D(emission, vUv - offset)) * bloomTaps[i].y;
            }
          #endif
        }
      `,
    })
  }

  setRadius(radius, bloomRadius = radius) {
    const color = gaussianTaps(radius, this.uniforms.taps.value)
    this.uniforms.centerWeight.value = color.centerWeight
    this.uniforms.tapCount.value = color.tapCount
    const bloom = gaussianTaps(bloomRadius, this.uniforms.bloomTaps.value)
    this.uniforms.bloomCenterWeight.value = bloom.centerWeight
    this.uniforms.bloomTapCount.value = bloom.tapCount
  }
}

export class TiltShiftPass {
  constructor(camera) {
    this.camera = camera
    this.lowResolution = new WebGLRenderTarget(1, 1, {
      type: HalfFloatType, depthBuffer: false, count: look.bloom ? 2 : 1,
    })
    this.scratch = this.lowResolution.clone()
    this.focusRange = new Vector2(1, 1)
    this.sharpRange = new Vector2(1, 1)
    this.falloffRange = new Vector2(1, 1)
    const depthUniforms = {
      sceneDepth: { value: null },
      nearPlane: { value: camera.near },
      farPlane: { value: camera.far },
      focusRange: { value: this.focusRange },
      sharpRange: { value: this.sharpRange },
      falloffRange: { value: this.falloffRange },
    }
    this.downsample = new ShaderPass({
      name: 'Defocused color',
      defines: bloomDefine,
      uniforms: { ...depthUniforms, tDiffuse: { value: null }, emission: { value: null } },
      vertexShader: CopyShader.vertexShader,
      fragmentShader: `
        uniform sampler2D tDiffuse;
        varying vec2 vUv;
        ${depthFocus}
        ${emissionOutput}

        void main() {
          // Sharp foreground colors contribute less to the blur behind their silhouettes.
          float rawDepth = texture2D(sceneDepth, vUv).r;
          float weight = mix(0.08, 1.0, defocus(depthAt(rawDepth)));
          gl_FragColor = vec4(texture2D(tDiffuse, vUv).rgb * weight, weight);
          #ifdef ATLAS_BLOOM
            vec3 source = texture2D(emission, vUv).rgb;
            float peak = max(source.r, max(source.g, source.b));
            float threshold = smoothstep(0.035, 0.10, peak);
            blurredEmission = vec4(source * threshold * float(rawDepth < 1.0), 0.0);
          #endif
        }
      `,
    })
    this.blur = new GaussianPass()
    this.composite = new ShaderPass({
      name: 'Depth of field and saturation',
      defines: {
        ...bloomDefine,
        ...(surfaceBuffer && { ATLAS_SURFACES: 1 }),
        ...(look.grade && { ATLAS_GRADE: 1 }),
        ...(look.zones && { ATLAS_ZONES: 1 }),
        ...(look.haze && { ATLAS_HAZE: 1 }),
        ...(look.backdrop && { ATLAS_BACKDROP: 1 }),
        ...(look.bounce && { ATLAS_BOUNCE: 1 }),
        ...(look.backlight && { ATLAS_BACKLIGHT: 1 }),
      },
      uniforms: {
        ...depthUniforms, tDiffuse: { value: null }, blurred: { value: null },
        emission: { value: null }, bloomMap: { value: null },
        zoneGain: stage.gain, hazeColor: stage.haze,
        woodColor: { value: new Color(0x8a5a3b) }, worldHeight: { value: new Vector3() },
      },
      vertexShader: CopyShader.vertexShader,
      fragmentShader: `
        uniform sampler2D tDiffuse;
        uniform sampler2D blurred;
        uniform sampler2D emission;
        uniform sampler2D bloomMap;
        uniform vec3 zoneGain;
        uniform vec3 hazeColor;
        uniform vec3 woodColor;
        uniform vec3 worldHeight;
        varying vec2 vUv;
        ${depthFocus}
        const vec3 rec709 = vec3(0.2126, 0.7152, 0.0722);

        float peakChannel(vec3 rgb) {
          return max(rgb.r, max(rgb.g, rgb.b));
        }

        float colorRange(vec3 rgb) {
          return peakChannel(rgb) - min(rgb.r, min(rgb.g, rgb.b));
        }

        void main() {
          gl_FragColor = texture2D(tDiffuse, vUv);
          float rawDepth = texture2D(sceneDepth, vUv).r;
          float depth = depthAt(rawDepth);
          float strength = defocus(depth);
          float surface = 1.0;
          #ifdef ATLAS_SURFACES
            surface = texture2D(emission, vUv).a;
          #endif
          bool character = abs(surface - ${trollSurfaces.hair}) < 0.012 || abs(surface - ${trollSurfaces.body}) < 0.012;
          bool core = abs(surface - 0.9) < 0.012;
          if (strength > 0.0) {
            vec4 soft = texture2D(blurred, vUv);
            // Keep a little of the pinpoint inside the soft focus around an emissive insert.
            gl_FragColor.rgb = mix(gl_FragColor.rgb, soft.rgb / max(soft.a, 0.001), core ? 0.40 * strength : strength);
          }
          float haze = 0.0;
          float halo = 0.0;
          bool cream = abs(surface - 0.2) < 0.012;
          bool prop = abs(surface - 0.4) < 0.012;
          bool feltProp = prop || abs(surface - 0.7) < 0.012;
          bool frond = abs(surface - 0.8) < 0.012;
          float y = worldHeight.x + depth * ((2.0 * vUv.y - 1.0) * worldHeight.y - worldHeight.z);
          bool backdrop = rawDepth >= 1.0 || abs(y + 0.68) < 0.035;
          #ifdef ATLAS_ZONES
            if (!character) gl_FragColor.rgb *= zoneGain;
          #endif
          #ifdef ATLAS_HAZE
            float farOffset = depth - focusRange.y;
            if (!character) haze = smoothstep(0.62, max(1.2, focusRange.y * 0.28), farOffset);
          #endif
          #ifdef ATLAS_BLOOM
            if (!cream && !character) {
              vec3 glow = texture2D(bloomMap, vUv).rgb;
              float peak = max(glow.r, max(glow.g, glow.b));
              halo = smoothstep(0.0016, 0.006, peak);
              gl_FragColor.rgb += glow * halo * 1.5;
            }
          #endif
          #ifdef ATLAS_GRADE
            // Retain the authored exposure on the focal character.
            if (character) gl_FragColor.rgb *= ${(referenceExposure / stageExposure).toFixed(6)};
          #endif
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          float luminance = dot(gl_FragColor.rgb, rec709);
          #ifdef ATLAS_GRADE
            float saturation = character ? 1.25 : 1.24 - 0.39 * haze;
          #else
            float saturation = 1.25 - 0.79 * haze;
          #endif
          vec3 candy = mix(vec3(luminance), gl_FragColor.rgb, saturation);
          // Opaque mint felt stores its grade weight in alpha. Keep the photo's wool shading.
          vec3 mint = gl_FragColor.g * (vec3(158.0, 224.0, 184.0) / 224.0);
          vec3 color = mix(mint, candy, gl_FragColor.a);
          float cutEdgeRim = 0.0;
          if (!character) {
            #ifdef ATLAS_GRADE
              float lowerMid = smoothstep(0.12, 0.38, luminance) * (1.0 - smoothstep(0.48, 0.63, luminance));
              float upperMid = smoothstep(0.51, 0.69, luminance) * (1.0 - smoothstep(0.70, 0.84, luminance));
              float mid = 0.027 * lowerMid - 0.062 * upperMid;
              color *= max(0.0, 1.0 + mid / max(0.04, luminance));
            #endif
            #ifdef ATLAS_GRADE
              // Keep the vignette confined to the near, defocused corners.
              float corner = smoothstep(0.17, 0.50, abs(vUv.x - 0.5)) * (1.0 - smoothstep(0.0, 0.29, vUv.y));
              color *= 1.0 - 0.37 * corner;
            #endif
            #ifdef ATLAS_HAZE
              // Mix the air after exposure so it stays luminous without lifting the far band into a solid fill.
              vec3 air = sRGBTransferOETF(vec4(hazeColor, 1.0)).rgb;
              color = mix(color, air, 0.34 * haze);
            #endif
            #ifdef ATLAS_GRADE
              float value = peakChannel(color);
              float saturationAmount = colorRange(color) / max(value, 0.001);
              float gray = dot(color, rec709);
              float chroma = 0.41 * smoothstep(0.50, 0.98, saturationAmount) - 0.15 * (1.0 - haze);
              float moss = float(abs(surface - 0.5) < 0.012);
              chroma -= moss * 0.075 * (1.0 - 0.65 * haze);
              color = mix(color, vec3(gray), chroma);
              // Deep occlusion retains texture and pigment through the toe of the grade.
              float toe = smoothstep(0.20, 0.41, mix(gray, value, 0.26));
              float shoulder = smoothstep(0.47, 0.62, gray) * (1.0 - smoothstep(0.73, 0.88, gray));
              color *= mix(0.60, 1.0, toe) - 0.20 * shoulder;
              float displayLuma = dot(color, rec709);
              float lowerMidLift = 0.065 * smoothstep(0.15, 0.25, displayLuma) * (1.0 - smoothstep(0.43, 0.55, displayLuma));
              color *= 1.0 + lowerMidLift / max(0.03, displayLuma) - 0.010 * smoothstep(0.76, 0.86, displayLuma);
            #endif
            #ifdef ATLAS_BACKLIGHT
              float skyLight = smoothstep(0.70, 0.99, vUv.y)
                * (1.0 - smoothstep(0.13, 0.53, abs(vUv.x - 0.48)));
              float onPigment = smoothstep(-0.04, 0.12, min(color.r, color.g) - color.b);
              float highlight = max(skyLight * (0.78 + 0.16 * haze),
                onPigment * smoothstep(0.64, 0.82, dot(color, rec709)) * 0.95);
              color = mix(color, vec3(0.89, 0.90, 0.61), highlight);
            #endif
            #ifdef ATLAS_BACKDROP
              if (backdrop) {
                vec3 wood = sRGBTransferOETF(vec4(woodColor, 1.0)).rgb;
                vec3 air = sRGBTransferOETF(vec4(hazeColor, 1.0)).rgb;
                vec3 gradient = mix(wood, air, smoothstep(0.0, 1.0, vUv.y) * 0.77);
                color = mix(color, gradient, 0.74);
              }
            #endif
            #ifdef ATLAS_BOUNCE
              float shadowLuma = dot(color, rec709);
              float shadow = 1.0 - smoothstep(0.12, 0.40, shadowLuma);
              vec3 shadowTint = max(shadowLuma, 0.137) * vec3(0.46, 1.18, 0.88);
              if (!frond) color = mix(color, shadowTint, (feltProp ? 0.30 : 0.88) * shadow);
              if (feltProp) {
                // Magenta and violet felt need more bounce to stay readable at low luma.
                float coolPigment = smoothstep(0.05, 0.34, max(color.r, color.b) - color.g);
                color *= 1.0 + shadow * (0.017 + 0.095 * coolPigment) / max(shadowLuma, 0.08);
                float peak = peakChannel(color);
                float chroma = colorRange(color);
                // Keep the felt pigment visible after the light and depth grades mix.
                float gain = clamp(0.32 * peak / max(chroma, 0.018), 1.0, 2.0);
                color = vec3(peak) + (color - vec3(peak)) * gain;
              }
            #endif
            if (frond) {
              float leaf = dot(color, rec709);
              float leafLuma = clamp(leaf * 0.55 + 0.052, 0.124, 0.25);
              color = mix(color * leafLuma / max(leaf, 0.01), leafLuma * vec3(0.45, 1.19, 0.70), 0.87);
            }
            #ifdef ATLAS_BACKLIGHT
              if (prop && strength < 0.30) {
                // A small fibre rim where the silhouette opens toward the rear key.
                vec2 pixel = 1.35 / vec2(textureSize(sceneDepth, 0));
                vec2 towardKey = vUv + pixel * vec2(-0.75, 1.0);
                float neighbor = texture2D(emission, towardKey).a;
                float behind = depthAt(texture2D(sceneDepth, towardKey).r) - depth;
                float outerEdge = float(abs(neighbor - 0.4) >= 0.012);
                cutEdgeRim = 0.19 * max(outerEdge, smoothstep(0.035, 0.28, behind));
                color += cutEdgeRim * vec3(1.0, 0.91, 0.60) * (1.0 - 0.66 * peakChannel(color));
              }
            #endif
          }
          gl_FragColor = vec4(color, 1.0);
          /* Look statistics probe. */
        }
      `,
    })
    this.composite.uniforms.zoneGain = stage.gain
    this.composite.uniforms.hazeColor = stage.haze
    this.composite.uniforms.blurred.value = this.lowResolution.texture
    this.composite.uniforms.bloomMap.value = this.lowResolution.textures[1] ?? null
    this.composite.renderToScreen = true

    for (const pass of [this.downsample, this.blur, this.composite]) {
      pass.material.depthTest = false
      pass.material.depthWrite = false
    }
  }

  setSize(width, height) {
    const maxWidth = Math.floor(2 * MAX_TAP_PAIRS / BLOOM_RADIUS)
    const scale = Math.min(0.5, maxWidth / width)
    const blurWidth = Math.max(1, Math.round(width * scale))
    const blurHeight = Math.max(1, Math.round(height * scale))
    this.lowResolution.setSize(blurWidth, blurHeight)
    this.scratch.setSize(blurWidth, blurHeight)
    this.blur.setRadius(Math.max(1, Math.round(blurWidth * BLUR_RADIUS)),
      Math.max(1, Math.round(blurWidth * BLOOM_RADIUS)))
  }

  render(renderer, image) {
    for (const pass of [this.downsample, this.composite]) {
      pass.uniforms.focusRange.value = this.focusRange
      pass.uniforms.sharpRange.value = this.sharpRange
      pass.uniforms.falloffRange.value = this.falloffRange
      pass.uniforms.sceneDepth.value = image.depthTexture
    }
    const pitch = Math.asin(Math.min(1, Math.max(0, this.camera.matrixWorld.elements[9])))
    const bands = defocusBands({
      fov: this.camera.fov, pitch: pitch * 180 / Math.PI, height: this.camera.position.y - FOCUS_HEIGHT,
      near: this.camera.near, far: this.camera.far,
    }, this.focusRange.x, this.focusRange.y)
    this.sharpRange.set(bands.sharpNear, bands.sharpFar)
    this.falloffRange.set(bands.falloffNear, bands.falloffFar)
    if (look.bloom) {
      this.downsample.uniforms.emission.value = image.textures[1]
    }
    if (surfaceBuffer) this.composite.uniforms.emission.value = image.textures[1]
    const { position, matrixWorld, projectionMatrix } = this.camera
    this.composite.uniforms.worldHeight.value.set(position.y,
      matrixWorld.elements[5] / projectionMatrix.elements[5], matrixWorld.elements[9])
    this.downsample.render(renderer, this.lowResolution, image)
    const step = this.blur.uniforms.texelStep.value
    step.set(1 / this.lowResolution.width, 0)
    if (look.bloom) this.blur.uniforms.emission.value = this.lowResolution.textures[1]
    this.blur.render(renderer, this.scratch, this.lowResolution)
    step.set(0, 1 / this.lowResolution.height)
    if (look.bloom) this.blur.uniforms.emission.value = this.scratch.textures[1]
    this.blur.render(renderer, this.lowResolution, this.scratch)
    this.composite.render(renderer, null, image)
  }
}
