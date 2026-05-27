#version 300 es
precision highp float;

// Normie glow vertex stage.
// aAlpha (loc 4) is repurposed to carry the segment's L_hw value (segment length
// in half-width units) so the frag shader can compute a capsule SDF without uniforms.

layout(location = 0) in vec3  aPosition;
layout(location = 2) in vec2  aUv;
layout(location = 4) in float aAlpha;

uniform mat4 uM;
uniform mat4 uView;
uniform mat4 uProj;

out vec2  vUv;
out float vLengthHw;

void main() {
  vUv       = aUv;
  vLengthHw = aAlpha;
  gl_Position = uProj * uView * uM * vec4(aPosition, 1.0);
}
