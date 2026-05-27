#version 300 es
precision highp float;

// Thin glass pane vertex stage — positions + flat normals pass-through.
// `uM` is currently identity (positions are already in world space); kept
// in the signature so later scene-rotation is trivial to wire.

layout(location = 0) in vec3 aPosition;
layout(location = 1) in vec3 aNormal;

uniform mat4 uView;
uniform mat4 uProj;
uniform mat4 uM;

out vec3 vWorldPos;
out vec3 vNormal;

void main() {
  vec4 wp = uM * vec4(aPosition, 1.0);
  vWorldPos = wp.xyz;
  vNormal   = aNormal;
  gl_Position = uProj * uView * wp;
}
