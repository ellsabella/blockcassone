#version 300 es
precision highp float;

// Line network vertex stage — per-vertex alpha so each line fades along
// its length.

layout(location = 0) in vec3  aPosition;
layout(location = 4) in float aAlpha;

uniform mat4 uView;
uniform mat4 uProj;
uniform mat4 uM;

out float vAlpha;

void main() {
  vAlpha = aAlpha;
  gl_Position = uProj * uView * uM * vec4(aPosition, 1.0);
}
