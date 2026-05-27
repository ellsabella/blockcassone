#version 300 es
precision highp float;

// Text-banner vertex stage — passthrough position + UV. UVs are baked into
// the quad mesh (one quad per banner) so each banner samples its own texture
// at the right orientation.

layout(location = 0) in vec3 aPosition;
layout(location = 2) in vec2 aUv;

uniform mat4 uView;
uniform mat4 uProj;
uniform mat4 uM;

out vec2 vUv;

void main() {
  vUv = aUv;
  gl_Position = uProj * uView * uM * vec4(aPosition, 1.0);
}
