#version 300 es
precision highp float;

layout(location = 0) in vec3  aPosition;
layout(location = 1) in vec3  aNormal;
layout(location = 4) in float aAlpha;
layout(location = 5) in float aVariant;

uniform mat4 uM;
uniform mat4 uView;
uniform mat4 uProj;

out vec3  vWorldPos;
out vec3  vNormal;
out float vAlpha;
out float vVariant;

void main() {
  vec4 wp = uM * vec4(aPosition, 1.0);
  vWorldPos = wp.xyz;
  vNormal = aNormal;
  vAlpha = aAlpha;
  vVariant = aVariant;
  gl_Position = uProj * uView * wp;
}
