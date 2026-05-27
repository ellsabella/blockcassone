#version 300 es
precision highp float;

// Line network fragment — flat emission scaled by the interpolated alpha.
// Rendered additively so crossings brighten.

in float vAlpha;

uniform vec3  uBaseCol;
uniform float uLineOpacity;

out vec4 fragColor;

void main() {
  fragColor = vec4(uBaseCol * vAlpha * uLineOpacity, 1.0);
}
