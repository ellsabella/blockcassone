#version 300 es
precision highp float;

// Instanced billboard for sand grains.
//
// Each instance carries a base position in unit cube local space; the vertex
// stage samples three offset 3D value-noise fields and uses them as a vector
// displacement so grains drift along a curl-like flow. The drift is summed in
// LOCAL space (before `uM`) so the world transform — which rotates the floor
// onto the cube's unique-axis plane — also rotates the grain motion onto that
// same plane. Final billboard expansion is camera-facing in world space.

layout(location = 0) in vec2  aCorner;
layout(location = 1) in vec3  aInstPos;
layout(location = 2) in float aInstSize;
layout(location = 3) in float aInstSeed;
layout(location = 4) in float aInstDepth;

uniform mat4  uView;
uniform mat4  uProj;
uniform mat4  uM;
uniform vec3  uCamRight;
uniform vec3  uCamUp;
uniform float uTime;
uniform float uScale;   // noise spatial frequency (cycles per unit cube)
uniform float uSpeed;   // drift speed (cycles per second)

out vec2  vUv;
out float vSeed;
out float vDepth;

// #include "chunks/noise3d.glsl"

void main() {
  // Sample three decorrelated noise channels for a vector flow. Time advances
  // each channel along its own axis so the field swirls rather than translating
  // uniformly.
  float seed = aInstSeed * 0.13;
  vec3 q = aInstPos * uScale;
  float t = uTime * uSpeed;
  vec3 disp = vec3(
    vnoise(q + vec3(t,         seed,         0.0)),
    vnoise(q + vec3(31.0 + seed, 11.0 + t,   7.0)),
    vnoise(q + vec3(57.0,       23.0 + seed, 19.0 + t))
  );
  // Magnitude tuned so grains migrate within their local neighbourhood without
  // tunnelling through cube faces (max ≈ 0.08 in unit cube space).
  vec3 localPos = aInstPos + disp * 0.08;

  vec3 world = (uM * vec4(localPos, 1.0)).xyz;

  vec3 finalPos = world
    + uCamRight * aCorner.x * aInstSize
    + uCamUp    * aCorner.y * aInstSize;

  vUv    = aCorner + 0.5;
  vSeed  = aInstSeed;
  vDepth = aInstDepth;

  gl_Position = uProj * uView * vec4(finalPos, 1.0);
}
