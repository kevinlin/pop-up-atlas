export const glitterGLSL = /* glsl */ `
flat varying vec2 craftFlakeOffset;

vec2 craftHash2(vec2 p) {
  vec3 v = fract(p.xyx * vec3(0.1031, 0.1030, 0.0973));
  v += dot(v, v.yzx + 33.33);
  return fract((v.xx + v.yz) * v.zy);
}

float craftGlint(vec2 uv, vec3 surfaceNormal, vec3 viewDirection, vec3 keyDirection) {
  vec2 grid = uv * 13.0 + craftFlakeOffset;
  vec2 dx = dFdx(grid);
  vec2 dy = dFdy(grid);
  float determinant = dx.x * dy.y - dx.y * dy.x;
  vec2 flake = floor(grid);
  vec2 offset = fract(grid) - mix(vec2(0.24), vec2(0.76), craftHash2(flake));

  // One disk per UV cell. Its projected area is capped at 0.9% before the normal test.
  float radius = min(1.45, sqrt(0.009 / (PI * max(abs(determinant), 0.00001))));
  vec2 pixelOffset = vec2(dy.y * offset.x - dy.x * offset.y, dx.x * offset.y - dx.y * offset.x);
  if (dot(pixelOffset, pixelOffset) > pow2(radius * determinant) || dot(offset, offset) > 0.0576) return 0.0;

  vec3 worldNormal = transformDirectionByInverseViewMatrix(surfaceNormal, viewMatrix);
  vec3 axis = abs(worldNormal.y) < 0.95 ? vec3(0, 1, 0) : vec3(1, 0, 0);
  vec3 tangent = normalize(cross(axis, worldNormal));
  vec2 tilt = craftHash2(flake + 57.0) * 1.9 - 0.95;
  vec3 flakeNormal = normalize(mat3(viewMatrix) *
    (worldNormal + tilt.x * tangent + tilt.y * cross(worldNormal, tangent)));
  vec3 halfVector = normalize(viewDirection + keyDirection);
  return step(0.951, dot(flakeNormal, halfVector));
}
`
