#version 300 es
precision highp float;

// Ridge-terrain vertex stage. Shared between mountain-range and ice-surface
// materials — both displace a subdivided XZ plane with a sum of ridge-noise
// octaves. The fragment shader decides what the surface LOOKS like (matte
// grey rock vs reflective icy crystal); this stage just builds the geometry.
//
// Static (no uTime in the field). Outputs `vElev` in [0,1]-ish so the frag
// can shade by elevation without knowing the amplitude.

layout(location = 0) in vec3 aPosition;
layout(location = 2) in vec2 aUv;

uniform mat4  uView;
uniform mat4  uProj;
uniform mat4  uM;
uniform float uScale;   // spatial noise frequency
uniform float uAmp;     // peak displacement in unit cube space

out vec3  vWorldPos;
out vec3  vWorldNormal;
out vec2  vUv;
out float vHeightLocal;
out float vElev;
out float vUpAlign;   // local-frame N.y; 1.0 = facing inward, 0.0 = vertical face

// #include "chunks/noise3d.glsl"

float ridge(vec3 p) {
  return 1.0 - abs(vnoise(p) * 2.0);
}

// Three-octave ridge noise. Power curve pulls the low ground down so the
// surface reads as ridgelines rising from a base plane rather than a
// uniformly noisy field.
float ridgeField(vec2 xz) {
  vec3 q = vec3(xz.x, 0.0, xz.y) * uScale;
  float h = ridge(q) * 0.55
          + ridge(q * 2.1 + vec3(11.0, 0.0,  7.0)) * 0.27
          + vnoise(q * 4.6 + vec3( 0.0, 0.0, 23.0)) * 0.12;
  return pow(max(h, 0.0), 1.4);
}

void main() {
  vec2  xz = aPosition.xz;
  float h  = ridgeField(xz);
  float y  = h * uAmp;

  const float EPS = 0.012;
  float hx1 = ridgeField(xz + vec2(EPS, 0.0));
  float hx0 = ridgeField(xz - vec2(EPS, 0.0));
  float hz1 = ridgeField(xz + vec2(0.0, EPS));
  float hz0 = ridgeField(xz - vec2(0.0, EPS));
  float dx = (hx1 - hx0) * uAmp / (2.0 * EPS);
  float dz = (hz1 - hz0) * uAmp / (2.0 * EPS);
  vec3 localN = normalize(vec3(-dx, 1.0, -dz));

  vec3 localPos = vec3(xz.x, y, xz.y);
  vec4 world4   = uM * vec4(localPos, 1.0);

  vWorldPos    = world4.xyz;
  vWorldNormal = normalize(mat3(uM) * localN);
  vUv          = aUv;
  vHeightLocal = y;
  vElev        = h;
  vUpAlign     = localN.y;

  gl_Position = uProj * uView * world4;
}
