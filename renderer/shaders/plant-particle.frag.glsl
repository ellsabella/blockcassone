#version 300 es
precision highp float;

// Plant particle fragment. Soft fuzzy mask (low-power falloff), 3-stop
// colour gradient per particle, occasional bright hotspots, depth-banded
// brightness. `aInstDepth > 1.0` is the halo marker.
// Rendered additively; RGB is already pre-multiplied by the mask.

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

  // Soft, broad falloff — starts fading almost immediately.
  float mask = 1.0 - smoothstep(0.0, 0.55, d);
  if (mask < 0.005) discard;

  bool isHalo = vDepth > 1.0;
  float power = isHalo ? 1.0 : 1.6;    // lower = fuzzier edge
  mask = pow(mask, power);

  float jitter = fract(sin(vSeed * 127.13) * 43758.5453);

  // Per-particle colour: mix from pure white → a strongly saturated tint.
  // Pastel uTint values sit close to white, so we push them aggressively
  // away from their own luminance and floor the mix high enough that no
  // particle is fully white. The brightness multipliers below are kept
  // modest so dense additive accumulation doesn't immediately clip every
  // colour channel to 1 (which is what makes clouds read as plain white).
  float lum = dot(uTint, vec3(0.299, 0.587, 0.114));
  vec3  satTint = vec3(lum) + (uTint - vec3(lum)) * 2.6;
  float tintMix = mix(0.55, 1.15, jitter);
  vec3 col = mix(vec3(1.0), satTint, tintMix);

  float strength;
  if (isHalo) {
    col     *= 0.65;
    strength = 0.17;
  } else {
    // Trunk dim, leaves bright — capped at 1.0 so per-particle brightness
    // doesn't independently saturate the framebuffer.
    col     *= mix(0.30, 1.00, clamp(vDepth, 0.0, 1.0));
    strength = 1.0;
  }

  // Occasional brighter particles — top ~5 % a touch brighter so the cloud
  // has sparkle without shifting individual particles toward white.
  float hot = step(0.95, rand(vSeed));
  col *= mix(1.0, 1.5, hot);

  fragColor = vec4(col * mask * strength * uOpacity, 1.0);
}
