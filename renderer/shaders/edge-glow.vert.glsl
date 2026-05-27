#version 300 es
precision highp float;

// Instanced billboard vertex stage for static edge-glow sprites. Matches
// plant-particle.vert's attribute layout so the same VAO works, but without
// the per-particle sway — edges must stay rigidly locked to the glass.

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

out vec2  vUv;
out float vSeed;
out float vDepth;

void main() {
  vec3 world = (uM * vec4(aInstPos, 1.0)).xyz;

  vec3 finalPos = world
    + uCamRight * aCorner.x * aInstSize
    + uCamUp    * aCorner.y * aInstSize;

  vUv    = aCorner + 0.5;
  vSeed  = aInstSeed;
  vDepth = aInstDepth;

  gl_Position = uProj * uView * vec4(finalPos, 1.0);
}
