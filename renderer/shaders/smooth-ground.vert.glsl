#version 300 es
precision highp float;

// Smooth-ground vertex stage. Shared between grass-meadow's hillside and
// desert-dunes' sand bed — both displace a subdivided XZ plane with a sum of
// two value-noise octaves (no ridge-noise abs trick — that's ridge-terrain's
// job). Static (no uTime in the field). Outputs vElev pre-normalized so the
// frag can shade by elevation without knowing the amplitude.
//
// CPU mirror of the `hill()` function lives in viewer/environments.js so
// grain/blade placement decisions track the same surface the GPU draws.

layout(location = 0) in vec3 aPosition;
layout(location = 2) in vec2 aUv;

uniform mat4  uView;
uniform mat4  uProj;
uniform mat4  uM;
uniform float uScale;
uniform float uAmp;

out vec3  vWorldPos;
out vec3  vWorldNormal;
out vec2  vUv;
out float vHeightLocal;
out float vElev;

// #include "chunks/noise3d.glsl"

float hill(vec2 xz) {
  vec3 q = vec3(xz.x, 0.0, xz.y) * uScale;
  return vnoise(q) * 0.65 + vnoise(q * 2.4 + vec3(11.0, 0.0, 5.0)) * 0.25;
}

void main() {
  vec2  xz = aPosition.xz;
  float h  = hill(xz);
  float y  = h * uAmp;

  const float EPS = 0.015;
  float hx1 = hill(xz + vec2(EPS, 0.0));
  float hx0 = hill(xz - vec2(EPS, 0.0));
  float hz1 = hill(xz + vec2(0.0, EPS));
  float hz0 = hill(xz - vec2(0.0, EPS));
  float dx = (hx1 - hx0) * uAmp / (2.0 * EPS);
  float dz = (hz1 - hz0) * uAmp / (2.0 * EPS);
  vec3 localN = normalize(vec3(-dx, 1.0, -dz));

  vec3 localPos = vec3(xz.x, y, xz.y);
  vec4 world4   = uM * vec4(localPos, 1.0);

  vWorldPos    = world4.xyz;
  vWorldNormal = normalize(mat3(uM) * localN);
  vUv          = aUv;
  vHeightLocal = y;
  vElev        = clamp(h * 0.5 + 0.5, 0.0, 1.0);

  gl_Position = uProj * uView * world4;
}
