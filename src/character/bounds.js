import { Box2, Matrix4, Vector3 } from 'three'

export function createCharacterBounds() {
  const view = new Matrix4()
  const transform = new Matrix4()
  const projected = new Box2()
  const vertex = new Vector3()
  let meshes

  return {
    bind(model) {
      meshes = []
      model.traverse((object) => { if (object.isMesh) meshes.push(object) })
    },
    project(camera, { width, height }) {
      view.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
      projected.makeEmpty()
      for (const mesh of meshes) {
        transform.multiplyMatrices(view, mesh.matrixWorld)
        const count = mesh.geometry.attributes.position.count
        // Use the posed vertices so the click target includes the animated hair and accessories.
        for (let i = 0; i < count; i += 1) {
          mesh.getVertexPosition(i, vertex)
          projected.expandByPoint(vertex.applyMatrix4(transform))
        }
      }
      return {
        left: (1 + projected.min.x) * width / 2,
        right: (1 + projected.max.x) * width / 2,
        top: (1 - projected.max.y) * height / 2,
        bottom: (1 - projected.min.y) * height / 2,
      }
    },
  }
}
