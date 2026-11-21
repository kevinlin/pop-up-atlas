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
  if (large && seed.x > 0.80) return 0.0;
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
  float reflects = step(large ? 0.923 : 0.947, dot(flakeNormal, halfVector)) * step(0.0, facing);
  return reflects * (large ? mix(0.24, 1.0, step(0.60, facing)) : 0.23);
}

vec2 craftGlint(vec2 uv, bool largeFlakes, vec3 normal, vec3 viewDir, vec3 keyDir) {
  vec2 grid = uv * 22.0 + craftFlakeOffset;
  vec2 dx = dFdx(grid);
  vec2 dy = dFdy(grid);
  float fine = craftFlake(grid, dx, dy, 0.0054, 0.55, false, normal, viewDir, keyDir);
  float large = largeFlakes
    ? craftFlake(grid / 3.0 + 81.0, dx / 3.0, dy / 3.0, 0.0046, 1.45, true, normal, viewDir, keyDir)
    : 0.0;
  return vec2(fine, large);
}
`

export const riverGlintBoost = /* glsl */ `
#if defined(USE_SHADOWMAP) && defined(SHADOWMAP_TYPE_PCF) && NUM_DIR_LIGHT_SHADOWS > 0
  float sunVisibility = craftSunlight.r / max(directionalLights[0].color.r, 0.001);
  if (glints.y > 0.5 && sunVisibility > 0.84 && receiveShadow) {
    vec3 point = vDirectionalShadowCoord[0].xyz / vDirectionalShadowCoord[0].w;
    point.z += directionalLightShadows[0].shadowBias;
    vec2 ring = 10.0 / directionalLightShadows[0].shadowMapSize;
    if (all(greaterThan(point.xy, ring)) && all(lessThan(point.xy, 1.0 - ring))) {
      // Probe just beyond the PCF penumbra, only for already sunlit coarse flakes.
      float neighbor = min(
        min(texture(directionalShadowMap[0], point + vec3(ring.x, 0.0, 0.0)),
            texture(directionalShadowMap[0], point - vec3(ring.x, 0.0, 0.0))),
        min(texture(directionalShadowMap[0], point + vec3(0.0, ring.y, 0.0)),
            texture(directionalShadowMap[0], point - vec3(0.0, ring.y, 0.0))));
      glint += 2.2 * glints.y * (1.0 - neighbor) * smoothstep(0.84, 0.99, sunVisibility);
    }
  }
#endif
`
