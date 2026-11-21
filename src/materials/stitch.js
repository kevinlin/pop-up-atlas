export const stitchGLSL = /* glsl */ `
float craftStitch(vec2 uv, float filterWidth) {
  // Fringe UV runs 3.4 repeats per unit along the edge. One stitch every 0.052 units.
  float along = fract(uv.x / (3.4 * 0.052)) - 0.5;
  float across = 1.0 - uv.y - 0.31 - 0.46 * along;
  vec2 shape = vec2(along * 2.9, across * 6.6);
  return 1.0 - smoothstep(0.50 - filterWidth, 1.0 + filterWidth, dot(shape, shape));
}

vec3 craftRaisedStitch(vec3 eyePosition, vec3 normal, vec2 gradient) {
  vec3 dx = dFdx(eyePosition);
  vec3 dy = dFdy(eyePosition);
  vec3 acrossX = cross(dy, normal);
  vec3 acrossY = cross(normal, dx);
  float determinant = dot(dx, acrossX);
  vec3 ridge = acrossX * gradient.x + acrossY * gradient.y;
  return normalize(max(abs(determinant), 1e-8) * normal - sign(determinant) * ridge);
}
`
