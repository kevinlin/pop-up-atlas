import { HalfFloatType, Vector2, WebGLRenderTarget } from 'three'
import { Pass } from 'three/examples/jsm/postprocessing/Pass.js'
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js'
import { CopyShader } from 'three/examples/jsm/shaders/CopyShader.js'

const BLUR_RADIUS = 0.015
const MAX_TAP_PAIRS = 16

class GaussianPass extends ShaderPass {
  constructor() {
    super({
      name: 'Separable Gaussian',
      uniforms: {
        tDiffuse: { value: null },
        texelStep: { value: new Vector2() },
        centerWeight: { value: 1 },
        tapCount: { value: 0 },
        taps: { value: new Float32Array(MAX_TAP_PAIRS * 2) },
      },
      vertexShader: CopyShader.vertexShader,
      fragmentShader: `
        uniform sampler2D tDiffuse;
        uniform vec2 texelStep;
        uniform float centerWeight;
        uniform int tapCount;
        uniform vec2 taps[${MAX_TAP_PAIRS}];
        varying vec2 vUv;

        void main() {
          gl_FragColor = texture2D(tDiffuse, vUv) * centerWeight;
          for (int i = 0; i < ${MAX_TAP_PAIRS}; i++) {
            if (i >= tapCount) break;
            vec2 offset = taps[i].x * texelStep;
            gl_FragColor += (texture2D(tDiffuse, vUv + offset)
                           + texture2D(tDiffuse, vUv - offset)) * taps[i].y;
          }
        }
      `,
    })
  }

  setRadius(radius) {
    const sigma = radius / 2
    const weight = (offset) => Math.exp(-0.5 * (offset / sigma) ** 2)
    const taps = this.uniforms.taps.value
    const tapCount = Math.ceil(radius / 2)
    let total = 1

    // Sample adjacent Gaussian texels together using the texture's linear filter.
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
    this.uniforms.centerWeight.value = 1 / total
    this.uniforms.tapCount.value = tapCount
  }
}

export class TiltShiftPass extends Pass {
  constructor() {
    super()

    this.lowResolution = new WebGLRenderTarget(1, 1, { type: HalfFloatType, depthBuffer: false })
    this.scratch = this.lowResolution.clone()
    this.downsample = new ShaderPass(CopyShader)
    this.blur = new GaussianPass()
    this.composite = new ShaderPass({
      name: 'Tilt shift and saturation',
      uniforms: {
        tDiffuse: { value: null },
        blurred: { value: null },
        focusY: { value: 0.5 },
      },
      vertexShader: CopyShader.vertexShader,
      fragmentShader: `
        uniform sampler2D tDiffuse;
        uniform sampler2D blurred;
        uniform float focusY;
        varying vec2 vUv;

        void main() {
          float strength = smoothstep(0.15, 0.37, abs(vUv.y - focusY));
          gl_FragColor = mix(texture2D(tDiffuse, vUv), texture2D(blurred, vUv), strength);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          float luminance = dot(gl_FragColor.rgb, vec3(0.2126, 0.7152, 0.0722));
          gl_FragColor.rgb = mix(vec3(luminance), gl_FragColor.rgb, 1.25);
        }
      `,
    })
    // ShaderPass clones its uniforms, which cannot include a render target texture.
    this.composite.uniforms.blurred.value = this.lowResolution.texture

    for (const pass of [this.downsample, this.blur, this.composite]) {
      pass.material.depthTest = false
      pass.material.depthWrite = false
    }
  }

  set focusY(value) {
    this.composite.uniforms.focusY.value = value
  }

  setSize(width, height) {
    const maxWidth = Math.floor(2 * MAX_TAP_PAIRS / BLUR_RADIUS)
    const scale = Math.min(0.5, maxWidth / width)
    const blurWidth = Math.max(1, Math.round(width * scale))
    const blurHeight = Math.max(1, Math.round(height * scale))
    this.lowResolution.setSize(blurWidth, blurHeight)
    this.scratch.setSize(blurWidth, blurHeight)
    this.blur.setRadius(Math.max(1, Math.round(blurWidth * BLUR_RADIUS)))
  }

  render(renderer, writeBuffer, readBuffer) {
    this.downsample.render(renderer, this.lowResolution, readBuffer)
    const step = this.blur.uniforms.texelStep.value
    step.set(1 / this.lowResolution.width, 0)
    this.blur.render(renderer, this.scratch, this.lowResolution)
    step.set(0, 1 / this.lowResolution.height)
    this.blur.render(renderer, this.lowResolution, this.scratch)

    this.composite.renderToScreen = this.renderToScreen
    this.composite.render(renderer, writeBuffer, readBuffer)
  }

  dispose() {
    this.lowResolution.dispose()
    this.scratch.dispose()
    this.downsample.dispose()
    this.blur.dispose()
    this.composite.dispose()
  }
}
