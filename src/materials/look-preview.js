import { camera, player, scene } from '../scene/runtime.js'

window.__atlasLookShots = {
  pose({ x, z, zoom, heading }) {
    player.position.set(x, 0, z)
    player.heading = heading
    camera.zoom = zoom
    camera.updateProjectionMatrix()
  },
  cameraSettled() {
    const position = player.position.clone().project(camera)
    return Math.abs(position.x) < 0.025 && Math.abs(position.y) < 0.025
  },
  hasModel(id) {
    return scene.children.some((node) => node.count > 0 && node.name.startsWith(`atlas/${id}/`))
  },
}
