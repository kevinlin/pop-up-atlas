// Per-instance card bend (contract "Round 6" -> Folds -> Bend). The world writes `instanceBend` (radians) beside each
// hinge instance's pose matrix and defines USE_INSTANCE_BEND on the batch material; without the define every line
// below is compiled out.
//
// Shortcut: the part is bent in its local (pre-instance) frame by rotating each vertex about local X through
// bend * clamp(y / 1.0, 0, 1). That curves a card into a spiral arc rather than a length-preserving cylinder bend, and
// the clamp is on the 1.0-unit reference height, not on the part's own height, so parts shorter than 1.0 bend less at
// their tip. Positive bend moves the top toward the flat side of a sign +1 hinge (flat is local rotation -90 degrees about X,
// so the bend rotation is -bend). The shadow depth material is not patched and still casts the unbent card.
export const BEND_DEFINE = 'USE_INSTANCE_BEND'
export const BEND_REFERENCE_HEIGHT = 1.0

const height = BEND_REFERENCE_HEIGHT.toFixed(1)

export const bendGLSL = {
  header: `
#ifdef ${BEND_DEFINE}
attribute float instanceBend;
#endif
`,
  normal: `
#ifdef ${BEND_DEFINE}
  float craftBendNormalAngle = -instanceBend * clamp(position.y / ${height}, 0.0, 1.0);
  objectNormal.yz = mat2(cos(craftBendNormalAngle), sin(craftBendNormalAngle), -sin(craftBendNormalAngle), cos(craftBendNormalAngle)) * objectNormal.yz;
#endif
`,
  vertex: `
#ifdef ${BEND_DEFINE}
  float craftBendAngle = -instanceBend * clamp(transformed.y / ${height}, 0.0, 1.0);
  transformed.yz = mat2(cos(craftBendAngle), sin(craftBendAngle), -sin(craftBendAngle), cos(craftBendAngle)) * transformed.yz;
#endif
`,
}

export function applyBend(shader) {
  shader.vertexShader = `${bendGLSL.header}\n${shader.vertexShader}`
    .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>\n${bendGLSL.normal}`)
    .replace('#include <begin_vertex>', `#include <begin_vertex>\n${bendGLSL.vertex}`)
  return shader
}
