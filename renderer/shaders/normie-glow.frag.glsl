#version 300 es
precision highp float;

// Capsule-SDF glow. vUv is in half-width units:
//   vUv.x: along-segment  (-1=extended start cap, 0=seg start, L_hw=seg end, L_hw+1=extended end cap)
//   vUv.y: across-segment (-1=minus edge, 0=centre, +1=plus edge)
// vLengthHw = segment length in hw units, packed into aAlpha by buildPlaneLineQuads.
// The capsule SDF gives a smooth round cap at each endpoint so adjacent segment
// glows blend seamlessly at corners under additive blending.

in vec2  vUv;
in float vLengthHw;

uniform vec3  uTint;
uniform float uAlpha;

out vec4 fragColor;

void main() {
  float clamped = clamp(vUv.x, 0.0, vLengthHw);
  float dist    = length(vec2(vUv.x - clamped, vUv.y));
  // dist = 0 at centerline, 1 at glow radius.
  float intensity = exp(-dist * dist * 3.5);
  fragColor = vec4(uTint * (uAlpha * intensity), 1.0);
}
