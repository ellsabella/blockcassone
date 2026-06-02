#version 300 es
precision highp float;

// Water-surface vertex stage.
//
// Mesh: a subdivided XZ plane at y=0, extent ±0.5 in local cube space — same
// shape as the biome floor grid, just tessellated. The vertex shader displaces
// each vertex along local +Y (the inward direction toward the cube interior)
// using a two-octave 3D value noise driven by uTime; the analytic normal is
// recovered from finite differences of the same displacement so reflections
// in the fragment stage stay consistent with the geometry the eye sees.
//
// `hash3` / `vnoise` come from the shared chunk include below.

layout(location = 0) in vec3 aPosition;
layout(location = 2) in vec2 aUv;

uniform mat4  uView;
uniform mat4  uProj;
uniform mat4  uM;
uniform float uTime;
uniform float uScale;
uniform float uSpeed;

out vec3 vWorldPos;
out vec3 vWorldNormal;
out vec2 vUv;

// #include "chunks/noise3d.glsl"

// Two-octave wave height field. The first octave gives the large swells, the
// second adds finer ripples. Time scrolls each octave along a different
// direction so the field swirls rather than translating uniformly.
float wave(vec2 xz, float t) {
  vec3 q1 = vec3(xz.x, 0.0, xz.y) * uScale + vec3(t * uSpeed,        0.0, t * uSpeed * 0.7);
  vec3 q2 = vec3(xz.x, 0.0, xz.y) * uScale * 2.3 + vec3(t * uSpeed * -0.4, 0.0, t * uSpeed * 0.55);
  return vnoise(q1) * 0.65 + vnoise(q2) * 0.35;
}

void main() {
  const float AMP    = 0.085;  // displacement magnitude in unit cube space
  const float REST_Y = 0.025;  // base water level above the plane

  vec2 xz = aPosition.xz;
  float h = wave(xz, uTime);
  float y = REST_Y + h * AMP;

  // Finite-difference normal in local space, then rotate into world space
  // through mat3(uM). The transform may include 90° rotation for cubes whose
  // unique axis is X or Z; per-axis scaling is close to uniform (cubes are
  // ~cubic) so we accept the small approximation rather than computing a
  // full inverse-transpose.
  const float EPS = 0.012;
  float hx1 = wave(xz + vec2(EPS, 0.0), uTime);
  float hx0 = wave(xz - vec2(EPS, 0.0), uTime);
  float hz1 = wave(xz + vec2(0.0, EPS), uTime);
  float hz0 = wave(xz - vec2(0.0, EPS), uTime);
  float dx = (hx1 - hx0) * AMP / (2.0 * EPS);
  float dz = (hz1 - hz0) * AMP / (2.0 * EPS);
  vec3 localN = normalize(vec3(-dx, 1.0, -dz));

  vec3 localPos = vec3(xz.x, y, xz.y);
  vec4 world4   = uM * vec4(localPos, 1.0);

  vWorldPos    = world4.xyz;
  vWorldNormal = normalize(mat3(uM) * localN);
  vUv          = aUv;

  gl_Position = uProj * uView * world4;
}
