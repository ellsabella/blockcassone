#version 300 es
precision highp float;

// Text-banner fragment. Two-mode neon shader:
//   uMode = 0  → glow pass (additive blend, soft HDR halo from low-alpha)
//   uMode = 1  → core pass (alpha blend, opaque crisp text from high-alpha)
//
// uGlitch [0..1]: drives chromatic aberration + scanline tear intensity.
// uTime: seconds, used for animated scanline tearing.

in vec2 vUv;

uniform sampler2D uTextTex;
uniform vec3      uTint;
uniform float     uAlpha;
uniform float     uMode;
uniform float     uGlitch;
uniform float     uTimeScale;
uniform float     uTime;

out vec4 fragColor;

float rand(vec2 co) {
  return fract(sin(dot(co, vec2(127.1, 311.7))) * 43758.5453);
}

void main() {
  vec2 uv = vUv;
  float timeScale = max(uTimeScale, 1.0);

  // Scanline tear: displace a random subset of horizontal bands.
  float row       = floor(uv.y * 64.0);
  float tearSeed  = rand(vec2(row, floor(uTime * 6.0 * timeScale)));
  float tearThresh = 1.0 - uGlitch * 0.70;
  float tearAmt   = (tearSeed > tearThresh) ? (tearSeed - tearThresh) * uGlitch * 0.45 : 0.0;
  uv.x = fract(uv.x + tearAmt);

  // Chromatic aberration: sample alpha at three offset UVs.
  float aberr = uGlitch * 0.18;
  float aR = texture(uTextTex, vec2(uv.x + aberr, uv.y)).a;
  float aG = texture(uTextTex, uv).a;
  float aB = texture(uTextTex, vec2(uv.x - aberr, uv.y)).a;

  if (uMode < 0.5) {
    // Glow: fuzzy halo, additive — per-channel so aberration creates colour fringing.
    fragColor = vec4(
      uTint.r * pow(aR, 0.55) * uAlpha,
      uTint.g * pow(aG, 0.55) * uAlpha,
      uTint.b * pow(aB, 0.55) * uAlpha,
      1.0
    );
  } else {
    // Core: crisp text, alpha-blended — per-channel coverage.
    float cR = clamp(pow(aR, 3.5) * uAlpha, 0.0, 1.0);
    float cG = clamp(pow(aG, 3.5) * uAlpha, 0.0, 1.0);
    float cB = clamp(pow(aB, 3.5) * uAlpha, 0.0, 1.0);
    fragColor = vec4(uTint.r * cR, uTint.g * cG, uTint.b * cB, (cR + cG + cB) / 3.0);
  }
}
