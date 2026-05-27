#version 300 es
precision highp float;

// Generic additive glow particle. Soft circular mask, mild brightness
// jitter per particle, uniform tint. Used to build luminous tubes along
// edges (stone-glass pane borders etc.) — many of these additive-stack
// into the classic "bloomed edge" look.

in vec2  vUv;
in float vSeed;
in float vDepth;  // unused; kept for compatibility with plant-particle.vert

uniform vec3  uTint;
uniform float uOpacity;

out vec4 fragColor;

void main() {
  vec2 r = vUv - 0.5;
  float mask = 1.0 - smoothstep(0.0, 0.5, length(r));
  if (mask < 0.005) discard;
  mask = pow(mask, 1.4);

  // Even, illuminated-from-within glow — no per-particle brightness jitter,
  // so overlapping sprites accumulate into a smooth tube rather than a bumpy
  // necklace.
  fragColor = vec4(uTint * mask * uOpacity, 1.0);
}
