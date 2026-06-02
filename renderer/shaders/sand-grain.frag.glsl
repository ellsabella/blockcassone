#version 300 es
precision highp float;

// Sand-grain fragment. The plant-particle shader paints a smooth gaussian
// puff — wrong for sand. This one builds a small hard-edged core with a
// quantized, jittered halo so each grain reads as a discrete granular speck
// rather than a soft glow. Additive blend; RGB is pre-multiplied by the mask.

in vec2  vUv;
in float vSeed;
in float vDepth;

uniform vec3  uTint;
uniform float uOpacity;

out vec4 fragColor;

float rand(float s) { return fract(sin(s * 23.7 + 11.3) * 9876.5); }

void main() {
  vec2 r = vUv - 0.5;
  float d = length(r);
  if (d > 0.5) discard;

  // Hard-edged core. Narrow falloff so grains stay punchy rather than glowy.
  float core = 1.0 - smoothstep(0.04, 0.36, d);

  // Sub-disk offset by a per-grain hash — gives an irregular silhouette
  // without a full noise lookup, much cheaper than 2D simplex.
  vec2 off = vec2(rand(vSeed * 1.7) - 0.5,
                  rand(vSeed * 2.3) - 0.5) * 0.18;
  float bump = 1.0 - smoothstep(0.0, 0.28, length(r - off));

  float mask = max(core, bump * 0.55);
  // Quantize to give a chunky, granular alpha rather than a smooth disk.
  mask = floor(mask * 5.0) / 5.0;
  if (mask < 0.02) discard;

  // Per-grain warm/cool variation around uTint. Slightly desaturate toward
  // a baseline luminance for the small-tinted look of dry mineral grains.
  float jitter = rand(vSeed);
  float lum    = dot(uTint, vec3(0.299, 0.587, 0.114));
  vec3  warm   = uTint * (0.85 + 0.55 * jitter);
  vec3  col    = mix(vec3(lum) * 0.80, warm, 0.78);

  // Occasional brighter grain (top ~10%) — catches the eye when the field
  // is dense.
  float hot = step(0.90, jitter);
  col *= mix(1.0, 1.45, hot);

  fragColor = vec4(col * mask * uOpacity, 1.0);
}
