import { ShaderChunk } from 'three'

// Reuse the sunlight already filtered by the shadow map for the diffuse pass.
export const glitterLights = ShaderChunk.lights_fragment_begin.replace(
  /(getDirectionalLightInfo\( directionalLight, directLight \);[\s\S]*?#endif)/,
  '$1\n#if UNROLLED_LOOP_INDEX == 0\n  craftSunlight = directLight.color;\n#endif',
)

export const glitterGLSL = /* glsl */ `
flat varying vec2 craftFlakeOffset;

vec2 craftHash2(vec2 p) {
  vec3 v = fract(p.xyx * vec3(0.1031, 0.1030, 0.0973));
  v += dot(v, v.yzx + 33.33);
  return fract((v.xx + v.yz) * v.zy);
}

float craftFlake(vec2 grid, vec2 dx, vec2 dy, float coverage, float maxRadius, bool large,
                 vec3 surfaceNormal, vec3 viewDirection, vec3 keyDirection) {
  vec2 cell = floor(grid);
  vec2 seed = craftHash2(cell);
  if (large && seed.x > 0.68) return 0.0;
  vec2 offset = fract(grid) - mix(vec2(0.18), vec2(0.82), seed.yx);
  if (dot(offset, offset) > 0.0324) return 0.0;

  float determinant = dx.x * dy.y - dx.y * dy.x;
  // The two projected disk areas add to at most 1% before facet selection.
  float radius = min(maxRadius, sqrt(coverage / (PI * max(abs(determinant), 0.00001))));
  vec2 pixelOffset = vec2(dy.y * offset.x - dy.x * offset.y, dx.x * offset.y - dx.y * offset.x);
  if (dot(pixelOffset, pixelOffset) > pow2(radius * determinant)) return 0.0;

  vec3 worldNormal = transformDirectionByInverseViewMatrix(surfaceNormal, viewMatrix);
  vec3 axis = abs(worldNormal.y) < 0.95 ? vec3(0, 1, 0) : vec3(1, 0, 0);
  vec3 tangent = normalize(cross(axis, worldNormal));
  vec2 tilt = craftHash2(cell + 57.0) * 2.5 - 1.25;
  vec3 flakeNormal = normalize(mat3(viewMatrix) *
    (worldNormal + tilt.x * tangent + tilt.y * cross(worldNormal, tangent)));
  float facing = dot(flakeNormal, keyDirection);
  vec3 halfVector = normalize(viewDirection + keyDirection);
  float reflects = step(large ? 0.932 : 0.947, dot(flakeNormal, halfVector)) * step(0.0, facing);
  return reflects * (large ? mix(0.24, 1.0, step(0.65, facing)) : 0.23);
}

float craftGlint(vec2 uv, bool largeFlakes, vec3 normal, vec3 viewDir, vec3 keyDir) {
  vec2 grid = uv * 22.0 + craftFlakeOffset;
  vec2 dx = dFdx(grid);
  vec2 dy = dFdy(grid);
  float fine = craftFlake(grid, dx, dy, 0.0062, 0.55, false, normal, viewDir, keyDir);
  float large = largeFlakes
    ? craftFlake(grid / 3.0 + 81.0, dx / 3.0, dy / 3.0, 0.0038, 1.45, true, normal, viewDir, keyDir)
    : 0.0;
  return max(fine, large);
}
`
