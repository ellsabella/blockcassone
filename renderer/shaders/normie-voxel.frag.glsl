#version 300 es
precision highp float;

// Glass surface for normie voxel cubes.
// Schlick Fresnel + real env texture reflection (same sampler as internal-glass)
// + specular highlights from the debug point lights.
// Tinted pink, modulated by the per-voxel centre-falloff alpha.

in vec3  vWorldPos;
in vec3  vNormal;
in float vAlpha;
in float vVariant;

uniform vec3      uCamPos;
uniform vec3      uTint;
uniform float     uAlpha;
uniform float     uLightScale;
uniform vec3      uCubeCenter;
uniform float     uCubeHalfSize;
uniform vec3      uLightDir;
uniform vec3      uLightCol;
uniform float     uTime;
uniform sampler2D uEnvTex;
uniform int       uEnvLayout;

#define MAX_PT_LIGHTS 8
uniform vec3 uPointLightPos[MAX_PT_LIGHTS];
uniform vec3 uPointLightCol[MAX_PT_LIGHTS];
uniform int  uPointLightCount;

out vec4 fragColor;

// ---------------------------------------------------------------------------
// Env sampling — identical to internal-glass.frag.glsl.

vec2 cubeFaceUV(vec3 d) {
  vec3 ad = abs(d);
  vec2 uv;
  if (ad.x >= ad.y && ad.x >= ad.z) {
    uv = vec2(-sign(d.x) * d.z, -d.y) / ad.x;
  } else if (ad.y >= ad.z) {
    uv = vec2(d.x, sign(d.y) * d.z) / ad.y;
  } else {
    uv = vec2(sign(d.z) * d.x, -d.y) / ad.z;
  }
  return uv * 0.5 + 0.5;
}

vec2 crossLayoutUV(vec3 d) {
  vec3 ad = abs(d);
  vec2 cell, faceUV;
  if (ad.z >= ad.x && ad.z >= ad.y) {
    if (d.z > 0.0) { faceUV = vec2( d.x, -d.y) / ad.z; cell = vec2(1.0, 1.0); }
    else           { faceUV = vec2(-d.x, -d.y) / ad.z; cell = vec2(3.0, 1.0); }
  } else if (ad.x >= ad.y) {
    if (d.x > 0.0) { faceUV = vec2(-d.z, -d.y) / ad.x; cell = vec2(2.0, 1.0); }
    else           { faceUV = vec2( d.z, -d.y) / ad.x; cell = vec2(0.0, 1.0); }
  } else {
    if (d.y > 0.0) { faceUV = vec2( d.x,  d.z) / ad.y; cell = vec2(1.0, 0.0); }
    else           { faceUV = vec2( d.x, -d.z) / ad.y; cell = vec2(1.0, 2.0); }
  }
  return (cell + faceUV * 0.5 + 0.5) / vec2(4.0, 3.0);
}

vec3 sampleEnv(vec3 dir) {
  vec3 d = normalize(dir);
  vec2 uv = (uEnvLayout == 1) ? crossLayoutUV(d) : cubeFaceUV(d);
  vec3 c = texture(uEnvTex, uv).rgb;
  return pow(c, vec3(0.95)) * 1.15;
}

// ---------------------------------------------------------------------------

float schlick(float cosTheta) {
  float x  = 1.0 - cosTheta;
  float x2 = x * x;
  float x5 = x2 * x2 * x;
  return mix(0.04, 1.0, x5);
}

void main() {
  vec3 N = normalize(vNormal);
  vec3 V = normalize(uCamPos - vWorldPos);
  if (dot(N, V) < 0.0) N = -N;

  vec3 R = reflect(-V, N);

  float NdotV = max(dot(N, V), 0.0);
  float fres  = schlick(NdotV);

  // Directional light specular (kept faint — just enough to show form).
  vec3 H     = normalize(normalize(uLightDir) + V);
  float specP = pow(max(dot(N, H), 0.0), 48.0);
  float inertMask  = 1.0 - step(0.26, vVariant);
  float brightMask = step(0.86, vVariant) * (1.0 - step(0.96, vVariant));
  float glitchMask = step(0.96, vVariant);
  float react = mix(0.48, 0.90, 1.0 - inertMask);
  react = mix(react, 1.18, brightMask);

  float glitchWave = 0.5 + 0.5 * sin(uTime * (7.0 + vVariant * 9.0) + vVariant * 53.0);
  float glitchBlink = mix(0.45, 1.35, smoothstep(0.22, 1.0, glitchWave));
  react = mix(react, glitchBlink, glitchMask);

  vec3  spec  = uLightCol * specP * (2.2 + fres * 0.6) * uLightScale * react;

  // Point light specular — broad highlights, low attenuation so they
  // reach across the voxel cluster and shimmer as camera angle changes.
  // Positions are relative offsets from cube centre, scaled by cube half-size.
  vec3 ptSpec = vec3(0.0);
  for (int i = 0; i < MAX_PT_LIGHTS; i++) {
    if (i >= uPointLightCount) break;
    vec3  lightPos = (uCubeHalfSize > 0.0)
                       ? uCubeCenter + uPointLightPos[i] * uCubeHalfSize
                       : uPointLightPos[i];
    vec3  Lp   = normalize(lightPos - vWorldPos);
    float dist = length(lightPos - vWorldPos);
    float att  = 1.0 / (1.0 + dist * dist * 0.08);
    vec3  Hp   = normalize(Lp + V);
    float sp   = pow(max(dot(N, Hp), 0.0), 18.0);
    ptSpec    += uPointLightCol[i] * sp * att * (1.0 + fres * 1.0) * react;
  }
  ptSpec *= uLightScale;

  vec3 env  = sampleEnv(R) * (0.44 + fres * 0.62 * uLightScale) * mix(0.58, 1.02, react);
  vec3 tintShift = mix(uTint, uTint.brg, glitchMask * 0.22 * glitchWave);
  vec3 base = tintShift * 0.06 * mix(0.55, 1.0, react);
  vec3 edge = tintShift * fres * fres * mix(0.92, 2.00, react);
  vec3 col  = base + edge + env + spec + ptSpec;

  float specBoost = clamp(dot(spec + ptSpec, vec3(0.299, 0.587, 0.114)), 0.0, 1.0) * 0.75;
  float alphaReact = mix(0.58, 1.08, react);
  alphaReact = mix(alphaReact, glitchBlink, glitchMask);
  float a = uAlpha * vAlpha * alphaReact * mix(0.25, 0.98, fres) + specBoost;

  fragColor = vec4(col, clamp(a, 0.0, 1.0));
}
