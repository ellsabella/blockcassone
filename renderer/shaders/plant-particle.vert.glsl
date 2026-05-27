#version 300 es
precision highp float;

// Instanced billboard vertex stage for plant particles.
// Location 0: shared corner in [-0.5, 0.5].
// Locations 1-4: per-instance data written with vertexAttribDivisor = 1.

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

out vec2  vUv;
out float vSeed;
out float vDepth;

void main() {
  // Apply scene rotation (if any) to the particle's world position.
  vec3 world = (uM * vec4(aInstPos, 1.0)).xyz;

  // Per-particle drift sway — keeps the plant feeling alive.
  float phase = aInstSeed * 12.5663;
  vec3 sway = uCamRight * (sin(uTime * 0.6 + phase) * 0.004)
            + uCamUp    * (cos(uTime * 0.4 + phase) * 0.003);
  world += sway;

  // Camera-facing quad expansion.
  vec3 finalPos = world
    + uCamRight * aCorner.x * aInstSize
    + uCamUp    * aCorner.y * aInstSize;

  vUv    = aCorner + 0.5;
  vSeed  = aInstSeed;
  vDepth = aInstDepth;

  gl_Position = uProj * uView * vec4(finalPos, 1.0);
}
