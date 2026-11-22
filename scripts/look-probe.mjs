import assert from 'node:assert/strict'
import { setTimeout as delay } from 'node:timers/promises'
import { stageFlags } from '../src/effects/flags.js'
import { trollSurfaces } from '../src/materials/stage-look.js'
import { fileURLToPath } from 'node:url'
import { cellAt, FIRST_PAGE_ROW, LAST_PAGE_ROW, PAGE_MAX_Z, PAGE_MIN_Z } from '../src/world/tiles.js'
import { createLayout } from '../src/world/layout.js'

export const characterLayers = { hair: 8, body: 9 }

export async function installLookProbe(stepped) {
  const { page } = stepped
  await page.addInitScript(({ layers, surfaces }) => {
    const probe = window.__lookProbe = { skip: false, mode: 0 }
    const gl = WebGL2RenderingContext.prototype
    const shaderSource = gl.shaderSource
    const readMask = '/* Look statistics probe. */'
    gl.shaderSource = function (shader, source) {
      if (source.includes(readMask)) {
        probe.hasMask = true
        source = source.replace('void main()', 'uniform int atlasLookMask;\nvoid main()')
          .replace(readMask, `
            if (atlasLookMask == 1) {
              float prop = float(abs(surface - 0.4) < 0.012);
              bool tabletop = abs(surface - 0.6) < 0.012 || rawDepth == 1.0;
              bool frond = abs(surface - 0.8) < 0.012;
              bool applique = abs(surface - 0.7) < 0.012;
              bool moss = abs(surface - 0.5) < 0.012;
              bool hair = abs(surface - ${surfaces.hair}) < 0.012;
              bool body = abs(surface - ${surfaces.body}) < 0.012;
              float layer = hair ? ${layers.hair}.0 : body ? ${layers.body}.0 : tabletop ? 3.0 : frond ? 5.0 : applique ? 6.0 :
                moss ? 7.0 : prop * (depth > focusRange.y && haze >= 0.75 ? 2.0 :
                strength < 0.20 ? 1.0 : 4.0);
              gl_FragColor = vec4(float(cream), float(halo > 0.0), layer / 255.0, 1.0);
            }
            if (atlasLookMask == 2) {
              float key = abs(surface - 0.72) < 0.012 ? texture2D(emission, vUv).r : 0.0;
              gl_FragColor = vec4(key, 0.0, 0.0, 1.0);
            }
            if (atlasLookMask == 3) {
              float rim = abs(surface - 0.43) < 0.012 ? texture2D(emission, vUv).r : 0.0;
              gl_FragColor = vec4(max(rim, cutEdgeRim), 0.0, 0.0, 1.0);
            }
          `)
      }
      if (source.includes('float canopyLight()') && source.includes('atlasEmission = vec4')) {
        source = source.replace('void main()', 'uniform bool atlasDappleProbe;\nvoid main()')
          .replace(/(atlasEmission = vec4[^;]+;)/, `$1
            if (atlasDappleProbe && craftCanopyGrove > 0.5) atlasEmission = vec4(canopyLight(), 0.0, 0.0, 0.72);
          `)
      }
      if (source.includes('vec3 craftRimLight') && source.includes('atlasEmission = vec4')) {
        source = source.replace('void main()', 'uniform bool atlasRimProbe;\nvoid main()')
          .replace(/(atlasEmission = vec4[^;]+;)/, '$1\n'
            + 'if (atlasRimProbe) atlasEmission = vec4(dot(craftRimLight, vec3(0.2126, 0.7152, 0.0722)), 0.0, 0.0, 0.43);')
      }
      return shaderSource.call(this, shader, source)
    }
    for (const name of ['drawElements', 'drawElementsInstanced', 'drawArrays', 'drawArraysInstanced',
      'clear', 'clearBufferfv', 'clearBufferiv', 'clearBufferuiv', 'clearBufferfi']) {
      const method = gl[name]
      gl[name] = function (...args) {
        if (probe.skip) return
        if (probe.mode && name.startsWith('draw')) {
          const program = this.getParameter(this.CURRENT_PROGRAM)
          const uniform = program && this.getUniformLocation(program, 'atlasLookMask')
          if (uniform) {
            this.uniform1i(uniform, probe.mode)
            method.apply(this, args)
            this.readPixels(0, 0, this.canvas.width, this.canvas.height, this.RGBA, this.UNSIGNED_BYTE, probe.pixels)
            this.uniform1i(uniform, 0)
            probe.didRead = true
            return
          }
          if (probe.mode > 1 && program) {
            const diagnostic = this.getUniformLocation(program, probe.mode === 2 ? 'atlasDappleProbe' : 'atlasRimProbe')
            if (diagnostic) {
              this.uniform1i(diagnostic, 1)
              method.apply(this, args)
              this.uniform1i(diagnostic, 0)
              return
            }
          }
        }
        return method.apply(this, args)
      }
    }
  }, { layers: characterLayers, surfaces: trollSurfaces })
  const open = async (url) => {
    await stepped.open(url)
    const query = new URL(url).searchParams
    if (!query.has('look-probe')) return
    if (!Object.values(stageFlags(new URL(url).search)).some(Boolean)) return
    const deadline = Date.now() + 15_000
    while (!(await page.evaluate(() => window.__atlasLookShots?.scene.getObjectByName('atlas/stage-effects')?.visible))) {
      assert.ok(Date.now() < deadline, 'Stage effects did not warm up')
      assert.deepEqual(stepped.errors, [], 'Browser errors warming the stage')
      await stepped.advance(0, 60)
      await delay(25)
    }
  }
  const advance = (first, fps, count = 1) => page.evaluate(([frame, rate, steps]) => {
    const probe = window.__lookProbe
    // Physics and scheduling take every step. Only the displayed step needs rasterization.
    probe.skip = true
    try {
      window.__atlasStep(frame, rate, steps - 1)
    } finally {
      probe.skip = false
    }
    probe.frame = frame + steps - 1
    probe.fps = rate
    window.__atlasStep(probe.frame, rate, 1)
  }, [first, fps, count])

  const readMask = async (mode = 1) => {
    const result = await page.evaluate((mode) => {
      const probe = window.__lookProbe
      if (!probe.hasMask) return null
      const canvas = document.querySelector('canvas')
      const { width, height } = canvas
      const flipped = probe.pixels = new Uint8Array(width * height * 4)
      probe.didRead = false
      probe.mode = mode
      try {
        window.__atlasStep(probe.frame, probe.fps, 1)
        if (!probe.didRead) throw new Error('The diagnostic draw did not produce pixels')
      } finally {
        probe.mode = 0
        probe.pixels = null
        window.__atlasStep(probe.frame, probe.fps, 1)
      }
      const pixels = new Uint8Array(flipped.length)
      const stride = width * 4
      for (let y = 0; y < height; y++) {
        pixels.set(flipped.subarray(y * stride, (y + 1) * stride), (height - 1 - y) * stride)
      }
      return pixels.toBase64()
    }, mode)
    return result && Buffer.from(result, 'base64')
  }
  return { ...stepped, advance, open, readMask }
}

export function readStageLighting(page) {
  return page.evaluate(() => {
    const { scene, camera } = window.__atlasLookShots
    const key = scene.children.find((object) => object.isDirectionalLight && object.castShadow)
    const bounce = scene.children.find((object) => object.isHemisphereLight)
    const offset = key.position.clone().sub(key.target.position)
    return {
      elevation: Math.atan2(offset.y, Math.hypot(offset.x, offset.z)) * 180 / Math.PI,
      farSide: offset.dot(camera.getWorldDirection(offset.clone())) > 0 && offset.z < 0,
      key: '#' + key.color.getHexString(),
      ground: '#' + bounce.groundColor.getHexString(),
    }
  })
}

export function readStageEffects(page, mask) {
  return page.evaluate((encodedMask) => {
    const { camera, scene } = window.__atlasLookShots
    const probe = window.__lookProbe
    const canvas = document.querySelector('canvas')
    const { width, height } = canvas
    const gl = canvas.getContext('webgl2')
    const layers = Uint8Array.fromBase64(encodedMask)
    const get = (name) => scene.getObjectByName('atlas/' + name)
    const offset = (x, y) => 4 * (y * width + x)
    const topOffset = (x, y) => offset(x, height - 1 - y)
    const inside = (x, y) => x >= 0 && y >= 0 && x < width && y < height
    const luma = (pixels, i) => 0.2126 * pixels[i] + 0.7152 * pixels[i + 1] + 0.0722 * pixels[i + 2]
    const draw = () => {
      window.__atlasStep(probe.frame, probe.fps, 1)
      const pixels = new Uint8Array(layers.length)
      gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
      return pixels
    }
    const full = draw()
    const rig = get('stage-effects')?.children.filter((object) => object.name.startsWith('atlas/lantern/') && object.visible)
    let riggingMask
    if (rig?.length) {
      for (const part of rig) part.visible = false
      try {
        const off = draw()
        const pixels = new Uint8Array(width * height)
        // Compare the composited draw so translucent card, additive glow and blur all count.
        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) {
            const i = topOffset(x, y)
            pixels[y * width + x] = Number(full[i] !== off[i] || full[i + 1] !== off[i + 1] || full[i + 2] !== off[i + 2])
          }
        }
        riggingMask = pixels.toBase64()
      } finally {
        for (const part of rig) part.visible = true
      }
    }

    function air(name) {
      const mesh = get(name)
      if (!mesh) return null
      // Hide the one draw without modifying the deterministic placements or the frame clock.
      mesh.visible = false
      let off
      try {
        off = draw()
      } finally {
        mesh.visible = true
      }
      const { elapsed, focus, parallax } = mesh.material.uniforms
      const { placement, motion } = mesh.geometry.attributes
      const bokeh = name === 'bokeh'
      const [sx, , , , , sy] = camera.projectionMatrix.elements
      const result = { placed: placement.count, visible: 0, top40: 0, sharp: 0, twinkling: 0, sizes: [], alphas: [], speeds: [] }
      const wrap = (x) => x - 2 * Math.floor((x + 1) / 2)
      for (let i = 0; i < placement.count; i++) {
        let x = 2 * placement.getX(i) - 1
        let y = 2 * placement.getY(i) - 1
        const phase = motion.getZ(i)
        if (bokeh) {
          x += Math.sin(phase + 0.14 * elapsed.value) * 0.022
          y += Math.cos(phase + 0.18 * elapsed.value) * 0.022
        } else {
          const depth = focus.value * (0.40 + 0.40 * motion.getX(i))
          const angle = phase + elapsed.value * motion.getY(i) / 0.46
          x = wrap(x + (0.46 * Math.cos(angle) - parallax.value.x) * sx / depth)
          y = wrap(y + (0.46 * Math.sin(angle) - parallax.value.y) * sy / depth)
        }
        result.sizes.push(placement.getZ(i))
        result.alphas.push(placement.getW(i))
        result.speeds.push(motion.getY(i))
        result.twinkling += motion.getW(i)
        const px = Math.floor((1 + x) * width / 2)
        const py = Math.floor((1 + y) * height / 2)
        let changed = 0
        const radius = bokeh ? 4 : 2
        for (let cy = py - radius; cy <= py + radius; cy++) {
          for (let cx = px - radius; cx <= px + radius; cx++) {
            if (!inside(cx, cy)) continue
            const p = offset(cx, cy)
            for (let c = 0; c < 3; c++) changed = Math.max(changed, Math.abs(full[p + c] - off[p + c]))
          }
        }
        if (changed < 3) continue
        result.visible++
        if (y >= 0.20) result.top40++
        if (Math.abs(y) < 0.30) result.sharp++
      }
      for (const key of ['sizes', 'alphas', 'speeds']) result[key] = [Math.min(...result[key]), Math.max(...result[key])]
      return result
    }

    const bokeh = air('bokeh')
    const motes = air('motes')
    const key = scene.children.find((object) => object.isDirectionalLight && object.castShadow)
    const intensity = key.intensity
    let shade
    if (get('moss/0')) {
      key.intensity = 0
      try {
        shade = draw()
      } finally {
        key.intensity = intensity
      }
    }
    const ratios = []
    const fronds = []
    const player = window.__atlas.player
    const corner = camera.position.clone()
    const actorBounds = [width, height, 0, 0]
    for (const sx of [-0.45, 0.45]) {
      for (const sy of [-0.05, 1.10]) {
        for (const sz of [-0.45, 0.45]) {
          corner.set(player.x + sx, sy, player.z + sz).project(camera)
          const x = (corner.x + 1) * width / 2
          const y = (corner.y + 1) * height / 2
          actorBounds[0] = Math.min(actorBounds[0], x)
          actorBounds[1] = Math.min(actorBounds[1], y)
          actorBounds[2] = Math.max(actorBounds[2], x)
          actorBounds[3] = Math.max(actorBounds[3], y)
        }
      }
    }
    const [left, bottom, right, top] = actorBounds
    let overlap = 0
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const layer = layers[topOffset(x, y) + 2]
        const i = offset(x, y)
        if (layer === 5) {
          fronds.push(luma(full, i))
          if (x >= left && x <= right && y >= bottom && y <= top) overlap++
        }
        if (shade && layer === 7 && y >= height * 0.35 && y <= height * 0.65) {
          const dim = luma(shade, i)
          if (dim && luma(full, i) > dim + 5) ratios.push(luma(full, i) / dim)
        }
      }
    }
    const median = (values) => values.sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? null
    const crop = camera.position.clone()
    const matrix = camera.matrixWorld.clone()
    function emitter(center, kind) {
      const p = crop.copy(center).project(camera)
      const x = Math.floor((p.x + 1) * width / 2)
      const y = Math.floor((p.y + 1) * height / 2)
      if (!inside(x, y) || p.z < -1 || p.z > 1) return null
      const radii = []
      for (let ray = 0; ray < 8; ray++) {
        const theta = ray * Math.PI / 4
        for (let radius = 0; radius < 0.07 * width; radius++) {
          const px = Math.round(x + radius * Math.cos(theta))
          const py = Math.round(y + radius * Math.sin(theta))
          if (!inside(px, py)) break
          if (layers[topOffset(px, py) + 1] === 255) continue
          radii.push(radius)
          break
        }
      }
      return { kind, x, y: height - 1 - y, luma: luma(full, offset(x, y)), radius: median(radii) }
    }
    const lanterns = get('lantern/seed-core')
    const center = crop.clone()
    const emitters = []
    for (let i = 0; i < (lanterns?.count ?? 0); i++) {
      lanterns.getMatrixAt(i, matrix)
      emitters.push(emitter(center.setFromMatrixPosition(matrix), 'lantern'))
    }
    for (const core of get('stage-effects')?.children ?? []) {
      if (core.name === 'atlas/fold-core' && core.visible) emitters.push(emitter(core.position, 'fold core'))
    }
    draw()
    return { bokeh, motes, moss: { samples: ratios.length, sunToShade: median(ratios) },
      fronds: { share: fronds.length * 100 / (width * height), medianLuma: median(fronds), overlap },
      riggingMask, trollBounds: [left, height - top, right, height - bottom],
      emitters: emitters.filter(Boolean) }
  }, mask.toString('base64'))
}

export function readFoldFlash(page, { i, j }, frame, fps) {
  return page.evaluate(({ i, j, frame, fps }) => {
    const { hingeTrace, foldLog } = window.__atlas
    const fold = foldLog.findLast((event) => event.i === i && event.j === j && event.dir === 'up')
    const upright = hingeTrace(`${i},${j}`).find(({ t, angle }) => t >= fold?.t && angle >= 0)
    if (!upright) return null
    const stage = window.__atlasLookShots.scene.getObjectByName('atlas/stage-effects')
    const glitter = stage.getObjectByName('atlas/fold-glitter')
    const { born, position } = glitter.geometry.attributes
    const point = glitter.position.clone()
    let burstAt
    let flakes = 0
    for (let index = 0; index < born.count; index++) {
      const t = born.getX(index)
      if (Math.abs(t - upright.t) > 0.0001) continue
      burstAt = t
      point.fromBufferAttribute(position, index)
      flakes++
    }
    if (!flakes) return { uprightAt: upright.t, flakes }
    const core = stage.children.filter((object) => object.name === 'atlas/fold-core' && object.visible)
      .sort((a, b) => a.position.distanceToSquared(point) - b.position.distanceToSquared(point))[0]
    if (!core) return { uprightAt: upright.t, burstAt, flakes }
    const { camera } = window.__atlasLookShots
    const p = point.copy(core.position).project(camera)
    const canvas = document.querySelector('canvas')
    const gl = canvas.getContext('webgl2')
    const pixel = new Uint8Array(4)
    window.__atlasStep(frame, fps, 1)
    gl.readPixels(Math.floor((p.x + 1) * canvas.width / 2), Math.floor((p.y + 1) * canvas.height / 2),
      1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel)
    return { uprightAt: upright.t, burstAt, flakes, visible: glitter.visible, emissive: core.material.emissiveIntensity,
      emitterLuma: 0.2126 * pixel[0] + 0.7152 * pixel[1] + 0.0722 * pixel[2] }
  }, { i, j, frame, fps })
}

export function groveInFrame(seed, player, width, height) {
  const layout = createLayout(seed)
  const angle = Math.PI / 4
  const tanHalfFov = Math.tan(Math.PI / 12)
  const distance = 10
  const aspect = width / height
  for (let y = -1; y <= 1; y += 0.05) {
    const rayY = -Math.sin(angle) + y * tanHalfFov * Math.cos(angle)
    const rayZ = -Math.cos(angle) - y * tanHalfFov * Math.sin(angle)
    const depth = -distance * Math.sin(angle) / rayY
    const z = player.z + distance * Math.cos(angle) + rayZ * depth
    if (z < PAGE_MIN_Z || z > PAGE_MAX_Z) continue
    const j = Math.min(LAST_PAGE_ROW, Math.max(FIRST_PAGE_ROW, cellAt(z)))
    for (let x = -1; x <= 1; x += 0.05) {
      const i = cellAt(player.x + depth * x * tanHalfFov * aspect)
      if (layout.getCell(i, j).zone === 'grove') return true
    }
  }
  return false
}

export async function addBloomWitness(page) {
  await page.route('**/__look_probe__/three*.js', (route) => {
    const name = new URL(route.request().url()).pathname.split('/').at(-1)
    assert.match(name, /^three\.(core|module)\.js$/)
    return route.fulfill({ path: fileURLToPath(new URL('../node_modules/three/build/' + name, import.meta.url)),
      contentType: 'text/javascript' })
  })
  return page.evaluate(async () => {
    const { camera, scene } = window.__atlasLookShots
    const { Mesh, MeshBasicMaterial, MeshLambertMaterial, SphereGeometry, Vector3 } =
      await import('/__look_probe__/three.module.js')
    const geometry = new SphereGeometry(0.13, 24, 12)
    const butter = 0xf7dc6f
    const emissive = new MeshLambertMaterial({ color: 0x000000, emissive: butter, emissiveIntensity: 1.4 })
    const bright = new MeshBasicMaterial({ color: butter })
    const size = [innerWidth, innerHeight]
    const centers = [emissive, bright].map((material, index) => {
      const object = new Mesh(geometry, material)
      object.name = 'look-probe-witness'
      object.position.set(index ? 1.15 : -1.15, 0.83, -7.1).applyMatrix4(camera.matrixWorld)
      scene.add(object)
      const p = new Vector3().copy(object.position).project(camera)
      return [(1 + p.x) * size[0] / 2, (1 - p.y) * size[1] / 2]
    })
    window.__lookProbe.removeWitness = () => {
      for (const child of scene.children.filter((object) => object.name === 'look-probe-witness')) scene.remove(child)
      geometry.dispose()
      emissive.dispose()
      bright.dispose()
    }
    return centers
  })
}
