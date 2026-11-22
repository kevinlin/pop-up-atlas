// In-page, per-frame duo probe. Installed after `__atlas.ready`; every stepped frame records both
// controllers, both rigs, their projected screen bounds, tile occlusion and the camera target.
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const threeFolder = '/__atlas_e2e_three/'

// The probe needs Raycaster/Matrix4/Vector3. Serve the repo's own three build to the page.
export async function serveThree(page) {
  const build = dirname(fileURLToPath(import.meta.resolve('three')))
  await page.route(`**${threeFolder}*.js`, (route) => {
    const name = new URL(route.request().url()).pathname.split('/').at(-1)
    if (!/^three\.(module|core)\.js$/.test(name)) return route.abort()
    return route.fulfill({ path: join(build, name), contentType: 'text/javascript' })
  })
}

// Runs in the page. Kept free of closures so Playwright can serialise it.
async function probe({ threeURL, stride }) {
  const THREE = await import(new URL(threeURL, window.location.href).href)
  const shots = window.__atlasLookShots
  if (!shots?.camera || !shots?.scene) throw new Error('Open the game with ?look-shots&look-probe to expose camera and scene')
  const { camera, scene } = shots
  const atlas = window.__atlas
  if (!atlas?.duo) throw new Error('window.__atlas.duo is missing: the duo implementation is not in this build')
  const playerRef = atlas.player

  const tips = []
  scene.traverse((node) => { if (node.isBone && node.name === 'hair_3') tips.push(node) })
  const contains = (node, target) => {
    let found = false
    node.traverse((child) => { if (child === target) found = true })
    return found
  }
  const rigs = tips.map((tip) => {
    let root = tip
    while (root.parent && root.parent !== scene && !tips.some((other) => other !== tip && contains(root.parent, other))) root = root.parent
    const meshes = []
    root.traverse((node) => {
      if (node.isMesh && node.geometry?.attributes?.position && !/shadow|contact|capsule/i.test(node.name)) meshes.push(node)
    })
    let hips
    root.traverse((node) => { if (!hips && node.isBone && node.name === 'root') hips = node })
    return { root, tip, hips: hips ?? root, meshes }
  })
  if (rigs.length !== 2) throw new Error(`Expected two troll rigs in the scene, found ${rigs.length}`)
  const world = (object) => object.getWorldPosition(new THREE.Vector3())
  const fromPlayer = (rig) => {
    const position = world(rig.root)
    return Math.hypot(position.x - atlas.player.x, position.z - atlas.player.z)
  }
  // A leads at start, so the rig standing on the leader is A.
  rigs.sort((a, b) => fromPlayer(a) - fromPlayer(b))
  const rigsByLabel = { a: rigs[0], b: rigs[1] }

  const vertex = new THREE.Vector3()
  const toClip = new THREE.Matrix4()
  const viewProjection = new THREE.Matrix4()
  const shown = (object) => {
    for (let node = object; node; node = node.parent) if (!node.visible) return false
    return true
  }
  function bounds(rig) {
    viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
    let x0 = Infinity
    let y0 = Infinity
    let x1 = -Infinity
    let y1 = -Infinity
    for (const mesh of rig.meshes) {
      if (!shown(mesh)) continue
      toClip.multiplyMatrices(viewProjection, mesh.matrixWorld)
      const count = mesh.geometry.attributes.position.count
      for (let i = 0; i < count; i += stride) {
        mesh.getVertexPosition(i, vertex)
        vertex.applyMatrix4(toClip)
        if (vertex.x < x0) x0 = vertex.x
        if (vertex.x > x1) x1 = vertex.x
        if (vertex.y < y0) y0 = vertex.y
        if (vertex.y > y1) y1 = vertex.y
      }
    }
    const width = window.innerWidth
    const height = window.innerHeight
    return [(x0 + 1) / 2 * width, (1 - y1) / 2 * height, (x1 + 1) / 2 * width, (1 - y0) / 2 * height]
  }

  let tiles = []
  let tilesFrame = -Infinity
  const raycaster = new THREE.Raycaster()
  const instance = new THREE.Matrix4()
  const proxy = new THREE.Mesh()
  const hits = []
  const eye = new THREE.Vector3()
  const ray = new THREE.Vector3()
  function occluded(point) {
    camera.getWorldPosition(eye)
    ray.subVectors(point, eye)
    const length = ray.length()
    raycaster.set(eye, ray.normalize())
    raycaster.near = 0
    raycaster.far = length - 0.05
    for (const mesh of tiles) {
      if (!shown(mesh)) continue
      proxy.geometry = mesh.geometry
      proxy.material = mesh.material
      const count = mesh.isInstancedMesh ? mesh.count : 1
      for (let i = 0; i < count; i++) {
        if (mesh.isInstancedMesh) {
          mesh.getMatrixAt(i, instance)
          proxy.matrixWorld.multiplyMatrices(mesh.matrixWorld, instance)
        } else proxy.matrixWorld.copy(mesh.matrixWorld)
        const e = proxy.matrixWorld.elements
        if (Math.hypot(e[12] - point.x, e[14] - point.z) > 3.5) continue
        hits.length = 0
        proxy.raycast(raycaster, hits)
        if (hits.some(({ distance }) => distance < length - 0.05)) return true
      }
    }
    return false
  }

  const direction = new THREE.Vector3()
  const right = new THREE.Vector3()
  let scanned = 0
  let lastVoice = -1
  function sample(frame) {
    // The latest voice cue with its end as of this frame: a later cut rewrites `end` in place.
    if (scanned > atlas.cueLog.length) {
      scanned = 0
      lastVoice = -1
    }
    for (; scanned < atlas.cueLog.length; scanned++) if (atlas.cueLog[scanned].kind === 'voice') lastVoice = scanned
    if (frame - tilesFrame >= 15) {
      tiles = []
      scene.traverse((node) => { if (node.isMesh && /^atlas\/[^/]+\//.test(node.name)) tiles.push(node) })
      tilesFrame = frame
    }
    const { duo, player } = atlas
    const rig = (label) => {
      const { root, hips, tip } = rigsByLabel[label]
      const position = world(root)
      const hipsAt = world(hips)
      const tipAt = world(tip)
      return {
        x: position.x, y: position.y, z: position.z, ry: root.rotation.y, hy: hipsAt.y - position.y,
        tip: tipAt.y - position.y, rect: bounds(rigsByLabel[label]),
        hidden: occluded(hipsAt) && occluded(tipAt),
      }
    }
    camera.getWorldDirection(direction)
    const reach = -camera.position.y / direction.y
    // The camera's right vector on the page (XZ): the axis the idle side slots sit on.
    right.set(1, 0, 0).applyQuaternion(camera.quaternion).setY(0).normalize()
    const follower = duo?.follower ?? {}
    const s = {
      f: frame,
      leader: duo?.leader,
      swaps: duo?.swaps,
      pending: duo?.pendingSwap,
      L: { x: player.x, z: player.z, state: player.state },
      F: { x: follower.x, z: follower.z, state: follower.state },
      a: rig('a'),
      b: rig('b'),
      cam: { x: camera.position.x + direction.x * reach, z: camera.position.z + direction.z * reach },
      right: { x: right.x, z: right.z },
      cues: atlas.cueLog.length,
      voice: lastVoice < 0 ? null : (({ t, end, cue, who }) => ({ i: lastVoice, t, end, cue, who }))(atlas.cueLog[lastVoice]),
      folds: atlas.foldLog.length,
      samePlayer: atlas.player === playerRef,
      blockedBy: 'blockedBy' in player ? player.blockedBy ?? null : undefined,
      view: [window.innerWidth, window.innerHeight],
    }
    const followerRig = s[s.leader === 'b' ? 'a' : 'b']
    s.hop = follower.state === 'hop' || followerRig.y > 0.005
    return s
  }

  window.__duoProbe = {
    labels: Object.keys(rigsByLabel),
    peek: () => sample(-1),
    project(x, y, z) {
      const point = new THREE.Vector3(x, y, z).project(camera)
      return { x: (point.x + 1) / 2 * window.innerWidth, y: (1 - point.y) / 2 * window.innerHeight }
    },
    // Steps `count` frames, sampling after each; stops early once `until(sample, arg, atlas)` is true.
    async run(first, count, until, arg) {
      const test = until ? (0, eval)(`(${until})`) : null
      const trace = []
      let hit = false
      for (let n = 0; n < count && !hit; n++) {
        window.__atlasStep(first + n, 60, 1)
        await Promise.resolve()
        const s = sample(first + n)
        trace.push(s)
        hit = Boolean(test?.(s, arg, atlas))
      }
      return { hit, trace }
    },
    // For other per-frame drivers (capture): sample the frame that was just stepped.
    sample,
  }
  return { labels: window.__duoProbe.labels }
}

export async function installProbe(page, { stride = Number(process.env.DUO_VERTEX_STRIDE ?? 2) } = {}) {
  return page.evaluate(probe, { threeURL: `${threeFolder}three.module.js`, stride })
}

export const rectArea = ([x0, y0, x1, y1]) => Math.max(0, x1 - x0) * Math.max(0, y1 - y0)
export function overlapShare(follower, leader) {
  const area = rectArea(follower)
  if (!area) return 0
  const inter = rectArea([Math.max(follower[0], leader[0]), Math.max(follower[1], leader[1]),
    Math.min(follower[2], leader[2]), Math.min(follower[3], leader[3])])
  return inter / area
}
export const insideFrame = ([x0, y0, x1, y1], [width, height]) =>
  Number.isFinite(x0) && x0 >= 0 && y0 >= 0 && x1 <= width && y1 <= height

// Frame-accurate framing statistics shared by the e2e duo route and the capture route.
export function framingStats(trace, { fps = 60, contract }) {
  const limit = Math.round(contract.stretchSeconds * fps)
  const outside = []
  const runs = { overlap: { current: 0, longest: 0, at: null }, a: { current: 0, longest: 0, at: null }, b: { current: 0, longest: 0, at: null } }
  const extend = (run, active, frame) => {
    run.current = active ? run.current + 1 : 0
    if (run.current > run.longest) {
      run.longest = run.current
      run.at = frame
    }
  }
  for (const s of trace) {
    for (const label of ['a', 'b']) if (!insideFrame(s[label].rect, s.view)) outside.push({ f: s.f, label, rect: s[label].rect })
    const followerLabel = s.leader === 'b' ? 'a' : 'b'
    extend(runs.overlap, overlapShare(s[followerLabel].rect, s[s.leader ?? 'a'].rect) > contract.overlapShare, s.f)
    extend(runs.a, s.a.hidden, s.f)
    extend(runs.b, s.b.hidden, s.f)
  }
  return {
    frames: trace.length, limitFrames: limit, outsideFrames: outside.length, firstOutside: outside.slice(0, 5),
    longestOverlapFrames: runs.overlap.longest, longestOverlapAt: runs.overlap.at,
    longestHiddenFrames: { a: runs.a.longest, b: runs.b.longest }, longestHiddenAt: { a: runs.a.at, b: runs.b.at },
  }
}
